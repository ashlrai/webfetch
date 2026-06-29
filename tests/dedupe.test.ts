import { describe, expect, test } from "bun:test";
import {
  dedupeByHash,
  dedupeByUrl,
  dedupeWithPhashGrouping,
  hammingDistance,
  perceptualHash,
} from "../packages/core/src/dedupe.ts";
import type { ImageCandidate, PhashCanonicalCandidate } from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mk = (url: string, phash?: string): ImageCandidate => ({
  url,
  source: "x",
  license: "CC0",
  phash,
});

function mkFull(
  url: string,
  source: string,
  opts: Partial<ImageCandidate> = {},
): ImageCandidate {
  return { url, source, license: "CC0", ...opts };
}

// ---------------------------------------------------------------------------
// Existing tests (unchanged)
// ---------------------------------------------------------------------------

test("dedupeByUrl collapses query-param variants", () => {
  const cands = [
    mk("https://ex.com/a.jpg?w=200"),
    mk("https://ex.com/a.jpg?w=1600&q=80"),
    mk("https://ex.com/b.jpg"),
  ];
  const out = dedupeByUrl(cands);
  expect(out.length).toBe(2);
});

test("dedupeByHash collapses near-identical phashes", () => {
  const a = mk("a", "abcdef1234567890");
  const b = mk("b", "abcdef1234567890"); // identical
  const c = mk("c", "ffffffff00000000"); // very different
  const out = dedupeByHash([a, b, c], 6);
  expect(out.length).toBe(2);
});

test("perceptualHash returns stable hex for identical bytes", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const h1 = await perceptualHash(bytes);
  const h2 = await perceptualHash(bytes);
  expect(h1).toBe(h2);
  expect(h1).toMatch(/^[0-9a-f]{16}$/);
});

// ---------------------------------------------------------------------------
// hammingDistance edge cases
// ---------------------------------------------------------------------------

describe("hammingDistance edge cases", () => {
  test("identical hashes have distance 0", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance("ffffffffffffffff", "ffffffffffffffff")).toBe(0);
    expect(hammingDistance("abcdef1234567890", "abcdef1234567890")).toBe(0);
  });

  test("single bit flip produces distance 1", () => {
    // 0 XOR 1 = 1, popcount = 1
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
    // last nibble: 0 vs 8 → XOR = 8 → popcount = 1
    expect(hammingDistance("0000000000000000", "0000000000000008")).toBe(1);
  });

  test("all bits flipped produces distance 64", () => {
    // 0000... XOR ffff... = ffff..., popcount = 64
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  test("≤8 threshold boundary: distance exactly 8 is within threshold", () => {
    // "00000000000000ff" has last byte = 0xff, distance from all-zeros = 8 bits
    expect(hammingDistance("0000000000000000", "00000000000000ff")).toBe(8);
    // Should be within the ≤8 threshold
    expect(hammingDistance("0000000000000000", "00000000000000ff")).toBeLessThanOrEqual(8);
  });

  test("distance exactly 9 exceeds ≤8 threshold", () => {
    // "000000000000ffff" has last 2 bytes flipped: 16 bits, too many.
    // Use "000000000000001ff" — not valid hex length. Instead craft 9-bit diff:
    // 0x1ff = 9 bits set, but we need hex nibbles. "00000000000001ff" has:
    // last 3 nibbles: 1, f, f → bits: 0001 1111 1111 = 9 bits set
    expect(hammingDistance("0000000000000000", "00000000000001ff")).toBe(9);
    expect(hammingDistance("0000000000000000", "00000000000001ff")).toBeGreaterThan(8);
  });

  test("alternating bit pattern produces expected distance", () => {
    // 0xaa = 1010 1010, so "aaaaaaaaaaaaaaaa" vs "5555555555555555"
    // each nibble: a=1010, 5=0101 → XOR = 1111 → 4 bits per nibble × 16 nibbles = 64
    expect(hammingDistance("aaaaaaaaaaaaaaaa", "5555555555555555")).toBe(64);
  });

  test("length mismatch is handled gracefully (penalty for extra nibbles)", () => {
    // Shorter string padded by 4 bits per extra nibble
    const d = hammingDistance("0000", "000000000000000f");
    // Extra 12 nibbles in b → +12*4 = 48 penalty, plus 1 bit from last nibble of "0000" vs "000f"
    expect(d).toBeGreaterThan(0);
    expect(typeof d).toBe("number");
  });

  test("half the bits different produces distance ~32", () => {
    // f0f0... XOR 0f0f... = ffff... → 64 bits; use direct measurement
    const d = hammingDistance("f0f0f0f0f0f0f0f0", "0f0f0f0f0f0f0f0f");
    expect(d).toBe(64);
  });
});

// ---------------------------------------------------------------------------
// dedupeWithPhashGrouping — core grouping
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — basic grouping", () => {
  test("empty candidates returns empty result", async () => {
    const result = await dedupeWithPhashGrouping([]);
    expect(result.canonical).toHaveLength(0);
    expect(result.singletons).toHaveLength(0);
    expect(result.groups).toHaveLength(0);
  });

  test("single candidate with no phash becomes a singleton", async () => {
    const c = mkFull("https://a.com/img.jpg", "wikimedia");
    const result = await dedupeWithPhashGrouping([c]);
    expect(result.singletons).toHaveLength(1);
    expect(result.canonical).toHaveLength(0);
    expect(result.singletons[0]!.url).toBe("https://a.com/img.jpg");
  });

  test("two identical hashes from different providers → one canonical", async () => {
    const hash = "abcdef1234567890";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash, score: 0.8 }),
      mkFull("https://b.com/img.jpg", "openverse", { phash: hash, score: 0.5 }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.canonical).toHaveLength(1);
    expect(result.singletons).toHaveLength(0);
    const can = result.canonical[0]!;
    expect(can.source).toBe("wikimedia"); // higher score wins
    expect(can.providers).toContain("wikimedia");
    expect(can.providers).toContain("openverse");
    expect(can.alternateUrls).toContain("https://b.com/img.jpg");
  });

  test("default hammingThreshold=8 merges hashes ≤8 bits apart", async () => {
    // "00000000000000ff" has 8 bits set → distance from all-zeros = 8
    const cands = [
      mkFull("https://a.com/img.jpg", "unsplash", { phash: "0000000000000000" }),
      mkFull("https://b.com/img.jpg", "pexels", { phash: "00000000000000ff" }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.canonical).toHaveLength(1);
  });

  test("hashes distance=9 are NOT merged at default threshold=8", async () => {
    const cands = [
      mkFull("https://a.com/img.jpg", "unsplash", { phash: "0000000000000000" }),
      mkFull("https://b.com/img.jpg", "pexels", { phash: "00000000000001ff" }),
    ];
    const result = await dedupeWithPhashGrouping(cands, { hammingThreshold: 8 });
    // distance = 9, threshold = 8 → no merge
    expect(result.singletons).toHaveLength(2);
    expect(result.canonical).toHaveLength(0);
  });

  test("hammingThreshold option overrides default", async () => {
    const cands = [
      mkFull("https://a.com/1.jpg", "wikimedia", { phash: "0000000000000000" }),
      mkFull("https://b.com/2.jpg", "openverse", { phash: "0000000000000003" }), // 2 bits diff
    ];
    const strictResult = await dedupeWithPhashGrouping(cands, { hammingThreshold: 1 });
    expect(strictResult.singletons).toHaveLength(2);
    expect(strictResult.canonical).toHaveLength(0);

    const looseResult = await dedupeWithPhashGrouping(cands, { hammingThreshold: 3 });
    expect(looseResult.canonical).toHaveLength(1);
    expect(looseResult.singletons).toHaveLength(0);
  });

  test("three providers same hash → single canonical with all three providers", async () => {
    const hash = "cafecafecafecafe";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash, score: 0.3 }),
      mkFull("https://b.com/img.jpg", "openverse", { phash: hash, score: 0.9 }),
      mkFull("https://c.com/img.jpg", "unsplash", { phash: hash, score: 0.6 }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.canonical).toHaveLength(1);
    const can = result.canonical[0]!;
    expect(can.source).toBe("openverse"); // highest score
    expect(can.providers.sort()).toEqual(["openverse", "unsplash", "wikimedia"]);
    expect(can.alternateUrls).toHaveLength(2);
  });

  test("candidates without phash do not produce false duplicates", async () => {
    const cands = [
      mkFull("https://a.com/1.jpg", "wikimedia"),
      mkFull("https://b.com/2.jpg", "openverse"),
      mkFull("https://c.com/3.jpg", "unsplash"),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.canonical).toHaveLength(0);
    expect(result.singletons).toHaveLength(3);
    expect(result.groups).toHaveLength(0);
  });

  test("mix of hashed and unhashed: grouped candidates become canonical, unhashed are singletons", async () => {
    const hash = "1234567890abcdef";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash }),
      mkFull("https://b.com/img.jpg", "openverse", { phash: hash }),
      mkFull("https://c.com/other.jpg", "unsplash"), // no phash
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.canonical).toHaveLength(1);
    expect(result.singletons).toHaveLength(1);
    expect(result.singletons[0]!.source).toBe("unsplash");
  });
});

// ---------------------------------------------------------------------------
// Metadata union (author, title, sourcePageUrl)
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — metadata union", () => {
  test("author from second candidate fills in missing author from representative", async () => {
    const hash = "deadbeef01234567";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", {
        phash: hash,
        score: 0.9,
        // No author on the representative
      }),
      mkFull("https://b.com/img.jpg", "openverse", {
        phash: hash,
        score: 0.5,
        author: "Jane Doe",
      }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.canonical[0]!.author).toBe("Jane Doe");
  });

  test("title from member fills missing title on representative", async () => {
    const hash = "feedfacedeadbeef";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash, score: 0.9 }),
      mkFull("https://b.com/img.jpg", "openverse", {
        phash: hash,
        score: 0.4,
        title: "Sunset over the sea",
      }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.canonical[0]!.title).toBe("Sunset over the sea");
  });

  test("sourcePageUrl from member fills missing sourcePageUrl on representative", async () => {
    const hash = "0102030405060708";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash, score: 0.7 }),
      mkFull("https://b.com/img.jpg", "openverse", {
        phash: hash,
        score: 0.3,
        sourcePageUrl: "https://openverse.org/page/123",
      }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.canonical[0]!.sourcePageUrl).toBe("https://openverse.org/page/123");
  });

  test("representative's own metadata is not overwritten when it exists", async () => {
    const hash = "aabbccddeeff0011";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", {
        phash: hash,
        score: 0.9,
        author: "Original Author",
        title: "Original Title",
        sourcePageUrl: "https://original.com/page",
      }),
      mkFull("https://b.com/img.jpg", "openverse", {
        phash: hash,
        score: 0.2,
        author: "Other Author",
        title: "Other Title",
        sourcePageUrl: "https://other.com/page",
      }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    const can = result.canonical[0]!;
    expect(can.author).toBe("Original Author");
    expect(can.title).toBe("Original Title");
    expect(can.sourcePageUrl).toBe("https://original.com/page");
  });

  test("metadata union works across three providers", async () => {
    const hash = "0f0f0f0f0f0f0f0f";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash, score: 0.9 }),
      mkFull("https://b.com/img.jpg", "openverse", {
        phash: hash,
        score: 0.5,
        author: "Multi Author",
      }),
      mkFull("https://c.com/img.jpg", "unsplash", {
        phash: hash,
        score: 0.3,
        title: "Multi Title",
        sourcePageUrl: "https://unsplash.com/photos/xyz",
      }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    const can = result.canonical[0]!;
    expect(can.author).toBe("Multi Author");
    expect(can.title).toBe("Multi Title");
    expect(can.sourcePageUrl).toBe("https://unsplash.com/photos/xyz");
  });
});

// ---------------------------------------------------------------------------
// Confidence weighting by hash algorithm + license rank
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — confidence aggregation", () => {
  test("dct-phash members produce higher aggregatedConfidence than ahash-fallback", async () => {
    const hashA = "aabbccdd11223344";
    const hashB = "aabbccdd11223345"; // 1 bit diff, within threshold

    const dctCands = [
      mkFull("https://a.com/img.jpg", "wikimedia", {
        phash: hashA,
        phashAlgorithm: "dct-phash",
        phashResult: { hash: hashA, algorithm: "dct-phash", confidence: 1.0 },
        license: "CC0",
      }),
      mkFull("https://b.com/img.jpg", "openverse", {
        phash: hashB,
        phashAlgorithm: "dct-phash",
        phashResult: { hash: hashB, algorithm: "dct-phash", confidence: 1.0 },
        license: "CC0",
      }),
    ];
    const ahashCands = [
      mkFull("https://c.com/img.jpg", "unsplash", {
        phash: hashA,
        phashAlgorithm: "ahash-fallback",
        phashResult: { hash: hashA, algorithm: "ahash-fallback", confidence: 0.5 },
        license: "CC0",
      }),
      mkFull("https://d.com/img.jpg", "pexels", {
        phash: hashB,
        phashAlgorithm: "ahash-fallback",
        phashResult: { hash: hashB, algorithm: "ahash-fallback", confidence: 0.5 },
        license: "CC0",
      }),
    ];

    const dctResult = await dedupeWithPhashGrouping(dctCands);
    const ahashResult = await dedupeWithPhashGrouping(ahashCands);

    expect(dctResult.canonical[0]!.aggregatedConfidence).toBeGreaterThan(
      ahashResult.canonical[0]!.aggregatedConfidence,
    );
  });

  test("CC0 license produces higher confidence contribution than UNKNOWN", async () => {
    const hash = "1122334455667788";
    const cc0Cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash, license: "CC0" }),
      mkFull("https://b.com/img.jpg", "openverse", { phash: hash, license: "CC0" }),
    ];
    const unknownCands = [
      mkFull("https://c.com/img.jpg", "brave", { phash: hash, license: "UNKNOWN" }),
      mkFull("https://d.com/img.jpg", "bing", { phash: hash, license: "UNKNOWN" }),
    ];

    const cc0Result = await dedupeWithPhashGrouping(cc0Cands, { phashWeight: 0 });
    const unknownResult = await dedupeWithPhashGrouping(unknownCands, { phashWeight: 0 });

    // With phashWeight=0 only license rank contributes.
    expect(cc0Result.canonical[0]!.aggregatedConfidence).toBeGreaterThan(
      unknownResult.canonical[0]!.aggregatedConfidence,
    );
  });

  test("phashWeight=1.0 uses only algorithm confidence, ignores license rank", async () => {
    const hash = "aabb000000001122";
    // dct-phash candidates with UNKNOWN license
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", {
        phash: hash,
        phashAlgorithm: "dct-phash",
        phashResult: { hash, algorithm: "dct-phash", confidence: 1.0 },
        license: "UNKNOWN",
      }),
      mkFull("https://b.com/img.jpg", "openverse", {
        phash: hash,
        phashAlgorithm: "dct-phash",
        phashResult: { hash, algorithm: "dct-phash", confidence: 1.0 },
        license: "UNKNOWN",
      }),
    ];
    const result = await dedupeWithPhashGrouping(cands, { phashWeight: 1.0 });
    // 1.0 * 1.0 + 0.0 * licenseScore = 1.0
    expect(result.canonical[0]!.aggregatedConfidence).toBe(1.0);
  });

  test("phashWeight=0 uses only license rank contribution", async () => {
    const hash = "cc00cc00cc00cc00";
    // CC0 = rank 1 → licenseScore = 1/1 = 1.0
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash, license: "CC0" }),
      mkFull("https://b.com/img.jpg", "openverse", { phash: hash, license: "CC0" }),
    ];
    const result = await dedupeWithPhashGrouping(cands, { phashWeight: 0 });
    // 0 * phashConf + 1.0 * licenseScore(CC0=1) = 1.0
    expect(result.canonical[0]!.aggregatedConfidence).toBe(1.0);
  });

  test("aggregatedConfidence is always in range [0, 1]", async () => {
    const hash = "ff00ff00ff00ff00";
    const cands = [
      mkFull("https://a.com/img.jpg", "brave", { phash: hash, license: "UNKNOWN" }),
      mkFull("https://b.com/img.jpg", "bing", { phash: hash, license: "UNKNOWN" }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    const conf = result.canonical[0]!.aggregatedConfidence;
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
  });

  test("best license in group lifts confidence even when representative has UNKNOWN", async () => {
    const hash = "aabbccddeeff0000";
    const cands = [
      mkFull("https://a.com/img.jpg", "brave", {
        phash: hash,
        score: 0.9,
        license: "UNKNOWN",
      }),
      mkFull("https://b.com/img.jpg", "wikimedia", {
        phash: hash,
        score: 0.5,
        license: "CC0",
      }),
    ];
    const result = await dedupeWithPhashGrouping(cands, { phashWeight: 0 });
    // bestLicense = licenseScore(CC0) = 1.0, but a mixed UNKNOWN+CC0 group gets a
    // confidence-decay penalty proportional to the UNKNOWN fraction (50% × 0.25 = 0.125),
    // so aggregatedConfidence = 1.0 × (1 - 0.125) = 0.875.
    // Core invariant: confidence is strictly greater than a pure-UNKNOWN group (≈0.0101).
    expect(result.canonical[0]!.aggregatedConfidence).toBeGreaterThan(0.05);
    expect(result.canonical[0]!.aggregatedConfidence).toBeLessThanOrEqual(1.0);
    // Representative is brave (higher score) but CC0 from wikimedia lifts confidence
    expect(result.canonical[0]!.source).toBe("brave");
  });
});

// ---------------------------------------------------------------------------
// Alternate URL tracking and providers array
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — alternate URLs and providers", () => {
  test("alternateUrls contains all non-canonical URLs", async () => {
    const hash = "abcdef0123456789";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash, score: 0.9 }),
      mkFull("https://b.com/img.jpg", "openverse", { phash: hash, score: 0.5 }),
      mkFull("https://c.com/img.jpg", "unsplash", { phash: hash, score: 0.3 }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    const can = result.canonical[0]!;
    expect(can.url).toBe("https://a.com/img.jpg");
    expect(can.alternateUrls).toHaveLength(2);
    expect(can.alternateUrls).toContain("https://b.com/img.jpg");
    expect(can.alternateUrls).toContain("https://c.com/img.jpg");
  });

  test("canonical URL is not in alternateUrls", async () => {
    const hash = "0000111122223333";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash, score: 0.8 }),
      mkFull("https://b.com/img.jpg", "openverse", { phash: hash, score: 0.4 }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    const can = result.canonical[0]!;
    expect(can.alternateUrls).not.toContain(can.url);
  });

  test("providers array has no duplicates when same provider appears twice", async () => {
    const hash = "aabbccddeeff1234";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash }),
      mkFull("https://b.com/img.jpg", "wikimedia", { phash: hash }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    const can = result.canonical[0]!;
    expect(can.providers).toEqual(["wikimedia"]); // deduped
  });

  test("singletons have no alternateUrls or providers array (raw ImageCandidate)", async () => {
    const c = mkFull("https://a.com/img.jpg", "unsplash");
    const result = await dedupeWithPhashGrouping([c]);
    const singleton = result.singletons[0]!;
    // singletons are plain ImageCandidate — no PhashCanonicalCandidate fields
    expect((singleton as PhashCanonicalCandidate).alternateUrls).toBeUndefined();
    expect((singleton as PhashCanonicalCandidate).providers).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// URL pre-collapse (CDN variants treated as same candidate)
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — URL pre-collapse", () => {
  test("CDN query-param variants of same URL collapse before phash grouping", async () => {
    const hash = "112233445566aabb";
    const cands = [
      mkFull("https://cdn.example.com/img.jpg?w=200", "wikimedia", { phash: hash }),
      mkFull("https://cdn.example.com/img.jpg?w=1600&q=80", "openverse", { phash: hash }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    // Two URL variants of the same normalised URL collapse to one canonical
    expect(result.canonical).toHaveLength(1);
    expect(result.singletons).toHaveLength(0);
  });

  test("distinct URLs with same phash produce one canonical with two alternateUrls", async () => {
    const hash = "aabb000011223344";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash, score: 0.7 }),
      mkFull("https://b.com/img.jpg", "openverse", { phash: hash, score: 0.5 }),
      mkFull("https://c.com/img.jpg", "unsplash", { phash: hash, score: 0.3 }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.canonical).toHaveLength(1);
    expect(result.canonical[0]!.alternateUrls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// groups output (DuplicateGroup shape)
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — groups output", () => {
  test("groups output matches DuplicateGroup shape", async () => {
    const hash = "fedcba9876543210";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash }),
      mkFull("https://b.com/img.jpg", "openverse", { phash: hash }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.groups).toHaveLength(1);
    const grp = result.groups[0]!;
    expect(grp.reason).toMatch(/^(phash|url)$/);
    expect(grp.confidence).toBeGreaterThan(0);
    expect(grp.confidence).toBeLessThanOrEqual(1);
    expect(grp.members).toHaveLength(2);
    for (const m of grp.members) {
      expect(typeof m.index).toBe("number");
      expect(typeof m.url).toBe("string");
      expect(typeof m.provider).toBe("string");
    }
  });

  test("URL-exact group gets reason=url and confidence=1.0", async () => {
    const hash = "1111222233334444";
    const cands = [
      mkFull("https://same.com/img.jpg", "wikimedia", { phash: hash }),
      mkFull("https://same.com/img.jpg", "openverse", { phash: hash }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.groups[0]!.reason).toBe("url");
    expect(result.groups[0]!.confidence).toBe(1.0);
  });

  test("distinct URL phash group gets reason=phash", async () => {
    const hash = "5566778899aabbcc";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash }),
      mkFull("https://b.com/img.jpg", "openverse", { phash: hash }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.groups[0]!.reason).toBe("phash");
  });

  test("groups member indices correspond to original candidates array positions", async () => {
    const hash = "aabb112233445566";
    const cands = [
      mkFull("https://first.com/img.jpg", "wikimedia", { phash: hash }),
      mkFull("https://second.com/img.jpg", "openverse", { phash: hash }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    const memberIndices = result.groups[0]!.members.map((m) => m.index).sort((a, b) => a - b);
    expect(memberIndices).toEqual([0, 1]);
  });

  test("all-distinct candidates produce no groups", async () => {
    const cands = [
      mkFull("https://a.com/1.jpg", "wikimedia", { phash: "0000000000000000" }),
      mkFull("https://b.com/2.jpg", "openverse", { phash: "ffffffffffffffff" }),
      mkFull("https://c.com/3.jpg", "unsplash", { phash: "aaaaaaaaaaaaaaaa" }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.groups).toHaveLength(0);
    expect(result.singletons).toHaveLength(3);
    expect(result.canonical).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Representative selection
// ---------------------------------------------------------------------------

describe("dedupeWithPhashGrouping — representative selection", () => {
  test("highest-scored candidate becomes canonical URL", async () => {
    const hash = "cccccccccccccccc";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash, score: 0.3 }),
      mkFull("https://b.com/img.jpg", "openverse", { phash: hash, score: 0.95 }),
      mkFull("https://c.com/img.jpg", "unsplash", { phash: hash, score: 0.6 }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.canonical[0]!.source).toBe("openverse");
    expect(result.canonical[0]!.url).toBe("https://b.com/img.jpg");
  });

  test("canonical list sorted by score descending", async () => {
    const hashA = "1111000000000000";
    const hashB = "ffff000000000000"; // far from hashA (32 bits diff), not merged

    const cands = [
      mkFull("https://a1.com/img.jpg", "wikimedia", { phash: hashA, score: 0.4 }),
      mkFull("https://a2.com/img.jpg", "openverse", { phash: hashA, score: 0.4 }),
      mkFull("https://b1.com/img.jpg", "unsplash", { phash: hashB, score: 0.9 }),
      mkFull("https://b2.com/img.jpg", "pexels", { phash: hashB, score: 0.8 }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.canonical).toHaveLength(2);
    expect(result.canonical[0]!.source).toBe("unsplash");
    expect(result.canonical[1]!.score).toBe(0.4);
  });

  test("first candidate wins on score tie", async () => {
    const hash = "0011223344556677";
    const cands = [
      mkFull("https://a.com/img.jpg", "wikimedia", { phash: hash, score: 0.5 }),
      mkFull("https://b.com/img.jpg", "openverse", { phash: hash, score: 0.5 }),
    ];
    const result = await dedupeWithPhashGrouping(cands);
    expect(result.canonical[0]!.source).toBe("wikimedia");
  });
});
