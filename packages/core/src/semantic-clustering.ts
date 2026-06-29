/**
 * Cross-Provider Semantic Clustering & Confidence Harmonization.
 *
 * Post-federation grouping layer that merges visually + semantically similar
 * candidates across providers before final presentation.
 *
 * Algorithm overview:
 *   1. Accept ranked candidates + `SemanticClusteringOptions`.
 *   2. Build a pairwise similarity matrix using:
 *        - pHash Hamming distance (converted to [0,1] similarity).
 *        - Title/author Levenshtein overlap (normalised to [0,1]).
 *        - Provider-confidence alignment (average confidence of the pair).
 *   3. Single-linkage clustering: greedily merge pairs that exceed the
 *      configured thresholds (OR-mode by default; AND-mode when
 *      `requireBothSignals` is true).
 *   4. Within each cluster pick the best representative (highest score,
 *      then best license rank) and list the rest as `alternatives`.
 *   5. Compute per-cluster `ClusterMetrics`:
 *        compositeConfidence = 0.4*pHashSim + 0.4*metaSim + 0.2*providerRank
 *   6. Return `ClusterGroup[]` sorted by representative score descending.
 *
 * Designed to be called from federation.ts when SearchOptions.clusterSimilar
 * is true, but is also independently importable for testing or custom pipelines.
 */

import { hammingDistance } from "./perceptual-hash.ts";
import { LICENSE_RANK } from "./license.ts";
import type {
  ClusterGroup,
  ClusterMetrics,
  ImageCandidate,
  SemanticClusteringOptions,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Bits in a 16-hex-char (64-bit) pHash. Used to normalise Hamming → [0,1]. */
const PHASH_BITS = 64;

/** Composite weight for pHash similarity. */
const W_PHASH = 0.4;
/** Composite weight for metadata (title/author) similarity. */
const W_META = 0.4;
/** Composite weight for provider-rank score. */
const W_PROVIDER = 0.2;

// ---------------------------------------------------------------------------
// Levenshtein distance (iterative, O(m*n))
// ---------------------------------------------------------------------------

/**
 * Compute the Levenshtein edit distance between two strings.
 * Returns 0 for identical strings; grows with the number of edits required.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Use two rows instead of full matrix.
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,          // insertion
        prev[j]! + 1,              // deletion
        prev[j - 1]! + cost,       // substitution
      );
    }
    // Swap rows.
    [prev, curr] = [curr, prev];
  }

  return prev[b.length]!;
}

/**
 * Normalised Levenshtein similarity in [0, 1].
 * Returns 1.0 for identical strings, 0.0 when they share no similarity.
 */
function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshtein(a, b) / maxLen;
}

// ---------------------------------------------------------------------------
// Per-pair signal computation
// ---------------------------------------------------------------------------

/**
 * pHash similarity in [0, 1].
 * 1.0 → identical hashes; 0.0 → maximally different (64 bits apart).
 * Returns null when either candidate lacks a pHash.
 */
function pHashSimilarity(a: ImageCandidate, b: ImageCandidate): number | null {
  if (!a.phash || !b.phash) return null;
  const dist = hammingDistance(a.phash, b.phash);
  return Math.max(0, 1 - dist / PHASH_BITS);
}

/**
 * Metadata similarity in [0, 1] — average of:
 *   - Normalised Levenshtein similarity of lowercased titles (when both present).
 *   - Normalised Levenshtein similarity of lowercased authors (when both present).
 *
 * Returns 0 when no metadata fields are available on either side.
 */
function metadataSimilarity(a: ImageCandidate, b: ImageCandidate): number {
  const signals: number[] = [];

  const titleA = (a.title ?? "").trim().toLowerCase();
  const titleB = (b.title ?? "").trim().toLowerCase();
  if (titleA.length > 0 && titleB.length > 0) {
    signals.push(levenshteinSimilarity(titleA, titleB));
  }

  const authorA = (a.author ?? "").trim().toLowerCase();
  const authorB = (b.author ?? "").trim().toLowerCase();
  if (authorA.length > 0 && authorB.length > 0) {
    signals.push(levenshteinSimilarity(authorA, authorB));
  }

  if (signals.length === 0) return 0;
  return signals.reduce((s, v) => s + v, 0) / signals.length;
}

/**
 * Provider-rank score for a single candidate.
 *
 * Uses the candidate's `confidence` field when present; otherwise derives a
 * proxy from the license rank (lower rank = more open = higher confidence).
 */
function providerRankScore(c: ImageCandidate): number {
  if (typeof c.confidence === "number") return Math.max(0, Math.min(1, c.confidence));
  const rank = LICENSE_RANK[c.license] ?? 99;
  // Invert: CC0 (rank 1) → 1.0; UNKNOWN (rank 99) → ~0.01.
  return Math.max(0, Math.min(1, 1 / rank));
}

/**
 * Average provider-rank score for a pair of candidates.
 */
function pairProviderRank(a: ImageCandidate, b: ImageCandidate): number {
  return (providerRankScore(a) + providerRankScore(b)) / 2;
}

// ---------------------------------------------------------------------------
// Threshold resolution
// ---------------------------------------------------------------------------

const DEFAULT_PHASH_THRESHOLD = 0.875; // ≈ Hamming distance ≤ 8 on 64-bit hash
const DEFAULT_META_THRESHOLD = 0.6;

function resolveThresholds(opts: SemanticClusteringOptions): {
  pHashThreshold: number;
  metaThreshold: number;
  requireBothSignals: boolean;
} {
  return {
    pHashThreshold: Math.max(0.7, Math.min(0.95, opts.pHashThreshold ?? DEFAULT_PHASH_THRESHOLD)),
    metaThreshold: Math.max(0, Math.min(1, opts.metaThreshold ?? DEFAULT_META_THRESHOLD)),
    requireBothSignals: opts.requireBothSignals ?? false,
  };
}

// ---------------------------------------------------------------------------
// Merge decision
// ---------------------------------------------------------------------------

interface PairSignals {
  phashSim: number | null;
  metaSim: number;
  providerRank: number;
}

/**
 * Decide whether a pair of candidates should be merged into the same cluster.
 *
 * In OR-mode (default):   merge when at least one signal exceeds its threshold.
 * In AND-mode:            merge only when both signals that have data exceed
 *                         their thresholds.  If pHash is unavailable, fall back
 *                         to metadata-only (so AND behaves as OR when only one
 *                         signal exists).
 */
function shouldMerge(
  signals: PairSignals,
  pHashThreshold: number,
  metaThreshold: number,
  requireBothSignals: boolean,
): boolean {
  const phashOk = signals.phashSim !== null && signals.phashSim >= pHashThreshold;
  const metaOk = signals.metaSim >= metaThreshold;

  if (requireBothSignals) {
    // AND-mode: both must pass (when both have data).
    if (signals.phashSim !== null) {
      return phashOk && metaOk;
    }
    // No pHash data — fall back to metadata alone.
    return metaOk;
  }

  // OR-mode: at least one signal is sufficient.
  return phashOk || metaOk;
}

// ---------------------------------------------------------------------------
// Cluster representative selection
// ---------------------------------------------------------------------------

/**
 * Pick the best representative from a group of candidates.
 * Priority: highest score → lowest LICENSE_RANK → earliest index.
 */
function pickRepresentative(members: ImageCandidate[]): number {
  let best = 0;
  for (let i = 1; i < members.length; i++) {
    const bScore = members[best]!.score ?? 0;
    const iScore = members[i]!.score ?? 0;
    if (iScore > bScore) { best = i; continue; }
    if (iScore < bScore) continue;
    // Tie-break by license rank (lower = more open = better).
    const bRank = LICENSE_RANK[members[best]!.license] ?? 99;
    const iRank = LICENSE_RANK[members[i]!.license] ?? 99;
    if (iRank < bRank) best = i;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Cluster metrics computation
// ---------------------------------------------------------------------------

/**
 * Compute ClusterMetrics for a group of candidates.
 *
 * For singletons (1 member) all similarity signals are 1.0 (perfect self-match)
 * and compositeConfidence reflects only the member's own provider-rank score.
 */
function computeClusterMetrics(members: ImageCandidate[]): ClusterMetrics {
  if (members.length === 1) {
    const pr = providerRankScore(members[0]!);
    // Single candidate: pHash and meta similarity are 1.0 (trivially identical
    // to itself); composite is dominated by the provider-rank term.
    const compositeConfidence = W_PHASH * 1.0 + W_META * 1.0 + W_PROVIDER * pr;
    return {
      pHashSimilarity: 1.0,
      metadataSimilarity: 1.0,
      providerRankScore: pr,
      compositeConfidence,
    };
  }

  // For multi-member clusters, compute pairwise averages.
  let pHashSum = 0;
  let pHashCount = 0;
  let metaSum = 0;
  let metaCount = 0;

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const ph = pHashSimilarity(members[i]!, members[j]!);
      if (ph !== null) {
        pHashSum += ph;
        pHashCount++;
      }

      const ms = metadataSimilarity(members[i]!, members[j]!);
      if (ms > 0) {
        metaSum += ms;
        metaCount++;
      }
    }
  }

  const avgPhash = pHashCount > 0 ? pHashSum / pHashCount : 0;
  const avgMeta = metaCount > 0 ? metaSum / metaCount : 0;

  // Provider-rank: average across all members.
  const avgProviderRank =
    members.reduce((s, c) => s + providerRankScore(c), 0) / members.length;

  const compositeConfidence =
    W_PHASH * avgPhash + W_META * avgMeta + W_PROVIDER * avgProviderRank;

  return {
    pHashSimilarity: avgPhash,
    metadataSimilarity: avgMeta,
    providerRankScore: avgProviderRank,
    compositeConfidence,
  };
}

// ---------------------------------------------------------------------------
// Single-linkage clustering (Union-Find)
// ---------------------------------------------------------------------------

/**
 * Cluster ranked candidates using single-linkage based on pHash + metadata
 * similarity signals.
 *
 * The input `candidates` array is expected to be **already ranked** (highest
 * score first). The output `ClusterGroup[]` preserves that ordering — groups
 * are sorted by their representative's score descending.
 *
 * Complexity: O(n²) pairwise comparisons.  For typical federation result sets
 * (n ≤ 200) this is negligible.
 */
export function clusterCandidates(
  candidates: ImageCandidate[],
  opts: SemanticClusteringOptions = {},
): ClusterGroup[] {
  if (candidates.length === 0) return [];
  if (candidates.length === 1) {
    const m = candidates[0]!;
    return [
      {
        representative: m,
        alternatives: [],
        clusterMetrics: computeClusterMetrics([m]),
        clusterAnnotation: "unique",
      },
    ];
  }

  const { pHashThreshold, metaThreshold, requireBothSignals } = resolveThresholds(opts);

  // Union-Find with path compression.
  const parent = candidates.map((_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!; // path halving
      x = parent[x]!;
    }
    return x;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  // Build similarity matrix and merge pairs that exceed thresholds.
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      // Skip if already in the same cluster.
      if (find(i) === find(j)) continue;

      const signals: PairSignals = {
        phashSim: pHashSimilarity(candidates[i]!, candidates[j]!),
        metaSim: metadataSimilarity(candidates[i]!, candidates[j]!),
        providerRank: pairProviderRank(candidates[i]!, candidates[j]!),
      };

      if (shouldMerge(signals, pHashThreshold, metaThreshold, requireBothSignals)) {
        union(i, j);
      }
    }
  }

  // Collect groups by root.
  const groupMap = new Map<number, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const root = find(i);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root)!.push(i);
  }

  // Build ClusterGroup for each root.
  const groups: ClusterGroup[] = [];

  for (const [, memberIndices] of groupMap) {
    const members = memberIndices.map((i) => candidates[i]!);
    const repIdx = pickRepresentative(members);
    const representative = members[repIdx]!;
    const alternatives = members.filter((_, i) => i !== repIdx);
    // Sort alternatives by score descending.
    alternatives.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const clusterMetrics = computeClusterMetrics(members);

    groups.push({
      representative,
      alternatives,
      clusterMetrics,
      clusterAnnotation: members.length > 1 ? "cluster" : "unique",
    });
  }

  // Sort groups by representative score descending to preserve ranked ordering.
  groups.sort((a, b) => (b.representative.score ?? 0) - (a.representative.score ?? 0));

  return groups;
}

// ---------------------------------------------------------------------------
// Re-exports for callers that want individual signal utilities
// ---------------------------------------------------------------------------

export {
  levenshteinSimilarity,
  pHashSimilarity,
  metadataSimilarity,
  providerRankScore,
  computeClusterMetrics,
};
