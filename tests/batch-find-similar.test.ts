/**
 * Integration tests for batch reverse-image search.
 *
 * Covers:
 *   1. Multi-provider results (brave + serpapi) merged per URL
 *   2. Rate-limit saturation warning + graceful skip (no network call)
 *   3. URL-level deduplication across providers
 *   4. Missing-key warning path
 *   5. Single-provider (serpapi only) happy path
 *   6. Single-provider (brave only) happy path
 *   7. Empty providers list emits guidance warning
 */

import { describe, expect, test } from "bun:test";
import { batchFindSimilar } from "../packages/core/src/batch-find-similar.ts";
import { _resetBuckets } from "../packages/core/src/rate-limit.ts";
import { jsonResponse, stubFetcher } from "./stub-fetcher.ts";

const SERPAPI_RESULT = {
  image_results: [
    { thumbnail: "https://example.com/img-a.jpg", link: "https://example.com/page-a", title: "A" },
    { thumbnail: "https://example.com/img-b.jpg", link: "https://example.com/page-b", title: "B" },
  ],
};

const BRAVE_RESULT = {
  results: [
    {
      properties: { url: "https://brave.example.com/img-c.jpg", width: 800, height: 600 },
      thumbnail: { src: "https://brave.example.com/thumb-c.jpg" },
      url: "https://brave.example.com/page-c",
      title: "C",
    },
    // Duplicate of serpapi result — same URL after normalisation
    {
      properties: { url: "https://example.com/img-a.jpg" },
      thumbnail: { src: "https://example.com/img-a.jpg" },
      url: "https://example.com/page-a",
      title: "A-dup",
    },
  ],
};

function makeFetcher(opts: { serpapi?: boolean; brave?: boolean } = {}) {
  return stubFetcher([
    ...(opts.serpapi !== false
      ? [
          {
            match: (u: string) => u.includes("serpapi.com"),
            handler: async () => jsonResponse(SERPAPI_RESULT),
          },
        ]
      : []),
    ...(opts.brave !== false
      ? [
          {
            match: (u: string) => u.includes("api.search.brave.com"),
            handler: async () => jsonResponse(BRAVE_RESULT),
          },
        ]
      : []),
  ]);
}

describe("batchFindSimilar — multi-provider reverse search", () => {
  test("returns results for each input URL", async () => {
    _resetBuckets();
    const out = await batchFindSimilar(
      {
        urls: ["https://example.com/ref1.jpg", "https://example.com/ref2.jpg"],
        providers: ["serpapi"],
        limit: 20,
      },
      {
        fetcher: makeFetcher({ brave: false }),
        auth: { serpApiKey: "test-serp-key" },
      },
    );

    expect(out.results).toHaveLength(2);
    expect(out.results[0]!.url).toBe("https://example.com/ref1.jpg");
    expect(out.results[1]!.url).toBe("https://example.com/ref2.jpg");
    for (const r of out.results) {
      expect(r.candidates.length).toBeGreaterThan(0);
    }
  });

  test("merges candidates from brave + serpapi and deduplicates", async () => {
    _resetBuckets();
    const out = await batchFindSimilar(
      {
        urls: ["https://example.com/ref.jpg"],
        providers: ["serpapi", "brave"],
        limit: 20,
      },
      {
        fetcher: makeFetcher(),
        auth: { serpApiKey: "test-serp-key", braveApiKey: "test-brave-key" },
      },
    );

    const result = out.results[0]!;
    // serpapi gives 2 unique, brave gives 2 but 1 is a dup of serpapi → 3 total after dedup
    expect(result.candidates.length).toBe(3);
    const sources = result.candidates.map((c) => c.source);
    expect(sources).toContain("serpapi");
    expect(sources).toContain("brave");
  });

  test("limit caps candidates per URL", async () => {
    _resetBuckets();
    const out = await batchFindSimilar(
      {
        urls: ["https://example.com/ref.jpg"],
        providers: ["serpapi", "brave"],
        limit: 2,
      },
      {
        fetcher: makeFetcher(),
        auth: { serpApiKey: "test-serp-key", braveApiKey: "test-brave-key" },
      },
    );

    expect(out.results[0]!.candidates.length).toBeLessThanOrEqual(2);
  });
});

describe("batchFindSimilar — rate-limit throttling", () => {
  test("emits saturation warning and skips provider when bucket is exhausted", async () => {
    _resetBuckets();

    // Drain the brave bucket (capacity=1) so it is saturated.
    const { getBucket } = await import("../packages/core/src/rate-limit.ts");
    const bucket = getBucket("brave");
    await bucket.take(); // consume the single token

    let braveCallCount = 0;
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () => jsonResponse(SERPAPI_RESULT),
      },
      {
        match: (u) => u.includes("api.search.brave.com"),
        handler: async () => {
          braveCallCount++;
          return jsonResponse(BRAVE_RESULT);
        },
      },
    ]);

    const out = await batchFindSimilar(
      {
        urls: ["https://example.com/ref.jpg"],
        providers: ["serpapi", "brave"],
      },
      {
        fetcher,
        auth: { serpApiKey: "test-serp-key", braveApiKey: "test-brave-key" },
      },
    );

    const result = out.results[0]!;
    // Brave was saturated — should not have been called
    expect(braveCallCount).toBe(0);
    // Warning should mention saturation
    expect(result.warnings.some((w) => w.includes("brave") && w.includes("saturated"))).toBe(true);
    // SerpAPI still returned candidates
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.source === "serpapi")).toBe(true);
  });
});

describe("batchFindSimilar — missing keys", () => {
  test("emits warning when serpapi key is absent", async () => {
    _resetBuckets();
    const out = await batchFindSimilar(
      { urls: ["https://example.com/ref.jpg"], providers: ["serpapi"] },
      { fetcher: makeFetcher({ brave: false }) },
      // Note: no auth and no env var
    );
    const result = out.results[0]!;
    expect(result.warnings.some((w) => w.includes("SERPAPI_KEY"))).toBe(true);
    expect(result.candidates).toHaveLength(0);
  });

  test("emits warning when brave key is absent", async () => {
    _resetBuckets();
    const out = await batchFindSimilar(
      { urls: ["https://example.com/ref.jpg"], providers: ["brave"] },
      { fetcher: makeFetcher({ serpapi: false }) },
    );
    const result = out.results[0]!;
    expect(result.warnings.some((w) => w.includes("BRAVE_API_KEY"))).toBe(true);
    expect(result.candidates).toHaveLength(0);
  });
});

describe("batchFindSimilar — single provider paths", () => {
  test("serpapi-only returns serpapi candidates", async () => {
    _resetBuckets();
    const out = await batchFindSimilar(
      { urls: ["https://example.com/ref.jpg"], providers: ["serpapi"] },
      {
        fetcher: makeFetcher({ brave: false }),
        auth: { serpApiKey: "test-serp-key" },
      },
    );
    const result = out.results[0]!;
    expect(result.candidates.length).toBe(2);
    expect(result.candidates.every((c) => c.source === "serpapi")).toBe(true);
  });

  test("brave-only returns brave candidates", async () => {
    _resetBuckets();
    const out = await batchFindSimilar(
      { urls: ["https://example.com/ref.jpg"], providers: ["brave"] },
      {
        fetcher: makeFetcher({ serpapi: false }),
        auth: { braveApiKey: "test-brave-key" },
      },
    );
    const result = out.results[0]!;
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every((c) => c.source === "brave")).toBe(true);
  });
});

describe("batchFindSimilar — empty providers", () => {
  test("emits guidance warning when providers list is empty", async () => {
    _resetBuckets();
    const out = await batchFindSimilar(
      { urls: ["https://example.com/ref.jpg"], providers: [] },
      {},
    );
    const result = out.results[0]!;
    expect(result.warnings.some((w) => w.includes("providers"))).toBe(true);
    expect(result.candidates).toHaveLength(0);
  });
});
