/**
 * Cross-provider duplicate detection tests for `compareCandidates()`.
 *
 * Covers:
 *  - URL-duplicate clusters across providers
 *  - pHash-duplicate clusters (exact and near-duplicate)
 *  - Mixed bundles (some URL dupes + some pHash dupes)
 *  - No-duplicate bundles (merged === all candidates)
 *  - Representative selection (highest score wins)
 *  - Confidence values (url → 1.0; phash → based on algorithm quality)
 *  - hammingThreshold option
 *  - Empty candidates array edge case
 *  - Output shape matches ProviderDedupeReport type contract
 */

import { describe, expect, test } from "bun:test";
import { compareCandidates } from "../packages/core/src/dedupe.ts";
import type {
  ImageCandidate,
  ProviderDedupeReport,
  SearchResultBundle,
} from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mk(
  url: string,
  source: string,
  opts: Partial<Pick<ImageCandidate, "phash" | "phashResult" | "score">> = {},
): ImageCandidate {
  return {
    url,
    source,
    license: "CC0",
    ...opts,
  };
}

function bundle(...candidates: ImageCandidate[]): SearchResultBundle {
  return { candidates, providerReports: [], warnings: [] };
}

// ---------------------------------------------------------------------------
// URL duplicate detection
// ---------------------------------------------------------------------------

describe("URL duplicate detection", () => {
  test("identical URLs from two providers form a url group with confidence 1.0", () => {
    const b = bundle(
      mk("https://example.com/img.jpg", "wikimedia"),
      mk("https://example.com/img.jpg", "openverse"),
    );
    const report: ProviderDedupeReport = compareCandidates(b);

    expect(report.duplicateGroups).toHaveLength(1);
    const grp = report.duplicateGroups[0]!;
    expect(grp.reason).toBe("url");
    expect(grp.confidence).toBe(1.0);
    expect(grp.members).toHaveLength(2);
    expect(grp.members.map((m) => m.provider).sort()).toEqual(["openverse", "wikimedia"]);
  });

  test("URL deduplication strips cache-buster query params", () => {
    const b = bundle(
      mk("https://cdn.example.com/photo.jpg?w=200&q=80", "unsplash"),
      mk("https://cdn.example.com/photo.jpg?w=1600&fit=crop", "pexels"),
      mk("https://cdn.example.com/photo.jpg", "pixabay"),
    );
    const report = compareCandidates(b);

    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.duplicateGroups[0]!.members).toHaveLength(3);
    expect(report.duplicateGroups[0]!.reason).toBe("url");
    expect(report.merged).toHaveLength(1);
  });

  test("different URLs produce no url duplicate groups", () => {
    const b = bundle(
      mk("https://a.com/1.jpg", "wikimedia"),
      mk("https://b.com/2.jpg", "openverse"),
    );
    const report = compareCandidates(b);
    expect(report.duplicateGroups).toHaveLength(0);
    expect(report.merged).toHaveLength(2);
  });

  test("three providers return same URL → single group with three members", () => {
    const b = bundle(
      mk("https://shared.com/art.jpg", "wikimedia"),
      mk("https://shared.com/art.jpg", "openverse"),
      mk("https://shared.com/art.jpg", "unsplash"),
    );
    const report = compareCandidates(b);
    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.duplicateGroups[0]!.members).toHaveLength(3);
    expect(report.merged).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// pHash duplicate detection
// ---------------------------------------------------------------------------

describe("pHash duplicate detection", () => {
  test("identical phashes from two providers form a phash group", () => {
    const hash = "abcdef1234567890";
    const b = bundle(
      mk("https://a.com/img.jpg", "wikimedia", { phash: hash }),
      mk("https://b.com/img.jpg", "openverse", { phash: hash }),
    );
    const report = compareCandidates(b);

    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.duplicateGroups[0]!.reason).toBe("phash");
    expect(report.duplicateGroups[0]!.members).toHaveLength(2);
    expect(report.merged).toHaveLength(1);
  });

  test("near-duplicate phashes (hamming ≤ 6) form a phash group", () => {
    // Base hash: 0000000000000000 (all zeros)
    // Flip 1 bit:  0000000000000001 → hamming distance = 1
    const b = bundle(
      mk("https://a.com/img.jpg", "unsplash", { phash: "0000000000000000" }),
      mk("https://b.com/img.jpg", "pexels", { phash: "0000000000000001" }),
    );
    const report = compareCandidates(b);

    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.duplicateGroups[0]!.reason).toBe("phash");
  });

  test("distant phashes (hamming > 6) do NOT form a duplicate group", () => {
    const b = bundle(
      mk("https://a.com/img.jpg", "wikimedia", { phash: "0000000000000000" }),
      mk("https://b.com/img.jpg", "openverse", { phash: "ffffffffffffffff" }),
    );
    const report = compareCandidates(b);
    expect(report.duplicateGroups).toHaveLength(0);
    expect(report.merged).toHaveLength(2);
  });

  test("hammingThreshold option is respected", () => {
    // distance between these two is 2 bits
    const b = bundle(
      mk("https://a.com/img.jpg", "unsplash", { phash: "0000000000000000" }),
      mk("https://b.com/img.jpg", "pexels", { phash: "0000000000000003" }),
    );

    const strict = compareCandidates(b, { hammingThreshold: 1 });
    expect(strict.duplicateGroups).toHaveLength(0);

    const loose = compareCandidates(b, { hammingThreshold: 3 });
    expect(loose.duplicateGroups).toHaveLength(1);
  });

  test("phash confidence reflects algorithm quality (dct-phash → 1.0)", () => {
    const hash = "aabbccdd11223344";
    const b = bundle(
      mk("https://a.com/img.jpg", "wikimedia", {
        phash: hash,
        phashResult: { hash, algorithm: "dct-phash", confidence: 1.0 },
      }),
      mk("https://b.com/img.jpg", "openverse", {
        phash: hash,
        phashResult: { hash, algorithm: "dct-phash", confidence: 1.0 },
      }),
    );
    const report = compareCandidates(b);
    expect(report.duplicateGroups[0]!.confidence).toBe(1.0);
  });

  test("phash confidence reflects ahash-fallback (confidence 0.5)", () => {
    const hash = "aabbccdd11223344";
    const b = bundle(
      mk("https://a.com/img.jpg", "wikimedia", {
        phash: hash,
        phashResult: { hash, algorithm: "ahash-fallback", confidence: 0.5 },
      }),
      mk("https://b.com/img.jpg", "openverse", {
        phash: hash,
        phashResult: { hash, algorithm: "ahash-fallback", confidence: 0.5 },
      }),
    );
    const report = compareCandidates(b);
    // confidence = min(0.5, 0.5) = 0.5
    expect(report.duplicateGroups[0]!.confidence).toBe(0.5);
  });

  test("candidates without phash are not falsely grouped", () => {
    const b = bundle(
      mk("https://a.com/img.jpg", "wikimedia"),
      mk("https://b.com/img.jpg", "openverse"),
    );
    const report = compareCandidates(b);
    expect(report.duplicateGroups).toHaveLength(0);
    expect(report.merged).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Mixed bundles
// ---------------------------------------------------------------------------

describe("mixed URL + pHash duplicates", () => {
  test("URL group and phash group both detected independently", () => {
    const hash = "deadbeef01234567";
    const b = bundle(
      // URL duplicate pair
      mk("https://shared.com/logo.png", "wikimedia"),
      mk("https://shared.com/logo.png", "openverse"),
      // pHash duplicate pair (different URLs, same visual content)
      mk("https://cdn-a.com/photo.jpg", "unsplash", { phash: hash }),
      mk("https://cdn-b.com/photo.jpg", "pexels", { phash: hash }),
      // Unique candidate
      mk("https://unique.com/art.jpg", "pixabay"),
    );
    const report = compareCandidates(b);

    expect(report.duplicateGroups).toHaveLength(2);
    const reasons = report.duplicateGroups.map((g) => g.reason).sort();
    expect(reasons).toEqual(["phash", "url"]);
    // merged should have 3 representatives (url-group, phash-group, unique)
    expect(report.merged).toHaveLength(3);
  });

  test("URL match takes precedence over phash match for same pair", () => {
    // Same URL AND same phash — should still produce a single group, reason='url'
    const hash = "1111111111111111";
    const b = bundle(
      mk("https://same.com/img.jpg", "wikimedia", { phash: hash }),
      mk("https://same.com/img.jpg", "openverse", { phash: hash }),
    );
    const report = compareCandidates(b);
    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.duplicateGroups[0]!.reason).toBe("url");
  });
});

// ---------------------------------------------------------------------------
// Representative selection + merged list
// ---------------------------------------------------------------------------

describe("representative selection", () => {
  test("highest-scored candidate is chosen as group representative", () => {
    const hash = "cafecafecafecafe";
    const b = bundle(
      mk("https://a.com/img.jpg", "wikimedia", { phash: hash, score: 0.4 }),
      mk("https://b.com/img.jpg", "openverse", { phash: hash, score: 0.9 }),
      mk("https://c.com/img.jpg", "unsplash", { phash: hash, score: 0.6 }),
    );
    const report = compareCandidates(b);
    expect(report.merged).toHaveLength(1);
    expect(report.merged[0]!.source).toBe("openverse");
  });

  test("merged list is sorted by score descending", () => {
    const b = bundle(
      mk("https://a.com/1.jpg", "wikimedia", { score: 0.3 }),
      mk("https://b.com/2.jpg", "openverse", { score: 0.9 }),
      mk("https://c.com/3.jpg", "unsplash", { score: 0.6 }),
    );
    const report = compareCandidates(b);
    expect(report.merged).toHaveLength(3);
    expect(report.merged[0]!.score).toBe(0.9);
    expect(report.merged[1]!.score).toBe(0.6);
    expect(report.merged[2]!.score).toBe(0.3);
  });

  test("first occurrence wins when scores are equal", () => {
    const hash = "0102030405060708";
    const b = bundle(
      mk("https://a.com/img.jpg", "wikimedia", { phash: hash, score: 0.5 }),
      mk("https://b.com/img.jpg", "openverse", { phash: hash, score: 0.5 }),
    );
    const report = compareCandidates(b);
    // First wins when scores tied (index 0)
    expect(report.merged[0]!.source).toBe("wikimedia");
  });
});

// ---------------------------------------------------------------------------
// DedupeGroupMember shape
// ---------------------------------------------------------------------------

describe("DedupeGroupMember shape", () => {
  test("each member carries index, url, provider, and phash", () => {
    const hash = "fedcba9876543210";
    const b = bundle(
      mk("https://a.com/img.jpg", "wikimedia", { phash: hash }),
      mk("https://b.com/img.jpg", "openverse", { phash: hash }),
    );
    const report = compareCandidates(b);
    const members = report.duplicateGroups[0]!.members;

    for (const m of members) {
      expect(typeof m.index).toBe("number");
      expect(typeof m.url).toBe("string");
      expect(typeof m.provider).toBe("string");
      expect(m.phash).toBe(hash);
    }

    // Indices should correspond to original array positions
    const indices = members.map((m) => m.index).sort((a, b) => a - b);
    expect(indices).toEqual([0, 1]);
  });

  test("members without phash have phash undefined in report", () => {
    const b = bundle(
      mk("https://same.com/img.jpg", "wikimedia"),
      mk("https://same.com/img.jpg", "openverse"),
    );
    const report = compareCandidates(b);
    for (const m of report.duplicateGroups[0]!.members) {
      expect(m.phash).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  test("single candidate produces no groups and merged = [candidate]", () => {
    const b = bundle(mk("https://a.com/img.jpg", "wikimedia"));
    const report = compareCandidates(b);
    expect(report.duplicateGroups).toHaveLength(0);
    expect(report.merged).toHaveLength(1);
  });

  test("all candidates are unique — merged equals original length", () => {
    const b = bundle(
      mk("https://a.com/1.jpg", "wikimedia", { phash: "0000000000000001" }),
      mk("https://b.com/2.jpg", "openverse", { phash: "ffffffff00000000" }),
      mk("https://c.com/3.jpg", "unsplash", { phash: "00ff00ff00ff00ff" }),
    );
    const report = compareCandidates(b);
    expect(report.duplicateGroups).toHaveLength(0);
    expect(report.merged).toHaveLength(3);
  });

  test("bundle with warnings and providerReports passes through cleanly", () => {
    const b: SearchResultBundle = {
      candidates: [
        mk("https://same.com/img.jpg", "wikimedia"),
        mk("https://same.com/img.jpg", "openverse"),
      ],
      providerReports: [
        { provider: "wikimedia", ok: true, count: 1, timeMs: 50 },
        { provider: "openverse", ok: true, count: 1, timeMs: 60 },
      ],
      warnings: ["rate-limit-approaching"],
    };
    // Should not throw and should still detect the duplicate
    const report = compareCandidates(b);
    expect(report.duplicateGroups).toHaveLength(1);
  });

  test("hammingThreshold=0 only matches identical hashes", () => {
    const b = bundle(
      mk("https://a.com/img.jpg", "wikimedia", { phash: "0000000000000000" }),
      mk("https://b.com/img.jpg", "openverse", { phash: "0000000000000001" }), // 1-bit diff
      mk("https://c.com/img.jpg", "unsplash", { phash: "0000000000000000" }), // identical
    );
    const report = compareCandidates(b, { hammingThreshold: 0 });
    expect(report.duplicateGroups).toHaveLength(1);
    expect(report.duplicateGroups[0]!.members).toHaveLength(2);
    expect(report.merged).toHaveLength(2);
  });

  test("large bundle with many providers — no false positives with maximally distinct hashes", () => {
    const providers = ["wikimedia", "openverse", "unsplash", "pexels", "pixabay", "brave", "bing"];
    // Use hashes that differ by many bits (alternating nibble patterns spread across bit-space).
    // Each hash differs from its neighbours by at least 16 bits, well above the default threshold of 6.
    const distinctHashes = [
      "0000000000000000",
      "ffffffffffffffff",
      "aaaaaaaaaaaaaaaa",
      "5555555555555555",
      "f0f0f0f0f0f0f0f0",
      "0f0f0f0f0f0f0f0f",
      "ff00ff00ff00ff00",
      "00ff00ff00ff00ff",
      "cccccccccccccccc",
      "3333333333333333",
      "f00ff00ff00ff00f",
      "0ff00ff00ff00ff0",
      "a5a5a5a5a5a5a5a5",
      "5a5a5a5a5a5a5a5a",
      "c3c3c3c3c3c3c3c3",
      "3c3c3c3c3c3c3c3c",
      "aa55aa55aa55aa55",
      "55aa55aa55aa55aa",
      "f0a5f0a5f0a5f0a5",
      "0f5a0f5a0f5a0f5a",
      "fc03fc03fc03fc03",
    ];
    const candidates: ImageCandidate[] = [];
    let hashIdx = 0;
    for (const provider of providers) {
      for (let i = 0; i < 3; i++) {
        const phash = distinctHashes[hashIdx++]!;
        candidates.push(mk(`https://${provider}.com/img${i}.jpg`, provider, { phash }));
      }
    }
    const report = compareCandidates(bundle(...candidates));
    expect(report.duplicateGroups).toHaveLength(0);
    expect(report.merged).toHaveLength(candidates.length);
  });
});

// ---------------------------------------------------------------------------
// Provider cross-contamination scenarios (federation tuning use-cases)
// ---------------------------------------------------------------------------

describe("federation tuning use-cases", () => {
  test("detects when wikimedia and openverse return the same underlying image", () => {
    const hash = "1234567890abcdef";
    const b = bundle(
      mk("https://upload.wikimedia.org/photo.jpg", "wikimedia", { phash: hash, score: 0.8 }),
      mk("https://api.openverse.org/thumb/photo.jpg", "openverse", { phash: hash, score: 0.6 }),
      mk("https://unique.pexels.com/photo2.jpg", "pexels", { phash: "ffff000000001111", score: 0.7 }),
    );
    const report = compareCandidates(b);

    expect(report.duplicateGroups).toHaveLength(1);
    const grp = report.duplicateGroups[0]!;
    expect(grp.reason).toBe("phash");
    const groupProviders = grp.members.map((m) => m.provider).sort();
    expect(groupProviders).toEqual(["openverse", "wikimedia"]);

    // Representative is the wikimedia one (higher score)
    expect(report.merged.find((c) => c.source === "wikimedia")).toBeDefined();
    expect(report.merged.find((c) => c.source === "openverse")).toBeUndefined();
    expect(report.merged.find((c) => c.source === "pexels")).toBeDefined();
  });

  test("multiple providers returning the same 3 URLs collapses to 3 merged", () => {
    const urls = ["https://img.com/a.jpg", "https://img.com/b.jpg", "https://img.com/c.jpg"];
    const providers = ["wikimedia", "openverse", "unsplash"];
    const candidates: ImageCandidate[] = [];
    for (const url of urls) {
      for (const provider of providers) {
        candidates.push(mk(url, provider));
      }
    }
    const report = compareCandidates(bundle(...candidates));
    // 3 url groups
    expect(report.duplicateGroups).toHaveLength(3);
    expect(report.merged).toHaveLength(3);
  });
});
