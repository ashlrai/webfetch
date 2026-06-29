/**
 * Tests for packages/core/src/phash-diagnostics.ts
 *
 * Covers:
 *   (a) high-confidence DCT mix (all sharp-available)
 *   (b) fallback-heavy aHash (sharp unavailable / all fallback)
 *   (c) mixed providers with varying confidence
 *   (d) edge case: single image, no dedup, confidence=1.0
 *   (e) edge case: degraded timeout reduces confidence (via confidence < 1 on phashResult)
 *   (f) confidence correlation with actual false-positive rate
 *   + extra invariant and edge-case coverage
 */

import { describe, expect, test } from "bun:test";
import { analyzePhashQuality } from "../packages/core/src/phash-diagnostics.ts";
import type {
  AlgorithmMix,
  PhashDiagnosticsResult,
} from "../packages/core/src/phash-diagnostics.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function dctCandidate(url: string, confidence = 1.0): ImageCandidate {
  return {
    url,
    source: "wikimedia",
    license: "CC0",
    phash: "abcdef1234567890",
    phashAlgorithm: "dct-phash",
    phashResult: { hash: "abcdef1234567890", algorithm: "dct-phash", confidence },
  };
}

function ahashCandidate(url: string, confidence = 0.5): ImageCandidate {
  return {
    url,
    source: "bing",
    license: "UNKNOWN",
    phash: "1234567890abcdef",
    phashAlgorithm: "ahash-fallback",
    phashResult: { hash: "1234567890abcdef", algorithm: "ahash-fallback", confidence },
  };
}

function bareHashCandidate(url: string): ImageCandidate {
  return {
    url,
    source: "brave",
    license: "UNKNOWN",
    phash: "deadbeefcafebabe",
    // no phashAlgorithm, no phashResult — algorithm unknown
  };
}

function unhashedCandidate(url: string): ImageCandidate {
  return {
    url,
    source: "browser",
    license: "UNKNOWN",
    // no phash at all
  };
}

// ---------------------------------------------------------------------------
// (a) High-confidence DCT mix — all candidates use dct-phash
// ---------------------------------------------------------------------------

describe("(a) high-confidence DCT mix", () => {
  const candidates = [
    dctCandidate("https://a.example/1.jpg"),
    dctCandidate("https://a.example/2.jpg"),
    dctCandidate("https://a.example/3.jpg"),
    dctCandidate("https://a.example/4.jpg"),
    dctCandidate("https://a.example/5.jpg"),
  ];

  test("algorithmMix is high-quality", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.algorithmMix).toBe("high-quality" satisfies AlgorithmMix);
  });

  test("perAlgorithm.dct.count equals total candidates", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.perAlgorithm.dct.count).toBe(candidates.length);
    expect(diag.perAlgorithm.ahash.count).toBe(0);
  });

  test("perAlgorithm.dct.confidence is 1.0", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.perAlgorithm.dct.confidence).toBe(1.0);
  });

  test("confidenceDistribution.mean is 1.0", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.confidenceDistribution.mean).toBe(1.0);
    expect(diag.confidenceDistribution.min).toBe(1.0);
    expect(diag.confidenceDistribution.max).toBe(1.0);
    expect(diag.confidenceDistribution.stdDev).toBe(0);
  });

  test("dedupeReliability is 1.0", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.dedupeReliability).toBe(1.0);
  });

  test("hashedCount equals totalCandidates, unhashedCount is 0", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.totalCandidates).toBe(candidates.length);
    expect(diag.hashedCount).toBe(candidates.length);
    expect(diag.unhashedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (b) Fallback-heavy aHash — all candidates use ahash-fallback
// ---------------------------------------------------------------------------

describe("(b) fallback-heavy aHash", () => {
  const candidates = [
    ahashCandidate("https://b.example/1.jpg"),
    ahashCandidate("https://b.example/2.jpg"),
    ahashCandidate("https://b.example/3.jpg"),
  ];

  test("algorithmMix is fallback-heavy", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.algorithmMix).toBe("fallback-heavy" satisfies AlgorithmMix);
  });

  test("perAlgorithm.ahash.count equals total", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.perAlgorithm.ahash.count).toBe(candidates.length);
    expect(diag.perAlgorithm.dct.count).toBe(0);
  });

  test("perAlgorithm.dct.confidence is 0 when no DCT candidates", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.perAlgorithm.dct.confidence).toBe(0);
  });

  test("confidenceDistribution.mean is 0.5 (all ahash)", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.confidenceDistribution.mean).toBeCloseTo(0.5, 5);
    expect(diag.confidenceDistribution.stdDev).toBe(0); // all identical
  });

  test("dedupeReliability is 0 (no DCT → dctRatio=0)", () => {
    const diag = analyzePhashQuality(candidates);
    // meanConf (0.5) * dctRatio (0.0) = 0
    expect(diag.dedupeReliability).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (c) Mixed providers with varying confidence
// ---------------------------------------------------------------------------

describe("(c) mixed providers with varying confidence", () => {
  const candidates = [
    dctCandidate("https://c.example/1.jpg", 1.0),  // DCT full confidence
    dctCandidate("https://c.example/2.jpg", 0.8),  // DCT partial (degraded timeout)
    ahashCandidate("https://c.example/3.jpg", 0.5), // aHash
    ahashCandidate("https://c.example/4.jpg", 0.3), // aHash low
  ];

  test("algorithmMix is degraded (50% DCT)", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.algorithmMix).toBe("degraded" satisfies AlgorithmMix);
  });

  test("perAlgorithm counts split 2/2", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.perAlgorithm.dct.count).toBe(2);
    expect(diag.perAlgorithm.ahash.count).toBe(2);
  });

  test("perAlgorithm.dct.confidence is mean of DCT confidences", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.perAlgorithm.dct.confidence).toBeCloseTo((1.0 + 0.8) / 2, 5);
  });

  test("perAlgorithm.ahash.confidence is mean of aHash confidences", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.perAlgorithm.ahash.confidence).toBeCloseTo((0.5 + 0.3) / 2, 5);
  });

  test("confidenceDistribution.mean is mean of all 4 confidences", () => {
    const diag = analyzePhashQuality(candidates);
    const expected = (1.0 + 0.8 + 0.5 + 0.3) / 4;
    expect(diag.confidenceDistribution.mean).toBeCloseTo(expected, 5);
  });

  test("confidenceDistribution.min is 0.3", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.confidenceDistribution.min).toBeCloseTo(0.3, 5);
  });

  test("confidenceDistribution.max is 1.0", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.confidenceDistribution.max).toBeCloseTo(1.0, 5);
  });

  test("dedupeReliability = mean * dctRatio", () => {
    const diag = analyzePhashQuality(candidates);
    const expectedMean = (1.0 + 0.8 + 0.5 + 0.3) / 4;
    const expectedDctRatio = 2 / 4; // 0.5
    expect(diag.dedupeReliability).toBeCloseTo(expectedMean * expectedDctRatio, 5);
  });

  test("confidenceDistribution.stdDev > 0 (values differ)", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.confidenceDistribution.stdDev).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (d) Edge case: single image, no dedup, confidence=1.0
// ---------------------------------------------------------------------------

describe("(d) single image, no dedup needed", () => {
  const candidates = [dctCandidate("https://d.example/solo.jpg", 1.0)];

  test("totalCandidates=1, hashedCount=1, unhashedCount=0", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.totalCandidates).toBe(1);
    expect(diag.hashedCount).toBe(1);
    expect(diag.unhashedCount).toBe(0);
  });

  test("algorithmMix is high-quality (single DCT candidate)", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.algorithmMix).toBe("high-quality");
  });

  test("dedupeReliability is 1.0", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.dedupeReliability).toBe(1.0);
  });

  test("confidenceDistribution.stdDev is 0 (single value)", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.confidenceDistribution.stdDev).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (e) Edge case: degraded timeout reduces confidence
// Simulates a provider that timed out and had its phash confidence reduced
// (e.g., confidence < 1.0 on a dct-phash result because of partial data).
// ---------------------------------------------------------------------------

describe("(e) degraded timeout reduces confidence", () => {
  // A realistic scenario: 4 DCT candidates, 2 of which were from a provider
  // that timed out and returned a degraded confidence (e.g. 0.4).
  const candidates = [
    dctCandidate("https://e.example/1.jpg", 1.0),
    dctCandidate("https://e.example/2.jpg", 1.0),
    dctCandidate("https://e.example/3.jpg", 0.4), // timed-out provider
    dctCandidate("https://e.example/4.jpg", 0.4), // timed-out provider
  ];

  test("algorithmMix is high-quality (all DCT)", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.algorithmMix).toBe("high-quality");
  });

  test("confidenceDistribution.mean < 1.0 due to degraded entries", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.confidenceDistribution.mean).toBeLessThan(1.0);
    expect(diag.confidenceDistribution.mean).toBeCloseTo((1.0 + 1.0 + 0.4 + 0.4) / 4, 5);
  });

  test("dedupeReliability < 1.0 due to reduced mean confidence", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.dedupeReliability).toBeLessThan(1.0);
  });

  test("dedupeReliability = mean * 1.0 (all DCT, dctRatio=1)", () => {
    const diag = analyzePhashQuality(candidates);
    const expectedMean = (1.0 + 1.0 + 0.4 + 0.4) / 4;
    expect(diag.dedupeReliability).toBeCloseTo(expectedMean, 5);
  });

  test("confidenceDistribution.min is 0.4", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.confidenceDistribution.min).toBeCloseTo(0.4, 5);
  });

  test("confidenceDistribution.max is 1.0", () => {
    const diag = analyzePhashQuality(candidates);
    expect(diag.confidenceDistribution.max).toBeCloseTo(1.0, 5);
  });
});

// ---------------------------------------------------------------------------
// (f) Confidence correlation with actual false-positive rate
//
// When dedupeReliability is high (all DCT, conf=1.0), two candidates with
// hammingDistance > threshold should NOT be merged (no false positives).
// When dedupeReliability is low (all aHash, conf=0.5), the algorithm is weaker;
// the test verifies the reported reliability tracks the mix correctly.
// ---------------------------------------------------------------------------

describe("(f) confidence correlation with false-positive rate", () => {
  test("high-reliability batch (all DCT) reports dedupeReliability >= 0.85", () => {
    const batch = Array.from({ length: 10 }, (_, i) =>
      dctCandidate(`https://f.example/${i}.jpg`, 1.0),
    );
    const diag = analyzePhashQuality(batch);
    expect(diag.dedupeReliability).toBeGreaterThanOrEqual(0.85);
  });

  test("low-reliability batch (all aHash) reports dedupeReliability === 0", () => {
    const batch = Array.from({ length: 10 }, (_, i) =>
      ahashCandidate(`https://f.example/${i}.jpg`, 0.5),
    );
    const diag = analyzePhashQuality(batch);
    // dctRatio = 0 → dedupeReliability = mean * 0 = 0
    expect(diag.dedupeReliability).toBe(0);
  });

  test("mixed batch: dedupeReliability is strictly between 0 and 0.85", () => {
    // 5 DCT + 5 aHash → dctRatio=0.5, mean ~= 0.75
    const batch = [
      ...Array.from({ length: 5 }, (_, i) => dctCandidate(`https://f.example/dct${i}.jpg`, 1.0)),
      ...Array.from({ length: 5 }, (_, i) => ahashCandidate(`https://f.example/ahash${i}.jpg`, 0.5)),
    ];
    const diag = analyzePhashQuality(batch);
    expect(diag.dedupeReliability).toBeGreaterThan(0);
    expect(diag.dedupeReliability).toBeLessThan(0.85);
  });

  test("dedupeReliability never exceeds 1.0", () => {
    const batch = Array.from({ length: 20 }, (_, i) =>
      dctCandidate(`https://f.example/${i}.jpg`, 1.0),
    );
    const diag = analyzePhashQuality(batch);
    expect(diag.dedupeReliability).toBeLessThanOrEqual(1.0);
  });

  test("dedupeReliability is never negative", () => {
    const batch = [
      ahashCandidate("https://f.example/a.jpg", 0.0),
      ahashCandidate("https://f.example/b.jpg", 0.0),
    ];
    const diag = analyzePhashQuality(batch);
    expect(diag.dedupeReliability).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Empty / zero candidates
// ---------------------------------------------------------------------------

describe("empty candidates array", () => {
  test("returns valid zero-state result without throwing", () => {
    const diag = analyzePhashQuality([]);
    expect(diag.totalCandidates).toBe(0);
    expect(diag.hashedCount).toBe(0);
    expect(diag.unhashedCount).toBe(0);
    expect(diag.algorithmMix).toBe("fallback-heavy"); // < 10% DCT → fallback-heavy
    expect(diag.dedupeReliability).toBe(0);
    expect(diag.confidenceDistribution.mean).toBe(0);
    expect(diag.confidenceDistribution.min).toBe(0);
    expect(diag.confidenceDistribution.max).toBe(0);
    expect(diag.confidenceDistribution.stdDev).toBe(0);
    expect(diag.perAlgorithm.dct.count).toBe(0);
    expect(diag.perAlgorithm.ahash.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Unhashed candidates
// ---------------------------------------------------------------------------

describe("candidates without hashes", () => {
  test("all-unhashed batch: unhashedCount = totalCandidates", () => {
    const batch = [
      unhashedCandidate("https://g.example/a.jpg"),
      unhashedCandidate("https://g.example/b.jpg"),
    ];
    const diag = analyzePhashQuality(batch);
    expect(diag.unhashedCount).toBe(2);
    expect(diag.hashedCount).toBe(0);
    expect(diag.algorithmMix).toBe("fallback-heavy");
    expect(diag.dedupeReliability).toBe(0);
  });

  test("mixed hashed + unhashed: counts are correct", () => {
    const batch = [
      dctCandidate("https://g.example/1.jpg"),
      unhashedCandidate("https://g.example/2.jpg"),
      ahashCandidate("https://g.example/3.jpg"),
      unhashedCandidate("https://g.example/4.jpg"),
    ];
    const diag = analyzePhashQuality(batch);
    expect(diag.totalCandidates).toBe(4);
    expect(diag.hashedCount).toBe(2);
    expect(diag.unhashedCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Bare-hash candidates (phash string only, no algorithm/phashResult)
// ---------------------------------------------------------------------------

describe("bare-hash candidates (phash string only)", () => {
  test("treated as ahash-fallback with confidence 0.5", () => {
    const batch = [
      bareHashCandidate("https://h.example/a.jpg"),
      bareHashCandidate("https://h.example/b.jpg"),
    ];
    const diag = analyzePhashQuality(batch);
    expect(diag.hashedCount).toBe(2);
    expect(diag.perAlgorithm.ahash.count).toBe(2);
    expect(diag.perAlgorithm.dct.count).toBe(0);
    expect(diag.confidenceDistribution.mean).toBeCloseTo(0.5, 5);
    expect(diag.algorithmMix).toBe("fallback-heavy");
  });
});

// ---------------------------------------------------------------------------
// phashAlgorithm field without phashResult
// ---------------------------------------------------------------------------

describe("phashAlgorithm field without phashResult", () => {
  test("dct-phash algorithm field → confidence 1.0", () => {
    const c: ImageCandidate = {
      url: "https://i.example/a.jpg",
      source: "wikimedia",
      license: "CC0",
      phash: "abcdef1234567890",
      phashAlgorithm: "dct-phash",
      // no phashResult
    };
    const diag = analyzePhashQuality([c]);
    expect(diag.perAlgorithm.dct.count).toBe(1);
    expect(diag.perAlgorithm.dct.confidence).toBe(1.0);
    expect(diag.algorithmMix).toBe("high-quality");
  });

  test("ahash-fallback algorithm field → confidence 0.5", () => {
    const c: ImageCandidate = {
      url: "https://i.example/b.jpg",
      source: "bing",
      license: "UNKNOWN",
      phash: "1234567890abcdef",
      phashAlgorithm: "ahash-fallback",
      // no phashResult
    };
    const diag = analyzePhashQuality([c]);
    expect(diag.perAlgorithm.ahash.count).toBe(1);
    expect(diag.perAlgorithm.ahash.confidence).toBe(0.5);
    expect(diag.algorithmMix).toBe("fallback-heavy");
  });
});

// ---------------------------------------------------------------------------
// Return type shape
// ---------------------------------------------------------------------------

describe("return type invariants", () => {
  test("all numeric fields are finite numbers", () => {
    const batch = [
      dctCandidate("https://j.example/1.jpg"),
      ahashCandidate("https://j.example/2.jpg"),
    ];
    const diag = analyzePhashQuality(batch);

    expect(Number.isFinite(diag.dedupeReliability)).toBe(true);
    expect(Number.isFinite(diag.confidenceDistribution.mean)).toBe(true);
    expect(Number.isFinite(diag.confidenceDistribution.min)).toBe(true);
    expect(Number.isFinite(diag.confidenceDistribution.max)).toBe(true);
    expect(Number.isFinite(diag.confidenceDistribution.stdDev)).toBe(true);
    expect(Number.isFinite(diag.perAlgorithm.dct.count)).toBe(true);
    expect(Number.isFinite(diag.perAlgorithm.dct.confidence)).toBe(true);
    expect(Number.isFinite(diag.perAlgorithm.ahash.count)).toBe(true);
    expect(Number.isFinite(diag.perAlgorithm.ahash.confidence)).toBe(true);
  });

  test("dedupeReliability is in [0, 1]", () => {
    for (const candidates of [
      [],
      [dctCandidate("https://j.example/a.jpg")],
      [ahashCandidate("https://j.example/b.jpg")],
      [dctCandidate("https://j.example/c.jpg"), ahashCandidate("https://j.example/d.jpg")],
    ]) {
      const diag = analyzePhashQuality(candidates);
      expect(diag.dedupeReliability).toBeGreaterThanOrEqual(0);
      expect(diag.dedupeReliability).toBeLessThanOrEqual(1);
    }
  });

  test("algorithmMix is one of the three valid values", () => {
    const validMixes: AlgorithmMix[] = ["high-quality", "degraded", "fallback-heavy"];
    for (const candidates of [
      [],
      [dctCandidate("https://j.example/a.jpg")],
      [ahashCandidate("https://j.example/b.jpg")],
      [dctCandidate("https://j.example/c.jpg"), ahashCandidate("https://j.example/d.jpg")],
    ]) {
      const diag = analyzePhashQuality(candidates);
      expect(validMixes).toContain(diag.algorithmMix);
    }
  });

  test("totalCandidates = hashedCount + unhashedCount", () => {
    const batch = [
      dctCandidate("https://j.example/1.jpg"),
      ahashCandidate("https://j.example/2.jpg"),
      unhashedCandidate("https://j.example/3.jpg"),
    ];
    const diag = analyzePhashQuality(batch);
    expect(diag.totalCandidates).toBe(diag.hashedCount + diag.unhashedCount);
  });

  test("perAlgorithm.dct.count + perAlgorithm.ahash.count = hashedCount", () => {
    const batch = [
      dctCandidate("https://j.example/1.jpg"),
      ahashCandidate("https://j.example/2.jpg"),
      bareHashCandidate("https://j.example/3.jpg"),
    ];
    const diag = analyzePhashQuality(batch);
    expect(diag.perAlgorithm.dct.count + diag.perAlgorithm.ahash.count).toBe(diag.hashedCount);
  });

  test("result is JSON-serialisable (no circular refs, no undefined values)", () => {
    const batch = [dctCandidate("https://j.example/x.jpg"), ahashCandidate("https://j.example/y.jpg")];
    const diag = analyzePhashQuality(batch);
    expect(() => JSON.stringify(diag)).not.toThrow();
    const reparsed: PhashDiagnosticsResult = JSON.parse(JSON.stringify(diag));
    expect(reparsed.algorithmMix).toBe(diag.algorithmMix);
    expect(reparsed.dedupeReliability).toBeCloseTo(diag.dedupeReliability, 10);
  });
});

// ---------------------------------------------------------------------------
// algorithmMix boundary conditions
// ---------------------------------------------------------------------------

describe("algorithmMix boundary conditions", () => {
  test("exactly 90% DCT → high-quality", () => {
    // 9 DCT + 1 aHash = 90% DCT
    const batch = [
      ...Array.from({ length: 9 }, (_, i) => dctCandidate(`https://k.example/dct${i}.jpg`)),
      ahashCandidate("https://k.example/ahash0.jpg"),
    ];
    const diag = analyzePhashQuality(batch);
    expect(diag.algorithmMix).toBe("high-quality");
  });

  test("89% DCT (8/9 rounded) → degraded", () => {
    // 8 DCT + 1 aHash ≈ 88.9% → degraded
    const batch = [
      ...Array.from({ length: 8 }, (_, i) => dctCandidate(`https://k.example/dct${i}.jpg`)),
      ahashCandidate("https://k.example/ahash0.jpg"),
    ];
    const diag = analyzePhashQuality(batch);
    expect(diag.algorithmMix).toBe("degraded");
  });

  test("exactly 10% DCT → degraded", () => {
    // 1 DCT + 9 aHash = 10% DCT
    const batch = [
      dctCandidate("https://k.example/dct0.jpg"),
      ...Array.from({ length: 9 }, (_, i) => ahashCandidate(`https://k.example/ahash${i}.jpg`)),
    ];
    const diag = analyzePhashQuality(batch);
    expect(diag.algorithmMix).toBe("degraded");
  });

  test("9% DCT → fallback-heavy", () => {
    // 1 DCT + 10 aHash ≈ 9.1% → fallback-heavy
    const batch = [
      dctCandidate("https://k.example/dct0.jpg"),
      ...Array.from({ length: 10 }, (_, i) => ahashCandidate(`https://k.example/ahash${i}.jpg`)),
    ];
    const diag = analyzePhashQuality(batch);
    expect(diag.algorithmMix).toBe("fallback-heavy");
  });

  test("100% aHash → fallback-heavy", () => {
    const batch = Array.from({ length: 5 }, (_, i) =>
      ahashCandidate(`https://k.example/${i}.jpg`),
    );
    const diag = analyzePhashQuality(batch);
    expect(diag.algorithmMix).toBe("fallback-heavy");
  });
});
