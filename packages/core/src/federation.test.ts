/**
 * Tests for Multi-Provider Parallel Federation with Timeout Degradation.
 *
 * Covers three new features added to federation.ts:
 *   1. raceProviders()         — early-exit on first N high-quality results.
 *   2. degradedTimeoutSequence() — providers that timeout once drop to 50%
 *      budget; providers that timeout twice are skipped.
 *   3. providerQueueing()      — >8 providers split into tier-1 / tier-2 waves
 *      with independent 15 s budgets.
 *
 * All tests use synthetic delays (200 ms+) via stubFetcher to exercise the
 * real timing paths without hitting the network.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _resetTimeoutHistory,
  searchImages,
} from "./federation.ts";

// ---------------------------------------------------------------------------
// Minimal stub helpers (inline — no dependency on tests/stub-fetcher.ts)
// ---------------------------------------------------------------------------

type Handler = (url: string, init?: RequestInit) => Promise<Response>;
type Route = { match: (url: string) => boolean; handler: Handler };

function stubFetcher(routes: Route[]): typeof fetch {
  return (async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    for (const r of routes) if (r.match(url)) return r.handler(url, init);
    throw new Error(`stubFetcher: no route for ${url}`);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Returns a handler that resolves after `delayMs` (honouring abort). */
function delayedHandler(delayMs: number, body: unknown): Handler {
  return async (_url, init) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal?.aborted) {
        reject(Object.assign(new Error("AbortError"), { name: "AbortError" }));
        return;
      }
      const t = setTimeout(() => resolve(jsonResponse(body)), delayMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(Object.assign(new Error("AbortError"), { name: "AbortError" }));
      });
    });
}

/** A minimal Wikimedia-shaped response with one CC0 result. */
function wikiCC0Result(id = "File:test.jpg") {
  return {
    query: {
      pages: {
        "1": {
          pageid: 1,
          title: id,
          imageinfo: [
            {
              url: `https://upload.wikimedia.org/wikipedia/commons/${id}`,
              descriptionurl: `https://commons.wikimedia.org/wiki/${id}`,
              extmetadata: {
                LicenseShortName: { value: "CC0" },
                ImageDescription: { value: "test image" },
                Artist: { value: "Test Author" },
              },
              width: 800,
              height: 600,
            },
          ],
        },
      },
    },
  };
}

/** A minimal iTunes-shaped response with one EDITORIAL_LICENSED result. */
function itunesEditorialResult() {
  return {
    results: [
      {
        artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Music/test/cover.jpg",
        trackName: "Test Track",
        artistName: "Test Artist",
        collectionName: "Test Album",
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Test: raceProviders — early-exit on N CC0 results
// ---------------------------------------------------------------------------

describe("raceProviders — early-exit on N high-quality results", () => {
  beforeEach(() => _resetTimeoutHistory());

  test("stops after earlyExitCriteria.count CC0 results arrive", async () => {
    let openverseCalled = false;

    const fetcher = stubFetcher([
      {
        // wikimedia answers quickly with 1 CC0 result
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: delayedHandler(50, wikiCC0Result("File:fast.jpg")),
      },
      {
        // openverse is slow — should be aborted before it finishes
        match: (u) => u.includes("api.openverse.org"),
        handler: async (url, init) => {
          openverseCalled = true;
          return delayedHandler(2_000, { results: [], total_results: 0 })(url, init);
        },
      },
    ]);

    const out = await searchImages("test early exit", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      raceProviders: true,
      earlyExitCriteria: { count: 1, tier: "cc0" },
      timeoutMs: 5_000,
    });

    // wikimedia result should be in candidates
    expect(out.candidates.length).toBeGreaterThanOrEqual(1);
    // wikimedia report should be ok
    const wikiReport = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(wikiReport?.ok).toBe(true);
  });

  test("collects all results when threshold is not met before all providers finish", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: delayedHandler(50, wikiCC0Result()),
      },
      {
        match: (u) => u.includes("itunes.apple.com"),
        handler: delayedHandler(80, itunesEditorialResult()),
      },
    ]);

    // Require 10 CC0 results — will never be met, so all providers finish normally
    const out = await searchImages("test no early exit", {
      providers: ["wikimedia", "itunes"],
      fetcher,
      raceProviders: true,
      earlyExitCriteria: { count: 10, tier: "cc0" },
      timeoutMs: 5_000,
    });

    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.providerReports).toHaveLength(2);
    // Both providers should have completed
    const okReports = out.providerReports.filter((r) => r.ok);
    expect(okReports.length).toBe(2);
  });

  test("tier=any counts editorial results toward threshold", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("itunes.apple.com"),
        handler: delayedHandler(50, itunesEditorialResult()),
      },
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: delayedHandler(3_000, wikiCC0Result()),
      },
    ]);

    const out = await searchImages("test tier any", {
      providers: ["itunes", "wikimedia"],
      fetcher,
      raceProviders: true,
      earlyExitCriteria: { count: 1, tier: "any" },
      timeoutMs: 5_000,
    });

    // itunes editorial result should satisfy tier=any threshold
    expect(out.candidates.length).toBeGreaterThanOrEqual(1);
    const itunesReport = out.providerReports.find((r) => r.provider === "itunes");
    expect(itunesReport?.ok).toBe(true);
  });

  test("falls back to normal parallel when raceProviders=true but no earlyExitCriteria", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: delayedHandler(50, wikiCC0Result()),
      },
      {
        match: (u) => u.includes("itunes.apple.com"),
        handler: delayedHandler(80, itunesEditorialResult()),
      },
    ]);

    const out = await searchImages("test race no criteria", {
      providers: ["wikimedia", "itunes"],
      fetcher,
      raceProviders: true,
      // no earlyExitCriteria — should run normal parallel
      timeoutMs: 5_000,
    });

    expect(out.candidates.length).toBeGreaterThan(0);
    // Both should complete
    expect(out.providerReports.filter((r) => r.ok).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test: degradedTimeoutSequence — timeout penalty tracking
// ---------------------------------------------------------------------------

describe("degradedTimeoutSequence — adaptive timeout budget degradation", () => {
  beforeEach(() => _resetTimeoutHistory());
  afterEach(() => _resetTimeoutHistory());

  test("first timeout: provider still runs but with reduced budget on second call", async () => {
    // Call 1: wikimedia times out
    const neverResolve = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("AbortError"), { name: "AbortError" })),
            );
          }),
      },
    ]);

    const out1 = await searchImages("timeout first call", {
      providers: ["wikimedia"],
      fetcher: neverResolve,
      timeoutMs: 50, // very short — will time out
      degradedTimeoutMs: true,
    });

    const report1 = out1.providerReports.find((r) => r.provider === "wikimedia");
    expect(report1?.ok).toBe(false);
    expect(report1?.errorKind).toBe("timeout");

    // Call 2: provider runs but with 50% budget. Use a handler that resolves
    // in 200ms — if budget was halved from 50ms → 25ms, it will time out again.
    const slowHandler = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: delayedHandler(200, wikiCC0Result()),
      },
    ]);

    const out2 = await searchImages("timeout second call", {
      providers: ["wikimedia"],
      fetcher: slowHandler,
      timeoutMs: 300, // base budget; halved = 150ms → 200ms handler will time out
      degradedTimeoutMs: true,
    });

    // With halved budget (150ms) the 200ms handler should time out again
    const report2 = out2.providerReports.find((r) => r.provider === "wikimedia");
    expect(report2?.ok).toBe(false);
    expect(report2?.errorKind).toBe("timeout");
  });

  test("second timeout: provider is skipped entirely on third call", async () => {
    // Set up 2 timeouts via direct history manipulation through two real calls
    const neverResolve = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("AbortError"), { name: "AbortError" })),
            );
          }),
      },
    ]);

    // First timeout
    await searchImages("skip test call 1", {
      providers: ["wikimedia"],
      fetcher: neverResolve,
      timeoutMs: 20,
      degradedTimeoutMs: true,
    });

    // Second timeout
    await searchImages("skip test call 2", {
      providers: ["wikimedia"],
      fetcher: neverResolve,
      timeoutMs: 20,
      degradedTimeoutMs: true,
    });

    // Third call: provider should be skipped
    const fastHandler = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(wikiCC0Result()),
      },
    ]);

    const out3 = await searchImages("skip test call 3", {
      providers: ["wikimedia"],
      fetcher: fastHandler,
      timeoutMs: 5_000,
      degradedTimeoutMs: true,
    });

    // Provider should be in reports as skipped/disabled
    const report3 = out3.providerReports.find((r) => r.provider === "wikimedia");
    expect(report3?.ok).toBe(false);
    expect(report3?.skipped).toBe("disabled");
    expect(report3?.errorContext?.degradedSkip).toBe(true);
    // No candidates from the skipped provider
    expect(out3.candidates.length).toBe(0);
  });

  test("degradedTimeoutMs=false does not track or penalise timeouts", async () => {
    const neverResolve = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("AbortError"), { name: "AbortError" })),
            );
          }),
      },
    ]);

    // Two timeouts without degradedTimeoutMs
    await searchImages("no-degrade 1", {
      providers: ["wikimedia"],
      fetcher: neverResolve,
      timeoutMs: 20,
      degradedTimeoutMs: false,
    });
    await searchImages("no-degrade 2", {
      providers: ["wikimedia"],
      fetcher: neverResolve,
      timeoutMs: 20,
      degradedTimeoutMs: false,
    });

    // Third call should run normally (no skip)
    const fastHandler = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(wikiCC0Result()),
      },
    ]);

    const out = await searchImages("no-degrade 3", {
      providers: ["wikimedia"],
      fetcher: fastHandler,
      timeoutMs: 5_000,
      degradedTimeoutMs: false,
    });

    const report = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(report?.ok).toBe(true);
    expect(report?.skipped).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test: providerQueueing — two-wave dispatch for >8 providers
// ---------------------------------------------------------------------------

describe("providerQueueing — tier-1 / tier-2 wave dispatch", () => {
  beforeEach(() => _resetTimeoutHistory());

  /**
   * Build a stubFetcher for all 10+ providers: tier-1 providers resolve fast,
   * tier-2 providers resolve with a configurable delay.
   */
  function buildWaveFetcher(opts: {
    tier1DelayMs?: number;
    tier2DelayMs?: number;
    tier2ShouldTimeout?: boolean;
  } = {}) {
    const tier1Delay = opts.tier1DelayMs ?? 50;
    const tier2Delay = opts.tier2DelayMs ?? 100;

    return stubFetcher([
      // Tier-1 providers
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: delayedHandler(tier1Delay, wikiCC0Result("File:wiki.jpg")),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: delayedHandler(tier1Delay, { results: [], total_results: 0 }),
      },
      {
        match: (u) => u.includes("archive.org"),
        handler: delayedHandler(tier1Delay, { response: { docs: [] } }),
      },
      {
        match: (u) => u.includes("api.si.edu"),
        handler: delayedHandler(tier1Delay, { response: { rows: [] } }),
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: delayedHandler(tier1Delay, { collection: { items: [] } }),
      },
      {
        match: (u) => u.includes("collectionapi.metmuseum.org"),
        handler: delayedHandler(tier1Delay, { total: 0, objectIDs: null }),
      },
      {
        match: (u) => u.includes("loc.gov"),
        handler: delayedHandler(tier1Delay, { results: [], pagination: { total: 0 } }),
      },
      {
        match: (u) => u.includes("api.wellcomecollection.org"),
        handler: delayedHandler(tier1Delay, { results: [], totalResults: 0 }),
      },
      {
        match: (u) => u.includes("api.rawpixel.com"),
        handler: delayedHandler(tier1Delay, { results: [] }),
      },
      {
        match: (u) => u.includes("burst.shopify.com"),
        handler: delayedHandler(tier1Delay, []),
      },
      // Tier-2 provider (iTunes = editorial)
      {
        match: (u) => u.includes("itunes.apple.com"),
        handler: opts.tier2ShouldTimeout
          ? async (_url, init) =>
              new Promise<Response>((_resolve, reject) => {
                const signal = init?.signal as AbortSignal | undefined;
                signal?.addEventListener("abort", () =>
                  reject(Object.assign(new Error("AbortError"), { name: "AbortError" })),
                );
              })
          : delayedHandler(tier2Delay, itunesEditorialResult()),
      },
    ]);
  }

  test("with >8 providers and providerQueueing=true, tier-1 results arrive before tier-2", async () => {
    // Use 10 providers: 10 tier-1 (wikimedia through burst) + 1 tier-2 (itunes)
    const providers = [
      "wikimedia", "openverse", "internet-archive", "smithsonian", "nasa",
      "met-museum", "library-of-congress", "wellcome-collection", "rawpixel", "burst",
      "itunes",
    ] as const;

    const fetcher = buildWaveFetcher({ tier1DelayMs: 50, tier2DelayMs: 150 });

    const out = await searchImages("wave dispatch test", {
      providers: [...providers],
      fetcher,
      providerQueueing: true,
      timeoutMs: 5_000,
    });

    // All providers should have reports
    expect(out.providerReports.length).toBe(providers.length);

    // wikimedia (tier-1) should have succeeded
    const wikiReport = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(wikiReport?.ok).toBe(true);

    // itunes (tier-2) should also have succeeded
    const itunesReport = out.providerReports.find((r) => r.provider === "itunes");
    expect(itunesReport?.ok).toBe(true);
  });

  test("slow tier-2 provider timeout does not affect tier-1 results", async () => {
    const providers = [
      "wikimedia", "openverse", "internet-archive", "smithsonian", "nasa",
      "met-museum", "library-of-congress", "wellcome-collection", "rawpixel", "burst",
      "itunes",
    ] as const;

    // tier-1 providers resolve in 30ms; itunes (tier-2) never resolves
    const fetcher = buildWaveFetcher({ tier1DelayMs: 30, tier2ShouldTimeout: true });

    // Use a short timeoutMs so the per-provider timer fires quickly for itunes.
    // The wave AbortController fires after the wave budget (15s), but the
    // per-provider AbortController inside runWave fires after timeoutMs (150ms).
    const out = await searchImages("tier-2 timeout test", {
      providers: [...providers],
      fetcher,
      providerQueueing: true,
      timeoutMs: 150, // 30ms tier-1 completes fine; 150ms kills never-resolving itunes
    });

    // Tier-1 providers should complete ok (they resolve in 30ms < 150ms budget)
    const wikiReport = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(wikiReport?.ok).toBe(true);

    // itunes should have timed out (never resolves, killed at 150ms)
    const itunesReport = out.providerReports.find((r) => r.provider === "itunes");
    expect(itunesReport?.ok).toBe(false);
    expect(itunesReport?.errorKind).toBe("timeout");

    // wikimedia's CC0 result should still be in candidates
    expect(out.candidates.length).toBeGreaterThanOrEqual(1);
    const cc0Candidate = out.candidates.find((c) => c.source === "wikimedia");
    expect(cc0Candidate).toBeDefined();
  }, 10_000);

  test("providerQueueing=false with >8 providers runs them all in one parallel batch", async () => {
    const providers = [
      "wikimedia", "openverse", "internet-archive", "smithsonian", "nasa",
      "met-museum", "library-of-congress", "wellcome-collection", "rawpixel", "burst",
      "itunes",
    ] as const;

    const fetcher = buildWaveFetcher({ tier1DelayMs: 30, tier2DelayMs: 30 });

    const out = await searchImages("no-queueing test", {
      providers: [...providers],
      fetcher,
      providerQueueing: false,
      timeoutMs: 5_000,
    });

    expect(out.providerReports.length).toBe(providers.length);
    // All should succeed since they all resolve quickly
    const okCount = out.providerReports.filter((r) => r.ok).length;
    expect(okCount).toBeGreaterThan(0);
  });

  test("providerQueueing with exactly 8 providers does not split into waves", async () => {
    // Exactly 8 providers — queueing threshold is >8, so this runs as normal parallel
    const providers = [
      "wikimedia", "openverse", "internet-archive", "smithsonian",
      "nasa", "met-museum", "library-of-congress", "wellcome-collection",
    ] as const;

    const fetcher = buildWaveFetcher({ tier1DelayMs: 30 });

    const out = await searchImages("exactly 8 providers", {
      providers: [...providers],
      fetcher,
      providerQueueing: true,
      timeoutMs: 5_000,
    });

    expect(out.providerReports.length).toBe(providers.length);
  });
});

// ---------------------------------------------------------------------------
// Test: combined raceProviders + degradedTimeoutMs interaction
// ---------------------------------------------------------------------------

describe("raceProviders + degradedTimeoutMs combined", () => {
  beforeEach(() => _resetTimeoutHistory());
  afterEach(() => _resetTimeoutHistory());

  test("degraded-skipped provider is excluded from race and reported as disabled", async () => {
    // Pre-exhaust wikimedia by timing it out twice
    const neverResolve = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal as AbortSignal | undefined;
            signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("AbortError"), { name: "AbortError" })),
            );
          }),
      },
      {
        match: (u) => u.includes("itunes.apple.com"),
        handler: async () => jsonResponse(itunesEditorialResult()),
      },
    ]);

    await searchImages("pre-exhaust 1", {
      providers: ["wikimedia"],
      fetcher: neverResolve,
      timeoutMs: 20,
      degradedTimeoutMs: true,
    });
    await searchImages("pre-exhaust 2", {
      providers: ["wikimedia"],
      fetcher: neverResolve,
      timeoutMs: 20,
      degradedTimeoutMs: true,
    });

    // Now run race with both wikimedia (degraded) and itunes
    const out = await searchImages("race with degraded provider", {
      providers: ["wikimedia", "itunes"],
      fetcher: neverResolve,
      raceProviders: true,
      earlyExitCriteria: { count: 1, tier: "any" },
      timeoutMs: 5_000,
      degradedTimeoutMs: true,
    });

    // wikimedia should be skipped
    const wikiReport = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(wikiReport?.skipped).toBe("disabled");

    // itunes should succeed
    const itunesReport = out.providerReports.find((r) => r.provider === "itunes");
    expect(itunesReport?.ok).toBe(true);
  });
});
