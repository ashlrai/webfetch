import { describe, expect, test } from "bun:test";
import { searchImages } from "../packages/core/src/federation.ts";
import { fixture, jsonResponse, stubFetcher } from "./stub-fetcher.ts";

describe("federation", () => {
  test("dryRun reports providers without network", async () => {
    const out = await searchImages("drake", {
      providers: ["wikimedia", "openverse"],
      dryRun: true,
    });
    expect(out.candidates.length).toBe(0);
    expect(out.providerReports.map((r) => r.provider).sort()).toEqual(["openverse", "wikimedia"]);
    expect(out.warnings.some((w) => w.includes("dryRun"))).toBe(true);
  });

  test("merges wikimedia + openverse + itunes + musicbrainz, dedupes, ranks", async () => {
    const mb = fixture("musicbrainz.json");
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: async () => jsonResponse(fixture("openverse.json")),
      },
      {
        match: (u) => u.includes("itunes.apple.com"),
        handler: async () => jsonResponse(fixture("itunes.json")),
      },
      { match: (u) => u.includes("musicbrainz.org"), handler: async () => jsonResponse(mb) },
    ]);
    const out = await searchImages("Drake", {
      providers: ["wikimedia", "openverse", "itunes", "musicbrainz-caa"],
      fetcher,
      licensePolicy: "safe-only",
    });
    expect(out.candidates.length).toBeGreaterThan(0);
    // CC BY-SA 4.0 from wikimedia should rank above editorial iTunes
    const first = out.candidates[0]!;
    expect(["wikimedia", "openverse"]).toContain(first.source);
    expect(first.attributionLine).toBeTruthy();
    // All reports present
    expect(out.providerReports.filter((r) => r.ok).length).toBe(4);
  });

  test("failing provider does not fail federation", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
      {
        match: (u) => u.includes("openverse"),
        handler: async () => new Response("boom", { status: 500 }),
      },
    ]);
    const out = await searchImages("x", { providers: ["wikimedia", "openverse"], fetcher });
    expect(out.candidates.length).toBeGreaterThan(0);
    const failed = out.providerReports.find((r) => r.provider === "openverse");
    expect(failed?.ok).toBe(false);
  });

  test("errorKind=ok on successful provider", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);
    const out = await searchImages("test", { providers: ["wikimedia"], fetcher });
    const report = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(report?.ok).toBe(true);
    expect(report?.errorKind).toBe("ok");
  });

  test("errorKind=timeout when provider aborts due to timeout", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async (_url, init) =>
          new Promise((_resolve, reject) => {
            // Simulate an async operation that respects the abort signal
            const signal = init?.signal as AbortSignal | undefined;
            if (signal?.aborted) {
              reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
              return;
            }
            signal?.addEventListener("abort", () => {
              reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }));
            });
          }),
      },
    ]);
    const out = await searchImages("test", {
      providers: ["wikimedia"],
      fetcher,
      timeoutMs: 10, // very short — will fire before the never-resolving promise
    });
    const report = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(report?.ok).toBe(false);
    expect(report?.errorKind).toBe("timeout");
  });

  test("errorKind=http-4xx for 404 response", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => {
          throw Object.assign(new Error("HTTP 404 Not Found"), { status: 404 });
        },
      },
    ]);
    const out = await searchImages("test", { providers: ["wikimedia"], fetcher });
    const report = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(report?.ok).toBe(false);
    expect(report?.errorKind).toBe("http-4xx");
    expect(report?.errorContext?.httpStatus).toBe(404);
  });

  test("errorKind=http-5xx for 500 response thrown as error", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => {
          throw Object.assign(new Error("HTTP 500 Internal Server Error"), { status: 500 });
        },
      },
    ]);
    const out = await searchImages("test", { providers: ["wikimedia"], fetcher });
    const report = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(report?.ok).toBe(false);
    expect(report?.errorKind).toBe("http-5xx");
    expect(report?.errorContext?.httpStatus).toBe(500);
  });

  test("errorKind=rate-limited for 429 response", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => {
          throw Object.assign(new Error("HTTP 429 Too Many Requests"), { status: 429 });
        },
      },
    ]);
    const out = await searchImages("test", { providers: ["wikimedia"], fetcher });
    const report = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(report?.ok).toBe(false);
    expect(report?.errorKind).toBe("rate-limited");
  });

  test("errorKind=network for generic fetch failure", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => {
          throw new Error("fetch failed: ECONNREFUSED");
        },
      },
    ]);
    const out = await searchImages("test", { providers: ["wikimedia"], fetcher });
    const report = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(report?.ok).toBe(false);
    expect(report?.errorKind).toBe("network");
  });

  test("errorKind=decode for JSON parse failure", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => {
          throw new Error("Unexpected token < in JSON at position 0");
        },
      },
    ]);
    const out = await searchImages("test", { providers: ["wikimedia"], fetcher });
    const report = out.providerReports.find((r) => r.provider === "wikimedia");
    expect(report?.ok).toBe(false);
    expect(report?.errorKind).toBe("decode");
  });
});
