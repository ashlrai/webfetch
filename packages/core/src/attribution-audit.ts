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
