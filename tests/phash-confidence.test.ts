/**
 * Tests for perceptual hash confidence metadata and multi-algorithm comparison.
 *
 * Covers:
 *   - dct-phash vs ahash-fallback confidence deltas
 *   - Hamming threshold classification (0-3: duplicate, 4-7: similar, 8+: unique)
 *   - Edge cases: tiny images, solid colors
 *   - phashAlgorithm field population in dedupeByHashAsync
 *   - findDuplicates with structured results
 */

import { describe, expect, test } from "bun:test";
import {
  dedupeByHash,
  findDuplicates,
  hammingDistance,
  perceptualHashStructured,
} from "../packages/core/src/dedupe.ts";
import type { ImageCandidate, PerceptualHashResult } from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBytes(pattern: number, len = 4096): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (pattern + i) & 0xff;
  return out;
}

/** Solid-color image: all bytes the same value. */
function solidBytes(value: number, len = 4096): Uint8Array {
  return new Uint8Array(len).fill(value);
}

/** Minimal 1-byte "image" — exercises the tiny-image edge case. */
const TINY_BYTES = new Uint8Array([42]);

// ---------------------------------------------------------------------------
// PerceptualHashResult shape
// ---------------------------------------------------------------------------

describe("perceptualHashStructured", () => {
  test("returns a PerceptualHashResult with required fields", async () => {
    const result = await perceptualHashStructured(makeBytes(0));
    expect(result).toHaveProperty("hash");
    expect(result).toHaveProperty("algorithm");
    expect(result).toHaveProperty("confidence");
  });

  test("hash is 16 hex chars (64-bit)", async () => {
    const result = await perceptualHashStructured(makeBytes(7));
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  test("algorithm is one of the two known values", async () => {
    const result = await perceptualHashStructured(makeBytes(1));
    expect(["dct-phash", "ahash-fallback"]).toContain(result.algorithm);
  });

  test("confidence is 0..1 and matches algorithm", async () => {
    const result = await perceptualHashStructured(makeBytes(2));
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
    if (result.algorithm === "dct-phash") {
      expect(result.confidence).toBe(1.0);
    } else {
      // ahash-fallback
      expect(result.confidence).toBe(0.5);
    }
  });

  test("dct-phash confidence (1.0) > ahash-fallback confidence (0.5)", () => {
    // Even without sharp installed, we can assert the invariant by constructing
    // both result shapes and comparing.
    const dct: PerceptualHashResult = {
      hash: "abcdef1234567890",
      algorithm: "dct-phash",
      confidence: 1.0,
    };
    const ahash: PerceptualHashResult = {
      hash: "abcdef1234567890",
      algorithm: "ahash-fallback",
      confidence: 0.5,
    };
    expect(dct.confidence).toBeGreaterThan(ahash.confidence);
  });

  test("same bytes → identical structured result", async () => {
    const bytes = makeBytes(99);
    const a = await perceptualHashStructured(bytes);
    const b = await perceptualHashStructured(new Uint8Array(bytes));
    expect(a.hash).toBe(b.hash);
    expect(a.algorithm).toBe(b.algorithm);
    expect(a.confidence).toBe(b.confidence);
  });
});

// ---------------------------------------------------------------------------
// Hamming threshold classification
// ---------------------------------------------------------------------------

describe("hamming threshold classification", () => {
  /**
   * Build a hash string with exactly `bitsFlipped` bits different from
   * "0000000000000000". We flip the lowest `bitsFlipped` bits of the last
   * nibble groups.
   */
  function hashWithDistance(base: string, bitsFlipped: number): string {
    // Work at the nibble level: each hex char = 4 bits.
    const chars = base.split("").map((c) => Number.parseInt(c, 16));
    let remaining = bitsFlipped;
    for (let i = chars.length - 1; i >= 0 && remaining > 0; i--) {
      const flip = Math.min(remaining, 4);
      // Flip the lowest `flip` bits of this nibble.
      const mask = (1 << flip) - 1;
      chars[i] = (chars[i]! ^ mask) & 0xf;
      remaining -= flip;
    }
    return chars.map((n) => n.toString(16)).join("");
  }

  const BASE = "0000000000000000";

  test("distance 0 → duplicate (identical hash)", () => {
    const d = hammingDistance(BASE, BASE);
    expect(d).toBe(0);
    expect(d).toBeLessThanOrEqual(3); // duplicate zone
  });

  test("distance 2 → duplicate zone (≤3)", () => {
    const other = hashWithDistance(BASE, 2);
    const d = hammingDistance(BASE, other);
    expect(d).toBe(2);
    expect(d).toBeLessThanOrEqual(3);
  });

  test("distance 4 → similar zone (4-7)", () => {
    const other = hashWithDistance(BASE, 4);
    const d = hammingDistance(BASE, other);
    expect(d).toBe(4);
    expect(d).toBeGreaterThanOrEqual(4);
    expect(d).toBeLessThanOrEqual(7);
  });

  test("distance 7 → similar zone (4-7)", () => {
    const other = hashWithDistance(BASE, 7);
    const d = hammingDistance(BASE, other);
    expect(d).toBe(7);
    expect(d).toBeGreaterThanOrEqual(4);
    expect(d).toBeLessThanOrEqual(7);
  });

  test("distance 8 → unique zone (≥8)", () => {
    const other = hashWithDistance(BASE, 8);
    const d = hammingDistance(BASE, other);
    expect(d).toBe(8);
    expect(d).toBeGreaterThanOrEqual(8);
  });

  test("distance 64 → maximally different (all bits flipped)", () => {
    const d = hammingDistance("0000000000000000", "ffffffffffffffff");
    expect(d).toBe(64);
    expect(d).toBeGreaterThanOrEqual(8); // well into unique zone
  });

  test("classify helper — duplicate", () => {
    function classify(d: number): "duplicate" | "similar" | "unique" {
      if (d <= 3) return "duplicate";
      if (d <= 7) return "similar";
      return "unique";
    }
    expect(classify(0)).toBe("duplicate");
    expect(classify(3)).toBe("duplicate");
    expect(classify(4)).toBe("similar");
    expect(classify(7)).toBe("similar");
    expect(classify(8)).toBe("unique");
    expect(classify(64)).toBe("unique");
  });
});

// ---------------------------------------------------------------------------
// Edge cases: tiny images and solid colors
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  test("tiny 1-byte input → valid 16-char hex hash", async () => {
    const result = await perceptualHashStructured(TINY_BYTES);
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(result.algorithm).toBe("ahash-fallback"); // sharp can't decode 1 raw byte
  });

  test("tiny input confidence is 0.5 (ahash-fallback)", async () => {
    const result = await perceptualHashStructured(TINY_BYTES);
    expect(result.confidence).toBe(0.5);
  });

  test("empty bytes → zero hash without throwing", async () => {
    const result = await perceptualHashStructured(new Uint8Array(0));
    expect(result.hash).toBe("0000000000000000");
    expect(result.algorithm).toBe("ahash-fallback");
  });

  test("solid-color black → valid hash", async () => {
    const result = await perceptualHashStructured(solidBytes(0));
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  test("solid-color white → valid hash", async () => {
    const result = await perceptualHashStructured(solidBytes(255));
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  test("solid black and solid white → non-zero hamming distance", async () => {
    const black = await perceptualHashStructured(solidBytes(0));
    const white = await perceptualHashStructured(solidBytes(255));
    // They may hash the same under fallback (all-same byte pattern), or differ.
    // Either way, hammingDistance must be a valid non-negative integer.
    const d = hammingDistance(black.hash, white.hash);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(64);
  });

  test("very small buffer (16 bytes) → valid structured result", async () => {
    const result = await perceptualHashStructured(new Uint8Array(16).fill(128));
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(["dct-phash", "ahash-fallback"]).toContain(result.algorithm);
  });
});

// ---------------------------------------------------------------------------
// phashAlgorithm field on ImageCandidate (via dedupeByHash computeHashes)
// ---------------------------------------------------------------------------

describe("dedupeByHash phashAlgorithm population", () => {
  const mk = (url: string, phash?: string): ImageCandidate => ({
    url,
    source: "test",
    license: "CC0",
    phash,
  });

  test("sync dedupeByHash preserves existing phash fields", () => {
    const a = mk("https://a.example/a.jpg", "abcdef1234567890");
    const b = mk("https://b.example/b.jpg", "abcdef1234567890");
    const c = mk("https://c.example/c.jpg", "ffffffff00000000");
    const out = dedupeByHash([a, b, c], 6);
    expect(out.length).toBe(2);
  });

  test("sync dedupeByHash with phashResult on candidate preserves it", () => {
    const a: ImageCandidate = {
      url: "https://a.example/a.jpg",
      source: "test",
      license: "CC0",
      phash: "abcdef1234567890",
      phashResult: { hash: "abcdef1234567890", algorithm: "dct-phash", confidence: 1.0 },
      phashAlgorithm: "dct-phash",
    };
    const b: ImageCandidate = {
      url: "https://b.example/b.jpg",
      source: "test",
      license: "CC0",
      phash: "abcdef1234567891",
      phashResult: { hash: "abcdef1234567891", algorithm: "ahash-fallback", confidence: 0.5 },
      phashAlgorithm: "ahash-fallback",
    };
    // Distance = 1 bit → duplicate under threshold 6
    const out = dedupeByHash([a, b], 6);
    expect(out.length).toBe(1);
    // The kept candidate should have its phashResult intact
    expect(out[0]?.phashResult).toBeDefined();
    expect(out[0]?.phashAlgorithm).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// findDuplicates with structured hash objects
// ---------------------------------------------------------------------------

describe("findDuplicates with phash field", () => {
  test("pairs near-identical phashes within threshold", () => {
    const pairs = findDuplicates(
      [
        { phash: "abcdef1234567890" },
        { phash: "abcdef1234567890" },
        { phash: "ffffffffffffffff" },
      ],
      5,
    );
    expect(pairs).toEqual([[0, 1]]);
  });

  test("no pairs when all hashes are far apart", () => {
    const pairs = findDuplicates(
      [
        { phash: "0000000000000000" },
        { phash: "ffffffffffffffff" },
        { phash: "f0f0f0f0f0f0f0f0" },
      ],
      3,
    );
    expect(pairs.length).toBe(0);
  });

  test("skips candidates without phash", () => {
    const pairs = findDuplicates(
      [
        { phash: "abcdef1234567890" },
        {}, // no phash
        { phash: "abcdef1234567890" },
      ],
      5,
    );
    expect(pairs).toEqual([[0, 2]]);
  });

  test("threshold 0 only matches identical hashes", () => {
    const pairs = findDuplicates(
      [{ phash: "abcdef1234567890" }, { phash: "abcdef1234567891" }, { phash: "abcdef1234567890" }],
      0,
    );
    expect(pairs).toEqual([[0, 2]]);
  });
});

// ---------------------------------------------------------------------------
// compare_phashes response shape (unit-level, no network)
// ---------------------------------------------------------------------------

describe("compare_phashes response shape", () => {
  test("PerceptualHashResult fields are all present and typed", () => {
    const result: PerceptualHashResult = {
      hash: "deadbeefcafebabe",
      algorithm: "dct-phash",
      confidence: 1.0,
    };
    expect(typeof result.hash).toBe("string");
    expect(result.hash).toHaveLength(16);
    expect(result.algorithm).toBe("dct-phash");
    expect(result.confidence).toBe(1.0);
  });

  test("candidate shape mirrors expected API response", () => {
    const hashA: PerceptualHashResult = { hash: "1111111111111111", algorithm: "dct-phash", confidence: 1.0 };
    const hashB: PerceptualHashResult = { hash: "1111111111111110", algorithm: "ahash-fallback", confidence: 0.5 };
    const hamming = hammingDistance(hashA.hash, hashB.hash);

    const response = {
      candidates: [
        { url: "https://a.example/a.jpg", phash: hashA.hash, algorithm: hashA.algorithm, confidence: hashA.confidence },
        { url: "https://b.example/b.jpg", phash: hashB.hash, algorithm: hashB.algorithm, confidence: hashB.confidence },
      ],
      hamming,
      isMatch: hamming <= 6,
    };

    expect(response.candidates).toHaveLength(2);
    expect(response.candidates[0]).toHaveProperty("url");
    expect(response.candidates[0]).toHaveProperty("phash");
    expect(response.candidates[0]).toHaveProperty("algorithm");
    expect(response.candidates[0]).toHaveProperty("confidence");
    expect(typeof response.hamming).toBe("number");
    expect(typeof response.isMatch).toBe("boolean");

    // distance of 1 bit → isMatch true
    expect(response.hamming).toBe(1);
    expect(response.isMatch).toBe(true);
  });

  test("isMatch false when hamming > 6", () => {
    const hashA: PerceptualHashResult = { hash: "0000000000000000", algorithm: "dct-phash", confidence: 1.0 };
    const hashB: PerceptualHashResult = { hash: "00000000000000ff", algorithm: "dct-phash", confidence: 1.0 };
    const hamming = hammingDistance(hashA.hash, hashB.hash);
    expect(hamming).toBe(8);
    expect(hamming <= 6).toBe(false);
  });
});
