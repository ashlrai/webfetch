/**
 * Semantic Deduplication via pHash Distance Matrix + Agglomerative Clustering.
 *
 * This module extends the existing dedupe layer with a description-aware
 * clustering approach that works across providers:
 *
 *   1. Extract alt-text / title descriptions from each `ImageCandidate`.
 *   2. Compute a pairwise Hamming distance matrix for all candidates with pHashes.
 *   3. Run agglomerative clustering (average-linkage) with a Hamming threshold of 8
 *      (≈85% similarity on a 64-bit hash) to form clusters.
 *   4. For each cluster elect a centroid candidate: highest pHash confidence first,
 *      then best license rank (lowest LICENSE_RANK value).
 *   5. Merge alternate URLs and metadata from all cluster members into the centroid.
 *
 * The result is one representative `SemanticDedupeCandidate` per unique visual,
 * with `alternateUrls` tracking every duplicate URL+source found across providers.
 */

import { LICENSE_RANK } from "./license.ts";
import { hammingDistance } from "./perceptual-hash.ts";
import type { ImageCandidate, License } from "./types.ts";

/**
 * A single alternate source for a deduplicated image.
 * Tracks all non-centroid occurrences of the same visual across providers.
 */
export interface AlternateUrl {
  /** The non-canonical URL for this visual. */
  url: string;
  /** The provider that returned this URL. */
  source: string;
  /** The license reported by this provider. */
  license: License;
  /** The license confidence (0..1) for this alternate. */
  confidence: number;
}

/**
 * An `ImageCandidate` enriched with semantic-dedupe metadata.
 * The centroid of each `SemanticDedupeCluster` has this shape.
 */
export interface SemanticDedupeCandidate extends ImageCandidate {
  /** All alternate URLs for this visual (from duplicate cluster members). Empty for singletons. */
  alternateUrls: AlternateUrl[];
  /** The description extracted from this candidate (alt-text or title). Empty string when none. */
  description: string;
  /**
   * Confidence decay applied to this candidate as a result of being a cluster
   * centroid where some members had UNKNOWN licenses (0..1; 1 = no decay).
   */
  confidenceDecay: number;
}

/** A cluster produced by `clusterCandidatesBySemantic()`. */
export interface SemanticDedupeCluster {
  centroid: SemanticDedupeCandidate;
  alternateUrls: AlternateUrl[];
  clusterSize: number;
  avgHamming: number;
  description: string;
}

/** Result returned by `clusterCandidatesBySemantic()`. */
export interface SemanticDedupeResult {
  clusters: SemanticDedupeCluster[];
  singletons: SemanticDedupeCandidate[];
  allRepresentatives: SemanticDedupeCandidate[];
}

/** Options for `clusterCandidatesBySemantic()`. */
export interface SemanticDedupeOptions {
  /**
   * Maximum Hamming distance (inclusive) to merge two candidates into the same
   * cluster. Default: 8 (≈ 87.5% similar on a 64-bit hash). Range 1–32 (clamped).
   */
  hammingThreshold?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const UNKNOWN_RANK = 99;

/** pHash algorithm confidence: dct-phash → 1.0, ahash-fallback → 0.5, none → 0. */
function phashConfidence(c: ImageCandidate): number {
  if (c.phashResult) return c.phashResult.confidence;
  if (c.phashAlgorithm === "dct-phash") return 1.0;
  if (c.phashAlgorithm === "ahash-fallback") return 0.5;
  if (c.phash) return 0.5;
  return 0;
}

function licenseRank(c: ImageCandidate): number {
  return LICENSE_RANK[c.license] ?? UNKNOWN_RANK;
}

/**
 * Extract a human-readable description from an `ImageCandidate`.
 * Priority: `title` > `attributionLine` > empty string.
 * The stored description preserves the original casing from `title`.
 */
export function extractDescription(c: ImageCandidate): string {
  if (c.title?.trim()) return c.title.trim();
  if (c.attributionLine?.trim()) return c.attributionLine.trim();
  return "";
}

/**
 * Build a compact upper-triangular Hamming distance matrix for all candidates
 * that have a pHash. Returns a flat map `(i, j) → distance` for i < j, keyed as
 * `${i},${j}`. Only pairs where both candidates have a pHash are stored.
 */
export function buildHammingMatrix(candidates: ImageCandidate[]): Map<string, number> {
  const matrix = new Map<string, number>();
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i]!;
    if (!a.phash) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j]!;
      if (!b.phash) continue;
      matrix.set(`${i},${j}`, hammingDistance(a.phash, b.phash));
    }
  }
  return matrix;
}

/** Look up a pairwise distance from the matrix (order-independent). */
function matrixDistance(matrix: Map<string, number>, i: number, j: number): number | undefined {
  if (i === j) return 0;
  const [lo, hi] = i < j ? [i, j] : [j, i];
  return matrix.get(`${lo},${hi}`);
}

/**
 * Run agglomerative average-linkage clustering on `candidates` using the
 * precomputed `matrix`. Two candidates are eligible for merging when their
 * Hamming distance is ≤ `threshold`. Candidates without pHashes are always
 * singletons. Returns an array of clusters, each a Set of candidate indices.
 */
export function agglomerativeCluster(
  candidates: ImageCandidate[],
  matrix: Map<string, number>,
  threshold: number,
): Set<number>[] {
  // Start with N singleton clusters.
  let clusters: Set<number>[] = candidates.map((_, i) => new Set([i]));

  // Average inter-cluster distance; Infinity if any pair lacks a pHash distance.
  const avgDistance = (a: Set<number>, b: Set<number>): number => {
    let sum = 0;
    let count = 0;
    for (const i of a) {
      for (const j of b) {
        const d = matrixDistance(matrix, i, j);
        if (d === undefined) return Number.POSITIVE_INFINITY;
        sum += d;
        count++;
      }
    }
    return count > 0 ? sum / count : Number.POSITIVE_INFINITY;
  };

  // Iteratively merge the closest pair while it is within threshold.
  for (;;) {
    let bestI = -1;
    let bestJ = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = avgDistance(clusters[i]!, clusters[j]!);
        if (d <= threshold && d < bestDist) {
          bestDist = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestI === -1) break;
    const merged = new Set<number>([...clusters[bestI]!, ...clusters[bestJ]!]);
    clusters = clusters.filter((_, idx) => idx !== bestI && idx !== bestJ);
    clusters.push(merged);
  }

  return clusters;
}

/**
 * Select the centroid index from a cluster of candidates.
 * Priority: highest pHash confidence → best (lowest) license rank → highest
 * composite score → earliest index (stable tie-break).
 */
export function selectCentroid(members: ImageCandidate[]): number {
  let bestIdx = 0;
  for (let i = 1; i < members.length; i++) {
    const cur = members[i]!;
    const best = members[bestIdx]!;
    const curConf = phashConfidence(cur);
    const bestConf = phashConfidence(best);
    if (curConf !== bestConf) {
      if (curConf > bestConf) bestIdx = i;
      continue;
    }
    const curRank = licenseRank(cur);
    const bestRank = licenseRank(best);
    if (curRank !== bestRank) {
      if (curRank < bestRank) bestIdx = i;
      continue;
    }
    if ((cur.score ?? 0) > (best.score ?? 0)) bestIdx = i;
  }
  return bestIdx;
}

/** Average pairwise Hamming distance within a set of cluster members. */
function avgIntraHamming(members: ImageCandidate[]): number {
  let sum = 0;
  let count = 0;
  const hashed = members.filter((m) => m.phash);
  for (let i = 0; i < hashed.length; i++) {
    for (let j = i + 1; j < hashed.length; j++) {
      sum += hammingDistance(hashed[i]!.phash!, hashed[j]!.phash!);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Confidence decay for a centroid whose cluster mixes UNKNOWN-license members
 * with known-license members. decay = 1 - unknownFraction × 0.25, applied only
 * when the cluster contains both known and UNKNOWN members. Pure clusters → 1.
 */
function unknownMixDecay(members: ImageCandidate[]): number {
  if (members.length <= 1) return 1;
  const unknown = members.filter((m) => licenseRank(m) >= UNKNOWN_RANK).length;
  const known = members.length - unknown;
  if (known === 0 || unknown === 0) return 1;
  return Math.max(0, 1 - (unknown / members.length) * 0.25);
}

function toCandidate(
  base: ImageCandidate,
  alternateUrls: AlternateUrl[],
  description: string,
  confidenceDecay: number,
): SemanticDedupeCandidate {
  return { ...base, alternateUrls, description, confidenceDecay };
}

// ---------------------------------------------------------------------------
// Main entry-point
// ---------------------------------------------------------------------------

/**
 * Cluster `ImageCandidate[]` by pHash Hamming distance using agglomerative
 * average-linkage clustering. For each cluster a centroid is elected (highest
 * pHash confidence, then best license rank); all other members' URLs are
 * recorded as `alternateUrls`. Candidates without a pHash are singletons.
 */
export function clusterCandidatesBySemantic(
  candidates: ImageCandidate[],
  opts: SemanticDedupeOptions = {},
): SemanticDedupeResult {
  const threshold = Math.max(1, Math.min(32, opts.hammingThreshold ?? 8));

  if (candidates.length === 0) {
    return { clusters: [], singletons: [], allRepresentatives: [] };
  }

  const matrix = buildHammingMatrix(candidates);
  const indexClusters = agglomerativeCluster(candidates, matrix, threshold);

  const clusters: SemanticDedupeCluster[] = [];
  const singletons: SemanticDedupeCandidate[] = [];

  for (const idxSet of indexClusters) {
    const indices = [...idxSet];
    const members = indices.map((i) => candidates[i]!);

    if (members.length === 1) {
      const c = members[0]!;
      singletons.push(toCandidate(c, [], extractDescription(c), 1));
      continue;
    }

    const centroidLocal = selectCentroid(members);
    const centroidCand = members[centroidLocal]!;
    const others = members.filter((_, i) => i !== centroidLocal);

    const alternateUrls: AlternateUrl[] = others.map((m) => ({
      url: m.url,
      source: m.source,
      license: m.license,
      confidence: m.confidence ?? 0,
    }));

    const decay = unknownMixDecay(members);
    const description =
      extractDescription(centroidCand) || members.map(extractDescription).find((d) => d) || "";

    const centroid = toCandidate(centroidCand, alternateUrls, description, decay);

    clusters.push({
      centroid,
      alternateUrls,
      clusterSize: members.length,
      avgHamming: avgIntraHamming(members),
      description,
    });
  }

  // allRepresentatives: centroids + singletons, sorted by original score desc.
  const allRepresentatives = [...clusters.map((c) => c.centroid), ...singletons].sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0),
  );

  return { clusters, singletons, allRepresentatives };
}
