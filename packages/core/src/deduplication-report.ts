/**
 * Multi-Provider Image Clustering & Deduplication Report Engine.
 *
 * Orchestrates semantic + pHash deduplication across federated results and
 * surfaces actionable metrics for ML tuning and operator review.
 *
 * Public API:
 *   - `generateDeduplicationReport(candidates, opts)` — full quality report
 *   - `exportClusteringMetrics(report, format)` — CSV/JSON export for ML/ops
 *
 * Algorithm overview:
 *   1. Run `clusterCandidatesBySemantic()` (agglomerative average-linkage on
 *      pHash Hamming distance) to get initial cluster groups.
 *   2. Build a pairwise Hamming distance matrix and compute intra-cluster
 *      distance statistics.
 *   3. Apply semantic weight to compute per-cluster composite confidence:
 *      compositeConfidence = W_PHASH * pHashSim + W_SEMANTIC * semanticSim
 *   4. For each cluster assess false-positive risk (same hash, different visual)
 *      and false-negative risk (same visual, different hash due to compression).
 *   5. Compute recommended threshold based on the bimodal gap in pairwise
 *      distances (maximise separation between intra- and inter-cluster distances).
 *   6. Measure provider diversity per cluster (how many distinct providers
 *      contributed candidates).
 *
 * False-positive risk heuristic:
 *   High risk when a cluster contains candidates from many distinct providers
 *   whose metadata (title/author) is very dissimilar — suggests the pHash
 *   threshold is too permissive and visually different images are being merged.
 *
 * False-negative risk heuristic:
 *   High risk when two separate clusters have centroids with near-threshold
 *   Hamming distance — suggests the threshold is too strict and the same visual
 *   is split across clusters due to compression/alt-source variation.
 */

import { hammingDistance } from "./perceptual-hash.ts";
import {
  clusterCandidatesBySemantic,
  buildHammingMatrix,
} from "./semantic-dedupe.ts";
import type { SemanticDedupeCluster, SemanticDedupeCandidate } from "./semantic-dedupe.ts";
import type { ImageCandidate } from "./types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Risk level for a cluster decision. */
export type RiskLevel = "low" | "medium" | "high";

/**
 * Export format for `exportClusteringMetrics`.
 */
export type ClusterExportFormat = "json" | "csv";

/**
 * Options for `generateDeduplicationReport`.
 */
export interface DeduplicationReportOptions {
  /**
   * Maximum Hamming distance (inclusive) to merge two candidates into the same
   * cluster. Default: 8 (≈ 87.5% similar on a 64-bit hash).
   * Valid range: 1–32.
   */
  phashThreshold?: number;
  /**
   * Weight (0..1) applied to semantic (title/author) similarity when computing
   * composite cluster confidence. Default: 0.3.
   * The remainder (1 - semanticWeight) is applied to pHash similarity.
   */
  semanticWeight?: number;
  /**
   * Minimum composite confidence for a cluster decision to be considered
   * reliable. Clusters below this floor are flagged as "needs review".
   * Default: 0.5.
   */
  confidenceFloor?: number;
}

/**
 * Per-cluster metrics and risk assessment.
 */
export interface ClusterReport {
  /** Unique cluster identifier (zero-based integer, stringified). */
  clusterId: string;
  /** Number of candidates in this cluster (1 = singleton). */
  size: number;
  /** The elected centroid/representative candidate. */
  centroid: SemanticDedupeCandidate;
  /** All non-centroid cluster members' URLs and sources. */
  alternates: Array<{ url: string; source: string; phash?: string }>;
  /** Average pairwise Hamming distance within the cluster (0 for singletons). */
  avgIntraHamming: number;
  /** Maximum pairwise Hamming distance within the cluster (0 for singletons). */
  maxIntraHamming: number;
  /** Composite confidence: pHashSim + semantic metadata similarity. */
  compositeConfidence: number;
  /**
   * False-positive risk: risk that visually different images were wrongly merged.
   * High when large metadata dissimilarity co-exists with pHash similarity.
   */
  falsePositiveRisk: RiskLevel;
  /**
   * False-negative risk: risk that the same visual was split into multiple
   * clusters due to compression or alt-source hash variation.
   * High when the cluster centroid has a near-threshold distance to another
   * cluster's centroid.
   */
  falseNegativeRisk: RiskLevel;
  /** Recommended action for operator review. */
  recommendation: "accept" | "review" | "reject";
  /** Number of distinct providers that contributed to this cluster. */
  providerDiversity: number;
  /** Provider ids that contributed. */
  providers: string[];
}

/**
 * Full deduplication quality report returned by `generateDeduplicationReport`.
 */
export interface DeduplicationReport {
  /** Per-cluster reports (singletons are included with size=1). */
  clusters: ClusterReport[];
  /** Convenience: cluster reports where size > 1. */
  multiCandidateClusters: ClusterReport[];
  /** Singleton cluster reports (size = 1). */
  singletons: ClusterReport[];
  /** Overall false-positive risk across the result set. */
  falsePositiveRisk: RiskLevel;
  /** Overall false-negative risk across the result set. */
  falseNegativeRisk: RiskLevel;
  /**
   * Recommended Hamming threshold for this candidate set.
   * Derived from the bimodal gap in pairwise distances.
   */
  recommendedThreshold: number;
  /** Average provider diversity across all multi-candidate clusters. */
  providerDiversity: number;
  /** Total candidates supplied. */
  totalCandidates: number;
  /** Total clusters (including singletons). */
  totalClusters: number;
  /** Fraction of candidates that were deduplicated (merged into a cluster with others). */
  dedupeRate: number;
  /** The options used to produce this report. */
  options: Required<DeduplicationReportOptions>;
  /** ISO-8601 timestamp. */
  generatedAt: string;
}

/**
 * A single row in the CSV/JSON export produced by `exportClusteringMetrics`.
 */
export interface ClusterMetricsRow {
  clusterId: string;
  size: number;
  centroidUrl: string;
  centroidSource: string;
  centroidLicense: string;
  centroidPhash: string;
  avgIntraHamming: number;
  maxIntraHamming: number;
  compositeConfidence: number;
  falsePositiveRisk: RiskLevel;
  falseNegativeRisk: RiskLevel;
  recommendation: string;
  providerDiversity: number;
  providers: string;
  alternateUrls: string;
}

/**
 * Structured result of `exportClusteringMetrics`.
 */
export interface ClusterMetricsExport {
  /** The format used. */
  format: ClusterExportFormat;
  /** The serialised content (CSV string or JSON string). */
  content: string;
  /** Number of rows exported. */
  rowCount: number;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const DEFAULT_PHASH_THRESHOLD = 8;
const DEFAULT_SEMANTIC_WEIGHT = 0.3;
const DEFAULT_CONFIDENCE_FLOOR = 0.5;

/** Hamming distance tolerance for near-threshold false-negative detection. */
const FN_PROXIMITY_DELTA = 3;

// ---------------------------------------------------------------------------
// Levenshtein similarity (for metadata signal)
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

function metaSimilarity(a: ImageCandidate, b: ImageCandidate): number {
  const signals: number[] = [];
  const tA = (a.title ?? "").trim().toLowerCase();
  const tB = (b.title ?? "").trim().toLowerCase();
  if (tA.length > 0 && tB.length > 0) {
    const maxLen = Math.max(tA.length, tB.length);
    signals.push(1 - levenshtein(tA, tB) / maxLen);
  }
  const aA = (a.author ?? "").trim().toLowerCase();
  const aB = (b.author ?? "").trim().toLowerCase();
  if (aA.length > 0 && aB.length > 0) {
    const maxLen = Math.max(aA.length, aB.length);
    signals.push(1 - levenshtein(aA, aB) / maxLen);
  }
  if (signals.length === 0) return 0;
  return signals.reduce((s, v) => s + v, 0) / signals.length;
}

// ---------------------------------------------------------------------------
// Intra-cluster distance stats
// ---------------------------------------------------------------------------

interface IntraStats {
  avg: number;
  max: number;
}

function intraClusterStats(members: ImageCandidate[]): IntraStats {
  if (members.length <= 1) return { avg: 0, max: 0 };
  const distances: number[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const ha = members[i]!.phash;
      const hb = members[j]!.phash;
      if (ha && hb) distances.push(hammingDistance(ha, hb));
    }
  }
  if (distances.length === 0) return { avg: 0, max: 0 };
  const avg = distances.reduce((s, d) => s + d, 0) / distances.length;
  const max = Math.max(...distances);
  return { avg, max };
}

// ---------------------------------------------------------------------------
// Composite confidence
// ---------------------------------------------------------------------------

function clusterCompositeConfidence(
  members: ImageCandidate[],
  semanticWeight: number,
): number {
  if (members.length <= 1) return 1.0;
  const phashWeight = 1 - semanticWeight;

  let phashSimSum = 0;
  let phashPairs = 0;
  let metaSimSum = 0;
  let metaPairs = 0;

  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const ha = members[i]!.phash;
      const hb = members[j]!.phash;
      if (ha && hb) {
        phashSimSum += Math.max(0, 1 - hammingDistance(ha, hb) / 64);
        phashPairs++;
      }
      const ms = metaSimilarity(members[i]!, members[j]!);
      if (ms > 0) {
        metaSimSum += ms;
        metaPairs++;
      }
    }
  }

  const avgPhash = phashPairs > 0 ? phashSimSum / phashPairs : 0;
  const avgMeta = metaPairs > 0 ? metaSimSum / metaPairs : 0;

  return phashWeight * avgPhash + semanticWeight * avgMeta;
}

// ---------------------------------------------------------------------------
// False-positive risk
// ---------------------------------------------------------------------------

/**
 * False-positive: same pHash but different visual (wrongly merged).
 *
 * Risk is elevated when:
 *   - Cluster spans many providers (≥ 3 = medium risk, ≥ 5 = high risk), AND
 *   - Metadata similarity is low (< 0.3 for titles/authors that exist), AND
 *   - Max intra-cluster Hamming is close to or at the threshold.
 */
function assessFalsePositiveRisk(
  members: ImageCandidate[],
  maxIntraHamming: number,
  threshold: number,
  providerCount: number,
): RiskLevel {
  if (members.length <= 1) return "low";

  // Check metadata dissimilarity signals.
  let metaDisagreements = 0;
  let metaPairs = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const ms = metaSimilarity(members[i]!, members[j]!);
      if (ms > 0) {
        metaPairs++;
        if (ms < 0.3) metaDisagreements++;
      }
    }
  }

  const highMetaDisagreement = metaPairs > 0 && metaDisagreements / metaPairs > 0.5;
  const nearThreshold = maxIntraHamming >= threshold * 0.9;
  const wideProviderSpread = providerCount >= 5;

  if (highMetaDisagreement && nearThreshold && wideProviderSpread) return "high";
  if ((highMetaDisagreement && nearThreshold) || wideProviderSpread) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// False-negative risk
// ---------------------------------------------------------------------------

/**
 * False-negative: same visual split across clusters (wrongly separated).
 *
 * Risk is elevated when this cluster's centroid has a Hamming distance to
 * another cluster's centroid that is within FN_PROXIMITY_DELTA of the
 * threshold — suggesting that a slightly different threshold would merge them.
 */
function assessFalseNegativeRisk(
  centroidPhash: string | undefined,
  otherCentroidPhashes: Array<string | undefined>,
  threshold: number,
): RiskLevel {
  if (!centroidPhash) return "low";
  let nearThresholdCount = 0;
  let justOverCount = 0;
  for (const ph of otherCentroidPhashes) {
    if (!ph) continue;
    const dist = hammingDistance(centroidPhash, ph);
    if (dist > threshold && dist <= threshold + FN_PROXIMITY_DELTA) {
      nearThresholdCount++;
      justOverCount++;
    }
  }
  if (justOverCount >= 2) return "high";
  if (nearThresholdCount >= 1) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Overall risk aggregation
// ---------------------------------------------------------------------------

function aggregateRisk(levels: RiskLevel[]): RiskLevel {
  if (levels.some((l) => l === "high")) return "high";
  if (levels.some((l) => l === "medium")) return "medium";
  return "low";
}

// ---------------------------------------------------------------------------
// Recommended threshold
// ---------------------------------------------------------------------------

/**
 * Recommend a threshold based on the bimodal gap in all pairwise Hamming
 * distances across the candidate set.
 *
 * Strategy: build a histogram of pairwise distances and find the gap (the
 * bucket with the fewest pairs) between the dense intra-cluster region and
 * the sparse inter-cluster region. The midpoint of that gap is the recommended
 * threshold.
 *
 * Falls back to the supplied `currentThreshold` when fewer than 2 hashed
 * candidates exist.
 */
function recommendThreshold(
  candidates: ImageCandidate[],
  currentThreshold: number,
): number {
  const hashed = candidates.filter((c) => c.phash);
  if (hashed.length < 2) return currentThreshold;

  // Build distance distribution across all pairs.
  const BUCKETS = 16; // 0..63, bucket width = 4
  const histogram = new Array<number>(BUCKETS).fill(0);
  for (let i = 0; i < hashed.length; i++) {
    for (let j = i + 1; j < hashed.length; j++) {
      const d = hammingDistance(hashed[i]!.phash!, hashed[j]!.phash!);
      const idx = Math.min(Math.floor(d / 4), BUCKETS - 1);
      histogram[idx]!++;
    }
  }

  // Find the gap bucket (min count between bucket 0 and the tail buckets).
  // We only consider buckets in the plausible threshold range [4, 32].
  let minCount = Infinity;
  let gapBucket = Math.floor(currentThreshold / 4);

  for (let b = 1; b <= 8; b++) {
    const count = histogram[b]!;
    if (count < minCount) {
      minCount = count;
      gapBucket = b;
    }
  }

  // Midpoint of the gap bucket (bucket b covers [b*4, (b+1)*4))
  const recommended = gapBucket * 4 + 2;
  return Math.max(1, Math.min(32, recommended));
}

// ---------------------------------------------------------------------------
// Recommendation label
// ---------------------------------------------------------------------------

function clusterRecommendation(
  fpRisk: RiskLevel,
  fnRisk: RiskLevel,
  confidence: number,
  confidenceFloor: number,
): "accept" | "review" | "reject" {
  if (fpRisk === "high" || fnRisk === "high") return "reject";
  if (fpRisk === "medium" || fnRisk === "medium" || confidence < confidenceFloor) return "review";
  return "accept";
}

// ---------------------------------------------------------------------------
// Main public function
// ---------------------------------------------------------------------------

/**
 * Generate a full deduplication quality report for a set of federated image
 * candidates.
 *
 * Combines `clusterCandidatesBySemantic()` (agglomerative pHash clustering)
 * with per-cluster composite confidence, false-positive / false-negative risk
 * assessment, and a recommended threshold derived from the pairwise distance
 * distribution.
 *
 * @param candidates  Flat array of `ImageCandidate` from federated search.
 * @param opts        Tuning parameters (thresholds, weights, floor).
 * @returns           A `DeduplicationReport` ready for export or operator review.
 */
export function generateDeduplicationReport(
  candidates: ImageCandidate[],
  opts: DeduplicationReportOptions = {},
): DeduplicationReport {
  const phashThreshold = Math.max(1, Math.min(32, opts.phashThreshold ?? DEFAULT_PHASH_THRESHOLD));
  const semanticWeight = Math.max(0, Math.min(1, opts.semanticWeight ?? DEFAULT_SEMANTIC_WEIGHT));
  const confidenceFloor = Math.max(0, Math.min(1, opts.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR));

  const resolvedOpts: Required<DeduplicationReportOptions> = {
    phashThreshold,
    semanticWeight,
    confidenceFloor,
  };

  if (candidates.length === 0) {
    return {
      clusters: [],
      multiCandidateClusters: [],
      singletons: [],
      falsePositiveRisk: "low",
      falseNegativeRisk: "low",
      recommendedThreshold: phashThreshold,
      providerDiversity: 0,
      totalCandidates: 0,
      totalClusters: 0,
      dedupeRate: 0,
      options: resolvedOpts,
      generatedAt: new Date().toISOString(),
    };
  }

  // Run semantic deduplication.
  const dedupeResult = clusterCandidatesBySemantic(candidates, {
    hammingThreshold: phashThreshold,
  });

  // Reconstruct member lists for each cluster.
  // SemanticDedupeCluster gives us centroid + alternateUrls; we need the full
  // members for intra-cluster statistics.
  const allClusters: Array<{
    centroid: SemanticDedupeCandidate;
    members: ImageCandidate[];
    isSingleton: boolean;
    avgHamming: number;
  }> = [];

  // Multi-candidate clusters.
  for (const sc of dedupeResult.clusters) {
    const alts: ImageCandidate[] = sc.alternateUrls.map((alt) => {
      // Reconstruct minimal ImageCandidate from alternateUrl metadata.
      const found = candidates.find((c) => c.url === alt.url);
      return found ?? {
        url: alt.url,
        source: alt.source,
        license: alt.license,
        confidence: alt.confidence,
      };
    });
    allClusters.push({
      centroid: sc.centroid,
      members: [sc.centroid, ...alts],
      isSingleton: false,
      avgHamming: sc.avgHamming,
    });
  }

  // Singleton clusters.
  for (const s of dedupeResult.singletons) {
    allClusters.push({
      centroid: s,
      members: [s],
      isSingleton: true,
      avgHamming: 0,
    });
  }

  // Collect all centroid pHashes for cross-cluster false-negative assessment.
  const centroidPhashes = allClusters.map((c) => c.centroid.phash);

  // Recommended threshold from pairwise distance distribution.
  const recommendedThreshold = recommendThreshold(candidates, phashThreshold);

  // Build per-cluster reports.
  const clusterReports: ClusterReport[] = allClusters.map((cl, idx) => {
    const { members, centroid, avgHamming } = cl;

    // Intra-cluster Hamming stats.
    const intra = members.length > 1 ? intraClusterStats(members) : { avg: 0, max: 0 };

    // Provider diversity.
    const providers = [...new Set(members.map((m) => m.source))];
    const providerDiversity = providers.length;

    // Composite confidence.
    const compositeConfidence = clusterCompositeConfidence(members, semanticWeight);

    // False-positive risk.
    const fpRisk = assessFalsePositiveRisk(
      members,
      intra.max,
      phashThreshold,
      providerDiversity,
    );

    // False-negative risk: compare this centroid to all OTHER centroids.
    const otherPhashes = centroidPhashes.filter((_, i) => i !== idx);
    const fnRisk = assessFalseNegativeRisk(
      centroid.phash,
      otherPhashes,
      phashThreshold,
    );

    const recommendation = clusterRecommendation(
      fpRisk,
      fnRisk,
      compositeConfidence,
      confidenceFloor,
    );

    const alternates = cl.centroid.alternateUrls.map((alt) => ({
      url: alt.url,
      source: alt.source,
      phash: candidates.find((c) => c.url === alt.url)?.phash,
    }));

    return {
      clusterId: String(idx),
      size: members.length,
      centroid,
      alternates,
      avgIntraHamming: intra.avg,
      maxIntraHamming: intra.max,
      compositeConfidence,
      falsePositiveRisk: fpRisk,
      falseNegativeRisk: fnRisk,
      recommendation,
      providerDiversity,
      providers,
    };
  });

  // Sort: multi-candidate clusters first (by size desc), then singletons.
  clusterReports.sort((a, b) => b.size - a.size || b.compositeConfidence - a.compositeConfidence);

  const multiCandidateClusters = clusterReports.filter((c) => c.size > 1);
  const singletons = clusterReports.filter((c) => c.size === 1);

  // Overall risk.
  const overallFpRisk = aggregateRisk(multiCandidateClusters.map((c) => c.falsePositiveRisk));
  const overallFnRisk = aggregateRisk(clusterReports.map((c) => c.falseNegativeRisk));

  // Overall provider diversity (average across multi-candidate clusters).
  const avgProviderDiversity =
    multiCandidateClusters.length > 0
      ? multiCandidateClusters.reduce((s, c) => s + c.providerDiversity, 0) /
        multiCandidateClusters.length
      : 0;

  // Dedupe rate: fraction of candidates that were merged (not singletons).
  const mergedCandidates = candidates.length - clusterReports.length;
  const dedupeRate = candidates.length > 0 ? mergedCandidates / candidates.length : 0;

  return {
    clusters: clusterReports,
    multiCandidateClusters,
    singletons,
    falsePositiveRisk: overallFpRisk,
    falseNegativeRisk: overallFnRisk,
    recommendedThreshold,
    providerDiversity: avgProviderDiversity,
    totalCandidates: candidates.length,
    totalClusters: clusterReports.length,
    dedupeRate: Math.max(0, dedupeRate),
    options: resolvedOpts,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Export function
// ---------------------------------------------------------------------------

/**
 * Export clustering metrics from a `DeduplicationReport` in CSV or JSON format
 * for downstream ML tuning and operator review.
 *
 * CSV columns (in order):
 *   clusterId, size, centroidUrl, centroidSource, centroidLicense,
 *   centroidPhash, avgIntraHamming, maxIntraHamming, compositeConfidence,
 *   falsePositiveRisk, falseNegativeRisk, recommendation, providerDiversity,
 *   providers (semicolon-separated), alternateUrls (semicolon-separated)
 *
 * JSON output is a flat array of `ClusterMetricsRow` objects.
 *
 * @param report   The `DeduplicationReport` to export.
 * @param format   `"csv"` or `"json"` (default `"json"`).
 * @returns        A `ClusterMetricsExport` with the serialised content.
 */
export function exportClusteringMetrics(
  report: DeduplicationReport,
  format: ClusterExportFormat = "json",
): ClusterMetricsExport {
  const rows: ClusterMetricsRow[] = report.clusters.map((c) => ({
    clusterId: c.clusterId,
    size: c.size,
    centroidUrl: c.centroid.url,
    centroidSource: c.centroid.source,
    centroidLicense: c.centroid.license,
    centroidPhash: c.centroid.phash ?? "",
    avgIntraHamming: c.avgIntraHamming,
    maxIntraHamming: c.maxIntraHamming,
    compositeConfidence: c.compositeConfidence,
    falsePositiveRisk: c.falsePositiveRisk,
    falseNegativeRisk: c.falseNegativeRisk,
    recommendation: c.recommendation,
    providerDiversity: c.providerDiversity,
    providers: c.providers.join(";"),
    alternateUrls: c.alternates.map((a) => a.url).join(";"),
  }));

  if (format === "json") {
    return {
      format: "json",
      content: JSON.stringify(rows, null, 2),
      rowCount: rows.length,
    };
  }

  // CSV format.
  const CSV_HEADERS: Array<keyof ClusterMetricsRow> = [
    "clusterId",
    "size",
    "centroidUrl",
    "centroidSource",
    "centroidLicense",
    "centroidPhash",
    "avgIntraHamming",
    "maxIntraHamming",
    "compositeConfidence",
    "falsePositiveRisk",
    "falseNegativeRisk",
    "recommendation",
    "providerDiversity",
    "providers",
    "alternateUrls",
  ];

  function escapeCsv(v: string | number): string {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const lines: string[] = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(CSV_HEADERS.map((h) => escapeCsv(row[h])).join(","));
  }

  return {
    format: "csv",
    content: lines.join("\n"),
    rowCount: rows.length,
  };
}
