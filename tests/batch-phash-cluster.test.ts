/**
 * Unit tests for batch-phash-cluster.ts
 *
 * Covers:
 *   1. Empty input → empty output
 *   2. Single candidate → single cluster (or singleton)
 *   3. All identical hashes → one cluster
 *   4. Clustering by Hamming threshold
 *   5. Low-confidence candidates are discarded
 *   6. Confidence decay reduces score for stale candidates
 *   7. dedupeRate computation
 *   8. License rank drives representative selection
 *   9. minClusterSize filters small clusters
 *  10. Missing phash (no bytes) → discarded
 *  11. Bare phash string (no phashResult) synthesises a result
 */

import { describe, expect, test } from "bun:test";
import type { ImageCandidate } from "../packages/core/src/types.ts";
import {
  batchClusterByPhash,
} from "../packages/core/src/batch-phash-cluster.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  overrides: Partial<ImageCandidate> & { phash: string },
): ImageCandidate {
  return {
    url: `https://example.com/${overrides.phash}.jpg`,
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
  };
}

/** A 64-bit hex hash with all zeros. */
const HASH_ZEROS = "0000000000000000";
/** A 64-bit hex hash with all ones. */
const HASH_ONES  = "ffffffffffffffff";
/** A hash that differs from HASH_ZEROS by exactly 4 bits (near-duplicate). */
const HASH_NEAR  = "0000000000000010"; // 1 bit flipped in last nibble
/** A hash that differs from HASH_ZEROS by exactly 8 bits (0xff = 11111111). */
const HASH_8BITS = "00000000000000ff"; // 8 bits flipped in last byte

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("batchClusterByPhash — edge cases", () => {
  test("empty input returns empty result", async () => {
    const result = await batchClusterByPhash([]);
    expect(result.clusters).toEqual([]);
    expect(result.clusterMetrics.discardedCount).toBe(0);
    expect(result.clusterMetrics.lonelyCount).toBe(0);
    expect(result.dedupeRate).toBe(0);
  });

  test("single candidate → single-member cluster", async () => {
    const c = makeCandidate({ phash: HASH_ZEROS });
    const result = await batchClusterByPhash([c]);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.size).toBe(1);
    expect(result.clusters[0]!.alternatives).toHaveLength(0);
    expect(result.clusterMetrics.lonelyCount).toBe(1);
    expect(result.dedupeRate).toBe(0);
  });

  test("candidate missing phash and no bytes → discarded", async () => {
    const c: ImageCandidate = {
      url: "https://example.com/no-hash.jpg",
      source: "wikimedia",
      license: "CC0",
      confidence: 1.0,
      // No phash, phashResult, or raw.bytes
    };
    const result = await batchClusterByPhash([c]);
    expect(result.clusters).toHaveLength(0);
    expect(result.clusterMetrics.discardedCount).toBe(1);
  });
});

describe("batchClusterByPhash — confidence filtering", () => {
  test("candidate with phashResult.confidence < 0.3 is discarded", async () => {
    const lowConf = makeCandidate({
      phash: HASH_ZEROS,
      phashResult: { hash: HASH_ZEROS, algorithm: "ahash-fallback", confidence: 0.2 },
    });
    const highConf = makeCandidate({ phash: HASH_ONES });

    const result = await batchClusterByPhash([lowConf, highConf]);
    expect(result.clusterMetrics.discardedCount).toBe(1);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.representative.phash).toBe(HASH_ONES);
  });

  test("candidate with confidence exactly 0.3 is included (boundary)", async () => {
    const boundary = makeCandidate({
      phash: HASH_ZEROS,
      phashResult: { hash: HASH_ZEROS, algorithm: "ahash-fallback", confidence: 0.3 },
    });
    const result = await batchClusterByPhash([boundary]);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusterMetrics.discardedCount).toBe(0);
  });
});

describe("batchClusterByPhash — clustering algorithm", () => {
  test("identical hashes cluster together", async () => {
    const a = makeCandidate({ phash: HASH_ZEROS, url: "https://example.com/a.jpg" });
    const b = makeCandidate({ phash: HASH_ZEROS, url: "https://example.com/b.jpg" });
    const c = makeCandidate({ phash: HASH_ZEROS, url: "https://example.com/c.jpg" });

    const result = await batchClusterByPhash([a, b, c], { hammingThreshold: 10 });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.size).toBe(3);
    expect(result.clusters[0]!.avgIntraDistance).toBe(0);
  });

  test("hash beyond threshold does not cluster", async () => {
    const a = makeCandidate({ phash: HASH_ZEROS });
    // HASH_ONES is 64 bits away from HASH_ZEROS
    const b = makeCandidate({ phash: HASH_ONES, url: "https://example.com/b.jpg" });

    const result = await batchClusterByPhash([a, b], { hammingThreshold: 10 });
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[0]!.size).toBe(1);
    expect(result.clusters[1]!.size).toBe(1);
  });

  test("near-duplicate hash (≤ threshold) clusters together", async () => {
    const a = makeCandidate({ phash: HASH_ZEROS });
    const b = makeCandidate({ phash: HASH_NEAR, url: "https://example.com/near.jpg" });

    // HASH_NEAR differs by 1 bit from HASH_ZEROS
    const result = await batchClusterByPhash([a, b], { hammingThreshold: 5 });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.size).toBe(2);
  });

  test("8-bit diff clusters at threshold=10 but not at threshold=5", async () => {
    const a = makeCandidate({ phash: HASH_ZEROS });
    const b = makeCandidate({ phash: HASH_8BITS, url: "https://example.com/8bit.jpg" });

    const r10 = await batchClusterByPhash([a, b], { hammingThreshold: 10 });
    expect(r10.clusters).toHaveLength(1);

    const r5 = await batchClusterByPhash([a, b], { hammingThreshold: 5 });
    expect(r5.clusters).toHaveLength(2);
  });

  test("transitive single-linkage: A-B and B-C cluster → A, B, C together", async () => {
    // A=HASH_ZEROS, B=HASH_NEAR (1 bit from A), C is 1 bit from B (so 2 bits from A)
    const HASH_C = "0000000000000011"; // 2 bits from HASH_ZEROS, 1 bit from HASH_NEAR
    const a = makeCandidate({ phash: HASH_ZEROS });
    const b = makeCandidate({ phash: HASH_NEAR, url: "https://example.com/b.jpg" });
    const c = makeCandidate({ phash: HASH_C, url: "https://example.com/c.jpg" });

    const result = await batchClusterByPhash([a, b, c], { hammingThreshold: 2 });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.size).toBe(3);
  });
});

describe("batchClusterByPhash — representative ranking", () => {
  test("lower LICENSE_RANK wins representative slot", async () => {
    const cc0 = makeCandidate({
      phash: HASH_ZEROS,
      license: "CC0",
      confidence: 0.9,
      url: "https://example.com/cc0.jpg",
    });
    const unknown = makeCandidate({
      phash: HASH_ZEROS,
      license: "UNKNOWN",
      confidence: 0.9,
      url: "https://example.com/unknown.jpg",
    });

    const result = await batchClusterByPhash([unknown, cc0], { hammingThreshold: 0 });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.representative.license).toBe("CC0");
  });

  test("higher confidence wins when license rank is equal", async () => {
    const low = makeCandidate({
      phash: HASH_ZEROS,
      url: "https://example.com/low.jpg",
      phashResult: { hash: HASH_ZEROS, algorithm: "dct-phash", confidence: 0.6 },
      confidence: 0.6,
    });
    const high = makeCandidate({
      phash: HASH_ZEROS,
      url: "https://example.com/high.jpg",
      phashResult: { hash: HASH_ZEROS, algorithm: "dct-phash", confidence: 1.0 },
      confidence: 1.0,
    });

    const result = await batchClusterByPhash([low, high], { hammingThreshold: 0 });
    expect(result.clusters[0]!.representative.url).toBe("https://example.com/high.jpg");
  });

  test("higher resolution wins when license and confidence are equal", async () => {
    const small = makeCandidate({
      phash: HASH_ZEROS,
      url: "https://example.com/small.jpg",
      width: 100,
      height: 100,
    });
    const large = makeCandidate({
      phash: HASH_ZEROS,
      url: "https://example.com/large.jpg",
      width: 4000,
      height: 3000,
    });

    const result = await batchClusterByPhash([small, large], { hammingThreshold: 0 });
    expect(result.clusters[0]!.representative.url).toBe("https://example.com/large.jpg");
  });

  test("higher-priority provider wins when other signals are equal", async () => {
    const bing = makeCandidate({
      phash: HASH_ZEROS,
      url: "https://example.com/bing.jpg",
      source: "bing",
    });
    const wiki = makeCandidate({
      phash: HASH_ZEROS,
      url: "https://example.com/wiki.jpg",
      source: "wikimedia",
    });

    const result = await batchClusterByPhash([bing, wiki], { hammingThreshold: 0 });
    expect(result.clusters[0]!.representative.source).toBe("wikimedia");
  });
});

describe("batchClusterByPhash — confidence decay", () => {
  test("decay=false does not alter ranking", async () => {
    const ONE_HOUR_AGO = Date.now() - 3_600_000;
    const stale = makeCandidate({
      phash: HASH_ZEROS,
      url: "https://example.com/stale.jpg",
      source: "bing",
      phashResult: { hash: HASH_ZEROS, algorithm: "dct-phash", confidence: 1.0 },
      confidence: 1.0,
      raw: { _cachedAt: ONE_HOUR_AGO },
    });
    const fresh = makeCandidate({
      phash: HASH_ZEROS,
      url: "https://example.com/fresh.jpg",
      source: "bing",
      phashResult: { hash: HASH_ZEROS, algorithm: "dct-phash", confidence: 0.8 },
      confidence: 0.8,
    });

    // Without decay, stale has higher raw confidence so wins.
    const result = await batchClusterByPhash([fresh, stale], {
      hammingThreshold: 0,
      confidenceDecay: false,
    });
    expect(result.clusters[0]!.representative.url).toBe("https://example.com/stale.jpg");
  });

  test("decay=true demotes stale candidate when freshness tips the score", async () => {
    const TWENTY_HOURS_AGO = Date.now() - 20 * 3_600_000;
    // Stale confidence starts at 1.0 but decays 20 * 0.02 = 0.4 → effective 0.6
    const stale = makeCandidate({
      phash: HASH_ZEROS,
      url: "https://example.com/stale.jpg",
      source: "bing",
      phashResult: { hash: HASH_ZEROS, algorithm: "dct-phash", confidence: 1.0 },
      confidence: 1.0,
      raw: { _cachedAt: TWENTY_HOURS_AGO },
    });
    // Fresh confidence 0.9 — no decay applied.
    const fresh = makeCandidate({
      phash: HASH_ZEROS,
      url: "https://example.com/fresh.jpg",
      source: "bing",
      phashResult: { hash: HASH_ZEROS, algorithm: "dct-phash", confidence: 0.9 },
      confidence: 0.9,
    });

    const result = await batchClusterByPhash([stale, fresh], {
      hammingThreshold: 0,
      confidenceDecay: true,
    });
    // With decay, stale effective conf ≈ 0.6 < fresh 0.9 → fresh should win.
    expect(result.clusters[0]!.representative.url).toBe("https://example.com/fresh.jpg");
  });

  test("decay applied to non-negative floor (confidence never below 0)", async () => {
    const ANCIENT = Date.now() - 1_000 * 3_600_000; // 1000 hours ago
    const ancient = makeCandidate({
      phash: HASH_ZEROS,
      phashResult: { hash: HASH_ZEROS, algorithm: "dct-phash", confidence: 0.5 },
      confidence: 0.5,
      raw: { _cachedAt: ANCIENT },
    });
    // Should not throw and candidate should still be valid (confidence ≥ 0).
    const result = await batchClusterByPhash([ancient], { confidenceDecay: true });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.topScore).toBeGreaterThanOrEqual(0);
  });
});

describe("batchClusterByPhash — metrics", () => {
  test("dedupeRate = 0 when all candidates are unique", async () => {
    const a = makeCandidate({ phash: HASH_ZEROS });
    const b = makeCandidate({ phash: HASH_ONES, url: "https://example.com/b.jpg" });
    const result = await batchClusterByPhash([a, b], { hammingThreshold: 5 });
    expect(result.dedupeRate).toBe(0);
  });

  test("dedupeRate = 1 when all candidates collapse into one cluster", async () => {
    const a = makeCandidate({ phash: HASH_ZEROS });
    const b = makeCandidate({ phash: HASH_ZEROS, url: "https://example.com/b.jpg" });
    const c = makeCandidate({ phash: HASH_ZEROS, url: "https://example.com/c.jpg" });
    const result = await batchClusterByPhash([a, b, c], { hammingThreshold: 0 });
    expect(result.dedupeRate).toBe(1);
  });

  test("avgClusterSize is 2 for two pairs of duplicates", async () => {
    const a1 = makeCandidate({ phash: HASH_ZEROS });
    const a2 = makeCandidate({ phash: HASH_ZEROS, url: "https://example.com/a2.jpg" });
    const b1 = makeCandidate({ phash: HASH_ONES, url: "https://example.com/b1.jpg" });
    const b2 = makeCandidate({ phash: HASH_ONES, url: "https://example.com/b2.jpg" });

    const result = await batchClusterByPhash([a1, a2, b1, b2], { hammingThreshold: 0 });
    expect(result.clusters).toHaveLength(2);
    expect(result.clusterMetrics.avgClusterSize).toBe(2);
    expect(result.clusterMetrics.lonelyCount).toBe(0);
  });

  test("discardedCount includes both low-confidence and no-hash candidates", async () => {
    const good = makeCandidate({ phash: HASH_ZEROS });
    const noHash: ImageCandidate = {
      url: "https://example.com/no-hash.jpg",
      source: "wikimedia",
      license: "CC0",
    };
    const lowConf = makeCandidate({
      phash: HASH_NEAR,
      url: "https://example.com/low.jpg",
      phashResult: { hash: HASH_NEAR, algorithm: "ahash-fallback", confidence: 0.1 },
    });

    const result = await batchClusterByPhash([good, noHash, lowConf]);
    expect(result.clusterMetrics.discardedCount).toBe(2);
    expect(result.clusters).toHaveLength(1);
  });
});

describe("batchClusterByPhash — minClusterSize", () => {
  test("minClusterSize=2 excludes singletons from output clusters", async () => {
    const singleton = makeCandidate({ phash: HASH_ZEROS });
    const p1 = makeCandidate({ phash: HASH_ONES, url: "https://example.com/p1.jpg" });
    const p2 = makeCandidate({ phash: HASH_ONES, url: "https://example.com/p2.jpg" });

    const result = await batchClusterByPhash([singleton, p1, p2], {
      hammingThreshold: 0,
      minClusterSize: 2,
    });

    // singleton is excluded; the pair survives
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.size).toBe(2);
    // lonelyCount should still reflect the singleton
    expect(result.clusterMetrics.lonelyCount).toBe(1);
  });
});

describe("batchClusterByPhash — bare phash string handling", () => {
  test("candidate with bare phash (no phashResult) is clustered correctly", async () => {
    const bare: ImageCandidate = {
      url: "https://example.com/bare.jpg",
      source: "wikimedia",
      license: "CC0",
      confidence: 0.9,
      phash: HASH_ZEROS,
      // No phashResult set — module should synthesise it
    };
    const full = makeCandidate({ phash: HASH_ZEROS, url: "https://example.com/full.jpg" });

    const result = await batchClusterByPhash([bare, full], { hammingThreshold: 0 });
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.size).toBe(2);
  });
});
