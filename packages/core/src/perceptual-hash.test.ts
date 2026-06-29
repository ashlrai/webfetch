/**
 * Tests for structured pHash output, back-compat, and benchmarking exports.
 *
 * Covers:
 *  - perceptualHashStructured / perceptualHash / phashToString (existing)
 *  - hammingDistance / batchHammingDistances / hammingDistanceMatrix / findDuplicates
 *  - hammingPercentile (both overloads)
 *  - phashDistanceStats
 *  - phashBatchValidation
 */

import { describe, expect, it } from "bun:test";
import {
  batchHammingDistances,
  findDuplicates,
  hammingDistance,
  hammingDistanceMatrix,
  hammingPercentile,
  perceptualHash,
  perceptualHashStructured,
  phashBatchValidation,
  phashDistanceStats,
  phashToString,
} from "./perceptual-hash.ts";
import type {
  HammingCandidate,
  HammingPercentileResult,
  PhashBatchValidationResult,
  PhashDistanceStats,
} from "./perceptual-hash.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function syntheticBytes(n = 256, seed = 42): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 37 + seed) % 256;
  return b;
}

function uniformBytes(value: number, n = 256): Uint8Array {
  return new Uint8Array(n).fill(value);
}

// ---------------------------------------------------------------------------
// perceptualHashStructured
// ---------------------------------------------------------------------------

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

  it("empty bytes → valid 16-hex hash", async () => {
    const result = await perceptualHashStructured(new Uint8Array(0));
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("empty bytes → ahash-fallback algorithm", async () => {
    const result = await perceptualHashStructured(new Uint8Array(0));
    expect(result.algorithm).toBe("ahash-fallback");
  });

  it("empty bytes → confidence 0.5", async () => {
    const result = await perceptualHashStructured(new Uint8Array(0));
    expect(result.confidence).toBe(0.5);
  });

  it("1-byte image → valid 16-hex hash", async () => {
    const result = await perceptualHashStructured(new Uint8Array([0xab]));
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("uniform bytes → valid hash", async () => {
    const result = await perceptualHashStructured(uniformBytes(128));
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("all-zero bytes → valid hash", async () => {
    const result = await perceptualHashStructured(uniformBytes(0, 64));
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("all-255 bytes → valid hash", async () => {
    const result = await perceptualHashStructured(uniformBytes(255, 64));
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("large input (16 KB) → valid hash", async () => {
    const result = await perceptualHashStructured(syntheticBytes(16384));
    expect(result.hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// perceptualHash (back-compat)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// phashToString
// ---------------------------------------------------------------------------

describe("phashToString", () => {
  it("passes a bare string through unchanged", () => {
    expect(phashToString("aabbccddeeff0011")).toBe("aabbccddeeff0011");
  });

  it("extracts hash from a PerceptualHashResult", () => {
    const result = { hash: "1122334455667788", algorithm: "dct-phash" as const, confidence: 1.0 };
    expect(phashToString(result)).toBe("1122334455667788");
  });
});

// ---------------------------------------------------------------------------
// hammingDistance
// ---------------------------------------------------------------------------

describe("hammingDistance", () => {
  it("identical hashes → distance 0", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
  });

  it("all-zeros vs all-ones → distance 64", () => {
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  it("single-bit difference → distance 1", () => {
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
  });

  it("is symmetric", () => {
    const a = "abcd1234abcd1234";
    const b = "1234abcd1234abcd";
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
  });

  it("satisfies triangle inequality on 3 known hashes", () => {
    const h1 = "0000000000000000";
    const h2 = "000000000000000f";
    const h3 = "00000000000000ff";
    const d12 = hammingDistance(h1, h2);
    const d23 = hammingDistance(h2, h3);
    const d13 = hammingDistance(h1, h3);
    expect(d13).toBeLessThanOrEqual(d12 + d23);
  });

  it("nibble-level XOR is correct: '1' vs '2' = popcount(1^2=3) = 2", () => {
    // '1' = 0001, '2' = 0010 → XOR = 0011 → 2 bits
    const a = "1000000000000000";
    const b = "2000000000000000";
    expect(hammingDistance(a, b)).toBe(2);
  });

  it("distance in [0, 64] for random-ish hashes", () => {
    const d = hammingDistance("deadbeefcafebabe", "cafebabe12345678");
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(64);
  });
});

// ---------------------------------------------------------------------------
// batchHammingDistances
// ---------------------------------------------------------------------------

describe("batchHammingDistances", () => {
  it("returns [0, 64, 64] for all-zeros ref vs [zeros, ones, undefined]", () => {
    const result = batchHammingDistances("0000000000000000", [
      "0000000000000000",
      "ffffffffffffffff",
      undefined,
    ]);
    expect(result).toEqual([0, 64, 64]);
  });

  it("empty candidates → empty array", () => {
    expect(batchHammingDistances("0000000000000000", [])).toEqual([]);
  });

  it("all undefined → all 64", () => {
    const result = batchHammingDistances("0000000000000000", [undefined, undefined]);
    expect(result).toEqual([64, 64]);
  });
});

// ---------------------------------------------------------------------------
// hammingDistanceMatrix
// ---------------------------------------------------------------------------

describe("hammingDistanceMatrix", () => {
  it("2×2 identity matrix has zeros on diagonal", () => {
    const mat = hammingDistanceMatrix(
      ["0000000000000000", "ffffffffffffffff"],
      ["0000000000000000", "ffffffffffffffff"],
    );
    expect(mat[0]![0]).toBe(0);
    expect(mat[1]![1]).toBe(0);
  });

  it("2×2 off-diagonal = 64 for all-zeros vs all-ones", () => {
    const mat = hammingDistanceMatrix(
      ["0000000000000000", "ffffffffffffffff"],
      ["0000000000000000", "ffffffffffffffff"],
    );
    expect(mat[0]![1]).toBe(64);
    expect(mat[1]![0]).toBe(64);
  });

  it("undefined entries get distance 64", () => {
    const mat = hammingDistanceMatrix(
      [undefined],
      ["0000000000000000"],
    );
    expect(mat[0]![0]).toBe(64);
  });

  it("1×3 shape", () => {
    const mat = hammingDistanceMatrix(
      ["0000000000000000"],
      ["0000000000000000", "ffffffffffffffff", "0000000000000001"],
    );
    expect(mat.length).toBe(1);
    expect(mat[0]!.length).toBe(3);
    expect(mat[0]![0]).toBe(0);
    expect(mat[0]![1]).toBe(64);
    expect(mat[0]![2]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// findDuplicates
// ---------------------------------------------------------------------------

describe("findDuplicates", () => {
  it("finds close pair within threshold", () => {
    const candidates = [
      { phash: "0000000000000000" },
      { phash: "0000000000000001" }, // distance 1
      { phash: "ffffffffffffffff" }, // distance 64
    ];
    const pairs = findDuplicates(candidates, 5);
    expect(pairs.some(([i, j]) => (i === 0 && j === 1))).toBe(true);
  });

  it("threshold=0 finds no pairs when all distinct", () => {
    const candidates = [
      { phash: "0000000000000000" },
      { phash: "0000000000000001" },
    ];
    expect(findDuplicates(candidates, 0)).toHaveLength(0);
  });

  it("skips entries with missing phash", () => {
    const candidates = [
      { phash: undefined },
      { phash: "0000000000000000" },
    ];
    expect(findDuplicates(candidates, 64)).toHaveLength(0);
  });

  it("returns pairs as [i,j] where i < j", () => {
    const candidates = [
      { phash: "0000000000000000" },
      { phash: "0000000000000000" }, // exact duplicate
    ];
    const pairs = findDuplicates(candidates, 0);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]![0]).toBeLessThan(pairs[0]![1]);
  });
});

// ---------------------------------------------------------------------------
// hammingPercentile — legacy overload
// ---------------------------------------------------------------------------

describe("hammingPercentile (legacy numeric array)", () => {
  const dists = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45];

  it("P0 → smallest value", () => {
    expect((hammingPercentile as (d: number[], p: number) => number)(dists, 0)).toBe(0);
  });

  it("P1.0 → largest value (nearest-rank)", () => {
    const v = (hammingPercentile as (d: number[], p: number) => number)(dists, 1.0);
    expect(v).toBe(45);
  });

  it("empty array → 0", () => {
    expect((hammingPercentile as (d: number[], p: number) => number)([], 0.5)).toBe(0);
  });

  it("single element → that element regardless of p", () => {
    expect((hammingPercentile as (d: number[], p: number) => number)([7], 0.0)).toBe(7);
    expect((hammingPercentile as (d: number[], p: number) => number)([7], 0.5)).toBe(7);
    expect((hammingPercentile as (d: number[], p: number) => number)([7], 1.0)).toBe(7);
  });

  it("result is always in [min, max] of input", () => {
    const d = [10, 3, 55, 22, 8];
    for (const p of [0, 0.25, 0.5, 0.75, 1.0]) {
      const v = (hammingPercentile as (d: number[], p: number) => number)(d, p);
      expect(v).toBeGreaterThanOrEqual(Math.min(...d));
      expect(v).toBeLessThanOrEqual(Math.max(...d));
    }
  });
});

// ---------------------------------------------------------------------------
// hammingPercentile — ranked candidates overload
// ---------------------------------------------------------------------------

describe("hammingPercentile (ranked candidates overload)", () => {
  const refHash = "0000000000000000";
  const candidates: HammingCandidate[] = [
    { hash: "0000000000000001", metadata: "A" }, // distance 1
    { hash: "000000000000000f", metadata: "B" }, // distance 4
    { hash: "00000000000000ff", metadata: "C" }, // distance 8
    { hash: "000000000000ffff", metadata: "D" }, // distance 16
    { hash: "0000000000ffffff", metadata: "E" }, // distance 24
  ];

  it("returns HammingPercentileResult shape", () => {
    const r = hammingPercentile(refHash, candidates, 0.5) as HammingPercentileResult;
    expect(r).toHaveProperty("percentileDistance");
    expect(r).toHaveProperty("candidateAtPercentile");
    expect(r).toHaveProperty("rankedCandidates");
  });

  it("rankedCandidates.length equals input length", () => {
    const r = hammingPercentile(refHash, candidates, 0.5) as HammingPercentileResult;
    expect(r.rankedCandidates.length).toBe(candidates.length);
  });

  it("rankedCandidates sorted ascending by distance", () => {
    const r = hammingPercentile(refHash, candidates, 0.5) as HammingPercentileResult;
    for (let i = 1; i < r.rankedCandidates.length; i++) {
      expect(r.rankedCandidates[i]!.distance).toBeGreaterThanOrEqual(
        r.rankedCandidates[i - 1]!.distance,
      );
    }
  });

  it("P0.0 → nearest candidate (distance 1)", () => {
    const r = hammingPercentile(refHash, candidates, 0.0) as HammingPercentileResult;
    expect(r.percentileDistance).toBe(hammingDistance(refHash, "0000000000000001"));
  });

  it("P1.0 → farthest candidate", () => {
    const r = hammingPercentile(refHash, candidates, 1.0) as HammingPercentileResult;
    const farthest = r.rankedCandidates[r.rankedCandidates.length - 1]!.distance;
    expect(r.percentileDistance).toBe(farthest);
  });

  it("empty candidates → null candidateAtPercentile", () => {
    const r = hammingPercentile(refHash, [], 0.5) as HammingPercentileResult;
    expect(r.candidateAtPercentile).toBeNull();
  });

  it("empty candidates → empty rankedCandidates", () => {
    const r = hammingPercentile(refHash, [], 0.5) as HammingPercentileResult;
    expect(r.rankedCandidates).toHaveLength(0);
  });

  it("empty candidates → percentileDistance 0", () => {
    const r = hammingPercentile(refHash, [], 0.5) as HammingPercentileResult;
    expect(r.percentileDistance).toBe(0);
  });

  it("candidateAtPercentile metadata is preserved", () => {
    const r = hammingPercentile(refHash, candidates, 0.0) as HammingPercentileResult;
    expect(r.candidateAtPercentile?.metadata).toBe("A");
  });

  it("all distances are non-negative", () => {
    const r = hammingPercentile(refHash, candidates, 0.5) as HammingPercentileResult;
    for (const entry of r.rankedCandidates) {
      expect(entry.distance).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// phashDistanceStats
// ---------------------------------------------------------------------------

describe("phashDistanceStats", () => {
  it("throws RangeError for < 2 images", async () => {
    await expect(
      phashDistanceStats([syntheticBytes(64)]),
    ).rejects.toThrow(RangeError);
  });

  it("throws RangeError for empty array", async () => {
    await expect(phashDistanceStats([])).rejects.toThrow(RangeError);
  });

  it("returns PhashDistanceStats shape for 2 images", async () => {
    const stats = await phashDistanceStats([
      syntheticBytes(256, 1),
      syntheticBytes(256, 2),
    ]);
    expect(stats).toHaveProperty("minDistance");
    expect(stats).toHaveProperty("maxDistance");
    expect(stats).toHaveProperty("meanDistance");
    expect(stats).toHaveProperty("stdDev");
    expect(stats).toHaveProperty("histogram");
    expect(stats).toHaveProperty("pairCount");
    expect(stats).toHaveProperty("algorithm");
    expect(stats).toHaveProperty("avgConfidence");
  });

  it("pairCount = n*(n-1)/2 for n=5", async () => {
    const images = Array.from({ length: 5 }, (_, i) => syntheticBytes(256, i + 1));
    const stats = await phashDistanceStats(images);
    expect(stats.pairCount).toBe(10);
  });

  it("pairCount = 1 for n=2", async () => {
    const stats = await phashDistanceStats([syntheticBytes(256, 1), syntheticBytes(256, 2)]);
    expect(stats.pairCount).toBe(1);
  });

  it("minDistance <= maxDistance", async () => {
    const images = Array.from({ length: 4 }, (_, i) => syntheticBytes(256, i * 7));
    const stats = await phashDistanceStats(images);
    expect(stats.minDistance).toBeLessThanOrEqual(stats.maxDistance);
  });

  it("meanDistance in [minDistance, maxDistance]", async () => {
    const images = Array.from({ length: 4 }, (_, i) => syntheticBytes(256, i * 7));
    const stats = await phashDistanceStats(images);
    expect(stats.meanDistance).toBeGreaterThanOrEqual(stats.minDistance);
    expect(stats.meanDistance).toBeLessThanOrEqual(stats.maxDistance);
  });

  it("stdDev >= 0", async () => {
    const images = Array.from({ length: 4 }, (_, i) => syntheticBytes(256, i * 7));
    const stats = await phashDistanceStats(images);
    expect(stats.stdDev).toBeGreaterThanOrEqual(0);
  });

  it("histogram has exactly 8 buckets", async () => {
    const images = Array.from({ length: 4 }, (_, i) => syntheticBytes(256, i));
    const stats = await phashDistanceStats(images);
    expect(stats.histogram).toHaveLength(8);
  });

  it("histogram sum equals pairCount", async () => {
    const images = Array.from({ length: 5 }, (_, i) => syntheticBytes(256, i));
    const stats = await phashDistanceStats(images);
    const sum = stats.histogram.reduce((s, v) => s + v, 0);
    expect(sum).toBe(stats.pairCount);
  });

  it("histogram has no negative values", async () => {
    const images = Array.from({ length: 6 }, (_, i) => syntheticBytes(256, i));
    const stats = await phashDistanceStats(images);
    for (const v of stats.histogram) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("identical image pair → minDistance=0, maxDistance=0, stdDev=0", async () => {
    const img = syntheticBytes(256, 17);
    const stats = await phashDistanceStats([img, img]);
    expect(stats.minDistance).toBe(0);
    expect(stats.maxDistance).toBe(0);
    expect(stats.stdDev).toBe(0);
  });

  it("identical image pair → histogram[0]=1, rest=0", async () => {
    const img = syntheticBytes(256, 17);
    const stats = await phashDistanceStats([img, img]);
    expect(stats.histogram[0]).toBe(1);
    for (let i = 1; i < 8; i++) {
      expect(stats.histogram[i]).toBe(0);
    }
  });

  it("avgConfidence in [0, 1]", async () => {
    const images = [syntheticBytes(256, 1), syntheticBytes(256, 2)];
    const stats = await phashDistanceStats(images);
    expect(stats.avgConfidence).toBeGreaterThanOrEqual(0);
    expect(stats.avgConfidence).toBeLessThanOrEqual(1);
  });

  it("algorithm field is a valid algorithm string", async () => {
    const images = [syntheticBytes(256, 1), syntheticBytes(256, 2)];
    const stats = await phashDistanceStats(images);
    expect(["dct-phash", "ahash-fallback"]).toContain(stats.algorithm);
  });

  it("20-image set → pairCount=190", async () => {
    const images = Array.from({ length: 20 }, (_, i) => syntheticBytes(256, i * 31));
    const stats = await phashDistanceStats(images);
    expect(stats.pairCount).toBe(190);
    expect(stats.histogram.reduce((s, v) => s + v, 0)).toBe(190);
  });

  it("all distances in [0, 64]", async () => {
    const images = Array.from({ length: 5 }, (_, i) => syntheticBytes(256, i * 13));
    const stats = await phashDistanceStats(images);
    expect(stats.minDistance).toBeGreaterThanOrEqual(0);
    expect(stats.maxDistance).toBeLessThanOrEqual(64);
  });
});

// ---------------------------------------------------------------------------
// phashBatchValidation
// ---------------------------------------------------------------------------

describe("phashBatchValidation", () => {
  it("returns PhashBatchValidationResult shape", async () => {
    const result = await phashBatchValidation();
    expect(result).toHaveProperty("assertions");
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("failed");
    expect(result).toHaveProperty("allPassed");
    expect(result).toHaveProperty("summary");
  });

  it("assertions is a non-empty array", async () => {
    const result = await phashBatchValidation();
    expect(result.assertions.length).toBeGreaterThan(0);
  });

  it("passed + failed = total assertions", async () => {
    const result = await phashBatchValidation();
    expect(result.passed + result.failed).toBe(result.assertions.length);
  });

  it("all assertions have label, passed, detail fields", async () => {
    const result = await phashBatchValidation();
    for (const a of result.assertions) {
      expect(typeof a.label).toBe("string");
      expect(typeof a.passed).toBe("boolean");
      expect(typeof a.detail).toBe("string");
    }
  });

  it("allPassed is true when failed=0", async () => {
    const result = await phashBatchValidation();
    expect(result.allPassed).toBe(result.failed === 0);
  });

  it("has at least 30 assertions (comprehensive suite)", async () => {
    const result = await phashBatchValidation();
    expect(result.assertions.length).toBeGreaterThanOrEqual(30);
  });

  it("all assertions pass", async () => {
    const result: PhashBatchValidationResult = await phashBatchValidation();
    const failedLabels = result.assertions
      .filter((a) => !a.passed)
      .map((a) => `${a.label}: ${a.detail}`);
    expect(failedLabels).toEqual([]);
  });

  it("summary string contains assertion counts", async () => {
    const result = await phashBatchValidation();
    expect(result.summary).toContain(`${result.passed}/${result.assertions.length}`);
  });
});
