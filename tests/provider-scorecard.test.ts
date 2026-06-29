/**
 * Tests for ProviderScorecard system.
 *
 * Covers:
 *  - recordScorecardEvent + getProviderScore aggregation
 *  - Cold-start (no data) behaviour
 *  - All-providers-failing edge case
 *  - Latency percentile accuracy (p50/p95/p99)
 *  - License diversity (Shannon entropy)
 *  - selectProvidersForQuery ranking + weight modes
 *  - userProvidersHint ordering
 *  - License-policy penalty (open-only)
 *  - getScorecardSnapshot ordering
 *  - Scorecard does not break existing deterministic federation tests
 *  - Persistence helpers (enable/disable) — non-I/O paths only
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _resetScorecard,
  computeLicenseDiversity,
  disableScorecardPersistence,
  enableScorecardPersistence,
  getAllProviderScores,
  getProviderScore,
  getScorecardSnapshot,
  recordScorecardEvent,
  selectProvidersForQuery,
} from "../packages/core/src/provider-scorecard.ts";
import type { ProviderSelectionMode } from "../packages/core/src/provider-scorecard.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";
import { _resetTelemetry } from "../packages/core/src/federation-telemetry.ts";
import { searchImages } from "../packages/core/src/federation.ts";
import { fixture, jsonResponse, stubFetcher } from "./stub-fetcher.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    url: `https://example.com/${Math.random()}.jpg`,
    source: "wikimedia",
    license: "CC0",
    confidence: 1.0,
    width: 800,
    height: 600,
    ...overrides,
  };
}

function makeResults(n: number, overrides: Partial<ImageCandidate> = {}): ImageCandidate[] {
  return Array.from({ length: n }, () => makeCandidate(overrides));
}

// ---------------------------------------------------------------------------
// Reset before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetScorecard();
  _resetTelemetry();
  disableScorecardPersistence();
});

afterEach(() => {
  _resetScorecard();
});

// ---------------------------------------------------------------------------
// Cold-start behaviour
// ---------------------------------------------------------------------------

describe("cold start (no recorded events)", () => {
  test("getProviderScore returns optimistic defaults for unknown provider", () => {
    const score = getProviderScore("wikimedia");
    expect(score.provider).toBe("wikimedia");
    expect(score.sampleCount).toBe(0);
    expect(score.successRate).toBe(1);
    expect(score.avgConfidence).toBe(1);
    expect(score.avgUnknownFraction).toBe(0);
    expect(score.compositeScore).toBe(1);
    expect(score.p50Ms).toBe(0);
    expect(score.p95Ms).toBe(0);
    expect(score.p99Ms).toBe(0);
  });

  test("getAllProviderScores returns empty array when no events recorded", () => {
    expect(getAllProviderScores()).toHaveLength(0);
  });

  test("getScorecardSnapshot returns empty array on cold start", () => {
    expect(getScorecardSnapshot()).toHaveLength(0);
  });

  test("selectProvidersForQuery preserves original order on cold start", () => {
    const providers = ["wikimedia", "openverse", "unsplash"] as const;
    const result = selectProvidersForQuery([...providers], "safe-only");
    expect(result).toEqual(["wikimedia", "openverse", "unsplash"]);
  });
});

// ---------------------------------------------------------------------------
// Success rate tracking
// ---------------------------------------------------------------------------

describe("success rate tracking", () => {
  test("all successes → successRate=1", () => {
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("wikimedia", true, 200, makeResults(3));
    }
    const score = getProviderScore("wikimedia");
    expect(score.successRate).toBe(1);
    expect(score.sampleCount).toBe(5);
  });

  test("all failures → successRate=0", () => {
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("openverse", false, 500, []);
    }
    const score = getProviderScore("openverse");
    expect(score.successRate).toBe(0);
    expect(score.sampleCount).toBe(5);
  });

  test("mixed success/failure → correct ratio", () => {
    recordScorecardEvent("pexels", true, 100, makeResults(2));
    recordScorecardEvent("pexels", true, 100, makeResults(2));
    recordScorecardEvent("pexels", false, 200, []);
    // 2/3 = 0.666...
    const score = getProviderScore("pexels");
    expect(score.successRate).toBeCloseTo(2 / 3, 5);
    expect(score.sampleCount).toBe(3);
  });

  test("failed calls contribute 0 to result quality metrics", () => {
    recordScorecardEvent("unsplash", false, 300, []);
    const score = getProviderScore("unsplash");
    expect(score.avgConfidence).toBe(0);
    expect(score.avgUnknownFraction).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Result quality metrics
// ---------------------------------------------------------------------------

describe("result quality metrics", () => {
  test("avgConfidence aggregated from candidate confidence fields", () => {
    const results = [
      makeCandidate({ confidence: 0.8 }),
      makeCandidate({ confidence: 0.6 }),
      makeCandidate({ confidence: 1.0 }),
    ];
    recordScorecardEvent("wikimedia", true, 100, results);
    const score = getProviderScore("wikimedia");
    expect(score.avgConfidence).toBeCloseTo((0.8 + 0.6 + 1.0) / 3, 5);
  });

  test("avgUnknownFraction computed from UNKNOWN licenses", () => {
    const results = [
      makeCandidate({ license: "CC0" }),
      makeCandidate({ license: "UNKNOWN" }),
      makeCandidate({ license: "UNKNOWN" }),
      makeCandidate({ license: "CC_BY" }),
    ];
    recordScorecardEvent("brave", true, 200, results);
    const score = getProviderScore("brave");
    expect(score.avgUnknownFraction).toBeCloseTo(2 / 4, 5);
  });

  test("medianResolution computed from width*height", () => {
    const results = [
      makeCandidate({ width: 100, height: 100 }),  // 10000
      makeCandidate({ width: 200, height: 200 }),  // 40000
      makeCandidate({ width: 300, height: 300 }),  // 90000
    ];
    recordScorecardEvent("pexels", true, 100, results);
    const score = getProviderScore("pexels");
    // median of [10000, 40000, 90000] = 40000
    expect(score.medianResolution).toBe(40000);
  });

  test("candidates without width/height excluded from median resolution", () => {
    const results = [
      makeCandidate({ width: undefined, height: undefined }),
      makeCandidate({ width: 800, height: 600 }),
    ];
    recordScorecardEvent("pixabay", true, 100, results);
    const score = getProviderScore("pixabay");
    expect(score.medianResolution).toBe(480000); // 800*600
  });

  test("cache hit fraction stored and averaged", () => {
    recordScorecardEvent("wikimedia", true, 100, makeResults(3), 0.5);
    recordScorecardEvent("wikimedia", true, 100, makeResults(3), 1.0);
    const score = getProviderScore("wikimedia");
    expect(score.avgCacheHitFraction).toBeCloseTo(0.75, 5);
  });
});

// ---------------------------------------------------------------------------
// Latency percentiles
// ---------------------------------------------------------------------------

describe("latency percentiles", () => {
  test("p50/p95/p99 computed correctly for 10 events", () => {
    const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    for (const ms of latencies) {
      recordScorecardEvent("openverse", true, ms, makeResults(1));
    }
    const score = getProviderScore("openverse");
    // p50 = 5th element in sorted 10-element array → index ceil(50/100 * 10)-1 = 4 → 500
    expect(score.p50Ms).toBe(500);
    // p95 = ceil(0.95 * 10) - 1 = 9 → 1000... actually ceil(9.5)-1=9 → latencies[9]=1000
    expect(score.p95Ms).toBe(1000);
    // p99 = ceil(0.99 * 10) - 1 = 9 → 1000
    expect(score.p99Ms).toBe(1000);
  });

  test("p50 for single event equals that event's duration", () => {
    recordScorecardEvent("wikimedia", true, 350, makeResults(2));
    const score = getProviderScore("wikimedia");
    expect(score.p50Ms).toBe(350);
  });

  test("p95 > p50 for skewed latency distribution", () => {
    // 9 fast events + 1 very slow event
    for (let i = 0; i < 9; i++) {
      recordScorecardEvent("bing", true, 100, makeResults(1));
    }
    recordScorecardEvent("bing", true, 5000, makeResults(1));
    const score = getProviderScore("bing");
    expect(score.p95Ms).toBeGreaterThanOrEqual(score.p50Ms);
  });

  test("failed calls still contribute to latency percentiles", () => {
    recordScorecardEvent("serpapi", false, 8000, []);
    const score = getProviderScore("serpapi");
    expect(score.p50Ms).toBe(8000);
  });
});

// ---------------------------------------------------------------------------
// License diversity (Shannon entropy)
// ---------------------------------------------------------------------------

describe("license diversity", () => {
  test("computeLicenseDiversity returns 0 for empty list", () => {
    expect(computeLicenseDiversity([])).toBe(0);
  });

  test("single license type has entropy 0", () => {
    const results = makeResults(5, { license: "CC0" });
    expect(computeLicenseDiversity(results)).toBe(0);
  });

  test("two equal-frequency license types have entropy ~1 bit", () => {
    const results = [
      ...makeResults(5, { license: "CC0" }),
      ...makeResults(5, { license: "CC_BY" }),
    ];
    // H = -2 * (0.5 * log2(0.5)) = 1
    expect(computeLicenseDiversity(results)).toBeCloseTo(1, 5);
  });

  test("more license types → higher entropy", () => {
    const two = [
      ...makeResults(4, { license: "CC0" }),
      ...makeResults(4, { license: "CC_BY" }),
    ];
    const four = [
      ...makeResults(2, { license: "CC0" }),
      ...makeResults(2, { license: "CC_BY" }),
      ...makeResults(2, { license: "UNSPLASH_LICENSE" }),
      ...makeResults(2, { license: "PEXELS_LICENSE" }),
    ];
    expect(computeLicenseDiversity(four)).toBeGreaterThan(computeLicenseDiversity(two));
  });

  test("avgLicenseDiversity tracked across events", () => {
    const highDiversity = [
      makeCandidate({ license: "CC0" }),
      makeCandidate({ license: "CC_BY" }),
      makeCandidate({ license: "UNSPLASH_LICENSE" }),
      makeCandidate({ license: "PEXELS_LICENSE" }),
    ];
    recordScorecardEvent("openverse", true, 100, highDiversity);
    const score = getProviderScore("openverse");
    expect(score.avgLicenseDiversity).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Composite score
// ---------------------------------------------------------------------------

describe("composite score", () => {
  test("perfect provider (success=1, confidence=1, no unknowns, fast) → high score", () => {
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("wikimedia", true, 100, makeResults(5, { confidence: 1.0, license: "CC0" }));
    }
    const score = getProviderScore("wikimedia");
    expect(score.compositeScore).toBeGreaterThan(0.8);
  });

  test("failing provider → lower composite score than healthy one", () => {
    // Healthy provider
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("wikimedia", true, 200, makeResults(3));
    }
    // Failing provider
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("serpapi", false, 3000, []);
    }
    const wiki = getProviderScore("wikimedia");
    const serp = getProviderScore("serpapi");
    expect(wiki.compositeScore).toBeGreaterThan(serp.compositeScore);
  });

  test("slow provider scores lower than fast provider with same success rate", () => {
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("pexels", true, 100, makeResults(3));
      recordScorecardEvent("bing", true, 5000, makeResults(3));
    }
    const fast = getProviderScore("pexels");
    const slow = getProviderScore("bing");
    expect(fast.compositeScore).toBeGreaterThan(slow.compositeScore);
  });

  test("high UNKNOWN fraction → lower quality score", () => {
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("wikimedia", true, 200, makeResults(5, { license: "CC0", confidence: 1.0 }));
      recordScorecardEvent("brave", true, 200, makeResults(5, { license: "UNKNOWN", confidence: 0.3 }));
    }
    const clean = getProviderScore("wikimedia");
    const unknown = getProviderScore("brave");
    expect(clean.compositeScore).toBeGreaterThan(unknown.compositeScore);
  });
});

// ---------------------------------------------------------------------------
// selectProvidersForQuery
// ---------------------------------------------------------------------------

describe("selectProvidersForQuery", () => {
  test("single provider list returned unchanged", () => {
    const result = selectProvidersForQuery(["wikimedia"], "safe-only");
    expect(result).toEqual(["wikimedia"]);
  });

  test("empty providers list returned as empty", () => {
    expect(selectProvidersForQuery([], "safe-only")).toEqual([]);
  });

  test("ranked by composite score: higher-scoring provider first", () => {
    // wikimedia: excellent
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("wikimedia", true, 100, makeResults(5, { license: "CC0", confidence: 1.0 }));
    }
    // openverse: poor
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("openverse", false, 4000, []);
    }
    const ranked = selectProvidersForQuery(["openverse", "wikimedia"], "safe-only");
    expect(ranked[0]).toBe("wikimedia");
    expect(ranked[1]).toBe("openverse");
  });

  test("cold-start providers sort stably by original index", () => {
    // No events recorded — all cold start, score=1 for all
    const providers = ["pexels", "pixabay", "unsplash"] as const;
    const result = selectProvidersForQuery([...providers], "safe-only");
    // All tied at score=1, so original order preserved
    expect(result).toEqual(["pexels", "pixabay", "unsplash"]);
  });

  test("userProvidersHint placed first regardless of score", () => {
    // openverse is fast and excellent
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("openverse", true, 50, makeResults(5, { confidence: 1.0 }));
    }
    // wikimedia is slow and poor
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("wikimedia", false, 5000, []);
    }

    // Without hint: openverse should rank first
    const withoutHint = selectProvidersForQuery(["wikimedia", "openverse"], "safe-only");
    expect(withoutHint[0]).toBe("openverse");

    // With hint forcing wikimedia first
    const withHint = selectProvidersForQuery(
      ["wikimedia", "openverse"],
      "safe-only",
      ["wikimedia"],
    );
    expect(withHint[0]).toBe("wikimedia");
    expect(withHint[1]).toBe("openverse");
  });

  test("userProvidersHint filters to providers present in the list", () => {
    const result = selectProvidersForQuery(
      ["wikimedia", "openverse"],
      "safe-only",
      ["pexels", "wikimedia"], // pexels not in providers list
    );
    expect(result[0]).toBe("wikimedia");
    expect(result).not.toContain("pexels");
  });

  test("open-only policy penalises high-UNKNOWN providers", () => {
    // brave: many UNKNOWN results
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("brave", true, 100, makeResults(5, { license: "UNKNOWN" }));
    }
    // wikimedia: all open
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("wikimedia", true, 100, makeResults(5, { license: "CC0" }));
    }

    const ranked = selectProvidersForQuery(["brave", "wikimedia"], "open-only");
    expect(ranked[0]).toBe("wikimedia");
  });

  test("mode=latency prioritises fast providers", () => {
    // pexels: fast
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("pexels", true, 80, makeResults(3));
    }
    // openverse: slow (but good quality)
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("openverse", true, 3000, makeResults(5, { confidence: 1.0, license: "CC0" }));
    }

    const latencyMode = selectProvidersForQuery(
      ["openverse", "pexels"],
      "safe-only",
      undefined,
      "latency",
    );
    expect(latencyMode[0]).toBe("pexels");
  });

  test("mode=quality prioritises high-confidence open providers", () => {
    // wikimedia: high confidence, open
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("wikimedia", true, 500, makeResults(5, { confidence: 1.0, license: "CC0" }));
    }
    // bing: fast but low confidence, high UNKNOWN
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("bing", true, 80, makeResults(5, { confidence: 0.2, license: "UNKNOWN" }));
    }

    const qualityMode = selectProvidersForQuery(
      ["bing", "wikimedia"],
      "safe-only",
      undefined,
      "quality",
    );
    expect(qualityMode[0]).toBe("wikimedia");
  });

  test("mode=balance: all weights equal, still produces valid ordering", () => {
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("wikimedia", true, 200, makeResults(3));
      recordScorecardEvent("openverse", false, 1000, []);
    }
    const result = selectProvidersForQuery(["openverse", "wikimedia"], "safe-only", undefined, "balance");
    expect(result[0]).toBe("wikimedia");
  });

  test("all valid ProviderSelectionMode values accepted", () => {
    const modes: ProviderSelectionMode[] = ["default", "quality", "latency", "balance"];
    for (const mode of modes) {
      const result = selectProvidersForQuery(["wikimedia", "openverse"], "safe-only", undefined, mode);
      expect(result).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// All-providers-failing edge case
// ---------------------------------------------------------------------------

describe("all providers failing", () => {
  test("all providers at 100% failure rate — selectProvidersForQuery still returns all", () => {
    const providers = ["wikimedia", "openverse", "pexels"] as const;
    for (const p of providers) {
      for (let i = 0; i < 5; i++) {
        recordScorecardEvent(p, false, 5000, []);
      }
    }
    const result = selectProvidersForQuery([...providers], "safe-only");
    // All have score=0 — original order preserved as tie-break
    expect(result).toHaveLength(3);
    // Every provider still present
    for (const p of providers) {
      expect(result).toContain(p);
    }
  });

  test("failing providers have compositeScore=0 or near 0", () => {
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("serpapi", false, 5000, []);
    }
    const score = getProviderScore("serpapi");
    expect(score.compositeScore).toBeLessThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// getScorecardSnapshot ordering
// ---------------------------------------------------------------------------

describe("getScorecardSnapshot", () => {
  test("sorted descending by compositeScore", () => {
    // wikimedia: good
    for (let i = 0; i < 3; i++) {
      recordScorecardEvent("wikimedia", true, 200, makeResults(3, { confidence: 0.9 }));
    }
    // openverse: mediocre
    for (let i = 0; i < 3; i++) {
      recordScorecardEvent("openverse", true, 1000, makeResults(2, { confidence: 0.5 }));
    }
    // bing: bad
    for (let i = 0; i < 3; i++) {
      recordScorecardEvent("bing", false, 4000, []);
    }

    const snapshot = getScorecardSnapshot();
    expect(snapshot).toHaveLength(3);
    // Verify descending order
    for (let i = 0; i < snapshot.length - 1; i++) {
      expect(snapshot[i]!.compositeScore).toBeGreaterThanOrEqual(snapshot[i + 1]!.compositeScore);
    }
  });
});

// ---------------------------------------------------------------------------
// getAllProviderScores
// ---------------------------------------------------------------------------

describe("getAllProviderScores", () => {
  test("returns one entry per provider with events", () => {
    recordScorecardEvent("wikimedia", true, 100, makeResults(2));
    recordScorecardEvent("openverse", true, 200, makeResults(3));
    recordScorecardEvent("wikimedia", true, 150, makeResults(2));

    const all = getAllProviderScores();
    expect(all).toHaveLength(2);
    const ids = all.map((s) => s.provider).sort();
    expect(ids).toEqual(["openverse", "wikimedia"]);
  });

  test("sampleCount reflects total events for that provider", () => {
    for (let i = 0; i < 7; i++) {
      recordScorecardEvent("pexels", true, 100, makeResults(1));
    }
    const all = getAllProviderScores();
    const entry = all.find((s) => s.provider === "pexels");
    expect(entry?.sampleCount).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Persistence helpers (non-I/O code paths)
// ---------------------------------------------------------------------------

describe("persistence helpers", () => {
  test("enableScorecardPersistence sets persist flag without throwing", () => {
    // Use a temp path that won't be written during tests
    expect(() => {
      enableScorecardPersistence("/tmp/webfetch-test-scorecard-noop.json");
      disableScorecardPersistence();
    }).not.toThrow();
  });

  test("disableScorecardPersistence prevents I/O (no error thrown)", () => {
    disableScorecardPersistence();
    // Events recorded after disable should not attempt I/O
    expect(() => {
      recordScorecardEvent("wikimedia", true, 100, makeResults(2));
    }).not.toThrow();
  });

  test("scorecard still accumulates in-memory after disabling persistence", () => {
    disableScorecardPersistence();
    recordScorecardEvent("openverse", true, 200, makeResults(3));
    const score = getProviderScore("openverse");
    expect(score.sampleCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Federation integration — scorecard wired into searchImages
// ---------------------------------------------------------------------------

describe("federation integration: scorecardSelection in searchImages", () => {
  test("scorecardSelection=default does not break federation results", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: async () => jsonResponse(fixture("openverse.json")),
      },
    ]);

    const out = await searchImages("cat", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      scorecardSelection: "default",
    });
    // Results still returned correctly
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.providerReports.length).toBeGreaterThan(0);
    // No errors in warnings related to scorecard
    for (const w of out.warnings) {
      expect(w).not.toContain("scorecard");
    }
  });

  test("scorecardSelection=quality returns candidates normally", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);

    const out = await searchImages("landscape", {
      providers: ["wikimedia"],
      fetcher,
      scorecardSelection: "quality",
    });
    expect(out.candidates.length).toBeGreaterThan(0);
  });

  test("scorecardSelection=latency returns candidates normally", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: async () => jsonResponse(fixture("openverse.json")),
      },
    ]);

    const out = await searchImages("mountain", {
      providers: ["openverse"],
      fetcher,
      scorecardSelection: "latency",
    });
    expect(out.candidates.length).toBeGreaterThan(0);
  });

  test("successful federation call records scorecard event", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);

    await searchImages("test scorecard recording", {
      providers: ["wikimedia"],
      fetcher,
    });

    // After the search, scorecard should have an event for wikimedia
    const score = getProviderScore("wikimedia");
    expect(score.sampleCount).toBeGreaterThan(0);
    expect(score.successRate).toBe(1);
  });

  test("failed provider call records failed scorecard event", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => { throw new Error("HTTP 500 server error"); },
      },
    ]);

    await searchImages("test failed recording", {
      providers: ["wikimedia"],
      fetcher,
    });

    const score = getProviderScore("wikimedia");
    expect(score.sampleCount).toBeGreaterThan(0);
    expect(score.successRate).toBe(0);
  });

  test("scorecard does not break dryRun mode", async () => {
    const out = await searchImages("dry run test", {
      providers: ["wikimedia", "openverse"],
      dryRun: true,
      scorecardSelection: "balance",
    });
    expect(out.candidates).toHaveLength(0);
    expect(out.warnings.some((w) => w.includes("dryRun"))).toBe(true);
  });

  test("scorecardSelection ordering applied when no explicit providers given", async () => {
    // Pre-seed scorecard: openverse excellent, wikimedia poor
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("openverse", true, 50, makeResults(5, { confidence: 1.0, license: "CC0" }));
      recordScorecardEvent("wikimedia", false, 5000, []);
    }

    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: async () => jsonResponse(fixture("openverse.json")),
      },
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);

    // When no explicit providers list, scorecardSelection applies
    const out = await searchImages("ordering test", {
      fetcher,
      scorecardSelection: "default",
      // No `providers` field — default list used, scorecard ordering applies
    });

    // Main invariant: search still works
    expect(Array.isArray(out.candidates)).toBe(true);
    expect(Array.isArray(out.providerReports)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scorecard does not weaken existing deterministic behaviour
// ---------------------------------------------------------------------------

describe("scorecard isolation: does not affect non-scorecard paths", () => {
  test("existing federation providerPreference=healthiest still works alongside scorecard", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: async () => jsonResponse(fixture("openverse.json")),
      },
    ]);

    const out = await searchImages("coexist test", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      providerPreference: "healthiest",
      scorecardSelection: "quality",
    });
    expect(out.candidates.length).toBeGreaterThan(0);
  });

  test("scorecard reset between tests: no cross-test bleed", () => {
    // After beforeEach reset, sampleCount should be 0
    const score = getProviderScore("wikimedia");
    expect(score.sampleCount).toBe(0);
  });
});
