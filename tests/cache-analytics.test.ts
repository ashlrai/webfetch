/**
 * Tests for cache-analytics module:
 *  - query aggregation (queryFrequency, providerCoverageByQuery)
 *  - provider ranking by composite score
 *  - replay accuracy (replayQuery cache-first then fallback)
 *  - HTTP GET /v1/cache-analytics endpoint
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

// src/ imports — unit tests use these directly so they share the same module instance
import {
  _resetAnalytics,
  getCacheAnalyticsSnapshot,
  getCacheReplayStats,
  recordSearchEvent,
  replayQuery,
} from "../packages/core/src/cache-analytics.ts";

// dist/ imports — HTTP endpoint tests use these to share buffer with the server
import {
  _resetAnalytics as resetDist,
  getCacheAnalyticsSnapshot as getSnapshotDist,
  recordSearchEvent as recordDist,
} from "webfetch-core";

import { startServer } from "../packages/server/src/server.ts";
import { fixture, jsonResponse, stubFetcher } from "./stub-fetcher.ts";

const TOKEN = "a".repeat(64);

// ---------------------------------------------------------------------------
// Unit: query aggregation
// ---------------------------------------------------------------------------

describe("cache-analytics: query aggregation", () => {
  beforeEach(() => {
    _resetAnalytics();
  });

  test("empty buffer returns zero-state", () => {
    const stats = getCacheReplayStats(60_000);
    expect(stats.queryFrequency.size).toBe(0);
    expect(stats.providerCoverageByQuery).toEqual([]);
    expect(Number.isNaN(stats.cacheHitRate)).toBe(true);
    expect(stats.recommendedProviders).toEqual([]);
  });

  test("single query event is counted once", () => {
    const now = Date.now();
    recordSearchEvent({
      query: "Taylor Swift portrait",
      startedAt: now,
      providers: ["wikimedia", "unsplash"],
      candidates: [
        { providerId: "wikimedia", cacheHit: false, confidence: 0.8 },
        { providerId: "unsplash", cacheHit: true, confidence: 0.9 },
      ],
    });

    const stats = getCacheReplayStats(60_000);
    expect(stats.queryFrequency.get("taylor swift portrait")).toBe(1);
    expect(stats.queryFrequency.size).toBe(1);
  });

  test("same query repeated increments frequency correctly", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      recordSearchEvent({
        query: "Drake portrait",
        startedAt: now - i * 1000,
        providers: ["wikimedia"],
        candidates: [{ providerId: "wikimedia", cacheHit: i % 2 === 0, confidence: 0.7 }],
      });
    }

    const stats = getCacheReplayStats(60_000);
    expect(stats.queryFrequency.get("drake portrait")).toBe(5);
  });

  test("query normalisation: trims and lowercases", () => {
    const now = Date.now();
    recordSearchEvent({
      query: "  RADIOHEAD album  ",
      startedAt: now,
      providers: ["wikimedia"],
      candidates: [],
    });
    recordSearchEvent({
      query: "radiohead album",
      startedAt: now - 100,
      providers: ["wikimedia"],
      candidates: [],
    });

    const stats = getCacheReplayStats(60_000);
    expect(stats.queryFrequency.get("radiohead album")).toBe(2);
    expect(stats.queryFrequency.size).toBe(1);
  });

  test("events outside time window are excluded", () => {
    const now = Date.now();
    const windowMs = 30_000; // 30 seconds

    // Old event (outside window)
    recordSearchEvent({
      query: "old query",
      startedAt: now - windowMs - 5000,
      providers: ["pexels"],
      candidates: [{ providerId: "pexels", cacheHit: true, confidence: 0.9 }],
    });

    // Recent event (inside window)
    recordSearchEvent({
      query: "recent query",
      startedAt: now - 1000,
      providers: ["pexels"],
      candidates: [{ providerId: "pexels", cacheHit: false, confidence: 0.6 }],
    });

    const stats = getCacheReplayStats(windowMs);
    expect(stats.queryFrequency.has("old query")).toBe(false);
    expect(stats.queryFrequency.has("recent query")).toBe(true);
  });

  test("multiple distinct queries tracked separately", () => {
    const now = Date.now();
    const queries = ["jazz album", "portrait photo", "landscape"];
    for (const q of queries) {
      recordSearchEvent({
        query: q,
        startedAt: now,
        providers: ["wikimedia"],
        candidates: [],
      });
    }

    const stats = getCacheReplayStats(60_000);
    expect(stats.queryFrequency.size).toBe(3);
    for (const q of queries) {
      expect(stats.queryFrequency.get(q)).toBe(1);
    }
  });

  test("providerCoverageByQuery is sorted by query frequency descending", () => {
    const now = Date.now();
    // "pop music" appears 3 times, "jazz" appears 1 time
    for (let i = 0; i < 3; i++) {
      recordSearchEvent({
        query: "pop music",
        startedAt: now - i * 100,
        providers: ["wikimedia"],
        candidates: [{ providerId: "wikimedia", cacheHit: false, confidence: 0.5 }],
      });
    }
    recordSearchEvent({
      query: "jazz",
      startedAt: now,
      providers: ["wikimedia"],
      candidates: [{ providerId: "wikimedia", cacheHit: true, confidence: 0.9 }],
    });

    const stats = getCacheReplayStats(60_000);
    expect(stats.providerCoverageByQuery[0]!.query).toBe("pop music");
    expect(stats.providerCoverageByQuery[1]!.query).toBe("jazz");
  });
});

// ---------------------------------------------------------------------------
// Unit: provider ranking
// ---------------------------------------------------------------------------

describe("cache-analytics: provider ranking by coverage", () => {
  beforeEach(() => {
    _resetAnalytics();
  });

  test("provider with high hit rate ranks above low hit rate provider", () => {
    const now = Date.now();

    // Provider A: 10/10 cache hits, confidence 0.6
    for (let i = 0; i < 10; i++) {
      recordSearchEvent({
        query: "test query",
        startedAt: now - i * 100,
        providers: ["wikimedia", "pexels"],
        candidates: [
          { providerId: "wikimedia", cacheHit: true, confidence: 0.6 },
          { providerId: "pexels", cacheHit: false, confidence: 0.5 },
        ],
      });
    }

    const stats = getCacheReplayStats(60_000);
    // wikimedia: hitRate=1.0, avgConf=0.6 → score = 0.6 + 0.24 = 0.84
    // pexels:    hitRate=0.0, avgConf=0.5 → score = 0.0 + 0.20 = 0.20
    expect(stats.recommendedProviders[0]).toBe("wikimedia");
    expect(stats.recommendedProviders[1]).toBe("pexels");
  });

  test("high confidence breaks tie when hit rates are equal", () => {
    const now = Date.now();
    recordSearchEvent({
      query: "tie query",
      startedAt: now,
      providers: ["unsplash", "pixabay"],
      candidates: [
        { providerId: "unsplash", cacheHit: true, confidence: 0.9 },
        { providerId: "pixabay", cacheHit: true, confidence: 0.5 },
      ],
    });

    const stats = getCacheReplayStats(60_000);
    // Both hitRate=1.0; unsplash avgConf=0.9 → score=0.6+0.36=0.96
    // pixabay avgConf=0.5 → score=0.6+0.2=0.80
    expect(stats.recommendedProviders[0]).toBe("unsplash");
  });

  test("providers with zero candidates have hitRate=0 and don't top the list", () => {
    const now = Date.now();
    recordSearchEvent({
      query: "no candidates query",
      startedAt: now,
      providers: ["brave", "wikimedia"],
      candidates: [
        // brave has no candidates; wikimedia has one hit
        { providerId: "wikimedia", cacheHit: true, confidence: 0.8 },
      ],
    });

    const stats = getCacheReplayStats(60_000);
    expect(stats.recommendedProviders[0]).toBe("wikimedia");
  });

  test("cacheHitRate computed correctly across mixed events", () => {
    const now = Date.now();
    recordSearchEvent({
      query: "q1",
      startedAt: now,
      providers: ["wikimedia"],
      candidates: [
        { providerId: "wikimedia", cacheHit: true, confidence: 0.8 },
        { providerId: "wikimedia", cacheHit: true, confidence: 0.9 },
        { providerId: "wikimedia", cacheHit: false, confidence: 0.7 },
        { providerId: "wikimedia", cacheHit: false, confidence: 0.6 },
      ],
    });

    const stats = getCacheReplayStats(60_000);
    // 2 hits out of 4 total = 0.5
    expect(stats.cacheHitRate).toBeCloseTo(0.5, 5);
  });

  test("providerCoverageByQuery shows per-provider hitRate correctly", () => {
    const now = Date.now();
    // 2 events for same query: wikimedia hits on first, misses on second
    recordSearchEvent({
      query: "rock band",
      startedAt: now - 1000,
      providers: ["wikimedia"],
      candidates: [{ providerId: "wikimedia", cacheHit: true, confidence: 0.8 }],
    });
    recordSearchEvent({
      query: "rock band",
      startedAt: now,
      providers: ["wikimedia"],
      candidates: [{ providerId: "wikimedia", cacheHit: false, confidence: 0.7 }],
    });

    const stats = getCacheReplayStats(60_000);
    const row = stats.providerCoverageByQuery.find((r) => r.query === "rock band");
    expect(row).toBeDefined();
    const wikiEntry = row!.providers.find((p) => p.id === "wikimedia");
    expect(wikiEntry).toBeDefined();
    expect(wikiEntry!.hitRate).toBeCloseTo(0.5, 5);
    expect(wikiEntry!.totalCandidates).toBe(2);
    expect(wikiEntry!.avgConfidence).toBeCloseTo(0.75, 5);
  });
});

// ---------------------------------------------------------------------------
// Unit: replay accuracy
// ---------------------------------------------------------------------------

describe("cache-analytics: replayQuery", () => {
  beforeEach(() => {
    _resetAnalytics();
  });

  test("replayQuery with cacheOnly:true returns empty fromCache when buffer is empty", async () => {
    const result = await replayQuery("empty query", {}, { cacheOnly: true });
    expect(result.fromCache).toEqual([]);
    expect(result.fromFederation).toEqual([]);
    expect(result.cacheOnly).toBe(true);
    expect(result.federationBundle).toBeNull();
    expect(result.candidates).toEqual([]);
  });

  test("replayQuery without cacheOnly triggers federation and records event", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);

    const result = await replayQuery(
      "test artist",
      { providers: ["wikimedia"], fetcher },
      { limit: 5 },
    );

    // Federation was called
    expect(result.federationBundle).not.toBeNull();
    expect(result.cacheOnly).toBe(false);
    expect(result.candidates.length).toBeGreaterThanOrEqual(0);

    // The search event was recorded in the analytics buffer
    const stats = getCacheReplayStats(60_000);
    expect(stats.queryFrequency.get("test artist")).toBe(1);
  });

  test("replayQuery respects limit option", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);

    const result = await replayQuery(
      "limit test",
      { providers: ["wikimedia"], fetcher },
      { limit: 2 },
    );

    expect(result.candidates.length).toBeLessThanOrEqual(2);
  });

  test("replayQuery records candidates from federation into analytics buffer", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);

    await replayQuery("analytics record test", { providers: ["wikimedia"], fetcher });

    const stats = getCacheReplayStats(60_000);
    expect(stats.queryFrequency.has("analytics record test")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit: getCacheAnalyticsSnapshot serialisation
// ---------------------------------------------------------------------------

describe("cache-analytics: snapshot serialisation", () => {
  beforeEach(() => {
    _resetAnalytics();
  });

  test("snapshot has correct shape on empty buffer", () => {
    const snap = getCacheAnalyticsSnapshot(60_000);
    expect(typeof snap.windowMs).toBe("number");
    expect(typeof snap.generatedAt).toBe("number");
    expect(typeof snap.queryFrequency).toBe("object");
    expect(Array.isArray(snap.providerCoverageByQuery)).toBe(true);
    expect(typeof snap.cacheHitRate).toBe("number");
    expect(Array.isArray(snap.recommendedProviders)).toBe(true);
    expect(typeof snap.totalEvents).toBe("number");
    expect(snap.windowMs).toBe(60_000);
    expect(snap.cacheHitRate).toBe(0); // NaN is normalised to 0
  });

  test("snapshot queryFrequency is a plain object (JSON-serialisable)", () => {
    const now = Date.now();
    recordSearchEvent({
      query: "serialise me",
      startedAt: now,
      providers: ["wikimedia"],
      candidates: [],
    });

    const snap = getCacheAnalyticsSnapshot(60_000);
    expect(snap.queryFrequency["serialise me"]).toBe(1);
    // Verify round-trip via JSON
    const roundTripped = JSON.parse(JSON.stringify(snap));
    expect(roundTripped.queryFrequency["serialise me"]).toBe(1);
  });

  test("snapshot totalEvents reflects buffer size", () => {
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      recordSearchEvent({
        query: `query ${i}`,
        startedAt: now - i * 100,
        providers: ["wikimedia"],
        candidates: [],
      });
    }
    const snap = getCacheAnalyticsSnapshot(60_000);
    expect(snap.totalEvents).toBe(3);
  });

  test("generatedAt is within recent range", () => {
    const before = Date.now();
    const snap = getCacheAnalyticsSnapshot(60_000);
    const after = Date.now();
    expect(snap.generatedAt).toBeGreaterThanOrEqual(before);
    expect(snap.generatedAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// HTTP: GET /v1/cache-analytics endpoint
// ---------------------------------------------------------------------------

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
    const port = testPort(attempt);
    try {
      return startServer({ port, token: TOKEN });
    } catch (err) {
      lastError = err;
      if (!String(err).includes("port")) break;
    }
  }
  throw lastError ?? new Error("Failed to start test server");
}

function testPort(attempt: number): number {
  // Use a different base than other test files to avoid port collisions
  const base = 32_500 + (process.pid % 5_000);
  return base + attempt;
}

describe("GET /v1/cache-analytics HTTP endpoint", () => {
  beforeEach(() => {
    resetDist();
  });

  test("returns 401 without auth token", async () => {
    const r = await fetch(`${base}/v1/cache-analytics`);
    expect(r.status).toBe(401);
  });

  test("returns 200 with correct shape on empty buffer", async () => {
    const r = await fetch(`${base}/v1/cache-analytics`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(true);
    expect(typeof j.data.windowMs).toBe("number");
    expect(typeof j.data.generatedAt).toBe("number");
    expect(typeof j.data.queryFrequency).toBe("object");
    expect(Array.isArray(j.data.providerCoverageByQuery)).toBe(true);
    expect(typeof j.data.cacheHitRate).toBe("number");
    expect(Array.isArray(j.data.recommendedProviders)).toBe(true);
    expect(typeof j.data.totalEvents).toBe("number");
  });

  test("default window is 7 days", async () => {
    const r = await fetch(`${base}/v1/cache-analytics`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.data.windowMs).toBe(7 * 24 * 3_600_000);
  });

  test("accepts windowMs query param", async () => {
    const r = await fetch(`${base}/v1/cache-analytics?windowMs=3600000`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.data.windowMs).toBe(3_600_000);
  });

  test("accepts since query param with day suffix", async () => {
    const r = await fetch(`${base}/v1/cache-analytics?since=3d`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.data.windowMs).toBe(3 * 86_400_000);
  });

  test("accepts since query param with hour suffix", async () => {
    const r = await fetch(`${base}/v1/cache-analytics?since=12h`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.data.windowMs).toBe(12 * 3_600_000);
  });

  test("rejects invalid windowMs with 422", async () => {
    const r = await fetch(`${base}/v1/cache-analytics?windowMs=500`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(422);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(false);
  });

  test("rejects invalid since with 422", async () => {
    const r = await fetch(`${base}/v1/cache-analytics?since=badvalue`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(422);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(false);
  });

  test("reflects recorded events in response", async () => {
    const now = Date.now();
    recordDist({
      query: "http test query",
      startedAt: now,
      providers: ["wikimedia"],
      candidates: [
        { providerId: "wikimedia", cacheHit: true, confidence: 0.9 },
        { providerId: "wikimedia", cacheHit: false, confidence: 0.7 },
      ],
    });

    const r = await fetch(`${base}/v1/cache-analytics?windowMs=60000`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.data.queryFrequency["http test query"]).toBe(1);
    expect(j.data.cacheHitRate).toBeCloseTo(0.5, 2);
    expect(j.data.recommendedProviders).toContain("wikimedia");
  });

  test("also works on /cache-analytics (unversioned)", async () => {
    const r = await fetch(`${base}/cache-analytics`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(true);
  });
});
