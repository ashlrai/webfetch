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
import type { PerceptualHashResult } from "./types.ts";
import type { ImageCandidate } from "./types.ts";

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
