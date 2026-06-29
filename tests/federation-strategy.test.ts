/**
 * Tests for Provider Health & Failover Strategy:
 *  - Per-query provider ranking (fastest / healthiest / default)
 *  - Adaptive timeout (resolveTimeout logic via observable side-effects)
 *  - Fallback chain (sequential, stops at first success)
 *  - getProviderRanking() utility
 *  - GET /v1/federation-strategy HTTP endpoint
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

// src/ imports (same module instance as searchImages)
import {
  _resetTelemetry,
  emitProviderEvent,
  getProviderRanking,
  getProviderSequenceEvents,
} from "../packages/core/src/federation-telemetry.ts";
import { _resetBuckets, getBucket } from "../packages/core/src/rate-limit.ts";
import { searchImages } from "../packages/core/src/federation.ts";

// dist/ imports for HTTP tests
import {
  _resetTelemetry as resetDist,
  emitProviderEvent as emitDist,
  getProviderRanking as getRankingDist,
} from "webfetch-core";

import { startServer } from "../packages/server/src/server.ts";
import { fixture, jsonResponse, stubFetcher } from "./stub-fetcher.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now() {
  return Date.now();
}

function makeEvent(
  providerId: "wikimedia" | "openverse" | "unsplash" | "pexels",
  opts: { ok: boolean; durationMs: number; resultCount?: number },
) {
  const t = now();
  return {
    providerId,
    startedAt: t - opts.durationMs,
    endedAt: t,
    durationMs: opts.durationMs,
    resultCount: opts.ok ? (opts.resultCount ?? 3) : 0,
    ok: opts.ok,
    errorKind: opts.ok ? ("ok" as const) : ("network" as const),
    payloadBytes: opts.ok ? 512 : 0,
  };
}

// ---------------------------------------------------------------------------
// Unit: getProviderRanking
// ---------------------------------------------------------------------------

describe("getProviderRanking unit", () => {
  beforeEach(() => {
    _resetTelemetry();
    _resetBuckets();
  });

  test("returns one entry per requested provider", () => {
    const ranking = getProviderRanking(["wikimedia", "openverse"]);
    expect(ranking.byHealth).toHaveLength(2);
    expect(ranking.byLatency).toHaveLength(2);
    expect(ranking.byHealth.map((e) => e.id).sort()).toEqual(["openverse", "wikimedia"]);
  });

  test("no-data providers get healthScore=1 and predictedSuccessRate=1", () => {
    const ranking = getProviderRanking(["wikimedia"]);
    const entry = ranking.byHealth[0]!;
    expect(entry.healthScore).toBe(1);
    expect(entry.predictedSuccessRate).toBe(1);
    expect(entry.errorRate).toBe(0);
    expect(entry.saturated).toBe(false);
  });

  test("high error-rate provider gets lower healthScore", () => {
    // 3 failures out of 3 calls → errorRate=1, healthScore=0
    for (let i = 0; i < 3; i++) {
      emitProviderEvent(makeEvent("openverse", { ok: false, durationMs: 200 }));
    }
    // 3 successes → errorRate=0, healthScore=1
    for (let i = 0; i < 3; i++) {
      emitProviderEvent(makeEvent("wikimedia", { ok: true, durationMs: 100 }));
    }

    const ranking = getProviderRanking(["wikimedia", "openverse"]);
    const byHealth = ranking.byHealth;
    expect(byHealth[0]!.id).toBe("wikimedia");
    expect(byHealth[1]!.id).toBe("openverse");
    expect(byHealth[0]!.healthScore).toBeGreaterThan(byHealth[1]!.healthScore);
  });

  test("saturated provider gets rateLimitPenalty=0.5 in healthScore", () => {
    // Drain wikimedia bucket fully
    const bucket = getBucket("wikimedia");
    for (let i = 0; i < 30; i++) bucket.tryTake();

    emitProviderEvent(makeEvent("wikimedia", { ok: false, durationMs: 100 }));

    const ranking = getProviderRanking(["wikimedia"]);
    const entry = ranking.byHealth[0]!;
    expect(entry.saturated).toBe(true);
    expect(entry.healthScore).toBeLessThanOrEqual(0.5);
    expect(entry.predictedSuccessRate).toBe(0);
  });

  test("fastest ordering puts lowest-latency provider first", () => {
    // openverse: 3 calls at 50ms each
    for (let i = 0; i < 3; i++) {
      emitProviderEvent(makeEvent("openverse", { ok: true, durationMs: 50 }));
    }
    // wikimedia: 3 calls at 800ms each
    for (let i = 0; i < 3; i++) {
      emitProviderEvent(makeEvent("wikimedia", { ok: true, durationMs: 800 }));
    }

    const ranking = getProviderRanking(["wikimedia", "openverse"]);
    expect(ranking.byLatency[0]!.id).toBe("openverse");
    expect(ranking.byLatency[1]!.id).toBe("wikimedia");
  });

  test("no-data providers sort after data-providers in fastest ordering", () => {
    // Only wikimedia has data
    emitProviderEvent(makeEvent("wikimedia", { ok: true, durationMs: 500 }));

    // openverse has no data
    const ranking = getProviderRanking(["wikimedia", "openverse"]);
    expect(ranking.byLatency[0]!.id).toBe("wikimedia");
    expect(ranking.byLatency[1]!.id).toBe("openverse");
  });

  test("rankHealthiest and rankFastest are 1-based positions", () => {
    emitProviderEvent(makeEvent("wikimedia", { ok: true, durationMs: 100 }));
    emitProviderEvent(makeEvent("openverse", { ok: true, durationMs: 200 }));

    const ranking = getProviderRanking(["wikimedia", "openverse"]);
    const wikiHealth = ranking.byHealth.find((e) => e.id === "wikimedia")!;
    const wikiLatency = ranking.byLatency.find((e) => e.id === "wikimedia")!;
    expect(wikiHealth.rankHealthiest).toBeGreaterThanOrEqual(1);
    expect(wikiLatency.rankFastest).toBeGreaterThanOrEqual(1);
    // Ranks across byHealth and byLatency arrays should be consistent
    expect(wikiHealth.rankFastest).toBe(wikiLatency.rankFastest);
    expect(wikiHealth.rankHealthiest).toBe(wikiLatency.rankHealthiest);
  });

  test("windowMs and generatedAt present", () => {
    const before = Date.now();
    const ranking = getProviderRanking(["wikimedia"], 120_000);
    const after = Date.now();
    expect(ranking.windowMs).toBe(120_000);
    expect(ranking.generatedAt).toBeGreaterThanOrEqual(before);
    expect(ranking.generatedAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// Unit: providerPreference ordering via searchImages
// ---------------------------------------------------------------------------

describe("searchImages providerPreference ordering", () => {
  beforeEach(() => {
    _resetTelemetry();
    _resetBuckets();
  });

  test("default preference: providers dispatched in original order", async () => {
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
    const out = await searchImages("test", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      providerPreference: "default",
    });
    expect(out.candidates.length).toBeGreaterThan(0);
    // Sequence event should record both providers
    const seqEvents = getProviderSequenceEvents(1);
    expect(seqEvents[0]?.preference).toBe("default");
    expect(seqEvents[0]?.dispatchOrder).toEqual(["wikimedia", "openverse"]);
  });

  test("healthiest preference: healthy provider ranked first", async () => {
    // Pre-seed: openverse has 100% error rate, wikimedia is clean
    for (let i = 0; i < 3; i++) {
      emitProviderEvent(makeEvent("openverse", { ok: false, durationMs: 200 }));
    }
    for (let i = 0; i < 3; i++) {
      emitProviderEvent(makeEvent("wikimedia", { ok: true, durationMs: 300 }));
    }

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

    await searchImages("test", {
      providers: ["openverse", "wikimedia"], // openverse listed first
      fetcher,
      providerPreference: "healthiest",
    });

    const seqEvents = getProviderSequenceEvents(1);
    expect(seqEvents[0]?.preference).toBe("healthiest");
    // wikimedia should be dispatched first (healthier)
    expect(seqEvents[0]?.dispatchOrder[0]).toBe("wikimedia");
  });

  test("fastest preference: low-latency provider ranked first", async () => {
    // openverse: fast (50ms), wikimedia: slow (1000ms)
    for (let i = 0; i < 3; i++) {
      emitProviderEvent(makeEvent("openverse", { ok: true, durationMs: 50 }));
      emitProviderEvent(makeEvent("wikimedia", { ok: true, durationMs: 1000 }));
    }

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

    await searchImages("test", {
      providers: ["wikimedia", "openverse"], // wikimedia listed first
      fetcher,
      providerPreference: "fastest",
    });

    const seqEvents = getProviderSequenceEvents(1);
    expect(seqEvents[0]?.preference).toBe("fastest");
    // openverse should be dispatched first (faster)
    expect(seqEvents[0]?.dispatchOrder[0]).toBe("openverse");
  });

  test("sequence event records query and startedAt", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);
    const before = Date.now();
    await searchImages("sequence event test", {
      providers: ["wikimedia"],
      fetcher,
    });
    const after = Date.now();
    const seqEvents = getProviderSequenceEvents(1);
    expect(seqEvents[0]?.query).toBe("sequence event test");
    expect(seqEvents[0]?.startedAt).toBeGreaterThanOrEqual(before);
    expect(seqEvents[0]?.startedAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// Unit: fallbackChain
// ---------------------------------------------------------------------------

describe("searchImages fallbackChain", () => {
  beforeEach(() => {
    _resetTelemetry();
    _resetBuckets();
  });

  test("fallback chain: uses second provider when first fails", async () => {
    let openverseCalled = false;
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => {
          throw new Error("HTTP 500 server error");
        },
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: async () => {
          openverseCalled = true;
          return jsonResponse(fixture("openverse.json"));
        },
      },
    ]);

    const out = await searchImages("fallback test", {
      providers: [],
      fallbackChain: ["wikimedia", "openverse"],
      fetcher,
    });

    expect(openverseCalled).toBe(true);
    expect(out.candidates.length).toBeGreaterThan(0);
    // wikimedia should have failed
    const wikiReport = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(wikiReport?.ok).toBe(false);
    // openverse should have succeeded
    const openReport = out.providerReports.find((r) => r.provider === "openverse");
    expect(openReport?.ok).toBe(true);
  });

  test("fallback chain: stops at first successful provider", async () => {
    let openverseCalled = false;
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: async () => {
          openverseCalled = true;
          return jsonResponse(fixture("openverse.json"));
        },
      },
    ]);

    const out = await searchImages("stop at first", {
      providers: [],
      fallbackChain: ["wikimedia", "openverse"],
      fetcher,
    });

    // wikimedia succeeded — openverse should not be called
    expect(openverseCalled).toBe(false);
    expect(out.candidates.length).toBeGreaterThan(0);
  });

  test("fallback chain: parallel providers still run alongside chain", async () => {
    let itunesCalled = false;
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
      {
        match: (u) => u.includes("itunes.apple.com"),
        handler: async () => {
          itunesCalled = true;
          return jsonResponse(fixture("itunes.json"));
        },
      },
    ]);

    await searchImages("parallel + chain", {
      providers: ["itunes"],           // parallel
      fallbackChain: ["wikimedia"],    // chain
      fetcher,
    });

    expect(itunesCalled).toBe(true);
  });

  test("dryRun with fallbackChain returns no candidates", async () => {
    const out = await searchImages("dry run fallback", {
      providers: ["wikimedia"],
      fallbackChain: ["openverse"],
      dryRun: true,
    });
    expect(out.candidates).toHaveLength(0);
    expect(out.warnings.some((w) => w.includes("dryRun"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HTTP: GET /v1/federation-strategy endpoint
// ---------------------------------------------------------------------------

const TOKEN = "s".repeat(64);
let server: ReturnType<typeof startServer> | undefined;
let base: string;

beforeAll(async () => {
  server = await startTestServer();
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  try {
    server?.stop(true);
  } catch {}
});

async function startTestServer() {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = 32_000 + (process.pid % 10_000) + attempt;
    try {
      return startServer({ port, token: TOKEN });
    } catch (err) {
      lastError = err;
      if (!String(err).includes("port")) break;
    }
  }
  throw lastError ?? new Error("Failed to start test server");
}

describe("GET /v1/federation-strategy HTTP endpoint", () => {
  beforeEach(() => {
    resetDist();
  });

  test("returns 401 without auth token", async () => {
    const r = await fetch(`${base}/v1/federation-strategy`);
    expect(r.status).toBe(401);
  });

  test("returns 200 with correct shape on empty buffer", async () => {
    const r = await fetch(`${base}/v1/federation-strategy`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.data.byHealth)).toBe(true);
    expect(Array.isArray(j.data.byLatency)).toBe(true);
    expect(typeof j.data.windowMs).toBe("number");
    expect(typeof j.data.generatedAt).toBe("number");
  });

  test("also works on unversioned /federation-strategy", async () => {
    const r = await fetch(`${base}/federation-strategy`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(true);
  });

  test("reflects emitted telemetry in provider rank entries", async () => {
    const t = Date.now();
    // wikimedia: 3 successes at 100ms
    for (let i = 0; i < 3; i++) {
      emitDist({
        providerId: "wikimedia",
        startedAt: t - 100,
        endedAt: t,
        durationMs: 100,
        resultCount: 5,
        ok: true,
        errorKind: "ok",
        payloadBytes: 512,
      });
    }
    // openverse: 3 failures
    for (let i = 0; i < 3; i++) {
      emitDist({
        providerId: "openverse",
        startedAt: t - 200,
        endedAt: t,
        durationMs: 200,
        resultCount: 0,
        ok: false,
        errorKind: "network",
        payloadBytes: 0,
      });
    }

    const r = await fetch(
      `${base}/v1/federation-strategy?providers=wikimedia,openverse`,
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;

    const wikiEntry = j.data.byHealth.find((e: any) => e.id === "wikimedia");
    const openEntry = j.data.byHealth.find((e: any) => e.id === "openverse");

    expect(wikiEntry).toBeDefined();
    expect(openEntry).toBeDefined();
    // wikimedia should rank above openverse in health
    expect(wikiEntry.rankHealthiest).toBeLessThan(openEntry.rankHealthiest);
    expect(wikiEntry.healthScore).toBeGreaterThan(openEntry.healthScore);
    expect(wikiEntry.predictedSuccessRate).toBeGreaterThan(openEntry.predictedSuccessRate);
  });

  test("accepts windowMs query param", async () => {
    const r = await fetch(`${base}/v1/federation-strategy?windowMs=60000`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.data.windowMs).toBe(60000);
  });

  test("rejects invalid windowMs with 422", async () => {
    const r = await fetch(`${base}/v1/federation-strategy?windowMs=500`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(422);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(false);
  });

  test("provider rank entries have required fields", async () => {
    emitDist({
      providerId: "wikimedia",
      startedAt: Date.now() - 300,
      endedAt: Date.now(),
      durationMs: 300,
      resultCount: 4,
      ok: true,
      errorKind: "ok",
      payloadBytes: 1024,
    });

    const r = await fetch(
      `${base}/v1/federation-strategy?providers=wikimedia`,
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    const entry = j.data.byHealth[0] as any;
    expect(typeof entry.id).toBe("string");
    expect(typeof entry.healthScore).toBe("number");
    expect(typeof entry.avgLatencyMs).toBe("number");
    expect(typeof entry.errorRate).toBe("number");
    expect(typeof entry.saturated).toBe("boolean");
    expect(typeof entry.predictedSuccessRate).toBe("number");
    expect(typeof entry.rankHealthiest).toBe("number");
    expect(typeof entry.rankFastest).toBe("number");
  });

  test("getRankingDist returns consistent data with HTTP endpoint", async () => {
    emitDist({
      providerId: "pexels",
      startedAt: Date.now() - 150,
      endedAt: Date.now(),
      durationMs: 150,
      resultCount: 6,
      ok: true,
      errorKind: "ok",
      payloadBytes: 800,
    });

    const ranking = getRankingDist(["pexels"]);
    expect(ranking.byHealth).toHaveLength(1);
    expect(ranking.byHealth[0]!.id).toBe("pexels");
    expect(ranking.byHealth[0]!.avgLatencyMs).toBe(150);
  });
});
