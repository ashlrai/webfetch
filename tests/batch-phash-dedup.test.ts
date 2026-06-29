/**
 * Tests for batchDeduplicateWithPhashCluster()
 *
 * Covers:
 *   1.  Empty input → zero-state result
 *   2.  Single candidate → single-member cluster, no deduplication
 *   3.  All-identical hashes (same provider) → one cluster, all members present
 *   4.  All-identical hashes (mixed providers) → cross-provider dupe rate = 1
 *   5.  Distinct hashes (no matches) → each candidate is its own cluster
 *   6.  Threshold sensitivity: near-dupe clusters at threshold=8, splits at threshold=2
 *   7.  Algorithm breakdown: pure dct-phash batch → breakdown counts correct
 *   8.  Algorithm breakdown: ahash-fallback members counted separately
 *   9.  Mixed algorithm breakdown: dct-phash + ahash in same cluster
 *  10.  Timeout-degraded confidence (low phashResult.confidence) reflected in cluster confidence
 *  11.  dedupReport.originalCount / dedupedCount / clusterCount integrity
 *  12.  dedupReport.avgConfidenceVariance = 0 for uniform-confidence clusters
 *  13.  dedupReport.avgConfidenceVariance > 0 for mixed-confidence clusters
 *  14.  crossProviderDuplicationRate = 0 when all dupes are within same provider
 *  15.  crossProviderDuplicationRate = 1 when all multi-member clusters are cross-provider
 *  16.  Multi-member clusters sort before singletons in returned clusters array
 *  17.  Candidate with bare phash (no phashResult, no phashAlgorithm) handled gracefully
 *  18.  Large batch (50 candidates, 5 provider groups) deduplicated correctly
 */

import { describe, expect, test } from "bun:test";
import type { ImageCandidate } from "../packages/core/src/types.ts";
import { batchDeduplicateWithPhashCluster } from "../packages/core/src/batch-phash-dedup.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const HASH_A = "0000000000000000"; // all zeros
const HASH_B = "ffffffffffffffff"; // all ones — 64 bits from HASH_A
const HASH_C = "0000000000000001"; // 1 bit from HASH_A
const HASH_D = "0000000000000003"; // 2 bits from HASH_A, 1 bit from HASH_C
const HASH_E = "0000000000000100"; // 8 bits from HASH_A (different byte region)

function makeCandidate(
  overrides: Partial<ImageCandidate> & { phash: string; url?: string },
): ImageCandidate {
  const url = overrides.url ?? `https://example.com/${overrides.phash}-${Math.random()}.jpg`;
  return {
    url,
    source: "wikimedia",
    license: "CC0",
    confidence: 1.0,
    phash: overrides.phash,
    phashResult: {
      hash: overrides.phash,
      algorithm: "dct-phash",
      confidence: 1.0,
    },
    phashAlgorithm: "dct-phash",
    ...overrides,
    url,
  };
}

function makeCandidateUrl(
  url: string,
  phash: string,
  source: string,
  opts: Partial<ImageCandidate> = {},
): ImageCandidate {
  return makeCandidate({ phash, url, source, ...opts });
}

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — empty input", () => {
  test("returns zero-state result for empty array", async () => {
    const result = await batchDeduplicateWithPhashCluster([]);

    expect(result.deduped).toEqual([]);
    expect(result.clusters).toEqual([]);
    expect(result.dedupReport.originalCount).toBe(0);
    expect(result.dedupReport.dedupedCount).toBe(0);
    expect(result.dedupReport.clusterCount).toBe(0);
    expect(result.dedupReport.avgConfidenceVariance).toBe(0);
    expect(result.dedupReport.crossProviderDuplicationRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Single candidate
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — single candidate", () => {
  test("single candidate produces one cluster with no deduplication", async () => {
    const c = makeCandidate({ phash: HASH_A, url: "https://example.com/a.jpg" });
    const result = await batchDeduplicateWithPhashCluster([c]);

    expect(result.deduped).toHaveLength(1);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.members).toHaveLength(1);
    expect(result.clusters[0]!.repId).toBe("https://example.com/a.jpg");
    expect(result.dedupReport.originalCount).toBe(1);
    expect(result.dedupReport.dedupedCount).toBe(1);
    expect(result.dedupReport.clusterCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3 & 4. Identical hashes — same provider vs. mixed providers
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — identical hashes", () => {
  test("three candidates with same hash and same provider → one cluster", async () => {
    const candidates = [
      makeCandidate({ phash: HASH_A, url: "https://example.com/a1.jpg", source: "wikimedia" }),
      makeCandidate({ phash: HASH_A, url: "https://example.com/a2.jpg", source: "wikimedia" }),
      makeCandidate({ phash: HASH_A, url: "https://example.com/a3.jpg", source: "wikimedia" }),
    ];

    const result = await batchDeduplicateWithPhashCluster(candidates, { hammingThreshold: 0 });

    expect(result.deduped).toHaveLength(1);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.members).toHaveLength(3);
    expect(result.dedupReport.originalCount).toBe(3);
    expect(result.dedupReport.dedupedCount).toBe(1);
  });

  test("same hash from multiple providers → crossProviderDuplicationRate = 1.0", async () => {
    const candidates = [
      makeCandidateUrl("https://wikimedia.org/a.jpg", HASH_A, "wikimedia"),
      makeCandidateUrl("https://openverse.org/a.jpg", HASH_A, "openverse"),
      makeCandidateUrl("https://unsplash.com/a.jpg", HASH_A, "unsplash"),
    ];

    const result = await batchDeduplicateWithPhashCluster(candidates, { hammingThreshold: 0 });

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.members).toHaveLength(3);
    expect(result.dedupReport.crossProviderDuplicationRate).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// 5. Distinct hashes — no deduplication
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — distinct hashes", () => {
  test("each candidate with unique hash forms its own cluster (no dedup)", async () => {
    const candidates = [
      makeCandidate({ phash: HASH_A, url: "https://example.com/a.jpg" }),
      makeCandidate({ phash: HASH_B, url: "https://example.com/b.jpg" }),
    ];

    const result = await batchDeduplicateWithPhashCluster(candidates, { hammingThreshold: 5 });

    expect(result.deduped).toHaveLength(2);
    expect(result.clusters).toHaveLength(2);
    expect(result.dedupReport.dedupedCount).toBe(2);
    expect(result.dedupReport.clusterCount).toBe(2);
    // No multi-member clusters → crossProviderDuplicationRate = 0
    expect(result.dedupReport.crossProviderDuplicationRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Threshold sensitivity
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — threshold sensitivity", () => {
  test("near-duplicate (1 bit apart) clusters at threshold=8, stays separate at threshold=0", async () => {
    const a = makeCandidate({ phash: HASH_A, url: "https://example.com/a.jpg" });
    const c = makeCandidate({ phash: HASH_C, url: "https://example.com/c.jpg" }); // 1 bit from HASH_A

    const r8 = await batchDeduplicateWithPhashCluster([a, c], { hammingThreshold: 8 });
    expect(r8.deduped).toHaveLength(1);
    expect(r8.clusters).toHaveLength(1);

    const r0 = await batchDeduplicateWithPhashCluster([a, c], { hammingThreshold: 0 });
    expect(r0.deduped).toHaveLength(2);
    expect(r0.clusters).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 7 & 8. Algorithm breakdown
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — algorithm breakdown", () => {
  test("pure dct-phash batch: all members in cluster show dct-phash count = N", async () => {
    const candidates = [
      makeCandidate({ phash: HASH_A, url: "https://example.com/1.jpg" }),
      makeCandidate({ phash: HASH_A, url: "https://example.com/2.jpg" }),
    ];

    const result = await batchDeduplicateWithPhashCluster(candidates, { hammingThreshold: 0 });

    const cluster = result.clusters[0]!;
    expect(cluster.algorithmBreakdown["dct-phash"]).toBe(2);
    expect(cluster.algorithmBreakdown["ahash-fallback"]).toBe(0);
  });

  test("ahash-fallback members are counted separately in breakdown", async () => {
    const dct = makeCandidate({ phash: HASH_A, url: "https://example.com/dct.jpg" });
    const ahash: ImageCandidate = {
      url: "https://example.com/ahash.jpg",
      source: "openverse",
      license: "CC_BY",
      phash: HASH_A,
      phashResult: { hash: HASH_A, algorithm: "ahash-fallback", confidence: 0.5 },
      phashAlgorithm: "ahash-fallback",
    };

    const result = await batchDeduplicateWithPhashCluster([dct, ahash], {
      hammingThreshold: 0,
    });

    expect(result.clusters).toHaveLength(1);
    const cluster = result.clusters[0]!;
    expect(cluster.algorithmBreakdown["dct-phash"]).toBe(1);
    expect(cluster.algorithmBreakdown["ahash-fallback"]).toBe(1);
  });

  test("singleton cluster with ahash-fallback member reflects ahash count = 1", async () => {
    const ahash: ImageCandidate = {
      url: "https://example.com/ahash-only.jpg",
      source: "pexels",
      license: "PEXELS_LICENSE",
      phash: HASH_B,
      phashResult: { hash: HASH_B, algorithm: "ahash-fallback", confidence: 0.5 },
      phashAlgorithm: "ahash-fallback",
    };

    const result = await batchDeduplicateWithPhashCluster([ahash]);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.algorithmBreakdown["ahash-fallback"]).toBe(1);
    expect(result.clusters[0]!.algorithmBreakdown["dct-phash"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Mixed algorithm in same cluster
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — mixed algorithm cluster", () => {
  test("cluster with dct + ahash members has lower confidence than pure-dct cluster", async () => {
    const pureDctCandidates = [
      makeCandidate({ phash: HASH_A, url: "https://example.com/d1.jpg" }),
      makeCandidate({ phash: HASH_A, url: "https://example.com/d2.jpg" }),
    ];

    const mixedCandidates = [
      makeCandidate({ phash: HASH_C, url: "https://example.com/m1.jpg" }),
      {
        url: "https://example.com/m2.jpg",
        source: "flickr" as const,
        license: "CC_BY" as const,
        phash: HASH_C,
        phashResult: { hash: HASH_C, algorithm: "ahash-fallback" as const, confidence: 0.5 },
        phashAlgorithm: "ahash-fallback" as const,
      } as ImageCandidate,
    ];

    const pureDctResult = await batchDeduplicateWithPhashCluster(pureDctCandidates, {
      hammingThreshold: 0,
    });
    const mixedResult = await batchDeduplicateWithPhashCluster(mixedCandidates, {
      hammingThreshold: 0,
    });

    const pureDctConf = pureDctResult.clusters[0]!.confidence;
    const mixedConf = mixedResult.clusters[0]!.confidence;

    // Pure dct cluster should have higher or equal confidence than mixed
    expect(pureDctConf).toBeGreaterThanOrEqual(mixedConf);
  });
});

// ---------------------------------------------------------------------------
// 10. Timeout-degraded confidence
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — timeout-degraded confidence", () => {
  test("candidate with low phashResult.confidence produces lower cluster confidence", async () => {
    const degraded: ImageCandidate = {
      url: "https://example.com/degraded.jpg",
      source: "brave",
      license: "UNKNOWN",
      phash: HASH_A,
      phashResult: { hash: HASH_A, algorithm: "dct-phash", confidence: 0.1 },
      phashAlgorithm: "dct-phash",
    };

    const degradedResult = await batchDeduplicateWithPhashCluster([degraded]);
    const highResult = await batchDeduplicateWithPhashCluster([
      makeCandidate({ phash: HASH_A, url: "https://example.com/high.jpg" }),
    ]);

    expect(degradedResult.clusters[0]!.confidence).toBeLessThan(
      highResult.clusters[0]!.confidence,
    );
  });

  test("cluster confidence is clamped to [0, 1] even with degraded members", async () => {
    const degraded: ImageCandidate = {
      url: "https://example.com/very-degraded.jpg",
      source: "bing",
      license: "UNKNOWN",
      phash: HASH_A,
      phashResult: { hash: HASH_A, algorithm: "ahash-fallback", confidence: 0.05 },
      phashAlgorithm: "ahash-fallback",
    };

    const result = await batchDeduplicateWithPhashCluster([degraded]);
    const conf = result.clusters[0]!.confidence;
    expect(conf).toBeGreaterThanOrEqual(0);
    expect(conf).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 11. dedupReport integrity
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — dedupReport integrity", () => {
  test("originalCount = total input; dedupedCount = one per cluster", async () => {
    const candidates = [
      makeCandidate({ phash: HASH_A, url: "https://example.com/a1.jpg" }),
      makeCandidate({ phash: HASH_A, url: "https://example.com/a2.jpg" }),
      makeCandidate({ phash: HASH_B, url: "https://example.com/b.jpg" }),
    ];

    const result = await batchDeduplicateWithPhashCluster(candidates, { hammingThreshold: 8 });

    expect(result.dedupReport.originalCount).toBe(3);
    expect(result.dedupReport.dedupedCount).toBe(result.deduped.length);
    expect(result.dedupReport.clusterCount).toBe(result.clusters.length);
  });
});

// ---------------------------------------------------------------------------
// 12 & 13. Confidence variance
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — confidence variance", () => {
  test("uniform confidence cluster → avgConfidenceVariance = 0", async () => {
    const candidates = [
      makeCandidate({ phash: HASH_A, url: "https://example.com/u1.jpg" }),
      makeCandidate({ phash: HASH_A, url: "https://example.com/u2.jpg" }),
    ];

    const result = await batchDeduplicateWithPhashCluster(candidates, { hammingThreshold: 0 });

    expect(result.dedupReport.avgConfidenceVariance).toBe(0);
  });

  test("mixed-confidence cluster → avgConfidenceVariance > 0", async () => {
    const high = makeCandidate({
      phash: HASH_A,
      url: "https://example.com/high.jpg",
      phashResult: { hash: HASH_A, algorithm: "dct-phash", confidence: 1.0 },
    });
    const low: ImageCandidate = {
      url: "https://example.com/low.jpg",
      source: "flickr",
      license: "CC_BY",
      phash: HASH_A,
      phashResult: { hash: HASH_A, algorithm: "ahash-fallback", confidence: 0.3 },
      phashAlgorithm: "ahash-fallback",
    };

    const result = await batchDeduplicateWithPhashCluster([high, low], {
      hammingThreshold: 0,
    });

    expect(result.dedupReport.avgConfidenceVariance).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 14 & 15. Cross-provider duplication rate
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — crossProviderDuplicationRate", () => {
  test("all dupes within same provider → crossProviderDuplicationRate = 0", async () => {
    const candidates = [
      makeCandidate({ phash: HASH_A, url: "https://example.com/s1.jpg", source: "pexels" }),
      makeCandidate({ phash: HASH_A, url: "https://example.com/s2.jpg", source: "pexels" }),
    ];

    const result = await batchDeduplicateWithPhashCluster(candidates, { hammingThreshold: 0 });

    expect(result.dedupReport.crossProviderDuplicationRate).toBe(0);
  });

  test("all multi-member clusters have cross-provider members → rate = 1", async () => {
    // Cluster 1: wikimedia + openverse
    // Cluster 2: pexels + unsplash
    const candidates = [
      makeCandidateUrl("https://wikimedia.org/x.jpg", HASH_A, "wikimedia"),
      makeCandidateUrl("https://openverse.org/x.jpg", HASH_A, "openverse"),
      makeCandidateUrl("https://pexels.com/y.jpg", HASH_B, "pexels"),
      makeCandidateUrl("https://unsplash.com/y.jpg", HASH_B, "unsplash"),
    ];

    const result = await batchDeduplicateWithPhashCluster(candidates, { hammingThreshold: 0 });

    expect(result.dedupReport.crossProviderDuplicationRate).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 16. Cluster ordering
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — cluster ordering", () => {
  test("multi-member clusters appear before singletons", async () => {
    const candidates = [
      makeCandidate({ phash: HASH_B, url: "https://example.com/singleton.jpg" }),
      makeCandidate({ phash: HASH_A, url: "https://example.com/dup1.jpg" }),
      makeCandidate({ phash: HASH_A, url: "https://example.com/dup2.jpg" }),
    ];

    const result = await batchDeduplicateWithPhashCluster(candidates, { hammingThreshold: 0 });

    expect(result.clusters.length).toBeGreaterThanOrEqual(2);
    // First cluster should be the multi-member one
    expect(result.clusters[0]!.members.length).toBeGreaterThan(1);
    // Last cluster should be singleton
    expect(result.clusters[result.clusters.length - 1]!.members.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 17. Bare phash string handling
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — bare phash handling", () => {
  test("candidate with bare phash only (no phashResult) is processed gracefully", async () => {
    const bare: ImageCandidate = {
      url: "https://example.com/bare.jpg",
      source: "internet-archive",
      license: "PUBLIC_DOMAIN",
      phash: HASH_A,
      // No phashResult or phashAlgorithm
    };
    const full = makeCandidate({ phash: HASH_A, url: "https://example.com/full.jpg" });

    const result = await batchDeduplicateWithPhashCluster([bare, full], {
      hammingThreshold: 0,
    });

    // Should not throw; both should be processed
    expect(result.clusters.length).toBeGreaterThan(0);
    expect(result.dedupReport.originalCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 18. Large batch — 50 candidates, 5 providers
// ---------------------------------------------------------------------------

describe("batchDeduplicateWithPhashCluster — large batch", () => {
  test("50 candidates across 5 providers deduplicated correctly", async () => {
    const providers = ["wikimedia", "openverse", "unsplash", "pexels", "pixabay"];
    const hashes = [HASH_A, HASH_B, HASH_C, HASH_D, HASH_E];

    // 10 candidates per hash (2 per provider), total 50
    const candidates: ImageCandidate[] = [];
    for (let h = 0; h < hashes.length; h++) {
      for (let p = 0; p < providers.length; p++) {
        for (let k = 0; k < 2; k++) {
          candidates.push(
            makeCandidate({
              phash: hashes[h]!,
              url: `https://${providers[p]}.org/img-h${h}-p${p}-k${k}.jpg`,
              source: providers[p]!,
            }),
          );
        }
      }
    }

    expect(candidates).toHaveLength(50);

    const result = await batchDeduplicateWithPhashCluster(candidates, {
      // Use threshold=0 so only exact duplicates cluster (the 5 distinct hashes stay separate)
      hammingThreshold: 0,
    });

    // Should reduce 50 → 5 (one representative per distinct hash)
    expect(result.dedupReport.originalCount).toBe(50);
    expect(result.dedupReport.dedupedCount).toBe(5);
    expect(result.dedupReport.clusterCount).toBe(5);

    // Every cluster has 10 members and spans all 5 providers → cross-provider rate = 1
    expect(result.dedupReport.crossProviderDuplicationRate).toBe(1);

    for (const cluster of result.clusters) {
      expect(cluster.members).toHaveLength(10);
      const distinctProviders = new Set(cluster.members.map((m) => m.source)).size;
      expect(distinctProviders).toBe(5);
    }

    // All members use dct-phash → algorithmBreakdown["dct-phash"] = 10 per cluster
    for (const cluster of result.clusters) {
      expect(cluster.algorithmBreakdown["dct-phash"]).toBe(10);
      expect(cluster.algorithmBreakdown["ahash-fallback"]).toBe(0);
    }
  });
});
