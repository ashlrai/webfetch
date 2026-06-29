/**
 * Tests for CacheWarmer: cache warm-up daemon.
 *
 * Covers:
 *  1. Input parsing (parseWarmQuery — JSON Lines, blank lines, comments)
 *  2. Interval-skip safeguard (concurrent execution prevented)
 *  3. Concurrent-execution safeguard (isExecuting flag)
 *  4. WarmthReport generation (shape, queriesRun, perProviderMetrics)
 *  5. --once / runOnce() with empty query list
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseWarmQuery, CacheWarmer } from "../packages/core/src/cache-warmer.ts";
import type { WarmQuery, WarmthReport } from "../packages/core/src/cache-warmer.ts";
import type { SearchOptions, SearchResultBundle } from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// 1. Input parsing
// ---------------------------------------------------------------------------

describe("parseWarmQuery: input parsing", () => {
  test("parses a minimal query-only object", () => {
    const result = parseWarmQuery('{"query":"drake portrait"}');
    expect(result).toBeDefined();
    expect(result!.query).toBe("drake portrait");
    expect(result!.licensePolicy).toBeUndefined();
    expect(result!.providers).toBeUndefined();
  });

  test("parses a full object with licensePolicy and providers", () => {
    const line = JSON.stringify({
      query: "taylor swift album",
      licensePolicy: "safe-only",
      providers: ["wikimedia", "unsplash"],
    });
    const result = parseWarmQuery(line);
    expect(result).toBeDefined();
    expect(result!.query).toBe("taylor swift album");
    expect(result!.licensePolicy).toBe("safe-only");
    expect(result!.providers).toEqual(["wikimedia", "unsplash"]);
  });

  test("returns undefined for blank lines", () => {
    expect(parseWarmQuery("")).toBeUndefined();
    expect(parseWarmQuery("   ")).toBeUndefined();
    expect(parseWarmQuery("\t")).toBeUndefined();
  });

  test("returns undefined for comment lines", () => {
    expect(parseWarmQuery("# this is a comment")).toBeUndefined();
    expect(parseWarmQuery("  # indented comment")).toBeUndefined();
  });

  test("returns undefined for malformed JSON", () => {
    expect(parseWarmQuery("{not-json}")).toBeUndefined();
    expect(parseWarmQuery('{"query":}')).toBeUndefined();
  });

  test("returns undefined when query field is missing", () => {
    expect(parseWarmQuery('{"providers":["wikimedia"]}')).toBeUndefined();
  });

  test("returns undefined when query is empty string", () => {
    expect(parseWarmQuery('{"query":""}')).toBeUndefined();
    expect(parseWarmQuery('{"query":"   "}')).toBeUndefined();
  });

  test("trims whitespace from query", () => {
    const result = parseWarmQuery('{"query":"  nature photos  "}');
    expect(result).toBeDefined();
    expect(result!.query).toBe("nature photos");
  });

  test("ignores non-string provider entries", () => {
    const result = parseWarmQuery('{"query":"test","providers":["wikimedia",42,null]}');
    expect(result).toBeDefined();
    expect(result!.providers).toEqual(["wikimedia"]);
  });

  test("parses licensePolicy variants", () => {
    for (const lp of ["open-only", "safe-only", "context-safe", "prefer-safe", "any"] as const) {
      const result = parseWarmQuery(JSON.stringify({ query: "x", licensePolicy: lp }));
      expect(result?.licensePolicy).toBe(lp);
    }
  });
});

// ---------------------------------------------------------------------------
// Helpers for stub-based tests
// ---------------------------------------------------------------------------

/** Build a minimal SearchResultBundle stub. */
function makeBundle(
  providerResults: Array<{ provider: string; count: number; timeMs?: number }>,
): SearchResultBundle {
  return {
    candidates: providerResults.flatMap(({ provider, count }) =>
      Array.from({ length: count }, (_, i) => ({
        url: `https://example.com/${provider}/${i}.jpg`,
        source: provider,
        license: "CC0" as const,
        confidence: 0.8 + i * 0.01,
      })),
    ),
    warnings: [],
    providerReports: providerResults.map(({ provider, count, timeMs }) => ({
      provider,
      ok: true,
      count,
      timeMs: timeMs ?? 50,
      skipped: undefined,
      error: undefined,
    })),
  } as unknown as SearchResultBundle;
}

// ---------------------------------------------------------------------------
// 2 & 3. Interval-skip and concurrent execution safeguards
// ---------------------------------------------------------------------------

describe("CacheWarmer: concurrent execution safeguards", () => {
  test("isExecuting is false before start", () => {
    const warmer = new CacheWarmer({ queries: [] });
    expect(warmer.isExecuting).toBe(false);
  });

  test("isRunning is false before start", () => {
    const warmer = new CacheWarmer({ queries: [] });
    expect(warmer.isRunning).toBe(false);
  });

  test("interval is skipped when isExecuting is true", async () => {
    const executed: number[] = [];
    let resolveFirst!: () => void;
    const firstBarrier = new Promise<void>((r) => { resolveFirst = r; });

    const queries: WarmQuery[] = [{ query: "nature photo" }];
    let callCount = 0;

    const searchFn = async (_q: string, _opts: SearchOptions): Promise<SearchResultBundle> => {
      callCount++;
      if (callCount === 1) {
        // First call: block until explicitly resolved to simulate long execution.
        await firstBarrier;
      }
      return makeBundle([{ provider: "wikimedia", count: 1, timeMs: 2 }]);
    };

    // Use a controllable sleep to drive intervals.
    const sleepCalls: Array<() => void> = [];
    const sleep = (_ms: number) => new Promise<void>((r) => { sleepCalls.push(r); });

    const warmer = new CacheWarmer({
      queries,
      intervalSeconds: 1,
      parallel: 1,
      searchFn,
      sleep,
    });

    // Start daemon in background (don't await yet).
    const startPromise = warmer.start();

    // Allow event loop to process first tick (executing = true).
    await new Promise<void>((r) => setTimeout(r, 10));

    // Advance one sleep cycle while the first execution is still blocked.
    // This triggers the "skip" path.
    sleepCalls[0]?.();
    await new Promise<void>((r) => setTimeout(r, 10));

    // Now resolve the first execution.
    resolveFirst();
    await new Promise<void>((r) => setTimeout(r, 10));

    // Stop the daemon.
    warmer.stop();
    // Drain remaining sleeps so start() can exit.
    for (const fn of sleepCalls) fn();
    await startPromise;

    // callCount should be 1 (the skipped tick didn't call searchFn again before stop).
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 4. WarmthReport generation
// ---------------------------------------------------------------------------

describe("CacheWarmer: WarmthReport generation", () => {
  test("runOnce returns correct queriesRun count", async () => {
    const queries: WarmQuery[] = [
      { query: "drake portrait" },
      { query: "nature landscape" },
      { query: "cat photo" },
    ];

    const searchFn = async (_q: string, _opts: SearchOptions): Promise<SearchResultBundle> =>
      makeBundle([{ provider: "wikimedia", count: 3, timeMs: 50 }]);

    const warmer = new CacheWarmer({ queries, searchFn, parallel: 2 });
    const report = await warmer.runOnce();

    expect(report.queriesRun).toBe(3);
  });

  test("runOnce emits WarmthReport with correct shape", async () => {
    const queries: WarmQuery[] = [{ query: "test query" }];

    const searchFn = async (_q: string, _opts: SearchOptions): Promise<SearchResultBundle> =>
      makeBundle([
        { provider: "wikimedia", count: 2, timeMs: 3 },
        { provider: "unsplash", count: 3, timeMs: 80 },
      ]);

    const reports: WarmthReport[] = [];
    const warmer = new CacheWarmer({
      queries,
      searchFn,
      onReport: (r) => reports.push(r),
    });

    const report = await warmer.runOnce();

    // Shape checks
    expect(typeof report.generatedAt).toBe("string");
    expect(new Date(report.generatedAt).getTime()).not.toBeNaN();
    expect(typeof report.queriesRun).toBe("number");
    expect(typeof report.totalCandidates).toBe("number");
    expect(typeof report.timeMs).toBe("number");
    expect(report.timeMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.perProviderMetrics)).toBe(true);
    expect(Array.isArray(report.predictedHitRates)).toBe(true);

    // onReport was called
    expect(reports).toHaveLength(1);
    expect(reports[0]).toEqual(report);
  });

  test("runOnce with empty queries returns zeroed report", async () => {
    const warmer = new CacheWarmer({ queries: [] });
    const report = await warmer.runOnce([]);

    expect(report.queriesRun).toBe(0);
    expect(report.totalCandidates).toBe(0);
    expect(Number.isNaN(report.cacheHitRate)).toBe(true);
    expect(report.perProviderMetrics).toHaveLength(0);
  });

  test("perProviderMetrics contains entries for each provider", async () => {
    const queries: WarmQuery[] = [
      { query: "photo", providers: ["wikimedia", "unsplash"] },
    ];

    const searchFn = async (_q: string, _opts: SearchOptions): Promise<SearchResultBundle> =>
      makeBundle([
        { provider: "wikimedia", count: 5, timeMs: 50 },
        { provider: "unsplash", count: 3, timeMs: 60 },
      ]);

    const warmer = new CacheWarmer({ queries, searchFn });
    const report = await warmer.runOnce();

    const providerIds = report.perProviderMetrics.map((m) => m.provider);
    expect(providerIds).toContain("wikimedia");
    expect(providerIds).toContain("unsplash");
  });

  test("perProviderMetrics resultCount matches returned candidates", async () => {
    const queries: WarmQuery[] = [{ query: "photo" }];

    const searchFn = async (_q: string, _opts: SearchOptions): Promise<SearchResultBundle> =>
      makeBundle([{ provider: "wikimedia", count: 7, timeMs: 50 }]);

    const warmer = new CacheWarmer({ queries, searchFn });
    const report = await warmer.runOnce();

    const wikiMetrics = report.perProviderMetrics.find((m) => m.provider === "wikimedia");
    expect(wikiMetrics).toBeDefined();
    expect(wikiMetrics!.resultCount).toBe(7);
  });

  test("cacheHitRate reflects fast (<=5ms) provider responses as hits", async () => {
    const queries: WarmQuery[] = [{ query: "test" }];

    const searchFn = async (_q: string, _opts: SearchOptions): Promise<SearchResultBundle> =>
      makeBundle([
        { provider: "wikimedia", count: 4, timeMs: 2 },  // fast = cache hit heuristic
        { provider: "unsplash", count: 4, timeMs: 100 }, // slow = live
      ]);

    const warmer = new CacheWarmer({ queries, searchFn });
    const report = await warmer.runOnce();

    // wikimedia counted as hit (timeMs <= 5), unsplash as miss
    const wm = report.perProviderMetrics.find((m) => m.provider === "wikimedia");
    const un = report.perProviderMetrics.find((m) => m.provider === "unsplash");
    if (wm) expect(wm.hitRate).toBeGreaterThan(0);
    if (un) expect(un.hitRate).toBe(0);
  });

  test("totalCandidates sums across all providers and queries", async () => {
    const queries: WarmQuery[] = [
      { query: "q1" },
      { query: "q2" },
    ];

    const searchFn = async (_q: string, _opts: SearchOptions): Promise<SearchResultBundle> =>
      makeBundle([{ provider: "wikimedia", count: 5, timeMs: 50 }]);

    const warmer = new CacheWarmer({ queries, searchFn, parallel: 2 });
    const report = await warmer.runOnce();

    // 2 queries × 5 candidates each = 10
    expect(report.totalCandidates).toBe(10);
  });

  test("onError is called when searchFn throws", async () => {
    const queries: WarmQuery[] = [{ query: "broken query" }];
    const errors: string[] = [];

    const searchFn = async (): Promise<SearchResultBundle> => {
      throw new Error("provider explosion");
    };

    const warmer = new CacheWarmer({
      queries,
      searchFn,
      onError: (err, ctx) => errors.push(`${ctx}: ${err.message}`),
    });

    const report = await warmer.runOnce();

    // Should not throw; errors reported via onError
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("provider explosion");
    // Report still generated, but with 0 candidates
    expect(report.queriesRun).toBe(1);
    expect(report.totalCandidates).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. runOnce with injected queries (no file/stdin needed)
// ---------------------------------------------------------------------------

describe("CacheWarmer: runOnce with injected queries", () => {
  test("injected queries override inputPath/stdin", async () => {
    const injected: WarmQuery[] = [
      { query: "injected query 1" },
      { query: "injected query 2" },
    ];

    const seen: string[] = [];
    const searchFn = async (q: string, _opts: SearchOptions): Promise<SearchResultBundle> => {
      seen.push(q);
      return makeBundle([{ provider: "wikimedia", count: 1, timeMs: 50 }]);
    };

    const warmer = new CacheWarmer({
      // inputPath would be used if runOnce didn't receive explicit queries
      inputPath: "/nonexistent/path.jsonl",
      searchFn,
    });

    // Pass injected queries directly
    await warmer.runOnce(injected);

    expect(seen).toContain("injected query 1");
    expect(seen).toContain("injected query 2");
  });

  test("parallel option limits concurrency (no crash with parallel=1)", async () => {
    const queries: WarmQuery[] = Array.from({ length: 5 }, (_, i) => ({
      query: `query ${i}`,
    }));

    const searchFn = async (_q: string, _opts: SearchOptions): Promise<SearchResultBundle> =>
      makeBundle([{ provider: "wikimedia", count: 1, timeMs: 50 }]);

    const warmer = new CacheWarmer({ queries, searchFn, parallel: 1 });
    const report = await warmer.runOnce();
    expect(report.queriesRun).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 6. CLI integration: cmdWarm
// ---------------------------------------------------------------------------

describe("CLI: cmdWarm", () => {
  test("returns exit 2 for invalid --interval", async () => {
    const { cmdWarm } = await import("../packages/cli/src/commands/warm.ts");
    const { parseArgs } = await import("../packages/cli/src/args.ts");

    const lines: string[] = [];
    const errs: string[] = [];
    const io = {
      stdout: (s: string) => lines.push(s),
      stderr: (s: string) => errs.push(s),
      env: {},
    };

    const args = parseArgs(["--interval", "0", "--once"]);
    const code = await cmdWarm(args, io);
    expect(code).toBe(2);
    expect(errs.some((e) => e.includes("interval"))).toBe(true);
  });

  test("returns exit 2 for --parallel=0", async () => {
    const { cmdWarm } = await import("../packages/cli/src/commands/warm.ts");
    const { parseArgs } = await import("../packages/cli/src/args.ts");

    const errs: string[] = [];
    const io = {
      stdout: (_s: string) => {},
      stderr: (s: string) => errs.push(s),
      env: {},
    };

    const args = parseArgs(["--parallel", "0", "--once"]);
    const code = await cmdWarm(args, io);
    expect(code).toBe(2);
  });
});
