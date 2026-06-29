/**
 * Tests for attribution-audit.ts:
 *   - coerceLicenseWithTrail: all coercion paths
 *   - heuristicLicenseFromUrlWithTrail: URL heuristics + embedded metadata extraction
 *   - validateAttributionLine: author check, length check, URL validation (mocked HTTP)
 */

import { describe, expect, test } from "bun:test";
import {
  coerceLicenseWithTrail,
  heuristicLicenseFromUrlWithTrail,
  validateAttributionLine,
} from "../packages/core/src/attribution-audit.ts";
import type { LicenseAuditTrail } from "../packages/core/src/attribution-audit.ts";
import { rankAll } from "../packages/core/src/pick.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// coerceLicenseWithTrail
// ---------------------------------------------------------------------------

describe("coerceLicenseWithTrail — coercion paths", () => {
  test("null/undefined → UNKNOWN with fallback source and zero confidence", () => {
    for (const val of [null, undefined, ""]) {
      const { license, trail } = coerceLicenseWithTrail(val);
      expect(license).toBe("UNKNOWN");
      expect(trail.source).toBe("fallback");
      expect(trail.confidence).toBe(0);
      expect(trail.flags).toEqual([]);
    }
  });

  test("exact 'CC0' → CC0, api-metadata, high confidence", () => {
    const { license, trail } = coerceLicenseWithTrail("CC0");
    expect(license).toBe("CC0");
    expect(trail.source).toBe("api-metadata");
    expect(trail.confidence).toBeGreaterThanOrEqual(0.9);
    expect(trail.flags).toEqual([]);
  });

  test("'publicdomain/zero/1.0' URL path → CC0, api-metadata", () => {
    const { license, trail } = coerceLicenseWithTrail("publicdomain/zero/1.0");
    expect(license).toBe("CC0");
    expect(trail.source).toBe("api-metadata");
    expect(trail.confidence).toBeGreaterThanOrEqual(0.8);
  });

  test("'public domain dedication' → CC0", () => {
    const { license } = coerceLicenseWithTrail("Creative Commons Public Domain Dedication");
    expect(license).toBe("CC0");
  });

  test("'public domain' substring → PUBLIC_DOMAIN, api-metadata", () => {
    const { license, trail } = coerceLicenseWithTrail("public domain");
    expect(license).toBe("PUBLIC_DOMAIN");
    expect(trail.source).toBe("api-metadata");
    expect(trail.confidence).toBeGreaterThanOrEqual(0.7);
  });

  test("'pd' abbreviation → PUBLIC_DOMAIN", () => {
    expect(coerceLicenseWithTrail("PD").license).toBe("PUBLIC_DOMAIN");
  });

  test("CC BY-SA strings → CC_BY_SA, not CC_BY", () => {
    for (const raw of ["CC BY-SA 4.0", "cc-by-sa-3.0", "ShareAlike"]) {
      const { license, trail } = coerceLicenseWithTrail(raw);
      expect(license).toBe("CC_BY_SA");
      expect(trail.source).toBe("api-metadata");
    }
  });

  test("deprecated CC BY-SA URL → CC_BY_SA + deprecated-cc-url flag", () => {
    const { license, trail } = coerceLicenseWithTrail(
      "https://creativecommons.org/licenses/by-sa/2.0",
    );
    expect(license).toBe("CC_BY_SA");
    expect(trail.flags).toContain("deprecated-cc-url");
  });

  test("CC BY strings → CC_BY, not CC_BY_SA", () => {
    for (const raw of ["CC BY 4.0", "cc-by", "CCBY"]) {
      const { license } = coerceLicenseWithTrail(raw);
      expect(license).toBe("CC_BY");
    }
  });

  test("deprecated CC BY URL → CC_BY + deprecated-cc-url flag", () => {
    const { license, trail } = coerceLicenseWithTrail(
      "https://creativecommons.org/licenses/by/3.0",
    );
    expect(license).toBe("CC_BY");
    expect(trail.flags).toContain("deprecated-cc-url");
  });

  test("platform licenses — explicit match, not CC0", () => {
    expect(coerceLicenseWithTrail("Unsplash License").license).toBe("UNSPLASH_LICENSE");
    expect(coerceLicenseWithTrail("Pexels License").license).toBe("PEXELS_LICENSE");
    expect(coerceLicenseWithTrail("Pixabay Content License").license).toBe("PIXABAY_LICENSE");

    for (const plat of ["UNSPLASH_LICENSE", "PEXELS_LICENSE", "PIXABAY_LICENSE"] as const) {
      const { trail } = coerceLicenseWithTrail(
        plat === "UNSPLASH_LICENSE"
          ? "Unsplash License"
          : plat === "PEXELS_LICENSE"
            ? "Pexels License"
            : "Pixabay Content License",
      );
      expect(trail.confidence).toBeGreaterThanOrEqual(0.85);
    }
  });

  test("editorial keywords → EDITORIAL_LICENSED", () => {
    for (const raw of ["iTunes", "editorial use", "Spotify licensed", "CAA"]) {
      expect(coerceLicenseWithTrail(raw).license).toBe("EDITORIAL_LICENSED");
    }
  });

  test("press/promo keywords → PRESS_KIT_ALLOWLIST", () => {
    for (const raw of ["Official press photo", "promo image"]) {
      expect(coerceLicenseWithTrail(raw).license).toBe("PRESS_KIT_ALLOWLIST");
    }
  });

  test("'all rights reserved' → UNKNOWN, fallback", () => {
    const { license, trail } = coerceLicenseWithTrail("all rights reserved");
    expect(license).toBe("UNKNOWN");
    expect(trail.source).toBe("fallback");
    expect(trail.confidence).toBe(0);
  });

  test("all results include non-empty provenance string", () => {
    const inputs = [
      "CC0",
      "CC BY 4.0",
      "CC BY-SA 4.0",
      "Unsplash License",
      "editorial",
      "press",
      "all rights reserved",
      null,
    ];
    for (const raw of inputs) {
      const { trail } = coerceLicenseWithTrail(raw);
      expect(typeof trail.provenance).toBe("string");
      expect(trail.provenance.length).toBeGreaterThan(0);
    }
  });

  test("trail shape is always complete (source, provenance, confidence, flags[])", () => {
    const { trail } = coerceLicenseWithTrail("CC BY 4.0");
    const t: LicenseAuditTrail = trail; // type-check
    expect(typeof t.source).toBe("string");
    expect(typeof t.provenance).toBe("string");
    expect(typeof t.confidence).toBe("number");
    expect(Array.isArray(t.flags)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// heuristicLicenseFromUrlWithTrail — URL heuristics
// ---------------------------------------------------------------------------

describe("heuristicLicenseFromUrlWithTrail — URL heuristics", () => {
  test("Unsplash CDN → UNSPLASH_LICENSE, high confidence, url-inferred flag", () => {
    const { license, confidence, trail } = heuristicLicenseFromUrlWithTrail(
      "https://images.unsplash.com/photo-abc.jpg",
    );
    expect(license).toBe("UNSPLASH_LICENSE");
    expect(confidence).toBeGreaterThanOrEqual(0.85);
    expect(trail.source).toBe("heuristic-url");
    expect(trail.flags).toContain("url-inferred");
  });

  test("Pexels CDN → PEXELS_LICENSE", () => {
    const { license, trail } = heuristicLicenseFromUrlWithTrail(
      "https://images.pexels.com/photos/123/abc.jpeg",
    );
    expect(license).toBe("PEXELS_LICENSE");
    expect(trail.source).toBe("heuristic-url");
  });

  test("Pixabay CDN → PIXABAY_LICENSE", () => {
    const { license } = heuristicLicenseFromUrlWithTrail(
      "https://cdn.pixabay.com/photo/2020/abc.jpg",
    );
    expect(license).toBe("PIXABAY_LICENSE");
  });

  test("Wikimedia Commons → CC_BY_SA (conservative), medium confidence", () => {
    const { license, confidence, trail } = heuristicLicenseFromUrlWithTrail(
      "https://upload.wikimedia.org/wikipedia/commons/abc.jpg",
    );
    expect(license).toBe("CC_BY_SA");
    expect(confidence).toBeLessThan(0.6);
    expect(trail.flags).toContain("url-inferred");
  });

  test("Flickr → UNKNOWN, very low confidence", () => {
    const { license, confidence } = heuristicLicenseFromUrlWithTrail(
      "https://live.staticflickr.com/xyz/abc.jpg",
    );
    expect(license).toBe("UNKNOWN");
    expect(confidence).toBeLessThanOrEqual(0.1);
  });

  test("Spotify CDN → EDITORIAL_LICENSED", () => {
    const { license } = heuristicLicenseFromUrlWithTrail("https://i.scdn.co/image/abc");
    expect(license).toBe("EDITORIAL_LICENSED");
  });

  test("YouTube thumbnail CDN → EDITORIAL_LICENSED", () => {
    const { license } = heuristicLicenseFromUrlWithTrail(
      "https://i.ytimg.com/vi/abc/hqdefault.jpg",
    );
    expect(license).toBe("EDITORIAL_LICENSED");
  });

  test("Openverse → CC_BY, low confidence", () => {
    const { license, confidence } = heuristicLicenseFromUrlWithTrail(
      "https://openverse.org/image/abc",
    );
    expect(license).toBe("CC_BY");
    expect(confidence).toBeLessThan(0.6);
  });

  test("unknown host → UNKNOWN, zero confidence, fallback source", () => {
    const { license, confidence, trail } = heuristicLicenseFromUrlWithTrail(
      "https://example.com/image.jpg",
    );
    expect(license).toBe("UNKNOWN");
    expect(confidence).toBe(0);
    expect(trail.source).toBe("fallback");
  });

  test("malformed URL → UNKNOWN, zero confidence, fallback source", () => {
    const { license, confidence, trail } = heuristicLicenseFromUrlWithTrail("not-a-url");
    expect(license).toBe("UNKNOWN");
    expect(confidence).toBe(0);
    expect(trail.source).toBe("fallback");
  });

  test("all trail results include non-empty provenance", () => {
    const urls = [
      "https://images.unsplash.com/x.jpg",
      "https://example.com/x.jpg",
      "not-a-url",
      "https://upload.wikimedia.org/x.jpg",
    ];
    for (const url of urls) {
      const { trail } = heuristicLicenseFromUrlWithTrail(url);
      expect(trail.provenance.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// validateAttributionLine — mocked HTTP responses
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock fetcher that returns the given status codes for each URL.
 * Keys are URLs, values are the desired HTTP status code.
 * If redirect is specified it returns a 301 with Location header.
 */
function mockFetcher(
  responses: Record<
    string,
    | number
    | { status: number; location?: string }
  >,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const entry = responses[url];
    if (entry === undefined) {
      // Not in the map — return 404
      return new Response(null, { status: 404 });
    }
    const status = typeof entry === "number" ? entry : entry.status;
    const location = typeof entry === "object" ? entry.location : undefined;
    const headers = location ? { location } : undefined;
    return new Response(null, { status, headers });
  };
}

describe("validateAttributionLine — author check", () => {
  test("valid attribution with author passes author check", async () => {
    const line = 'Photo by Jane Doe (Unsplash), licensed CC BY 4.0';
    const result = await validateAttributionLine(line, {
      checkLicenseUrl: false,
      checkSourcePageUrl: false,
    });
    expect(result.issues.some((i) => i.includes("author"))).toBe(false);
  });

  test("title-only attribution (CC0) passes author check", async () => {
    const line = '"Blue Horizon" (Unsplash), licensed CC0 / Public Domain Dedication';
    const result = await validateAttributionLine(line, {
      checkLicenseUrl: false,
      checkSourcePageUrl: false,
    });
    expect(result.issues.some((i) => i.includes("author"))).toBe(false);
  });

  test("plain 'Photo' with no author or title fails author check", async () => {
    const line = "Photo, licensed CC BY 4.0";
    const result = await validateAttributionLine(line, {
      checkLicenseUrl: false,
      checkSourcePageUrl: false,
    });
    expect(result.issues.some((i) => i.includes("author"))).toBe(true);
    expect(result.valid).toBe(false);
  });
});

describe("validateAttributionLine — length check", () => {
  test("line ≤ 280 chars passes", async () => {
    const line = "Photo by A, licensed CC0 / Public Domain Dedication";
    const result = await validateAttributionLine(line, {
      checkLicenseUrl: false,
      checkSourcePageUrl: false,
    });
    expect(result.issues.some((i) => i.includes("280"))).toBe(false);
  });

  test("line > 280 chars fails with length issue", async () => {
    const line = "Photo by " + "X".repeat(280);
    const result = await validateAttributionLine(line, {
      checkLicenseUrl: false,
      checkSourcePageUrl: false,
    });
    expect(result.issues.some((i) => i.includes("280"))).toBe(true);
    expect(result.valid).toBe(false);
  });
});

describe("validateAttributionLine — URL validation (mocked HTTP)", () => {
  test("HTTPS URL returning 200 passes", async () => {
    const url = "https://creativecommons.org/licenses/by/4.0";
    const fetcher = mockFetcher({ [url]: 200 });
    const line = `Photo by Jane, licensed CC BY 4.0 — ${url}`;
    const result = await validateAttributionLine(line, { fetcher });
    expect(result.issues.filter((i) => i.includes(url))).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  test("HTTPS URL returning 404 fails with URL issue", async () => {
    const url = "https://creativecommons.org/licenses/by/4.0";
    const fetcher = mockFetcher({ [url]: 404 });
    const line = `Photo by Jane, licensed CC BY 4.0 — ${url}`;
    const result = await validateAttributionLine(line, { fetcher });
    expect(result.issues.some((i) => i.includes("404"))).toBe(true);
    expect(result.valid).toBe(false);
  });

  test("URL redirecting to plain HTTP fails", async () => {
    const url = "https://example.com/license";
    const fetcher = mockFetcher({ [url]: { status: 301, location: "http://example.com/license" } });
    const line = `Photo by Jane, licensed CC BY 4.0 — ${url}`;
    const result = await validateAttributionLine(line, { fetcher });
    expect(result.issues.some((i) => i.toLowerCase().includes("http"))).toBe(true);
    expect(result.valid).toBe(false);
  });

  test("plain HTTP URL in attribution line fails immediately (no fetch needed)", async () => {
    const fetcher = mockFetcher({});
    const line = "Photo by Jane, licensed CC BY 4.0 — http://creativecommons.org/licenses/by/4.0";
    const result = await validateAttributionLine(line, { fetcher, checkLicenseUrl: false });
    expect(result.issues.some((i) => i.includes("plain-HTTP"))).toBe(true);
    expect(result.valid).toBe(false);
  });

  test("checkLicenseUrl:false skips live URL check", async () => {
    // fetcher would throw if called — verifies it is not called
    const fetcher: typeof fetch = () => {
      throw new Error("fetch should not be called");
    };
    const line = "Photo by Jane, licensed CC BY 4.0 — https://creativecommons.org/licenses/by/4.0";
    const result = await validateAttributionLine(line, {
      fetcher,
      checkLicenseUrl: false,
      checkSourcePageUrl: false,
    });
    // No error from fetcher being called
    expect(result.issues.filter((i) => i.includes("fetch should not be called"))).toHaveLength(0);
  });

  test("multiple URLs in line — all checked, failures accumulate", async () => {
    const urlA = "https://creativecommons.org/licenses/by/4.0";
    const urlB = "https://example.com/source-page";
    const fetcher = mockFetcher({ [urlA]: 200, [urlB]: 503 });
    const line = `Photo by Jane, licensed CC BY 4.0 — ${urlA} / source: ${urlB}`;
    const result = await validateAttributionLine(line, { fetcher });
    expect(result.issues.some((i) => i.includes("503"))).toBe(true);
    expect(result.valid).toBe(false);
  });

  test("fully valid line: author + HTTPS 200 + ≤280 chars → valid:true, issues:[]", async () => {
    const url = "https://creativecommons.org/licenses/zero/1.0";
    const fetcher = mockFetcher({ [url]: 200 });
    const line = `Photo by Alice Smith, licensed CC0 / Public Domain Dedication — ${url}`;
    expect(line.length).toBeLessThanOrEqual(280);
    const result = await validateAttributionLine(line, { fetcher });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pick.ts integration — licenseAuditTrail as tie-breaker
// ---------------------------------------------------------------------------

describe("rankAll — licenseAuditTrail tie-breaker", () => {
  const mk = (p: Partial<ImageCandidate>): ImageCandidate => ({
    url: "https://x/1",
    source: "x",
    license: "CC_BY",
    ...p,
  });

  test("higher trail confidence wins over lower when rank and conf are equal", () => {
    const cands: ImageCandidate[] = [
      mk({
        url: "low-trail",
        confidence: 0.8,
        licenseAuditTrail: {
          source: "heuristic-url",
          provenance: "from url",
          confidence: 0.4,
          flags: ["url-inferred"],
        },
      }),
      mk({
        url: "high-trail",
        confidence: 0.8,
        licenseAuditTrail: {
          source: "api-metadata",
          provenance: "from api",
          confidence: 0.95,
          flags: [],
        },
      }),
    ];
    const ranked = rankAll(cands, { licensePolicy: "context-safe" });
    expect(ranked[0]?.url).toBe("high-trail");
    expect(ranked[1]?.url).toBe("low-trail");
  });

  test("candidate without trail loses to candidate with trail when rank and conf are equal", () => {
    const cands: ImageCandidate[] = [
      mk({ url: "no-trail", confidence: 0.8 }),
      mk({
        url: "with-trail",
        confidence: 0.8,
        licenseAuditTrail: {
          source: "embedded-metadata",
          provenance: "from exif",
          confidence: 0.85,
          flags: [],
        },
      }),
    ];
    const ranked = rankAll(cands, { licensePolicy: "context-safe" });
    expect(ranked[0]?.url).toBe("with-trail");
  });

  test("primary conf still beats trail confidence when conf differs", () => {
    const cands: ImageCandidate[] = [
      mk({
        url: "high-conf-low-trail",
        confidence: 0.95,
        licenseAuditTrail: {
          source: "heuristic-url",
          provenance: "url",
          confidence: 0.3,
          flags: ["url-inferred"],
        },
      }),
      mk({
        url: "low-conf-high-trail",
        confidence: 0.5,
        licenseAuditTrail: {
          source: "api-metadata",
          provenance: "api",
          confidence: 0.99,
          flags: [],
        },
      }),
    ];
    const ranked = rankAll(cands, { licensePolicy: "context-safe" });
    // conf is primary tie-breaker after rank; high-conf wins
    expect(ranked[0]?.url).toBe("high-conf-low-trail");
  });
});
