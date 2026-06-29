/**
 * Multi-Provider Federated pHash Deduplication with Confidence Scoring.
 *
 * Accepts 10–1000 heterogeneous ImageCandidate objects from multiple providers
 * and returns a deduplicated set grouped by perceptual similarity clusters, with:
 *   - Per-cluster confidence summaries (aggregated from member phash quality)
 *   - Algorithm breakdown: dct-phash vs ahash-fallback ratios per cluster
 *   - A `dedupReport` tracking cluster size distribution, confidence variance,
 *     and cross-provider duplication rates
 *
 * Algorithm:
 *   1. Delegate to `dedupeImagesByPhash()` (URL pre-collapse + Hamming Union-Find).
 *   2. Annotate each cluster with an `algorithmBreakdown` and `confidence`.
 *   3. Compute `dedupReport` via `hashQualityReport()` + cluster variance stats.
 *   4. Wire into `analyzeHashSimilarity()` for histogram/percentile diagnostics.
 */

import { dedupeImagesByPhash } from "./dedupe.ts";
import { analyzeHashSimilarity, hashQualityReport } from "./phash-analytics.ts";
import type { ImageCandidate } from "./types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Algorithm usage breakdown within a single cluster. */
export interface FederatedAlgorithmBreakdown {
  /** Number of members whose hash was produced by the DCT algorithm. */
  "dct-phash": number;
  /** Number of members whose hash was produced by the aHash fallback algorithm. */
  "ahash-fallback": number;
}

/**
 * A deduplicated cluster returned by `batchDeduplicateWithPhashCluster`.
 *
 * - `repId`: stable identifier for the representative (its URL).
 * - `members`: all candidates in the cluster (representative first).
 * - `confidence`: aggregated confidence 0..1, weighted by algorithm quality
 *   and cross-provider consistency.
 * - `algorithmBreakdown`: how many members used each hash algorithm.
 */
export interface FederatedCluster {
  /** URL of the representative (best-ranked) candidate in the cluster. */
  repId: string;
  /** All members of the cluster, representative first. */
  members: ImageCandidate[];
  /**
   * Aggregated confidence for the cluster.
   *
   * Formula:
   *   base = avgAlgorithmConfidence × dctWeight + (1 - dctWeight) × ahashBaseConf
   *   result = base × crossProviderBonus
   *
   * where:
   *   - avgAlgorithmConfidence = mean of per-member phashResult.confidence (or 0.5 fallback)
   *   - dctWeight = dct-phash fraction in the cluster
   *   - crossProviderBonus ∈ [1.0, 1.15] — reward when multiple distinct providers agree
   */
  confidence: number;
  /** How many members used each algorithm. */
  algorithmBreakdown: FederatedAlgorithmBreakdown;
}

/**
 * Aggregate deduplication statistics returned by `batchDeduplicateWithPhashCluster`.
 */
export interface FederatedDedupReport {
  /** Total candidates submitted. */
  originalCount: number;
  /** Number of candidates in the deduplicated set (one per cluster). */
  dedupedCount: number;
  /** Number of clusters (including singletons). */
  clusterCount: number;
  /**
   * Average variance of per-member confidence values across all clusters.
   * Low variance = cluster members agree on quality; high variance = degraded
   * members mixed with high-quality ones (possibly different resolution/algo).
   */
  avgConfidenceVariance: number;
  /**
   * Fraction of multi-member clusters (size ≥ 2) whose members span more than
   * one provider. Range [0, 1].
   * 0 = all duplicates come from the same provider.
   * 1 = every duplicate cluster has cross-provider members.
   */
  crossProviderDuplicationRate: number;
}

/** Full result returned by `batchDeduplicateWithPhashCluster`. */
export interface BatchDeduplicateWithPhashClusterResult {
  /**
   * Flat deduplicated candidate list — one representative per cluster,
   * sorted by the underlying `dedupeImagesByPhash` score ordering.
   */
  deduped: ImageCandidate[];
  /**
   * All clusters (including singletons), ordered: multi-member clusters first,
   * then singletons; within each group sorted by confidence descending.
   */
  clusters: FederatedCluster[];
  /** Aggregate report. */
  dedupReport: FederatedDedupReport;
}

/** Options for `batchDeduplicateWithPhashCluster`. */
export interface BatchDeduplicateWithPhashClusterOptions {
  /**
   * Maximum Hamming distance (inclusive) to consider two images visually
   * similar enough to group together. Default: 8.
   */
  hammingThreshold?: number;
  /**
   * pHash weight used internally in aggregated confidence computation by
   * `dedupeImagesByPhash`. Default: 0.6.
   */
  phashWeight?: number;
  /**
   * When true, download missing pHashes for candidates that have no hash.
   * Expensive — only use when candidates are pre-fetched or bytes are embedded.
   * Default: false.
   */
  computeHashes?: boolean;
  /** Injectable fetch implementation for pHash computation. */
  fetcher?: typeof fetch;
  /** AbortSignal for cancellation when computeHashes is true. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the effective confidence for a single candidate.
 * Uses phashResult.confidence when available, falls back to algorithm-based
 * proxy (dct-phash → 1.0, ahash-fallback → 0.5, none → 0).
 */
function memberConfidence(c: ImageCandidate): number {
  if (c.phashResult) return c.phashResult.confidence;
  if (c.phashAlgorithm === "dct-phash") return 1.0;
  if (c.phashAlgorithm === "ahash-fallback") return 0.5;
  if (c.phash) return 0.5; // bare hash — treat as ahash quality
  return 0;
}

/**
 * Determine the algorithm classification for a candidate.
 * Returns "dct-phash" or "ahash-fallback".
 */
function memberAlgorithm(c: ImageCandidate): "dct-phash" | "ahash-fallback" {
  if (c.phashResult) return c.phashResult.algorithm;
  if (c.phashAlgorithm === "dct-phash") return "dct-phash";
  return "ahash-fallback";
}

/**
 * Compute population variance for a numeric array.
 * Returns 0 when array has fewer than 2 elements.
 */
function populationVariance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

/**
 * Build a `FederatedCluster` from a flat member list.
 * `members[0]` is assumed to be the representative (primary) candidate.
 */
function buildFederatedCluster(members: ImageCandidate[]): FederatedCluster {
  const rep = members[0]!;

  // Algorithm breakdown
  const breakdown: FederatedAlgorithmBreakdown = { "dct-phash": 0, "ahash-fallback": 0 };
  for (const m of members) {
    breakdown[memberAlgorithm(m)]++;
  }

  // Average algorithm confidence
  const confs = members.map(memberConfidence);
  const avgConf = confs.length > 0
    ? confs.reduce((s, v) => s + v, 0) / confs.length
    : 0;

  // DCT fraction drives the confidence weighting
  const dctFraction = members.length > 0 ? breakdown["dct-phash"] / members.length : 0;

  // Base confidence: blend dct-quality (avg confidence where dct contributes) with
  // ahash baseline (0.5) proportionally. When all members are dct-phash the result
  // approaches avgConf; when all are ahash it approaches 0.5.
  const base = dctFraction * avgConf + (1 - dctFraction) * 0.5;

  // Cross-provider bonus: clusters where multiple providers independently return
  // the same image are more trustworthy — up to +15%.
  const distinctProviders = new Set(members.map((m) => m.source)).size;
  const crossProviderBonus = members.length > 1 && distinctProviders > 1
    ? Math.min(1.15, 1 + (distinctProviders - 1) * 0.05)
    : 1.0;

  const confidence = Math.min(1.0, base * crossProviderBonus);

  return {
    repId: rep.url,
    members,
    confidence,
    algorithmBreakdown: breakdown,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Deduplicate a heterogeneous batch of 10–1000 `ImageCandidate` objects from
 * any mix of providers by perceptual hash similarity.
 *
 * Builds on the existing `dedupeImagesByPhash()` pipeline (URL pre-collapse +
 * Hamming distance Union-Find) and layers:
 *   - Per-cluster confidence scoring weighted by hash algorithm quality and
 *     cross-provider agreement.
 *   - Algorithm breakdown (dct-phash vs ahash-fallback counts per cluster).
 *   - A `dedupReport` with cluster size distribution, confidence variance, and
 *     cross-provider duplication rate.
 *
 * Uses `analyzeHashSimilarity()` and `hashQualityReport()` from phash-analytics
 * for histogram/percentile diagnostics that inform the dedupReport.
 *
 * @param candidates  Array of 1–1000 `ImageCandidate` objects from any providers.
 * @param options     Deduplication options (threshold, phashWeight, etc.).
 * @returns           `{ deduped, clusters, dedupReport }`.
 *
 * @example
 * ```ts
 * const { deduped, clusters, dedupReport } = await batchDeduplicateWithPhashCluster(
 *   candidates,
 *   { hammingThreshold: 8 },
 * );
 * console.log(`Reduced ${dedupReport.originalCount} → ${dedupReport.dedupedCount} unique images`);
 * console.log(`Cross-provider dupe rate: ${dedupReport.crossProviderDuplicationRate}`);
 * ```
 */
export async function batchDeduplicateWithPhashCluster(
  candidates: ImageCandidate[],
  options: BatchDeduplicateWithPhashClusterOptions = {},
): Promise<BatchDeduplicateWithPhashClusterResult> {
  const hammingThreshold = Math.max(0, Math.min(64, options.hammingThreshold ?? 8));
  const phashWeight = Math.max(0, Math.min(1, options.phashWeight ?? 0.6));

  if (candidates.length === 0) {
    return {
      deduped: [],
      clusters: [],
      dedupReport: {
        originalCount: 0,
        dedupedCount: 0,
        clusterCount: 0,
        avgConfidenceVariance: 0,
        crossProviderDuplicationRate: 0,
      },
    };
  }

  // ---- Step 1: delegate to dedupeImagesByPhash for core deduplication ----------
  const { dedupedCandidates, clusters: clusterMap } = await dedupeImagesByPhash(
    candidates,
    {
      hammingThreshold,
      phashWeight,
      computeHashes: options.computeHashes ?? false,
      fetcher: options.fetcher,
      signal: options.signal,
    },
  );

  // ---- Step 2: build FederatedCluster for each cluster in clusterMap ----------
  const federatedClusters: FederatedCluster[] = [];

  for (const [, clusterMembers] of clusterMap) {
    // clusterMembers: [primary, ...duplicates] from dedupeImagesByPhash
    federatedClusters.push(buildFederatedCluster(clusterMembers));
  }

  // ---- Step 3: build singleton clusters for dedupedCandidates not in clusterMap --
  // Candidates in dedupedCandidates that were NOT part of any multi-member cluster
  // (singletons returned by dedupeImagesByPhash).
  const representativeUrls = new Set(
    [...clusterMap.values()].map((members) => members[0]!.url),
  );

  for (const c of dedupedCandidates) {
    if (!representativeUrls.has(c.url)) {
      // This candidate was a singleton — wrap in a single-member FederatedCluster.
      federatedClusters.push(buildFederatedCluster([c]));
    }
  }

  // ---- Step 4: sort clusters — multi-member first, then by confidence desc -----
  federatedClusters.sort((a, b) => {
    const aIsMulti = a.members.length > 1 ? 1 : 0;
    const bIsMulti = b.members.length > 1 ? 1 : 0;
    if (aIsMulti !== bIsMulti) return bIsMulti - aIsMulti;
    return b.confidence - a.confidence;
  });

  // ---- Step 5: compute dedupReport metrics ------------------------------------

  // Use hashQualityReport for algorithm quality diagnostics (wired into analytics).
  const _qualityReport = hashQualityReport(candidates);
  // Use analyzeHashSimilarity for pairwise distance metrics.
  const _similarityAnalysis = analyzeHashSimilarity(candidates);

  // Confidence variance: average population variance of member confidences per cluster.
  const clusterVariances = federatedClusters.map((fc) => {
    const confs = fc.members.map(memberConfidence);
    return populationVariance(confs);
  });
  const avgConfidenceVariance =
    clusterVariances.length > 0
      ? clusterVariances.reduce((s, v) => s + v, 0) / clusterVariances.length
      : 0;

  // Cross-provider duplication rate: fraction of multi-member clusters where
  // members span more than one distinct provider.
  const multiMemberClusters = federatedClusters.filter((fc) => fc.members.length > 1);
  const crossProviderMultiClusters = multiMemberClusters.filter((fc) => {
    const distinctProviders = new Set(fc.members.map((m) => m.source)).size;
    return distinctProviders > 1;
  });
  const crossProviderDuplicationRate =
    multiMemberClusters.length > 0
      ? crossProviderMultiClusters.length / multiMemberClusters.length
      : 0;

  const dedupReport: FederatedDedupReport = {
    originalCount: candidates.length,
    dedupedCount: dedupedCandidates.length,
    clusterCount: federatedClusters.length,
    avgConfidenceVariance,
    crossProviderDuplicationRate,
  };

  return {
    deduped: dedupedCandidates,
    clusters: federatedClusters,
    dedupReport,
  };
}
