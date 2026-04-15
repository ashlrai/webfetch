import { describe, expect, test } from "bun:test";
import {
  findDuplicates,
  hammingDistance,
  perceptualHash,
} from "../packages/core/src/perceptual-hash.ts";

// Tiny synthetic "image" byte patterns. When `sharp` is present, perceptualHash
// decodes as real image data; otherwise falls back to a byte-window aHash.
// These assertions hold in both paths because we construct deterministic
// same / similar / different byte inputs.

function makeBytes(pattern: number, len = 4096): Uint8Array {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (pattern + i) & 0xff;
  return out;
}

describe("perceptualHash", () => {
  test("returns 16 hex chars (64-bit)", async () => {
    const h = await perceptualHash(makeBytes(42));
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  test("same input → identical hash", async () => {
    const a = makeBytes(7);
    const h1 = await perceptualHash(a);
    const h2 = await perceptualHash(new Uint8Array(a));
    expect(h1).toBe(h2);
  });

  test("very different input → large hamming distance", async () => {
    const a = await perceptualHash(makeBytes(0));
    // All-1s vs gradient from 0 — maximally different windows.
    const flipped = new Uint8Array(4096);
    for (let i = 0; i < flipped.length; i++) flipped[i] = 255 - (i & 0xff);
    const b = await perceptualHash(flipped);
    expect(hammingDistance(a, b)).toBeGreaterThanOrEqual(20);
  });

  test("hammingDistance matches known xor-popcount", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance("ffffffffffffffff", "0000000000000000")).toBe(64);
    expect(hammingDistance("abcdef1234567890", "abcdef1234567890")).toBe(0);
  });

  test("findDuplicates pairs near-identical phashes", () => {
    const pairs = findDuplicates(
      [{ phash: "abcdef1234567890" }, { phash: "abcdef1234567890" }, { phash: "ffffffffffffffff" }],
      5,
    );
    expect(pairs).toEqual([[0, 1]]);
  });
});
