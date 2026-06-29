/**
 * Perceptual Hash Quality Diagnostics.
 *
 * Provides `analyzePhashQuality` — a function that inspects a set of
 * `ImageCandidate` objects (post-federation / post-search) and returns a
 * structured quality report answering:
 *
 *   • How many hashes were computed with the high-quality DCT path vs the
 *     fallback aHash path?
 *   • What is the confidence distribution across the candidate set?
 *   • Is deduplication reliable for this batch?
 *
 * The diagnostics object is safe to serialize to JSON and expose through the
 * CLI (`--phash-diagnostics`) or the HTTP API (`POST /analyze-phash-quality`).
 *
 * @example
 * ```ts
 * import { analyzePhashQuality } from "webfetch-core";
 * const diag = analyzePhashQuality(bundle.candidates);
 * console.log(diag.dedupeReliability); // 0..1
 * ```
 *
 * See docs/TUNING.md for a full operator runbook with threshold guidance.
 */

import type { ImageCandidate } from "./types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Per-algorithm breakdown — how many candidates used this algorithm and what
 * their average confidence score is.
 */
export interface AlgorithmStats {
  /** Number of candidates hashed with this algorithm. */
  count: number;
  /**
   * Mean confidence across candidates that used this algorithm.
   * 0 when `count` is 0.
   */
  confidence: number;
}

/**
 * Summary of the confidence distribution across all hashed candidates.
 * All values are in [0, 1] (or 0 when there are no candidates).
 */
export interface ConfidenceDistribution {
  /** Arithmetic mean of per-candidate confidence values. */
  mean: number;
  /** Minimum confidence observed. */
  min: number;
  /** Maximum confidence observed. */
  max: number;
  /** Population standard deviation of confidence values. */
  stdDev: number;
}

/**
 * The overall algorithm mix quality assessment:
 *
 * - `'high-quality'`   — All (or almost all) hashes used the DCT-pHash path
 *   (sharp available, images decoded + resized). Deduplication is highly
 *   reliable.
 * - `'degraded'`       — Mix of DCT and aHash: some images fell back. Check
 *   whether sharp is installed and reachable.
 * - `'fallback-heavy'` — The majority of hashes are aHash fallbacks. Sharp is
 *   likely missing. Deduplication accuracy is significantly reduced; treat
 *   matches with scepticism.
 */
export type AlgorithmMix = "high-quality" | "degraded" | "fallback-heavy";

/**
 * Full quality report returned by `analyzePhashQuality`.
 */
export interface PhashDiagnosticsResult {
  /**
   * Per-algorithm breakdown. `dct` corresponds to the real DCT-II pHash
   * (high quality); `ahash` corresponds to the byte-window aHash fallback
   * (lower quality, used when `sharp` is unavailable).
   */
  perAlgorithm: {
    dct: AlgorithmStats;
    ahash: AlgorithmStats;
  };

  /**
   * Qualitative assessment of the algorithm mix. Derived from the ratio of
   * DCT vs aHash candidates:
   * - ≥ 90% DCT → `'high-quality'`
   * - 10%–89% DCT → `'degraded'`
   * - < 10% DCT → `'fallback-heavy'`
   *
   * Special cases:
   * - Zero hashed candidates → `'fallback-heavy'` (nothing to work with).
   */
  algorithmMix: AlgorithmMix;

  /** Statistical summary of the confidence distribution. */
  confidenceDistribution: ConfidenceDistribution;

  /**
   * Scalar 0–1 reliability estimate for deduplication decisions made using
   * this candidate set.
   *
   * Computed as:
   *   `meanConfidence × dctRatio`
   * where `dctRatio` is the fraction of hashed candidates that used the DCT
   * path (0 when none are hashed).
   *
   * Interpretation:
   *   - > 0.85 → reliable; false-positive dedup unlikely.
   *   - 0.5–0.85 → moderate confidence; spot-check suspicious merges.
   *   - < 0.5 → low reliability; consider disabling perceptual dedup or
   *              re-running with `sharp` available.
   */
  dedupeReliability: number;

  /**
   * Total number of candidates passed in (including those with no hash).
   */
  totalCandidates: number;

  /**
   * Number of candidates that had a computable pHash (either pre-computed or
   * derivable from `phashResult`).
   */
  hashedCount: number;

  /**
   * Number of candidates with no pHash at all. These candidates cannot
   * participate in perceptual deduplication.
   */
  unhashedCount: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Analyse the perceptual-hash quality of a candidate set and return a
 * structured diagnostics report.
 *
 * Candidates without any pHash data (neither `phash` nor `phashResult`) are
 * counted in `unhashedCount` but do not contribute to algorithm or confidence
 * statistics.
 *
 * Candidates with a bare `phash` string but no `phashResult` are treated as
 * `ahash-fallback` with confidence 0.5 (the default when the algorithm is
 * unknown — a conservative assumption).
 *
 * @param candidates  Array of `ImageCandidate` objects from a search or
 *                    federation run.
 * @returns           `PhashDiagnosticsResult` — safe to serialize as JSON.
 *
 * @example
 * ```ts
 * const diag = analyzePhashQuality(bundle.candidates);
 * if (diag.dedupeReliability < 0.5) {
 *   console.warn("pHash deduplication is low-confidence — install `sharp`.");
 * }
 * ```
 */
export function analyzePhashQuality(
  candidates: ImageCandidate[],
): PhashDiagnosticsResult {
  const totalCandidates = candidates.length;

  // Collect per-candidate observations.
  interface Obs {
    algorithm: "dct-phash" | "ahash-fallback";
    confidence: number;
  }

  const observations: Obs[] = [];

  for (const c of candidates) {
    if (c.phashResult) {
      // Best case: structured result available.
      observations.push({
        algorithm: c.phashResult.algorithm,
        confidence: c.phashResult.confidence,
      });
    } else if (c.phashAlgorithm && c.phash) {
      // phashAlgorithm field present without phashResult.
      const conf = c.phashAlgorithm === "dct-phash" ? 1.0 : 0.5;
      observations.push({ algorithm: c.phashAlgorithm, confidence: conf });
    } else if (c.phash) {
      // Bare hash string — algorithm unknown; conservative fallback assumption.
      observations.push({ algorithm: "ahash-fallback", confidence: 0.5 });
    }
    // else: no hash at all — skip (contributes to unhashedCount).
  }

  const hashedCount = observations.length;
  const unhashedCount = totalCandidates - hashedCount;

  // Per-algorithm breakdown.
  const dctObs = observations.filter((o) => o.algorithm === "dct-phash");
  const ahashObs = observations.filter((o) => o.algorithm === "ahash-fallback");

  function meanConfidence(obs: Obs[]): number {
    if (obs.length === 0) return 0;
    return obs.reduce((s, o) => s + o.confidence, 0) / obs.length;
  }

  const dctStats: AlgorithmStats = {
    count: dctObs.length,
    confidence: meanConfidence(dctObs),
  };
  const ahashStats: AlgorithmStats = {
    count: ahashObs.length,
    confidence: meanConfidence(ahashObs),
  };

  // Algorithm mix classification.
  const dctRatio = hashedCount > 0 ? dctObs.length / hashedCount : 0;
  let algorithmMix: AlgorithmMix;
  if (dctRatio >= 0.9) {
    algorithmMix = "high-quality";
  } else if (dctRatio >= 0.1) {
    algorithmMix = "degraded";
  } else {
    algorithmMix = "fallback-heavy";
  }

  // Confidence distribution.
  const allConfidences = observations.map((o) => o.confidence);
  let distMean = 0;
  let distMin = 0;
  let distMax = 0;
  let distStdDev = 0;

  if (allConfidences.length > 0) {
    distMin = Math.min(...allConfidences);
    distMax = Math.max(...allConfidences);
    distMean = allConfidences.reduce((s, v) => s + v, 0) / allConfidences.length;
    const variance =
      allConfidences.reduce((s, v) => s + (v - distMean) ** 2, 0) /
      allConfidences.length;
    distStdDev = Math.sqrt(variance);
  }

  const confidenceDistribution: ConfidenceDistribution = {
    mean: distMean,
    min: distMin,
    max: distMax,
    stdDev: distStdDev,
  };

  // Dedupe reliability: mean confidence × DCT ratio.
  const dedupeReliability = distMean * dctRatio;

  return {
    perAlgorithm: { dct: dctStats, ahash: ahashStats },
    algorithmMix,
    confidenceDistribution,
    dedupeReliability,
    totalCandidates,
    hashedCount,
    unhashedCount,
  };
}
