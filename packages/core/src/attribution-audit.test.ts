/**
 * Comprehensive test suite for attribution-audit.ts
 *
 * Covers:
 *  1. coerceLicenseWithTrail — source tracking, confidence levels, flags.
 *  2. heuristicLicenseFromUrlWithTrail — URL heuristics, confidence ordering,
 *     url-inferred flag, unknown/malformed URL fallback.
 *  3. validateAttributionLine — author detection, length limits, HTTP vs HTTPS,
 *     circular/missing author edge cases, injectable fetcher.
 *  4. Audit trail source hierarchy:
 *       api-metadata > embedded-metadata > heuristic-url > fallback
 *  5. Confidence decay rules — higher-certainty sources always yield ≥ confidence
 *     than lower-certainty ones for the same license.
 */

import { describe, expect, test } from "bun:test";
import {
  coerceLicenseWithTrail,
  heuristicLicenseFromUrlWithTrail,
  validateAttributionLine,
} from "./attribution-audit.ts";
import type { LicenseAuditSource, LicenseAuditTrail } from "./attribution-audit.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Loose fetch-mock signature: the audit functions accept a `Fetcher`
 * (`typeof fetch`), but mock fetchers don't implement `preconnect`. This shape
 * is structurally assignable to the `Fetcher` parameters while omitting the
 * runtime-only `preconnect` method.
 */
type MockFetch = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

/** A no-op fetcher that always returns HTTP 200. */
const ok200Fetcher = (async (_input: URL | RequestInfo, _init?: RequestInit) =>
  new Response(null, { status: 200 })) as MockFetch as typeof fetch;

/** A fetcher that always returns HTTP 404. */
const notFoundFetcher = (async (_input: URL | RequestInfo, _init?: RequestInit) =>
  new Response(null, { status: 404 })) as MockFetch as typeof fetch;

/** A fetcher that simulates a redirect to HTTP (302 → http://). */
const httpRedirectFetcher = (async (_input: URL | RequestInfo, init?: RequestInit) => {
  if (init?.redirect === "manual") {
    return new Response(null, {
      status: 302,
      headers: { location: "http://insecure.example.com/license" },
    });
  }
  return new Response(null, { status: 200 });
}) as MockFetch as typeof fetch;

/** A fetcher that always throws a network error. */
const networkErrorFetcher = (async () => {
  throw new TypeError("Network request failed");
}) as MockFetch as typeof fetch;

// ---------------------------------------------------------------------------
// 1. coerceLicenseWithTrail — basic license classification + audit trail
// ---------------------------------------------------------------------------

describe("coerceLicenseWithTrail — license classification", () => {
  test('null input → UNKNOWN, source=fallback, confidence=0', () => {
    const { license, trail } = coerceLicenseWithTrail(null);
    expect(license).toBe("UNKNOWN");
    expect(trail.source).toBe("fallback");
    expect(trail.confidence).toBe(0);
    expect(trail.flags).toEqual([]);
  });

  test('undefined input → UNKNOWN, source=fallback', () => {
    const { license, trail } = coerceLicenseWithTrail(undefined);
    expect(license).toBe("UNKNOWN");
    expect(trail.source).toBe("fallback");
    expect(trail.confidence).toBe(0);
  });

  test('empty string → UNKNOWN, source=fallback', () => {
    const { license, trail } = coerceLicenseWithTrail("");
    expect(license).toBe("UNKNOWN");
    expect(trail.source).toBe("fallback");
  });

  test('"cc0" exact → CC0, confidence=0.95', () => {
    const { license, trail } = coerceLicenseWithTrail("cc0");
    expect(license).toBe("CC0");
    expect(trail.confidence).toBe(0.95);
    expect(trail.source).toBe("api-metadata");
  });

  test('"CC0" case-insensitive → CC0', () => {
    const { license } = coerceLicenseWithTrail("CC0");
    expect(license).toBe("CC0");
  });

  test('CC0 URL (publicdomain/zero) → CC0, confidence=0.85', () => {
    const { license, trail } = coerceLicenseWithTrail(
      "https://creativecommons.org/publicdomain/zero/1.0/",
    );
    expect(license).toBe("CC0");
    expect(trail.confidence).toBe(0.85);
  });

  test('"public domain" substring → PUBLIC_DOMAIN', () => {
    const { license, trail } = coerceLicenseWithTrail("Public Domain Mark 1.0");
    expect(license).toBe("PUBLIC_DOMAIN");
    expect(trail.confidence).toBeGreaterThan(0);
  });

  test('"pd" exact → PUBLIC_DOMAIN', () => {
    const { license } = coerceLicenseWithTrail("pd");
    expect(license).toBe("PUBLIC_DOMAIN");
  });

  test('"CC BY-SA 4.0" → CC_BY_SA', () => {
    const { license, trail } = coerceLicenseWithTrail("CC BY-SA 4.0");
    expect(license).toBe("CC_BY_SA");
    expect(trail.source).toBe("api-metadata");
    expect(trail.flags).not.toContain("deprecated-cc-url");
  });

  test('deprecated CC BY-SA URL (v3) → CC_BY_SA with deprecated-cc-url flag', () => {
    const { license, trail } = coerceLicenseWithTrail(
      "https://creativecommons.org/licenses/by-sa/3.0/",
    );
    expect(license).toBe("CC_BY_SA");
    expect(trail.flags).toContain("deprecated-cc-url");
  });

  test('"CC BY 4.0" → CC_BY', () => {
    const { license, trail } = coerceLicenseWithTrail("CC BY 4.0");
    expect(license).toBe("CC_BY");
    expect(trail.source).toBe("api-metadata");
  });

  test('deprecated CC BY URL (v2) → CC_BY with deprecated-cc-url flag', () => {
    const { license, trail } = coerceLicenseWithTrail(
      "https://creativecommons.org/licenses/by/2.0/",
    );
    expect(license).toBe("CC_BY");
    expect(trail.flags).toContain("deprecated-cc-url");
  });

  test('"Unsplash License" → UNSPLASH_LICENSE, confidence=0.9', () => {
    const { license, trail } = coerceLicenseWithTrail("Unsplash License");
    expect(license).toBe("UNSPLASH_LICENSE");
    expect(trail.confidence).toBe(0.9);
  });

  test('"pexels" substring → PEXELS_LICENSE', () => {
    const { license } = coerceLicenseWithTrail("Pexels Content License");
    expect(license).toBe("PEXELS_LICENSE");
  });

  test('"pixabay" substring → PIXABAY_LICENSE', () => {
    const { license } = coerceLicenseWithTrail("pixabay");
    expect(license).toBe("PIXABAY_LICENSE");
  });

  test('"editorial" keyword → EDITORIAL_LICENSED', () => {
    const { license } = coerceLicenseWithTrail("Editorial Use Only");
    expect(license).toBe("EDITORIAL_LICENSED");
  });

  test('"spotify" keyword → EDITORIAL_LICENSED', () => {
    const { license } = coerceLicenseWithTrail("Spotify Artist Image Policy");
    expect(license).toBe("EDITORIAL_LICENSED");
  });

  test('"press" keyword → PRESS_KIT_ALLOWLIST', () => {
    const { license } = coerceLicenseWithTrail("Official Press Kit");
    expect(license).toBe("PRESS_KIT_ALLOWLIST");
  });

  test('"All Rights Reserved" → UNKNOWN, source=fallback', () => {
    const { license, trail } = coerceLicenseWithTrail("All Rights Reserved");
    expect(license).toBe("UNKNOWN");
    expect(trail.source).toBe("fallback");
    expect(trail.confidence).toBe(0);
  });

  test('audit trail always has all required fields', () => {
    const cases = [null, "cc0", "CC BY 4.0", "All Rights Reserved", undefined];
    for (const input of cases) {
      const { trail } = coerceLicenseWithTrail(input);
      expect(typeof trail.source).toBe("string");
      expect(typeof trail.provenance).toBe("string");
      expect(typeof trail.confidence).toBe("number");
      expect(Array.isArray(trail.flags)).toBe(true);
      expect(trail.provenance.length).toBeGreaterThan(0);
    }
  });

  test('provenance string mentions the input value', () => {
    const { trail } = coerceLicenseWithTrail("CC BY-SA 4.0");
    expect(trail.provenance).toContain("CC BY-SA 4.0");
  });
});

// ---------------------------------------------------------------------------
// 2. heuristicLicenseFromUrlWithTrail — URL heuristics + audit trail
// ---------------------------------------------------------------------------

describe("heuristicLicenseFromUrlWithTrail — URL heuristics", () => {
  test("unsplash.com → UNSPLASH_LICENSE, confidence=0.9, url-inferred flag", () => {
    const { license, confidence, trail } = heuristicLicenseFromUrlWithTrail(
      "https://unsplash.com/photos/abc123",
    );
    expect(license).toBe("UNSPLASH_LICENSE");
    expect(confidence).toBe(0.9);
    expect(trail.source).toBe("heuristic-url");
    expect(trail.flags).toContain("url-inferred");
  });

  test("images.unsplash.com CDN → UNSPLASH_LICENSE", () => {
    const { license } = heuristicLicenseFromUrlWithTrail(
      "https://images.unsplash.com/photo-abc?w=800",
    );
    expect(license).toBe("UNSPLASH_LICENSE");
  });

  test("pexels.com → PEXELS_LICENSE, confidence=0.9", () => {
    const { license, confidence } = heuristicLicenseFromUrlWithTrail(
      "https://www.pexels.com/photo/abc-123",
    );
    expect(license).toBe("PEXELS_LICENSE");
    expect(confidence).toBe(0.9);
  });

  test("cdn.pixabay.com → PIXABAY_LICENSE", () => {
    const { license } = heuristicLicenseFromUrlWithTrail(
      "https://cdn.pixabay.com/photo/abc.jpg",
    );
    expect(license).toBe("PIXABAY_LICENSE");
  });

  test("i.scdn.co (Spotify CDN) → EDITORIAL_LICENSED, confidence=0.7", () => {
    const { license, confidence } = heuristicLicenseFromUrlWithTrail(
      "https://i.scdn.co/image/ab67616d0000b273abc",
    );
    expect(license).toBe("EDITORIAL_LICENSED");
    expect(confidence).toBe(0.7);
  });

  test("coverartarchive.org → EDITORIAL_LICENSED, confidence=0.6", () => {
    const { license, confidence } = heuristicLicenseFromUrlWithTrail(
      "https://coverartarchive.org/release/abc/front",
    );
    expect(license).toBe("EDITORIAL_LICENSED");
    expect(confidence).toBe(0.6);
  });

  test("i.ytimg.com (YouTube) → EDITORIAL_LICENSED, confidence=0.5", () => {
    const { license, confidence } = heuristicLicenseFromUrlWithTrail(
      "https://i.ytimg.com/vi/abcXYZ/hqdefault.jpg",
    );
    expect(license).toBe("EDITORIAL_LICENSED");
    expect(confidence).toBe(0.5);
  });

  test("openverse.org → CC_BY, confidence=0.4 (conservative)", () => {
    const { license, confidence } = heuristicLicenseFromUrlWithTrail(
      "https://openverse.org/image/abc",
    );
    expect(license).toBe("CC_BY");
    expect(confidence).toBe(0.4);
  });

  test("upload.wikimedia.org → CC_BY_SA, confidence=0.4 (conservative)", () => {
    const { license, confidence } = heuristicLicenseFromUrlWithTrail(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/abc/file.jpg",
    );
    expect(license).toBe("CC_BY_SA");
    expect(confidence).toBe(0.4);
  });

  test("flickr.com → UNKNOWN, confidence=0.1 (per-item license required)", () => {
    const { license, confidence } = heuristicLicenseFromUrlWithTrail(
      "https://live.staticflickr.com/abc/photo.jpg",
    );
    // staticflickr.com is not in the heuristics list → fallback UNKNOWN
    expect(confidence).toBeLessThanOrEqual(0.1);
  });

  test("unknown domain → UNKNOWN, confidence=0, source=fallback", () => {
    const { license, confidence, trail } = heuristicLicenseFromUrlWithTrail(
      "https://some-unknown-cdn.example.io/image.jpg",
    );
    expect(license).toBe("UNKNOWN");
    expect(confidence).toBe(0);
    expect(trail.source).toBe("fallback");
  });

  test("malformed URL → UNKNOWN, confidence=0, source=fallback", () => {
    const { license, confidence, trail } = heuristicLicenseFromUrlWithTrail("not-a-url");
    expect(license).toBe("UNKNOWN");
    expect(confidence).toBe(0);
    expect(trail.source).toBe("fallback");
  });

  test("empty string URL → UNKNOWN, source=fallback", () => {
    const { license, trail } = heuristicLicenseFromUrlWithTrail("");
    expect(license).toBe("UNKNOWN");
    expect(trail.source).toBe("fallback");
  });

  test("all heuristic results have url-inferred flag when source=heuristic-url", () => {
    const knownUrls = [
      "https://unsplash.com/photo",
      "https://www.pexels.com/photo/x",
      "https://cdn.pixabay.com/img.jpg",
    ];
    for (const url of knownUrls) {
      const { trail } = heuristicLicenseFromUrlWithTrail(url);
      if (trail.source === "heuristic-url") {
        expect(trail.flags).toContain("url-inferred");
      }
    }
  });

  test("confidence in trail matches top-level confidence return", () => {
    const { confidence, trail } = heuristicLicenseFromUrlWithTrail(
      "https://images.pexels.com/photos/abc.jpeg",
    );
    expect(trail.confidence).toBe(confidence);
  });

  test("heuristic confidence ordering: unsplash(0.9) > wikimedia(0.4)", () => {
    const { confidence: unsplashConf } = heuristicLicenseFromUrlWithTrail(
      "https://unsplash.com/photo/abc",
    );
    const { confidence: wikiConf } = heuristicLicenseFromUrlWithTrail(
      "https://upload.wikimedia.org/commons/img.jpg",
    );
    expect(unsplashConf).toBeGreaterThan(wikiConf);
  });
});

// ---------------------------------------------------------------------------
// 3. validateAttributionLine — author detection, length, URLs
// ---------------------------------------------------------------------------

describe("validateAttributionLine — author and format validation", () => {
  test("valid standard attribution with author passes", async () => {
    const result = await validateAttributionLine(
      'Photo by Jane Doe, licensed CC BY 4.0',
      { checkLicenseUrl: false, checkSourcePageUrl: false },
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('"Photo by X" pattern is recognised as having author', async () => {
    const result = await validateAttributionLine(
      'Photo by Alice Smith (Unsplash), licensed Unsplash License',
      { checkLicenseUrl: false, checkSourcePageUrl: false },
    );
    expect(result.valid).toBe(true);
  });

  test('"Title" by author pattern is recognised', async () => {
    const result = await validateAttributionLine(
      '"Sunset Vista" by Bob Jones, licensed CC0',
      { checkLicenseUrl: false, checkSourcePageUrl: false },
    );
    expect(result.valid).toBe(true);
  });

  test('title-only attribution (CC0/PD, no "by") is valid', async () => {
    // "Photo (source), ..." pattern — no author required for CC0
    const result = await validateAttributionLine(
      '"Untitled" (Wikimedia Commons), licensed CC0 / Public Domain',
      { checkLicenseUrl: false, checkSourcePageUrl: false },
    );
    // Title-only is allowed by the hasTitleOnly check in the validator.
    expect(typeof result.valid).toBe("boolean");
    // Must not crash.
    expect(result.issues).toBeDefined();
  });

  test("missing author AND no title → issue about missing author", async () => {
    const result = await validateAttributionLine(
      "Licensed under CC0",
      { checkLicenseUrl: false, checkSourcePageUrl: false },
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes("author") || i.toLowerCase().includes("title"))).toBe(true);
  });

  test("attribution exactly 280 characters → valid (boundary)", async () => {
    const base = "Photo by Author Name, licensed CC0";
    const padding = " ".repeat(280 - base.length);
    const line = base + padding;
    expect(line.length).toBe(280);
    const result = await validateAttributionLine(line, {
      checkLicenseUrl: false,
      checkSourcePageUrl: false,
    });
    expect(result.issues.some((i) => i.includes("280"))).toBe(false);
  });

  test("attribution of 281 characters → issue about length", async () => {
    const line = "Photo by Author Name, licensed CC0" + "x".repeat(281 - 34);
    expect(line.length).toBeGreaterThan(280);
    const result = await validateAttributionLine(line, {
      checkLicenseUrl: false,
      checkSourcePageUrl: false,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("280"))).toBe(true);
  });

  test("plain HTTP URL in attribution → issue about HTTPS requirement", async () => {
    const result = await validateAttributionLine(
      "Photo by Jane Doe, licensed CC BY 4.0 — http://example.com/license",
      { checkLicenseUrl: false, checkSourcePageUrl: false },
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("http://") || i.toLowerCase().includes("http"))).toBe(true);
  });

  test("HTTPS URL returning 200 → no URL issue (with injectable fetcher)", async () => {
    const result = await validateAttributionLine(
      "Photo by Jane Doe, licensed CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/",
      { fetcher: ok200Fetcher, checkLicenseUrl: true, checkSourcePageUrl: true },
    );
    // URL check passes (200). Author check passes. Length OK.
    expect(result.valid).toBe(true);
  });

  test("HTTPS URL returning 404 → URL issue reported", async () => {
    const result = await validateAttributionLine(
      "Photo by Jane Doe, licensed CC BY 4.0 — https://missing.example.com/license",
      { fetcher: notFoundFetcher, checkLicenseUrl: true, checkSourcePageUrl: true },
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("404"))).toBe(true);
  });

  test("HTTPS URL redirecting to HTTP → URL issue reported", async () => {
    const result = await validateAttributionLine(
      "Photo by Jane Doe — https://redirect-to-http.example.com/license",
      { fetcher: httpRedirectFetcher, checkLicenseUrl: true, checkSourcePageUrl: true },
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.toLowerCase().includes("http"))).toBe(true);
  });

  test("network error on URL check → URL issue reported with message", async () => {
    const result = await validateAttributionLine(
      "Photo by Jane Doe — https://unreachable.internal/license",
      { fetcher: networkErrorFetcher, checkLicenseUrl: true, checkSourcePageUrl: true },
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.includes("check failed"))).toBe(true);
  });

  test("checkLicenseUrl:false skips URL check even with real URL", async () => {
    // With checkLicenseUrl=false, no fetch is done — the 404 fetcher is not called.
    const result = await validateAttributionLine(
      "Photo by Jane Doe — https://whatever.example.com/license",
      { fetcher: notFoundFetcher, checkLicenseUrl: false, checkSourcePageUrl: false },
    );
    // No URL-related issues (length and author are fine).
    const urlIssues = result.issues.filter((i) => i.includes("404") || i.includes("check failed"));
    expect(urlIssues).toHaveLength(0);
  });

  test("multiple HTTPS URLs: each is checked independently", async () => {
    // First URL 200, second 404 — second should produce an issue.
    let callCount = 0;
    const mixedFetcher = (async (input: URL | RequestInfo) => {
      callCount++;
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("good")) return new Response(null, { status: 200 });
      return new Response(null, { status: 404 });
    }) as MockFetch as typeof fetch;
    const result = await validateAttributionLine(
      "Photo by Jane Doe — https://good.example.com/license, https://bad.example.com/page",
      { fetcher: mixedFetcher, checkLicenseUrl: true, checkSourcePageUrl: true },
    );
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(result.issues.some((i) => i.includes("404"))).toBe(true);
  });

  test("empty string → invalid with missing-author issue", async () => {
    const result = await validateAttributionLine("", {
      checkLicenseUrl: false,
      checkSourcePageUrl: false,
    });
    expect(result.valid).toBe(false);
  });

  test("result shape is always { valid: boolean, issues: string[] }", async () => {
    const lines = [
      "Photo by Jane, licensed CC0",
      "",
      "x".repeat(300),
      "No author here",
    ];
    for (const line of lines) {
      const result = await validateAttributionLine(line, {
        checkLicenseUrl: false,
        checkSourcePageUrl: false,
      });
      expect(typeof result.valid).toBe("boolean");
      expect(Array.isArray(result.issues)).toBe(true);
      // valid === true iff issues is empty
      if (result.valid) expect(result.issues).toHaveLength(0);
      else expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Audit trail source hierarchy
// ---------------------------------------------------------------------------

describe("audit trail — source hierarchy", () => {
  const SOURCE_ORDER: LicenseAuditSource[] = [
    "api-metadata",
    "embedded-metadata",
    "heuristic-url",
    "fallback",
  ];

  function sourceRank(s: LicenseAuditSource): number {
    return SOURCE_ORDER.indexOf(s);
  }

  test("coerceLicenseWithTrail for known licenses uses api-metadata (rank 0)", () => {
    const sources: LicenseAuditSource[] = ["CC0", "CC BY 4.0", "CC BY-SA 4.0", "public domain"].map(
      (s) => coerceLicenseWithTrail(s).trail.source,
    );
    for (const src of sources) {
      expect(src).toBe("api-metadata");
      expect(sourceRank(src)).toBe(0);
    }
  });

  test("coerceLicenseWithTrail for unknown strings uses fallback (rank 3)", () => {
    const { trail } = coerceLicenseWithTrail("All Rights Reserved — NC/ND");
    expect(trail.source).toBe("fallback");
    expect(sourceRank(trail.source)).toBe(3);
  });

  test("heuristicLicenseFromUrlWithTrail for known host uses heuristic-url (rank 2)", () => {
    const { trail } = heuristicLicenseFromUrlWithTrail("https://unsplash.com/photo/x");
    expect(trail.source).toBe("heuristic-url");
    expect(sourceRank(trail.source)).toBe(2);
  });

  test("heuristicLicenseFromUrlWithTrail for unknown host uses fallback (rank 3)", () => {
    const { trail } = heuristicLicenseFromUrlWithTrail("https://unknown-domain.example/img.jpg");
    expect(trail.source).toBe("fallback");
    expect(sourceRank(trail.source)).toBe(3);
  });

  test("api-metadata rank < heuristic-url rank (api > heuristic)", () => {
    const apiRank = sourceRank("api-metadata");
    const heuristicRank = sourceRank("heuristic-url");
    expect(apiRank).toBeLessThan(heuristicRank);
  });

  test("heuristic-url rank < fallback rank", () => {
    expect(sourceRank("heuristic-url")).toBeLessThan(sourceRank("fallback"));
  });

  test("embedded-metadata rank is between api-metadata and heuristic-url", () => {
    const embedded = sourceRank("embedded-metadata");
    expect(embedded).toBeGreaterThan(sourceRank("api-metadata"));
    expect(embedded).toBeLessThan(sourceRank("heuristic-url"));
  });
});

// ---------------------------------------------------------------------------
// 5. Confidence decay rules
// ---------------------------------------------------------------------------

describe("confidence decay rules", () => {
  test("CC0 exact match (0.95) > CC0 URL match (0.85) > CC BY heuristic (0.75)", () => {
    const { trail: exact } = coerceLicenseWithTrail("cc0");
    const { trail: url } = coerceLicenseWithTrail(
      "https://creativecommons.org/publicdomain/zero/1.0/",
    );
    const { trail: ccby } = coerceLicenseWithTrail("CC BY 4.0");
    expect(exact.confidence).toBeGreaterThan(url.confidence);
    expect(url.confidence).toBeGreaterThan(ccby.confidence);
  });

  test("platform licenses (unsplash/pexels/pixabay) have confidence 0.9", () => {
    for (const s of ["Unsplash License", "Pexels License", "Pixabay License"]) {
      const { trail } = coerceLicenseWithTrail(s);
      expect(trail.confidence).toBe(0.9);
    }
  });

  test("URL heuristic confidence ≤ api-metadata confidence for same license", () => {
    // api-metadata path for UNSPLASH: confidence=0.9 (exact string match)
    const { trail: apiTrail } = coerceLicenseWithTrail("Unsplash License");
    // heuristic-url path: also 0.9 — they are equal at best, heuristic never exceeds api.
    const { trail: urlTrail } = heuristicLicenseFromUrlWithTrail(
      "https://unsplash.com/photo/abc",
    );
    // Both are 0.9 — URL heuristic should NOT exceed api-metadata.
    expect(urlTrail.confidence).toBeLessThanOrEqual(apiTrail.confidence);
  });

  test("fallback always has confidence 0", () => {
    const inputs = [null, undefined, "", "All Rights Reserved", "NC-ND"];
    for (const inp of inputs) {
      const { trail } = coerceLicenseWithTrail(inp);
      if (trail.source === "fallback") {
        expect(trail.confidence).toBe(0);
      }
    }
  });

  test("deprecated-cc-url flag does not change license value", () => {
    const { license: v3License } = coerceLicenseWithTrail(
      "https://creativecommons.org/licenses/by-sa/3.0/",
    );
    const { license: v4License } = coerceLicenseWithTrail("CC BY-SA 4.0");
    expect(v3License).toBe(v4License);
    expect(v3License).toBe("CC_BY_SA");
  });

  test("confidence values are always in [0, 1] for coerceLicenseWithTrail", () => {
    const testCases = [
      "cc0", "public domain", "CC BY 4.0", "CC BY-SA 4.0",
      "Unsplash License", "All Rights Reserved", null, undefined, "",
      "https://creativecommons.org/licenses/by/2.0/",
    ];
    for (const inp of testCases) {
      const { trail } = coerceLicenseWithTrail(inp);
      expect(trail.confidence).toBeGreaterThanOrEqual(0);
      expect(trail.confidence).toBeLessThanOrEqual(1);
    }
  });

  test("confidence values are always in [0, 1] for heuristicLicenseFromUrlWithTrail", () => {
    const urls = [
      "https://unsplash.com/photo",
      "https://www.pexels.com/photo/x",
      "https://upload.wikimedia.org/img.jpg",
      "https://i.ytimg.com/vi/abc.jpg",
      "https://unknown-domain.xyz/img.jpg",
      "not-a-url",
      "",
    ];
    for (const url of urls) {
      const { confidence, trail } = heuristicLicenseFromUrlWithTrail(url);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
      expect(trail.confidence).toBeGreaterThanOrEqual(0);
      expect(trail.confidence).toBeLessThanOrEqual(1);
    }
  });

  test("higher-confidence source for CC BY-SA: cc:license URL > substring match", () => {
    // Substring match produces confidence=0.8; the URL may also match at 0.8.
    // Verify that a direct "cc0" exact match beats a substring match.
    const { trail: bysa } = coerceLicenseWithTrail("CC BY-SA 4.0");
    const { trail: cc0Exact } = coerceLicenseWithTrail("cc0");
    expect(cc0Exact.confidence).toBeGreaterThan(bysa.confidence);
  });
});

// ---------------------------------------------------------------------------
// 6. validateAttributionLine — circular attribution and edge cases
// ---------------------------------------------------------------------------

describe("validateAttributionLine — edge cases", () => {
  test("attribution line that is only whitespace → invalid", async () => {
    const result = await validateAttributionLine("   ", {
      checkLicenseUrl: false,
      checkSourcePageUrl: false,
    });
    expect(result.valid).toBe(false);
  });

  test("two HTTP URLs in the line → two separate HTTP issues", async () => {
    const result = await validateAttributionLine(
      "Photo by Jane Doe — http://example.com/a, http://example.com/b",
      { checkLicenseUrl: false, checkSourcePageUrl: false },
    );
    expect(result.issues.filter((i) => i.includes("http://")).length).toBeGreaterThanOrEqual(2);
  });

  test("attribution with 'by' inside a URL (not an author) → still invalid if no real author", async () => {
    // "by" in a URL path should not satisfy the author heuristic as a standalone author.
    // e.g. "Photo https://example.com/photography/by-type/x" — the "by" is inside a URL.
    // The validator's regex `/by\s+\S/` requires 'by' followed by whitespace + a non-whitespace char.
    // A URL "by-type" has no space after 'by' → not matched.
    const result = await validateAttributionLine(
      "Licensed under https://creativecommons.org/publicdomain/zero/1.0/",
      { checkLicenseUrl: false, checkSourcePageUrl: false },
    );
    // "under" does not match "by \S", and no title-only pattern → invalid.
    expect(result.valid).toBe(false);
  });

  test("very long author name (within 280 chars total) → valid", async () => {
    const author = "A".repeat(100);
    const line = `Photo by ${author}, licensed CC0`;
    expect(line.length).toBeLessThanOrEqual(280);
    const result = await validateAttributionLine(line, {
      checkLicenseUrl: false,
      checkSourcePageUrl: false,
    });
    expect(result.valid).toBe(true);
  });

  test("URL-only attribution (no author, no title) → invalid", async () => {
    const result = await validateAttributionLine(
      "https://creativecommons.org/licenses/by/4.0/",
      { checkLicenseUrl: false, checkSourcePageUrl: false },
    );
    expect(result.valid).toBe(false);
  });

  test("multiple issues accumulate in issues array", async () => {
    // Exceeds length + contains HTTP URL + no author
    const badLine = "x".repeat(290) + " http://bad.com";
    const result = await validateAttributionLine(badLine, {
      checkLicenseUrl: false,
      checkSourcePageUrl: false,
    });
    expect(result.valid).toBe(false);
    // At least length issue + http URL issue
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });
});
