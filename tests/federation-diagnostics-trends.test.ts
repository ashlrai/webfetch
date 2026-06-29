/**
 * Tests for Federation Diagnostics Trends:
 *  - getFederationTrends()         — per-provider latency percentiles + error rate over 3 windows
 *  - detectProviderAnomalies()     — latency-spike, sustained-errors, result-count-drop, rate-limit-exhaustion
 *  - exportFederationAudit()       — JSON and CSV export with anomaly markers
 *  - GET /v1/federation-diagnostics-trends — HTTP endpoint schema + 200/422
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import {
  _resetTelemetry,
  detectProviderAnomalies,
  emitProviderEvent,
  exportFederationAudit,
  getFederationTrends,
  getFederationDiagnosticsTrends,
} from "../packages/core/src/federation-telemetry.ts";
import { _resetBuckets, getBucket } from "../packages/core/src/rate-limit.ts";

// dist imports for HTTP endpoint tests
import {
  _resetTelemetry as resetDist,
  emitProviderEvent as emitDist,
  getFederationDiagnosticsTrends as getTrendsDist,
} from "webfetch-core";

import { startServer } from "../packages/server/src/server.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN = "t".repeat(64);
let server: ReturnType<typeof startServer> | undefined;
let base: string;

beforeAll(async () => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = 32_000 + (process.pid % 10_000) + attempt;
    try {
      server = startServer({ port, token: TOKEN });
      base = `http://127.0.0.1:${port}`;
      break;
    } catch (err) {
      lastErr = err;
      if (!String(err).includes("port")) break;
    }
  }
  if (!server) throw lastErr ?? new Error("Failed to start test server");
});

afterAll(() => {
  try { server?.stop(true); } catch {}
});

function emitSuccess(
  providerId: "wikimedia" | "openverse" | "pexels" | "unsplash" | "bing",
  durationMs: number,
  resultCount = 5,
  startedAt?: number,
) {
  const now = startedAt ?? Date.now();
  emitProviderEvent({
    providerId,
    startedAt: now - durationMs,
    endedAt: now,
    durationMs,
    resultCount,
    ok: true,
    errorKind: "ok",
    payloadBytes: 512,
  });
}

function emitError(
  providerId: "wikimedia" | "openverse" | "pexels" | "unsplash" | "bing",
  durationMs = 200,
  startedAt?: number,
) {
  const now = startedAt ?? Date.now();
  emitProviderEvent({
    providerId,
    startedAt: now - durationMs,
    endedAt: now,
    durationMs,
    resultCount: 0,
    ok: false,
    errorKind: "network",
    payloadBytes: 0,
  });
}

// ---------------------------------------------------------------------------
// Unit: percentile computation
// ---------------------------------------------------------------------------

describe("getFederationTrends — percentile computation", () => {
  beforeEach(() => { _resetTelemetry(); _resetBuckets(); });

  test("p50 of odd-length set equals the median element", () => {
    // durations [100, 200, 300] → sorted p50 = 200
    const now = Date.now();
    for (const d of [100, 200, 300]) emitSuccess("wikimedia", d, 5, now);
    const trends = getFederationTrends();
    const report = trends.find((r) => r.providerId === "wikimedia")!;
    expect(report).toBeDefined();
    const win5 = report.windows.find((w) => w.windowLabel === "5min")!;
    expect(win5.latencyPercentiles.p50).toBe(200);
  });

  test("p50 of even-length set is average of two middle elements", () => {
    // durations [100, 200, 300, 400] → p50 = 250
    const now = Date.now();
    for (const d of [100, 200, 300, 400]) emitSuccess("wikimedia", d, 5, now);
    const trends = getFederationTrends();
    const report = trends.find((r) => r.providerId === "wikimedia")!;
    const win5 = report.windows.find((w) => w.windowLabel === "5min")!;
    expect(win5.latencyPercentiles.p50).toBe(250);
  });

  test("p95 is higher than p50 and p99 >= p95", () => {
    // 10 events: 8 at 100ms, 2 at 5000ms → p95 will be above p50
    const now = Date.now();
    for (let i = 0; i < 8; i++) emitSuccess("wikimedia", 100, 5, now);
    emitSuccess("wikimedia", 5000, 5, now);
    emitSuccess("wikimedia", 5000, 5, now);
    const trends = getFederationTrends();
    const report = trends.find((r) => r.providerId === "wikimedia")!;
    const win5 = report.windows.find((w) => w.windowLabel === "5min")!;
    expect(win5.latencyPercentiles.p95).toBeGreaterThan(win5.latencyPercentiles.p50);
    expect(win5.latencyPercentiles.p99).toBeGreaterThanOrEqual(win5.latencyPercentiles.p95);
    expect(win5.latencyPercentiles.p50).toBe(100); // majority at 100ms
  });

  test("single-event set has identical p50/p95/p99", () => {
    emitSuccess("openverse", 350);
    const trends = getFederationTrends();
    const report = trends.find((r) => r.providerId === "openverse")!;
    const win5 = report.windows.find((w) => w.windowLabel === "5min")!;
    expect(win5.latencyPercentiles.p50).toBe(win5.latencyPercentiles.p95);
    expect(win5.latencyPercentiles.p95).toBe(win5.latencyPercentiles.p99);
    expect(win5.latencyPercentiles.p50).toBe(350);
  });
});

// ---------------------------------------------------------------------------
// Unit: multi-window aggregation
// ---------------------------------------------------------------------------

describe("getFederationTrends — multi-window aggregation", () => {
  beforeEach(() => { _resetTelemetry(); _resetBuckets(); });

  test("event older than 5min but within 1hr appears only in 1hr and 24hr windows", () => {
    const now = Date.now();
    const SIX_MIN = 6 * 60 * 1000;
    emitProviderEvent({
      providerId: "pexels",
      startedAt: now - SIX_MIN,
      endedAt: now - SIX_MIN + 200,
      durationMs: 200,
      resultCount: 4,
      ok: true,
      errorKind: "ok",
      payloadBytes: 256,
    });
    const trends = getFederationTrends();
    const report = trends.find((r) => r.providerId === "pexels")!;
    expect(report).toBeDefined();

    const win5 = report.windows.find((w) => w.windowLabel === "5min")!;
    const win1h = report.windows.find((w) => w.windowLabel === "1hr")!;
    const win24h = report.windows.find((w) => w.windowLabel === "24hr")!;

    expect(win5.sampleCount).toBe(0);
    expect(win1h.sampleCount).toBe(1);
    expect(win24h.sampleCount).toBe(1);
  });

  test("windowMs and windowLabel are correct for all three windows", () => {
    emitSuccess("wikimedia", 100);
    const trends = getFederationTrends();
    const report = trends.find((r) => r.providerId === "wikimedia")!;
    expect(report.windows).toHaveLength(3);
    const labels = report.windows.map((w) => w.windowLabel);
    expect(labels).toContain("5min");
    expect(labels).toContain("1hr");
    expect(labels).toContain("24hr");
    const mss = report.windows.map((w) => w.windowMs);
    expect(mss).toContain(5 * 60 * 1000);
    expect(mss).toContain(60 * 60 * 1000);
    expect(mss).toContain(24 * 60 * 60 * 1000);
  });

  test("error rate is correct within each window", () => {
    const now = Date.now();
    // 2 successes + 1 error within 5min
    emitSuccess("bing", 100, 5, now);
    emitSuccess("bing", 150, 5, now);
    emitError("bing", 200, now);
    const trends = getFederationTrends();
    const report = trends.find((r) => r.providerId === "bing")!;
    const win5 = report.windows.find((w) => w.windowLabel === "5min")!;
    expect(win5.errorRate).toBeCloseTo(0.333, 2);
    expect(win5.sampleCount).toBe(3);
  });

  test("empty buffer returns empty trends array", () => {
    const trends = getFederationTrends();
    expect(trends).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unit: anomaly detection thresholds
// ---------------------------------------------------------------------------

describe("detectProviderAnomalies", () => {
  beforeEach(() => { _resetTelemetry(); _resetBuckets(); });

  test("latency-spike flagged when p95 > 1.5 × p50", () => {
    const now = Date.now();
    // 19 events at 100ms, 1 at 5000ms → p95 will be near 5000
    for (let i = 0; i < 19; i++) emitSuccess("wikimedia", 100, 5, now);
    emitSuccess("wikimedia", 5000, 5, now);
    const anomalies = detectProviderAnomalies();
    const spike = anomalies.find(
      (a) => a.providerId === "wikimedia" && a.kind === "latency-spike",
    );
    expect(spike).toBeDefined();
    expect(spike!.context.p50).toBeGreaterThan(0);
    expect(spike!.context.p95).toBeGreaterThan(spike!.context.p50 * 1.5);
  });

  test("no latency-spike when distribution is uniform", () => {
    // 5 events all at 200ms → p50=p95=200, no spike
    for (let i = 0; i < 5; i++) emitSuccess("wikimedia", 200, 5);
    const anomalies = detectProviderAnomalies();
    expect(anomalies.filter((a) => a.kind === "latency-spike")).toHaveLength(0);
  });

  test("sustained-errors flagged when rate >10% and errors older than 2min", () => {
    const now = Date.now();
    const THREE_MIN_AGO = now - 3 * 60 * 1000;
    // Emit several errors starting 3 min ago, still within 5min window
    for (let i = 0; i < 4; i++) {
      emitProviderEvent({
        providerId: "openverse",
        startedAt: THREE_MIN_AGO - i * 1000,
        endedAt: THREE_MIN_AGO - i * 1000 + 300,
        durationMs: 300,
        resultCount: 0,
        ok: false,
        errorKind: "network",
        payloadBytes: 0,
      });
    }
    // 1 success to keep rate below 100%
    emitSuccess("openverse", 200, 5, now);
    const anomalies = detectProviderAnomalies();
    const sustained = anomalies.find(
      (a) => a.providerId === "openverse" && a.kind === "sustained-errors",
    );
    expect(sustained).toBeDefined();
    expect(sustained!.context.errorRate).toBeGreaterThan(0.1);
    expect(sustained!.context.sustainedMs).toBeGreaterThan(2 * 60 * 1000);
  });

  test("sustained-errors NOT flagged when errors are recent (< 2min)", () => {
    const now = Date.now();
    // Errors only 30s ago — not sustained
    for (let i = 0; i < 3; i++) emitError("pexels", 200, now - 30_000);
    emitSuccess("pexels", 100, 5, now);
    const anomalies = detectProviderAnomalies();
    expect(anomalies.filter((a) => a.kind === "sustained-errors")).toHaveLength(0);
  });

  test("result-count-drop flagged when latest batch dropped >60% vs prior", () => {
    const now = Date.now();
    // Prior batch: 10 results; latest batch: 3 results → 70% drop
    emitProviderEvent({
      providerId: "unsplash",
      startedAt: now - 120_000,
      endedAt: now - 119_800,
      durationMs: 200,
      resultCount: 10,
      ok: true,
      errorKind: "ok",
      payloadBytes: 1024,
    });
    emitProviderEvent({
      providerId: "unsplash",
      startedAt: now - 60_000,
      endedAt: now - 59_800,
      durationMs: 200,
      resultCount: 3,
      ok: true,
      errorKind: "ok",
      payloadBytes: 300,
    });
    const anomalies = detectProviderAnomalies();
    const drop = anomalies.find(
      (a) => a.providerId === "unsplash" && a.kind === "result-count-drop",
    );
    expect(drop).toBeDefined();
    expect(drop!.context.dropFraction).toBeGreaterThan(0.6);
    expect(drop!.context.prevCount).toBe(10);
    expect(drop!.context.lastCount).toBe(3);
  });

  test("result-count-drop NOT flagged when drop is < 60%", () => {
    const now = Date.now();
    emitProviderEvent({
      providerId: "unsplash",
      startedAt: now - 120_000,
      endedAt: now - 119_800,
      durationMs: 200,
      resultCount: 10,
      ok: true,
      errorKind: "ok",
      payloadBytes: 1024,
    });
    emitProviderEvent({
      providerId: "unsplash",
      startedAt: now - 60_000,
      endedAt: now - 59_800,
      durationMs: 200,
      resultCount: 7, // 30% drop — below threshold
      ok: true,
      errorKind: "ok",
      payloadBytes: 700,
    });
    const anomalies = detectProviderAnomalies();
    expect(anomalies.filter((a) => a.kind === "result-count-drop")).toHaveLength(0);
  });

  test("rate-limit-exhaustion flagged when bucket is saturated", () => {
    // Drain wikimedia bucket
    const bucket = getBucket("wikimedia");
    for (let i = 0; i < 25; i++) bucket.tryTake();
    emitError("wikimedia", 100);
    const anomalies = detectProviderAnomalies();
    const exhaustion = anomalies.find(
      (a) => a.providerId === "wikimedia" && a.kind === "rate-limit-exhaustion",
    );
    expect(exhaustion).toBeDefined();
    expect(exhaustion!.context.waitTimeMs).toBeGreaterThan(0);
  });

  test("multiple anomaly kinds can co-exist for the same provider", () => {
    const now = Date.now();
    const bucket = getBucket("bing");
    for (let i = 0; i < 25; i++) bucket.tryTake();
    // Latency spike setup
    for (let i = 0; i < 9; i++) emitSuccess("bing", 100, 5, now);
    emitSuccess("bing", 8000, 5, now);
    const anomalies = detectProviderAnomalies();
    const bingAnomalies = anomalies.filter((a) => a.providerId === "bing");
    const kinds = bingAnomalies.map((a) => a.kind);
    expect(kinds).toContain("latency-spike");
    expect(kinds).toContain("rate-limit-exhaustion");
  });
});

// ---------------------------------------------------------------------------
// Unit: CSV export formatting
// ---------------------------------------------------------------------------

describe("exportFederationAudit — CSV format", () => {
  beforeEach(() => { _resetTelemetry(); _resetBuckets(); });

  test("CSV has correct header row", () => {
    const csv = exportFederationAudit("csv");
    const firstLine = csv.split("\n")[0]!;
    expect(firstLine).toContain("providerId");
    expect(firstLine).toContain("startedAt");
    expect(firstLine).toContain("durationMs");
    expect(firstLine).toContain("ok");
    expect(firstLine).toContain("anomalyMarkers");
  });

  test("CSV has one data row per event", () => {
    emitSuccess("wikimedia", 100);
    emitSuccess("openverse", 200);
    const csv = exportFederationAudit("csv");
    const lines = csv.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(3); // header + 2 data rows
  });

  test("CSV empty buffer produces header only", () => {
    const csv = exportFederationAudit("csv");
    const lines = csv.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(1); // header only
  });

  test("CSV anomalyMarkers column is populated when anomaly exists", () => {
    // Create a saturated bucket to trigger rate-limit-exhaustion anomaly
    const bucket = getBucket("wikimedia");
    for (let i = 0; i < 25; i++) bucket.tryTake();
    emitError("wikimedia", 100);
    const csv = exportFederationAudit("csv");
    const lines = csv.split("\n");
    const dataLines = lines.slice(1).filter((l) => l.trim().length > 0);
    expect(dataLines.length).toBeGreaterThan(0);
    // At least one data row should have an anomaly marker
    const hasMarker = dataLines.some((l) => l.includes("rate-limit-exhaustion"));
    expect(hasMarker).toBe(true);
  });

  test("CSV fields with commas are quoted", () => {
    // errorMessage with a comma
    emitProviderEvent({
      providerId: "pexels",
      startedAt: Date.now() - 200,
      endedAt: Date.now(),
      durationMs: 200,
      resultCount: 0,
      ok: false,
      errorKind: "network",
      errorMessage: "connection refused, timeout",
      payloadBytes: 0,
    });
    const csv = exportFederationAudit("csv");
    // The quoted field should appear
    expect(csv).toContain('"connection refused, timeout"');
  });
});

// ---------------------------------------------------------------------------
// Unit: JSON export
// ---------------------------------------------------------------------------

describe("exportFederationAudit — JSON format", () => {
  beforeEach(() => { _resetTelemetry(); _resetBuckets(); });

  test("JSON export has correct top-level keys", () => {
    emitSuccess("wikimedia", 100);
    const json = JSON.parse(exportFederationAudit("json"));
    expect(typeof json.exportedAt).toBe("number");
    expect(typeof json.windowMs).toBe("number");
    expect(typeof json.eventCount).toBe("number");
    expect(typeof json.anomalyCount).toBe("number");
    expect(Array.isArray(json.events)).toBe(true);
  });

  test("JSON events include anomalyMarkers array", () => {
    emitSuccess("openverse", 150);
    const json = JSON.parse(exportFederationAudit("json"));
    expect(json.events.length).toBe(1);
    expect(Array.isArray(json.events[0].anomalyMarkers)).toBe(true);
  });

  test("JSON windowMs=0 exports all events", () => {
    emitSuccess("wikimedia", 100);
    emitSuccess("pexels", 200);
    const json = JSON.parse(exportFederationAudit("json", 0));
    expect(json.eventCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// HTTP: GET /v1/federation-diagnostics-trends
// ---------------------------------------------------------------------------

describe("GET /v1/federation-diagnostics-trends HTTP endpoint", () => {
  beforeEach(() => { resetDist(); });

  test("returns 401 without auth token", async () => {
    const r = await fetch(`${base}/v1/federation-diagnostics-trends`);
    expect(r.status).toBe(401);
  });

  test("returns 200 with correct schema on empty buffer", async () => {
    const r = await fetch(`${base}/v1/federation-diagnostics-trends`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.data.trends)).toBe(true);
    expect(Array.isArray(j.data.anomalies)).toBe(true);
    expect(typeof j.data.lastUpdatedMs).toBe("number");
  });

  test("reflects emitted events in trends response", async () => {
    const now = Date.now();
    emitDist({
      providerId: "wikimedia",
      startedAt: now - 200,
      endedAt: now,
      durationMs: 200,
      resultCount: 5,
      ok: true,
      errorKind: "ok",
      payloadBytes: 512,
    });
    const r = await fetch(`${base}/v1/federation-diagnostics-trends`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    const report = j.data.trends.find((t: any) => t.providerId === "wikimedia");
    expect(report).toBeDefined();
    expect(Array.isArray(report.windows)).toBe(true);
    expect(report.windows).toHaveLength(3);
    const win5 = report.windows.find((w: any) => w.windowLabel === "5min");
    expect(win5).toBeDefined();
    expect(win5.sampleCount).toBeGreaterThan(0);
  });

  test("rejects windowMs below 1000 with 422", async () => {
    const r = await fetch(`${base}/v1/federation-diagnostics-trends?windowMs=500`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(422);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(false);
  });

  test("rejects windowMs above 86400000 with 422", async () => {
    const r = await fetch(`${base}/v1/federation-diagnostics-trends?windowMs=999999999`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(422);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(false);
  });

  test("accepts valid windowMs and returns 200", async () => {
    const r = await fetch(`${base}/v1/federation-diagnostics-trends?windowMs=300000`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(true);
    expect(typeof j.data.lastUpdatedMs).toBe("number");
  });
});
