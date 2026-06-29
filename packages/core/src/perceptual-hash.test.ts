/**
 * Tests for structured pHash output and back-compat.
 */

import { describe, expect, it } from "bun:test";
import {
  perceptualHash,
  perceptualHashStructured,
  phashToString,
} from "./perceptual-hash.ts";

// Minimal synthetic bytes — enough to exercise the fallback path (no sharp in test env).
function syntheticBytes(n = 256): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 37 + 13) % 256;
  return b;
}

describe("perceptualHashStructured", () => {
  it("returns an object with hash, algorithm, and confidence", async () => {
    const result = await perceptualHashStructured(syntheticBytes());
    expect(result).toHaveProperty("hash");
    expect(result).toHaveProperty("algorithm");
    expect(result).toHaveProperty("confidence");
  });

  it("hash is a 16-hex-char string", async () => {
    const { hash } = await perceptualHashStructured(syntheticBytes());
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("algorithm is one of the valid literals", async () => {
    const { algorithm } = await perceptualHashStructured(syntheticBytes());
    expect(["dct-phash", "ahash-fallback"]).toContain(algorithm);
  });

  it("confidence is a number between 0 and 1 inclusive", async () => {
    const { confidence } = await perceptualHashStructured(syntheticBytes());
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it("is deterministic for identical bytes", async () => {
    const bytes = syntheticBytes(512);
    const a = await perceptualHashStructured(bytes);
    const b = await perceptualHashStructured(bytes);
    expect(a.hash).toBe(b.hash);
    expect(a.algorithm).toBe(b.algorithm);
    expect(a.confidence).toBe(b.confidence);
  });
});

describe("perceptualHash (back-compat)", () => {
  it("returns a 16-hex-char string", async () => {
    const hash = await perceptualHash(syntheticBytes());
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("matches the hash field of the structured result", async () => {
    const bytes = syntheticBytes(128);
    const [bare, structured] = await Promise.all([
      perceptualHash(bytes),
      perceptualHashStructured(bytes),
    ]);
    expect(bare).toBe(structured.hash);
  });
});

describe("phashToString", () => {
  it("passes a bare string through unchanged", () => {
    expect(phashToString("aabbccddeeff0011")).toBe("aabbccddeeff0011");
  });

  it("extracts hash from a PerceptualHashResult", () => {
    const result = { hash: "1122334455667788", algorithm: "dct-phash" as const, confidence: 1.0 };
    expect(phashToString(result)).toBe("1122334455667788");
  });
});
