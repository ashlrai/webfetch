/**
 * Batch Similarity Clustering with Confidence-Weighted Hamming Distance Ranking.
 *
 * Accepts an array of ImageCandidate[] (post-search or post-reverse-image-search)
 * and returns deduplicated clusters grouped by perceptual similarity
 * (Hamming distance ≤ threshold) with confidence-weighted scoring.
 *
 * Algorithm:
 *   1. For each candidate missing a pHash, compute it via perceptualHashStructured().
 *   2. Skip candidates with phashResult.confidence < MIN_CONFIDENCE (0.3).
 *   3. Build pairwise Hamming distance matrix using batchHammingDistances().
 *   4. Cluster using single-linkage Union-Find: connect when dist ≤ hammingThreshold.
 *   5. Within each cluster, rank by: license rank → confidence → resolution → provider priority.
 *   6. Optionally apply confidence decay (0.02 per elapsed hour) to stale cached results.
 *   7. Return clusters + aggregate metrics.
 */

import { perceptualHashStructured, batchHammingDistances } from "./perceptual-hash.ts";
import { LICENSE_RANK } from "./license.ts";
import type { ImageCandidate, PerceptualHashResult, ProviderId } from "./types.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum phashResult.confidence to include a candidate in clustering. */
const MIN_CONFIDENCE = 0.3;

/** Default Hamming distance threshold (≤ 10 = near-duplicate on 64-bit hash). */
const DEFAULT_HAMMING_THRESHOLD = 10;

/** Default minimum cluster size to include in output (1 = include singletons). */
const DEFAULT_MIN_CLUSTER_SIZE = 1;

/** Confidence decay rate per hour for stale cached results. */
const DECAY_PER_HOUR = 0.02;

/** Provider priority list — lower index wins when ranking within a cluster. */
const PROVIDER_PRIORITY: readonly string[] = [
  "wikimedia",
  "openverse",
  "unsplash",
  "pexels",
  "pixabay",
  "flickr",
  "internet-archive",
  "smithsonian",
  "nasa",
  "met-museum",
  "europeana",
  "library-of-congress",
  "wellcome-collection",
  "rawpixel",
  "burst",
  "europeana-archival",
  "musicbrainz-caa",
  "itunes",
  "spotify",
  "youtube-thumb",
  "brave",
  "serpapi",
  "bing",
  "browser",
  "managed-browser",
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single cluster of perceptually-similar candidates. */
export interface ClusterGroup {
  /**
   * The best-ranked candidate in the cluster.
   * Ranking priority: license rank → confidence → resolution (w*h) → provider priority.
   */
  representative: ImageCandidate;
  /** All other members, ranked the same way (representative excluded). */
  alternatives: ImageCandidate[];
  /** Number of members including the representative. */
  size: number;
  /** Average Hamming distance between all pairs in the cluster (0 = all identical). */
  avgIntraDistance: number;
  /** The maximum confidence-weighted score among all members (post-decay if enabled). */
  topScore: number;
}

/** Aggregate metrics across all clusters. */
export interface BatchClusterMetrics {
  /** Mean cluster size across non-discarded clusters. */
  avgClusterSize: number;
  /** Number of clusters with only one member (singletons). */
  lonelyCount: number;
  /** Number of candidates skipped due to low confidence or missing hash. */
  discardedCount: number;
}

/** Full result returned by `batchClusterByPhash`. */
export interface BatchPhashClusterResult {
  /** Deduplicated clusters sorted by topScore descending. */
  clusters: ClusterGroup[];
  /** Aggregate cluster metrics. */
  clusterMetrics: BatchClusterMetrics;
  /**
   * Fraction of input candidates that were collapsed into a cluster with
   * another candidate (i.e. not singletons). Range 0..1.
   * 0 = no deduplication; 1 = all candidates are duplicates.
   */
  dedupeRate: number;
}

/** Options for `batchClusterByPhash`. */
export interface BatchPhashClusterOptions {
  /**
   * Maximum Hamming distance (inclusive) to consider two images visually
   * similar enough to cluster together. Default: 10.
   * Range: 0 (exact only) – 64 (anything).
   */
  hammingThreshold?: number;
  /**
   * Minimum cluster size to include in the output.
   * Clusters smaller than this are still counted in `clusterMetrics.lonelyCount`
   * but excluded from `clusters`. Default: 1 (include all).
   */
  minClusterSize?: number;
  /**
   * When true, apply a small temporal confidence decay (0.02 per hour) to
   * candidates that carry a `_cachedAt` timestamp on their `raw` field so that
   * fresher provider results rank above stale ones within the same cluster.
   * Default: false.
   */
  confidenceDecay?: boolean;
  /** Injectable fetch implementation for pHash computation when bytes must be downloaded. */
  fetcher?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function providerPriority(source: string): number {
  const idx = PROVIDER_PRIORITY.indexOf(source);
  return idx === -1 ? PROVIDER_PRIORITY.length : idx;
}

/**
 * Compute a confidence-weighted score for ranking within a cluster.
 * Higher = better.
 *   - Base: phashResult.confidence (0..1), or candidate.confidence, or 0.5 fallback.
 *   - License factor: inverse of LICENSE_RANK (CC0 → 1.0, UNKNOWN → ~0.01).
 *   - Resolution bonus: ln(1 + w*h) / ln(1 + 4e7)  — adds up to ~0.1 extra for large images.
 *   - Provider penalty: providerPriority / PROVIDER_PRIORITY.length (lower priority → smaller penalty).
 */
function candidateScore(c: ImageCandidate, decayedConfidence?: number): number {
  const conf =
    decayedConfidence ??
    c.phashResult?.confidence ??
    c.confidence ??
    0.5;

  const licenseRank = LICENSE_RANK[c.license] ?? 99;
  const licenseFactor = Math.max(0, Math.min(1, 1 / licenseRank));

  const pixels = (c.width ?? 0) * (c.height ?? 0);
  const resolutionBonus = pixels > 0
    ? Math.log1p(pixels) / Math.log1p(4e7) * 0.1
    : 0;

  const providerPenalty = providerPriority(c.source) / PROVIDER_PRIORITY.length * 0.05;

  return conf * 0.5 + licenseFactor * 0.4 + resolutionBonus - providerPenalty;
}

/**
 * Apply confidence decay to a candidate's effective confidence.
 * Reads `(c.raw as any)?._cachedAt` as an ISO timestamp or epoch-ms number.
 * Returns the raw phashResult.confidence (or candidate.confidence) unchanged
 * if no timestamp is found or confidenceDecay is false.
 */
function effectiveConfidence(c: ImageCandidate, confidenceDecay: boolean): number | undefined {
  const base = c.phashResult?.confidence ?? c.confidence;
  if (!confidenceDecay || base === undefined) return base;

  const raw = c.raw as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return base;

  const cachedAt = raw["_cachedAt"];
  if (!cachedAt) return base;

  const ts = typeof cachedAt === "number"
    ? cachedAt
    : typeof cachedAt === "string"
    ? Date.parse(cachedAt)
    : NaN;

  if (isNaN(ts)) return base;

  const elapsedHours = (Date.now() - ts) / 3_600_000;
  if (elapsedHours <= 0) return base;

  return Math.max(0, base - DECAY_PER_HOUR * elapsedHours);
}

// ---------------------------------------------------------------------------
// Union-Find
// ---------------------------------------------------------------------------

function makeUnionFind(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array<number>(n).fill(0);

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
    if (ra === rb) return;
    if (rank[ra]! < rank[rb]!) {
      parent[ra] = rb;
    } else if (rank[ra]! > rank[rb]!) {
      parent[rb] = ra;
    } else {
      parent[rb] = ra;
      rank[ra]!;
      rank[ra] = rank[ra]! + 1;
    }
  }

  return { find, union };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Cluster an array of `ImageCandidate[]` by perceptual similarity.
 *
 * Computes pHash for any candidate that is missing one, filters out low-confidence
 * hashes, then groups candidates into clusters using single-linkage clustering
 * (connect two candidates when their Hamming distance ≤ `hammingThreshold`).
 *
 * Within each cluster the best candidate is promoted to `representative`; the
 * rest become `alternatives`. Both lists are sorted by a composite
 * license × confidence × resolution × provider score (descending).
 *
 * @param candidates  Input image candidates (mutated in-place only to add pHash fields).
 * @param options     Clustering options.
 * @returns           `{ clusters, clusterMetrics, dedupeRate }`.
 */
export async function batchClusterByPhash(
  candidates: ImageCandidate[],
  options: BatchPhashClusterOptions = {},
): Promise<BatchPhashClusterResult> {
  const hammingThreshold = Math.max(
    0,
    Math.min(64, options.hammingThreshold ?? DEFAULT_HAMMING_THRESHOLD),
  );
  const minClusterSize = Math.max(1, options.minClusterSize ?? DEFAULT_MIN_CLUSTER_SIZE);
  const confidenceDecay = options.confidenceDecay ?? false;

  if (candidates.length === 0) {
    return {
      clusters: [],
      clusterMetrics: { avgClusterSize: 0, lonelyCount: 0, discardedCount: 0 },
      dedupeRate: 0,
    };
  }

  // ---- Step 1: ensure pHash for all candidates --------------------------------
  // We compute hashes in parallel where possible. For candidates that already
  // have phash/phashResult we skip the download.
  const hashPromises = candidates.map(async (c) => {
    if (c.phash && c.phashResult) return; // already have structured result

    // If there is only a bare phash string, synthesise a phashResult.
    if (c.phash && !c.phashResult) {
      c.phashResult = {
        hash: c.phash,
        algorithm: (c.phashAlgorithm as PerceptualHashResult["algorithm"]) ?? "ahash-fallback",
        confidence: c.phashAlgorithm === "dct-phash" ? 1.0 : 0.5,
      };
      return;
    }

    // No hash at all — try to compute from bytes embedded in `raw`, or skip.
    const raw = c.raw as Record<string, unknown> | undefined;
    const embeddedBytes = raw?.["bytes"];
    if (embeddedBytes instanceof Uint8Array) {
      try {
        const result = await perceptualHashStructured(embeddedBytes);
        c.phash = result.hash;
        c.phashResult = result;
        c.phashAlgorithm = result.algorithm;
      } catch {
        // leave without hash — will be discarded below
      }
    }
    // If no bytes available, candidate has no hash and will be filtered out.
  });

  await Promise.all(hashPromises);

  // ---- Step 2: split into active (hashable, sufficient confidence) vs discarded ----
  const active: Array<{ candidate: ImageCandidate; index: number }> = [];
  let discardedCount = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const conf = c.phashResult?.confidence ?? 0;
    if (!c.phash || conf < MIN_CONFIDENCE) {
      discardedCount++;
      continue;
    }
    active.push({ candidate: c, index: i });
  }

  if (active.length === 0) {
    return {
      clusters: [],
      clusterMetrics: {
        avgClusterSize: 0,
        lonelyCount: 0,
        discardedCount,
      },
      dedupeRate: 0,
    };
  }

  // ---- Step 3: build Hamming distance matrix (single-pass batch) ---------------
  const hashes = active.map((a) => a.candidate.phash!);

  // distMatrix[i][j] = Hamming distance between active[i] and active[j].
  // We only need upper triangle; we build it lazily using batchHammingDistances.
  const distMatrix: number[][] = hashes.map((ref) => batchHammingDistances(ref, hashes));

  // ---- Step 4: single-linkage Union-Find clustering ----------------------------
  const uf = makeUnionFind(active.length);

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      if (distMatrix[i]![j]! <= hammingThreshold) {
        uf.union(i, j);
      }
    }
  }

  // Collect groups.
  const groupMap = new Map<number, number[]>();
  for (let i = 0; i < active.length; i++) {
    const root = uf.find(i);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root)!.push(i);
  }

  // ---- Step 5: build ClusterGroup for each group --------------------------------
  const allClusters: ClusterGroup[] = [];
  let lonelyCount = 0;
  let totalActiveMembersInMultiClusters = 0;

  for (const [, memberIdxs] of groupMap) {
    const members = memberIdxs.map((i) => active[i]!.candidate);
    const isLonely = members.length < 2;

    if (isLonely) lonelyCount++;
    else totalActiveMembersInMultiClusters += members.length;

    // Compute decayed confidences.
    const decayedConf = members.map((m) => effectiveConfidence(m, confidenceDecay));

    // Score each member.
    const scored = members.map((m, i) => ({
      candidate: m,
      score: candidateScore(m, decayedConf[i]),
    }));

    // Sort descending by score.
    scored.sort((a, b) => b.score - a.score);

    // Compute average intra-cluster Hamming distance.
    let distSum = 0;
    let distPairs = 0;
    for (let i = 0; i < memberIdxs.length; i++) {
      for (let j = i + 1; j < memberIdxs.length; j++) {
        distSum += distMatrix[memberIdxs[i]!]![memberIdxs[j]!]!;
        distPairs++;
      }
    }
    const avgIntraDistance = distPairs > 0 ? distSum / distPairs : 0;

    const topScore = scored[0]?.score ?? 0;
    const representative = scored[0]!.candidate;
    const alternatives = scored.slice(1).map((s) => s.candidate);

    if (members.length >= minClusterSize) {
      allClusters.push({
        representative,
        alternatives,
        size: members.length,
        avgIntraDistance,
        topScore,
      });
    }
  }

  // Sort clusters: multi-member first, then by topScore descending.
  allClusters.sort((a, b) => {
    if (a.size !== b.size) return b.size - a.size;
    return b.topScore - a.topScore;
  });

  // ---- Step 6: compute aggregate metrics ---------------------------------------
  const totalClusters = groupMap.size;
  const avgClusterSize = totalClusters > 0 ? active.length / totalClusters : 0;
  const dedupeRate = active.length > 0
    ? totalActiveMembersInMultiClusters / active.length
    : 0;

  return {
    clusters: allClusters,
    clusterMetrics: {
      avgClusterSize,
      lonelyCount,
      discardedCount,
    },
    dedupeRate,
  };
}
