/**
 * Provider Fallback Simulation — integration test suite.
 *
 * Simulates realistic multi-provider failure scenarios using injectable
 * fault handlers and verifies that the fallback strategy engine routes
 * correctly, records accurate ProviderReports, and produces actionable
 * federation-repair diagnostics.
 *
 * Failure scenarios covered:
 *   'timeout-after-2s'        — primary stalls until AbortSignal fires
 *   'http-429-then-recover'   — primary 429s; backup succeeds
 *   'http-503-consecutive'    — two providers return 503 consecutively
 *   'rate-limit-saturation'   — primary rate-limited, backup degrades to timeout
 *   'network-dns-fail'        — DNS-style network error (no HTTP status)
 *
 * For every scenario the test verifies:
 *   (a) Primary fails with the correct errorKind
 *   (b) Backup provider is tried and succeeds (or gracefully fails)
 *   (c) Final ranked candidates include results from at least one backup
 *   (d) ProviderReport reflects the failure chain (ok=false for primary,
 *       error details captured)
 *   (e) federation-repair diagnostics detect the expected pattern
 */

import { beforeEach, describe, expect, test } from "bun:test";

import {
  _resetTimeoutHistory,
  searchImages,
} from "../packages/core/src/federation.ts";
import {
  detectPatterns,
  getFederationRepairPlan,
} from "../packages/core/src/federation-repair.ts";
import { _resetTelemetry } from "../packages/core/src/federation-telemetry.ts";
import { _resetBuckets } from "../packages/core/src/rate-limit.ts";
import type { ImageCandidate, ProviderReport, SearchResultBundle } from "../packages/core/src/types.ts";
import { fixture, jsonResponse, stubFetcher } from "./stub-fetcher.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid ImageCandidate for backup provider responses. */
function makeCandidate(source: string, url: string): ImageCandidate {
  return {
    url,
    source,
    license: "CC_BY",
    confidence: 0.85,
    width: 800,
    height: 600,
  };
}

/**
 * Build a stub handler that throws an HTTP error matching a given status code.
 * Convention used by classifyError() in federation.ts: providers throw
 * `new Error("HTTP <status> <text>")`.
 */
function httpErrorHandler(status: number, text: string) {
  return async (_url: string, _init?: RequestInit): Promise<Response> => {
    throw new Error(`HTTP ${status} ${text}`);
  };
}

/**
 * Build a stub handler that stalls until the AbortSignal fires (simulates timeout).
 * The handler resolves/rejects immediately once aborted so tests stay fast.
 */
function timeoutHandler() {
  return (_url: string, init?: RequestInit): Promise<Response> =>
    new Promise<never>((_, reject) => {
      const sig = (init as RequestInit | undefined)?.signal;
      if (sig?.aborted) {
        reject(new Error("The operation was aborted"));
        return;
      }
      sig?.addEventListener("abort", () =>
        reject(new Error("The operation was aborted")),
      );
    });
}

/**
 * Build a handler that returns a successful JSON response shaped like the
 * openverse fixture so the provider can parse it correctly.
 */
function openverseSuccessHandler() {
  return async (_url: string, _init?: RequestInit): Promise<Response> =>
    jsonResponse(fixture("openverse.json"));
}

/**
 * Build a handler that returns a successful JSON response shaped like the
 * wikimedia fixture.
 */
function wikimediaSuccessHandler() {
  return async (_url: string, _init?: RequestInit): Promise<Response> =>
    jsonResponse(fixture("wikimedia.json"));
}

/** Shorthand: find a report for a given provider id. */
function reportFor(bundle: SearchResultBundle, provider: string): ProviderReport | undefined {
  return bundle.providerReports.find((r) => r.provider === provider);
}

// ---------------------------------------------------------------------------
// Reset shared state between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetTelemetry();
  _resetBuckets();
  _resetTimeoutHistory();
});

// ---------------------------------------------------------------------------
// Scenario 1 — Single provider timeout: 'timeout-after-2s'
// Primary stalls; backup (openverse) succeeds.
// ---------------------------------------------------------------------------

describe("scenario: timeout-after-2s", () => {
  test("(a) primary wikimedia fails with errorKind=timeout", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("cats", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 50, // very short so test stays fast
      repairPlan: true,
    });

    const wikiReport = reportFor(bundle, "wikimedia");
    expect(wikiReport).toBeDefined();
    expect(wikiReport!.ok).toBe(false);
    expect(wikiReport!.errorKind).toBe("timeout");
  }, 5_000);

  test("(b) backup openverse is tried and succeeds", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("cats", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 50,
      repairPlan: true,
    });

    const openverseReport = reportFor(bundle, "openverse");
    expect(openverseReport).toBeDefined();
    expect(openverseReport!.ok).toBe(true);
  }, 5_000);

  test("(c) final candidates include results from backup provider", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("cats", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 50,
      repairPlan: true,
    });

    expect(bundle.candidates.length).toBeGreaterThan(0);
    const sources = bundle.candidates.map((c) => c.source);
    expect(sources.some((s) => s === "openverse")).toBe(true);
  }, 5_000);

  test("(d) ProviderReport failure chain: wikimedia ok=false, openverse ok=true", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("cats", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 50,
      repairPlan: true,
    });

    expect(bundle.providerReports.length).toBeGreaterThanOrEqual(2);
    const wikiReport = reportFor(bundle, "wikimedia");
    const openverseReport = reportFor(bundle, "openverse");
    expect(wikiReport!.ok).toBe(false);
    expect(openverseReport!.ok).toBe(true);
  }, 5_000);

  test("(e) federation-repair detects all-timeout pattern when all providers timeout", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: timeoutHandler(),
      },
    ]);

    const bundle = await searchImages("cats", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 50,
      repairPlan: true,
    });

    expect(bundle.repairPlan).toBeDefined();
    expect(bundle.repairPlan!.healthy).toBe(false);
    expect(bundle.repairPlan!.detectedPatterns).toContain("all-timeout");

    // Recommendations should include increase-timeout
    const timeoutRec = bundle.repairPlan!.recommendations.find(
      (r) => r.action === "increase-timeout",
    );
    expect(timeoutRec).toBeDefined();
    expect((timeoutRec!.parameters.suggestedTimeoutMs as number)).toBeGreaterThan(50);
  }, 5_000);
});

// ---------------------------------------------------------------------------
// Scenario 2 — HTTP 429 then recover: 'http-429-then-recover'
// Primary returns 429; backup succeeds.
// ---------------------------------------------------------------------------

describe("scenario: http-429-then-recover", () => {
  test("(a) primary fails with errorKind=rate-limited", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(429, "Too Many Requests"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("dogs", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    const wikiReport = reportFor(bundle, "wikimedia");
    expect(wikiReport).toBeDefined();
    expect(wikiReport!.ok).toBe(false);
    expect(wikiReport!.errorKind).toBe("rate-limited");
  });

  test("(b) backup openverse runs and succeeds after primary 429", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(429, "Too Many Requests"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("dogs", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    const openverseReport = reportFor(bundle, "openverse");
    expect(openverseReport).toBeDefined();
    expect(openverseReport!.ok).toBe(true);
    expect(openverseReport!.count).toBeGreaterThan(0);
  });

  test("(c) candidates come from backup openverse", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(429, "Too Many Requests"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("dogs", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 5_000,
    });

    expect(bundle.candidates.length).toBeGreaterThan(0);
    const openverseCandidates = bundle.candidates.filter((c) => c.source === "openverse");
    expect(openverseCandidates.length).toBeGreaterThan(0);
  });

  test("(d) ProviderReport: wikimedia ok=false rate-limited, openverse ok=true", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(429, "Too Many Requests"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("dogs", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    const wiki = reportFor(bundle, "wikimedia");
    const ov = reportFor(bundle, "openverse");
    expect(wiki!.ok).toBe(false);
    expect(wiki!.errorKind).toBe("rate-limited");
    expect(ov!.ok).toBe(true);
  });

  test("(e) federation-repair detects rate-limited pattern and recommends retry", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(429, "Too Many Requests"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("dogs", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    expect(bundle.repairPlan).toBeDefined();
    expect(bundle.repairPlan!.detectedPatterns).toContain("rate-limited");

    const retryRec = bundle.repairPlan!.recommendations.find(
      (r) => r.action === "retry",
    );
    expect(retryRec).toBeDefined();
    expect(retryRec!.rationale.toLowerCase()).toContain("rate-limit");
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — HTTP 503 consecutive: 'http-503-consecutive'
// Both primary and first backup return 503; second backup (nasa) succeeds.
// ---------------------------------------------------------------------------

describe("scenario: http-503-consecutive", () => {
  test("(a) primary wikimedia fails with errorKind=http-5xx", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);

    const bundle = await searchImages("space", {
      providers: ["wikimedia", "openverse", "nasa"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    const wikiReport = reportFor(bundle, "wikimedia");
    expect(wikiReport).toBeDefined();
    expect(wikiReport!.ok).toBe(false);
    expect(wikiReport!.errorKind).toBe("http-5xx");
  });

  test("(b) backup2 nasa is tried after both primary and backup1 fail", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);

    const bundle = await searchImages("space", {
      providers: ["wikimedia", "openverse", "nasa"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    const nasaReport = reportFor(bundle, "nasa");
    expect(nasaReport).toBeDefined();
    expect(nasaReport!.ok).toBe(true);
  });

  test("(c) final candidates include results from nasa (the only success)", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);

    const bundle = await searchImages("space", {
      providers: ["wikimedia", "openverse", "nasa"],
      fetcher,
      timeoutMs: 5_000,
    });

    expect(bundle.candidates.length).toBeGreaterThan(0);
    const nasaCandidates = bundle.candidates.filter((c) => c.source === "nasa");
    expect(nasaCandidates.length).toBeGreaterThan(0);
  });

  test("(d) ProviderReport: wikimedia+openverse ok=false http-5xx, nasa ok=true", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);

    const bundle = await searchImages("space", {
      providers: ["wikimedia", "openverse", "nasa"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    const wiki = reportFor(bundle, "wikimedia");
    const ov = reportFor(bundle, "openverse");
    const nasa = reportFor(bundle, "nasa");

    expect(wiki!.ok).toBe(false);
    expect(wiki!.errorKind).toBe("http-5xx");
    expect(ov!.ok).toBe(false);
    expect(ov!.errorKind).toBe("http-5xx");
    expect(nasa!.ok).toBe(true);
  });

  test("(e) repair detects partial-failure; all-failed only if nasa also fails", async () => {
    // When nasa succeeds, it's partial-failure not all-failed
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);

    const bundle = await searchImages("space", {
      providers: ["wikimedia", "openverse", "nasa"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    expect(bundle.repairPlan).toBeDefined();
    expect(bundle.repairPlan!.detectedPatterns).toContain("partial-failure");
    expect(bundle.repairPlan!.detectedPatterns).not.toContain("all-failed");
  });

  test("all-503 scenario: all-failed detected + add-provider recommendation", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
    ]);

    const bundle = await searchImages("space", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    expect(bundle.repairPlan).toBeDefined();
    expect(bundle.repairPlan!.detectedPatterns).toContain("all-failed");
    expect(bundle.repairPlan!.healthy).toBe(false);

    const addProvRec = bundle.repairPlan!.recommendations.find(
      (r) => r.action === "add-provider",
    );
    expect(addProvRec).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — Rate-limit saturation then degraded timeout:
// 'rate-limit-saturation'
// Primary 429, backup1 times out, backup2 (nasa) succeeds.
// ---------------------------------------------------------------------------

describe("scenario: rate-limit-saturation", () => {
  test("(a) primary fails with rate-limited errorKind", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(429, "Too Many Requests"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);

    const bundle = await searchImages("aurora", {
      providers: ["wikimedia", "openverse", "nasa"],
      fetcher,
      timeoutMs: 50,
      repairPlan: true,
    });

    const wiki = reportFor(bundle, "wikimedia");
    expect(wiki!.ok).toBe(false);
    expect(wiki!.errorKind).toBe("rate-limited");
  }, 5_000);

  test("(b) backup1 timeout captured; backup2 nasa tried", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(429, "Too Many Requests"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);

    const bundle = await searchImages("aurora", {
      providers: ["wikimedia", "openverse", "nasa"],
      fetcher,
      timeoutMs: 50,
      repairPlan: true,
    });

    const ov = reportFor(bundle, "openverse");
    expect(ov!.ok).toBe(false);
    expect(ov!.errorKind).toBe("timeout");

    const nasa = reportFor(bundle, "nasa");
    expect(nasa!.ok).toBe(true);
  }, 5_000);

  test("(c) candidates sourced from backup2 (nasa) after mixed failures", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(429, "Too Many Requests"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);

    const bundle = await searchImages("aurora", {
      providers: ["wikimedia", "openverse", "nasa"],
      fetcher,
      timeoutMs: 50,
    });

    expect(bundle.candidates.length).toBeGreaterThan(0);
    const nasaCandidates = bundle.candidates.filter((c) => c.source === "nasa");
    expect(nasaCandidates.length).toBeGreaterThan(0);
  }, 5_000);

  test("(d) ProviderReport: wiki=rate-limited, openverse=timeout, nasa=ok", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(429, "Too Many Requests"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);

    const bundle = await searchImages("aurora", {
      providers: ["wikimedia", "openverse", "nasa"],
      fetcher,
      timeoutMs: 50,
      repairPlan: true,
    });

    const wiki = reportFor(bundle, "wikimedia");
    const ov = reportFor(bundle, "openverse");
    const nasa = reportFor(bundle, "nasa");

    expect(wiki!.ok).toBe(false);
    expect(wiki!.errorKind).toBe("rate-limited");
    expect(ov!.ok).toBe(false);
    expect(ov!.errorKind).toBe("timeout");
    expect(nasa!.ok).toBe(true);
    expect(nasa!.count).toBeGreaterThan(0);
  }, 5_000);

  test("(e) repair detects both rate-limited and partial-failure patterns", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(429, "Too Many Requests"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);

    const bundle = await searchImages("aurora", {
      providers: ["wikimedia", "openverse", "nasa"],
      fetcher,
      timeoutMs: 50,
      repairPlan: true,
    });

    expect(bundle.repairPlan).toBeDefined();
    expect(bundle.repairPlan!.detectedPatterns).toContain("rate-limited");
    expect(bundle.repairPlan!.detectedPatterns).toContain("partial-failure");
  }, 5_000);
});

// ---------------------------------------------------------------------------
// Scenario 5 — Network DNS fail: 'network-dns-fail'
// Primary throws a network-level error (no HTTP status); backup succeeds.
// ---------------------------------------------------------------------------

describe("scenario: network-dns-fail", () => {
  test("(a) primary fails with errorKind=network (no HTTP status)", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => {
          throw new Error("getaddrinfo ENOTFOUND commons.wikimedia.org");
        },
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("birds", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    const wiki = reportFor(bundle, "wikimedia");
    expect(wiki).toBeDefined();
    expect(wiki!.ok).toBe(false);
    expect(wiki!.errorKind).toBe("network");
  });

  test("(b) backup provider runs and succeeds after DNS failure", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => {
          throw new Error("getaddrinfo ENOTFOUND commons.wikimedia.org");
        },
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("birds", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    const ov = reportFor(bundle, "openverse");
    expect(ov).toBeDefined();
    expect(ov!.ok).toBe(true);
  });

  test("(c) candidates include results from backup after DNS error", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => {
          throw new Error("getaddrinfo ENOTFOUND commons.wikimedia.org");
        },
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("birds", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 5_000,
    });

    expect(bundle.candidates.length).toBeGreaterThan(0);
    const openverseCandidates = bundle.candidates.filter((c) => c.source === "openverse");
    expect(openverseCandidates.length).toBeGreaterThan(0);
  });

  test("(d) ProviderReport error field captures DNS error message", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => {
          throw new Error("getaddrinfo ENOTFOUND commons.wikimedia.org");
        },
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("birds", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    const wiki = reportFor(bundle, "wikimedia");
    expect(wiki!.error).toBeDefined();
    expect(wiki!.error).toContain("ENOTFOUND");
    expect(wiki!.errorKind).toBe("network");
  });

  test("(e) repair detects partial-failure with network errorKind", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => {
          throw new Error("getaddrinfo ENOTFOUND commons.wikimedia.org");
        },
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: openverseSuccessHandler(),
      },
    ]);

    const bundle = await searchImages("birds", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 5_000,
      repairPlan: true,
    });

    expect(bundle.repairPlan).toBeDefined();
    expect(bundle.repairPlan!.detectedPatterns).toContain("partial-failure");

    // Error should be recorded on the provider report
    const failedReports = bundle.providerReports.filter((r) => !r.ok);
    expect(failedReports.length).toBeGreaterThan(0);
    expect(failedReports.every((r) => r.errorKind !== undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — Cascading timeouts + recovery (multi-provider)
// All of primary + backup1 + backup2 timeout; backup3 (nasa) recovers.
// This tests that federation does not short-circuit silently.
// ---------------------------------------------------------------------------

describe("scenario: cascading-timeouts-then-recovery", () => {
  test("all timed-out providers captured; surviving provider supplies results", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("www.flickr.com") || u.includes("flickr"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);

    const bundle = await searchImages("nebula", {
      providers: ["wikimedia", "openverse", "nasa"],
      fetcher,
      timeoutMs: 50,
      repairPlan: true,
    });

    // At least one provider timed out
    const timedOut = bundle.providerReports.filter(
      (r) => r.errorKind === "timeout",
    );
    expect(timedOut.length).toBeGreaterThan(0);

    // nasa succeeded
    const nasa = reportFor(bundle, "nasa");
    expect(nasa!.ok).toBe(true);

    // Candidates available from recovery provider
    expect(bundle.candidates.length).toBeGreaterThan(0);
  }, 5_000);

  test("fallbackChain: sequential fallback stops at first success", async () => {
    let openverseCalled = false;

    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: httpErrorHandler(503, "Service Unavailable"),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: async (url, init) => {
          openverseCalled = true;
          return openverseSuccessHandler()(url, init);
        },
      },
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);

    const bundle = await searchImages("mountain", {
      providers: ["nasa"], // parallel (not in chain)
      fallbackChain: ["wikimedia", "openverse"], // sequential chain
      fetcher,
      timeoutMs: 5_000,
    });

    // wikimedia in chain failed; openverse in chain should have been tried
    expect(openverseCalled).toBe(true);

    // Candidates from either nasa (parallel) or openverse (chain)
    expect(bundle.candidates.length).toBeGreaterThan(0);
  });

  test("repair plan recommendations are sorted by estimatedImpact descending", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: timeoutHandler(),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: timeoutHandler(),
      },
    ]);

    const bundle = await searchImages("forest", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      timeoutMs: 50,
      repairPlan: true,
    });

    const recs = bundle.repairPlan!.recommendations;
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1]!.estimatedImpact).toBeGreaterThanOrEqual(
        recs[i]!.estimatedImpact,
      );
    }
  }, 5_000);
});

// ---------------------------------------------------------------------------
// Cross-cutting: ProviderReport shape invariants
// All scenarios must produce well-formed reports.
// ---------------------------------------------------------------------------

describe("ProviderReport shape invariants across all scenarios", () => {
  const scenarios: Array<{ name: string; fetcher: ReturnType<typeof stubFetcher>; providers: any[] }> = [
    {
      name: "timeout",
      fetcher: stubFetcher([
        {
          match: (u) => u.includes("commons.wikimedia.org"),
          handler: timeoutHandler(),
        },
        {
          match: (u) => u.includes("api.openverse.org"),
          handler: openverseSuccessHandler(),
        },
      ]),
      providers: ["wikimedia", "openverse"],
    },
    {
      name: "http-429",
      fetcher: stubFetcher([
        {
          match: (u) => u.includes("commons.wikimedia.org"),
          handler: httpErrorHandler(429, "Too Many Requests"),
        },
        {
          match: (u) => u.includes("api.openverse.org"),
          handler: openverseSuccessHandler(),
        },
      ]),
      providers: ["wikimedia", "openverse"],
    },
    {
      name: "http-503",
      fetcher: stubFetcher([
        {
          match: (u) => u.includes("commons.wikimedia.org"),
          handler: httpErrorHandler(503, "Service Unavailable"),
        },
        {
          match: (u) => u.includes("api.openverse.org"),
          handler: openverseSuccessHandler(),
        },
      ]),
      providers: ["wikimedia", "openverse"],
    },
    {
      name: "network-dns",
      fetcher: stubFetcher([
        {
          match: (u) => u.includes("commons.wikimedia.org"),
          handler: async () => {
            throw new Error("getaddrinfo ENOTFOUND commons.wikimedia.org");
          },
        },
        {
          match: (u) => u.includes("api.openverse.org"),
          handler: openverseSuccessHandler(),
        },
      ]),
      providers: ["wikimedia", "openverse"],
    },
  ];

  for (const scenario of scenarios) {
    test(`${scenario.name}: all reports have required fields`, async () => {
      const bundle = await searchImages("test", {
        providers: scenario.providers,
        fetcher: scenario.fetcher,
        timeoutMs: 80,
        repairPlan: true,
      });

      expect(bundle.providerReports.length).toBeGreaterThan(0);
      for (const report of bundle.providerReports) {
        expect(typeof report.provider).toBe("string");
        expect(typeof report.ok).toBe("boolean");
        expect(typeof report.count).toBe("number");
        expect(typeof report.timeMs).toBe("number");
        // All non-ok reports must have an errorKind
        if (!report.ok && !report.skipped) {
          expect(report.errorKind).toBeDefined();
          expect(report.errorKind).not.toBe(undefined);
        }
      }
    }, 5_000);
  }
});

// ---------------------------------------------------------------------------
// Cross-cutting: detectPatterns() directly from report arrays
// Validates the repair engine independently of the full searchImages pipeline.
// ---------------------------------------------------------------------------

describe("detectPatterns: direct injection of failure scenarios", () => {
  test("'timeout-after-2s' scenario reports → detects all-timeout + all-failed", () => {
    const patterns = detectPatterns({
      reports: [
        { provider: "wikimedia", ok: false, count: 0, timeMs: 52, errorKind: "timeout" },
        { provider: "openverse", ok: false, count: 0, timeMs: 51, errorKind: "timeout" },
      ],
      candidates: [],
      timeoutMs: 50,
    });

    expect(patterns.has("all-timeout")).toBe(true);
    expect(patterns.has("all-failed")).toBe(true);
  });

  test("'http-429-then-recover' scenario reports → detects rate-limited + partial-failure", () => {
    const patterns = detectPatterns({
      reports: [
        { provider: "wikimedia", ok: false, count: 0, timeMs: 10, errorKind: "rate-limited" },
        { provider: "openverse", ok: true, count: 5, timeMs: 200, errorKind: "ok" },
      ],
      candidates: [
        { url: "https://example.com/img.jpg", source: "openverse", license: "CC_BY", confidence: 0.9 },
      ],
    });

    expect(patterns.has("rate-limited")).toBe(true);
    expect(patterns.has("partial-failure")).toBe(true);
    expect(patterns.has("all-failed")).toBe(false);
  });

  test("'http-503-consecutive' scenario reports (all fail) → detects all-failed", () => {
    const patterns = detectPatterns({
      reports: [
        { provider: "wikimedia", ok: false, count: 0, timeMs: 30, errorKind: "http-5xx" },
        { provider: "openverse", ok: false, count: 0, timeMs: 28, errorKind: "http-5xx" },
      ],
      candidates: [],
      requestedProviders: ["wikimedia", "openverse"],
    });

    expect(patterns.has("all-failed")).toBe(true);
    expect(patterns.has("no-results")).toBe(true);
    expect(patterns.has("no-browser-provider")).toBe(true);
  });

  test("'rate-limit-saturation' mixed-error reports → detects rate-limited + partial-failure", () => {
    const patterns = detectPatterns({
      reports: [
        { provider: "wikimedia", ok: false, count: 0, timeMs: 5, errorKind: "rate-limited" },
        { provider: "openverse", ok: false, count: 0, timeMs: 55, errorKind: "timeout" },
        { provider: "nasa", ok: true, count: 3, timeMs: 300, errorKind: "ok" },
      ],
      candidates: [
        { url: "https://images-api.nasa.gov/img/123.jpg", source: "nasa", license: "CC0", confidence: 1.0 },
      ],
    });

    expect(patterns.has("rate-limited")).toBe(true);
    expect(patterns.has("partial-failure")).toBe(true);
    expect(patterns.has("all-failed")).toBe(false);
    expect(patterns.has("all-timeout")).toBe(false); // not all timeouts — mixed
  });

  test("'network-dns-fail' scenario reports → detects partial-failure with network kind", () => {
    const patterns = detectPatterns({
      reports: [
        { provider: "wikimedia", ok: false, count: 0, timeMs: 12, errorKind: "network", error: "getaddrinfo ENOTFOUND" },
        { provider: "openverse", ok: true, count: 4, timeMs: 250, errorKind: "ok" },
      ],
      candidates: [
        { url: "https://api.openverse.org/img/1.jpg", source: "openverse", license: "CC_BY", confidence: 0.8 },
      ],
    });

    expect(patterns.has("partial-failure")).toBe(true);
    expect(patterns.has("all-failed")).toBe(false);
  });

  test("getFederationRepairPlan: all-timeout produces increase-timeout as top recommendation", () => {
    const plan = getFederationRepairPlan({
      reports: [
        { provider: "wikimedia", ok: false, count: 0, timeMs: 52, errorKind: "timeout" },
        { provider: "openverse", ok: false, count: 0, timeMs: 51, errorKind: "timeout" },
      ],
      candidates: [],
      timeoutMs: 1_000,
      requestedProviders: ["wikimedia", "openverse"],
    });

    expect(plan.healthy).toBe(false);
    expect(plan.detectedPatterns).toContain("all-timeout");

    const top = plan.recommendations[0];
    expect(top).toBeDefined();
    expect(top!.action).toBe("increase-timeout");
    expect(top!.parameters.suggestedTimeoutMs).toBe(2_000); // 1_000 * 2
  });
});
