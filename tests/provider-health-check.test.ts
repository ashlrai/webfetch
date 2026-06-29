/**
 * Integration tests for provider-health-check.ts
 *
 * Covers:
 *  - Endpoint detection (PROVIDER_ENDPOINTS registry)
 *  - Status classification (up / degraded / down)
 *  - SSL cert parsing
 *  - Circuit-breaker logic (closed → open → half-open)
 *  - Rate-limit auto-tuning on 429 / 503
 *  - getProviderHealthStatus() caching
 *  - checkAllProviders() fan-out
 *  - pre-flight healthCheck integration with searchImages()
 *
 * All tests use a stub fetcher — no real network calls.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  PROVIDER_ENDPOINTS,
  _resetCircuitBreakers,
  _resetDegradationLevels,
  _resetHealthCache,
  checkAllProviders,
  degradationLevels,
  degradeBucketCapacity,
  getDegradationMultiplier,
  getCircuitState,
  getProviderHealthStatus,
  healthCheckProvider,
} from "../packages/core/src/provider-health-check.ts";
import { _resetBuckets, getBucketState } from "../packages/core/src/rate-limit.ts";
import { searchImages } from "../packages/core/src/federation.ts";
import { _resetTelemetry } from "../packages/core/src/federation-telemetry.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(
  status: number,
  opts: {
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Response {
  const headers = new Headers(opts.headers ?? { "content-type": "application/json" });
  if (!headers.has("content-length") && opts.body) {
    headers.set("content-length", String(new TextEncoder().encode(opts.body).length));
  }
  return new Response(opts.body ?? "{}", { status, headers });
}

function stubFetcher(handler: (url: string) => Response | Promise<Response>): typeof fetch {
  return (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    return handler(url);
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetHealthCache();
  _resetCircuitBreakers();
  _resetDegradationLevels();
  _resetBuckets();
  _resetTelemetry();
});

afterEach(() => {
  _resetHealthCache();
  _resetCircuitBreakers();
  _resetDegradationLevels();
  _resetBuckets();
});

// ---------------------------------------------------------------------------
// 1. Endpoint registry
// ---------------------------------------------------------------------------

describe("endpoint registry", () => {
  test("PROVIDER_ENDPOINTS has an entry for every known provider", () => {
    const { PROVIDER_IDS } = require("../packages/core/src/types.ts");
    for (const id of PROVIDER_IDS) {
      expect(PROVIDER_ENDPOINTS[id]).toBeDefined();
      expect(typeof PROVIDER_ENDPOINTS[id]).toBe("string");
      expect(PROVIDER_ENDPOINTS[id].startsWith("http")).toBe(true);
    }
  });

  test("all endpoints use http or https scheme", () => {
    for (const [id, url] of Object.entries(PROVIDER_ENDPOINTS)) {
      expect(url.startsWith("http://") || url.startsWith("https://")).toBe(true);
    }
  });

  test("throws for unknown provider id", async () => {
    await expect(
      healthCheckProvider("not-a-real-provider" as any, { fetcher: stubFetcher(() => makeResponse(200)) }),
    ).rejects.toThrow(/unknown provider id/);
  });
});

// ---------------------------------------------------------------------------
// 2. Status classification
// ---------------------------------------------------------------------------

describe("status classification", () => {
  test("HTTP 200 → status up", async () => {
    const result = await healthCheckProvider("wikimedia", {
      fetcher: stubFetcher(() => makeResponse(200, { body: '{"query":{}}' })),
    });
    expect(result.status).toBe("up");
    expect(result.metrics.statusCode).toBe(200);
  });

  test("HTTP 301 redirect → status up", async () => {
    const result = await healthCheckProvider("wikimedia", {
      fetcher: stubFetcher(() => makeResponse(301, { headers: { "content-type": "text/html", location: "https://example.com/" } })),
    });
    expect(result.status).toBe("up");
  });

  test("HTTP 401 (auth required) → status up (endpoint reachable)", async () => {
    const result = await healthCheckProvider("unsplash", {
      fetcher: stubFetcher(() => makeResponse(401, { body: '{"errors":["Unauthorized"]}' })),
    });
    expect(result.status).toBe("up");
    expect(result.metrics.statusCode).toBe(401);
  });

  test("HTTP 403 → status up (endpoint reachable, auth issue only)", async () => {
    const result = await healthCheckProvider("pexels", {
      fetcher: stubFetcher(() => makeResponse(403, { body: '{"error":"Forbidden"}' })),
    });
    expect(result.status).toBe("up");
  });

  test("HTTP 429 → status degraded + reason mentions rate-limited", async () => {
    const result = await healthCheckProvider("openverse", {
      fetcher: stubFetcher(() => makeResponse(429, { body: '{"detail":"throttled"}' })),
    });
    expect(result.status).toBe("degraded");
    expect(result.reason).toMatch(/rate-limit/i);
    expect(result.metrics.statusCode).toBe(429);
  });

  test("HTTP 503 → status degraded + reason mentions service unavailable", async () => {
    const result = await healthCheckProvider("nasa", {
      fetcher: stubFetcher(() => makeResponse(503, { body: "Service Unavailable" })),
    });
    expect(result.status).toBe("degraded");
    expect(result.reason).toMatch(/service unavailable|503/i);
  });

  test("HTTP 500 → status down", async () => {
    const result = await healthCheckProvider("itunes", {
      fetcher: stubFetcher(() => makeResponse(500, { body: "Internal Server Error" })),
    });
    expect(result.status).toBe("down");
    expect(result.reason).toMatch(/500/);
  });

  test("network error → status down with reason", async () => {
    const result = await healthCheckProvider("flickr", {
      fetcher: stubFetcher(() => { throw new Error("ECONNREFUSED"); }),
    });
    expect(result.status).toBe("down");
    expect(result.reason).toMatch(/network error|ECONNREFUSED/i);
  });

  test("timeout → status down with timeout reason", async () => {
    const result = await healthCheckProvider("brave", {
      timeoutMs: 10,
      fetcher: (async (input: any, init?: RequestInit) => {
        // Respect AbortSignal so the timeout actually fires
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
            return;
          }
          const timer = setTimeout(() => _resolve(makeResponse(200)), 500);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
          });
        });
      }) as unknown as typeof fetch,
    });
    expect(result.status).toBe("down");
    expect(result.reason).toMatch(/timed out/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Metrics shape
// ---------------------------------------------------------------------------

describe("health metrics shape", () => {
  test("result always has all required fields", async () => {
    const result = await healthCheckProvider("wikimedia", {
      fetcher: stubFetcher(() => makeResponse(200, { body: "{}" })),
    });
    expect(result.provider).toBe("wikimedia");
    expect(typeof result.endpoint).toBe("string");
    expect(["up", "degraded", "down"]).toContain(result.status);
    expect(typeof result.lastCheck).toBe("number");
    expect(typeof result.metrics.dnsMs).toBe("number");
    expect(typeof result.metrics.tlsMs).toBe("number");
    expect(typeof result.metrics.httpLatencyMs).toBe("number");
    expect(typeof result.metrics.statusCode).toBe("number");
    expect(typeof result.metrics.contentLength).toBe("number");
    expect(result.metrics.httpLatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.lastCheck).toBeGreaterThan(0);
  });

  test("httpLatencyMs is a positive number on success", async () => {
    const result = await healthCheckProvider("openverse", {
      fetcher: stubFetcher(() => makeResponse(200, { body: '{"results":[]}' })),
    });
    expect(result.metrics.httpLatencyMs).toBeGreaterThanOrEqual(0);
  });

  test("contentLength matches body size", async () => {
    const body = '{"results":[{"id":"1"}]}';
    const result = await healthCheckProvider("openverse", {
      fetcher: stubFetcher(() =>
        makeResponse(200, { body, headers: { "content-type": "application/json", "content-length": String(new TextEncoder().encode(body).length) } }),
      ),
    });
    expect(result.metrics.contentLength).toBe(new TextEncoder().encode(body).length);
  });

  test("dnsMs and tlsMs are non-negative", async () => {
    const result = await healthCheckProvider("wikimedia", {
      fetcher: stubFetcher(() => makeResponse(200)),
    });
    expect(result.metrics.dnsMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.tlsMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 4. SSL cert extraction
// ---------------------------------------------------------------------------

describe("SSL cert parsing", () => {
  test("sslValidUntil is null when no cert headers present", async () => {
    const result = await healthCheckProvider("wikimedia", {
      fetcher: stubFetcher(() => makeResponse(200, { headers: { "content-type": "application/json" } })),
    });
    expect(result.sslValidUntil).toBeNull();
  });

  test("extracts sslValidUntil from x-ssl-cert-expire header (ISO date string)", async () => {
    const expiry = "2027-01-15T00:00:00.000Z";
    const result = await healthCheckProvider("wikimedia", {
      fetcher: stubFetcher(() =>
        makeResponse(200, {
          headers: { "content-type": "application/json", "x-ssl-cert-expire": expiry },
        }),
      ),
    });
    expect(result.sslValidUntil).toBe(expiry);
  });

  test("extracts sslValidUntil from x-cert-expiry header (Unix timestamp)", async () => {
    const futureDate = new Date("2027-06-01T00:00:00Z");
    const unixTs = Math.floor(futureDate.getTime() / 1000).toString();
    const result = await healthCheckProvider("openverse", {
      fetcher: stubFetcher(() =>
        makeResponse(200, {
          headers: { "content-type": "application/json", "x-cert-expiry": unixTs },
        }),
      ),
    });
    expect(result.sslValidUntil).toBeDefined();
    expect(result.sslValidUntil).not.toBeNull();
    // Should be parseable as a date
    const parsed = new Date(result.sslValidUntil!);
    expect(parsed.getFullYear()).toBe(2027);
  });

  test("extracts sslValidUntil from ssl-certificate-expiry header", async () => {
    const expiry = "2026-12-31T23:59:59.000Z";
    const result = await healthCheckProvider("itunes", {
      fetcher: stubFetcher(() =>
        makeResponse(200, {
          headers: {
            "content-type": "text/javascript",
            "ssl-certificate-expiry": expiry,
          },
        }),
      ),
    });
    expect(result.sslValidUntil).toBe(expiry);
  });
});

// ---------------------------------------------------------------------------
// 5. Content-Type validation
// ---------------------------------------------------------------------------

describe("content-type validation", () => {
  test("contentTypeValid is true for expected JSON content type", async () => {
    const result = await healthCheckProvider("wikimedia", {
      fetcher: stubFetcher(() =>
        makeResponse(200, { headers: { "content-type": "application/json; charset=utf-8" } }),
      ),
    });
    expect(result.contentTypeValid).toBe(true);
  });

  test("contentTypeValid is false when wrong content-type returned for known provider", async () => {
    const result = await healthCheckProvider("wikimedia", {
      fetcher: stubFetcher(() =>
        makeResponse(200, { headers: { "content-type": "text/html" } }),
      ),
    });
    expect(result.contentTypeValid).toBe(false);
  });

  test("contentTypeValid defaults to true for providers with no expected type", async () => {
    // 'browser' has no expected content-type
    const result = await healthCheckProvider("browser", {
      fetcher: stubFetcher(() =>
        makeResponse(200, { headers: { "content-type": "text/html" } }),
      ),
    });
    expect(result.contentTypeValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Circuit breaker logic
// ---------------------------------------------------------------------------

describe("circuit breaker", () => {
  test("initial state is closed", () => {
    expect(getCircuitState("wikimedia")).toBe("closed");
  });

  test("circuit opens after 3 consecutive failures", async () => {
    for (let i = 0; i < 3; i++) {
      await healthCheckProvider("wikimedia", {
        fetcher: stubFetcher(() => makeResponse(500)),
      });
    }
    expect(getCircuitState("wikimedia")).toBe("open");
  });

  test("open circuit returns down result without network call", async () => {
    // Force circuit open via failures
    for (let i = 0; i < 3; i++) {
      await healthCheckProvider("wikimedia", {
        fetcher: stubFetcher(() => makeResponse(500)),
      });
    }
    expect(getCircuitState("wikimedia")).toBe("open");

    // Clear the cache so the circuit-breaker path is exercised (not the cached result)
    _resetHealthCache();

    let callCount = 0;
    const result = await healthCheckProvider("wikimedia", {
      fetcher: stubFetcher(() => {
        callCount++;
        return makeResponse(200);
      }),
    });
    // Should not have made a network call when circuit is open
    expect(callCount).toBe(0);
    expect(result.status).toBe("down");
    expect(result.reason).toMatch(/circuit.breaker/i);
  });

  test("single success after failures resets circuit to closed", async () => {
    // Two failures — not enough to open
    await healthCheckProvider("openverse", {
      fetcher: stubFetcher(() => makeResponse(500)),
    });
    await healthCheckProvider("openverse", {
      fetcher: stubFetcher(() => makeResponse(500)),
    });
    // Success resets failures
    await healthCheckProvider("openverse", {
      fetcher: stubFetcher(() => makeResponse(200)),
    });
    expect(getCircuitState("openverse")).toBe("closed");
  });

  test("circuit stays closed with fewer than threshold failures", async () => {
    for (let i = 0; i < 2; i++) {
      await healthCheckProvider("nasa", {
        fetcher: stubFetcher(() => makeResponse(500)),
      });
    }
    expect(getCircuitState("nasa")).toBe("closed");
  });

  test("401/403 do not count as failures for circuit breaker", async () => {
    for (let i = 0; i < 5; i++) {
      await healthCheckProvider("unsplash", {
        fetcher: stubFetcher(() => makeResponse(401)),
      });
    }
    // 401 = reachable, should not open circuit
    expect(getCircuitState("unsplash")).toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// 7. Rate-limit auto-tuning
// ---------------------------------------------------------------------------

describe("rate-limit auto-tuning", () => {
  test("degradationLevels starts empty", () => {
    expect(degradationLevels.size).toBe(0);
  });

  test("429 response increases degradation by 10%", async () => {
    await healthCheckProvider("openverse", {
      fetcher: stubFetcher(() => makeResponse(429)),
    });
    expect(getDegradationMultiplier("openverse")).toBeCloseTo(0.90, 5);
  });

  test("503 response increases degradation by 10%", async () => {
    await healthCheckProvider("itunes", {
      fetcher: stubFetcher(() => makeResponse(503)),
    });
    expect(getDegradationMultiplier("itunes")).toBeCloseTo(0.90, 5);
  });

  test("multiple 429s stack degradation up to 50% cap", async () => {
    for (let i = 0; i < 10; i++) {
      await healthCheckProvider("flickr", {
        fetcher: stubFetcher(() => makeResponse(429)),
        noCache: true,
      } as any);
      // reset circuit between calls to avoid open state
      _resetCircuitBreakers();
    }
    // Should cap at 50% reduction → multiplier 0.50
    expect(getDegradationMultiplier("flickr")).toBeCloseTo(0.50, 5);
  });

  test("200 response does not change degradation level", async () => {
    await healthCheckProvider("wikimedia", {
      fetcher: stubFetcher(() => makeResponse(200)),
    });
    expect(getDegradationMultiplier("wikimedia")).toBe(1.0);
  });

  test("degradeBucketCapacity is a no-op for non-429/503 codes", () => {
    degradeBucketCapacity("nasa", 200);
    degradeBucketCapacity("nasa", 404);
    expect(getDegradationMultiplier("nasa")).toBe(1.0);
  });

  test("degradeBucketCapacity directly triggers degradation for 429", () => {
    degradeBucketCapacity("smithsonian", 429);
    expect(getDegradationMultiplier("smithsonian")).toBeCloseTo(0.90, 5);
  });

  test("degradeBucketCapacity directly triggers degradation for 503", () => {
    degradeBucketCapacity("met-museum", 503);
    expect(getDegradationMultiplier("met-museum")).toBeCloseTo(0.90, 5);
  });
});

// ---------------------------------------------------------------------------
// 8. Caching — getProviderHealthStatus
// ---------------------------------------------------------------------------

describe("getProviderHealthStatus caching", () => {
  test("returns cached result on second call without network", async () => {
    let callCount = 0;
    const fetcher = stubFetcher(() => {
      callCount++;
      return makeResponse(200);
    });

    await healthCheckProvider("wikimedia", { fetcher });
    expect(callCount).toBe(1);

    // getProviderHealthStatus should return the cache hit
    const cached = await getProviderHealthStatus("wikimedia", { fetcher });
    expect(callCount).toBe(1); // no new network call
    expect(cached.status).toBe("up");
  });

  test("getProviderHealthStatus runs a live check when cache is empty", async () => {
    let callCount = 0;
    const fetcher = stubFetcher(() => {
      callCount++;
      return makeResponse(200);
    });

    const result = await getProviderHealthStatus("openverse", { fetcher });
    expect(callCount).toBe(1);
    expect(result.status).toBe("up");
  });

  test("cache is cleared by _resetHealthCache", async () => {
    let callCount = 0;
    const fetcher = stubFetcher(() => {
      callCount++;
      return makeResponse(200);
    });

    await healthCheckProvider("wikimedia", { fetcher });
    _resetHealthCache();
    await getProviderHealthStatus("wikimedia", { fetcher });
    expect(callCount).toBe(2); // second call was a fresh check
  });
});

// ---------------------------------------------------------------------------
// 9. checkAllProviders fan-out
// ---------------------------------------------------------------------------

describe("checkAllProviders", () => {
  test("returns one result per requested provider", async () => {
    const fetcher = stubFetcher(() => makeResponse(200));
    const results = await checkAllProviders(["wikimedia", "openverse", "itunes"], { fetcher });
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.provider).sort()).toEqual(["itunes", "openverse", "wikimedia"]);
  });

  test("all results have the correct shape", async () => {
    const fetcher = stubFetcher(() => makeResponse(200));
    const results = await checkAllProviders(["nasa", "met-museum"], { fetcher });
    for (const r of results) {
      expect(typeof r.provider).toBe("string");
      expect(typeof r.endpoint).toBe("string");
      expect(["up", "degraded", "down"]).toContain(r.status);
      expect(typeof r.lastCheck).toBe("number");
      expect(typeof r.metrics.httpLatencyMs).toBe("number");
    }
  });

  test("individual failures do not prevent other providers from being checked", async () => {
    let callCount = 0;
    const fetcher = stubFetcher((url) => {
      callCount++;
      if (url.includes("openverse")) throw new Error("network failure");
      return makeResponse(200);
    });
    const results = await checkAllProviders(["wikimedia", "openverse", "itunes"], { fetcher });
    expect(callCount).toBe(3);
    const openResult = results.find((r) => r.provider === "openverse")!;
    const wikiResult = results.find((r) => r.provider === "wikimedia")!;
    expect(openResult.status).toBe("down");
    expect(wikiResult.status).toBe("up");
  });
});

// ---------------------------------------------------------------------------
// 10. Pre-flight integration with searchImages()
// ---------------------------------------------------------------------------

describe("searchImages healthCheck pre-flight", () => {
  test("healthCheck:true skips providers whose endpoints are down", async () => {
    const fetcher = stubFetcher((url) => {
      // Wikimedia endpoint returns down, openverse is up
      if (url.includes("commons.wikimedia.org")) return makeResponse(500);
      if (url.includes("api.openverse.org") && url.includes("images")) {
        return new Response(
          JSON.stringify({ results: [{ id: "1", url: "https://example.com/img.jpg", license: "cc0", creator: "test", title: "test" }], count: 1, next: null }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return makeResponse(200, { body: '{"results":[]}' });
    });

    // Force 3 failures on wikimedia to open circuit
    for (let i = 0; i < 3; i++) {
      await healthCheckProvider("wikimedia", { fetcher });
    }
    _resetHealthCache(); // clear so pre-flight re-checks

    const result = await searchImages("test", {
      providers: ["wikimedia", "openverse"],
      healthCheck: true,
      fetcher,
    });

    // wikimedia was down → should appear as skipped
    const wikiReport = result.providerReports.find((r) => r.provider === "wikimedia");
    expect(wikiReport).toBeDefined();
    expect(wikiReport?.ok).toBe(false);
  });

  test("healthCheck:false does not run pre-flight checks", async () => {
    let healthCheckCalled = false;
    const fetcher = stubFetcher((url) => {
      if (url.includes("commons.wikimedia.org")) {
        // Only flag if this is the health-check URL (has action=query&format=json&list=search)
        if (url.includes("list=search")) healthCheckCalled = true;
        return new Response(JSON.stringify({ query: { pages: {} } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return makeResponse(200, { body: '{}' });
    });

    await searchImages("test", {
      providers: ["wikimedia"],
      healthCheck: false,
      fetcher,
    });

    // With healthCheck:false, no pre-flight health endpoint ping should have occurred
    expect(healthCheckCalled).toBe(false);
  });

  test("dryRun with healthCheck includes skipped reports", async () => {
    const fetcher = stubFetcher(() => makeResponse(500));

    // Open circuit on wikimedia
    for (let i = 0; i < 3; i++) {
      await healthCheckProvider("wikimedia", { fetcher });
    }
    _resetHealthCache();

    const result = await searchImages("dry run health check", {
      providers: ["wikimedia", "openverse"],
      healthCheck: true,
      dryRun: true,
      fetcher,
    });

    expect(result.candidates).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("dryRun"))).toBe(true);
    // Should still have provider reports
    expect(result.providerReports.length).toBeGreaterThan(0);
  });
});
