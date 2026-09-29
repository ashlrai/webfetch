/**
 * Direct coverage for modules reconstructed in 629aac0
 * (batch-reverse-image.ts, provider-validator-runtime.ts). semantic-dedupe.ts
 * is already covered via deduplication-report/federation tests.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { batchReverseImageSearch } from "../packages/core/src/batch-reverse-image.ts";
import {
  _resetValidatorCache,
  getCapabilityMatrix,
  validateProviderRegistry,
} from "../packages/core/src/provider-validator-runtime.ts";
import { _resetBuckets } from "../packages/core/src/rate-limit.ts";
import { jsonResponse, stubFetcher } from "./stub-fetcher.ts";

const serp = (n: number) => ({
  image_results: Array.from({ length: n }, (_, i) => ({
    thumbnail: `https://img.example.com/${i}.jpg`,
    original: `https://img.example.com/${i}.jpg`,
    link: `https://page.example.com/${i}`,
    title: `result ${i}`,
  })),
});

beforeEach(() => {
  _resetBuckets();
  _resetValidatorCache();
});

describe("batchReverseImageSearch", () => {
  test("empty input and empty provider list are safe", async () => {
    const out = await batchReverseImageSearch([]);
    expect(out.results).toEqual([]);
    expect(out.telemetry.totalImages).toBe(0);
    const out2 = await batchReverseImageSearch([{ url: "https://x/1.jpg" }], { providers: [] });
    expect(out2.results[0]!.candidates).toEqual([]);
    expect(out2.results[0]!.timedOut).toBe(false);
  });

  test("ranks candidates, respects limitPerImage, fills telemetry", async () => {
    const fetcher = stubFetcher([
      { match: (u) => u.includes("serpapi.com"), handler: async () => jsonResponse(serp(6)) },
    ]);
    const out = await batchReverseImageSearch(
      [{ url: "https://ref.example.com/a.jpg" }, { url: "https://ref.example.com/b.jpg" }],
      { providers: ["serpapi"], fetcher, auth: { serpApiKey: "k" }, limitPerImage: 3 },
    );
    expect(out.results).toHaveLength(2);
    expect(out.results[0]!.candidates.length).toBeGreaterThan(0);
    for (const r of out.results) {
      expect(r.candidates.length).toBeLessThanOrEqual(3);
      const scores = r.candidates.map((c) => c.aggregatedScore);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
      for (const c of r.candidates) {
        expect(c.aggregatedScore).toBeCloseTo(
          c.similarityScore * c.providerRankFactor * c.licenseConfidence,
        );
      }
    }
    const t = out.telemetry.providerTelemetry.find((p) => p.provider === "serpapi")!;
    expect(t.attempts).toBe(2);
    expect(out.telemetry.aggregatedScoreHistogram.total).toBe(
      out.results.reduce((s, r) => s + r.candidates.length, 0),
    );
  });

  test("provider failure is isolated per image and reported", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () => new Response("boom", { status: 500 }),
      },
    ]);
    const out = await batchReverseImageSearch([{ url: "https://ref.example.com/a.jpg" }], {
      providers: ["serpapi"],
      fetcher,
      auth: { serpApiKey: "k" },
    });
    expect(out.results).toHaveLength(1);
    expect(out.results[0]!.candidates).toEqual([]);
    const t = out.telemetry.providerTelemetry.find((p) => p.provider === "serpapi")!;
    expect(t.successes).toBe(0);
  });

  test("dedupeSameImageInBatch reuses results for identical URLs", async () => {
    let calls = 0;
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () => {
          calls++;
          return jsonResponse(serp(2));
        },
      },
    ]);
    const ref = { url: "https://ref.example.com/same.jpg" };
    const out = await batchReverseImageSearch([ref], {
      providers: ["serpapi"],
      fetcher,
      auth: { serpApiKey: "k" },
      dedupeSameImageInBatch: true,
    });
    const again = await batchReverseImageSearch([ref, ref], {
      providers: ["serpapi"],
      fetcher,
      auth: { serpApiKey: "k" },
      dedupeSameImageInBatch: true,
    });
    expect(out.results[0]!.imageIndex).toBe(0);
    expect(again.results.map((r) => r.imageIndex)).toEqual([0, 1]);
    expect(calls).toBeGreaterThan(0);
  });
});

describe("validateProviderRegistry", () => {
  const okFetcher = stubFetcher([
    {
      match: () => true,
      handler: async () => jsonResponse({ results: [], collection: { items: [] } }),
    },
  ]);

  test("passes keyless providers with a stubbed fetcher and builds the matrix", async () => {
    const out = await validateProviderRegistry({
      providers: ["openverse", "nasa"],
      fetcher: okFetcher,
      timeoutMs: 2000,
    });
    expect(out.providerStatus.map((s) => s.id).sort()).toEqual(["nasa", "openverse"]);
    for (const s of out.providerStatus) {
      expect(s.authOk).toBe(true);
      expect(s.failedChecks).toEqual([]);
      expect(s.passed).toBe(true);
      expect(s.confidence).toBeGreaterThan(0);
    }
    expect(out.capabilityMatrix.general.map((e) => e.id)).toContain("openverse");
    for (const intent of ["artist", "event", "stock", "general"] as const) {
      const c = out.capabilityMatrix[intent].map((e) => e.confidence);
      expect([...c].sort((a, b) => b - a)).toEqual(c);
    }
  });

  test("missing auth fails the auth check without calling the network", async () => {
    const saved = process.env.UNSPLASH_ACCESS_KEY;
    delete process.env.UNSPLASH_ACCESS_KEY;
    try {
      const out = await validateProviderRegistry({ providers: ["unsplash"], timeoutMs: 500 });
      expect(out.providerStatus[0]).toMatchObject({
        passed: false,
        authOk: false,
        failedChecks: ["auth"],
      });
    } finally {
      if (saved !== undefined) process.env.UNSPLASH_ACCESS_KEY = saved;
    }
  });

  test("a failing canary is reported, confidence 0", async () => {
    const bad = stubFetcher([
      { match: () => true, handler: async () => new Response("x", { status: 503 }) },
    ]);
    const out = await validateProviderRegistry({
      providers: ["openverse"],
      fetcher: bad,
      timeoutMs: 500,
    });
    expect(out.providerStatus[0]!.passed).toBe(false);
    expect(out.providerStatus[0]!.failedChecks).toContain("canary");
    expect(out.providerStatus[0]!.confidence).toBe(0);
  });

  test("getCapabilityMatrix returns the matrix for the given providers", async () => {
    const m = await getCapabilityMatrix({
      providers: ["wikimedia"],
      fetcher: okFetcher,
      timeoutMs: 500,
    });
    expect(Object.keys(m).sort()).toEqual(["artist", "event", "general", "stock"]);
  });
});
