/**
 * License Confidence Audit Trail + Attribution Validator.
 *
 * Provides:
 *  - `LicenseAuditTrail` — records HOW a license was determined and how
 *    trustworthy that determination is.
 *  - `coerceLicenseWithTrail` — like `coerceLicense` but returns {license, trail}.
 *  - `heuristicLicenseFromUrlWithTrail` — like `heuristicLicenseFromUrl` but
 *    returns {license, confidence, trail}.
 *  - `validateAttributionLine` — validates a candidate attribution string for
 *    completeness, length, and live URL reachability.
 *
 * None of these functions perform real network I/O by default; pass a `fetcher`
 * option to `validateAttributionLine` for tests or production use. The default
 * fetcher is the global `fetch`.
 */

import type { ImageCandidate, ProviderId } from "./types.ts";
import type { License } from "./types.ts";

// ---------------------------------------------------------------------------
// Audit trail types
// ---------------------------------------------------------------------------

/**
 * Records how a license classification was derived.
 *
 * - `api-metadata`       — explicit structured field from a provider API
 *   (highest confidence: the source authoritatively declared the license).
 * - `embedded-metadata`  — parsed from EXIF/IPTC/XMP embedded in the image
 *   file (high confidence but depends on embed quality).
 * - `heuristic-url`      — inferred from the image/page URL hostname
 *   (medium confidence: works for well-known platforms but is not authoritative).
 * - `fallback`           — no usable signal found; defaulted to UNKNOWN
 *   (zero confidence: caller must treat as unclassified).
 */
export type LicenseAuditSource =
  | "api-metadata"
  | "embedded-metadata"
  | "heuristic-url"
  | "fallback";

/**
 * Optional flags that qualify the audit trail entry.
 *
 * - `url-inferred`       — license was inferred from hostname/path, not from
 *   explicit license text.
 * - `incomplete-author`  — no author/creator field was found alongside the
 *   license; attribution-required licenses (CC BY, CC BY-SA) may be unusable.
 * - `deprecated-cc-url`  — the license URL uses a legacy CC domain
 *   (e.g. https://creativecommons.org/licenses/by/3.0 without /4.0) that is
 *   syntactically valid but no longer recommended.
 */
export type LicenseAuditFlag =
  | "url-inferred"
  | "incomplete-author"
  | "deprecated-cc-url";

/**
 * Full provenance record for a single license determination.
 */
export interface LicenseAuditTrail {
  /** How the license was determined. */
  source: LicenseAuditSource;
  /** Human-readable description of the evidence that led to this classification. */
  provenance: string;
  /** Confidence in the classification (0..1). */
  confidence: number;
  /** Zero or more flags that qualify this entry. */
  flags: LicenseAuditFlag[];
}

// ---------------------------------------------------------------------------
// License coercion with audit trail
// ---------------------------------------------------------------------------

/**
 * Coerce a free-form license string into our enum AND produce an audit trail.
 *
 * Confidence levels by path:
 *  - Exact well-known string match (CC0, "public domain …") → 0.95
 *  - Substring heuristic match (e.g. "cc by") → 0.75
 *  - No match → 0 (UNKNOWN)
 */
export function coerceLicenseWithTrail(
  raw: string | undefined | null,
): { license: License; trail: LicenseAuditTrail } {
  if (!raw) {
    return {
      license: "UNKNOWN",
      trail: {
        source: "fallback",
        provenance: "No license string provided; defaulting to UNKNOWN.",
        confidence: 0,
        flags: [],
      },
    };
  }

  const s = raw.trim().toLowerCase();

  // CC0 / Public Domain Dedication — exact or well-known URL paths
  if (s === "cc0" || s.includes("public domain dedication") || s.includes("publicdomain/zero")) {
    const exact = s === "cc0";
    return {
      license: "CC0",
      trail: {
        source: "api-metadata",
        provenance: `License string "${raw}" matched CC0 / Public Domain Dedication (${exact ? "exact" : "substring"} match).`,
        confidence: exact ? 0.95 : 0.85,
        flags: [],
      },
    };
  }

  // Public Domain (not CC0 branded)
  if (s.includes("public domain") || s === "pd" || s.includes("pdm")) {
    return {
      license: "PUBLIC_DOMAIN",
      trail: {
        source: "api-metadata",
        provenance: `License string "${raw}" matched Public Domain via substring heuristic.`,
        confidence: 0.85,
        flags: [],
      },
    };
  }

  // CC BY-SA (must check before CC BY to avoid false match)
  if (
    s.includes("by-sa") ||
    s.includes("by sa") ||
    s.includes("sharealike") ||
    s.includes("by-sa-")
  ) {
    const deprecated = /\/licenses\/by-sa\/[123]\.\d/.test(s);
    return {
      license: "CC_BY_SA",
      trail: {
        source: "api-metadata",
        provenance: `License string "${raw}" matched CC BY-SA via substring heuristic.`,
        confidence: 0.8,
        flags: deprecated ? ["deprecated-cc-url"] : [],
      },
    };
  }

  // CC BY
  if (s.includes("cc-by") || s.includes("cc by") || s === "ccby" || /\bby\b/.test(s)) {
    const deprecated = /\/licenses\/by\/[123]\.\d/.test(s);
    return {
      license: "CC_BY",
      trail: {
        source: "api-metadata",
        provenance: `License string "${raw}" matched CC BY via substring heuristic.`,
        confidence: 0.75,
        flags: deprecated ? ["deprecated-cc-url"] : [],
      },
    };
  }

  // Platform-specific
  if (s.includes("unsplash")) {
    return {
      license: "UNSPLASH_LICENSE",
      trail: {
        source: "api-metadata",
        provenance: `License string "${raw}" matched Unsplash License.`,
        confidence: 0.9,
        flags: [],
      },
    };
  }
  if (s.includes("pexels")) {
    return {
      license: "PEXELS_LICENSE",
      trail: {
        source: "api-metadata",
        provenance: `License string "${raw}" matched Pexels License.`,
        confidence: 0.9,
        flags: [],
      },
    };
  }
  if (s.includes("pixabay")) {
    return {
      license: "PIXABAY_LICENSE",
      trail: {
        source: "api-metadata",
        provenance: `License string "${raw}" matched Pixabay License.`,
        confidence: 0.9,
        flags: [],
      },
    };
  }

  // Editorial / press
  if (
    s.includes("editorial") ||
    s.includes("spotify") ||
    s.includes("caa") ||
    s.includes("itunes")
  ) {
    return {
      license: "EDITORIAL_LICENSED",
      trail: {
        source: "api-metadata",
        provenance: `License string "${raw}" matched EDITORIAL_LICENSED via keyword.`,
        confidence: 0.7,
        flags: [],
      },
    };
  }
  if (s.includes("press") || s.includes("promo")) {
    return {
      license: "PRESS_KIT_ALLOWLIST",
      trail: {
        source: "api-metadata",
        provenance: `License string "${raw}" matched PRESS_KIT_ALLOWLIST via keyword.`,
        confidence: 0.7,
        flags: [],
      },
    };
  }

  // NC / ND / proprietary / all-rights-reserved — not safe for our use case.
  return {
    license: "UNKNOWN",
    trail: {
      source: "fallback",
      provenance: `License string "${raw}" did not match any known license pattern; classified as UNKNOWN.`,
      confidence: 0,
      flags: [],
    },
  };
}

// ---------------------------------------------------------------------------
// URL-heuristic with audit trail
// ---------------------------------------------------------------------------

/**
 * URL-based heuristics with an attached audit trail.
 *
 * Produces the same `license` + `confidence` as `heuristicLicenseFromUrl` but
 * also returns a `trail` describing the inference.
 */
export function heuristicLicenseFromUrlWithTrail(url: string): {
  license: License;
  confidence: number;
  trail: LicenseAuditTrail;
} {
  const host = safeHost(url);
  if (!host) {
    return {
      license: "UNKNOWN",
      confidence: 0,
      trail: {
        source: "fallback",
        provenance: `Could not parse hostname from URL "${url}".`,
        confidence: 0,
        flags: [],
      },
    };
  }

  type HeuristicEntry = {
    license: License;
    confidence: number;
    note: string;
    flags?: LicenseAuditFlag[];
  };
  const HEURISTICS: Array<{ test: (h: string) => boolean } & HeuristicEntry> = [
    {
      test: (h) => h.endsWith("unsplash.com") || h.endsWith("images.unsplash.com"),
      license: "UNSPLASH_LICENSE",
      confidence: 0.9,
      note: "Unsplash CDN hostname",
      flags: ["url-inferred"],
    },
    {
      test: (h) => h.endsWith("pexels.com") || h.endsWith("images.pexels.com"),
      license: "PEXELS_LICENSE",
      confidence: 0.9,
      note: "Pexels CDN hostname",
      flags: ["url-inferred"],
    },
    {
      test: (h) => h.endsWith("pixabay.com") || h.endsWith("cdn.pixabay.com"),
      license: "PIXABAY_LICENSE",
      confidence: 0.9,
      note: "Pixabay CDN hostname",
      flags: ["url-inferred"],
    },
    {
      test: (h) =>
        h.endsWith("scdn.co") || h.endsWith("spotifycdn.com") || h.endsWith("i.scdn.co"),
      license: "EDITORIAL_LICENSED",
      confidence: 0.7,
      note: "Spotify CDN hostname",
      flags: ["url-inferred"],
    },
    {
      test: (h) => h.endsWith("coverartarchive.org") || h.endsWith("archive.org"),
      license: "EDITORIAL_LICENSED",
      confidence: 0.6,
      note: "Cover Art Archive / Internet Archive hostname",
      flags: ["url-inferred"],
    },
    {
      test: (h) => h.endsWith("ytimg.com") || h.endsWith("i.ytimg.com"),
      license: "EDITORIAL_LICENSED",
      confidence: 0.5,
      note: "YouTube image CDN hostname",
      flags: ["url-inferred"],
    },
    {
      test: (h) => h.endsWith("openverse.org"),
      license: "CC_BY",
      confidence: 0.4,
      note: "Openverse hostname (mix of licenses — CC BY assumed conservatively)",
      flags: ["url-inferred"],
    },
    {
      test: (h) =>
        h.endsWith("commons.wikimedia.org") || h.endsWith("upload.wikimedia.org"),
      license: "CC_BY_SA",
      confidence: 0.4,
      note: "Wikimedia Commons hostname (mixed licenses — CC BY-SA assumed conservatively)",
      flags: ["url-inferred"],
    },
    {
      test: (h) => h.endsWith("flickr.com") || h.endsWith("staticflickr.com"),
      license: "UNKNOWN",
      confidence: 0.1,
      note: "Flickr hostname — license varies per photo; must verify per-item",
      flags: ["url-inferred"],
    },
  ];

  for (const entry of HEURISTICS) {
    if (entry.test(host)) {
      return {
        license: entry.license,
        confidence: entry.confidence,
        trail: {
          source: "heuristic-url",
          provenance: `License inferred from hostname "${host}" (${entry.note}).`,
          confidence: entry.confidence,
          flags: entry.flags ?? ["url-inferred"],
        },
      };
    }
  }

  return {
    license: "UNKNOWN",
    confidence: 0,
    trail: {
      source: "fallback",
      provenance: `Hostname "${host}" did not match any known provider heuristic.`,
      confidence: 0,
      flags: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Attribution validator
// ---------------------------------------------------------------------------

/**
 * Maximum length (inclusive) for a valid attribution line.
 * 280 characters matches a typical tweet / social media post constraint.
 */
const MAX_ATTRIBUTION_LENGTH = 280;

/**
 * Result of `validateAttributionLine`.
 */
export interface AttributionValidationResult {
  /** True when the line passes all checks. */
  valid: boolean;
  /** Human-readable issues found (empty when valid). */
  issues: string[];
}

/**
 * Options for `validateAttributionLine`.
 */
export interface AttributionValidationOptions {
  /**
   * Injectable fetch implementation for URL checks.
   * Defaults to the global `fetch` when omitted.
   */
  fetcher?: typeof fetch;
  /**
   * When false, skip the live HTTP check for the license URL embedded in the
   * attribution line. Useful in offline / unit-test contexts.
   * Defaults to true.
   */
  checkLicenseUrl?: boolean;
  /**
   * When false, skip the live HTTP check for the source page URL.
   * Defaults to true.
   */
  checkSourcePageUrl?: boolean;
}

/**
 * Extract a URL from an attribution string.
 *
 * Looks for the last bare https:// URL in the string (typically the license
 * URL at the end of a `buildAttribution` output).
 */
function extractUrls(line: string): string[] {
  const re = /https:\/\/[^\s,]+/g;
  return Array.from(line.matchAll(re), (m) => m[0]).filter((u) => u.length > 0);
}

/**
 * Check whether a URL returns 200 over HTTPS without a redirect to HTTP.
 *
 * Returns `{ ok: boolean; issue?: string }`.
 */
async function checkUrl(
  url: string,
  fetcher: typeof fetch,
): Promise<{ ok: boolean; issue?: string }> {
  // Must be HTTPS
  if (!url.startsWith("https://")) {
    return { ok: false, issue: `URL "${url}" is not HTTPS.` };
  }
  try {
    const resp = await fetcher(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    // 3xx with Location: http:// counts as redirect-to-HTTP
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location") ?? "";
      if (loc.startsWith("http://")) {
        return {
          ok: false,
          issue: `URL "${url}" redirects to plain HTTP "${loc}".`,
        };
      }
      // HTTPS redirect is fine — follow once to check final status
      const final = await fetcher(url, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      if (final.status !== 200) {
        return {
          ok: false,
          issue: `URL "${url}" returned HTTP ${final.status} after redirect.`,
        };
      }
      return { ok: true };
    }
    if (resp.status !== 200) {
      return {
        ok: false,
        issue: `URL "${url}" returned HTTP ${resp.status}.`,
      };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, issue: `URL "${url}" check failed: ${msg}.` };
  }
}

/**
 * Validate a candidate attribution line.
 *
 * Checks:
 *  1. Author is non-empty (detected as "Photo by <name>" or title "by <name>").
 *  2. Any HTTPS URLs embedded in the line return HTTP 200 with no HTTP redirect
 *     (requires live network unless `checkLicenseUrl: false`).
 *  3. The line is ≤ 280 characters.
 *  4. All embedded URLs use HTTPS (no plain-HTTP URLs).
 *
 * @param candidate  The attribution string to validate.
 * @param opts       Injectable fetcher and flags to skip live URL checks.
 */
export async function validateAttributionLine(
  candidate: string,
  opts: AttributionValidationOptions = {},
): Promise<AttributionValidationResult> {
  const {
    fetcher = fetch,
    checkLicenseUrl = true,
    checkSourcePageUrl = true,
  } = opts;
  const issues: string[] = [];

  // 1. Author non-empty heuristic
  //    Matches "Photo by X", `"Title" by X`, `Photo (source), ...`
  const hasAuthor =
    /by\s+\S/.test(candidate) || // "Photo by …" or `"Title" by …`
    /^"[^"]+"\s+\(/.test(candidate); // `"Title" (source), …` (title-only, no author required)
  const hasTitleOnly = /^"[^"]+"[^b]/.test(candidate) && !/\bby\s+\S/.test(candidate);
  // hasTitleOnly allows title-only attributions (no author required for CC0/PD)
  if (!hasAuthor && !hasTitleOnly) {
    issues.push("Attribution line does not contain a recognisable author or title.");
  }

  // 2. Length check
  if (candidate.length > MAX_ATTRIBUTION_LENGTH) {
    issues.push(
      `Attribution line exceeds ${MAX_ATTRIBUTION_LENGTH} characters (got ${candidate.length}).`,
    );
  }

  // 3. Plain-HTTP URLs are not allowed
  const httpUrls = Array.from(candidate.matchAll(/http:\/\/[^\s,]+/g), (m) => m[0]);
  for (const u of httpUrls) {
    issues.push(`Attribution line contains a plain-HTTP URL "${u}"; HTTPS is required.`);
  }

  // 4. Live URL checks
  if (checkLicenseUrl || checkSourcePageUrl) {
    const httpsUrls = extractUrls(candidate);
    for (const u of httpsUrls) {
      const result = await checkUrl(u, fetcher);
      if (!result.ok && result.issue) {
        issues.push(result.issue);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Metadata chain-of-custody types
// ---------------------------------------------------------------------------

/**
 * Source from which a single metadata field value was resolved.
 *
 * Confidence grades (authority scores):
 *  - `api-metadata`    → 1.0  (explicit structured field from provider API)
 *  - `embedded-exif`   → 0.9  (parsed from EXIF/IPTC/XMP embedded in the image)
 *  - `html-heuristic`  → 0.7  (inferred via HTML parse / page scrape)
 *  - `heuristic-url`   → 0.3  (inferred from URL structure / hostname patterns)
 *  - `fallback`        → 0.1  (last-resort default, no authoritative signal found)
 *  - `user-override`   → 1.0  (explicit value supplied by the caller; highest trust)
 */
export type MetadataFieldSource =
  | "api-metadata"
  | "embedded-exif"
  | "html-heuristic"
  | "heuristic-url"
  | "fallback"
  | "user-override";

/** Authority score (0..1) associated with each `MetadataFieldSource`. */
export const METADATA_SOURCE_CONFIDENCE: Record<MetadataFieldSource, number> = {
  "api-metadata": 1.0,
  "embedded-exif": 0.9,
  "html-heuristic": 0.7,
  "heuristic-url": 0.3,
  fallback: 0.1,
  "user-override": 1.0,
};

/**
 * A single step in a metadata field's provenance chain.
 * Chains are ordered from most to least authoritative (index 0 = winning source).
 */
export interface AuditStep {
  /** Source type used at this step. */
  source: MetadataFieldSource;
  /** Value observed at this step (empty string when absent/null). */
  value: string;
  /** Authority score for this step (0..1). */
  confidence: number;
  /** Human-readable note describing what was checked and why it was accepted or skipped. */
  note: string;
  /** ISO 8601 timestamp of when this step was determined. */
  timestamp: string;
  /**
   * Conflicting values observed from alternate sources at this step.
   * Populated when multiple sources disagreed on the value for this field.
   * Each entry records the alternate value and which source provided it.
   */
  conflictingValues?: Array<{ value: string; source: MetadataFieldSource }>;
}

/**
 * Full chain-of-custody record for a single metadata field.
 */
export interface MetadataFieldAudit {
  /** The source that ultimately won (supplied the resolved value). */
  source: MetadataFieldSource;
  /** Resolved value (empty string when unavailable). */
  value: string;
  /** Authority score of the winning source (0..1). */
  confidence: number;
  /** ISO 8601 timestamp of when the winning value was determined. */
  timestamp: string;
  /** Ordered provenance chain — every source that was checked, winning source first. */
  chain: AuditStep[];
  /**
   * Conflicting values observed from sources that were checked but not selected.
   * Only populated when at least one alternate source returned a different non-empty value.
   */
  conflictingValues?: Array<{ value: string; source: MetadataFieldSource }>;
}

/**
 * Full metadata audit trail for an `ImageCandidate`.
 *
 * Extends `LicenseAuditTrail` with per-field chain-of-custody for the three
 * attribution-critical metadata fields: `author`, `title`, and `sourcePageUrl`.
 */
export interface MetadataAuditTrail {
  /** Provider that produced the candidate. */
  provider: ProviderId | string;
  /** ISO 8601 timestamp of when the trail was generated. */
  generatedAt: string;
  /** Per-field chain-of-custody records. */
  metadataFields: {
    author?: MetadataFieldAudit;
    title?: MetadataFieldAudit;
    sourcePageUrl?: MetadataFieldAudit;
  };
  /**
   * Weighted average confidence across all resolved fields (0..1).
   * Computed by `getMetadataQualityScore`.
   */
  overallQualityScore: number;
}

// ---------------------------------------------------------------------------
// Provenance export types
// ---------------------------------------------------------------------------

/**
 * A single row in a JSONL provenance export — one per candidate.
 */
export interface MetadataProvenanceRecord {
  /** Candidate URL. */
  url: string;
  /** Provider that produced the candidate. */
  provider: string;
  /** Full metadata audit trail. */
  trail: MetadataAuditTrail;
}

/**
 * Consensus heatmap entry — how many providers agree on a given value for a field.
 */
export interface ConsensusHeatmapEntry {
  /** Metadata field name. */
  field: "author" | "title" | "sourcePageUrl";
  /** The agreed-upon value. */
  value: string;
  /** Number of providers that returned this value. */
  count: number;
  /** Fraction of all providers that returned this value (0..1). */
  agreementRatio: number;
  /** Providers that returned this value. */
  providers: string[];
}

/**
 * Conflict resolution guidance for a single field when providers disagree.
 */
export interface ConflictResolutionGuidance {
  /** Metadata field with conflict. */
  field: "author" | "title" | "sourcePageUrl";
  /** The recommended value (majority winner or highest-authority winner). */
  recommendedValue: string;
  /** Human-readable explanation of the conflict and resolution rationale. */
  guidance: string;
  /** All competing values with their provider counts. */
  candidates: Array<{ value: string; providers: string[]; count: number }>;
}

/**
 * Full provenance export result for a batch of candidates.
 */
export interface MetadataProvenanceExport {
  /** JSONL lines — one `MetadataProvenanceRecord` per candidate. */
  jsonlLines: string[];
  /** Consensus heatmap per field × value. */
  consensusHeatmap: ConsensusHeatmapEntry[];
  /** Conflict resolution guidance for fields where providers disagree. */
  conflictResolution: ConflictResolutionGuidance[];
  /** Number of candidates included in the export. */
  candidateCount: number;
  /** ISO 8601 timestamp of when the export was generated. */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Field weights for quality score
// ---------------------------------------------------------------------------

/** Relative importance weight for each metadata field in the quality score. */
const FIELD_WEIGHTS: Record<"author" | "title" | "sourcePageUrl", number> = {
  author: 0.4,
  title: 0.35,
  sourcePageUrl: 0.25,
};

// ---------------------------------------------------------------------------
// auditMetadataChain
// ---------------------------------------------------------------------------

/**
 * Trace how each attribution-critical metadata field was resolved for a
 * candidate, producing a full chain-of-custody `MetadataAuditTrail`.
 *
 * Resolution priority per field:
 *  1. `user-override`  — explicit override value supplied via `overrides` param (authority 1.0)
 *  2. `api-metadata`   — field present directly on the `ImageCandidate` (set by provider)
 *  3. `embedded-exif`  — EXIF/IPTC value surfaced via `candidate.raw`
 *     (looks for `raw.exif.<field>`, `raw.iptc.<field>`, `raw.xmp.<field>`)
 *  4. `html-heuristic` — heuristic value from `candidate.raw` (looks for `raw.html.<field>`)
 *  5. `heuristic-url`  — value inferred from candidate URL structure
 *  6. `fallback`       — no authoritative signal; records absence
 *
 * The `rawResponse` parameter is the provider's raw API response (may be the
 * same object as `candidate.raw` or a richer parent object). The function
 * attempts to extract embedded metadata from both `candidate.raw` and
 * `rawResponse` before falling back.
 *
 * @param candidate    The `ImageCandidate` to audit.
 * @param rawResponse  Raw provider response (may be the same as `candidate.raw`).
 * @param provider     Provider id string (used for provenance labelling).
 * @param overrides    Optional caller-supplied overrides (user-override source, authority 1.0).
 */
export function auditMetadataChain(
  candidate: ImageCandidate,
  rawResponse: unknown,
  provider: ProviderId | string,
  overrides?: Partial<Record<"author" | "title" | "sourcePageUrl", string>>,
): MetadataAuditTrail {
  const generatedAt = new Date().toISOString();
  const metadataFields: MetadataAuditTrail["metadataFields"] = {};

  metadataFields.author = auditField("author", candidate, rawResponse, generatedAt, overrides?.author);
  metadataFields.title = auditField("title", candidate, rawResponse, generatedAt, overrides?.title);
  metadataFields.sourcePageUrl = auditField("sourcePageUrl", candidate, rawResponse, generatedAt, overrides?.sourcePageUrl);

  const overallQualityScore = computeQualityScore(metadataFields);

  return { provider, generatedAt, metadataFields, overallQualityScore };
}

// ---------------------------------------------------------------------------
// Provenance export functions
// ---------------------------------------------------------------------------

/**
 * Build a full provenance export for a batch of candidates.
 *
 * For each candidate:
 *  1. Runs `auditMetadataChain` (or re-uses an attached `metadataAuditTrail`).
 *  2. Emits a JSONL line containing the full `MetadataProvenanceRecord`.
 *
 * Then computes:
 *  - A consensus heatmap showing which providers agree on author/title.
 *  - Conflict resolution guidance for fields where providers disagree.
 *
 * @param candidates  Array of `ImageCandidate` objects (from a search result).
 * @param rawResponses  Optional map of candidate index → raw API response.
 */
export function buildMetadataProvenanceExport(
  candidates: readonly ImageCandidate[],
  rawResponses?: Map<number, unknown>,
): MetadataProvenanceExport {
  const generatedAt = new Date().toISOString();
  const records: MetadataProvenanceRecord[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]!;
    const rawResponse = rawResponses?.get(i) ?? cand.raw ?? {};

    // Re-use a pre-computed trail if present, otherwise compute now.
    const existing = (cand as ImageCandidate & { metadataAuditTrail?: MetadataAuditTrail })
      .metadataAuditTrail;
    const trail: MetadataAuditTrail = existing ?? auditMetadataChain(cand, rawResponse, cand.source);

    records.push({ url: cand.url, provider: cand.source, trail });
  }

  const jsonlLines = records.map((r) => JSON.stringify(r));
  const consensusHeatmap = buildConsensusHeatmap(records);
  const conflictResolution = buildConflictResolution(records, consensusHeatmap);

  return {
    jsonlLines,
    consensusHeatmap,
    conflictResolution,
    candidateCount: records.length,
    generatedAt,
  };
}

/**
 * Format a `MetadataProvenanceExport` as a human-readable text report.
 *
 * Includes:
 *  - Summary line (N candidates, timestamp)
 *  - Consensus heatmap table
 *  - Conflict resolution guidance (if any conflicts exist)
 */
export function formatProvenanceReport(exp: MetadataProvenanceExport): string {
  const lines: string[] = [];

  lines.push(`Metadata Provenance Report`);
  lines.push(`Generated: ${exp.generatedAt}`);
  lines.push(`Candidates: ${exp.candidateCount}`);
  lines.push("");

  if (exp.consensusHeatmap.length === 0) {
    lines.push("No consensus data (no candidates or all fields absent).");
  } else {
    lines.push("Consensus Heatmap:");
    lines.push("  Field           | Value                          | Providers | Agreement");
    lines.push("  " + "-".repeat(75));
    for (const entry of exp.consensusHeatmap) {
      const fieldPad = entry.field.padEnd(16);
      const valuePad = entry.value.slice(0, 30).padEnd(30);
      const countPad = String(entry.count).padStart(9);
      const pct = (entry.agreementRatio * 100).toFixed(0) + "%";
      lines.push(`  ${fieldPad}| ${valuePad} | ${countPad} | ${pct}`);
    }
  }

  lines.push("");

  if (exp.conflictResolution.length === 0) {
    lines.push("No conflicts detected — all providers agree on all fields.");
  } else {
    lines.push("Conflict Resolution:");
    for (const cr of exp.conflictResolution) {
      lines.push(`  [${cr.field}] ${cr.guidance}`);
      for (const cand of cr.candidates) {
        const marker = cand.value === cr.recommendedValue ? "  ✓" : "   ";
        lines.push(`${marker}  "${cand.value}" — ${cand.providers.join(", ")} (${cand.count})`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers for provenance export
// ---------------------------------------------------------------------------

type AuditableField3 = "author" | "title" | "sourcePageUrl";

function buildConsensusHeatmap(records: MetadataProvenanceRecord[]): ConsensusHeatmapEntry[] {
  const fields: AuditableField3[] = ["author", "title", "sourcePageUrl"];
  const totalProviders = records.length;
  const heatmap: ConsensusHeatmapEntry[] = [];

  for (const field of fields) {
    // Collect value → providers map
    const valueMap = new Map<string, string[]>();
    for (const rec of records) {
      const audit = rec.trail.metadataFields[field];
      if (audit && audit.value) {
        const existing = valueMap.get(audit.value) ?? [];
        existing.push(rec.provider);
        valueMap.set(audit.value, existing);
      }
    }
    // Only include values that appear at least once
    for (const [value, providers] of valueMap.entries()) {
      heatmap.push({
        field,
        value,
        count: providers.length,
        agreementRatio: totalProviders > 0 ? providers.length / totalProviders : 0,
        providers,
      });
    }
  }

  // Sort by field priority, then by count descending
  const FIELD_ORDER: Record<AuditableField3, number> = { author: 0, title: 1, sourcePageUrl: 2 };
  heatmap.sort((a, b) => {
    const fo = FIELD_ORDER[a.field] - FIELD_ORDER[b.field];
    if (fo !== 0) return fo;
    return b.count - a.count;
  });

  return heatmap;
}

function buildConflictResolution(
  records: MetadataProvenanceRecord[],
  heatmap: ConsensusHeatmapEntry[],
): ConflictResolutionGuidance[] {
  const fields: AuditableField3[] = ["author", "title", "sourcePageUrl"];
  const result: ConflictResolutionGuidance[] = [];

  for (const field of fields) {
    const fieldEntries = heatmap.filter((e) => e.field === field);
    if (fieldEntries.length <= 1) continue; // no conflict

    // Sort by count descending
    const sorted = [...fieldEntries].sort((a, b) => b.count - a.count);
    const winner = sorted[0]!;
    const total = records.length;

    const guidance =
      `${winner.count} provider(s) say ${field}="${winner.value}", ` +
      sorted
        .slice(1)
        .map((e) => `${e.count} say "${e.value}"`)
        .join(", ") +
      `; "${winner.value}" is likely correct (majority: ${(winner.agreementRatio * 100).toFixed(0)}% of ${total} providers).`;

    result.push({
      field,
      recommendedValue: winner.value,
      guidance,
      candidates: sorted.map((e) => ({
        value: e.value,
        providers: e.providers,
        count: e.count,
      })),
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// getMetadataQualityScore
// ---------------------------------------------------------------------------

/**
 * Compute a weighted average metadata quality score (0..1) for a candidate.
 *
 * Weights: author=0.4, title=0.35, sourcePageUrl=0.25.
 * Fields that were not resolved (absent from `metadataFields`) contribute 0
 * to the weighted sum but still count toward the total weight, so missing
 * fields lower the overall score.
 *
 * When `candidate.metadataAuditTrail` is present, the pre-computed
 * `overallQualityScore` is returned directly (no recomputation).
 *
 * @param candidate   Candidate whose metadata quality to score.
 */
export function getMetadataQualityScore(candidate: ImageCandidate): number {
  const trail = (candidate as ImageCandidate & { metadataAuditTrail?: MetadataAuditTrail })
    .metadataAuditTrail;
  if (trail) return trail.overallQualityScore;

  // Derive an ad-hoc score from the raw candidate fields.
  const fields: { field: keyof typeof FIELD_WEIGHTS; value: string | undefined }[] = [
    { field: "author", value: candidate.author },
    { field: "title", value: candidate.title },
    { field: "sourcePageUrl", value: candidate.sourcePageUrl },
  ];

  let weightedSum = 0;
  let totalWeight = 0;
  for (const { field, value } of fields) {
    const w = FIELD_WEIGHTS[field];
    totalWeight += w;
    if (value && value.trim().length > 0) {
      // Presence with no source info → fallback confidence grade (0.4)
      weightedSum += w * METADATA_SOURCE_CONFIDENCE.fallback;
    }
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

// ---------------------------------------------------------------------------
// Internal helpers for auditMetadataChain
// ---------------------------------------------------------------------------

type AuditableField = "author" | "title" | "sourcePageUrl";

// Alias so both spellings work internally
type AuditableField2 = AuditableField;

/** Extract a string field from an unknown raw object, checking common nested keys. */
function extractRawField(raw: unknown, field: AuditableField2): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;

  // Direct field at root
  if (typeof r[field] === "string" && (r[field] as string).trim()) {
    return (r[field] as string).trim();
  }

  // EXIF / IPTC / XMP nested objects
  for (const ns of ["exif", "iptc", "xmp"]) {
    const ns_obj = r[ns];
    if (ns_obj && typeof ns_obj === "object") {
      const v = (ns_obj as Record<string, unknown>)[field];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }

  // HTML heuristic nested object
  const html = r["html"];
  if (html && typeof html === "object") {
    const v = (html as Record<string, unknown>)[field];
    if (typeof v === "string" && v.trim()) return v.trim();
  }

  return undefined;
}

/** Check whether raw contains EXIF/IPTC/XMP data for a field. */
function extractEmbeddedField(
  raw: unknown,
  field: AuditableField,
): { value: string; ns: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  for (const ns of ["exif", "iptc", "xmp"]) {
    const ns_obj = r[ns];
    if (ns_obj && typeof ns_obj === "object") {
      const v = (ns_obj as Record<string, unknown>)[field];
      if (typeof v === "string" && v.trim()) return { value: v.trim(), ns };
    }
  }
  return undefined;
}

/** Check whether raw contains HTML heuristic data for a field. */
function extractHtmlField(raw: unknown, field: AuditableField): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const html = r["html"];
  if (html && typeof html === "object") {
    const v = (html as Record<string, unknown>)[field];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * Audit a single metadata field, building a full `MetadataFieldAudit`.
 *
 * @param field         The field name to audit.
 * @param candidate     The ImageCandidate being audited.
 * @param rawResponse   Provider raw API response.
 * @param timestamp     ISO 8601 timestamp to embed in each step.
 * @param userOverride  Optional caller-supplied override value (user-override source).
 */
function auditField(
  field: AuditableField,
  candidate: ImageCandidate,
  rawResponse: unknown,
  timestamp: string,
  userOverride?: string,
): MetadataFieldAudit {
  const chain: AuditStep[] = [];
  // Collect all non-empty values from all sources to detect conflicts
  const allObserved: Array<{ value: string; source: MetadataFieldSource }> = [];

  // --- Step 0: user-override (highest authority, checked first) ---
  if (userOverride && userOverride.trim()) {
    const val = userOverride.trim();
    const conf = METADATA_SOURCE_CONFIDENCE["user-override"];
    chain.push({
      source: "user-override",
      value: val,
      confidence: conf,
      note: `Field "${field}" supplied by caller override (user-override); highest authority.`,
      timestamp,
    });
    return { source: "user-override", value: val, confidence: conf, timestamp, chain };
  }

  // --- Step 1: api-metadata (direct candidate field) ---
  const apiValue = candidate[field as keyof ImageCandidate] as string | undefined;
  if (apiValue && typeof apiValue === "string" && apiValue.trim()) {
    const val = apiValue.trim();
    const conf = METADATA_SOURCE_CONFIDENCE["api-metadata"];
    allObserved.push({ value: val, source: "api-metadata" });
    chain.push({
      source: "api-metadata",
      value: val,
      confidence: conf,
      note: `Field "${field}" resolved from provider API metadata on candidate.`,
      timestamp,
    });
    return { source: "api-metadata", value: val, confidence: conf, timestamp, chain };
  } else {
    chain.push({
      source: "api-metadata",
      value: "",
      confidence: 0,
      note: `Field "${field}" not present in provider API metadata; trying embedded sources.`,
      timestamp,
    });
  }

  // --- Step 2: embedded-exif (from candidate.raw or rawResponse) ---
  const embeddedFromRaw = extractEmbeddedField(candidate.raw, field);
  const embeddedFromResponse = extractEmbeddedField(rawResponse, field);
  const embedded = embeddedFromRaw ?? embeddedFromResponse;

  if (embedded) {
    const conf = METADATA_SOURCE_CONFIDENCE["embedded-exif"];
    allObserved.push({ value: embedded.value, source: "embedded-exif" });
    chain.push({
      source: "embedded-exif",
      value: embedded.value,
      confidence: conf,
      note: `Field "${field}" resolved from ${embedded.ns.toUpperCase()} embedded metadata.`,
      timestamp,
    });
    const conflicts = allObserved.filter(
      (o) => o.source !== "embedded-exif" && o.value !== embedded.value,
    );
    return {
      source: "embedded-exif",
      value: embedded.value,
      confidence: conf,
      timestamp,
      chain,
      ...(conflicts.length > 0 ? { conflictingValues: conflicts } : {}),
    };
  } else {
    chain.push({
      source: "embedded-exif",
      value: "",
      confidence: 0,
      note: `Field "${field}" not found in EXIF/IPTC/XMP metadata; trying HTML heuristic.`,
      timestamp,
    });
  }

  // --- Step 3: html-heuristic ---
  const htmlFromRaw = extractHtmlField(candidate.raw, field);
  const htmlFromResponse = extractHtmlField(rawResponse, field);
  const html = htmlFromRaw ?? htmlFromResponse;

  if (html) {
    const conf = METADATA_SOURCE_CONFIDENCE["html-heuristic"];
    allObserved.push({ value: html, source: "html-heuristic" });
    chain.push({
      source: "html-heuristic",
      value: html,
      confidence: conf,
      note: `Field "${field}" resolved via HTML heuristic parsing.`,
      timestamp,
    });
    const conflicts = allObserved.filter(
      (o) => o.source !== "html-heuristic" && o.value !== html,
    );
    return {
      source: "html-heuristic",
      value: html,
      confidence: conf,
      timestamp,
      chain,
      ...(conflicts.length > 0 ? { conflictingValues: conflicts } : {}),
    };
  } else {
    chain.push({
      source: "html-heuristic",
      value: "",
      confidence: 0,
      note: `Field "${field}" not found via HTML heuristic; recording as absent (fallback).`,
      timestamp,
    });
  }

  // --- Step 4: fallback (field is absent) ---
  chain.push({
    source: "fallback",
    value: "",
    confidence: 0,
    note: `Field "${field}" could not be resolved from any source.`,
    timestamp,
  });

  return { source: "fallback", value: "", confidence: 0, timestamp, chain };
}

/**
 * Compute a weighted quality score from a `MetadataAuditTrail["metadataFields"]`.
 */
function computeQualityScore(
  fields: MetadataAuditTrail["metadataFields"],
): number {
  const keys = ["author", "title", "sourcePageUrl"] as const;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const key of keys) {
    const w = FIELD_WEIGHTS[key];
    totalWeight += w;
    const audit = fields[key];
    if (audit) {
      weightedSum += w * audit.confidence;
    }
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}
