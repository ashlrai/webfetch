/**
 * Tests for federation-wide pHash duplicate cluster detection,
 * confidence anomaly detection, and audit report generation.
 *
 * Covers:
 *   1.  detectFederationDuplicateClusters — basic cluster formation
 *   2.  detectFederationDuplicateClusters — multiProviderOnly filter
 *   3.  detectFederationDuplicateClusters — single provider (no cross-provider pairs)
 *   4.  detectFederationDuplicateClusters — all UNKNOWN confidence
 *   5.  detectFederationDuplicateClusters — mixed algorithms
 *   6.  detectFederationDuplicateClusters — edge case: 0 or 1 candidates
 *   7.  detectFederationDuplicateClusters — threshold tuning (tight vs loose)
 *   8.  detectConfidenceAnomalies — high delta triggers anomaly
 *   9.  detectConfidenceAnomalies — low delta does not trigger
 *   10. detectConfidenceAnomalies — all UNKNOWN license anomaly path
 *   11. detectConfidenceAnomalies — mixed algorithm candidates
 *   12. buildFederationPhashAuditReport — report shape invariants
 *   13. buildFederationPhashAuditReport — provider agreement matrix correctness
 *   14. buildFederationPhashAuditReport — threshold tuning guide correctness
 *   15. buildFederationPhashAuditReport — recommendations generated
 *   16. buildFederationPhashAuditReport — empty candidates returns valid zero-state
 *   17. buildFederationPhashAuditReport — stable (no throw) across synthetic datasets
 */

import { describe, expect, test } from "bun:test";
import {
  buildFederationPhashAuditReport,
  detectConfidenceAnomalies,
  detectFederationDuplicateClusters,
} from "../packages/core/src/phash-analytics.ts";
import type {
  ConfidenceAnomalyEvent,
  DuplicateCluster,
  FederationPhashAuditReport,
} from "../packages/core/src/phash-analytics.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

/** Create a candidate with a given hash (16-hex chars = 64-bit). */
function makeCand(
  url: string,
  hash: string,
  source: string,
  license: ImageCandidate["license"] = "CC0",
  confidence = 1.0,
): ImageCandidate {
  return {
    url,
    source,
    license,
    confidence,
    phash: hash,
    phashAlgorithm: "dct-phash",
    phashResult: { hash, algorithm: "dct-phash", confidence },
  };
}

/** Create a candidate with no hash. */
function makeUnhashed(url: string, source: string): ImageCandidate {
  return { url, source, license: "UNKNOWN" };
}

/** Zero hash string (Hamming distance 0 from itself). */
const HASH_ZERO = "0000000000000000";
/** One-bit difference from HASH_ZERO (distance 1). */
const HASH_ONE  = "0000000000000001";
/** Completely different hash (high Hamming distance). */
const HASH_FAR  = "ffffffffffffffff";
/** Exactly 8 bits different from HASH_ZERO (on the boundary). */
const HASH_D8   = "00000000000000ff"; // last byte all 1s → distance 8

// ---------------------------------------------------------------------------
// 1. Basic cluster formation
// ---------------------------------------------------------------------------

describe("1. detectFederationDuplicateClusters — basic cluster formation", () => {
  const candidates: ImageCandidate[] = [
    makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia"),
    makeCand("https://b.example/1.jpg", HASH_ONE,  "openverse"),  // distance 1 from HASH_ZERO
    makeCand("https://c.example/1.jpg", HASH_FAR,  "unsplash"),   // distance 64 from HASH_ZERO
  ];

  test("two near-identical images form one cluster", () => {
    const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold: 8 });
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.clusterSize).toBe(2);
  });

  test("the distant image is not in any cluster", () => {
    const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold: 8 });
    const clusterMemberIndices = clusters.flatMap((cl) => cl.memberIndices);
    // Index 2 (HASH_FAR / unsplash) should NOT appear
    expect(clusterMemberIndices).not.toContain(2);
  });

  test("cluster contains both near-identical candidate indices", () => {
    const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold: 8 });
    const indices = new Set(clusters[0]!.memberIndices);
    expect(indices.has(0)).toBe(true);
    expect(indices.has(1)).toBe(true);
  });

  test("cluster providers lists both source ids", () => {
    const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold: 8 });
    const providers = clusters[0]!.providers;
    expect(providers).toContain("wikimedia");
    expect(providers).toContain("openverse");
  });
});

// ---------------------------------------------------------------------------
// 2. multiProviderOnly filter
// ---------------------------------------------------------------------------

describe("2. detectFederationDuplicateClusters — multiProviderOnly filter", () => {
  const twoProviders: ImageCandidate[] = [
    makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia"),
    makeCand("https://b.example/1.jpg", HASH_ONE,  "openverse"),
  ];

  const threeProviders: ImageCandidate[] = [
    makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia"),
    makeCand("https://b.example/1.jpg", HASH_ONE,  "openverse"),
    makeCand("https://c.example/1.jpg", HASH_D8,   "unsplash"),
  ];

  test("two-provider cluster is excluded when multiProviderOnly=true", () => {
    const clusters = detectFederationDuplicateClusters(twoProviders, {
      hammingThreshold: 8,
      multiProviderOnly: true,
    });
    // Only 2 unique providers → cluster requires 3+ unique providers
    expect(clusters.length).toBe(0);
  });

  test("three-provider cluster passes multiProviderOnly=true", () => {
    const clusters = detectFederationDuplicateClusters(threeProviders, {
      hammingThreshold: 8,
      multiProviderOnly: true,
    });
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.clusterSize).toBe(3);
  });

  test("multiProviderOnly=false (default) returns two-provider clusters", () => {
    const clusters = detectFederationDuplicateClusters(twoProviders, { hammingThreshold: 8 });
    expect(clusters.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Single-provider (no cross-provider pairs)
// ---------------------------------------------------------------------------

describe("3. detectFederationDuplicateClusters — single provider", () => {
  const candidates: ImageCandidate[] = [
    makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia"),
    makeCand("https://a.example/2.jpg", HASH_ONE,  "wikimedia"),
  ];

  test("same-provider near-identical images still form a cluster", () => {
    const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold: 8 });
    expect(clusters.length).toBe(1);
  });

  test("providerVariance is 0 when all members are from one provider", () => {
    const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold: 8 });
    expect(clusters[0]!.providerVariance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. All UNKNOWN license / confidence
// ---------------------------------------------------------------------------

describe("4. detectFederationDuplicateClusters — all UNKNOWN confidence", () => {
  const candidates: ImageCandidate[] = [
    makeCand("https://a.example/1.jpg", HASH_ZERO, "bing",  "UNKNOWN", 0.0),
    makeCand("https://b.example/1.jpg", HASH_ONE,  "brave", "UNKNOWN", 0.0),
  ];

  test("cluster formed even when confidence is 0", () => {
    const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold: 8 });
    expect(clusters.length).toBe(1);
  });

  test("licenseConfidences are all 0", () => {
    const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold: 8 });
    expect(clusters[0]!.licenseConfidences).toEqual([0, 0]);
  });

  test("confidenceVariance is 0 when all confidences are equal", () => {
    const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold: 8 });
    expect(clusters[0]!.confidenceVariance).toBeCloseTo(0, 10);
  });
});

// ---------------------------------------------------------------------------
// 5. Mixed algorithms
// ---------------------------------------------------------------------------

describe("5. detectFederationDuplicateClusters — mixed algorithms", () => {
  const candidates: ImageCandidate[] = [
    {
      url: "https://a.example/1.jpg",
      source: "wikimedia",
      license: "CC0",
      confidence: 1.0,
      phash: HASH_ZERO,
      phashAlgorithm: "dct-phash",
      phashResult: { hash: HASH_ZERO, algorithm: "dct-phash", confidence: 1.0 },
    },
    {
      url: "https://b.example/1.jpg",
      source: "bing",
      license: "UNKNOWN",
      confidence: 0.5,
      phash: HASH_ONE,
      phashAlgorithm: "ahash-fallback",
      phashResult: { hash: HASH_ONE, algorithm: "ahash-fallback", confidence: 0.5 },
    },
  ];

  test("dct and ahash candidates cluster when within threshold", () => {
    const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold: 8 });
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.clusterSize).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 6. Edge cases: 0 or 1 candidates
// ---------------------------------------------------------------------------

describe("6. detectFederationDuplicateClusters — edge cases", () => {
  test("empty candidates returns []", () => {
    expect(detectFederationDuplicateClusters([], { hammingThreshold: 8 })).toEqual([]);
  });

  test("single candidate returns []", () => {
    const cands = [makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia")];
    expect(detectFederationDuplicateClusters(cands, { hammingThreshold: 8 })).toEqual([]);
  });

  test("unhashed candidates are ignored (no clusters from unhashed)", () => {
    const cands = [
      makeUnhashed("https://a.example/1.jpg", "wikimedia"),
      makeUnhashed("https://b.example/1.jpg", "openverse"),
    ];
    expect(detectFederationDuplicateClusters(cands, { hammingThreshold: 8 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Threshold tuning: tight vs loose
// ---------------------------------------------------------------------------

describe("7. detectFederationDuplicateClusters — threshold tuning", () => {
  // HASH_D8 is exactly 8 bits from HASH_ZERO
  const candidates: ImageCandidate[] = [
    makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia"),
    makeCand("https://b.example/1.jpg", HASH_D8,   "openverse"),
  ];

  test("threshold=8 includes distance-8 pair in a cluster", () => {
    const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold: 8 });
    expect(clusters.length).toBe(1);
  });

  test("threshold=7 excludes distance-8 pair (strict)", () => {
    const clusters = detectFederationDuplicateClusters(candidates, { hammingThreshold: 7 });
    expect(clusters.length).toBe(0);
  });

  test("threshold=0 only matches exact duplicates", () => {
    const exactDupe: ImageCandidate[] = [
      makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia"),
      makeCand("https://b.example/1.jpg", HASH_ZERO, "openverse"),
    ];
    const clusters = detectFederationDuplicateClusters(exactDupe, { hammingThreshold: 0 });
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.minIntraDistance).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. detectConfidenceAnomalies — high delta triggers anomaly
// ---------------------------------------------------------------------------

describe("8. detectConfidenceAnomalies — high delta triggers", () => {
  const candidates: ImageCandidate[] = [
    makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia", "CC_BY", 0.9),
    makeCand("https://b.example/1.jpg", HASH_ONE,  "bing",     "UNKNOWN", 0.2),
  ];

  test("anomaly is detected when delta >= minDelta", () => {
    const anomalies = detectConfidenceAnomalies(candidates, { minDelta: 0.3 });
    expect(anomalies.length).toBe(1);
  });

  test("anomaly maxConfidenceDelta matches actual spread", () => {
    const anomalies = detectConfidenceAnomalies(candidates, { minDelta: 0.3 });
    expect(anomalies[0]!.maxConfidenceDelta).toBeCloseTo(0.7, 5);
  });

  test("highestConfidenceLicense and lowestConfidenceLicense are correct", () => {
    const anomalies = detectConfidenceAnomalies(candidates, { minDelta: 0.3 });
    expect(anomalies[0]!.highestConfidenceLicense).toBe("CC_BY");
    expect(anomalies[0]!.lowestConfidenceLicense).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// 9. detectConfidenceAnomalies — low delta does NOT trigger
// ---------------------------------------------------------------------------

describe("9. detectConfidenceAnomalies — low delta does not trigger", () => {
  const candidates: ImageCandidate[] = [
    makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia", "CC0",   0.85),
    makeCand("https://b.example/1.jpg", HASH_ONE,  "openverse", "CC_BY", 0.80),
  ];

  test("no anomaly when delta < minDelta", () => {
    const anomalies = detectConfidenceAnomalies(candidates, { minDelta: 0.3 });
    expect(anomalies.length).toBe(0);
  });

  test("anomaly fires when minDelta is lowered to match actual delta", () => {
    const anomalies = detectConfidenceAnomalies(candidates, { minDelta: 0.04 });
    expect(anomalies.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 10. detectConfidenceAnomalies — all UNKNOWN license
// ---------------------------------------------------------------------------

describe("10. detectConfidenceAnomalies — all UNKNOWN license", () => {
  const candidates: ImageCandidate[] = [
    makeCand("https://a.example/1.jpg", HASH_ZERO, "bing",  "UNKNOWN", 0.9),
    makeCand("https://b.example/1.jpg", HASH_ONE,  "brave", "UNKNOWN", 0.1),
  ];

  test("anomaly detected even when both licenses are UNKNOWN", () => {
    const anomalies = detectConfidenceAnomalies(candidates, { minDelta: 0.3 });
    expect(anomalies.length).toBe(1);
    expect(anomalies[0]!.highestConfidenceLicense).toBe("UNKNOWN");
    expect(anomalies[0]!.lowestConfidenceLicense).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// 11. detectConfidenceAnomalies — mixed algorithm candidates
// ---------------------------------------------------------------------------

describe("11. detectConfidenceAnomalies — mixed algorithms", () => {
  const candidates: ImageCandidate[] = [
    {
      url: "https://a.example/1.jpg",
      source: "wikimedia",
      license: "CC_BY",
      confidence: 0.95,
      phash: HASH_ZERO,
      phashAlgorithm: "dct-phash",
      phashResult: { hash: HASH_ZERO, algorithm: "dct-phash", confidence: 0.95 },
    },
    {
      url: "https://b.example/1.jpg",
      source: "bing",
      license: "UNKNOWN",
      confidence: 0.3,
      phash: HASH_ONE,
      phashAlgorithm: "ahash-fallback",
      phashResult: { hash: HASH_ONE, algorithm: "ahash-fallback", confidence: 0.3 },
    },
  ];

  test("anomaly detected across dct/ahash candidates", () => {
    const anomalies = detectConfidenceAnomalies(candidates, { minDelta: 0.3 });
    expect(anomalies.length).toBe(1);
    expect(anomalies[0]!.maxConfidenceDelta).toBeCloseTo(0.65, 5);
  });
});

// ---------------------------------------------------------------------------
// 12. buildFederationPhashAuditReport — report shape invariants
// ---------------------------------------------------------------------------

describe("12. buildFederationPhashAuditReport — shape invariants", () => {
  const candidates: ImageCandidate[] = [
    makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia", "CC0",   1.0),
    makeCand("https://b.example/1.jpg", HASH_ONE,  "openverse", "CC_BY", 0.8),
    makeCand("https://c.example/1.jpg", HASH_FAR,  "unsplash",  "UNSPLASH_LICENSE", 0.9),
  ];

  const report = buildFederationPhashAuditReport("test query", candidates);

  test("report contains required top-level fields", () => {
    expect(report.query).toBe("test query");
    expect(typeof report.generatedAt).toBe("string");
    expect(typeof report.totalCandidates).toBe("number");
    expect(typeof report.hashedCandidates).toBe("number");
    expect(typeof report.hammingThreshold).toBe("number");
    expect(typeof report.totalUniques).toBe("number");
    expect(typeof report.clusterCount).toBe("number");
    expect(Array.isArray(report.clusters)).toBe(true);
    expect(Array.isArray(report.confidenceAnomalies)).toBe(true);
    expect(Array.isArray(report.providerAgreementMatrix)).toBe(true);
    expect(Array.isArray(report.thresholdTuningGuide)).toBe(true);
    expect(Array.isArray(report.recommendations)).toBe(true);
  });

  test("totalCandidates equals input length", () => {
    expect(report.totalCandidates).toBe(candidates.length);
  });

  test("hashedCandidates <= totalCandidates", () => {
    expect(report.hashedCandidates).toBeLessThanOrEqual(report.totalCandidates);
  });

  test("report is JSON-serializable", () => {
    expect(() => JSON.stringify(report)).not.toThrow();
  });

  test("thresholdTuningGuide has entries for the expected thresholds", () => {
    const thresholds = report.thresholdTuningGuide.map((e) => e.threshold);
    expect(thresholds).toContain(4);
    expect(thresholds).toContain(8);
    expect(thresholds).toContain(12);
  });
});

// ---------------------------------------------------------------------------
// 13. buildFederationPhashAuditReport — provider agreement matrix
// ---------------------------------------------------------------------------

describe("13. buildFederationPhashAuditReport — provider agreement matrix", () => {
  // Two candidates that hash-match from different providers
  const candidates: ImageCandidate[] = [
    makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia"),
    makeCand("https://b.example/1.jpg", HASH_ONE,  "openverse"),
    makeCand("https://c.example/1.jpg", HASH_FAR,  "unsplash"),
  ];

  const report = buildFederationPhashAuditReport("agreement test", candidates, { hammingThreshold: 8 });

  test("agreement matrix has entry for wikimedia+openverse pair", () => {
    const entry = report.providerAgreementMatrix.find(
      (e) =>
        (e.providerA === "wikimedia" && e.providerB === "openverse") ||
        (e.providerA === "openverse" && e.providerB === "wikimedia"),
    );
    expect(entry).toBeDefined();
    expect(entry!.sharedClusterCount).toBeGreaterThan(0);
  });

  test("agreementRate is in [0, 1]", () => {
    for (const entry of report.providerAgreementMatrix) {
      expect(entry.agreementRate).toBeGreaterThanOrEqual(0);
      expect(entry.agreementRate).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 14. buildFederationPhashAuditReport — threshold tuning guide
// ---------------------------------------------------------------------------

describe("14. buildFederationPhashAuditReport — threshold tuning guide", () => {
  const candidates: ImageCandidate[] = [
    makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia"),
    makeCand("https://b.example/1.jpg", HASH_D8,   "openverse"), // distance 8 from HASH_ZERO
    makeCand("https://c.example/1.jpg", HASH_FAR,  "unsplash"),  // very far
  ];

  const report = buildFederationPhashAuditReport("tuning test", candidates, { hammingThreshold: 8 });

  test("tuning guide uniqueCount at threshold=8 equals totalUniques", () => {
    const entry = report.thresholdTuningGuide.find((e) => e.threshold === 8);
    expect(entry).toBeDefined();
    expect(entry!.uniqueCount).toBe(report.totalUniques);
  });

  test("stricter threshold (4) has more uniques than threshold 8", () => {
    const e4 = report.thresholdTuningGuide.find((e) => e.threshold === 4);
    const e8 = report.thresholdTuningGuide.find((e) => e.threshold === 8);
    expect(e4).toBeDefined();
    expect(e8).toBeDefined();
    // Stricter = fewer or equal clusters = more or equal uniques
    expect(e4!.uniqueCount).toBeGreaterThanOrEqual(e8!.uniqueCount);
  });

  test("looser threshold (16) has fewer or equal uniques than threshold 8", () => {
    const e16 = report.thresholdTuningGuide.find((e) => e.threshold === 16);
    const e8  = report.thresholdTuningGuide.find((e) => e.threshold === 8);
    expect(e16).toBeDefined();
    expect(e8).toBeDefined();
    expect(e16!.uniqueCount).toBeLessThanOrEqual(e8!.uniqueCount);
  });
});

// ---------------------------------------------------------------------------
// 15. buildFederationPhashAuditReport — recommendations generated
// ---------------------------------------------------------------------------

describe("15. buildFederationPhashAuditReport — recommendations", () => {
  test("investigate-anomaly recommendation emitted for high-delta cluster", () => {
    const candidates: ImageCandidate[] = [
      makeCand("https://a.example/1.jpg", HASH_ZERO, "wikimedia", "CC_BY",  0.9),
      makeCand("https://b.example/1.jpg", HASH_ONE,  "bing",      "UNKNOWN", 0.1),
    ];
    const report = buildFederationPhashAuditReport("anomaly test", candidates, {
      hammingThreshold: 8,
      anomalyMinDelta: 0.3,
    });
    const rec = report.recommendations.find((r) => r.type === "investigate-anomaly");
    expect(rec).toBeDefined();
  });

  test("no recommendations for perfectly uniform single-provider set", () => {
    // All same provider, same license, same hash → no anomalies, no threshold issues
    const candidates: ImageCandidate[] = Array.from({ length: 3 }, (_, i) =>
      makeCand(`https://a.example/${i}.jpg`, HASH_ZERO, "wikimedia", "CC0", 1.0),
    );
    const report = buildFederationPhashAuditReport("uniform test", candidates);
    // single-provider warning may fire but investigate-anomaly should not
    const anomalyRecs = report.recommendations.filter((r) => r.type === "investigate-anomaly");
    expect(anomalyRecs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 16. buildFederationPhashAuditReport — empty candidates
// ---------------------------------------------------------------------------

describe("16. buildFederationPhashAuditReport — empty candidates", () => {
  const report = buildFederationPhashAuditReport("empty query", []);

  test("totalCandidates is 0", () => { expect(report.totalCandidates).toBe(0); });
  test("hashedCandidates is 0", () => { expect(report.hashedCandidates).toBe(0); });
  test("clusterCount is 0", () => { expect(report.clusterCount).toBe(0); });
  test("clusters is []", () => { expect(report.clusters).toEqual([]); });
  test("confidenceAnomalies is []", () => { expect(report.confidenceAnomalies).toEqual([]); });
  test("providerAgreementMatrix is []", () => { expect(report.providerAgreementMatrix).toEqual([]); });
  test("is JSON-serializable", () => { expect(() => JSON.stringify(report)).not.toThrow(); });
});

// ---------------------------------------------------------------------------
// 17. Stability test across synthetic datasets
// ---------------------------------------------------------------------------

describe("17. buildFederationPhashAuditReport — stability", () => {
  function syntheticCandidates(n: number): ImageCandidate[] {
    return Array.from({ length: n }, (_, i) => {
      const hashBits = i % 64;
      // Construct a hash that shifts one bit per candidate
      const val = BigInt(1) << BigInt(hashBits % 64);
      const hash = val.toString(16).padStart(16, "0");
      return makeCand(
        `https://synthetic.example/${i}.jpg`,
        hash,
        i % 3 === 0 ? "wikimedia" : i % 3 === 1 ? "openverse" : "unsplash",
        "CC0",
        0.8 + (i % 5) * 0.04,
      );
    });
  }

  for (const size of [5, 10, 20, 50]) {
    test(`no throw for ${size} synthetic candidates`, () => {
      const cands = syntheticCandidates(size);
      expect(() => buildFederationPhashAuditReport("synthetic", cands)).not.toThrow();
    });
  }

  test("report numeric fields are all finite for 20-candidate set", () => {
    const report = buildFederationPhashAuditReport("finite check", syntheticCandidates(20));
    expect(Number.isFinite(report.totalCandidates)).toBe(true);
    expect(Number.isFinite(report.hashedCandidates)).toBe(true);
    expect(Number.isFinite(report.clusterCount)).toBe(true);
    expect(Number.isFinite(report.totalUniques)).toBe(true);
    expect(Number.isFinite(report.similarity.avgHammingDistance)).toBe(true);
  });
});
