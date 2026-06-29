/**
 * Multi-provider license reconciliation with confidence scoring and conflict audit.
 *
 * When multiple providers return results for the same image (via pHash dedup or
 * user intent), they may assign different licenses. This module:
 *
 *  1. Groups candidates by pHash (or URL when no pHash is available).
 *  2. For each group, computes Levenshtein similarity on license strings.
 *  3. If similarity > CONSENSUS_THRESHOLD (0.85) across all pairs → consensus.
 *  4. Otherwise, flags conflicts and emits a structured audit trail with
 *     per-provider reasoning and a human-readable recommendation.
 *
 * The `confidence` output decays when individual candidates carry low
 * license-confidence scores — so an agent can distinguish "three providers
 * agree with high certainty" from "three providers agree but all had weak
 * evidence".
 */

import type { ImageCandidate, License } from "./types.ts";
import { LICENSE_RANK } from "./license.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single piece of evidence that contributed to a provider's license assertion.
 *
 * - `field`          — the candidate field inspected (e.g. `"licenseUrl"`, `"license"`,
 *   `"sourcePageUrl"`, `"licenseAuditTrail.source"`).
 * - `rawValue`       — the raw string value observed in that field.
 * - `interpretation` — human-readable explanation of how the value was
 *   interpreted (e.g. `"CC_BY_SA inferred from URL pattern"`).
 */
export interface LicenseEvidenceItem {
  field: string;
  rawValue: string;
  interpretation: string;
}

/**
 * One entry in the per-provider conflict log.
 *
 * - `provider`        — provider id (e.g. "wikimedia", "unsplash").
 * - `assertedLicense` — the `License` tag this provider returned.
 * - `reasoning`       — human-readable description of why the license was
 *   assigned (derived from `licenseAuditTrail.provenance` when available,
 *   or generated from candidate metadata).
 * - `licenseConfidence` — the per-candidate license-confidence (0..1).
 * - `evidence`        — structured evidence chain: each item records which
 *   field was examined, the raw value observed, and how it was interpreted.
 *   Enables downstream auditors to trace exactly how a license was inferred.
 */
export interface LicenseConflictEntry {
  provider: string;
  assertedLicense: License;
  reasoning: string;
  licenseConfidence: number;
  evidence: LicenseEvidenceItem[];
}

/**
 * Result of `reconcileLicenses()`.
 *
 * - `consensusLicense` — the agreed-upon license (majority or unanimous).
 *   When there is no majority, the most-open license among the largest camp
 *   is chosen (lower LICENSE_RANK = more open = preferred).
 * - `confidence`        — 0..1. 1.0 = unanimous agreement with high per-source
 *   confidence. Decays with disagreement and low per-candidate confidence.
 * - `conflictCount`     — number of providers that disagreed with the consensus.
 * - `conflictLog`       — full per-provider audit trail for legal review.
 * - `recommendation`    — human-readable guidance for operators/agents.
 */
export interface LicenseReconciliationResult {
  consensusLicense: License;
  confidence: number;
  conflictCount: number;
  conflictLog: LicenseConflictEntry[];
  recommendation: string;
}

/**
 * Result of `scoreLicenseConsensus()`.
 *
 * - `consensusLicense`     — the license selected as the authority-weighted consensus.
 * - `authorityScore`       — 0..1 weighted authority of the winning license assertion.
 *   1.0 = all votes came from highest-authority sources (e.g. Wikimedia structured metadata).
 * - `conflictJustification` — narrative explanation of why this license was chosen
 *   even in the presence of conflicting provider assertions.
 */
export interface LicenseConsensusScore {
  consensusLicense: License;
  authorityScore: number;
  conflictJustification: string;
}

/**
 * Result of `recommendLicenseUpgrade()`.
 *
 * - `recommendedLicense` — the license the operator should target.
 * - `confidence`         — 0..1 confidence that this upgrade is safe to apply.
 * - `rationale`          — human-readable explanation of why this upgrade was
 *   recommended (including which signals drove the decision).
 * - `upgradeApplicable`  — false when no upgrade path was identified (current
 *   license is already optimal or evidence is insufficient).
 */
export interface LicenseUpgradeRecommendation {
  recommendedLicense: License;
  confidence: number;
  rationale: string;
  upgradeApplicable: boolean;
}

/**
 * One entry in the `reconcileLicensesBatch()` result array.
 *
 * - `groupKey`      — the pHash-prefix or URL key that identifies this group.
 * - `candidateUrls` — all URLs belonging to this dedupe group.
 * - `providers`     — all provider ids that contributed to this group.
 * - `result`        — the reconciliation result for this group.
 */
export interface BatchReconciliationEntry {
  groupKey: string;
  candidateUrls: string[];
  providers: string[];
  result: LicenseReconciliationResult;
}

/**
 * Result of `reconcileLicensesBatch()`.
 *
 * - `entries`           — one entry per dedupe group, ordered largest-group-first.
 * - `totalGroups`       — number of distinct image groups found.
 * - `totalCandidates`   — total number of input candidates processed.
 * - `highConflictCount` — number of groups whose `conflictCount > 0`.
 * - `legalReviewNeeded` — true when any group has conflictCount >= 2 or
 *   consensusLicense === "UNKNOWN".
 */
export interface BatchReconciliationResult {
  entries: BatchReconciliationEntry[];
  totalGroups: number;
  totalCandidates: number;
  highConflictCount: number;
  legalReviewNeeded: boolean;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/**
 * Levenshtein similarity threshold above which two license strings are
 * considered the "same" for consensus purposes.
 *
 * 0.85 allows for minor formatting differences (e.g. "CC_BY_SA" vs
 * "CC-BY-SA") while still catching genuinely different licenses.
 */
const CONSENSUS_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Levenshtein similarity (0..1, 1 = identical strings)
// ---------------------------------------------------------------------------

/**
 * Compute normalised Levenshtein similarity between two strings.
 *
 * similarity = 1 - (editDistance / max(|a|, |b|))
 *
 * Returns 1 when both strings are empty.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 && lb === 0) return 1;
  if (la === 0 || lb === 0) return 0;

  // Standard DP with two rows to save memory.
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  let curr = new Array<number>(lb + 1);

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }

  const dist = prev[lb] ?? 0;
  return 1 - dist / Math.max(la, lb);
}

// ---------------------------------------------------------------------------
// Grouping helpers
// ---------------------------------------------------------------------------

/**
 * Group candidates by pHash (first 8 hex chars for tolerance) falling back
 * to exact URL when no pHash is present.
 *
 * Returns an array of groups, each group being a non-empty array of candidates.
 */
function groupCandidates(candidates: ImageCandidate[]): ImageCandidate[][] {
  const groups = new Map<string, ImageCandidate[]>();

  for (const c of candidates) {
    // Use the first 8 chars of pHash as a fuzzy bucket key (tolerates minor
    // re-encoding differences while still grouping near-duplicates together).
    const key =
      c.phash && c.phash.length >= 8
        ? `phash:${c.phash.slice(0, 8).toLowerCase()}`
        : `url:${c.url}`;

    const group = groups.get(key);
    if (group) {
      group.push(c);
    } else {
      groups.set(key, [c]);
    }
  }

  return Array.from(groups.values());
}

// ---------------------------------------------------------------------------
// Evidence chain extraction
// ---------------------------------------------------------------------------

/**
 * CC URL patterns that map to known license tags.
 * Used to extract evidence from `licenseUrl` fields.
 */
const CC_URL_PATTERNS: Array<{ pattern: RegExp; license: License; label: string }> = [
  { pattern: /creativecommons\.org\/publicdomain\/zero/i, license: "CC0", label: "CC0 Public Domain Dedication" },
  { pattern: /creativecommons\.org\/licenses\/by-sa/i, license: "CC_BY_SA", label: "CC BY-SA" },
  { pattern: /creativecommons\.org\/licenses\/by\//i, license: "CC_BY", label: "CC BY" },
  { pattern: /creativecommons\.org\/publicdomain\/mark/i, license: "PUBLIC_DOMAIN", label: "Public Domain Mark" },
  { pattern: /unsplash\.com\/license/i, license: "UNSPLASH_LICENSE", label: "Unsplash License" },
  { pattern: /pexels\.com\/license/i, license: "PEXELS_LICENSE", label: "Pexels License" },
  { pattern: /pixabay\.com\/service\/license/i, license: "PIXABAY_LICENSE", label: "Pixabay License" },
];

/**
 * Authority weights per provider id. Higher = more authoritative license source.
 * Sources with structured API metadata get the highest weight; heuristic-only
 * sources get the lowest.
 */
const PROVIDER_AUTHORITY: Record<string, number> = {
  wikimedia: 0.95,
  openverse: 0.85,
  "met-museum": 0.90,
  smithsonian: 0.90,
  europeana: 0.85,
  "library-of-congress": 0.90,
  "wellcome-collection": 0.85,
  "internet-archive": 0.80,
  nasa: 0.90,
  rawpixel: 0.75,
  unsplash: 0.80,
  pexels: 0.80,
  pixabay: 0.80,
  flickr: 0.60,
  burst: 0.70,
  openverse_fallback: 0.65,
  brave: 0.40,
  bing: 0.35,
  serpapi: 0.35,
  browser: 0.30,
  "managed-browser": 0.30,
  "youtube-thumb": 0.50,
  "itunes": 0.55,
  "musicbrainz-caa": 0.65,
  spotify: 0.55,
};

/**
 * Providers whose URL host patterns indicate Commons-hosted content.
 * Used by `recommendLicenseUpgrade` to suggest CC_BY_SA upgrades.
 */
const COMMONS_HOST_PATTERNS = [
  /commons\.wikimedia\.org/i,
  /upload\.wikimedia\.org/i,
  /openverse\.org/i,
  /europeana\.eu/i,
  /loc\.gov/i,
  /si\.edu/i,
  /wellcomecollection\.org/i,
];

function isCommonsHost(url: string): boolean {
  return COMMONS_HOST_PATTERNS.some((p) => p.test(url));
}

/**
 * Build a structured evidence chain for one candidate.
 *
 * Inspects `license`, `licenseUrl`, `sourcePageUrl`, `licenseAuditTrail`,
 * and provider-specific URL patterns to produce an ordered list of evidence
 * items that explain how the license assertion was reached.
 */
export function buildEvidenceChain(c: ImageCandidate): LicenseEvidenceItem[] {
  const evidence: LicenseEvidenceItem[] = [];

  // 1. The asserted license enum itself is always first evidence.
  evidence.push({
    field: "license",
    rawValue: c.license,
    interpretation: `Provider "${c.source}" directly asserted license tag "${c.license}".`,
  });

  // 2. licenseUrl — attempt CC URL pattern match.
  if (c.licenseUrl) {
    const matched = CC_URL_PATTERNS.find((e) => e.pattern.test(c.licenseUrl!));
    if (matched) {
      evidence.push({
        field: "licenseUrl",
        rawValue: c.licenseUrl,
        interpretation: `${matched.label} inferred from URL pattern (matched ${matched.pattern.source}).`,
      });
    } else {
      evidence.push({
        field: "licenseUrl",
        rawValue: c.licenseUrl,
        interpretation: `License URL present but did not match any known CC/platform pattern; treated as supporting evidence only.`,
      });
    }
  }

  // 3. licenseAuditTrail — if present, surface source + flags.
  if (c.licenseAuditTrail) {
    const trail = c.licenseAuditTrail;
    evidence.push({
      field: "licenseAuditTrail.source",
      rawValue: trail.source,
      interpretation:
        `License determination source: "${trail.source}" ` +
        `(confidence=${trail.confidence.toFixed(2)}` +
        (trail.flags.length > 0 ? `; flags: ${trail.flags.join(", ")}` : "") +
        `). ${trail.provenance}`,
    });
  }

  // 4. sourcePageUrl — check for Commons host patterns.
  if (c.sourcePageUrl) {
    if (isCommonsHost(c.sourcePageUrl)) {
      evidence.push({
        field: "sourcePageUrl",
        rawValue: c.sourcePageUrl,
        interpretation: `Source page URL matches a Commons/open-archive host pattern — corroborates an open license.`,
      });
    } else {
      evidence.push({
        field: "sourcePageUrl",
        rawValue: c.sourcePageUrl,
        interpretation: `Source page URL present; no known open-archive host pattern matched.`,
      });
    }
  }

  // 5. confidence field — note if it is suspiciously low.
  if (c.confidence !== undefined) {
    evidence.push({
      field: "confidence",
      rawValue: c.confidence.toFixed(3),
      interpretation:
        c.confidence < 0.4
          ? `Per-candidate confidence is low (${(c.confidence * 100).toFixed(0)}%); license may be a heuristic guess.`
          : `Per-candidate confidence is ${(c.confidence * 100).toFixed(0)}%.`,
    });
  }

  return evidence;
}

// ---------------------------------------------------------------------------
// Per-candidate reasoning
// ---------------------------------------------------------------------------

function buildReasoning(c: ImageCandidate): string {
  if (c.licenseAuditTrail?.provenance) {
    return c.licenseAuditTrail.provenance;
  }
  const parts: string[] = [`Provider "${c.source}" asserted license "${c.license}"`];
  if (c.licenseUrl) parts.push(`with licenseUrl "${c.licenseUrl}"`);
  if (c.confidence !== undefined) parts.push(`(confidence=${c.confidence.toFixed(2)})`);
  return parts.join(" ") + ".";
}

// ---------------------------------------------------------------------------
// Single-group reconciliation
// ---------------------------------------------------------------------------

function reconcileGroup(group: ImageCandidate[]): LicenseReconciliationResult {
  // Build conflict log for every candidate in the group.
  const conflictLog: LicenseConflictEntry[] = group.map((c) => ({
    provider: c.source,
    assertedLicense: c.license,
    reasoning: buildReasoning(c),
    licenseConfidence: c.confidence ?? 0.5,
    evidence: buildEvidenceChain(c),
  }));

  if (group.length === 1) {
    const only = group[0]!;
    const conf = only.confidence ?? 0.5;
    return {
      consensusLicense: only.license,
      confidence: conf,
      conflictCount: 0,
      conflictLog,
      recommendation:
        `Only one provider ("${only.source}") contributed to this group; ` +
        `confidence is ${(conf * 100).toFixed(0)}%. ` +
        "Consider querying additional providers for cross-validation.",
    };
  }

  // Tally license votes and compute inter-provider similarity.
  const licenseCounts = new Map<License, number>();
  for (const c of group) {
    licenseCounts.set(c.license, (licenseCounts.get(c.license) ?? 0) + 1);
  }

  // Find the majority license (most votes; ties broken by lower LICENSE_RANK = more open).
  let majorityLicense: License = "UNKNOWN";
  let maxVotes = 0;
  for (const [lic, count] of licenseCounts) {
    if (
      count > maxVotes ||
      (count === maxVotes && (LICENSE_RANK[lic] ?? 99) < (LICENSE_RANK[majorityLicense] ?? 99))
    ) {
      majorityLicense = lic;
      maxVotes = count;
    }
  }

  const totalProviders = group.length;
  const conflictCount = totalProviders - maxVotes;

  // Compute pairwise Levenshtein similarity on license string pairs.
  // If ALL pairs are above CONSENSUS_THRESHOLD → full consensus.
  let minPairwiseSim = 1;
  const licenses = group.map((c) => c.license);
  for (let i = 0; i < licenses.length; i++) {
    for (let j = i + 1; j < licenses.length; j++) {
      const sim = levenshteinSimilarity(licenses[i]!, licenses[j]!);
      if (sim < minPairwiseSim) minPairwiseSim = sim;
    }
  }

  const isConsensus = minPairwiseSim >= CONSENSUS_THRESHOLD;

  // Confidence = base agreement factor × average candidate confidence, decayed
  // by the fraction of providers that disagreed.
  const agreementRatio = maxVotes / totalProviders;
  const avgCandidateConf =
    group.reduce((sum, c) => sum + (c.confidence ?? 0.5), 0) / totalProviders;
  const levenshteinFactor = isConsensus ? 1 : minPairwiseSim;
  const confidence = Math.max(0, Math.min(1, agreementRatio * avgCandidateConf * levenshteinFactor));

  // Build human-readable recommendation.
  let recommendation: string;
  if (conflictCount === 0 && isConsensus) {
    recommendation =
      `All ${totalProviders} provider(s) unanimously agree on "${majorityLicense}". ` +
      `Composite confidence: ${(confidence * 100).toFixed(0)}%.`;
  } else if (conflictCount === 0) {
    // Same license enum but Levenshtein < 1 — shouldn't normally happen since
    // we compare the canonical License strings, but handle defensively.
    recommendation =
      `All providers returned "${majorityLicense}" but string similarity ` +
      `is ${(minPairwiseSim * 100).toFixed(0)}% — minor formatting difference. ` +
      `Composite confidence: ${(confidence * 100).toFixed(0)}%.`;
  } else if (conflictCount === 1) {
    const outlier = conflictLog.find((e) => e.assertedLicense !== majorityLicense);
    recommendation =
      `${maxVotes}/${totalProviders} provider(s) agree on "${majorityLicense}"; ` +
      `1 outlier ("${outlier?.provider ?? "unknown"}" → "${outlier?.assertedLicense ?? "?"}"). ` +
      `Verify the outlier manually before publishing. ` +
      `Composite confidence: ${(confidence * 100).toFixed(0)}%.`;
  } else {
    const campDescriptions = Array.from(licenseCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([lic, cnt]) => `"${lic}" (${cnt}×)`)
      .join(", ");
    recommendation =
      `Split license decision detected across ${totalProviders} provider(s): ${campDescriptions}. ` +
      `Defaulting to most-open majority license "${majorityLicense}". ` +
      `Legal review is strongly recommended before publishing. ` +
      `Composite confidence: ${(confidence * 100).toFixed(0)}%.`;
  }

  return {
    consensusLicense: majorityLicense,
    confidence,
    conflictCount,
    conflictLog,
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconcile licenses across multiple `ImageCandidate` objects that may
 * represent the same image from different providers.
 *
 * Candidates are first grouped by pHash proximity (or URL as fallback), then
 * each group is reconciled independently. When there is more than one group,
 * the result for the **largest** group is returned (most evidence).
 *
 * @param candidates - Array of `ImageCandidate` objects (≥1).
 * @returns          - `LicenseReconciliationResult` for the primary group.
 */
export function reconcileLicenses(candidates: ImageCandidate[]): LicenseReconciliationResult {
  if (candidates.length === 0) {
    return {
      consensusLicense: "UNKNOWN",
      confidence: 0,
      conflictCount: 0,
      conflictLog: [],
      recommendation: "No candidates provided; cannot reconcile.",
    };
  }

  const groups = groupCandidates(candidates);

  // Pick the largest group as the primary reconciliation target.
  // Ties broken by index (first group = first URL seen).
  let primaryGroup = groups[0]!;
  for (const g of groups) {
    if (g.length > primaryGroup.length) primaryGroup = g;
  }

  return reconcileGroup(primaryGroup);
}

/**
 * Reconcile licenses for **every** group independently and return an array of
 * results (one per group, ordered largest-group-first).
 *
 * Useful when an agent passes a heterogeneous candidate pool and wants
 * per-image-cluster diagnostics.
 */
export function reconcileLicensesAll(
  candidates: ImageCandidate[],
): LicenseReconciliationResult[] {
  if (candidates.length === 0) return [];
  const groups = groupCandidates(candidates);
  // Sort largest-first for deterministic ordering.
  groups.sort((a, b) => b.length - a.length);
  return groups.map(reconcileGroup);
}

// ---------------------------------------------------------------------------
// Authority-weighted consensus scoring
// ---------------------------------------------------------------------------

/**
 * Compute a provider authority weight for a given provider id.
 *
 * Returns a value in [0..1]. Unknown providers default to 0.5.
 */
function getProviderAuthority(providerId: string): number {
  return PROVIDER_AUTHORITY[providerId] ?? 0.5;
}

/**
 * Compute an authority-weighted consensus score for a group of candidates.
 *
 * Unlike `reconcileLicenses` (which uses simple majority + Levenshtein), this
 * function weights each vote by the authority of the source provider.  The
 * winning license is the one with the highest **total authority weight**.
 *
 * Tie-breaking: when two licenses have equal authority weight, the more-open
 * license (lower `LICENSE_RANK`) is preferred.
 *
 * `authorityScore` (0..1) is the fraction of total authority weight captured
 * by the winning license.  1.0 means all evidence came from high-authority
 * sources and they all agreed; values near 0 indicate weak or split evidence.
 *
 * @param candidates - Non-empty array of `ImageCandidate` objects.
 * @returns `LicenseConsensusScore`
 */
export function scoreLicenseConsensus(candidates: ImageCandidate[]): LicenseConsensusScore {
  if (candidates.length === 0) {
    return {
      consensusLicense: "UNKNOWN",
      authorityScore: 0,
      conflictJustification: "No candidates provided; cannot compute authority-weighted consensus.",
    };
  }

  // Accumulate authority weight per license.
  const authorityByLicense = new Map<License, number>();
  let totalAuthority = 0;

  for (const c of candidates) {
    // Base authority from provider identity.
    let authority = getProviderAuthority(c.source);

    // Boost when the candidate carries structured audit trail evidence.
    if (c.licenseAuditTrail) {
      const boost =
        c.licenseAuditTrail.source === "api-metadata" ? 0.15 :
        c.licenseAuditTrail.source === "embedded-metadata" ? 0.10 :
        c.licenseAuditTrail.source === "heuristic-url" ? 0.02 :
        0;
      authority = Math.min(1, authority + boost);
    }

    // Scale by per-candidate confidence.
    const conf = c.confidence ?? 0.5;
    const weightedAuthority = authority * conf;

    authorityByLicense.set(
      c.license,
      (authorityByLicense.get(c.license) ?? 0) + weightedAuthority,
    );
    totalAuthority += weightedAuthority;
  }

  // Select the license with the highest authority weight; break ties with rank.
  let consensusLicense: License = "UNKNOWN";
  let maxWeight = -1;
  for (const [lic, weight] of authorityByLicense) {
    if (
      weight > maxWeight ||
      (weight === maxWeight &&
        (LICENSE_RANK[lic] ?? 99) < (LICENSE_RANK[consensusLicense] ?? 99))
    ) {
      consensusLicense = lic;
      maxWeight = weight;
    }
  }

  const authorityScore =
    totalAuthority > 0 ? Math.min(1, maxWeight / totalAuthority) : 0;

  // Build a conflict justification narrative.
  const licenseDescriptions = Array.from(authorityByLicense.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([lic, w]) => `"${lic}" (authority-weight=${w.toFixed(3)})`)
    .join(", ");

  let conflictJustification: string;
  if (authorityByLicense.size === 1) {
    conflictJustification =
      `All providers unanimously assert "${consensusLicense}" ` +
      `(authority-score=${authorityScore.toFixed(3)}).`;
  } else {
    const dominantProvider = candidates
      .filter((c) => c.license === consensusLicense)
      .sort((a, b) => getProviderAuthority(b.source) - getProviderAuthority(a.source))[0];
    conflictJustification =
      `Authority-weighted consensus selected "${consensusLicense}" ` +
      `(authority-score=${authorityScore.toFixed(3)}) over competing assertions: ${licenseDescriptions}. ` +
      (dominantProvider
        ? `Highest-authority supporting source: "${dominantProvider.source}" ` +
          `(authority=${getProviderAuthority(dominantProvider.source).toFixed(2)}).`
        : "");
  }

  return { consensusLicense, authorityScore, conflictJustification };
}

// ---------------------------------------------------------------------------
// License upgrade path recommendation
// ---------------------------------------------------------------------------

/**
 * Recommend a license upgrade path for a group of candidates.
 *
 * Two heuristic rules are applied in order:
 *
 *  (a) **UNKNOWN + Commons host signal**: if the current reconciled license
 *      is `UNKNOWN` but at least one provider is Brave/Bing/serpapi AND one
 *      candidate's `sourcePageUrl` or `url` matches a known Commons host
 *      pattern, recommend upgrading to `CC_BY_SA` with moderate confidence.
 *
 *  (b) **Mixed but all commercially-permissive**: if there is a license
 *      conflict but every distinct license in the group is commercially
 *      permissive (CC0, PUBLIC_DOMAIN, CC_BY, CC_BY_SA, UNSPLASH_LICENSE,
 *      PEXELS_LICENSE, PIXABAY_LICENSE), recommend consolidating under
 *      `UNSPLASH_LICENSE` (the most conservative commercially-permissive
 *      platform license) — or the most-open open license when all licenses
 *      are fully open (CC0/PD/CC_BY/CC_BY_SA).
 *
 * Returns `upgradeApplicable: false` when neither rule fires (e.g. the
 * current license is already optimal or evidence is insufficient).
 *
 * @param candidates       - Array of candidates in the group.
 * @param reconciled       - Pre-computed reconciliation result for this group.
 * @returns `LicenseUpgradeRecommendation`
 */
export function recommendLicenseUpgrade(
  candidates: ImageCandidate[],
  reconciled: LicenseReconciliationResult,
): LicenseUpgradeRecommendation {
  const distinctLicenses = new Set(candidates.map((c) => c.license));

  // ---------------------------------------------------------------------------
  // Rule (a): UNKNOWN + Commons host pattern detected
  // ---------------------------------------------------------------------------
  if (reconciled.consensusLicense === "UNKNOWN") {
    const heuristicProviders = new Set(["brave", "bing", "serpapi", "browser", "managed-browser"]);
    const hasHeuristicProvider = candidates.some((c) => heuristicProviders.has(c.source));

    const commonsCandidate = candidates.find(
      (c) =>
        (c.sourcePageUrl && isCommonsHost(c.sourcePageUrl)) ||
        isCommonsHost(c.url),
    );

    if (hasHeuristicProvider && commonsCandidate) {
      return {
        recommendedLicense: "CC_BY_SA",
        confidence: 0.45,
        rationale:
          `License is UNKNOWN but a heuristic provider detected a Commons-hosted image ` +
          `(source: "${commonsCandidate.sourcePageUrl ?? commonsCandidate.url}"). ` +
          `Upgrade path: re-query with Wikimedia or Openverse to obtain structured CC_BY_SA metadata. ` +
          `Confidence threshold: 0.45 — do not publish without a confirmatory structured-metadata pass.`,
        upgradeApplicable: true,
      };
    }

    return {
      recommendedLicense: "UNKNOWN",
      confidence: 0,
      rationale: "Consensus license is UNKNOWN and no Commons host signal was found. Cannot recommend an upgrade path.",
      upgradeApplicable: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Rule (b): Mixed licenses but all commercially permissive
  // ---------------------------------------------------------------------------
  const COMMERCIALLY_PERMISSIVE: ReadonlySet<License> = new Set([
    "CC0", "PUBLIC_DOMAIN", "CC_BY", "CC_BY_SA",
    "UNSPLASH_LICENSE", "PEXELS_LICENSE", "PIXABAY_LICENSE",
  ]);
  const FULLY_OPEN: ReadonlySet<License> = new Set(["CC0", "PUBLIC_DOMAIN", "CC_BY", "CC_BY_SA"]);

  const allPermissive = [...distinctLicenses].every((l) => COMMERCIALLY_PERMISSIVE.has(l));

  if (reconciled.conflictCount > 0 && allPermissive) {
    const allFullyOpen = [...distinctLicenses].every((l) => FULLY_OPEN.has(l));

    if (allFullyOpen) {
      // All licenses are fully open — consolidate to the most-open one.
      const mostOpen = [...distinctLicenses].sort(
        (a, b) => (LICENSE_RANK[a] ?? 99) - (LICENSE_RANK[b] ?? 99),
      )[0] as License;
      return {
        recommendedLicense: mostOpen,
        confidence: 0.75,
        rationale:
          `All ${distinctLicenses.size} licenses in conflict (${[...distinctLicenses].join(", ")}) ` +
          `are fully open. Consolidation to "${mostOpen}" (most-open by rank) is safe for commercial use. ` +
          `Verify author attribution requirements for CC_BY/CC_BY_SA.`,
        upgradeApplicable: true,
      };
    }

    // Mixed open + platform licenses — consolidate to UNSPLASH_LICENSE as
    // the most conservative commercially-permissive platform license.
    return {
      recommendedLicense: "UNSPLASH_LICENSE",
      confidence: 0.60,
      rationale:
        `All ${distinctLicenses.size} licenses in conflict (${[...distinctLicenses].join(", ")}) ` +
        `permit commercial use. Consolidating under "UNSPLASH_LICENSE" as a conservative ` +
        `platform-license baseline. Re-verify each platform's current terms before publishing.`,
      upgradeApplicable: true,
    };
  }

  // No upgrade applicable.
  return {
    recommendedLicense: reconciled.consensusLicense,
    confidence: reconciled.confidence,
    rationale: `Current consensus license "${reconciled.consensusLicense}" requires no upgrade.`,
    upgradeApplicable: false,
  };
}

// ---------------------------------------------------------------------------
// Conflict audit
// ---------------------------------------------------------------------------

/**
 * A structured audit report for a single license conflict between providers.
 *
 * - `conflictingProviders`  — providers whose asserted licenses differ from
 *   the consensus.
 * - `consensusLicense`      — the chosen consensus license.
 * - `conflictSeverity`      — `"none"` | `"minor"` | `"major"` | `"critical"`.
 *   `"none"` when all providers agree; `"minor"` when only UNKNOWN vs. a known
 *   license; `"major"` when two valid license camps exist; `"critical"` when
 *   restrictive licenses (EDITORIAL_LICENSED, PRESS_KIT_ALLOWLIST) appear in a
 *   pool that also contains open licenses.
 * - `auditNarrative`        — human-readable summary of the conflict, suitable
 *   for embedding in a legal review ticket.
 * - `legalReviewRequired`   — true when severity is `"major"` or `"critical"`.
 */
export interface LicenseConflictAudit {
  conflictingProviders: string[];
  consensusLicense: License;
  conflictSeverity: "none" | "minor" | "major" | "critical";
  auditNarrative: string;
  legalReviewRequired: boolean;
}

/**
 * Produce a structured conflict audit for a group of `ImageCandidate` objects.
 *
 * This is a higher-level wrapper around `reconcileLicenses` that adds a
 * severity classification and legal-review flag, making it suitable for
 * routing into automated compliance pipelines.
 *
 * Severity classification:
 *  - `"none"`     — all providers agree on the same license.
 *  - `"minor"`    — only conflict is UNKNOWN vs. a single known license.
 *  - `"major"`    — two or more distinct known licenses are asserted.
 *  - `"critical"` — any provider asserts EDITORIAL_LICENSED or
 *    PRESS_KIT_ALLOWLIST while another asserts an open license (CC0, CC_BY, etc.).
 *
 * @param candidates - Non-empty array of `ImageCandidate` objects.
 * @returns `LicenseConflictAudit`
 */
export function auditLicenseConflict(candidates: ImageCandidate[]): LicenseConflictAudit {
  if (candidates.length === 0) {
    return {
      conflictingProviders: [],
      consensusLicense: "UNKNOWN",
      conflictSeverity: "none",
      auditNarrative: "No candidates provided; nothing to audit.",
      legalReviewRequired: false,
    };
  }

  const reconciled = reconcileLicenses(candidates);
  const { consensusLicense, conflictCount, conflictLog } = reconciled;

  const conflictingProviders = conflictLog
    .filter((e) => e.assertedLicense !== consensusLicense)
    .map((e) => e.provider);

  const distinctLicenses = new Set(candidates.map((c) => c.license));

  // Severity classification.
  let conflictSeverity: LicenseConflictAudit["conflictSeverity"] = "none";

  if (conflictCount > 0) {
    const OPEN_SET: ReadonlySet<License> = new Set(["CC0", "PUBLIC_DOMAIN", "CC_BY", "CC_BY_SA"]);
    const RESTRICTIVE_SET: ReadonlySet<License> = new Set(["EDITORIAL_LICENSED", "PRESS_KIT_ALLOWLIST"]);

    const hasOpenLicense = [...distinctLicenses].some((l) => OPEN_SET.has(l));
    const hasRestrictiveLicense = [...distinctLicenses].some((l) => RESTRICTIVE_SET.has(l));

    if (hasOpenLicense && hasRestrictiveLicense) {
      conflictSeverity = "critical";
    } else {
      // Count distinct known (non-UNKNOWN) licenses.
      const knownLicenses = [...distinctLicenses].filter((l) => l !== "UNKNOWN");
      if (knownLicenses.length >= 2) {
        conflictSeverity = "major";
      } else {
        // Only conflict is UNKNOWN vs. one known license.
        conflictSeverity = "minor";
      }
    }
  }

  const legalReviewRequired = conflictSeverity === "major" || conflictSeverity === "critical";

  // Build audit narrative.
  let auditNarrative: string;
  if (conflictSeverity === "none") {
    auditNarrative =
      `All ${candidates.length} provider(s) unanimously assert "${consensusLicense}". No conflict detected.`;
  } else if (conflictSeverity === "minor") {
    auditNarrative =
      `Minor conflict: ${conflictCount} provider(s) [${conflictingProviders.join(", ")}] returned ` +
      `UNKNOWN while the majority asserts "${consensusLicense}". ` +
      `Re-query the conflicting providers to obtain structured metadata.`;
  } else if (conflictSeverity === "major") {
    const licenseList = [...distinctLicenses].join(", ");
    auditNarrative =
      `Major conflict: ${candidates.length} provider(s) split across licenses [${licenseList}]. ` +
      `Consensus defaulted to "${consensusLicense}" by majority/rank, but ${conflictingProviders.length} ` +
      `provider(s) [${conflictingProviders.join(", ")}] disagreed. ` +
      `Legal review is required before publishing.`;
  } else {
    const licenseList = [...distinctLicenses].join(", ");
    auditNarrative =
      `CRITICAL conflict: open and restrictive licenses coexist in the provider pool [${licenseList}]. ` +
      `Conflicting providers: [${conflictingProviders.join(", ")}]. ` +
      `Do NOT publish without explicit legal clearance. Consensus license "${consensusLicense}" ` +
      `may not be safe to apply without a full rights audit.`;
  }

  return {
    conflictingProviders,
    consensusLicense,
    conflictSeverity,
    auditNarrative,
    legalReviewRequired,
  };
}

// ---------------------------------------------------------------------------
// Batch reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile licenses across a pool of candidates in one pass, preserving
 * dedupe-group metadata (group key, all URLs, all contributing providers).
 *
 * Candidates are first grouped by pHash proximity (or URL as fallback), then
 * each group is reconciled independently.  The result includes summary
 * statistics that allow an agent to quickly triage groups needing legal review.
 *
 * @param candidates - Array of `ImageCandidate` objects (any mix of providers).
 * @returns `BatchReconciliationResult` — one entry per dedupe group,
 *   ordered largest-group-first.
 */
export function reconcileLicensesBatch(candidates: ImageCandidate[]): BatchReconciliationResult {
  if (candidates.length === 0) {
    return {
      entries: [],
      totalGroups: 0,
      totalCandidates: 0,
      highConflictCount: 0,
      legalReviewNeeded: false,
    };
  }

  // Re-use the internal grouping so we get the same buckets as reconcileLicenses.
  const groups = groupCandidates(candidates);
  groups.sort((a, b) => b.length - a.length);

  const entries: BatchReconciliationEntry[] = groups.map((group) => {
    // Derive a stable group key from the first member (matches groupCandidates logic).
    const first = group[0]!;
    const groupKey =
      first.phash && first.phash.length >= 8
        ? `phash:${first.phash.slice(0, 8).toLowerCase()}`
        : `url:${first.url}`;

    const result = reconcileGroup(group);

    return {
      groupKey,
      candidateUrls: group.map((c) => c.url),
      providers: [...new Set(group.map((c) => c.source))],
      result,
    };
  });

  const highConflictCount = entries.filter((e) => e.result.conflictCount > 0).length;
  const legalReviewNeeded = entries.some(
    (e) => e.result.conflictCount >= 2 || e.result.consensusLicense === "UNKNOWN",
  );

  return {
    entries,
    totalGroups: groups.length,
    totalCandidates: candidates.length,
    highConflictCount,
    legalReviewNeeded,
  };
}
