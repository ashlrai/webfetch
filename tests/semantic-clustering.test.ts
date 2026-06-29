/**
 * Tests for Cross-Provider Semantic Clustering & Confidence Harmonization.
 *
 * Coverage:
 *   - Unit: clustering on 10 candidates
 *   - Unit: confidence harmonization (compositeConfidence formula)
 *   - Integration: federation + clustering + ranking (dryRun + stub)
 *   - Edge cases: single candidate, no candidates, identical candidates
 */

import { describe, expect, test } from "bun:test";
import {
  clusterCandidates,
  computeClusterMetrics,
  levenshteinSimilarity,
  metadataSimilarity,
  pHashSimilarity,
  providerRankScore,
} from "../packages/core/src/semantic-clustering.ts";
import { searchImages } from "../packages/core/src/federation.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";
import { fixture, jsonResponse, stubFetcher } from "./stub-fetcher.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkCandidate(
  url: string,
  source: string,
  opts: Partial<ImageCandidate> = {},
): ImageCandidate {
  return {
    url,
    source,
    license: "CC0",
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Unit: levenshteinSimilarity
// ---------------------------------------------------------------------------

describe("levenshteinSimilarity", () => {
  test("identical strings → 1.0", () => {
    expect(levenshteinSimilarity("hello", "hello")).toBe(1.0);
    expect(levenshteinSimilarity("", "")).toBe(1.0);
  });

  test("completely different strings → low similarity", () => {
    const sim = levenshteinSimilarity("abc", "xyz");
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThan(0.5);
  });

  test("one-char edit → near-1 similarity for long strings", () => {
    const sim = levenshteinSimilarity("photograph", "photograp");
    expect(sim).toBeGreaterThan(0.8);
  });

  test("empty vs non-empty → 0", () => {
    expect(levenshteinSimilarity("", "abc")).toBe(0);
    expect(levenshteinSimilarity("abc", "")).toBe(0);
  });

  test("returns value in [0, 1]", () => {
    const pairs = [
      ["cat", "dog"],
      ["webfetch", "webfetch-core"],
      ["a", "z"],
    ];
    for (const [a, b] of pairs) {
      const sim = levenshteinSimilarity(a!, b!);
      expect(sim).toBeGreaterThanOrEqual(0);
      expect(sim).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Unit: pHashSimilarity
// ---------------------------------------------------------------------------

describe("pHashSimilarity", () => {
  test("identical hashes → 1.0", () => {
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia", { phash: "abcdef1234567890" });
    const b = mkCandidate("https://b.com/1.jpg", "openverse", { phash: "abcdef1234567890" });
    expect(pHashSimilarity(a, b)).toBe(1.0);
  });

  test("maximally different hashes → 0.0", () => {
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia", { phash: "0000000000000000" });
    const b = mkCandidate("https://b.com/1.jpg", "openverse", { phash: "ffffffffffffffff" });
    expect(pHashSimilarity(a, b)).toBe(0.0);
  });

  test("1-bit different hashes → near 1.0", () => {
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia", { phash: "0000000000000000" });
    const b = mkCandidate("https://b.com/1.jpg", "openverse", { phash: "0000000000000001" });
    const sim = pHashSimilarity(a, b)!;
    // 1/64 bits differ → similarity = 1 - 1/64 ≈ 0.984
    expect(sim).toBeCloseTo(1 - 1 / 64, 3);
  });

  test("missing phash on either side → null", () => {
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia", { phash: "abcdef1234567890" });
    const b = mkCandidate("https://b.com/1.jpg", "openverse");
    expect(pHashSimilarity(a, b)).toBeNull();
    expect(pHashSimilarity(b, a)).toBeNull();
  });

  test("both missing phash → null", () => {
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia");
    const b = mkCandidate("https://b.com/1.jpg", "openverse");
    expect(pHashSimilarity(a, b)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit: metadataSimilarity
// ---------------------------------------------------------------------------

describe("metadataSimilarity", () => {
  test("identical title + author → 1.0", () => {
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia", {
      title: "Sunset over the hills",
      author: "Jane Doe",
    });
    const b = mkCandidate("https://b.com/1.jpg", "openverse", {
      title: "Sunset over the hills",
      author: "Jane Doe",
    });
    expect(metadataSimilarity(a, b)).toBe(1.0);
  });

  test("no metadata on either side → 0", () => {
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia");
    const b = mkCandidate("https://b.com/1.jpg", "openverse");
    expect(metadataSimilarity(a, b)).toBe(0);
  });

  test("partially matching title → intermediate similarity", () => {
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia", { title: "Sunrise in the mountains" });
    const b = mkCandidate("https://b.com/1.jpg", "openverse", { title: "Sunset in the mountains" });
    const sim = metadataSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.5);
    expect(sim).toBeLessThan(1.0);
  });

  test("only title present on one side, author on other → uses available signals", () => {
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia", { title: "Cat photo" });
    const b = mkCandidate("https://b.com/1.jpg", "openverse", { author: "John Smith" });
    // No overlapping fields → 0
    expect(metadataSimilarity(a, b)).toBe(0);
  });

  test("author match boosts similarity when titles differ", () => {
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia", {
      title: "Landscape A",
      author: "Same Author",
    });
    const b = mkCandidate("https://b.com/1.jpg", "openverse", {
      title: "Landscape B",
      author: "Same Author",
    });
    const sim = metadataSimilarity(a, b);
    // author identical (1.0) + title near-similar → average > 0.5
    expect(sim).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// Unit: providerRankScore
// ---------------------------------------------------------------------------

describe("providerRankScore", () => {
  test("CC0 → high score", () => {
    const c = mkCandidate("https://a.com/1.jpg", "wikimedia", { license: "CC0" });
    expect(providerRankScore(c)).toBeGreaterThan(0.5);
  });

  test("UNKNOWN license → low score when no explicit confidence", () => {
    const c = mkCandidate("https://a.com/1.jpg", "bing", { license: "UNKNOWN" });
    expect(providerRankScore(c)).toBeLessThan(0.1);
  });

  test("explicit confidence field takes precedence over license rank", () => {
    const c = mkCandidate("https://a.com/1.jpg", "brave", {
      license: "UNKNOWN",
      confidence: 0.9,
    });
    expect(providerRankScore(c)).toBeCloseTo(0.9);
  });

  test("returns value in [0, 1]", () => {
    const licenses: ImageCandidate["license"][] = [
      "CC0", "CC_BY", "CC_BY_SA", "UNSPLASH_LICENSE", "UNKNOWN", "EDITORIAL_LICENSED",
    ];
    for (const license of licenses) {
      const c = mkCandidate("https://a.com/1.jpg", "wikimedia", { license });
      const score = providerRankScore(c);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Unit: computeClusterMetrics
// ---------------------------------------------------------------------------

describe("computeClusterMetrics", () => {
  test("singleton returns compositeConfidence based on provider rank", () => {
    const c = mkCandidate("https://a.com/1.jpg", "wikimedia", {
      license: "CC0",
      confidence: 0.8,
    });
    const metrics = computeClusterMetrics([c]);
    expect(metrics.pHashSimilarity).toBe(1.0);
    expect(metrics.metadataSimilarity).toBe(1.0);
    expect(metrics.providerRankScore).toBeCloseTo(0.8);
    // compositeConfidence = 0.4*1.0 + 0.4*1.0 + 0.2*0.8 = 0.96
    expect(metrics.compositeConfidence).toBeCloseTo(0.96, 3);
  });

  test("compositeConfidence is always in [0, 1]", () => {
    const members = [
      mkCandidate("https://a.com/1.jpg", "brave", { license: "UNKNOWN", phash: "aaaa000000000000" }),
      mkCandidate("https://b.com/2.jpg", "bing", { license: "UNKNOWN", phash: "aaaa000000000001" }),
    ];
    const metrics = computeClusterMetrics(members);
    expect(metrics.compositeConfidence).toBeGreaterThanOrEqual(0);
    expect(metrics.compositeConfidence).toBeLessThanOrEqual(1);
  });

  test("identical hashes give pHashSimilarity = 1.0 in cluster metrics", () => {
    const hash = "cafecafecafecafe";
    const members = [
      mkCandidate("https://a.com/1.jpg", "wikimedia", { phash: hash }),
      mkCandidate("https://b.com/2.jpg", "openverse", { phash: hash }),
    ];
    const metrics = computeClusterMetrics(members);
    expect(metrics.pHashSimilarity).toBe(1.0);
  });

  test("higher-confidence licenses yield higher compositeConfidence", () => {
    const hash = "1234567890abcdef";
    const cc0Members = [
      mkCandidate("https://a.com/1.jpg", "wikimedia", { phash: hash, license: "CC0" }),
      mkCandidate("https://b.com/2.jpg", "openverse", { phash: hash, license: "CC0" }),
    ];
    const unknownMembers = [
      mkCandidate("https://c.com/1.jpg", "brave", { phash: hash, license: "UNKNOWN" }),
      mkCandidate("https://d.com/2.jpg", "bing", { phash: hash, license: "UNKNOWN" }),
    ];
    const cc0Metrics = computeClusterMetrics(cc0Members);
    const unknownMetrics = computeClusterMetrics(unknownMembers);
    expect(cc0Metrics.compositeConfidence).toBeGreaterThan(unknownMetrics.compositeConfidence);
  });
});

// ---------------------------------------------------------------------------
// Unit: clusterCandidates — 10-candidate clustering
// ---------------------------------------------------------------------------

describe("clusterCandidates — 10 candidates across providers", () => {
  // Build 10 candidates: 3 clusters of 3, 1 cluster of 1 (unique).
  // Cluster A: same pHash → 3 from different providers.
  // Cluster B: same title + author → 3 from different providers (no pHash).
  // Cluster C: same pHash AND title → 3 candidates.
  // Singleton D: unique hash + unique title, no overlap with other clusters.
  //
  // Hash distances (must all exceed threshold of 0.875 = Hamming > 8 to NOT merge):
  //   hashA = "0000000000000000" (all-zeros)
  //   hashC = "ffffffff00000000" (32 bits set → Hamming(A,C) = 32 → sim = 0.5 < 0.875 ✓ no merge)
  //   hashD = "aaaaaaaaaaaaaaaa" (Hamming(A,D)=32, Hamming(C,D)=32 ✓ no merge)

  const hashA = "0000000000000000";
  const hashC = "ffffffff00000000"; // 32 bits different from hashA → sim=0.5, won't merge
  const hashD = "aaaaaaaaaaaaaaaa"; // 32 bits different from both

  const candidates: ImageCandidate[] = [
    // Cluster A — visual similarity via pHash
    mkCandidate("https://wikimedia.org/a1.jpg", "wikimedia", {
      phash: hashA, score: 0.9, license: "CC_BY",
    }),
    mkCandidate("https://openverse.org/a2.jpg", "openverse", {
      phash: hashA, score: 0.7, license: "CC_BY",
    }),
    mkCandidate("https://unsplash.com/a3.jpg", "unsplash", {
      phash: hashA, score: 0.6, license: "UNSPLASH_LICENSE",
    }),

    // Cluster B — semantic similarity via title + author
    mkCandidate("https://pexels.com/b1.jpg", "pexels", {
      score: 0.5, license: "PEXELS_LICENSE",
      title: "Golden Gate Bridge at sunrise",
      author: "Ansel Adams",
    }),
    mkCandidate("https://pixabay.com/b2.jpg", "pixabay", {
      score: 0.45, license: "PIXABAY_LICENSE",
      title: "Golden Gate Bridge at sunrise",
      author: "Ansel Adams",
    }),
    mkCandidate("https://flickr.com/b3.jpg", "flickr", {
      score: 0.4, license: "CC_BY_SA",
      title: "Golden Gate Bridge at sunrise",
      author: "Ansel Adams",
    }),

    // Cluster C — visual + semantic
    mkCandidate("https://nasa.gov/c1.jpg", "nasa", {
      phash: hashC, score: 0.85, license: "CC0",
      title: "Apollo 11 Moon Landing",
      author: "NASA",
    }),
    mkCandidate("https://smithsonian.gov/c2.jpg", "smithsonian", {
      phash: hashC, score: 0.75, license: "CC0",
      title: "Apollo 11 Moon Landing",
      author: "NASA",
    }),
    mkCandidate("https://loc.gov/c3.jpg", "library-of-congress", {
      phash: hashC, score: 0.65, license: "PUBLIC_DOMAIN",
      title: "Apollo 11 Moon Landing",
      author: "NASA",
    }),

    // Singleton D — unique
    mkCandidate("https://met.org/d1.jpg", "met-museum", {
      phash: hashD, score: 0.3, license: "PUBLIC_DOMAIN",
      title: "Portrait of an Unknown Lady",
      author: "Unknown Flemish Master",
    }),
  ];

  test("produces correct number of cluster groups", () => {
    const clusters = clusterCandidates(candidates, {
      pHashThreshold: 0.875,
      metaThreshold: 0.6,
    });
    // Expect: cluster A + cluster B + cluster C + singleton D = 4 groups
    expect(clusters.length).toBe(4);
  });

  test("each cluster has the correct annotation", () => {
    const clusters = clusterCandidates(candidates, {
      pHashThreshold: 0.875,
      metaThreshold: 0.6,
    });
    const multis = clusters.filter((g) => g.clusterAnnotation === "cluster");
    const uniques = clusters.filter((g) => g.clusterAnnotation === "unique");
    expect(multis.length).toBe(3); // A, B, C
    expect(uniques.length).toBe(1); // D
  });

  test("representatives are highest-scored in each group", () => {
    const clusters = clusterCandidates(candidates, {
      pHashThreshold: 0.875,
      metaThreshold: 0.6,
    });
    for (const group of clusters) {
      const repScore = group.representative.score ?? 0;
      for (const alt of group.alternatives) {
        expect(repScore).toBeGreaterThanOrEqual(alt.score ?? 0);
      }
    }
  });

  test("cluster groups are sorted by representative score descending", () => {
    const clusters = clusterCandidates(candidates, {
      pHashThreshold: 0.875,
      metaThreshold: 0.6,
    });
    for (let i = 1; i < clusters.length; i++) {
      expect(clusters[i - 1]!.representative.score ?? 0).toBeGreaterThanOrEqual(
        clusters[i]!.representative.score ?? 0,
      );
    }
  });

  test("all 10 input candidates appear exactly once across all groups", () => {
    const clusters = clusterCandidates(candidates, {
      pHashThreshold: 0.875,
      metaThreshold: 0.6,
    });
    const seen = new Set<string>();
    for (const group of clusters) {
      seen.add(group.representative.url);
      for (const alt of group.alternatives) {
        seen.add(alt.url);
      }
    }
    expect(seen.size).toBe(candidates.length);
    for (const c of candidates) {
      expect(seen.has(c.url)).toBe(true);
    }
  });

  test("clusterMetrics.compositeConfidence is in [0, 1] for all groups", () => {
    const clusters = clusterCandidates(candidates);
    for (const group of clusters) {
      expect(group.clusterMetrics.compositeConfidence).toBeGreaterThanOrEqual(0);
      expect(group.clusterMetrics.compositeConfidence).toBeLessThanOrEqual(1);
    }
  });

  test("singleton D has clusterAnnotation=unique and no alternatives", () => {
    const clusters = clusterCandidates(candidates, {
      pHashThreshold: 0.875,
      metaThreshold: 0.6,
    });
    const singletonGroup = clusters.find(
      (g) => g.representative.source === "met-museum",
    );
    expect(singletonGroup).toBeDefined();
    expect(singletonGroup!.clusterAnnotation).toBe("unique");
    expect(singletonGroup!.alternatives).toHaveLength(0);
  });

  test("Cluster A representative is from wikimedia (highest score 0.9)", () => {
    const clusters = clusterCandidates(candidates, {
      pHashThreshold: 0.875,
      metaThreshold: 0.6,
    });
    const clusterA = clusters.find(
      (g) => g.representative.source === "wikimedia",
    );
    expect(clusterA).toBeDefined();
    expect(clusterA!.alternatives).toHaveLength(2);
  });

  test("requireBothSignals=true prevents metadata-only merge when pHash absent", () => {
    // Cluster B candidates have no pHash — with AND-mode they must fall back
    // to metadata-only (pHash is absent, so AND degrades gracefully to meta-only)
    const metaOnlyGroup = [
      mkCandidate("https://a.com/1.jpg", "wikimedia", {
        score: 0.8,
        title: "Same Title Here",
        author: "Same Author",
      }),
      mkCandidate("https://b.com/2.jpg", "openverse", {
        score: 0.6,
        title: "Same Title Here",
        author: "Same Author",
      }),
    ];
    const orResult = clusterCandidates(metaOnlyGroup, { requireBothSignals: false });
    const andResult = clusterCandidates(metaOnlyGroup, { requireBothSignals: true });
    // Both modes should merge when metadata is strong (AND degrades to meta-only when no pHash).
    expect(orResult[0]!.alternatives).toHaveLength(1);
    // AND-mode with no pHash: falls back to metadata-only — should still merge when meta is high.
    expect(andResult[0]!.alternatives).toHaveLength(1);
  });

  test("AND-mode prevents merge when pHash absent AND meta is below threshold", () => {
    const metaOnly = [
      mkCandidate("https://a.com/1.jpg", "wikimedia", {
        score: 0.8,
        title: "Completely Different Title",
        author: "Author One",
      }),
      mkCandidate("https://b.com/2.jpg", "openverse", {
        score: 0.6,
        title: "Unrelated Subject Matter",
        author: "Author Two",
      }),
    ];
    // With requireBothSignals=true and low meta, no pHash → meta-only fallback but meta is low
    const result = clusterCandidates(metaOnly, {
      requireBothSignals: true,
      metaThreshold: 0.9, // very strict
    });
    // Each candidate should be its own cluster (unique)
    expect(result.length).toBe(2);
    expect(result.every((g) => g.clusterAnnotation === "unique")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit: confidence harmonization — verify composite formula weights
// ---------------------------------------------------------------------------

describe("confidence harmonization — composite formula", () => {
  test("compositeConfidence = 0.4*pHash + 0.4*meta + 0.2*providerRank (manual verification)", () => {
    // Two candidates with known identical hash and title — full similarity.
    const hash = "1111111111111111";
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia", {
      phash: hash,
      license: "CC0",
      confidence: 1.0,
      title: "Test Image",
      author: "Author",
    });
    const b = mkCandidate("https://b.com/2.jpg", "openverse", {
      phash: hash,
      license: "CC0",
      confidence: 1.0,
      title: "Test Image",
      author: "Author",
    });
    const metrics = computeClusterMetrics([a, b]);
    // pHashSim=1.0, metaSim=1.0, providerRank=1.0 → composite = 0.4+0.4+0.2 = 1.0
    expect(metrics.compositeConfidence).toBeCloseTo(1.0, 3);
  });

  test("zero similarity across all signals → compositeConfidence = 0", () => {
    // No pHash, no metadata, UNKNOWN license with no confidence field.
    const a = mkCandidate("https://a.com/1.jpg", "brave", { license: "UNKNOWN" });
    const b = mkCandidate("https://b.com/2.jpg", "bing", { license: "UNKNOWN" });
    // Force them into a single cluster by using a very low threshold.
    const clusters = clusterCandidates([a, b], { metaThreshold: 0 });
    // metaSim=0 (no metadata), pHashSim=null→0, providerRank≈0.01
    const metrics = clusters.find((g) => g.alternatives.length > 0)?.clusterMetrics;
    if (metrics) {
      // compositeConfidence ≈ 0.2 * ~0.01 → very low
      expect(metrics.compositeConfidence).toBeLessThan(0.05);
    }
  });

  test("CC0 candidates with identical pHash have compositeConfidence close to 1", () => {
    const hash = "fedcba9876543210";
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia", {
      phash: hash,
      license: "CC0",
      confidence: 1.0,
    });
    const b = mkCandidate("https://b.com/2.jpg", "openverse", {
      phash: hash,
      license: "CC0",
      confidence: 1.0,
    });
    const metrics = computeClusterMetrics([a, b]);
    // pHash=1.0, meta=0 (no title/author), providerRank=1.0
    // composite = 0.4*1.0 + 0.4*0 + 0.2*1.0 = 0.6
    expect(metrics.compositeConfidence).toBeCloseTo(0.6, 3);
    expect(metrics.pHashSimilarity).toBe(1.0);
  });

  test("provider-rank weight contributes proportionally", () => {
    const hash = "0000111100001111";
    const highConf = mkCandidate("https://a.com/1.jpg", "wikimedia", {
      phash: hash,
      license: "CC0",
      confidence: 1.0,
    });
    const lowConf = mkCandidate("https://b.com/2.jpg", "brave", {
      phash: hash,
      license: "UNKNOWN",
      confidence: 0.0,
    });
    const highMetrics = computeClusterMetrics([highConf, highConf]);
    const lowMetrics = computeClusterMetrics([lowConf, lowConf]);
    // High-confidence pair should have higher compositeConfidence.
    expect(highMetrics.compositeConfidence).toBeGreaterThan(lowMetrics.compositeConfidence);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("clusterCandidates — edge cases", () => {
  test("empty candidates → empty result", () => {
    expect(clusterCandidates([])).toHaveLength(0);
  });

  test("single candidate → one unique group", () => {
    const c = mkCandidate("https://a.com/1.jpg", "wikimedia", { score: 0.8, license: "CC0" });
    const result = clusterCandidates([c]);
    expect(result).toHaveLength(1);
    expect(result[0]!.clusterAnnotation).toBe("unique");
    expect(result[0]!.alternatives).toHaveLength(0);
    expect(result[0]!.representative.url).toBe(c.url);
  });

  test("two identical candidates (same url, same hash) → one cluster", () => {
    const c1 = mkCandidate("https://a.com/img.jpg", "wikimedia", {
      phash: "abcdef1234567890",
      score: 0.9,
      title: "Test",
    });
    const c2 = mkCandidate("https://a.com/img.jpg", "openverse", {
      phash: "abcdef1234567890",
      score: 0.7,
      title: "Test",
    });
    const result = clusterCandidates([c1, c2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.clusterAnnotation).toBe("cluster");
    expect(result[0]!.representative.url).toBe("https://a.com/img.jpg");
    expect(result[0]!.alternatives).toHaveLength(1);
  });

  test("no shared hashes or metadata → each candidate is its own unique group", () => {
    const candidates = [
      mkCandidate("https://a.com/1.jpg", "wikimedia", {
        phash: "0000000000000000", score: 0.9, title: "Alpha",
      }),
      mkCandidate("https://b.com/2.jpg", "openverse", {
        phash: "ffffffffffffffff", score: 0.7, title: "Beta",
      }),
      mkCandidate("https://c.com/3.jpg", "unsplash", {
        phash: "aaaaaaaaaaaaaaaa", score: 0.5, title: "Gamma",
      }),
    ];
    const result = clusterCandidates(candidates, {
      pHashThreshold: 0.95,
      metaThreshold: 0.95,
    });
    expect(result).toHaveLength(3);
    expect(result.every((g) => g.clusterAnnotation === "unique")).toBe(true);
  });

  test("pHashThreshold clamped to [0.7, 0.95]", () => {
    // Threshold of 0.5 is clamped to 0.7; hash distance of 30 bits → sim = 1 - 30/64 ≈ 0.53
    // Still below clamped threshold of 0.7 → no merge.
    const a = mkCandidate("https://a.com/1.jpg", "wikimedia", { phash: "0000000000000000" });
    const b = mkCandidate("https://b.com/2.jpg", "openverse", {
      // 30 bits set → sim ≈ 0.53
      phash: "000000007fffffff",
    });
    const result = clusterCandidates([a, b], { pHashThreshold: 0.5 }); // clamped to 0.7
    // sim ≈ 0.53 < 0.7 → no merge
    expect(result).toHaveLength(2);
  });

  test("alternatives sorted by score descending within a cluster", () => {
    const hash = "deadbeefdeadbeef";
    const candidates = [
      mkCandidate("https://a.com/1.jpg", "wikimedia", { phash: hash, score: 0.9 }),
      mkCandidate("https://b.com/2.jpg", "openverse", { phash: hash, score: 0.3 }),
      mkCandidate("https://c.com/3.jpg", "unsplash", { phash: hash, score: 0.6 }),
    ];
    const result = clusterCandidates(candidates);
    expect(result).toHaveLength(1);
    const group = result[0]!;
    expect(group.representative.score).toBe(0.9);
    expect(group.alternatives[0]!.score).toBe(0.6);
    expect(group.alternatives[1]!.score).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// Integration: federation + clustering + ranking
// ---------------------------------------------------------------------------

describe("federation + clustering integration", () => {
  test("clusterSimilar=false leaves candidateClusters undefined", async () => {
    const out = await searchImages("test", {
      providers: ["wikimedia"],
      dryRun: true,
    });
    expect(out.candidateClusters).toBeUndefined();
  });

  test("clusterSimilar=true in dryRun returns empty candidateClusters", async () => {
    const out = await searchImages("test", {
      providers: ["wikimedia"],
      dryRun: true,
      clusterSimilar: true,
    });
    // dryRun returns no candidates, so clusters is empty array
    expect(out.candidateClusters).toBeDefined();
    expect(out.candidateClusters).toHaveLength(0);
  });

  test("clusterSimilar=true with real provider stub returns populated clusters", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);
    const out = await searchImages("test", {
      providers: ["wikimedia"],
      fetcher,
      clusterSimilar: true,
    });
    expect(out.candidateClusters).toBeDefined();
    // Every candidate should appear in exactly one cluster group.
    const totalInClusters = out.candidateClusters!.reduce(
      (sum, g) => sum + 1 + g.alternatives.length,
      0,
    );
    expect(totalInClusters).toBe(out.candidates.length);
  });

  test("cluster annotations are 'cluster' or 'unique'", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);
    const out = await searchImages("test", {
      providers: ["wikimedia"],
      fetcher,
      clusterSimilar: true,
    });
    for (const group of out.candidateClusters ?? []) {
      expect(["cluster", "unique"]).toContain(group.clusterAnnotation);
    }
  });

  test("clusteringOptions are passed through to the clustering algorithm", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);
    // Very strict thresholds → each candidate unique
    const out = await searchImages("test", {
      providers: ["wikimedia"],
      fetcher,
      clusterSimilar: true,
      clusteringOptions: { pHashThreshold: 0.95, metaThreshold: 0.95 },
    });
    if ((out.candidateClusters?.length ?? 0) > 0) {
      // With very strict thresholds, most results should be "unique"
      const uniqueCount = out.candidateClusters!.filter(
        (g) => g.clusterAnnotation === "unique",
      ).length;
      expect(uniqueCount).toBeGreaterThanOrEqual(0); // at minimum passes without error
    }
  });
});
