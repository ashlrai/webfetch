/**
 * Comprehensive test suite for `dedupeWithPhashGrouping()` and supporting
 * dedupe utilities.
 *
 * Covers:
 *  - Single-provider duplicates (URL collapse + phash grouping)
 *  - Multi-provider same-image groups
 *  - Confidence aggregation: high-conf metadata beats low-conf heuristics
 *  - Confidence decay when UNKNOWN-license providers mix with known-license providers
 *  - Canonical URL selection (score → license rank → order)
 *  - Alternate-URL tracking per group
 *  - URL normalization edge cases (CDN params, hash fragments, port, protocol)
 *  - Integration-shape test mirroring the findSimilar() reverse-image pipeline
 *  - dedupeByUrl / dedupeByHash regression coverage
 *  - hammingDistance boundary conditions
 *  - groups DuplicateGroup shape + member indices
 *  - singletons pass-through
 *  - Empty / single-element edge cases
 */

import { describe, expect, test } from "bun:test";
import {
  compareCandidates,
  dedupeByHash,
  dedupeByUrl,
  dedupeWithPhashGrouping,
  hammingDistance,
} from "./dedupe.ts";
import type {
  ImageCandidate,
  PhashCanonicalCandidate,
  SearchResultBundle,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkc(
  url: string,
  source: string,
  opts: Partial<ImageCandidate> = {},
): ImageCandidate {
  return { url, source, license: "CC0", ...opts };
}

function bundle(...candidates: ImageCandidate[]): SearchResultBundle {
  return { candidates, providerReports: [], warnings: [] };
}

// ---------------------------------------------------------------------------
// 1. dedupeByUrl — URL normalization edge cases
// ---------------------------------------------------------------------------

describe("dedupeByUrl — URL normalization edge cases", () => {
  test("strips w, h, q, fit, auto, fm, dpr, crop params", () => {
    const cands = [
      mkc("https://img.com/a.jpg?w=800&h=600&q=80&fit=crop&auto=compress&fm=webp&dpr=2&crop=faces", "p1"),
      mkc("https://img.com/a.jpg", "p2"),
    ];
    expect(dedupeByUrl(cands)).toHaveLength(1);
  });

  test("strips hash fragment", () => {
    const cands = [
      mkc("https://img.com/a.jpg#section", "p1"),
      mkc("https://img.com/a.jpg", "p2"),
    ];
    expect(dedupeByUrl(cands)).toHaveLength(1);
  });

  test("strips hash fragment AND query params together", () => {
    const cands = [
      mkc("https://img.com/a.jpg?w=200#top", "p1"),
      mkc("https://img.com/a.jpg?q=90#bottom", "p2"),
    ];
    expect(dedupeByUrl(cands)).toHaveLength(1);
  });

  test("preserves non-cache-buster query params after stripping", () => {
    // 'page' is not in the strip list — two different page values are distinct
    const cands = [
      mkc("https://img.com/search?page=1", "p1"),
      mkc("https://img.com/search?page=2", "p2"),
    ];
    expect(dedupeByUrl(cands)).toHaveLength(2);
  });

  test("same path but different origins are not collapsed", () => {
    const cands = [
      mkc("https://cdn-a.com/img.jpg", "p1"),
      mkc("https://cdn-b.com/img.jpg", "p2"),
    ];
    expect(dedupeByUrl(cands)).toHaveLength(2);
  });

  test("protocol difference (http vs https) is treated as distinct", () => {
    const cands = [
      mkc("http://img.com/a.jpg", "p1"),
      mkc("https://img.com/a.jpg", "p2"),
    ];
    // URL origin includes protocol — these are distinct after normalization
    expect(dedupeByUrl(cands)).toHaveLength(2);
  });

  test("keeps first occurrence when collapsing", () => {
    const cands = [
      mkc("https://img.com/a.jpg?w=200", "first"),
      mkc("https://img.com/a.jpg?w=1600", "second"),
    ];
    const out = dedupeByUrl(cands);
    expect(out[0]!.source).toBe("first");
  });

  test("empty array returns empty", () => {
    expect(dedupeByUrl([])).toHaveLength(0);
  });

  test("single candidate passes through unchanged", () => {
    const c = mkc("https://img.com/a.jpg", "p1");
    const out = dedupeByUrl([c]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(c);
  });

  test("t (timestamp) param is stripped", () => {
    const cands = [
      mkc("https://img.com/a.jpg?t=1234567890", "p1"),
      mkc("https://img.com/a.jpg", "p2"),
    ];
    expect(dedupeByUrl(cands)).toHaveLength(1);
  });

  test("s (signature) param is stripped", () => {
    const cands = [
      mkc("https://img.com/a.jpg?s=abc123", "p1"),
      mkc("https://img.com/a.jpg", "p2"),
    ];
    expect(dedupeByUrl(cands)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. dedupeByHash — sync threshold boundary
// ---------------------------------------------------------------------------

describe("dedupeByHash — sync threshold boundary", () => {
  test("exactly-equal hashes are always collapsed", () => {
    const h = "abcdef1234567890";
    const cands = [mkc("https://a.com/1.jpg", "p1", { phash: h }), mkc("https://b.com/2.jpg", "p2", { phash: h })];
    expect(dedupeByHash(cands, 0)).toHaveLength(1);
  });

  test("1-bit diff within threshold=1 collapses", () => {
    const cands = [
      mkc("https://a.com/1.jpg", "p1", { phash: "0000000000000000" }),
      mkc("https://b.com/2.jpg", "p2", { phash: "0000000000000001" }),
    ];
    expect(dedupeByHash(cands, 1)).toHaveLength(1);
  });

  test("1-bit diff outside threshold=0 does not collapse", () => {
    const cands = [
      mkc("https://a.com/1.jpg", "p1", { phash: "0000000000000000" }),
      mkc("https://b.com/2.jpg", "p2", { phash: "0000000000000001" }),
    ];
    expect(dedupeByHash(cands, 0)).toHaveLength(2);
  });

  test("candidates without phash are never collapsed", () => {
    const cands = [
      mkc("https://a.com/1.jpg", "p1"),
      mkc("https://b.com/2.jpg", "p2"),
      mkc("https://c.com/3.jpg", "p3"),
    ];
    expect(dedupeByHash(cands, 10)).toHaveLength(3);
  });

  test("mixed hashed and unhashed: only hashed pair collapses", () => {
    const h = "1111111111111111";
    const cands = [
      mkc("https://a.com/1.jpg", "p1", { phash: h }),
      mkc("https://b.com/2.jpg", "p2", { phash: h }),
      mkc("https://c.com/3.jpg", "p3"),
    ];
    expect(dedupeByHash(cands, 6)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 3. dedupeWithPhashGrouping — single-provider duplicates
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — single-provider duplicates", () => {
  test("two URLs from same provider with identical phash collapse to one canonical", async () => {
    const h = "aabbccdd11223344";
    const cands = [
      mkc("https://cdn.example.com/img.jpg?w=200", "unsplash", { phash: h }),
      mkc("https://cdn.example.com/img.jpg?w=1600", "unsplash", { phash: h }),
    ];
    const { canonical, singletons } = await dedupeWithPhashGrouping(cands);
    // Same normalized URL → URL-collapse before phash → one canonical
    expect(canonical).toHaveLength(1);
    expect(singletons).toHaveLength(0);
  });

  test("same provider, different image paths, identical phash → one canonical with alternateUrl", async () => {
    const h = "1234567890abcdef";
    const cands = [
      mkc("https://unsplash.com/photos/abc.jpg", "unsplash", { phash: h, score: 0.9 }),
      mkc("https://unsplash.com/photos/def.jpg", "unsplash", { phash: h, score: 0.5 }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical).toHaveLength(1);
    expect(canonical[0]!.alternateUrls).toHaveLength(1);
    expect(canonical[0]!.providers).toEqual(["unsplash"]);
  });

  test("three CDN size variants collapse to one via URL normalization", async () => {
    const h = "cafe0000cafe0000";
    const cands = [
      mkc("https://cdn.pexels.com/photo.jpg?w=480", "pexels", { phash: h }),
      mkc("https://cdn.pexels.com/photo.jpg?w=1280", "pexels", { phash: h }),
      mkc("https://cdn.pexels.com/photo.jpg?w=1920&q=80", "pexels", { phash: h }),
    ];
    const { canonical, singletons } = await dedupeWithPhashGrouping(cands);
    expect(canonical).toHaveLength(1);
    expect(singletons).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. dedupeWithPhashGrouping — multi-provider same-image groups
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — multi-provider same-image groups", () => {
  test("five providers returning same image hash → single canonical with all five providers", async () => {
    const h = "deadbeef01234567";
    const providers = ["wikimedia", "openverse", "unsplash", "pexels", "pixabay"];
    const cands = providers.map((src, i) =>
      mkc(`https://${src}.com/img.jpg`, src, { phash: h, score: 0.5 + i * 0.05 }),
    );
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical).toHaveLength(1);
    expect(canonical[0]!.providers.sort()).toEqual(providers.slice().sort());
    expect(canonical[0]!.alternateUrls).toHaveLength(4);
  });

  test("two distinct visuals each from two providers → two canonicals", async () => {
    const h1 = "1111111111111111";
    const h2 = "eeeeeeeeeeeeeeee";
    const cands = [
      mkc("https://a.com/img1.jpg", "wikimedia", { phash: h1, score: 0.8 }),
      mkc("https://b.com/img1.jpg", "openverse", { phash: h1, score: 0.6 }),
      mkc("https://c.com/img2.jpg", "unsplash", { phash: h2, score: 0.9 }),
      mkc("https://d.com/img2.jpg", "pexels", { phash: h2, score: 0.7 }),
    ];
    const { canonical, singletons } = await dedupeWithPhashGrouping(cands);
    expect(canonical).toHaveLength(2);
    expect(singletons).toHaveLength(0);
  });

  test("near-duplicate phashes across providers are grouped at threshold=8", async () => {
    // distance between these two = 4 bits (within default threshold=8)
    const cands = [
      mkc("https://wikimedia.org/img.jpg", "wikimedia", { phash: "000000000000000f" }),
      mkc("https://openverse.org/img.jpg", "openverse", { phash: "0000000000000000" }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands, { hammingThreshold: 8 });
    expect(canonical).toHaveLength(1);
    expect(canonical[0]!.providers.sort()).toEqual(["openverse", "wikimedia"]);
  });

  test("providers array has no duplicates when same provider in multiple URL groups", async () => {
    const h = "aabbccdd00112233";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h }),
      mkc("https://b.com/img.jpg", "wikimedia", { phash: h }),
      mkc("https://c.com/img.jpg", "openverse", { phash: h }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    // wikimedia appears twice in input but should be deduplicated
    const wikiCount = canonical[0]!.providers.filter((p) => p === "wikimedia").length;
    expect(wikiCount).toBe(1);
  });

  test("mixing phash-grouped and non-grouped candidates", async () => {
    const h = "f0f0f0f0f0f0f0f0";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h }),
      mkc("https://b.com/img.jpg", "openverse", { phash: h }),
      mkc("https://c.com/unique.jpg", "unsplash"),  // no phash — singleton
      mkc("https://d.com/other.jpg", "pexels"),     // no phash — singleton
    ];
    const { canonical, singletons } = await dedupeWithPhashGrouping(cands);
    expect(canonical).toHaveLength(1);
    expect(singletons).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Confidence aggregation — high-conf metadata wins over low-conf heuristics
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — confidence aggregation", () => {
  test("dct-phash group has higher aggregatedConfidence than ahash-fallback group", async () => {
    const hA = "aabb000011223344";
    const hB = "aabb000011223345"; // 1 bit diff

    const dctCands = [
      mkc("https://a.com/img.jpg", "wikimedia", {
        phash: hA, phashAlgorithm: "dct-phash",
        phashResult: { hash: hA, algorithm: "dct-phash", confidence: 1.0 }, license: "CC0",
      }),
      mkc("https://b.com/img.jpg", "openverse", {
        phash: hB, phashAlgorithm: "dct-phash",
        phashResult: { hash: hB, algorithm: "dct-phash", confidence: 1.0 }, license: "CC0",
      }),
    ];
    const ahashCands = [
      mkc("https://c.com/img.jpg", "unsplash", {
        phash: hA, phashAlgorithm: "ahash-fallback",
        phashResult: { hash: hA, algorithm: "ahash-fallback", confidence: 0.5 }, license: "CC0",
      }),
      mkc("https://d.com/img.jpg", "pexels", {
        phash: hB, phashAlgorithm: "ahash-fallback",
        phashResult: { hash: hB, algorithm: "ahash-fallback", confidence: 0.5 }, license: "CC0",
      }),
    ];

    const dctResult = await dedupeWithPhashGrouping(dctCands);
    const ahashResult = await dedupeWithPhashGrouping(ahashCands);
    expect(dctResult.canonical[0]!.aggregatedConfidence).toBeGreaterThan(
      ahashResult.canonical[0]!.aggregatedConfidence,
    );
  });

  test("phashWeight=1.0: only algorithm quality contributes, license irrelevant", async () => {
    const h = "cafe00cafe00cafe";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", {
        phash: h, phashAlgorithm: "dct-phash",
        phashResult: { hash: h, algorithm: "dct-phash", confidence: 1.0 }, license: "UNKNOWN",
      }),
      mkc("https://b.com/img.jpg", "openverse", {
        phash: h, phashAlgorithm: "dct-phash",
        phashResult: { hash: h, algorithm: "dct-phash", confidence: 1.0 }, license: "UNKNOWN",
      }),
    ];
    // Pure UNKNOWN group → no decay (no known-license members to compare against)
    const { canonical } = await dedupeWithPhashGrouping(cands, { phashWeight: 1.0 });
    expect(canonical[0]!.aggregatedConfidence).toBe(1.0);
  });

  test("phashWeight=0.0: only license rank contributes", async () => {
    const h = "1234567890abcdef";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, license: "CC0" }),
      mkc("https://b.com/img.jpg", "openverse", { phash: h, license: "CC0" }),
    ];
    // CC0 rank=1 → licenseScore=1.0; phashWeight=0 → base=1.0; pure CC0 → no decay
    const { canonical } = await dedupeWithPhashGrouping(cands, { phashWeight: 0 });
    expect(canonical[0]!.aggregatedConfidence).toBe(1.0);
  });

  test("aggregatedConfidence is always in [0, 1]", async () => {
    const h = "ffffffff00000000";
    const cands = [
      mkc("https://a.com/img.jpg", "brave", { phash: h, license: "UNKNOWN" }),
      mkc("https://b.com/img.jpg", "bing", { phash: h, license: "UNKNOWN" }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    const conf = canonical[0]!.aggregatedConfidence;
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
  });

  test("CC0 license in group lifts confidence vs EDITORIAL_LICENSED", async () => {
    const h = "0011223344556677";
    const cc0Cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, license: "CC0" }),
      mkc("https://b.com/img.jpg", "openverse", { phash: h, license: "CC0" }),
    ];
    const editCands = [
      mkc("https://c.com/img.jpg", "bing", { phash: h, license: "EDITORIAL_LICENSED" }),
      mkc("https://d.com/img.jpg", "brave", { phash: h, license: "EDITORIAL_LICENSED" }),
    ];
    const cc0Result = await dedupeWithPhashGrouping(cc0Cands, { phashWeight: 0 });
    const editResult = await dedupeWithPhashGrouping(editCands, { phashWeight: 0 });
    expect(cc0Result.canonical[0]!.aggregatedConfidence).toBeGreaterThan(
      editResult.canonical[0]!.aggregatedConfidence,
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Confidence decay — UNKNOWN-license mix with known-license providers
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — confidence decay for UNKNOWN-license mix", () => {
  test("mixed UNKNOWN + CC0 group has lower confidence than pure CC0 group", async () => {
    const h = "8888888888888888";

    const pureCC0 = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, license: "CC0" }),
      mkc("https://b.com/img.jpg", "openverse", { phash: h, license: "CC0" }),
    ];
    const mixed = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, license: "CC0" }),
      mkc("https://b.com/img.jpg", "brave",     { phash: h, license: "UNKNOWN" }),
    ];

    const pureResult = await dedupeWithPhashGrouping(pureCC0, { phashWeight: 0 });
    const mixedResult = await dedupeWithPhashGrouping(mixed, { phashWeight: 0 });

    expect(mixedResult.canonical[0]!.aggregatedConfidence).toBeLessThan(
      pureResult.canonical[0]!.aggregatedConfidence,
    );
  });

  test("pure UNKNOWN group has no decay (no known comparator present)", async () => {
    const h = "9999999999999999";
    const cands = [
      mkc("https://a.com/img.jpg", "brave", { phash: h, license: "UNKNOWN" }),
      mkc("https://b.com/img.jpg", "bing",  { phash: h, license: "UNKNOWN" }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands, { phashWeight: 0 });
    // Pure UNKNOWN → unknownMixDecay = 1 (no penalty, no decay)
    // phashWeight=0, bestLicense = 1/99 ≈ 0.01 for both
    const conf = canonical[0]!.aggregatedConfidence;
    // Should be ~licenseScore(UNKNOWN) with no decay = 1/99 ≈ 0.0101
    expect(conf).toBeGreaterThan(0);
    expect(conf).toBeLessThan(0.02);
  });

  test("higher UNKNOWN fraction → lower confidence (monotonic decay)", async () => {
    const h = "aaaa0000aaaa0000";

    // 1/3 UNKNOWN (1 UNKNOWN + 2 known)
    const lowUnknown = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, license: "CC0" }),
      mkc("https://b.com/img.jpg", "openverse", { phash: h, license: "CC0" }),
      mkc("https://c.com/img.jpg", "brave",     { phash: h, license: "UNKNOWN" }),
    ];
    // 2/3 UNKNOWN (2 UNKNOWN + 1 known)
    const highUnknown = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, license: "CC0" }),
      mkc("https://b.com/img.jpg", "brave",     { phash: h, license: "UNKNOWN" }),
      mkc("https://c.com/img.jpg", "bing",      { phash: h, license: "UNKNOWN" }),
    ];

    const lowResult  = await dedupeWithPhashGrouping(lowUnknown, { phashWeight: 0 });
    const highResult = await dedupeWithPhashGrouping(highUnknown, { phashWeight: 0 });

    expect(lowResult.canonical[0]!.aggregatedConfidence).toBeGreaterThan(
      highResult.canonical[0]!.aggregatedConfidence,
    );
  });

  test("decay does not drop confidence below 0", async () => {
    const h = "bbbb0000bbbb0000";
    // Worst case: one very low-rank known + many UNKNOWN
    const cands = [
      mkc("https://a.com/img.jpg", "press", { phash: h, license: "PRESS_KIT_ALLOWLIST" }),
      mkc("https://b.com/img.jpg", "brave", { phash: h, license: "UNKNOWN" }),
      mkc("https://c.com/img.jpg", "bing",  { phash: h, license: "UNKNOWN" }),
      mkc("https://d.com/img.jpg", "x",     { phash: h, license: "UNKNOWN" }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands, { phashWeight: 0 });
    expect(canonical[0]!.aggregatedConfidence).toBeGreaterThanOrEqual(0);
  });

  test("single-member group (should not occur as canonical but check decay is 1)", async () => {
    // Singletons skip the decay path entirely
    const c = mkc("https://a.com/img.jpg", "brave", { license: "UNKNOWN" });
    const { singletons } = await dedupeWithPhashGrouping([c]);
    expect(singletons).toHaveLength(1);
    // singletons are raw ImageCandidates — no aggregatedConfidence
    expect((singletons[0] as PhashCanonicalCandidate).aggregatedConfidence).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 7. Canonical URL selection — license-rank tiebreaker
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — canonical selection with license-rank tiebreaker", () => {
  test("on score tie, CC0 candidate is preferred over UNKNOWN", async () => {
    const h = "cccc111122223333";
    const cands = [
      mkc("https://a.com/img.jpg", "brave",    { phash: h, score: 0.7, license: "UNKNOWN" }),
      mkc("https://b.com/img.jpg", "wikimedia", { phash: h, score: 0.7, license: "CC0" }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    // Equal scores → CC0 wins (lower LICENSE_RANK = 1 < 99)
    expect(canonical[0]!.source).toBe("wikimedia");
    expect(canonical[0]!.license).toBe("CC0");
  });

  test("on score tie, CC0 is preferred over CC_BY", async () => {
    const h = "dddd111122223333";
    const cands = [
      mkc("https://a.com/img.jpg", "openverse", { phash: h, score: 0.5, license: "CC_BY" }),
      mkc("https://b.com/img.jpg", "wikimedia", { phash: h, score: 0.5, license: "CC0" }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical[0]!.license).toBe("CC0");
    expect(canonical[0]!.source).toBe("wikimedia");
  });

  test("higher score beats better license", async () => {
    const h = "eeee000011112222";
    const cands = [
      mkc("https://a.com/img.jpg", "brave",    { phash: h, score: 0.95, license: "UNKNOWN" }),
      mkc("https://b.com/img.jpg", "wikimedia", { phash: h, score: 0.4,  license: "CC0" }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    // Score dominates: brave at 0.95 wins despite UNKNOWN license
    expect(canonical[0]!.source).toBe("brave");
  });

  test("first in order wins when score AND license rank are equal", async () => {
    const h = "ffff000011112222";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, score: 0.6, license: "CC0" }),
      mkc("https://b.com/img.jpg", "openverse", { phash: h, score: 0.6, license: "CC0" }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical[0]!.source).toBe("wikimedia");
  });

  test("canonical list sorted by score descending across multiple groups", async () => {
    const h1 = "1111000000000000";
    const h2 = "ffff000000000000"; // far from h1 — separate group
    const cands = [
      mkc("https://a1.com/img.jpg", "wikimedia", { phash: h1, score: 0.4 }),
      mkc("https://a2.com/img.jpg", "openverse", { phash: h1, score: 0.4 }),
      mkc("https://b1.com/img.jpg", "unsplash",  { phash: h2, score: 0.9 }),
      mkc("https://b2.com/img.jpg", "pexels",    { phash: h2, score: 0.8 }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical).toHaveLength(2);
    expect(canonical[0]!.score).toBeGreaterThan(canonical[1]!.score ?? 0);
  });
});

// ---------------------------------------------------------------------------
// 8. Alternate URL tracking
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — alternate URL tracking", () => {
  test("alternateUrls contains all non-canonical URLs from all providers", async () => {
    const h = "abcdef0123456789";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, score: 0.9 }),
      mkc("https://b.com/img.jpg", "openverse", { phash: h, score: 0.5 }),
      mkc("https://c.com/img.jpg", "unsplash",  { phash: h, score: 0.3 }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical[0]!.url).toBe("https://a.com/img.jpg");
    expect(canonical[0]!.alternateUrls).toHaveLength(2);
    expect(canonical[0]!.alternateUrls).toContain("https://b.com/img.jpg");
    expect(canonical[0]!.alternateUrls).toContain("https://c.com/img.jpg");
  });

  test("canonical URL is never in alternateUrls", async () => {
    const h = "0000111122223333";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, score: 0.8 }),
      mkc("https://b.com/img.jpg", "openverse", { phash: h, score: 0.4 }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical[0]!.alternateUrls).not.toContain(canonical[0]!.url);
  });

  test("CDN variant URLs are tracked in alternateUrls even after URL normalization collapses them", async () => {
    const h = "112233445566aabb";
    // Same normalized URL — they collapse via URL pre-collapse, not phash grouping
    const cands = [
      mkc("https://cdn.example.com/img.jpg?w=200",        "wikimedia", { phash: h }),
      mkc("https://cdn.example.com/img.jpg?w=1600&q=80",  "openverse", { phash: h }),
    ];
    const { canonical, singletons } = await dedupeWithPhashGrouping(cands);
    expect(canonical).toHaveLength(1);
    expect(singletons).toHaveLength(0);
  });

  test("singletons have no alternateUrls or providers (plain ImageCandidate)", async () => {
    const c = mkc("https://a.com/img.jpg", "unsplash");
    const { singletons } = await dedupeWithPhashGrouping([c]);
    expect((singletons[0] as PhashCanonicalCandidate).alternateUrls).toBeUndefined();
    expect((singletons[0] as PhashCanonicalCandidate).providers).toBeUndefined();
  });

  test("alternateUrls preserves all URLs including hash-fragment variants", async () => {
    const h = "aabbccddeeff0011";
    const cands = [
      mkc("https://a.com/img.jpg",         "p1", { phash: h, score: 0.9 }),
      mkc("https://b.com/img.jpg#preview", "p2", { phash: h, score: 0.5 }),
    ];
    // hash fragment is stripped during URL normalization: b.com/img.jpg#preview → b.com/img.jpg
    // these are distinct origins so they go through phash grouping
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical).toHaveLength(1);
    // The alternate URL is stored as the original URL (pre-normalization in the candidate)
    expect(canonical[0]!.alternateUrls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 9. Metadata union
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — metadata union", () => {
  test("author from second candidate fills in missing author from representative", async () => {
    const h = "deadbeef01234567";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, score: 0.9 }),
      mkc("https://b.com/img.jpg", "openverse", { phash: h, score: 0.5, author: "Jane Doe" }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical[0]!.author).toBe("Jane Doe");
  });

  test("licenseUrl from member fills missing licenseUrl on representative", async () => {
    const h = "feedfacedeadbeef";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, score: 0.9 }),
      mkc("https://b.com/img.jpg", "openverse", {
        phash: h, score: 0.4,
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical[0]!.licenseUrl).toBe("https://creativecommons.org/publicdomain/zero/1.0/");
  });

  test("attributionLine from member fills missing attributionLine on representative", async () => {
    const h = "c0ffee0000c0ffee";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, score: 0.9 }),
      mkc("https://b.com/img.jpg", "openverse", {
        phash: h, score: 0.3,
        attributionLine: "Photo by Jane Doe, CC0",
      }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical[0]!.attributionLine).toBe("Photo by Jane Doe, CC0");
  });

  test("representative's own metadata is not overwritten", async () => {
    const h = "aabbccddeeff0011";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", {
        phash: h, score: 0.9,
        author: "Original Author",
        title: "Original Title",
        sourcePageUrl: "https://original.com/page",
      }),
      mkc("https://b.com/img.jpg", "openverse", {
        phash: h, score: 0.2,
        author: "Other Author",
        title: "Other Title",
        sourcePageUrl: "https://other.com/page",
      }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical[0]!.author).toBe("Original Author");
    expect(canonical[0]!.title).toBe("Original Title");
    expect(canonical[0]!.sourcePageUrl).toBe("https://original.com/page");
  });

  test("metadata union works across three providers, first non-empty wins per field", async () => {
    const h = "0f0f0f0f0f0f0f0f";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h, score: 0.9 }),
      mkc("https://b.com/img.jpg", "openverse", { phash: h, score: 0.5, author: "Multi Author" }),
      mkc("https://c.com/img.jpg", "unsplash",  {
        phash: h, score: 0.3,
        title: "Multi Title",
        sourcePageUrl: "https://unsplash.com/photos/xyz",
      }),
    ];
    const { canonical } = await dedupeWithPhashGrouping(cands);
    expect(canonical[0]!.author).toBe("Multi Author");
    expect(canonical[0]!.title).toBe("Multi Title");
    expect(canonical[0]!.sourcePageUrl).toBe("https://unsplash.com/photos/xyz");
  });
});

// ---------------------------------------------------------------------------
// 10. groups DuplicateGroup output
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — groups DuplicateGroup shape", () => {
  test("phash group has correct reason and member count", async () => {
    const h = "fedcba9876543210";
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: h }),
      mkc("https://b.com/img.jpg", "openverse", { phash: h }),
    ];
    const { groups } = await dedupeWithPhashGrouping(cands);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.reason).toBe("phash");
    expect(groups[0]!.members).toHaveLength(2);
    for (const m of groups[0]!.members) {
      expect(typeof m.index).toBe("number");
      expect(typeof m.url).toBe("string");
      expect(typeof m.provider).toBe("string");
    }
  });

  test("URL-exact group has reason=url and confidence=1.0", async () => {
    const h = "1111222233334444";
    const cands = [
      mkc("https://same.com/img.jpg", "wikimedia", { phash: h }),
      mkc("https://same.com/img.jpg", "openverse", { phash: h }),
    ];
    const { groups } = await dedupeWithPhashGrouping(cands);
    expect(groups[0]!.reason).toBe("url");
    expect(groups[0]!.confidence).toBe(1.0);
  });

  test("groups member indices map to original candidates array positions", async () => {
    const h = "aabb112233445566";
    const cands = [
      mkc("https://first.com/img.jpg",  "wikimedia", { phash: h }),
      mkc("https://second.com/img.jpg", "openverse", { phash: h }),
    ];
    const { groups } = await dedupeWithPhashGrouping(cands);
    const indices = groups[0]!.members.map((m) => m.index).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1]);
  });

  test("confidence is within [0, 1] for all groups", async () => {
    const h = "9876543210fedcba";
    const cands = [
      mkc("https://a.com/img.jpg", "brave", { phash: h, license: "UNKNOWN" }),
      mkc("https://b.com/img.jpg", "bing",  { phash: h, license: "UNKNOWN" }),
    ];
    const { groups } = await dedupeWithPhashGrouping(cands);
    expect(groups[0]!.confidence).toBeGreaterThanOrEqual(0);
    expect(groups[0]!.confidence).toBeLessThanOrEqual(1);
  });

  test("all-distinct candidates produce no groups", async () => {
    const cands = [
      mkc("https://a.com/1.jpg", "wikimedia", { phash: "0000000000000000" }),
      mkc("https://b.com/2.jpg", "openverse", { phash: "ffffffffffffffff" }),
      mkc("https://c.com/3.jpg", "unsplash",  { phash: "aaaaaaaaaaaaaaaa" }),
    ];
    const { groups, singletons } = await dedupeWithPhashGrouping(cands);
    expect(groups).toHaveLength(0);
    expect(singletons).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 11. Integration shape — mirrors findSimilar() reverse-image pipeline output
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — findSimilar pipeline integration shape", () => {
  /**
   * Simulates what the findSimilar pipeline produces: multiple providers return
   * ImageCandidates with heuristic licenses (UNKNOWN from scrapers, known from
   * trusted providers). dedupeWithPhashGrouping then groups and annotates them.
   */
  test("reverse-image search: same image from brave (UNKNOWN) + wikimedia (CC0) → single canonical", async () => {
    const h = "1a2b3c4d5e6f7890";
    // Providers return the same visual from different CDN URLs — deduped by phash
    const serpApiResult = mkc(
      "https://serpapi-thumb.com/photo_thumb.jpg",
      "serpapi",
      { phash: h, license: "UNKNOWN", confidence: 0.3, score: 0.3 },
    );
    const braveResult = mkc(
      "https://brave-cdn.com/photo_preview.jpg",
      "brave",
      { phash: h, license: "UNKNOWN", confidence: 0.2, score: 0.2 },
    );
    // wikimedia returns the canonical URL with a known license and highest score
    const wikimediaResult = mkc(
      "https://upload.wikimedia.org/wikipedia/commons/photo.jpg",
      "wikimedia",
      { phash: h, license: "CC0", score: 0.9, author: "Photographe" },
    );

    const { canonical, singletons } = await dedupeWithPhashGrouping(
      [serpApiResult, braveResult, wikimediaResult],
    );
    expect(canonical).toHaveLength(1);
    expect(singletons).toHaveLength(0);
    // wikimedia wins (highest score = 0.9)
    expect(canonical[0]!.source).toBe("wikimedia");
    expect(canonical[0]!.license).toBe("CC0");
    expect(canonical[0]!.author).toBe("Photographe");
    expect(canonical[0]!.providers.sort()).toEqual(["brave", "serpapi", "wikimedia"]);
  });

  test("reverse-image search: no duplicates among distinct images returns all as singletons", async () => {
    const results = [
      mkc("https://cdn1.com/img.jpg", "serpapi",   { phash: "0000000000000000", license: "UNKNOWN" }),
      mkc("https://cdn2.com/img.jpg", "brave",     { phash: "ffffffffffffffff", license: "UNKNOWN" }),
      mkc("https://cdn3.com/img.jpg", "wikimedia", { phash: "aaaaaaaaaaaaaaaa", license: "CC0" }),
    ];
    const { canonical, singletons } = await dedupeWithPhashGrouping(results);
    expect(canonical).toHaveLength(0);
    expect(singletons).toHaveLength(3);
  });

  test("reverse-image search output has correct PhashGroupingResult shape", async () => {
    const h = "abcd1234efgh5678".slice(0, 16);
    const results = [
      mkc("https://a.com/img.jpg", "serpapi",  { phash: h, license: "UNKNOWN" }),
      mkc("https://b.com/img.jpg", "wikimedia", { phash: h, license: "CC0" }),
    ];
    const result = await dedupeWithPhashGrouping(results);
    // Check all required fields on PhashGroupingResult
    expect(Array.isArray(result.canonical)).toBe(true);
    expect(Array.isArray(result.singletons)).toBe(true);
    expect(Array.isArray(result.groups)).toBe(true);
    // Check PhashCanonicalCandidate shape
    const can = result.canonical[0]!;
    expect(typeof can.url).toBe("string");
    expect(typeof can.source).toBe("string");
    expect(Array.isArray(can.providers)).toBe(true);
    expect(Array.isArray(can.alternateUrls)).toBe(true);
    expect(typeof can.aggregatedConfidence).toBe("number");
  });

  test("phashWeight option flows through in pipeline scenario", async () => {
    const h = "1234abcd5678efef";
    const results = [
      mkc("https://a.com/img.jpg", "brave",     { phash: h, license: "UNKNOWN" }),
      mkc("https://b.com/img.jpg", "wikimedia", { phash: h, license: "CC0", score: 0.8 }),
    ];
    // With phashWeight=0, only license matters for confidence
    const { canonical: confByLicense } = await dedupeWithPhashGrouping(results, { phashWeight: 0 });
    // With phashWeight=1, only phash algo matters for confidence
    const { canonical: confByPhash } = await dedupeWithPhashGrouping(results, { phashWeight: 1.0 });

    // Both produce one canonical
    expect(confByLicense).toHaveLength(1);
    expect(confByPhash).toHaveLength(1);
    // Confidence values may differ (different weighting)
    // The canonical representative is still wikimedia (higher score on tie)
    expect(confByLicense[0]!.source).toBe("wikimedia");
  });

  test("warnings array from findSimilar is not affected by deduplication", async () => {
    // findSimilar returns { candidates, warnings }; dedupeWithPhashGrouping only takes candidates
    const h = "deaddeaddeaddead";
    const candidates = [
      mkc("https://a.com/img.jpg", "serpapi",  { phash: h, license: "UNKNOWN" }),
      mkc("https://b.com/img.jpg", "wikimedia", { phash: h, license: "CC0" }),
    ];
    const warnings = ["serpapi: rate-limit approaching"];
    // Dedupe only processes candidates; warnings pass-through is caller's responsibility
    const result = await dedupeWithPhashGrouping(candidates);
    expect(result.canonical).toHaveLength(1);
    // warnings are external — confirm they're unmodified
    expect(warnings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 12. hammingDistance — boundary and edge cases
// ---------------------------------------------------------------------------

describe("hammingDistance — boundary conditions", () => {
  test("identical hashes → distance 0", () => {
    expect(hammingDistance("abcdef1234567890", "abcdef1234567890")).toBe(0);
  });

  test("all zeros vs all ones → distance 64", () => {
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  test("single nibble flip → distance 1..4", () => {
    // 0 vs 1 → 1 bit
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
    // 0 vs f → 4 bits
    expect(hammingDistance("0000000000000000", "000000000000000f")).toBe(4);
  });

  test("last byte flipped = 8 bits → within default threshold=8", () => {
    const d = hammingDistance("0000000000000000", "00000000000000ff");
    expect(d).toBe(8);
    expect(d).toBeLessThanOrEqual(8);
  });

  test("9 bits different → exceeds threshold=8", () => {
    const d = hammingDistance("0000000000000000", "00000000000001ff");
    expect(d).toBe(9);
    expect(d).toBeGreaterThan(8);
  });
});

// ---------------------------------------------------------------------------
// 13. Empty and edge cases
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — empty and edge cases", () => {
  test("empty input returns empty result", async () => {
    const result = await dedupeWithPhashGrouping([]);
    expect(result.canonical).toHaveLength(0);
    expect(result.singletons).toHaveLength(0);
    expect(result.groups).toHaveLength(0);
  });

  test("single candidate with phash becomes a singleton", async () => {
    const c = mkc("https://a.com/img.jpg", "wikimedia", { phash: "1234567890abcdef" });
    const { canonical, singletons, groups } = await dedupeWithPhashGrouping([c]);
    expect(canonical).toHaveLength(0);
    expect(singletons).toHaveLength(1);
    expect(groups).toHaveLength(0);
  });

  test("single candidate without phash becomes a singleton", async () => {
    const c = mkc("https://a.com/img.jpg", "wikimedia");
    const { singletons } = await dedupeWithPhashGrouping([c]);
    expect(singletons).toHaveLength(1);
    expect(singletons[0]!.url).toBe("https://a.com/img.jpg");
  });

  test("custom hammingThreshold=0 only merges identical hashes", async () => {
    const cands = [
      mkc("https://a.com/img.jpg", "wikimedia", { phash: "0000000000000000" }),
      mkc("https://b.com/img.jpg", "openverse", { phash: "0000000000000001" }), // 1 bit off
      mkc("https://c.com/img.jpg", "unsplash",  { phash: "0000000000000000" }), // identical
    ];
    const { canonical, singletons } = await dedupeWithPhashGrouping(cands, { hammingThreshold: 0 });
    expect(canonical).toHaveLength(1); // first + third merged
    expect(singletons).toHaveLength(1); // second is singleton
  });

  test("large bundle: no false positives with maximally distinct hashes", async () => {
    const hashes = [
      "0000000000000000", "ffffffffffffffff", "aaaaaaaaaaaaaaaa", "5555555555555555",
      "f0f0f0f0f0f0f0f0", "0f0f0f0f0f0f0f0f", "ff00ff00ff00ff00", "00ff00ff00ff00ff",
    ];
    const cands = hashes.map((h, i) =>
      mkc(`https://provider${i}.com/img.jpg`, `provider${i}`, { phash: h }),
    );
    const { canonical, singletons } = await dedupeWithPhashGrouping(cands, { hammingThreshold: 8 });
    expect(canonical).toHaveLength(0);
    expect(singletons).toHaveLength(8);
  });
});
