/**
 * pHash Analytics & Diagnostics Dashboard.
 *
 * Real-time Hamming distance metrics, percentile queries, and per-algorithm
 * quality classification for perceptual hash result sets.
 *
 * Three primary entry points:
 *
 *   1. `analyzeHashSimilarity(candidates)`
 *      Returns avg Hamming distance, a 5-bucket histogram, median, stdDev,
 *      and confidence-weighted stats across all pairwise combinations.
 *
 *   2. `percentileSimilarity(reference, candidates, percentile)`
 *      Returns the Nth-percentile Hamming distance from a reference hash to a
 *      ranked candidate set (e.g., "find candidates within 85th-percentile
 *      similarity").
 *
 *   3. `hashQualityReport(candidates)`
 *      Classifies candidates per-algorithm (dct-phash vs ahash-fallback) and
 *      returns a confidence-distribution breakdown.
 *
 * Convenience re-export:
 *
 *   `computeHashMetrics(bundle)` — profiles an entire SearchResultBundle,
 *   returning the similarity analysis, quality report, and any diagnostics
 *   useful for pre-ranking quality checks.
 *
 * All functions are pure and synchronous — no I/O.
 */

import { hammingDistance } from "./perceptual-hash.ts";
import type { ImageCandidate, License, PerceptualHashResult } from "./types.ts";

// ---------------------------------------------------------------------------
// Histogram bucket labels — 5 bands matching the spec
// ---------------------------------------------------------------------------

/**
 * Five Hamming-distance bands for the `analyzeHashSimilarity` histogram.
 *
 *   Bucket 0: [0,  8]   — exact or near-duplicate
 *   Bucket 1: [9,  16]  — similar
 *   Bucket 2: [17, 24]  — loosely related
 *   Bucket 3: [25, 32]  — weakly related
 *   Bucket 4: [33, 64]  — dissimilar / unrelated
 */
export type HashHistogramBucket = 0 | 1 | 2 | 3 | 4;

/** Human-readable labels for each histogram bucket. */
export const HISTOGRAM_BUCKET_LABELS: readonly string[] = [
  "0–8 (exact/near-duplicate)",
  "9–16 (similar)",
  "17–24 (loosely related)",
  "25–32 (weakly related)",
  "33+ (dissimilar)",
];

/** Bucket boundaries (upper-inclusive): distances ≤ boundary fall in that bucket. */
const BUCKET_BOUNDARIES = [8, 16, 24, 32] as const;

/** Assign a Hamming distance to a histogram bucket index (0–4). */
function bucketIndex(d: number): HashHistogramBucket {
  if (d <= 8) return 0;
  if (d <= 16) return 1;
  if (d <= 24) return 2;
  if (d <= 32) return 3;
  return 4;
}

// ---------------------------------------------------------------------------
// Public types — analyzeHashSimilarity
// ---------------------------------------------------------------------------

/**
 * Pairwise Hamming-distance summary for a candidate set.
 *
 * All distance values are in [0, 64] (64-bit hash).
 * `histogram` has exactly 5 entries mapping to the bands above.
 * `confidence` is a weighted mean where each candidate's contribution is
 * scaled by its `phashResult.confidence` (or 0.5 when only a bare hash is
 * present). Range [0, 1].
 */
export interface HashSimilarityAnalysis {
  /** Number of candidates included (candidates with no hash are skipped). */
  candidateCount: number;
  /** Total pairwise comparisons performed: candidateCount * (candidateCount-1) / 2 */
  pairCount: number;
  /** Arithmetic mean of all pairwise Hamming distances (0 when pairCount=0). */
  avgHammingDistance: number;
  /** Median pairwise Hamming distance (0 when pairCount=0). */
  medianDistance: number;
  /** Population standard deviation of pairwise Hamming distances (0 when pairCount<=1). */
  stdDev: number;
  /**
   * 5-bucket histogram of pairwise distances.
   * Indices map to: [0–8, 9–16, 17–24, 25–32, 33+].
   * Length is always 5.
   */
  histogram: [number, number, number, number, number];
  /**
   * Confidence-weighted mean Hamming distance.
   * Each pairwise distance is weighted by the geometric mean of the two
   * candidates' confidence scores. 0 when pairCount=0.
   */
  confidenceWeightedAvg: number;
  /**
   * Average confidence across all included candidates (0..1).
   * Uses phashResult.confidence when available, falls back to 0.5 for bare hashes.
   */
  avgConfidence: number;
  /**
   * Minimum pairwise distance observed (Infinity → 0 when pairCount=0).
   */
  minDistance: number;
  /**
   * Maximum pairwise distance observed (0 when pairCount=0).
   */
  maxDistance: number;
}

// ---------------------------------------------------------------------------
// Public types — percentileSimilarity
// ---------------------------------------------------------------------------

/**
 * Result of `percentileSimilarity`.
 *
 * Candidates are ranked ascending by Hamming distance from the reference.
 * The Nth-percentile candidate is the one at position `floor(N * n)` in
 * that ranked list (nearest-rank method, same as `hammingPercentile`).
 */
export interface PercentileSimilarityResult {
  /**
   * The Hamming distance at the requested percentile (0 when no candidates).
   */
  percentileDistance: number;
  /**
   * The candidate at the Nth percentile (null when candidates is empty).
   */
  candidateAtPercentile: ImageCandidate | null;
  /**
   * Full sorted list — ascending by distance from `reference`.
   * Each entry carries the candidate + its computed distance.
   */
  rankedCandidates: Array<{
    candidate: ImageCandidate;
    distance: number;
    confidence: number;
  }>;
  /**
   * Percentile value that was actually used (clamped to [0, 1]).
   */
  percentile: number;
}

// ---------------------------------------------------------------------------
// Public types — hashQualityReport
// ---------------------------------------------------------------------------

/**
 * Per-algorithm bucket in `HashQualityReport.algorithmBreakdown`.
 */
export interface AlgorithmBucket {
  /** Number of candidates using this algorithm. */
  count: number;
  /** Fraction of total hashed candidates using this algorithm (0..1). */
  fraction: number;
  /** Mean confidence across candidates using this algorithm (0 when count=0). */
  meanConfidence: number;
  /** Min confidence (0 when count=0). */
  minConfidence: number;
  /** Max confidence (0 when count=0). */
  maxConfidence: number;
  /** Standard deviation of confidence values (0 when count<=1). */
  stdDev: number;
}

/**
 * Distribution of candidates across confidence tiers.
 *
 * Tiers:
 *   - `high`   — confidence >= 0.85
 *   - `medium` — 0.5 <= confidence < 0.85
 *   - `low`    — confidence < 0.5
 */
export interface ConfidenceTierBreakdown {
  /** Number of candidates with confidence >= 0.85. */
  high: number;
  /** Number of candidates with 0.5 <= confidence < 0.85. */
  medium: number;
  /** Number of candidates with confidence < 0.5. */
  low: number;
}

/**
 * Full quality report returned by `hashQualityReport`.
 */
export interface HashQualityReport {
  /** Total candidates passed in. */
  totalCandidates: number;
  /** Candidates that have a hash (phash or phashResult). */
  hashedCount: number;
  /** Candidates without any hash. */
  unhashedCount: number;
  /** Per-algorithm breakdown. */
  algorithmBreakdown: {
    "dct-phash": AlgorithmBucket;
    "ahash-fallback": AlgorithmBucket;
    /**
     * Bare hash candidates — have `phash` but no `phashResult` or `phashAlgorithm`.
     * Treated as ahash-fallback with confidence 0.5 for analytics purposes.
     */
    "bare-hash": AlgorithmBucket;
  };
  /** Distribution across confidence tiers. */
  confidenceTiers: ConfidenceTierBreakdown;
  /** Mean confidence across all hashed candidates (0..1). */
  overallMeanConfidence: number;
  /** Population stdDev of confidence values (0 when hashedCount<=1). */
  overallStdDev: number;
  /**
   * Qualitative readiness verdict:
   * - `'ready'`      — > 80% high-confidence, all hashed
   * - `'acceptable'` — > 50% medium+high confidence
   * - `'degraded'`   — > 30% low confidence or > 20% unhashed
   * - `'unusable'`   — > 60% low confidence or > 50% unhashed
   */
  verdict: "ready" | "acceptable" | "degraded" | "unusable";
}

// ---------------------------------------------------------------------------
// Public types — computeHashMetrics (bundle-level)
// ---------------------------------------------------------------------------

/**
 * Combined metrics returned by `computeHashMetrics`.
 * Designed to be called on a `SearchResultBundle.candidates` list before ranking.
 */
export interface HashMetrics {
  /** Pairwise similarity analysis across all candidates. */
  similarity: HashSimilarityAnalysis;
  /** Per-algorithm quality report. */
  quality: HashQualityReport;
  /**
   * Top-5 most similar candidate pairs (lowest Hamming distance).
   * Useful for quick dedup previews. Empty when candidateCount < 2.
   */
  topSimilarPairs: Array<{
    indexA: number;
    indexB: number;
    distance: number;
    hashA: string;
    hashB: string;
  }>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface HashObs {
  hash: string;
  confidence: number;
  algorithm: "dct-phash" | "ahash-fallback" | "bare-hash";
  candidateIndex: number;
}

/**
 * Extract hash observations from an array of ImageCandidate objects.
 * Candidates without any hash data are excluded.
 */
function extractObservations(candidates: ImageCandidate[]): HashObs[] {
  const obs: HashObs[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (c.phashResult) {
      obs.push({
        hash: c.phashResult.hash,
        confidence: c.phashResult.confidence,
        algorithm: c.phashResult.algorithm,
        candidateIndex: i,
      });
    } else if (c.phashAlgorithm && c.phash) {
      const conf = c.phashAlgorithm === "dct-phash" ? 1.0 : 0.5;
      obs.push({
        hash: c.phash,
        confidence: conf,
        algorithm: c.phashAlgorithm,
        candidateIndex: i,
      });
    } else if (c.phash) {
      obs.push({
        hash: c.phash,
        confidence: 0.5,
        algorithm: "bare-hash",
        candidateIndex: i,
      });
    }
  }
  return obs;
}

/** Extract hash from a PerceptualHashResult, bare string, or return null. */
function resolveHash(r: PerceptualHashResult): string {
  return r.hash;
}

/** Population std dev of a numeric array. Returns 0 when length <= 1. */
function popStdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Median of a numeric array (unsorted input). Returns 0 for empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// ---------------------------------------------------------------------------
// 1. analyzeHashSimilarity
// ---------------------------------------------------------------------------

/**
 * Compute pairwise Hamming-distance statistics for a set of candidates.
 *
 * Only candidates that have a hash (via `phashResult`, `phashAlgorithm`, or
 * bare `phash`) are included. Candidates without any hash data are skipped.
 *
 * When fewer than 2 hashable candidates are present, returns a zero-state
 * result without throwing.
 *
 * @param candidates  Array of `ImageCandidate` objects from a search or
 *                    federation run.
 * @returns           `HashSimilarityAnalysis` — safe to serialize as JSON.
 *
 * @example
 * ```ts
 * const analysis = analyzeHashSimilarity(bundle.candidates);
 * console.log(analysis.avgHammingDistance); // e.g. 14.3
 * ```
 */
export function analyzeHashSimilarity(
  candidates: ImageCandidate[],
): HashSimilarityAnalysis {
  const obs = extractObservations(candidates);

  const zeroBuckets: [number, number, number, number, number] = [0, 0, 0, 0, 0];

  if (obs.length < 2) {
    const avgConfidence =
      obs.length === 1 ? obs[0]!.confidence : 0;
    return {
      candidateCount: obs.length,
      pairCount: 0,
      avgHammingDistance: 0,
      medianDistance: 0,
      stdDev: 0,
      histogram: zeroBuckets,
      confidenceWeightedAvg: 0,
      avgConfidence,
      minDistance: 0,
      maxDistance: 0,
    };
  }

  // Compute all pairwise distances.
  const distances: number[] = [];
  const weights: number[] = [];
  const histogram: [number, number, number, number, number] = [0, 0, 0, 0, 0];

  // Track top-similarity pairs for later use (not exposed here but computed for efficiency)
  for (let i = 0; i < obs.length; i++) {
    for (let j = i + 1; j < obs.length; j++) {
      const d = hammingDistance(obs[i]!.hash, obs[j]!.hash);
      const w = Math.sqrt(obs[i]!.confidence * obs[j]!.confidence);
      distances.push(d);
      weights.push(w);
      histogram[bucketIndex(d)]++;
    }
  }

  const n = distances.length;
  const sum = distances.reduce((s, d) => s + d, 0);
  const avgHammingDistance = sum / n;
  const medianDistance = median(distances);
  const stdDev = popStdDev(distances);
  const minDistance = Math.min(...distances);
  const maxDistance = Math.max(...distances);

  // Confidence-weighted average: sum(w_i * d_i) / sum(w_i)
  const wSum = weights.reduce((s, w) => s + w, 0);
  const wdSum = distances.reduce((s, d, i) => s + d * weights[i]!, 0);
  const confidenceWeightedAvg = wSum > 0 ? wdSum / wSum : 0;

  const avgConfidence = obs.reduce((s, o) => s + o.confidence, 0) / obs.length;

  return {
    candidateCount: obs.length,
    pairCount: n,
    avgHammingDistance,
    medianDistance,
    stdDev,
    histogram,
    confidenceWeightedAvg,
    avgConfidence,
    minDistance,
    maxDistance,
  };
}

// ---------------------------------------------------------------------------
// 2. percentileSimilarity
// ---------------------------------------------------------------------------

/**
 * Rank `candidates` by Hamming distance to `reference` and return the
 * Nth-percentile Hamming distance plus the candidate at that rank.
 *
 * Useful for "find candidates within 85th-percentile similarity":
 * filter `rankedCandidates` to those with `distance <= percentileDistance`.
 *
 * The `percentile` value is clamped to [0, 1].
 * Nearest-rank method: the percentile index is `floor(p * n)` clamped to
 * `[0, n-1]`.
 *
 * Candidates without a hash (no `phashResult`, no `phash`) are excluded from
 * ranking but still count toward the total candidate pool.
 *
 * @param reference   The `PerceptualHashResult` to measure distances from.
 * @param candidates  Array of `ImageCandidate` objects to rank.
 * @param percentile  Target percentile in [0, 1] (e.g. 0.85 = P85).
 * @returns           `PercentileSimilarityResult`.
 *
 * @example
 * ```ts
 * const result = percentileSimilarity(refHash, bundle.candidates, 0.85);
 * const within85th = result.rankedCandidates.filter(
 *   ({ distance }) => distance <= result.percentileDistance
 * );
 * ```
 */
export function percentileSimilarity(
  reference: PerceptualHashResult,
  candidates: ImageCandidate[],
  percentile: number,
): PercentileSimilarityResult {
  const p = Math.max(0, Math.min(1, percentile));
  const refHash = resolveHash(reference);

  // Build ranked list from hashable candidates only.
  type Ranked = { candidate: ImageCandidate; distance: number; confidence: number };
  const ranked: Ranked[] = [];

  for (const c of candidates) {
    let hash: string | undefined;
    let confidence: number;

    if (c.phashResult) {
      hash = c.phashResult.hash;
      confidence = c.phashResult.confidence;
    } else if (c.phash) {
      hash = c.phash;
      confidence = c.phashAlgorithm === "dct-phash" ? 1.0 : 0.5;
    } else {
      continue; // no hash — skip
    }

    ranked.push({
      candidate: c,
      distance: hammingDistance(refHash, hash),
      confidence,
    });
  }

  // Sort ascending by distance; ties broken by confidence descending.
  ranked.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return b.confidence - a.confidence;
  });

  if (ranked.length === 0) {
    return {
      percentileDistance: 0,
      candidateAtPercentile: null,
      rankedCandidates: [],
      percentile: p,
    };
  }

  const idx = Math.min(Math.floor(p * ranked.length), ranked.length - 1);
  const entry = ranked[idx]!;

  return {
    percentileDistance: entry.distance,
    candidateAtPercentile: entry.candidate,
    rankedCandidates: ranked,
    percentile: p,
  };
}

// ---------------------------------------------------------------------------
// 3. hashQualityReport
// ---------------------------------------------------------------------------

/**
 * Classify candidates per-algorithm (dct-phash vs ahash-fallback vs bare-hash)
 * and return a confidence-distribution breakdown.
 *
 * The `verdict` field provides a quick one-word readiness signal:
 *   - `'ready'`      — > 80% of hashed candidates are high-confidence (>= 0.85).
 *   - `'acceptable'` — > 50% are medium or high confidence.
 *   - `'degraded'`   — > 30% are low confidence OR > 20% are unhashed.
 *   - `'unusable'`   — > 60% are low confidence OR > 50% are unhashed.
 *
 * @param candidates  Array of `ImageCandidate` objects.
 * @returns           `HashQualityReport` — safe to serialize as JSON.
 *
 * @example
 * ```ts
 * const report = hashQualityReport(bundle.candidates);
 * if (report.verdict === 'unusable') {
 *   console.warn('pHash quality too low for reliable ranking');
 * }
 * ```
 */
export function hashQualityReport(candidates: ImageCandidate[]): HashQualityReport {
  const totalCandidates = candidates.length;
  const obs = extractObservations(candidates);
  const hashedCount = obs.length;
  const unhashedCount = totalCandidates - hashedCount;

  // Split by algorithm
  const dctObs = obs.filter((o) => o.algorithm === "dct-phash");
  const ahashObs = obs.filter((o) => o.algorithm === "ahash-fallback");
  const bareObs = obs.filter((o) => o.algorithm === "bare-hash");

  function makeAlgorithmBucket(group: HashObs[]): AlgorithmBucket {
    const n = group.length;
    if (n === 0) {
      return { count: 0, fraction: 0, meanConfidence: 0, minConfidence: 0, maxConfidence: 0, stdDev: 0 };
    }
    const confs = group.map((o) => o.confidence);
    const mean = confs.reduce((s, v) => s + v, 0) / n;
    return {
      count: n,
      fraction: hashedCount > 0 ? n / hashedCount : 0,
      meanConfidence: mean,
      minConfidence: Math.min(...confs),
      maxConfidence: Math.max(...confs),
      stdDev: popStdDev(confs),
    };
  }

  const algorithmBreakdown = {
    "dct-phash": makeAlgorithmBucket(dctObs),
    "ahash-fallback": makeAlgorithmBucket(ahashObs),
    "bare-hash": makeAlgorithmBucket(bareObs),
  };

  // Confidence tier breakdown
  const HIGH_THRESHOLD = 0.85;
  const MED_THRESHOLD = 0.5;

  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  for (const o of obs) {
    if (o.confidence >= HIGH_THRESHOLD) {
      highCount++;
    } else if (o.confidence >= MED_THRESHOLD) {
      mediumCount++;
    } else {
      lowCount++;
    }
  }

  const confidenceTiers: ConfidenceTierBreakdown = {
    high: highCount,
    medium: mediumCount,
    low: lowCount,
  };

  // Overall confidence stats
  const allConfs = obs.map((o) => o.confidence);
  const overallMeanConfidence = allConfs.length > 0
    ? allConfs.reduce((s, v) => s + v, 0) / allConfs.length
    : 0;
  const overallStdDev = popStdDev(allConfs);

  // Verdict computation
  // Edge case: no candidates at all → unusable
  if (totalCandidates === 0) {
    return {
      totalCandidates: 0,
      hashedCount: 0,
      unhashedCount: 0,
      algorithmBreakdown,
      confidenceTiers,
      overallMeanConfidence: 0,
      overallStdDev: 0,
      verdict: "unusable",
    };
  }

  const unhashedFraction = unhashedCount / totalCandidates;
  const lowFraction = hashedCount > 0 ? lowCount / hashedCount : 1.0;
  const highFraction = hashedCount > 0 ? highCount / hashedCount : 0;
  const medHighFraction = hashedCount > 0 ? (mediumCount + highCount) / hashedCount : 0;

  let verdict: HashQualityReport["verdict"];
  if (unhashedFraction > 0.5 || lowFraction > 0.6) {
    verdict = "unusable";
  } else if (unhashedFraction > 0.2 || lowFraction > 0.3) {
    verdict = "degraded";
  } else if (highFraction > 0.8) {
    verdict = "ready";
  } else if (medHighFraction > 0.5) {
    verdict = "acceptable";
  } else {
    verdict = "degraded";
  }

  return {
    totalCandidates,
    hashedCount,
    unhashedCount,
    algorithmBreakdown,
    confidenceTiers,
    overallMeanConfidence,
    overallStdDev,
    verdict,
  };
}

// ---------------------------------------------------------------------------
// 4. computeHashMetrics (bundle-level convenience)
// ---------------------------------------------------------------------------

/**
 * Profile the perceptual-hash quality of a `SearchResultBundle.candidates`
 * list in one call. Returns similarity analysis, quality report, and the
 * top-5 most similar pairs (useful for pre-ranking dedup previews).
 *
 * Agents and CLI callers can use this before ranking to decide whether pHash
 * deduplication is reliable for the current result set.
 *
 * @param candidates  Array of `ImageCandidate` objects.
 * @returns           `HashMetrics` bundle.
 *
 * @example
 * ```ts
 * import { computeHashMetrics } from "webfetch-core";
 * const metrics = computeHashMetrics(bundle.candidates);
 * if (metrics.quality.verdict === 'unusable') {
 *   // skip perceptual dedup
 * }
 * ```
 */
export function computeHashMetrics(candidates: ImageCandidate[]): HashMetrics {
  const similarity = analyzeHashSimilarity(candidates);
  const quality = hashQualityReport(candidates);

  // Compute top-5 most similar pairs (lowest Hamming distance).
  const obs = extractObservations(candidates);
  type PairEntry = {
    indexA: number;
    indexB: number;
    distance: number;
    hashA: string;
    hashB: string;
  };

  const topSimilarPairs: PairEntry[] = [];

  if (obs.length >= 2) {
    const allPairs: PairEntry[] = [];
    for (let i = 0; i < obs.length; i++) {
      for (let j = i + 1; j < obs.length; j++) {
        allPairs.push({
          indexA: obs[i]!.candidateIndex,
          indexB: obs[j]!.candidateIndex,
          distance: hammingDistance(obs[i]!.hash, obs[j]!.hash),
          hashA: obs[i]!.hash,
          hashB: obs[j]!.hash,
        });
      }
    }
    allPairs.sort((a, b) => a.distance - b.distance);
    topSimilarPairs.push(...allPairs.slice(0, 5));
  }

  return { similarity, quality, topSimilarPairs };
}

// ---------------------------------------------------------------------------
// 5. Federation-wide pHash duplicate cluster detection
// ---------------------------------------------------------------------------

/**
 * A cluster of visually identical images from multiple providers,
 * detected when their pHash Hamming distance is below the threshold.
 *
 * `providerVariance` measures how widely the providers differ:
 *   0 = all providers are the same; 1 = every provider is distinct.
 *
 * `confidenceVariance` is the population std-dev of the per-member
 * license-confidence values — high values signal that providers disagree
 * on how confident they are in their license determinations.
 */
export interface DuplicateCluster {
  /** Monotonically increasing cluster id (1-based). */
  clusterId: number;
  /** All candidate indices belonging to this cluster. */
  memberIndices: number[];
  /** Number of members in the cluster. */
  clusterSize: number;
  /**
   * Fraction of distinct providers across cluster members (0..1).
   * 0 = all from one provider; 1 = every member from a different provider.
   */
  providerVariance: number;
  /**
   * Population std-dev of license-confidence values within the cluster (0..1).
   * High value = providers disagree on how confident they are.
   */
  confidenceVariance: number;
  /**
   * Minimum pHash Hamming distance observed across all intra-cluster pairs.
   * Clusters with minIntraDistance = 0 contain exact hash duplicates.
   */
  minIntraDistance: number;
  /**
   * Maximum pHash Hamming distance observed within the cluster.
   * If > threshold the cluster spans multiple tolerance levels.
   */
  maxIntraDistance: number;
  /** All provider ids present in this cluster. */
  providers: string[];
  /** License-confidence values per member (same order as memberIndices). */
  licenseConfidences: number[];
}

/**
 * Options for `detectFederationDuplicateClusters`.
 */
export interface FederationClusterOptions {
  /**
   * Maximum Hamming distance (inclusive) for two images to be considered
   * visually identical. Default: 8.
   */
  hammingThreshold?: number;
  /**
   * When true, only emit clusters that span 3 or more providers.
   * Default: false (emit all clusters with 2+ members).
   */
  multiProviderOnly?: boolean;
}

/**
 * Find clusters of visually identical images across providers by
 * union-find over pairwise Hamming distances.
 *
 * Only candidates that have a hash are considered.
 * Candidates without any hash are skipped.
 *
 * @param candidates     Array of `ImageCandidate` objects from a federation run.
 * @param options        Tuning options (threshold, multiProviderOnly).
 * @returns              Array of `DuplicateCluster` — one entry per group of 2+.
 *
 * @example
 * ```ts
 * const clusters = detectFederationDuplicateClusters(bundle.candidates, { hammingThreshold: 8 });
 * for (const cl of clusters) {
 *   if (cl.clusterSize >= 3) console.log("Cross-provider duplicate:", cl);
 * }
 * ```
 */
export function detectFederationDuplicateClusters(
  candidates: ImageCandidate[],
  options: FederationClusterOptions = {},
): DuplicateCluster[] {
  const threshold = options.hammingThreshold ?? 8;
  const obs = extractObservations(candidates);
  if (obs.length < 2) return [];

  // Union-Find
  const parent = obs.map((_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!; // path compression
      x = parent[x]!;
    }
    return x;
  }

  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (let i = 0; i < obs.length; i++) {
    for (let j = i + 1; j < obs.length; j++) {
      const d = hammingDistance(obs[i]!.hash, obs[j]!.hash);
      if (d <= threshold) {
        union(i, j);
      }
    }
  }

  // Group by root
  const groupMap = new Map<number, number[]>();
  for (let i = 0; i < obs.length; i++) {
    const root = find(i);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root)!.push(i);
  }

  const clusters: DuplicateCluster[] = [];
  let clusterId = 0;

  for (const members of groupMap.values()) {
    if (members.length < 2) continue;

    const providers = members.map((i) => candidates[obs[i]!.candidateIndex]!.source);
    const uniqueProviders = [...new Set(providers)];

    if (options.multiProviderOnly && uniqueProviders.length < 3) continue;

    // Intra-cluster distances
    let minIntraDistance = Infinity;
    let maxIntraDistance = 0;
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const d = hammingDistance(obs[members[a]!]!.hash, obs[members[b]!]!.hash);
        if (d < minIntraDistance) minIntraDistance = d;
        if (d > maxIntraDistance) maxIntraDistance = d;
      }
    }
    if (minIntraDistance === Infinity) minIntraDistance = 0;

    // Provider variance: fraction of distinct providers
    const providerVariance =
      members.length > 1
        ? (uniqueProviders.length - 1) / (members.length - 1)
        : 0;

    // License confidence values
    const licenseConfidences = members.map((i) => {
      const cand = candidates[obs[i]!.candidateIndex]!;
      return cand.confidence ?? obs[i]!.confidence;
    });

    const confMean =
      licenseConfidences.reduce((s, v) => s + v, 0) / licenseConfidences.length;
    const confVariance =
      licenseConfidences.reduce((s, v) => s + (v - confMean) ** 2, 0) /
      licenseConfidences.length;
    const confidenceVariance = Math.sqrt(confVariance);

    clusters.push({
      clusterId: ++clusterId,
      memberIndices: members.map((i) => obs[i]!.candidateIndex),
      clusterSize: members.length,
      providerVariance,
      confidenceVariance,
      minIntraDistance,
      maxIntraDistance,
      providers,
      licenseConfidences,
    });
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// 6. License-confidence anomaly detection
// ---------------------------------------------------------------------------

/**
 * A single confidence anomaly event: the same visual has wildly different
 * license confidences across providers.
 *
 * "Confidence" here is the `ImageCandidate.confidence` field (0..1) that
 * indicates how trustworthy the license determination is for a candidate.
 * When this varies significantly within a pHash cluster, it flags that one
 * provider's license metadata is unreliable.
 */
export interface ConfidenceAnomalyEvent {
  /** Index of the DuplicateCluster this anomaly was found in. */
  clusterIndex: number;
  /** Candidate indices involved in this anomaly (subset of the cluster). */
  candidateIndices: number[];
  /**
   * Max absolute difference in license-confidence within this cluster.
   * For example: 0.9 (CC_BY provider) vs 0.4 (UNKNOWN provider) → delta 0.5.
   */
  maxConfidenceDelta: number;
  /**
   * Mean license-confidence across candidates in this cluster.
   */
  meanConfidence: number;
  /**
   * Population std-dev of license-confidence across this cluster.
   */
  stdDevConfidence: number;
  /**
   * Candidate index with the highest license confidence in this cluster.
   * Null when the cluster has no candidates with confidence set.
   */
  highestConfidenceIndex: number | null;
  /**
   * Candidate index with the lowest license confidence in this cluster.
   * Null when the cluster has no candidates with confidence set.
   */
  lowestConfidenceIndex: number | null;
  /**
   * License reported by the highest-confidence provider, or UNKNOWN.
   */
  highestConfidenceLicense: License;
  /**
   * License reported by the lowest-confidence provider, or UNKNOWN.
   */
  lowestConfidenceLicense: License;
}

/**
 * Options for `detectConfidenceAnomalies`.
 */
export interface ConfidenceAnomalyOptions {
  /**
   * Minimum license-confidence delta (between highest and lowest in a cluster)
   * to flag as an anomaly. Default: 0.3.
   */
  minDelta?: number;
  /**
   * Hamming distance threshold passed through to `detectFederationDuplicateClusters`.
   * Default: 8.
   */
  hammingThreshold?: number;
}

/**
 * Detect cases where visually identical images have wildly different
 * license-confidence scores across providers.
 *
 * Runs `detectFederationDuplicateClusters` internally to group candidates,
 * then checks each cluster for high confidence variance.
 *
 * @param candidates    Array of `ImageCandidate` objects.
 * @param options       `minDelta` threshold and pHash `hammingThreshold`.
 * @returns             Array of `ConfidenceAnomalyEvent` — one per anomalous cluster.
 *
 * @example
 * ```ts
 * const anomalies = detectConfidenceAnomalies(bundle.candidates, { minDelta: 0.3 });
 * for (const a of anomalies) {
 *   console.log(`Cluster: max delta ${a.maxConfidenceDelta.toFixed(2)}`);
 * }
 * ```
 */
export function detectConfidenceAnomalies(
  candidates: ImageCandidate[],
  options: ConfidenceAnomalyOptions = {},
): ConfidenceAnomalyEvent[] {
  const minDelta = options.minDelta ?? 0.3;
  const hammingThreshold = options.hammingThreshold ?? 8;

  const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold });
  const anomalies: ConfidenceAnomalyEvent[] = [];

  for (let ci = 0; ci < clusters.length; ci++) {
    const cluster = clusters[ci]!;
    const { memberIndices, licenseConfidences } = cluster;

    const maxConf = Math.max(...licenseConfidences);
    const minConf = Math.min(...licenseConfidences);
    const delta = maxConf - minConf;
    if (delta < minDelta) continue;

    const mean = licenseConfidences.reduce((s, v) => s + v, 0) / licenseConfidences.length;
    const variance =
      licenseConfidences.reduce((s, v) => s + (v - mean) ** 2, 0) / licenseConfidences.length;
    const stdDev = Math.sqrt(variance);

    // Identify which candidates are the highest/lowest.
    let highIdx = 0;
    let lowIdx = 0;
    for (let k = 1; k < licenseConfidences.length; k++) {
      if (licenseConfidences[k]! > licenseConfidences[highIdx]!) highIdx = k;
      if (licenseConfidences[k]! < licenseConfidences[lowIdx]!) lowIdx = k;
    }

    const highCandIdx = memberIndices[highIdx]!;
    const lowCandIdx = memberIndices[lowIdx]!;

    anomalies.push({
      clusterIndex: ci,
      candidateIndices: [...memberIndices],
      maxConfidenceDelta: delta,
      meanConfidence: mean,
      stdDevConfidence: stdDev,
      highestConfidenceIndex: highCandIdx,
      lowestConfidenceIndex: lowCandIdx,
      highestConfidenceLicense: candidates[highCandIdx]?.license ?? "UNKNOWN",
      lowestConfidenceLicense: candidates[lowCandIdx]?.license ?? "UNKNOWN",
    });
  }

  return anomalies;
}

// ---------------------------------------------------------------------------
// 7. Federation phash audit report (full structured output)
// ---------------------------------------------------------------------------

/**
 * A provider agreement matrix entry: how often two specific providers
 * return the same visual (pHash cluster members from the same pair).
 */
export interface ProviderAgreementEntry {
  /** First provider id (alphabetically first). */
  providerA: string;
  /** Second provider id. */
  providerB: string;
  /**
   * Number of pHash clusters that contain at least one candidate from
   * each of these two providers.
   */
  sharedClusterCount: number;
  /**
   * Fraction of all clusters that contain both providers.
   * Range [0, 1]; 0 when neither provider had any clusters together.
   */
  agreementRate: number;
}

/**
 * Threshold tuning guide entry — how many unique images exist at a given
 * Hamming distance threshold. Useful for deciding where to set the
 * dedup threshold.
 */
export interface ThresholdTuningEntry {
  /** Hamming threshold tested (0..64). */
  threshold: number;
  /**
   * Number of distinct "unique" groups at this threshold.
   * Lower = more aggressively merged; higher = more conservative.
   */
  uniqueCount: number;
  /**
   * Number of clusters (groups with 2+ members) at this threshold.
   */
  clusterCount: number;
}

/**
 * An actionable recommendation produced by the federation phash audit.
 */
export interface PhashAuditRecommendation {
  /**
   * Short identifier for this recommendation class.
   * - `'raise-threshold'` — the current threshold merges too many false positives.
   * - `'lower-threshold'` — the current threshold misses real duplicates.
   * - `'investigate-anomaly'` — a cluster has high confidence variance.
   * - `'single-provider'`  — only one provider returned hashes; federation was narrow.
   */
  type: "raise-threshold" | "lower-threshold" | "investigate-anomaly" | "single-provider";
  /** Human-readable description of the issue and what to do. */
  message: string;
  /**
   * If this recommendation relates to a specific cluster, its clusterId.
   * Null when the recommendation is global.
   */
  relatedClusterId: number | null;
}

/**
 * Full federation pHash audit report returned by `buildFederationPhashAuditReport`.
 */
export interface FederationPhashAuditReport {
  /** Query string that was searched (passed through from the caller). */
  query: string;
  /** ISO-8601 timestamp of when this report was generated. */
  generatedAt: string;
  /** Total candidates analyzed. */
  totalCandidates: number;
  /** Number of candidates with a computable pHash. */
  hashedCandidates: number;
  /** Hamming threshold used for this run. */
  hammingThreshold: number;
  /**
   * Total number of unique images at this threshold (groups with 1 member +
   * one representative per cluster).
   */
  totalUniques: number;
  /**
   * Number of duplicate clusters (groups with 2+ members).
   */
  clusterCount: number;
  /**
   * All detected duplicate clusters (including single-provider ones).
   */
  clusters: DuplicateCluster[];
  /**
   * Confidence anomaly events — clusters where license-confidence varies
   * wildly across providers.
   */
  confidenceAnomalies: ConfidenceAnomalyEvent[];
  /**
   * Provider agreement matrix — which provider pairs most often agree on
   * visually identical images.
   */
  providerAgreementMatrix: ProviderAgreementEntry[];
  /**
   * Threshold tuning guide: unique counts at thresholds [4, 6, 8, 10, 12, 16].
   * Use this to decide whether to raise or lower the Hamming threshold.
   */
  thresholdTuningGuide: ThresholdTuningEntry[];
  /**
   * Actionable recommendations generated from the analysis.
   */
  recommendations: PhashAuditRecommendation[];
  /** Overall pHash similarity stats across all candidates. */
  similarity: HashSimilarityAnalysis;
  /** Algorithm quality report. */
  quality: HashQualityReport;
}

/**
 * Options for `buildFederationPhashAuditReport`.
 */
export interface FederationPhashAuditOptions {
  /**
   * Hamming threshold for duplicate clustering. Default: 8.
   */
  hammingThreshold?: number;
  /**
   * Minimum confidence delta to flag as an anomaly. Default: 0.3.
   */
  anomalyMinDelta?: number;
}

/**
 * Build a comprehensive federation-wide pHash audit report.
 *
 * Combines duplicate cluster detection, confidence anomaly detection,
 * provider agreement matrix, and threshold tuning guidance into a single
 * structured report suitable for the CLI `audit-phash-federation` command
 * or agent consumption.
 *
 * Pure and synchronous — no I/O.
 *
 * @param query      The search query string (included in the report for traceability).
 * @param candidates Array of `ImageCandidate` objects from a federation run.
 * @param options    Tuning options.
 * @returns          `FederationPhashAuditReport`
 *
 * @example
 * ```ts
 * const report = buildFederationPhashAuditReport("sunset landscape", bundle.candidates);
 * console.log(report.recommendations);
 * ```
 */
export function buildFederationPhashAuditReport(
  query: string,
  candidates: ImageCandidate[],
  options: FederationPhashAuditOptions = {},
): FederationPhashAuditReport {
  const hammingThreshold = options.hammingThreshold ?? 8;
  const anomalyMinDelta = options.anomalyMinDelta ?? 0.3;

  const obs = extractObservations(candidates);
  const hashedCandidates = obs.length;

  const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold });
  const confidenceAnomalies = detectConfidenceAnomalies(candidates, {
    hammingThreshold,
    minDelta: anomalyMinDelta,
  });

  const similarity = analyzeHashSimilarity(candidates);
  const quality = hashQualityReport(candidates);

  // Total uniques = singletons + one representative per cluster
  const clusteredIndices = new Set(clusters.flatMap((cl) => cl.memberIndices));
  const singletonCount = obs.filter((o) => !clusteredIndices.has(o.candidateIndex)).length;
  const totalUniques = singletonCount + clusters.length;

  // Provider agreement matrix
  const providerAgreementMatrix = buildProviderAgreementMatrix(clusters, candidates.length);

  // Threshold tuning guide
  const TUNING_THRESHOLDS = [4, 6, 8, 10, 12, 16];
  const thresholdTuningGuide: ThresholdTuningEntry[] = TUNING_THRESHOLDS.map((t) => {
    const cl = detectFederationDuplicateClusters(candidates, { hammingThreshold: t });
    const clusteredSet = new Set(cl.flatMap((c) => c.memberIndices));
    const singletons = obs.filter((o) => !clusteredSet.has(o.candidateIndex)).length;
    return {
      threshold: t,
      uniqueCount: singletons + cl.length,
      clusterCount: cl.length,
    };
  });

  // Generate recommendations
  const recommendations = generatePhashRecommendations(
    clusters,
    confidenceAnomalies,
    hammingThreshold,
    thresholdTuningGuide,
    obs.length,
  );

  return {
    query,
    generatedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
    hashedCandidates,
    hammingThreshold,
    totalUniques,
    clusterCount: clusters.length,
    clusters,
    confidenceAnomalies,
    providerAgreementMatrix,
    thresholdTuningGuide,
    recommendations,
    similarity,
    quality,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers for federation audit
// ---------------------------------------------------------------------------

/**
 * Build a provider pair agreement matrix from a set of duplicate clusters.
 * Each entry tells how often two providers returned the same visual.
 */
function buildProviderAgreementMatrix(
  clusters: DuplicateCluster[],
  _totalCandidates: number,
): ProviderAgreementEntry[] {
  // Count shared clusters per provider pair
  const pairCounts = new Map<string, number>();

  for (const cluster of clusters) {
    const uniqueProviders = [...new Set(cluster.providers)];
    for (let a = 0; a < uniqueProviders.length; a++) {
      for (let b = a + 1; b < uniqueProviders.length; b++) {
        const key = [uniqueProviders[a]!, uniqueProviders[b]!].sort().join("|||");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }

  const totalClusters = clusters.length;
  const entries: ProviderAgreementEntry[] = [];
  for (const [key, count] of pairCounts) {
    const [providerA, providerB] = key.split("|||") as [string, string];
    entries.push({
      providerA,
      providerB,
      sharedClusterCount: count,
      agreementRate: totalClusters > 0 ? count / totalClusters : 0,
    });
  }

  // Sort by agreement rate descending
  entries.sort((a, b) => b.agreementRate - a.agreementRate);
  return entries;
}

/**
 * Generate actionable recommendations from clusters, anomalies, and tuning guide.
 */
function generatePhashRecommendations(
  clusters: DuplicateCluster[],
  anomalies: ConfidenceAnomalyEvent[],
  currentThreshold: number,
  tuningGuide: ThresholdTuningEntry[],
  hashedCount: number,
): PhashAuditRecommendation[] {
  const recs: PhashAuditRecommendation[] = [];

  // Single-provider coverage warning
  const allProviders = new Set(clusters.flatMap((cl) => cl.providers));
  if (allProviders.size <= 1 && hashedCount > 1) {
    recs.push({
      type: "single-provider",
      message:
        "Only one provider returned hashed candidates. Federation coverage is narrow — " +
        "add more providers to get cross-provider duplicate detection.",
      relatedClusterId: null,
    });
  }

  // Confidence anomaly warnings
  for (const anomaly of anomalies) {
    const clusterId = clusters[anomaly.clusterIndex]?.clusterId ?? null;
    recs.push({
      type: "investigate-anomaly",
      message:
        `Cluster ${clusterId ?? "?"}: license-confidence varies by ${anomaly.maxConfidenceDelta.toFixed(2)} ` +
        `(high: ${anomaly.highestConfidenceLicense} @ ${(anomaly.meanConfidence + anomaly.stdDevConfidence).toFixed(2)}, ` +
        `low: ${anomaly.lowestConfidenceLicense}). ` +
        `Verify license metadata from the low-confidence provider before publishing.`,
      relatedClusterId: clusterId,
    });
  }

  // Threshold tuning: look for a better threshold
  const currentEntry = tuningGuide.find((e) => e.threshold === currentThreshold);
  if (currentEntry && tuningGuide.length > 0) {
    // If raising threshold to 10 or 12 collapses more clusters without losing too many uniques
    const higherEntries = tuningGuide.filter((e) => e.threshold > currentThreshold);
    for (const higher of higherEntries) {
      const collapsedExtra = currentEntry.clusterCount - higher.clusterCount;
      if (collapsedExtra >= 2 && collapsedExtra <= 10) {
        recs.push({
          type: "raise-threshold",
          message:
            `Raise Hamming threshold from ${currentThreshold} → ${higher.threshold} to collapse ` +
            `${collapsedExtra} additional cluster(s) (currently treated as false-positive duplicates). ` +
            `This reduces unique count from ${currentEntry.uniqueCount} → ${higher.uniqueCount}.`,
          relatedClusterId: null,
        });
        break; // Only emit the first actionable suggestion
      }
    }

    // If lowering threshold would split clusters and reduce false positives
    const lowerEntries = tuningGuide.filter((e) => e.threshold < currentThreshold);
    for (const lower of [...lowerEntries].reverse()) {
      const newClusters = lower.clusterCount - currentEntry.clusterCount;
      if (newClusters >= 2 && newClusters <= 10) {
        recs.push({
          type: "lower-threshold",
          message:
            `Lower Hamming threshold from ${currentThreshold} → ${lower.threshold} to split ` +
            `${newClusters} over-merged cluster(s) (potential false positives). ` +
            `Unique count would increase from ${currentEntry.uniqueCount} → ${lower.uniqueCount}.`,
          relatedClusterId: null,
        });
        break;
      }
    }
  }

  return recs;
}
