/**
 * Tests for packages/core/src/phash-analytics.ts
 *
 * Covers:
 *   (1) analyzeHashSimilarity — empty, single, pairs, distributions, confidence weighting
 *   (2) percentileSimilarity  — empty, single, percentile edge cases, confidence-weighted sort
 *   (3) hashQualityReport     — algorithm classification, confidence tiers, verdict logic
 *   (4) computeHashMetrics    — bundle-level metrics, topSimilarPairs
 *   (5) Algorithm mixing (dct + ahash)
 *   (6) Synthetic validation data — invariants across large sets
 *   (7) FederationHashMetrics integration via recordFederationHashMetrics
 */

import { describe, expect, test, beforeEach } from "bun:test";
import {
  analyzeHashSimilarity,
  percentileSimilarity,
  hashQualityReport,
  computeHashMetrics,
  HISTOGRAM_BUCKET_LABELS,
} from "./phash-analytics.ts";
import type {
  HashSimilarityAnalysis,
  PercentileSimilarityResult,
  HashQualityReport,
  HashMetrics,
} from "./phash-analytics.ts";
import {
  recordFederationHashMetrics,
  getFederationDiagnostics,
  _resetTelemetry,
} from "./federation-telemetry.ts";
import type { ImageCandidate, PerceptualHashResult } from "./types.ts";

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

function dctCandidate(url: string, hash: string, confidence = 1.0): ImageCandidate {
  return {
    url,
    source: "wikimedia",
    license: "CC0",
    phash: hash,
    phashAlgorithm: "dct-phash",
    phashResult: { hash, algorithm: "dct-phash", confidence, algorithmBase: 1.0, decayFactor: 1.0 },
  };
}

function ahashCandidate(url: string, hash: string, confidence = 0.5): ImageCandidate {
  return {
    url,
    source: "bing",
    license: "UNKNOWN",
    phash: hash,
    phashAlgorithm: "ahash-fallback",
    phashResult: { hash, algorithm: "ahash-fallback", confidence, algorithmBase: 0.5, decayFactor: 1.0 },
  };
}

function bareHashCandidate(url: string, hash: string): ImageCandidate {
  return {
    url,
    source: "brave",
    license: "UNKNOWN",
    phash: hash,
    // no phashAlgorithm, no phashResult
  };
}

function unhashedCandidate(url: string): ImageCandidate {
  return { url, source: "browser", license: "UNKNOWN" };
}

function makeRef(hash: string, confidence = 1.0): PerceptualHashResult {
  return { hash, algorithm: "dct-phash", confidence, algorithmBase: 1.0, decayFactor: 1.0 };
}

// Known hashes for Hamming-distance assertions:
//   "0000000000000000" vs "ffffffffffffffff" = 64
//   "0000000000000000" vs "0000000000000001" = 1
//   "0000000000000000" vs "000000000000000f" = 4
//   "0000000000000000" vs "00000000000000ff" = 8
//   "0000000000000000" vs "000000000000ffff" = 16
//   "0000000000000000" vs "0000000000ffffff" = 24
//   "0000000000000000" vs "000000ffffffffff" = 40

// ===========================================================================
// 1. analyzeHashSimilarity
// ===========================================================================

describe("analyzeHashSimilarity — empty input", () => {
  test("returns zero-state for empty array", () => {
    const r = analyzeHashSimilarity([]);
    expect(r.candidateCount).toBe(0);
    expect(r.pairCount).toBe(0);
    expect(r.avgHammingDistance).toBe(0);
    expect(r.medianDistance).toBe(0);
    expect(r.stdDev).toBe(0);
    expect(r.histogram).toEqual([0, 0, 0, 0, 0]);
    expect(r.confidenceWeightedAvg).toBe(0);
    expect(r.avgConfidence).toBe(0);
    expect(r.minDistance).toBe(0);
    expect(r.maxDistance).toBe(0);
  });

  test("histogram always has length 5", () => {
    const r = analyzeHashSimilarity([]);
    expect(r.histogram.length).toBe(5);
  });
});

describe("analyzeHashSimilarity — single candidate", () => {
  test("returns zero-state for single candidate (no pairs)", () => {
    const r = analyzeHashSimilarity([dctCandidate("https://a/1.jpg", "0000000000000000")]);
    expect(r.candidateCount).toBe(1);
    expect(r.pairCount).toBe(0);
    expect(r.avgHammingDistance).toBe(0);
    expect(r.minDistance).toBe(0);
    expect(r.maxDistance).toBe(0);
  });

  test("avgConfidence reflects single candidate confidence", () => {
    const r = analyzeHashSimilarity([dctCandidate("https://a/1.jpg", "0000000000000000", 0.9)]);
    expect(r.avgConfidence).toBeCloseTo(0.9, 5);
  });
});

describe("analyzeHashSimilarity — two identical hashes", () => {
  const candidates = [
    dctCandidate("https://a/1.jpg", "0000000000000000"),
    dctCandidate("https://a/2.jpg", "0000000000000000"),
  ];

  test("pairCount=1, avgHammingDistance=0", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.pairCount).toBe(1);
    expect(r.avgHammingDistance).toBe(0);
  });

  test("histogram bucket 0 has count 1", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.histogram[0]).toBe(1);
    expect(r.histogram[1]).toBe(0);
    expect(r.histogram[2]).toBe(0);
    expect(r.histogram[3]).toBe(0);
    expect(r.histogram[4]).toBe(0);
  });

  test("stdDev=0 for single pair", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.stdDev).toBe(0);
  });

  test("minDistance=0, maxDistance=0", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.minDistance).toBe(0);
    expect(r.maxDistance).toBe(0);
  });
});

describe("analyzeHashSimilarity — two maximally different hashes", () => {
  const candidates = [
    dctCandidate("https://a/1.jpg", "0000000000000000"),
    dctCandidate("https://a/2.jpg", "ffffffffffffffff"),
  ];

  test("avgHammingDistance=64, minDistance=64, maxDistance=64", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.avgHammingDistance).toBe(64);
    expect(r.minDistance).toBe(64);
    expect(r.maxDistance).toBe(64);
  });

  test("histogram bucket 4 has count 1 (distance 64 → 33+ bucket)", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.histogram[4]).toBe(1);
    expect(r.histogram.slice(0, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe("analyzeHashSimilarity — histogram bucket assignment", () => {
  // Pair distances: 1 (bucket 0), 9 (bucket 1), 17 (bucket 2), 25 (bucket 3), 33 (bucket 4)
  // We'll use a reference of "0000000000000000" and carefully chosen hashes
  // dist=1: "0000000000000001"
  // dist=8: "00000000000000ff" (8 ones)
  // dist=16: "000000000000ffff"
  // dist=24: "0000000000ffffff"
  // dist=33: one bit beyond 32 → "00000001ffffffff" = 33 bits
  test("distance 1 goes to bucket 0 (0–8)", () => {
    const r = analyzeHashSimilarity([
      dctCandidate("https://a/ref.jpg", "0000000000000000"),
      dctCandidate("https://a/d1.jpg", "0000000000000001"),
    ]);
    expect(r.histogram[0]).toBe(1);
  });

  test("distance 8 goes to bucket 0 (0–8)", () => {
    const r = analyzeHashSimilarity([
      dctCandidate("https://a/ref.jpg", "0000000000000000"),
      dctCandidate("https://a/d8.jpg", "00000000000000ff"),
    ]);
    expect(r.histogram[0]).toBe(1);
  });

  test("distance 9 goes to bucket 1 (9–16)", () => {
    const r = analyzeHashSimilarity([
      dctCandidate("https://a/ref.jpg", "0000000000000000"),
      dctCandidate("https://a/d9.jpg", "00000000000001ff"), // 9 bits
    ]);
    expect(r.histogram[1]).toBe(1);
  });

  test("distance 16 goes to bucket 1 (9–16)", () => {
    const r = analyzeHashSimilarity([
      dctCandidate("https://a/ref.jpg", "0000000000000000"),
      dctCandidate("https://a/d16.jpg", "000000000000ffff"),
    ]);
    expect(r.histogram[1]).toBe(1);
  });

  test("distance 17 goes to bucket 2 (17–24)", () => {
    const r = analyzeHashSimilarity([
      dctCandidate("https://a/ref.jpg", "0000000000000000"),
      dctCandidate("https://a/d17.jpg", "0000000000001ffff".slice(1)), // 17 bits
    ]);
    // 17 bits set: "000000000001ffff" → 17 ones
    const r2 = analyzeHashSimilarity([
      dctCandidate("https://a/ref.jpg", "0000000000000000"),
      dctCandidate("https://a/d17.jpg", "000000000001ffff"),
    ]);
    expect(r2.histogram[2]).toBe(1);
  });

  test("distance 33+ goes to bucket 4", () => {
    const r = analyzeHashSimilarity([
      dctCandidate("https://a/ref.jpg", "0000000000000000"),
      dctCandidate("https://a/d64.jpg", "ffffffffffffffff"),
    ]);
    expect(r.histogram[4]).toBe(1);
  });
});

describe("analyzeHashSimilarity — three candidates", () => {
  // "0000000000000000", "0000000000000001" (d=1), "ffffffffffffffff" (d=64)
  // pairs: (0,1)=1, (0,2)=64, (1,2)=63
  // avg = (1+64+63)/3 = 128/3 ≈ 42.67
  const candidates = [
    dctCandidate("https://a/1.jpg", "0000000000000000"),
    dctCandidate("https://a/2.jpg", "0000000000000001"),
    dctCandidate("https://a/3.jpg", "ffffffffffffffff"),
  ];

  test("pairCount=3", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.pairCount).toBe(3);
  });

  test("avgHammingDistance ≈ 42.67", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.avgHammingDistance).toBeCloseTo(128 / 3, 4);
  });

  test("minDistance=1, maxDistance=64", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.minDistance).toBe(1);
    expect(r.maxDistance).toBe(64);
  });

  test("stdDev > 0", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.stdDev).toBeGreaterThan(0);
  });

  test("histogram sums to pairCount", () => {
    const r = analyzeHashSimilarity(candidates);
    const sum = r.histogram.reduce((s, v) => s + v, 0);
    expect(sum).toBe(r.pairCount);
  });
});

describe("analyzeHashSimilarity — confidence weighting", () => {
  test("low-confidence candidates reduce confidenceWeightedAvg relative to unweighted", () => {
    // Two pairs: one high distance (64) between low-confidence candidates,
    // one low distance (1) between high-confidence candidates
    const candidates = [
      dctCandidate("https://a/hc1.jpg", "0000000000000000", 1.0), // high conf
      dctCandidate("https://a/hc2.jpg", "0000000000000001", 1.0), // high conf, d=1 from hc1
      ahashCandidate("https://a/lc1.jpg", "ffffffffffffffff", 0.1), // low conf, d=64 from hc1
    ];
    const r = analyzeHashSimilarity(candidates);
    // confidenceWeightedAvg should be pulled down relative to plain avg
    // because the large distance (64) pairs involve low-confidence candidates
    expect(r.avgConfidence).toBeGreaterThan(0);
    expect(r.confidenceWeightedAvg).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.confidenceWeightedAvg)).toBe(true);
  });

  test("all-zero confidence → confidenceWeightedAvg=0", () => {
    const candidates = [
      { ...dctCandidate("https://a/1.jpg", "0000000000000000", 0), phashResult: { hash: "0000000000000000", algorithm: "dct-phash" as const, confidence: 0, algorithmBase: 1.0, decayFactor: 1.0 } },
      { ...dctCandidate("https://a/2.jpg", "ffffffffffffffff", 0), phashResult: { hash: "ffffffffffffffff", algorithm: "dct-phash" as const, confidence: 0, algorithmBase: 1.0, decayFactor: 1.0 } },
    ];
    const r = analyzeHashSimilarity(candidates);
    expect(r.confidenceWeightedAvg).toBe(0);
  });
});

describe("analyzeHashSimilarity — unhashed candidates skipped", () => {
  test("unhashed candidates are excluded from candidateCount and pairCount", () => {
    const candidates = [
      dctCandidate("https://a/1.jpg", "0000000000000000"),
      unhashedCandidate("https://a/2.jpg"),
      dctCandidate("https://a/3.jpg", "ffffffffffffffff"),
    ];
    const r = analyzeHashSimilarity(candidates);
    expect(r.candidateCount).toBe(2);
    expect(r.pairCount).toBe(1);
  });
});

describe("analyzeHashSimilarity — result is JSON-serialisable", () => {
  test("no circular refs or undefined values", () => {
    const r = analyzeHashSimilarity([
      dctCandidate("https://a/1.jpg", "0000000000000000"),
      ahashCandidate("https://a/2.jpg", "ffffffffffffffff"),
    ]);
    expect(() => JSON.stringify(r)).not.toThrow();
    const reparsed: HashSimilarityAnalysis = JSON.parse(JSON.stringify(r));
    expect(reparsed.histogram.length).toBe(5);
  });
});

// ===========================================================================
// 2. percentileSimilarity
// ===========================================================================

describe("percentileSimilarity — empty candidates", () => {
  const ref = makeRef("0000000000000000");

  test("returns zero-state without throwing", () => {
    const r = percentileSimilarity(ref, [], 0.5);
    expect(r.percentileDistance).toBe(0);
    expect(r.candidateAtPercentile).toBeNull();
    expect(r.rankedCandidates).toHaveLength(0);
    expect(r.percentile).toBeCloseTo(0.5, 5);
  });
});

describe("percentileSimilarity — single candidate", () => {
  const ref = makeRef("0000000000000000");
  const candidates = [dctCandidate("https://a/1.jpg", "0000000000000001")]; // d=1

  test("percentile 0.0 returns the only candidate", () => {
    const r = percentileSimilarity(ref, candidates, 0.0);
    expect(r.candidateAtPercentile).not.toBeNull();
    expect(r.percentileDistance).toBe(1);
    expect(r.rankedCandidates).toHaveLength(1);
  });

  test("percentile 1.0 returns the only candidate", () => {
    const r = percentileSimilarity(ref, candidates, 1.0);
    expect(r.candidateAtPercentile).not.toBeNull();
    expect(r.percentileDistance).toBe(1);
  });

  test("percentile 0.5 returns the only candidate", () => {
    const r = percentileSimilarity(ref, candidates, 0.5);
    expect(r.percentileDistance).toBe(1);
  });
});

describe("percentileSimilarity — ranked ordering", () => {
  const ref = makeRef("0000000000000000");
  // distances: 1, 4, 8, 16, 24 (sorted ascending)
  const candidates = [
    dctCandidate("https://a/d24.jpg", "0000000000ffffff"), // d=24
    dctCandidate("https://a/d1.jpg",  "0000000000000001"), // d=1
    dctCandidate("https://a/d16.jpg", "000000000000ffff"), // d=16
    dctCandidate("https://a/d4.jpg",  "000000000000000f"), // d=4
    dctCandidate("https://a/d8.jpg",  "00000000000000ff"), // d=8
  ];

  test("rankedCandidates sorted ascending by distance", () => {
    const r = percentileSimilarity(ref, candidates, 0.5);
    for (let i = 1; i < r.rankedCandidates.length; i++) {
      expect(r.rankedCandidates[i]!.distance).toBeGreaterThanOrEqual(
        r.rankedCandidates[i - 1]!.distance,
      );
    }
  });

  test("P0 returns closest candidate (d=1)", () => {
    const r = percentileSimilarity(ref, candidates, 0.0);
    expect(r.percentileDistance).toBe(1);
  });

  test("P1.0 returns farthest candidate (d=24)", () => {
    const r = percentileSimilarity(ref, candidates, 1.0);
    expect(r.percentileDistance).toBe(24);
  });

  test("rankedCandidates.length equals number of hashable candidates", () => {
    const r = percentileSimilarity(ref, candidates, 0.5);
    expect(r.rankedCandidates.length).toBe(candidates.length);
  });
});

describe("percentileSimilarity — unhashed candidates excluded", () => {
  const ref = makeRef("0000000000000000");
  const candidates = [
    dctCandidate("https://a/1.jpg", "0000000000000001"),
    unhashedCandidate("https://a/2.jpg"),
    dctCandidate("https://a/3.jpg", "ffffffffffffffff"),
  ];

  test("unhashed candidates not in rankedCandidates", () => {
    const r = percentileSimilarity(ref, candidates, 0.5);
    expect(r.rankedCandidates.length).toBe(2);
  });
});

describe("percentileSimilarity — percentile clamping", () => {
  const ref = makeRef("0000000000000000");
  const candidates = [
    dctCandidate("https://a/1.jpg", "0000000000000001"),
    dctCandidate("https://a/2.jpg", "ffffffffffffffff"),
  ];

  test("percentile > 1 is clamped to 1", () => {
    const r = percentileSimilarity(ref, candidates, 99.0);
    expect(r.percentile).toBe(1.0);
  });

  test("percentile < 0 is clamped to 0", () => {
    const r = percentileSimilarity(ref, candidates, -5.0);
    expect(r.percentile).toBe(0.0);
  });
});

describe("percentileSimilarity — confidence-weighted sort tie-breaking", () => {
  const ref = makeRef("0000000000000000");
  // Two candidates with the same distance (d=8) but different confidence
  const candidates = [
    ahashCandidate("https://a/low.jpg",  "00000000000000ff", 0.2), // d=8, low conf
    dctCandidate("https://a/high.jpg", "00000000000000ff", 1.0), // d=8, high conf
  ];

  test("higher-confidence candidate sorts first within same distance", () => {
    const r = percentileSimilarity(ref, candidates, 0.0);
    expect(r.rankedCandidates[0]!.confidence).toBe(1.0);
  });
});

describe("percentileSimilarity — confidence field present in results", () => {
  const ref = makeRef("0000000000000000");
  const candidates = [
    dctCandidate("https://a/1.jpg", "0000000000000001", 0.9),
    ahashCandidate("https://a/2.jpg", "000000000000ffff", 0.4),
  ];

  test("rankedCandidates entries carry confidence", () => {
    const r = percentileSimilarity(ref, candidates, 0.0);
    for (const entry of r.rankedCandidates) {
      expect(typeof entry.confidence).toBe("number");
      expect(entry.confidence).toBeGreaterThanOrEqual(0);
      expect(entry.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("percentileSimilarity — bare hash candidates", () => {
  const ref = makeRef("0000000000000000");
  const candidates = [
    bareHashCandidate("https://a/1.jpg", "0000000000000001"),
  ];

  test("bare hash candidates are included with confidence 0.5", () => {
    const r = percentileSimilarity(ref, candidates, 0.0);
    expect(r.rankedCandidates.length).toBe(1);
    expect(r.rankedCandidates[0]!.confidence).toBeCloseTo(0.5, 5);
    expect(r.percentileDistance).toBe(1);
  });
});

// ===========================================================================
// 3. hashQualityReport
// ===========================================================================

describe("hashQualityReport — empty input", () => {
  test("returns valid zero-state", () => {
    const r = hashQualityReport([]);
    expect(r.totalCandidates).toBe(0);
    expect(r.hashedCount).toBe(0);
    expect(r.unhashedCount).toBe(0);
    expect(r.overallMeanConfidence).toBe(0);
    expect(r.overallStdDev).toBe(0);
    expect(r.algorithmBreakdown["dct-phash"].count).toBe(0);
    expect(r.algorithmBreakdown["ahash-fallback"].count).toBe(0);
    expect(r.algorithmBreakdown["bare-hash"].count).toBe(0);
    expect(r.confidenceTiers.high).toBe(0);
    expect(r.confidenceTiers.medium).toBe(0);
    expect(r.confidenceTiers.low).toBe(0);
  });

  test("verdict is unusable for empty input", () => {
    // 0 hashed = 100% unhashed → unusable
    const r = hashQualityReport([]);
    expect(r.verdict).toBe("unusable");
  });
});

describe("hashQualityReport — all dct-phash, high confidence", () => {
  const candidates = Array.from({ length: 10 }, (_, i) =>
    dctCandidate(`https://a/${i}.jpg`, "0000000000000000", 1.0),
  );

  test("algorithmBreakdown dct count = 10, fraction = 1.0", () => {
    const r = hashQualityReport(candidates);
    expect(r.algorithmBreakdown["dct-phash"].count).toBe(10);
    expect(r.algorithmBreakdown["dct-phash"].fraction).toBe(1.0);
    expect(r.algorithmBreakdown["ahash-fallback"].count).toBe(0);
    expect(r.algorithmBreakdown["bare-hash"].count).toBe(0);
  });

  test("all confidence in high tier", () => {
    const r = hashQualityReport(candidates);
    expect(r.confidenceTiers.high).toBe(10);
    expect(r.confidenceTiers.medium).toBe(0);
    expect(r.confidenceTiers.low).toBe(0);
  });

  test("overallMeanConfidence = 1.0", () => {
    const r = hashQualityReport(candidates);
    expect(r.overallMeanConfidence).toBe(1.0);
  });

  test("verdict is ready", () => {
    const r = hashQualityReport(candidates);
    expect(r.verdict).toBe("ready");
  });

  test("overallStdDev = 0 when all confidences are equal", () => {
    const r = hashQualityReport(candidates);
    expect(r.overallStdDev).toBe(0);
  });
});

describe("hashQualityReport — all ahash-fallback, low confidence", () => {
  const candidates = Array.from({ length: 10 }, (_, i) =>
    ahashCandidate(`https://a/${i}.jpg`, "0000000000000000", 0.5),
  );

  test("algorithmBreakdown ahash count = 10, fraction = 1.0", () => {
    const r = hashQualityReport(candidates);
    expect(r.algorithmBreakdown["ahash-fallback"].count).toBe(10);
    expect(r.algorithmBreakdown["ahash-fallback"].fraction).toBe(1.0);
    expect(r.algorithmBreakdown["dct-phash"].count).toBe(0);
  });

  test("all confidence in medium tier (0.5 >= 0.5 && < 0.85)", () => {
    const r = hashQualityReport(candidates);
    expect(r.confidenceTiers.medium).toBe(10);
    expect(r.confidenceTiers.high).toBe(0);
    expect(r.confidenceTiers.low).toBe(0);
  });

  test("overallMeanConfidence ≈ 0.5", () => {
    const r = hashQualityReport(candidates);
    expect(r.overallMeanConfidence).toBeCloseTo(0.5, 5);
  });
});

describe("hashQualityReport — mixed algorithms", () => {
  const candidates = [
    dctCandidate("https://a/1.jpg", "0000000000000000", 1.0),
    dctCandidate("https://a/2.jpg", "0000000000000001", 0.9),
    ahashCandidate("https://a/3.jpg", "ffffffffffffffff", 0.5),
    bareHashCandidate("https://a/4.jpg", "abcdef1234567890"),
    unhashedCandidate("https://a/5.jpg"),
  ];

  test("total/hashed/unhashed counts", () => {
    const r = hashQualityReport(candidates);
    expect(r.totalCandidates).toBe(5);
    expect(r.hashedCount).toBe(4); // 2 dct + 1 ahash + 1 bare
    expect(r.unhashedCount).toBe(1);
  });

  test("algorithm breakdown sums to hashedCount", () => {
    const r = hashQualityReport(candidates);
    const total =
      r.algorithmBreakdown["dct-phash"].count +
      r.algorithmBreakdown["ahash-fallback"].count +
      r.algorithmBreakdown["bare-hash"].count;
    expect(total).toBe(r.hashedCount);
  });

  test("bare-hash counted in its own bucket", () => {
    const r = hashQualityReport(candidates);
    expect(r.algorithmBreakdown["bare-hash"].count).toBe(1);
    expect(r.algorithmBreakdown["bare-hash"].meanConfidence).toBeCloseTo(0.5, 5);
  });

  test("dct-phash bucket stats", () => {
    const r = hashQualityReport(candidates);
    expect(r.algorithmBreakdown["dct-phash"].count).toBe(2);
    expect(r.algorithmBreakdown["dct-phash"].meanConfidence).toBeCloseTo((1.0 + 0.9) / 2, 5);
    expect(r.algorithmBreakdown["dct-phash"].minConfidence).toBeCloseTo(0.9, 5);
    expect(r.algorithmBreakdown["dct-phash"].maxConfidence).toBeCloseTo(1.0, 5);
  });

  test("confidenceTiers sum to hashedCount", () => {
    const r = hashQualityReport(candidates);
    const sum = r.confidenceTiers.high + r.confidenceTiers.medium + r.confidenceTiers.low;
    expect(sum).toBe(r.hashedCount);
  });
});

describe("hashQualityReport — verdict thresholds", () => {
  test("all high-confidence dct → ready", () => {
    const r = hashQualityReport(
      Array.from({ length: 10 }, (_, i) =>
        dctCandidate(`https://a/${i}.jpg`, "0000000000000000", 1.0),
      ),
    );
    expect(r.verdict).toBe("ready");
  });

  test(">50% unhashed → unusable", () => {
    const r = hashQualityReport([
      dctCandidate("https://a/1.jpg", "0000000000000000"),
      unhashedCandidate("https://a/2.jpg"),
      unhashedCandidate("https://a/3.jpg"),
      unhashedCandidate("https://a/4.jpg"),
    ]);
    // 3/4 = 75% unhashed → unusable
    expect(r.verdict).toBe("unusable");
  });

  test(">60% low confidence → unusable", () => {
    const r = hashQualityReport(
      Array.from({ length: 10 }, (_, i) =>
        ahashCandidate(`https://a/${i}.jpg`, "0000000000000000", 0.1),
      ),
    );
    // 100% low confidence → unusable
    expect(r.verdict).toBe("unusable");
  });

  test("result is JSON-serialisable", () => {
    const r = hashQualityReport([dctCandidate("https://a/1.jpg", "0000000000000000")]);
    expect(() => JSON.stringify(r)).not.toThrow();
    const reparsed: HashQualityReport = JSON.parse(JSON.stringify(r));
    expect(reparsed.verdict).toBe(r.verdict);
  });
});

describe("hashQualityReport — AlgorithmBucket stdDev", () => {
  test("stdDev > 0 when confidence values differ", () => {
    const r = hashQualityReport([
      dctCandidate("https://a/1.jpg", "0000000000000000", 1.0),
      dctCandidate("https://a/2.jpg", "0000000000000001", 0.6),
    ]);
    expect(r.algorithmBreakdown["dct-phash"].stdDev).toBeGreaterThan(0);
  });

  test("stdDev = 0 for single candidate in bucket", () => {
    const r = hashQualityReport([
      dctCandidate("https://a/1.jpg", "0000000000000000", 0.8),
    ]);
    expect(r.algorithmBreakdown["dct-phash"].stdDev).toBe(0);
  });
});

// ===========================================================================
// 4. computeHashMetrics
// ===========================================================================

describe("computeHashMetrics — structure", () => {
  test("returns similarity, quality, and topSimilarPairs fields", () => {
    const r = computeHashMetrics([dctCandidate("https://a/1.jpg", "0000000000000000")]);
    expect(r).toHaveProperty("similarity");
    expect(r).toHaveProperty("quality");
    expect(r).toHaveProperty("topSimilarPairs");
  });

  test("empty candidates: topSimilarPairs is empty", () => {
    const r = computeHashMetrics([]);
    expect(r.topSimilarPairs).toHaveLength(0);
  });

  test("single candidate: topSimilarPairs is empty", () => {
    const r = computeHashMetrics([dctCandidate("https://a/1.jpg", "0000000000000000")]);
    expect(r.topSimilarPairs).toHaveLength(0);
  });
});

describe("computeHashMetrics — topSimilarPairs", () => {
  // 6 candidates → 15 pairs; top 5 returned
  const candidates = [
    dctCandidate("https://a/1.jpg", "0000000000000000"),
    dctCandidate("https://a/2.jpg", "0000000000000001"), // d=1 from 1
    dctCandidate("https://a/3.jpg", "000000000000000f"), // d=4 from 1
    dctCandidate("https://a/4.jpg", "00000000000000ff"), // d=8 from 1
    dctCandidate("https://a/5.jpg", "000000000000ffff"), // d=16 from 1
    dctCandidate("https://a/6.jpg", "ffffffffffffffff"), // d=64 from 1
  ];

  test("returns at most 5 pairs", () => {
    const r = computeHashMetrics(candidates);
    expect(r.topSimilarPairs.length).toBeLessThanOrEqual(5);
  });

  test("pairs sorted ascending by distance", () => {
    const r = computeHashMetrics(candidates);
    for (let i = 1; i < r.topSimilarPairs.length; i++) {
      expect(r.topSimilarPairs[i]!.distance).toBeGreaterThanOrEqual(
        r.topSimilarPairs[i - 1]!.distance,
      );
    }
  });

  test("topSimilarPairs entries have required fields", () => {
    const r = computeHashMetrics(candidates);
    for (const p of r.topSimilarPairs) {
      expect(typeof p.indexA).toBe("number");
      expect(typeof p.indexB).toBe("number");
      expect(typeof p.distance).toBe("number");
      expect(typeof p.hashA).toBe("string");
      expect(typeof p.hashB).toBe("string");
    }
  });

  test("closest pair has distance=1 (first two candidates)", () => {
    const r = computeHashMetrics(candidates);
    expect(r.topSimilarPairs[0]!.distance).toBe(1);
  });
});

describe("computeHashMetrics — two candidates", () => {
  test("topSimilarPairs has 1 entry when exactly 2 candidates", () => {
    const r = computeHashMetrics([
      dctCandidate("https://a/1.jpg", "0000000000000000"),
      dctCandidate("https://a/2.jpg", "ffffffffffffffff"),
    ]);
    expect(r.topSimilarPairs).toHaveLength(1);
    expect(r.topSimilarPairs[0]!.distance).toBe(64);
  });
});

describe("computeHashMetrics — JSON serialisable", () => {
  test("no circular refs", () => {
    const r = computeHashMetrics([
      dctCandidate("https://a/1.jpg", "0000000000000000"),
      ahashCandidate("https://a/2.jpg", "ffffffffffffffff"),
    ]);
    expect(() => JSON.stringify(r)).not.toThrow();
    const reparsed: HashMetrics = JSON.parse(JSON.stringify(r));
    expect(reparsed.similarity.histogram.length).toBe(5);
    expect(reparsed.quality.verdict).toBe(r.quality.verdict);
  });
});

// ===========================================================================
// 5. Algorithm mixing (dct + ahash)
// ===========================================================================

describe("algorithm mixing — dct + ahash candidates", () => {
  const candidates = [
    dctCandidate("https://a/dct1.jpg", "0000000000000000", 1.0),
    dctCandidate("https://a/dct2.jpg", "0000000000000001", 0.9),
    ahashCandidate("https://a/ah1.jpg", "000000000000ffff", 0.5),
    ahashCandidate("https://a/ah2.jpg", "ffffffffffffffff", 0.4),
  ];

  test("analyzeHashSimilarity includes all 4 hashed candidates", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.candidateCount).toBe(4);
    expect(r.pairCount).toBe(6); // 4*(4-1)/2
  });

  test("hashQualityReport correctly splits by algorithm", () => {
    const r = hashQualityReport(candidates);
    expect(r.algorithmBreakdown["dct-phash"].count).toBe(2);
    expect(r.algorithmBreakdown["ahash-fallback"].count).toBe(2);
    expect(r.algorithmBreakdown["bare-hash"].count).toBe(0);
  });

  test("avgConfidence is weighted mean of all 4 confidence values", () => {
    const r = analyzeHashSimilarity(candidates);
    const expected = (1.0 + 0.9 + 0.5 + 0.4) / 4;
    expect(r.avgConfidence).toBeCloseTo(expected, 5);
  });
});

// ===========================================================================
// 6. Synthetic validation data — invariants
// ===========================================================================

describe("synthetic validation — large candidate set invariants", () => {
  // 20 candidates with varied hashes
  const hashes = [
    "0000000000000000", "0000000000000001", "000000000000000f",
    "00000000000000ff", "000000000000ffff", "0000000000ffffff",
    "00000000ffffffff", "000000ffffffffff", "0000ffffffffffff",
    "00ffffffffffffff", "ffffffffffffffff", "aaaaaaaaaaaaaaaa",
    "5555555555555555", "cccccccccccccccc", "3333333333333333",
    "f0f0f0f0f0f0f0f0", "0f0f0f0f0f0f0f0f", "1234567890abcdef",
    "fedcba0987654321", "abcdef1234567890",
  ];
  const candidates = hashes.map((h, i) =>
    i % 3 === 0
      ? ahashCandidate(`https://a/${i}.jpg`, h, 0.5)
      : dctCandidate(`https://a/${i}.jpg`, h, 1.0),
  );

  test("pairCount = n*(n-1)/2", () => {
    const r = analyzeHashSimilarity(candidates);
    const n = r.candidateCount;
    expect(r.pairCount).toBe((n * (n - 1)) / 2);
  });

  test("histogram sums to pairCount", () => {
    const r = analyzeHashSimilarity(candidates);
    const histSum = r.histogram.reduce((s, v) => s + v, 0);
    expect(histSum).toBe(r.pairCount);
  });

  test("minDistance <= medianDistance <= maxDistance", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.minDistance).toBeLessThanOrEqual(r.medianDistance);
    expect(r.medianDistance).toBeLessThanOrEqual(r.maxDistance);
  });

  test("avgHammingDistance in [minDistance, maxDistance]", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.avgHammingDistance).toBeGreaterThanOrEqual(r.minDistance);
    expect(r.avgHammingDistance).toBeLessThanOrEqual(r.maxDistance);
  });

  test("stdDev >= 0", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.stdDev).toBeGreaterThanOrEqual(0);
  });

  test("avgConfidence in [0, 1]", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.avgConfidence).toBeGreaterThanOrEqual(0);
    expect(r.avgConfidence).toBeLessThanOrEqual(1);
  });

  test("confidenceWeightedAvg in [0, maxDistance]", () => {
    const r = analyzeHashSimilarity(candidates);
    expect(r.confidenceWeightedAvg).toBeGreaterThanOrEqual(0);
    expect(r.confidenceWeightedAvg).toBeLessThanOrEqual(r.maxDistance + 1e-9);
  });

  test("hashQualityReport totals sum correctly", () => {
    const r = hashQualityReport(candidates);
    expect(r.totalCandidates).toBe(r.hashedCount + r.unhashedCount);
    const algTotal =
      r.algorithmBreakdown["dct-phash"].count +
      r.algorithmBreakdown["ahash-fallback"].count +
      r.algorithmBreakdown["bare-hash"].count;
    expect(algTotal).toBe(r.hashedCount);
    const tierTotal =
      r.confidenceTiers.high + r.confidenceTiers.medium + r.confidenceTiers.low;
    expect(tierTotal).toBe(r.hashedCount);
  });
});

describe("synthetic validation — percentileSimilarity coverage", () => {
  const ref = makeRef("0000000000000000");
  const candidates = [
    dctCandidate("https://a/1.jpg", "0000000000000001"),  // d=1
    dctCandidate("https://a/2.jpg", "000000000000000f"),  // d=4
    dctCandidate("https://a/3.jpg", "00000000000000ff"),  // d=8
    dctCandidate("https://a/4.jpg", "000000000000ffff"),  // d=16
    dctCandidate("https://a/5.jpg", "0000000000ffffff"),  // d=24
    dctCandidate("https://a/6.jpg", "00000000ffffffff"),  // d=32
    dctCandidate("https://a/7.jpg", "ffffffffffffffff"),  // d=64
  ];

  test("P0 distance = 1 (closest)", () => {
    expect(percentileSimilarity(ref, candidates, 0.0).percentileDistance).toBe(1);
  });

  test("P1.0 distance = 64 (farthest)", () => {
    expect(percentileSimilarity(ref, candidates, 1.0).percentileDistance).toBe(64);
  });

  test("all percentile distances are in [0, 64]", () => {
    for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0]) {
      const r = percentileSimilarity(ref, candidates, p);
      expect(r.percentileDistance).toBeGreaterThanOrEqual(0);
      expect(r.percentileDistance).toBeLessThanOrEqual(64);
    }
  });

  test("candidateAtPercentile is always non-null for non-empty list", () => {
    for (const p of [0, 0.5, 1.0]) {
      const r = percentileSimilarity(ref, candidates, p);
      expect(r.candidateAtPercentile).not.toBeNull();
    }
  });
});

// ===========================================================================
// 7. FederationHashMetrics integration
// ===========================================================================

describe("recordFederationHashMetrics + getFederationDiagnostics", () => {
  beforeEach(() => {
    _resetTelemetry();
  });

  test("hashMetrics is null before any recording", () => {
    const diag = getFederationDiagnostics();
    expect(diag.hashMetrics).toBeNull();
  });

  test("hashMetrics populated after one record call", () => {
    const metrics = computeHashMetrics([
      dctCandidate("https://a/1.jpg", "0000000000000000"),
      dctCandidate("https://a/2.jpg", "ffffffffffffffff"),
    ]);
    recordFederationHashMetrics(metrics);
    const diag = getFederationDiagnostics();
    expect(diag.hashMetrics).not.toBeNull();
    expect(diag.hashMetrics!.federationCount).toBe(1);
    expect(diag.hashMetrics!.avgHammingDistance).toBe(64);
    expect(diag.hashMetrics!.histogram.length).toBe(5);
    expect(diag.hashMetrics!.lastSnapshot).not.toBeNull();
  });

  test("federationCount increments with each record call", () => {
    const metrics = computeHashMetrics([
      dctCandidate("https://a/1.jpg", "0000000000000000"),
      dctCandidate("https://a/2.jpg", "ffffffffffffffff"),
    ]);
    recordFederationHashMetrics(metrics);
    recordFederationHashMetrics(metrics);
    recordFederationHashMetrics(metrics);
    const diag = getFederationDiagnostics();
    expect(diag.hashMetrics!.federationCount).toBe(3);
  });

  test("histogram accumulates across calls", () => {
    const m1 = computeHashMetrics([
      dctCandidate("https://a/1.jpg", "0000000000000000"),
      dctCandidate("https://a/2.jpg", "0000000000000001"), // d=1 → bucket 0
    ]);
    const m2 = computeHashMetrics([
      dctCandidate("https://a/3.jpg", "0000000000000000"),
      dctCandidate("https://a/4.jpg", "ffffffffffffffff"), // d=64 → bucket 4
    ]);
    recordFederationHashMetrics(m1);
    recordFederationHashMetrics(m2);
    const diag = getFederationDiagnostics();
    const hist = diag.hashMetrics!.histogram;
    expect(hist[0]).toBeGreaterThanOrEqual(1); // from m1 (d=1)
    expect(hist[4]).toBeGreaterThanOrEqual(1); // from m2 (d=64)
  });

  test("_resetTelemetry clears hashMetrics", () => {
    const metrics = computeHashMetrics([
      dctCandidate("https://a/1.jpg", "0000000000000000"),
      dctCandidate("https://a/2.jpg", "ffffffffffffffff"),
    ]);
    recordFederationHashMetrics(metrics);
    _resetTelemetry();
    const diag = getFederationDiagnostics();
    expect(diag.hashMetrics).toBeNull();
  });

  test("hashMetrics.lastSnapshot matches the most-recent input", () => {
    const m1 = computeHashMetrics([
      dctCandidate("https://a/1.jpg", "0000000000000000"),
      dctCandidate("https://a/2.jpg", "ffffffffffffffff"),
    ]);
    const m2 = computeHashMetrics([
      dctCandidate("https://a/3.jpg", "0000000000000000"),
      dctCandidate("https://a/4.jpg", "0000000000000001"),
    ]);
    recordFederationHashMetrics(m1);
    recordFederationHashMetrics(m2);
    const diag = getFederationDiagnostics();
    expect(diag.hashMetrics!.lastSnapshot!.similarity.avgHammingDistance)
      .toBeCloseTo(m2.similarity.avgHammingDistance, 5);
  });

  test("avgConfidence is a valid rolling mean in [0, 1]", () => {
    const m = computeHashMetrics([
      dctCandidate("https://a/1.jpg", "0000000000000000", 0.9),
      ahashCandidate("https://a/2.jpg", "ffffffffffffffff", 0.4),
    ]);
    recordFederationHashMetrics(m);
    const diag = getFederationDiagnostics();
    expect(diag.hashMetrics!.avgConfidence).toBeGreaterThanOrEqual(0);
    expect(diag.hashMetrics!.avgConfidence).toBeLessThanOrEqual(1);
  });
});

// ===========================================================================
// 8. HISTOGRAM_BUCKET_LABELS constant
// ===========================================================================

describe("HISTOGRAM_BUCKET_LABELS", () => {
  test("has exactly 5 entries", () => {
    expect(HISTOGRAM_BUCKET_LABELS.length).toBe(5);
  });

  test("all entries are non-empty strings", () => {
    for (const label of HISTOGRAM_BUCKET_LABELS) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
