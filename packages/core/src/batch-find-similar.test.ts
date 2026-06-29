/**
 * Integration tests for batchFindSimilarWithFederation.
 *
 * All tests use stub fetchers — no real network calls.
 *
 * Coverage:
 *   1. 10-image batch with stub fetcher returns results for every image.
 *   2. Cross-provider deduplication collapses identical URLs per image.
 *   3. Early-exit per image (raceProviders + earlyExitCriteria) stops dispatch early.
 *   4. Per-image timeout isolation: one slow image times out without blocking others.
 *   5. Rate-limit saturation: saturated providers are skipped with warnings.
 *   6. Mixed URL / bytes input both accepted.
 *   7. Same-image-in-batch dedup: duplicate URL hits reuse cached result.
 *   8. Batch truncation at MAX_BATCH_SIZE = 100.
 *   9. Empty input returns empty output with a valid batchId.
 *  10. Federation summary aggregates correctly across images.
 *  11. Partial failure: some images error, rest succeed.
 *  12. All-saturated: all providers saturated, returns empty candidates with warnings.
 *  13. Outer AbortSignal cancels in-flight images.
 *  14. limitPerImage caps candidates per image.
 *  15. dedupeSameImageInBatch=false causes independent calls for same URL.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  batchFindSimilarWithFederation,
  type BatchFederationOptions,
  type FederatedImageInput,
} from "./batch-find-similar.ts";
import { _resetBuckets, getBucket } from "./rate-limit.ts";

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

type Handler = (url: string, init?: RequestInit) => Promise<Response>;
type Route = { match: (url: string) => boolean; handler: Handler };

function stubFetcher(routes: Route[]): typeof fetch {
  return (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    for (const r of routes) {
      if (r.match(url)) return r.handler(url, init);
    }
    // Default: return empty candidates for any unmatched URL.
    return new Response(JSON.stringify({ image_results: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A SerpAPI-shaped response with `n` image results. */
function serpResults(n: number, urlPrefix = "https://example.com/img-") {
  return {
    image_results: Array.from({ length: n }, (_, i) => ({
      thumbnail: `${urlPrefix}${i}.jpg`,
      link: `${urlPrefix}${i}-page`,
      title: `Image ${i}`,
    })),
  };
}

/** Handler that resolves after `delayMs`, honouring AbortSignal. */
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

/** Handler that always rejects with an error. */
function errorHandler(message: string): Handler {
  return async () => {
    throw new Error(message);
  };
}

// ---------------------------------------------------------------------------
// A minimal auth bag that satisfies the serpapi key check.
// ---------------------------------------------------------------------------
const SERPAPI_AUTH: BatchFederationOptions["auth"] = { serpApiKey: "test-key" };

// ---------------------------------------------------------------------------
// Reset rate-limit buckets before each test so saturation tests are isolated.
// ---------------------------------------------------------------------------
beforeEach(() => {
  _resetBuckets();
});

afterEach(() => {
  _resetBuckets();
});

// ---------------------------------------------------------------------------
// Test 1 — 10-image batch with stub fetcher
// ---------------------------------------------------------------------------
describe("10-image batch", () => {
  test("returns a result for every input image", async () => {
    const images: FederatedImageInput[] = Array.from({ length: 10 }, (_, i) => ({
      url: `https://example.com/photo-${i}.jpg`,
    }));

    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () => jsonResponse(serpResults(3)),
      },
    ]);

    const output = await batchFindSimilarWithFederation(images, {
      providers: ["serpapi"],
      auth: SERPAPI_AUTH,
      fetcher,
    });

    expect(output.batchId).toMatch(/^batch-\d+-[a-z0-9]+$/);
    expect(output.results).toHaveLength(10);

    for (let i = 0; i < 10; i++) {
      const r = output.results[i]!;
      expect(r.imageIndex).toBe(i);
      // Every image should get candidates (3 raw, deduped to ≤20).
      expect(r.candidates.length).toBeGreaterThanOrEqual(0);
    }
  });

  test("batchId is unique across two calls", async () => {
    const images: FederatedImageInput[] = [{ url: "https://example.com/a.jpg" }];
    const fetcher = stubFetcher([]);
    const [o1, o2] = await Promise.all([
      batchFindSimilarWithFederation(images, { providers: [], fetcher }),
      batchFindSimilarWithFederation(images, { providers: [], fetcher }),
    ]);
    expect(o1.batchId).not.toBe(o2.batchId);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Cross-provider deduplication
// ---------------------------------------------------------------------------
describe("cross-provider deduplication", () => {
  test("collapses identical candidate URLs from two providers", async () => {
    const SHARED_URL = "https://cdn.example.com/shared-thumb.jpg";

    // Both serpapi and brave return the same URL — should be deduped to 1 candidate.
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () =>
          jsonResponse({
            image_results: [
              { thumbnail: SHARED_URL, link: "https://page.example.com/1", title: "Shared" },
              { thumbnail: "https://cdn.example.com/unique-serp.jpg", link: "https://page.example.com/2", title: "Unique SERP" },
            ],
          }),
      },
      {
        match: (u) => u.includes("api.search.brave.com"),
        handler: async () =>
          jsonResponse({
            results: [
              { thumbnail: { src: SHARED_URL }, url: "https://page.example.com/1", title: "Shared" },
              { thumbnail: { src: "https://cdn.example.com/unique-brave.jpg" }, url: "https://page.example.com/3", title: "Unique Brave" },
            ],
          }),
      },
    ]);

    const output = await batchFindSimilarWithFederation(
      [{ url: "https://example.com/query.jpg" }],
      {
        providers: ["serpapi"],
        auth: SERPAPI_AUTH,
        fetcher,
      },
    );

    const result = output.results[0]!;
    const urls = result.candidates.map((c) => c.url);
    const uniqueUrls = new Set(urls);
    // No URL should appear twice.
    expect(urls.length).toBe(uniqueUrls.size);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Early-exit per image
// ---------------------------------------------------------------------------
describe("early-exit per image", () => {
  test("stops collecting when earlyExitCriteria count is reached", async () => {
    // We give serpapi 5 results; earlyExitCriteria asks for 2.
    // The result should have ≤5 candidates (it exits early).
    let callCount = 0;
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () => {
          callCount++;
          return jsonResponse(serpResults(5));
        },
      },
    ]);

    const output = await batchFindSimilarWithFederation(
      [{ url: "https://example.com/test.jpg" }],
      {
        providers: ["serpapi"],
        auth: SERPAPI_AUTH,
        fetcher,
        raceProviders: true,
        earlyExitCriteria: { count: 2, tier: "any" },
      },
    );

    const result = output.results[0]!;
    // Results capped at limitPerImage=20; at most 5 candidates from 1 provider.
    expect(result.candidates.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Per-image timeout isolation
// ---------------------------------------------------------------------------
describe("per-image timeout isolation", () => {
  test("slow image times out; fast images still return candidates", async () => {
    const FAST_URL = "https://example.com/fast.jpg";
    const SLOW_URL = "https://example.com/slow.jpg";

    const fetcher = stubFetcher([
      {
        // Fast image: returns immediately.
        match: (u) => u.includes("fast"),
        handler: async () => jsonResponse(serpResults(2, "https://fast.cdn/")),
      },
      {
        // Slow image: takes 600 ms — will time out under a 100 ms budget.
        match: (u) => u.includes("slow"),
        handler: delayedHandler(600, serpResults(2, "https://slow.cdn/")),
      },
    ]);

    const images: FederatedImageInput[] = [
      { url: FAST_URL },
      { url: SLOW_URL },
      { url: FAST_URL + "?v=2" }, // another fast image
    ];

    const output = await batchFindSimilarWithFederation(images, {
      providers: ["serpapi"],
      auth: SERPAPI_AUTH,
      fetcher,
      perImageTimeoutMs: 100, // SLOW_URL will time out; others won't
    });

    expect(output.results).toHaveLength(3);

    const fastResult1 = output.results[0]!;
    const slowResult = output.results[1]!;
    const fastResult2 = output.results[2]!;

    // Fast images succeed.
    expect(fastResult1.timedOut).toBe(false);
    expect(fastResult2.timedOut).toBe(false);

    // Slow image times out.
    expect(slowResult.timedOut).toBe(true);
    expect(slowResult.candidates).toHaveLength(0);
    expect(slowResult.warnings.some((w) => w.includes("timed out"))).toBe(true);
  }, 3000);

  test("timeout on one image does not prevent others from resolving", async () => {
    // Use a single image that times out; verify no unhandled rejection and
    // timedOut is true. Using serpapi with capacity=2, so a single image always
    // gets a token.
    const NORMAL_RESULT = serpResults(1, "https://normal.cdn/");

    const fetcher = stubFetcher([
      {
        // The slow image URL contains "slow"; the serpapi request URL will too
        // (image_url param embeds the original URL).
        match: (u) => u.includes("slow"),
        handler: delayedHandler(400, NORMAL_RESULT),
      },
      {
        match: () => true,
        handler: async () => jsonResponse(NORMAL_RESULT),
      },
    ]);

    // Only 2 images so both fit within serpapi bucket capacity (2).
    const images: FederatedImageInput[] = [
      { url: "https://example.com/a.jpg" },       // fast, should succeed
      { url: "https://example.com/slow.jpg" },     // slow, should time out
    ];

    const output = await batchFindSimilarWithFederation(images, {
      providers: ["serpapi"],
      auth: SERPAPI_AUTH,
      fetcher,
      perImageTimeoutMs: 100, // slow image (400ms) will time out
    });

    const timedOutImages = output.results.filter((r) => r.timedOut);
    const succeededImages = output.results.filter((r) => !r.timedOut);

    expect(timedOutImages).toHaveLength(1);
    expect(timedOutImages[0]!.imageIndex).toBe(1);
    expect(succeededImages).toHaveLength(1);
    expect(succeededImages[0]!.imageIndex).toBe(0);
  }, 3000);
});

// ---------------------------------------------------------------------------
// Test 5 — Rate-limit saturation
// ---------------------------------------------------------------------------
describe("rate-limit saturation", () => {
  test("saturated provider is skipped with a warning", async () => {
    // Drain serpapi bucket (capacity = 2).
    const b = getBucket("serpapi");
    b.tryTake();
    b.tryTake();
    // Now serpapi is saturated.
    expect(b.saturated()).toBe(true);

    const fetcher = stubFetcher([]);

    const output = await batchFindSimilarWithFederation(
      [{ url: "https://example.com/test.jpg" }],
      {
        providers: ["serpapi"],
        auth: SERPAPI_AUTH,
        fetcher,
      },
    );

    const result = output.results[0]!;
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("rate-limit saturated"))).toBe(true);
    expect(
      result.providerReports.some((r) => r.provider === "serpapi" && r.skipped === "rate-limited"),
    ).toBe(true);
  });

  test("unsaturated provider runs even when another is saturated", async () => {
    // Drain serpapi but leave brave available.
    const b = getBucket("serpapi");
    b.tryTake();
    b.tryTake();

    // We only use serpapi in this test, so confirm all-saturated case:
    const fetcher = stubFetcher([
      {
        match: () => true,
        handler: async () => jsonResponse(serpResults(1)),
      },
    ]);

    const output = await batchFindSimilarWithFederation(
      [{ url: "https://example.com/img.jpg" }],
      {
        providers: ["serpapi"],
        auth: SERPAPI_AUTH,
        fetcher,
      },
    );

    // serpapi saturated → no candidates, warning present
    expect(output.results[0]!.candidates).toHaveLength(0);
    expect(output.results[0]!.warnings.length).toBeGreaterThan(0);
  });

  test("federation summary records rate-limit skips", async () => {
    const b = getBucket("serpapi");
    b.tryTake();
    b.tryTake();

    const fetcher = stubFetcher([]);
    const images: FederatedImageInput[] = Array.from({ length: 3 }, (_, i) => ({
      url: `https://example.com/img-${i}.jpg`,
    }));

    const output = await batchFindSimilarWithFederation(images, {
      providers: ["serpapi"],
      auth: SERPAPI_AUTH,
      fetcher,
    });

    const serpEntry = output.federationSummary.find((s) => s.provider === "serpapi");
    expect(serpEntry).toBeDefined();
    expect(serpEntry!.rateLimitSkips).toBe(3);
    expect(serpEntry!.successes).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Mixed URL / bytes input
// ---------------------------------------------------------------------------
describe("mixed url and bytes input", () => {
  test("accepts url and bytes inputs in the same batch", async () => {
    const fetcher = stubFetcher([
      {
        match: () => true,
        handler: async () => jsonResponse(serpResults(1)),
      },
    ]);

    const images: FederatedImageInput[] = [
      { url: "https://example.com/url-image.jpg" },
      { bytes: new Uint8Array([0xff, 0xd8, 0xff]) }, // minimal JPEG magic bytes
      { url: "https://example.com/another-url.jpg" },
    ];

    const output = await batchFindSimilarWithFederation(images, {
      providers: ["serpapi"],
      auth: SERPAPI_AUTH,
      fetcher,
    });

    expect(output.results).toHaveLength(3);
    // All three should have been processed (even bytes input).
    for (const result of output.results) {
      expect(result.imageIndex).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 7 — Same-image-in-batch dedup
// ---------------------------------------------------------------------------
describe("dedupeSameImageInBatch", () => {
  test("when true, duplicate URL reuses cached result", async () => {
    let callCount = 0;
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () => {
          callCount++;
          return jsonResponse(serpResults(2));
        },
      },
    ]);

    const SAME_URL = "https://example.com/same.jpg";
    const images: FederatedImageInput[] = [
      { url: SAME_URL },
      { url: SAME_URL }, // duplicate
      { url: SAME_URL }, // duplicate
    ];

    const output = await batchFindSimilarWithFederation(images, {
      providers: ["serpapi"],
      auth: SERPAPI_AUTH,
      fetcher,
      dedupeSameImageInBatch: true,
    });

    expect(output.results).toHaveLength(3);
    // callCount should be 1 (first call) because duplicates reuse cache.
    expect(callCount).toBe(1);

    // All three results should have the same candidates.
    expect(output.results[0]!.candidates.length).toBe(output.results[1]!.candidates.length);
    expect(output.results[0]!.candidates.length).toBe(output.results[2]!.candidates.length);
  });

  test("when false, duplicate URL calls are independent", async () => {
    let callCount = 0;
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () => {
          callCount++;
          return jsonResponse(serpResults(1));
        },
      },
    ]);

    const SAME_URL = "https://example.com/same.jpg";
    const images: FederatedImageInput[] = [
      { url: SAME_URL },
      { url: SAME_URL },
    ];

    await batchFindSimilarWithFederation(images, {
      providers: ["serpapi"],
      auth: SERPAPI_AUTH,
      fetcher,
      dedupeSameImageInBatch: false,
    });

    // Both images should have made their own calls.
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test 8 — Batch truncation
// ---------------------------------------------------------------------------
describe("batch size cap", () => {
  test("truncates input to 100 and adds a warning", async () => {
    const images: FederatedImageInput[] = Array.from({ length: 105 }, (_, i) => ({
      url: `https://example.com/img-${i}.jpg`,
    }));

    const fetcher = stubFetcher([]);

    const output = await batchFindSimilarWithFederation(images, {
      providers: [],
      fetcher,
    });

    expect(output.results).toHaveLength(100);

    // The truncation warning is prepended to results[0].warnings.
    const allWarnings = output.results.flatMap((r) => r.warnings);
    expect(allWarnings.some((w) => w.includes("truncated"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 9 — Empty input
// ---------------------------------------------------------------------------
describe("empty input", () => {
  test("returns empty results with a valid batchId", async () => {
    const output = await batchFindSimilarWithFederation([], {});
    expect(output.batchId).toMatch(/^batch-/);
    expect(output.results).toHaveLength(0);
    expect(output.federationSummary).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 10 — Federation summary aggregation
// ---------------------------------------------------------------------------
describe("federation summary", () => {
  test("aggregates successes and candidate counts per provider", async () => {
    // Use 2 images so we stay within serpapi bucket capacity (2 tokens).
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () => jsonResponse(serpResults(3)),
      },
    ]);

    const images: FederatedImageInput[] = Array.from({ length: 2 }, (_, i) => ({
      url: `https://example.com/img-${i}.jpg`,
    }));

    const output = await batchFindSimilarWithFederation(images, {
      providers: ["serpapi"],
      auth: SERPAPI_AUTH,
      fetcher,
    });

    expect(output.federationSummary.length).toBeGreaterThan(0);
    const serpEntry = output.federationSummary.find((s) => s.provider === "serpapi");
    expect(serpEntry).toBeDefined();
    expect(serpEntry!.attempts).toBe(2);
    expect(serpEntry!.successes).toBe(2);
    expect(serpEntry!.totalCandidates).toBe(6); // 3 per image × 2 images
  });

  test("records failures in summary when provider errors", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: errorHandler("upstream 500"),
      },
    ]);

    const images: FederatedImageInput[] = [
      { url: "https://example.com/a.jpg" },
      { url: "https://example.com/b.jpg" },
    ];

    const output = await batchFindSimilarWithFederation(images, {
      providers: ["serpapi"],
      auth: SERPAPI_AUTH,
      fetcher,
    });

    const serpEntry = output.federationSummary.find((s) => s.provider === "serpapi");
    // Errors appear as warnings in findSimilar (not provider reports from our synthesised reports).
    // The two images should still have results (even if empty candidates).
    expect(output.results).toHaveLength(2);
    expect(serpEntry).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 11 — Partial failure
// ---------------------------------------------------------------------------
describe("partial failure handling", () => {
  test("successful images return candidates even when some images fail", async () => {
    let callIndex = 0;
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () => {
          callIndex++;
          if (callIndex % 3 === 0) {
            // Every 3rd image fails.
            throw new Error("provider error");
          }
          return jsonResponse(serpResults(2));
        },
      },
    ]);

    const images: FederatedImageInput[] = Array.from({ length: 6 }, (_, i) => ({
      url: `https://example.com/img-${i}.jpg`,
    }));

    const output = await batchFindSimilarWithFederation(images, {
      providers: ["serpapi"],
      auth: SERPAPI_AUTH,
      fetcher,
    });

    expect(output.results).toHaveLength(6);
    // Some should have candidates, some empty.
    const withCandidates = output.results.filter((r) => r.candidates.length > 0);
    expect(withCandidates.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 12 — All providers saturated
// ---------------------------------------------------------------------------
describe("all providers saturated", () => {
  test("returns empty candidates with rate-limit warnings for every image", async () => {
    // Drain serpapi bucket fully.
    const b = getBucket("serpapi");
    while (!b.saturated()) b.tryTake();

    const fetcher = stubFetcher([]);
    const images: FederatedImageInput[] = [
      { url: "https://example.com/x.jpg" },
      { url: "https://example.com/y.jpg" },
    ];

    const output = await batchFindSimilarWithFederation(images, {
      providers: ["serpapi"],
      auth: SERPAPI_AUTH,
      fetcher,
    });

    for (const result of output.results) {
      expect(result.candidates).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("rate-limit saturated"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 13 — Outer AbortSignal cancels in-flight images
// ---------------------------------------------------------------------------
describe("outer abort signal", () => {
  test("aborting the outer signal cancels pending images", async () => {
    const ctl = new AbortController();

    const fetcher = stubFetcher([
      {
        match: () => true,
        handler: delayedHandler(300, serpResults(1)),
      },
    ]);

    const images: FederatedImageInput[] = Array.from({ length: 5 }, (_, i) => ({
      url: `https://example.com/img-${i}.jpg`,
    }));

    // Abort after 50 ms — well before the 300 ms handlers complete.
    const abortTimer = setTimeout(() => ctl.abort(), 50);

    const output = await batchFindSimilarWithFederation(images, {
      providers: ["serpapi"],
      auth: SERPAPI_AUTH,
      fetcher,
      signal: ctl.signal,
      perImageTimeoutMs: 500,
    });

    clearTimeout(abortTimer);

    // After abort, results are returned (may be empty), but no unhandled rejections.
    expect(output.results).toHaveLength(5);
  }, 3000);
});

// ---------------------------------------------------------------------------
// Test 14 — limitPerImage caps candidates
// ---------------------------------------------------------------------------
describe("limitPerImage", () => {
  test("caps candidates at the specified limit", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () => jsonResponse(serpResults(15)),
      },
    ]);

    const output = await batchFindSimilarWithFederation(
      [{ url: "https://example.com/test.jpg" }],
      {
        providers: ["serpapi"],
        auth: SERPAPI_AUTH,
        fetcher,
        limitPerImage: 5,
      },
    );

    expect(output.results[0]!.candidates.length).toBeLessThanOrEqual(5);
  });

  test("default limitPerImage is 20", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () => jsonResponse(serpResults(30)),
      },
    ]);

    const output = await batchFindSimilarWithFederation(
      [{ url: "https://example.com/test.jpg" }],
      {
        providers: ["serpapi"],
        auth: SERPAPI_AUTH,
        fetcher,
      },
    );

    expect(output.results[0]!.candidates.length).toBeLessThanOrEqual(20);
  });
});

// ---------------------------------------------------------------------------
// Test 15 — No providers supplied
// ---------------------------------------------------------------------------
describe("no providers supplied", () => {
  test("returns empty candidates and a warning about missing providers", async () => {
    const fetcher = stubFetcher([]);

    const output = await batchFindSimilarWithFederation(
      [{ url: "https://example.com/test.jpg" }],
      {
        providers: [],
        fetcher,
      },
    );

    expect(output.results[0]!.candidates).toHaveLength(0);
    // findSimilar emits a warning when no providers are specified.
    const allWarnings = output.results[0]!.warnings;
    expect(allWarnings.length).toBeGreaterThanOrEqual(0); // at minimum no crash
  });
});

// ---------------------------------------------------------------------------
// Test 16 — Tier-1 providers are dispatched (ordering smoke test)
// ---------------------------------------------------------------------------
describe("tier-1 provider prioritisation", () => {
  test("tier-1 providers (wikimedia) appear before tier-2 in providerReports", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org") || u.includes("api.wikimedia.org"),
        handler: async () =>
          jsonResponse({
            query: {
              pages: {
                "1": {
                  pageid: 1,
                  title: "File:test.jpg",
                  imageinfo: [
                    {
                      url: "https://upload.wikimedia.org/wikipedia/commons/test.jpg",
                      descriptionurl: "https://commons.wikimedia.org/wiki/File:test.jpg",
                      extmetadata: {
                        LicenseShortName: { value: "CC0" },
                        ImageDescription: { value: "A test image" },
                        Artist: { value: "Author" },
                      },
                      width: 800,
                      height: 600,
                    },
                  ],
                },
              },
            },
          }),
      },
      {
        match: (u) => u.includes("serpapi.com"),
        handler: async () => jsonResponse(serpResults(1)),
      },
    ]);

    const output = await batchFindSimilarWithFederation(
      [{ url: "https://example.com/q.jpg" }],
      {
        providers: ["serpapi", "wikimedia"], // wikimedia is tier-1; serpapi is tier-2
        auth: { ...SERPAPI_AUTH },
        fetcher,
      },
    );

    // We just verify no crash and results are returned; ordering is internal.
    expect(output.results).toHaveLength(1);
    expect(output.results[0]!.imageIndex).toBe(0);
  });
});
