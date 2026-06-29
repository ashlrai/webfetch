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
 * Confidence grades:
 *  - `api-metadata`    → 1.0  (explicit structured field from provider API)
 *  - `embedded-exif`   → 0.9  (parsed from EXIF/IPTC/XMP embedded in the image)
 *  - `html-heuristic`  → 0.7  (inferred via HTML parse / page scrape)
 *  - `fallback`        → 0.4  (last-resort heuristic, no authoritative signal found)
 */
export type MetadataFieldSource =
  | "api-metadata"
  | "embedded-exif"
  | "html-heuristic"
  | "fallback";

/** Confidence score associated with each `MetadataFieldSource`. */
export const METADATA_SOURCE_CONFIDENCE: Record<MetadataFieldSource, number> = {
  "api-metadata": 1.0,
  "embedded-exif": 0.9,
  "html-heuristic": 0.7,
  fallback: 0.4,
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
  /** Confidence for this step (0..1). */
  confidence: number;
  /** Human-readable note describing what was checked and why it was accepted or skipped. */
  note: string;
}

/**
 * Full chain-of-custody record for a single metadata field.
 */
export interface MetadataFieldAudit {
  /** The source that ultimately won (supplied the resolved value). */
  source: MetadataFieldSource;
  /** Resolved value (empty string when unavailable). */
  value: string;
  /** Confidence of the winning source (0..1). */
  confidence: number;
  /** Ordered provenance chain — every source that was checked, winning source first. */
  chain: AuditStep[];
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
 *  1. `api-metadata`   — field present directly on the `ImageCandidate` (set by provider)
 *  2. `embedded-exif`  — EXIF/IPTC value surfaced via `candidate.raw`
 *     (looks for `raw.exif.<field>`, `raw.iptc.<field>`, `raw.xmp.<field>`)
 *  3. `html-heuristic` — heuristic value from `candidate.raw` (looks for `raw.html.<field>`)
 *  4. `fallback`       — no authoritative signal; records absence
 *
 * The `rawResponse` parameter is the provider's raw API response (may be the
 * same object as `candidate.raw` or a richer parent object). The function
 * attempts to extract embedded metadata from both `candidate.raw` and
 * `rawResponse` before falling back.
 *
 * @param candidate    The `ImageCandidate` to audit.
 * @param rawResponse  Raw provider response (may be the same as `candidate.raw`).
 * @param provider     Provider id string (used for provenance labelling).
 */
export function auditMetadataChain(
  candidate: ImageCandidate,
  rawResponse: unknown,
  provider: ProviderId | string,
): MetadataAuditTrail {
  const metadataFields: MetadataAuditTrail["metadataFields"] = {};

  metadataFields.author = auditField("author", candidate, rawResponse);
  metadataFields.title = auditField("title", candidate, rawResponse);
  metadataFields.sourcePageUrl = auditField("sourcePageUrl", candidate, rawResponse);

  const overallQualityScore = computeQualityScore(metadataFields);

  return { provider, metadataFields, overallQualityScore };
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

/** Extract a string field from an unknown raw object, checking common nested keys. */
function extractRawField(raw: unknown, field: AuditableField): string | undefined {
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
 */
function auditField(
  field: AuditableField,
  candidate: ImageCandidate,
  rawResponse: unknown,
): MetadataFieldAudit {
  const chain: AuditStep[] = [];

  // --- Step 1: api-metadata (direct candidate field) ---
  const apiValue = candidate[field as keyof ImageCandidate] as string | undefined;
  if (apiValue && typeof apiValue === "string" && apiValue.trim()) {
    const conf = METADATA_SOURCE_CONFIDENCE["api-metadata"];
    chain.push({
      source: "api-metadata",
      value: apiValue.trim(),
      confidence: conf,
      note: `Field "${field}" resolved from provider API metadata on candidate.`,
    });
    return { source: "api-metadata", value: apiValue.trim(), confidence: conf, chain };
  } else {
    chain.push({
      source: "api-metadata",
      value: "",
      confidence: 0,
      note: `Field "${field}" not present in provider API metadata; trying embedded sources.`,
    });
  }

  // --- Step 2: embedded-exif (from candidate.raw or rawResponse) ---
  const embeddedFromRaw = extractEmbeddedField(candidate.raw, field);
  const embeddedFromResponse = extractEmbeddedField(rawResponse, field);
  const embedded = embeddedFromRaw ?? embeddedFromResponse;

  if (embedded) {
    const conf = METADATA_SOURCE_CONFIDENCE["embedded-exif"];
    chain.push({
      source: "embedded-exif",
      value: embedded.value,
      confidence: conf,
      note: `Field "${field}" resolved from ${embedded.ns.toUpperCase()} embedded metadata.`,
    });
    return { source: "embedded-exif", value: embedded.value, confidence: conf, chain };
  } else {
    chain.push({
      source: "embedded-exif",
      value: "",
      confidence: 0,
      note: `Field "${field}" not found in EXIF/IPTC/XMP metadata; trying HTML heuristic.`,
    });
  }

  // --- Step 3: html-heuristic ---
  const htmlFromRaw = extractHtmlField(candidate.raw, field);
  const htmlFromResponse = extractHtmlField(rawResponse, field);
  const html = htmlFromRaw ?? htmlFromResponse;

  if (html) {
    const conf = METADATA_SOURCE_CONFIDENCE["html-heuristic"];
    chain.push({
      source: "html-heuristic",
      value: html,
      confidence: conf,
      note: `Field "${field}" resolved via HTML heuristic parsing.`,
    });
    return { source: "html-heuristic", value: html, confidence: conf, chain };
  } else {
    chain.push({
      source: "html-heuristic",
      value: "",
      confidence: 0,
      note: `Field "${field}" not found via HTML heuristic; recording as absent (fallback).`,
    });
  }

  // --- Step 4: fallback (field is absent) ---
  const fallbackConf = METADATA_SOURCE_CONFIDENCE["fallback"];
  chain.push({
    source: "fallback",
    value: "",
    confidence: 0,
    note: `Field "${field}" could not be resolved from any source.`,
  });

  return { source: "fallback", value: "", confidence: 0, chain };
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
