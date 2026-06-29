/**
 * Candidate ranking. MIRROR of factory's pick.ts with two additions:
 *   - respects `licensePolicy` (open-only / safe-only / context-safe / prefer-safe / any)
 *   - folds `confidence` into the tie-break chain
 *
 * Decision order (license-first; see README LICENSE_POLICY):
 *   1. If policy is open-only, reject editorial/press and unknown licenses.
 *   2. If policy is safe-only/context-safe, reject only UNKNOWN.
 *   3. Lower LICENSE_RANK wins.
 *   4. Higher license confidence wins.
 *   5. Higher pixel count wins.
 *   6. Completeness (author/sourcePageUrl/title) wins.
 *   7. Stable index order.
 */

import { LICENSE_RANK, isContextSafeLicense, isOpenLicense } from "./license.ts";
import { getMetadataQualityScore } from "./attribution-audit.ts";
import type {
  ConfidenceGap,
  ImageCandidate,
  LicensePolicy,
  PhashDedupeMetrics,
  RefinementPlan,
  SearchResultBundle,
  UpgradePathStep,
} from "./types.ts";

export interface PickConstraints {
  minWidth?: number;
  minHeight?: number;
  requireSafeLicense?: boolean;
  licensePolicy?: LicensePolicy;
}

export function pickBest(
  candidates: readonly ImageCandidate[],
  constraints: PickConstraints = {},
): ImageCandidate | null {
  const ranked = rankAll(candidates, constraints);
  return ranked[0] ?? null;
}

export function rankAll(
  candidates: readonly ImageCandidate[],
  c: PickConstraints = {},
): ImageCandidate[] {
  const policy = normalizeLicensePolicy(
    c.licensePolicy ?? (c.requireSafeLicense === false ? "any" : "safe-only"),
  );
  const minW = c.minWidth ?? 0;
  const minH = c.minHeight ?? 0;

  type Scored = {
    cand: ImageCandidate;
    rank: number;
    pixels: number;
    complete: number;
    conf: number;
    /** Audit-trail confidence (0..1). Used as tie-breaker between `conf` and `metaQuality`. */
    trailConf: number;
    /** Metadata quality score (0..1). Tertiary tie-breaker after license-conf + trail-conf. */
    metaQuality: number;
    idx: number;
  };
  const scored: Scored[] = [];

  candidates.forEach((cand, idx) => {
    const open = isOpenLicense(cand.license);
    const contextSafe = isContextSafeLicense(cand.license);
    if (policy === "open-only" && !open) return;
    if (policy === "context-safe" && !contextSafe) return;
    const w = cand.width ?? 0;
    const h = cand.height ?? 0;
    if (w > 0 && w < minW) return;
    if (h > 0 && h < minH) return;

    // Resolve phash confidence: prefer phashResult.confidence (carries decay
    // information) over the top-level confidence field for tie-breaking.
    // This ensures that candidates from timed-out providers (which have had
    // their phashResult.confidence decayed by 15%) rank behind undecayed ones.
    const phashConf = cand.phashResult?.confidence ?? null;
    const licenseConf = cand.confidence ?? (contextSafe ? 0.5 : 0);
    // Use the lower of license confidence and phash confidence when both are
    // present, so any decay in either dimension is reflected in the sort key.
    const effectiveConf = phashConf !== null ? Math.min(licenseConf, phashConf) : licenseConf;

    scored.push({
      cand,
      rank: LICENSE_RANK[cand.license],
      pixels: w * h,
      complete: (cand.author ? 1 : 0) + (cand.sourcePageUrl ? 1 : 0) + (cand.title ? 1 : 0),
      conf: effectiveConf,
      // Prefer candidates whose license was derived from authoritative metadata
      // (api-metadata > embedded-metadata > heuristic-url > fallback).
      trailConf: cand.licenseAuditTrail?.confidence ?? 0,
      // Metadata quality score: weighted confidence across author/title/sourcePageUrl fields.
      metaQuality: getMetadataQualityScore(cand),
      idx,
    });
  });

  // For prefer-safe: stable-sort unsafe behind context-safe, but do not drop them.
  scored.sort((a, b) => {
    if (policy === "prefer-safe") {
      const aSafe = a.rank < 99 ? 0 : 1;
      const bSafe = b.rank < 99 ? 0 : 1;
      if (aSafe !== bSafe) return aSafe - bSafe;
    }
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.conf !== b.conf) return b.conf - a.conf;
    // Audit-trail confidence as tie-breaker: higher provenance quality wins.
    if (a.trailConf !== b.trailConf) return b.trailConf - a.trailConf;
    // Metadata quality score: weighted author/title/sourcePageUrl field confidence.
    if (a.metaQuality !== b.metaQuality) return b.metaQuality - a.metaQuality;
    if (a.pixels !== b.pixels) return b.pixels - a.pixels;
    if (a.complete !== b.complete) return b.complete - a.complete;
    return a.idx - b.idx;
  });

  return scored.map((s, i) => ({
    ...s.cand,
    score: 1 / (i + 1), // simple monotonically decreasing score
  }));
}

function normalizeLicensePolicy(policy: LicensePolicy): Exclude<LicensePolicy, "safe-only"> {
  return policy === "safe-only" ? "context-safe" : policy;
}

// ---------------------------------------------------------------------------
// Refinement — post-process a SearchResultBundle to identify gaps and suggest
// actions an agent can take to improve license-confidence.
// ---------------------------------------------------------------------------

/** Confidence below this threshold is considered "low" for refinement purposes. */
const LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Analyse a `SearchResultBundle` and produce a `RefinementPlan` that tells
 * agents which candidates need attention and what actions would help.
 *
 * Decision logic:
 *  - Candidates with `license === "UNKNOWN"` → `fallback-to-open-only`
 *  - Candidates with `confidence < LOW_CONFIDENCE_THRESHOLD` that have a
 *    `sourcePageUrl` → `probe-page` (fetch the page for richer metadata)
 *  - Remaining low-confidence candidates → `upgrade-provider`
 *
 * The `upgradePath` is built from the observed gap ratio:
 *  - When > 50% of results are low-confidence → suggest `open-only` first
 *  - Always suggest `prefer-safe` as a lighter-weight step
 *  - Always suggest `context-safe` / `any` for completeness
 *
 * @param bundle     The SearchResultBundle to analyse.
 * @param opts.confidenceThreshold  Override the default 0.5 threshold.
 * @param opts.highConfidenceProviders  Provider ids already known to be reliable
 *   (e.g. from federation diagnostics). Passed through into the plan.
 */
export function refineSearchResults(
  bundle: SearchResultBundle,
  opts: {
    confidenceThreshold?: number;
    highConfidenceProviders?: string[];
  } = {},
): RefinementPlan {
  const threshold = opts.confidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
  const { candidates } = bundle;

  const confidenceGaps: ConfidenceGap[] = [];
  let unknownCount = 0;

  candidates.forEach((cand, idx) => {
    const conf = cand.confidence ?? (isContextSafeLicense(cand.license) ? 0.5 : 0);
    const isLowConf = conf < threshold;
    const isUnknown = cand.license === "UNKNOWN";

    if (isUnknown) unknownCount++;

    if (!isLowConf && !isUnknown) return;

    let suggestedAction: ConfidenceGap["suggestedAction"];
    let reason: string;

    if (isUnknown) {
      suggestedAction = "fallback-to-open-only";
      reason =
        "License is UNKNOWN — switch to open-only policy to guarantee CC/public-domain results only.";
    } else if (cand.sourcePageUrl) {
      suggestedAction = "probe-page";
      reason = `Low confidence (${conf.toFixed(2)}) but sourcePageUrl is available — probing the source page may surface structured license metadata.`;
    } else {
      suggestedAction = "upgrade-provider";
      reason = `Low confidence (${conf.toFixed(2)}) and no sourcePageUrl — try a provider with authoritative structured metadata (e.g. wikimedia, openverse, unsplash).`;
    }

    confidenceGaps.push({
      candidateIndex: idx,
      candidate: cand,
      currentConfidence: conf,
      suggestedAction,
      reason,
    });
  });

  const total = candidates.length;
  const lowCount = confidenceGaps.length;
  const gapRatio = total > 0 ? lowCount / total : 0;

  // Build upgrade path ordered by expected confidence gain (highest first).
  const upgradePath: UpgradePathStep[] = [];

  if (gapRatio > 0.5 || unknownCount > 0) {
    upgradePath.push({
      targetLicensePolicy: "open-only",
      expectedConfidenceGain: 0.9,
      rationale:
        "Restricting to open-only (CC/public-domain) sources eliminates UNKNOWN results entirely — providers like Wikimedia and Openverse supply structured per-file license metadata.",
    });
  }

  upgradePath.push({
    targetLicensePolicy: "prefer-safe",
    expectedConfidenceGain: 0.4,
    rationale:
      "prefer-safe keeps all results but sorts low-confidence ones to the back — a lighter step that preserves coverage while surfacing safer results first.",
  });

  if (gapRatio <= 0.5 && unknownCount === 0) {
    // Already mostly good — suggest context-safe as a mild tightening.
    upgradePath.push({
      targetLicensePolicy: "context-safe",
      expectedConfidenceGain: 0.2,
      rationale:
        "context-safe drops only UNKNOWN results while retaining editorial/platform-licensed images — small confidence gain with minimal coverage loss.",
    });
  }

  upgradePath.push({
    targetLicensePolicy: "any",
    expectedConfidenceGain: 0,
    rationale:
      "Accepting any license maximises coverage but makes no confidence guarantee — only appropriate when the caller will independently verify each result.",
  });

  return {
    confidenceGaps,
    upgradePath,
    highConfidenceProviders: opts.highConfidenceProviders ?? [],
    summary: {
      totalCandidates: total,
      lowConfidenceCount: lowCount,
      unknownLicenseCount: unknownCount,
      gapRatio,
    },
  };
}

// ---------------------------------------------------------------------------
// pHash dedup metrics extraction
// ---------------------------------------------------------------------------

/**
 * Extract pHash dedup metrics from a `SearchResultBundle`.
 *
 * Returns the metrics attached by the `dedupeImagesByPhash` pass in federation,
 * or a zeroed metrics object when pHash dedup was not run (e.g. `phashDedup:
 * false` was set or the bundle was produced by an older version).
 *
 * Useful for agents and UIs that want to display dedup statistics without
 * needing to import from `dedupe.ts` directly.
 *
 * @example
 * ```ts
 * const bundle = await searchImages(query);
 * const metrics = extractPhashDedupeMetrics(bundle);
 * console.log(`${metrics.clusterCount} visual clusters, ${metrics.totalDeduplicated} duplicates removed`);
 * ```
 */
export function extractPhashDedupeMetrics(bundle: SearchResultBundle): PhashDedupeMetrics {
  return bundle.phashDedupeResult?.metrics ?? {
    clusterCount: 0,
    totalDeduplicated: 0,
    avgClusterSize: 0,
    avgIntraClusterHammingDistance: 0,
  };
}
