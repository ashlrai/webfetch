/**
 * Tests for the Federation Diagnostic Repair Engine.
 *
 * Coverage:
 *  - Unit: detectPatterns — all-timeout, all-unknown-license, auth-missing,
 *    low-confidence, no-results, all-failed, partial-failure, rate-limited,
 *    no-browser-provider
 *  - Unit: generateRecommendations — action types, ranking, deduplication
 *  - Unit: getFederationRepairPlan — healthy flag, generatedAt, patterns
 *  - Integration: searchImages + repair plan via opts.repairPlan
 *  - Edge cases: no repairs possible (healthy), single-provider success
 */

import { beforeEach, describe, expect, test } from "bun:test";

import {
  detectPatterns,
  generateRecommendations,
  getFederationRepairPlan,
} from "../packages/core/src/federation-repair.ts";
import type { FederationContext } from "../packages/core/src/federation-repair.ts";
import { searchImages } from "../packages/core/src/federation.ts";
import { _resetTelemetry } from "../packages/core/src/federation-telemetry.ts";
import { _resetBuckets } from "../packages/core/src/rate-limit.ts";
import type { ImageCandidate, ProviderReport } from "../packages/core/src/types.ts";
import { fixture, jsonResponse, stubFetcher } from "./stub-fetcher.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReport(
  provider: string,
  overrides: Partial<ProviderReport> = {},
): ProviderReport {
  return {
    provider: provider as any,
    ok: true,
    count: 5,
    timeMs: 200,
    errorKind: "ok",
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    url: "https://example.com/img.jpg",
    source: "wikimedia",
    license: "CC_BY",
    confidence: 0.9,
    ...overrides,
  };
}

function ctx(overrides: Partial<FederationContext> = {}): FederationContext {
  return {
    reports: [],
    candidates: [],
    licensePolicy: "safe-only",
    timeoutMs: 15_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit: detectPatterns
// ---------------------------------------------------------------------------

describe("detectPatterns", () => {
  test("empty reports → empty pattern set", () => {
    const patterns = detectPatterns(ctx());
    expect(patterns.size).toBe(0);
  });

  test("all providers timed out → all-timeout + all-failed", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [
          makeReport("wikimedia", { ok: false, count: 0, errorKind: "timeout" }),
          makeReport("openverse", { ok: false, count: 0, errorKind: "timeout" }),
        ],
        candidates: [],
      }),
    );
    expect(patterns.has("all-timeout")).toBe(true);
    expect(patterns.has("all-failed")).toBe(true);
  });

  test("mixed timeout + network error → only all-failed, not all-timeout", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [
          makeReport("wikimedia", { ok: false, count: 0, errorKind: "timeout" }),
          makeReport("openverse", { ok: false, count: 0, errorKind: "network" }),
        ],
        candidates: [],
      }),
    );
    expect(patterns.has("all-failed")).toBe(true);
    expect(patterns.has("all-timeout")).toBe(false);
  });

  test("all candidates have UNKNOWN license → all-unknown-license", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [makeReport("wikimedia", { ok: true, count: 2 })],
        candidates: [
          makeCandidate({ license: "UNKNOWN", confidence: 0.3 }),
          makeCandidate({ license: "UNKNOWN", confidence: 0.3 }),
        ],
      }),
    );
    expect(patterns.has("all-unknown-license")).toBe(true);
  });

  test("mixed licenses → no all-unknown-license", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [makeReport("wikimedia", { ok: true, count: 2 })],
        candidates: [
          makeCandidate({ license: "CC0" }),
          makeCandidate({ license: "UNKNOWN" }),
        ],
      }),
    );
    expect(patterns.has("all-unknown-license")).toBe(false);
  });

  test("provider skipped due to missing-auth → auth-missing", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [
          makeReport("unsplash", {
            ok: false,
            count: 0,
            skipped: "missing-auth",
            errorKind: "network",
          }),
        ],
        candidates: [],
      }),
    );
    expect(patterns.has("auth-missing")).toBe(true);
  });

  test("provider skipped:disabled is not auth-missing", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [
          makeReport("serpapi", {
            ok: false,
            count: 0,
            skipped: "disabled",
            errorKind: "network",
          }),
        ],
        candidates: [],
      }),
    );
    expect(patterns.has("auth-missing")).toBe(false);
  });

  test("more than 50% candidates with confidence < 0.5 → low-confidence", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [makeReport("wikimedia", { ok: true, count: 3 })],
        candidates: [
          makeCandidate({ confidence: 0.2 }),
          makeCandidate({ confidence: 0.3 }),
          makeCandidate({ confidence: 0.9 }),
        ],
      }),
    );
    expect(patterns.has("low-confidence")).toBe(true);
  });

  test("minority of low-confidence candidates → no low-confidence pattern", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [makeReport("wikimedia", { ok: true, count: 3 })],
        candidates: [
          makeCandidate({ confidence: 0.9 }),
          makeCandidate({ confidence: 0.85 }),
          makeCandidate({ confidence: 0.1 }),
        ],
      }),
    );
    expect(patterns.has("low-confidence")).toBe(false);
  });

  test("provider succeeded but zero candidates → no-results", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [makeReport("wikimedia", { ok: true, count: 0 })],
        candidates: [],
      }),
    );
    expect(patterns.has("no-results")).toBe(true);
  });

  test("rate-limited provider → rate-limited pattern", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [
          makeReport("openverse", { ok: false, count: 0, errorKind: "rate-limited" }),
        ],
        candidates: [],
      }),
    );
    expect(patterns.has("rate-limited")).toBe(true);
  });

  test("rate-limited via skipped field → rate-limited pattern", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [
          makeReport("openverse", {
            ok: false,
            count: 0,
            skipped: "rate-limited",
            errorKind: "network",
          }),
        ],
        candidates: [],
      }),
    );
    expect(patterns.has("rate-limited")).toBe(true);
  });

  test("no-results + no browser provider → no-browser-provider", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [makeReport("wikimedia", { ok: true, count: 0 })],
        candidates: [],
        requestedProviders: ["wikimedia"],
      }),
    );
    expect(patterns.has("no-results")).toBe(true);
    expect(patterns.has("no-browser-provider")).toBe(true);
  });

  test("browser already requested → no no-browser-provider", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [
          makeReport("wikimedia", { ok: true, count: 0 }),
          makeReport("browser", { ok: true, count: 0 }),
        ],
        candidates: [],
        requestedProviders: ["wikimedia", "browser"],
      }),
    );
    expect(patterns.has("no-browser-provider")).toBe(false);
  });

  test("some providers succeed, some fail → partial-failure (not all-failed)", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [
          makeReport("wikimedia", { ok: true, count: 3 }),
          makeReport("openverse", { ok: false, count: 0, errorKind: "network" }),
        ],
        candidates: [makeCandidate()],
      }),
    );
    expect(patterns.has("partial-failure")).toBe(true);
    expect(patterns.has("all-failed")).toBe(false);
  });

  test("single provider succeeds with results → no patterns", () => {
    const patterns = detectPatterns(
      ctx({
        reports: [makeReport("wikimedia", { ok: true, count: 5 })],
        candidates: [makeCandidate(), makeCandidate(), makeCandidate()],
      }),
    );
    expect(patterns.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Unit: generateRecommendations + ranking
// ---------------------------------------------------------------------------

describe("generateRecommendations", () => {
  test("all-timeout → increase-timeout is highest ranked recommendation", () => {
    const patterns = new Set<any>(["all-timeout", "all-failed"]);
    const recs = generateRecommendations(patterns, ctx({ timeoutMs: 15_000 }));
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.action).toBe("increase-timeout");
    expect(recs[0]!.parameters.suggestedTimeoutMs).toBe(30_000);
  });

  test("increase-timeout doubles current timeout (capped at 60s)", () => {
    const patterns = new Set<any>(["all-timeout", "all-failed"]);
    const recs = generateRecommendations(patterns, ctx({ timeoutMs: 40_000 }));
    const r = recs.find((r) => r.action === "increase-timeout");
    expect(r).toBeDefined();
    expect(r!.parameters.suggestedTimeoutMs).toBe(60_000); // capped
  });

  test("auth-missing → set-auth is highest priority recommendation", () => {
    const patterns = new Set<any>(["auth-missing"]);
    const recs = generateRecommendations(
      patterns,
      ctx({
        reports: [
          makeReport("unsplash", { ok: false, count: 0, skipped: "missing-auth", errorKind: "network" }),
        ],
      }),
    );
    expect(recs[0]!.action).toBe("set-auth");
    expect((recs[0]!.parameters.providers as string[]).includes("unsplash")).toBe(true);
    const envVars = recs[0]!.parameters.envVars as string[];
    expect(envVars).toContain("UNSPLASH_ACCESS_KEY");
  });

  test("no-results → add-provider recommended (open providers)", () => {
    const patterns = new Set<any>(["no-results"]);
    const recs = generateRecommendations(
      patterns,
      ctx({
        reports: [makeReport("pexels", { ok: true, count: 0 })],
        requestedProviders: ["pexels"],
      }),
    );
    const addProv = recs.find((r) => r.action === "add-provider");
    expect(addProv).toBeDefined();
    const providers = addProv!.parameters.providers as string[];
    expect(providers.length).toBeGreaterThan(0);
    // Should not include the already-requested provider
    expect(providers).not.toContain("pexels");
  });

  test("all-unknown-license → relax-policy recommended", () => {
    const patterns = new Set<any>(["all-unknown-license"]);
    const recs = generateRecommendations(patterns, ctx({ licensePolicy: "safe-only" }));
    const relaxRec = recs.find((r) => r.action === "relax-policy");
    expect(relaxRec).toBeDefined();
    expect(relaxRec!.parameters.suggestedPolicy).toBe("prefer-safe");
  });

  test("relax-policy steps up from safe-only to prefer-safe", () => {
    const patterns = new Set<any>(["no-results"]);
    const recs = generateRecommendations(patterns, ctx({ licensePolicy: "safe-only" }));
    const relaxRec = recs.find((r) => r.action === "relax-policy");
    expect(relaxRec).toBeDefined();
    expect(relaxRec!.parameters.suggestedPolicy).toBe("prefer-safe");
  });

  test("relax-policy at 'any' → no relax-policy recommendation", () => {
    const patterns = new Set<any>(["all-unknown-license"]);
    const recs = generateRecommendations(patterns, ctx({ licensePolicy: "any" }));
    const relaxRec = recs.find((r) => r.action === "relax-policy");
    expect(relaxRec).toBeUndefined();
  });

  test("no-browser-provider → enable-browser recommendation", () => {
    const patterns = new Set<any>(["no-browser-provider", "no-results"]);
    const recs = generateRecommendations(patterns, ctx());
    const browserRec = recs.find((r) => r.action === "enable-browser");
    expect(browserRec).toBeDefined();
  });

  test("rate-limited → retry recommendation", () => {
    const patterns = new Set<any>(["rate-limited"]);
    const recs = generateRecommendations(patterns, ctx());
    const retryRec = recs.find((r) => r.action === "retry");
    expect(retryRec).toBeDefined();
    expect(retryRec!.estimatedImpact).toBeGreaterThan(0);
  });

  test("recommendations are sorted by estimatedImpact descending", () => {
    // Trigger multiple patterns
    const patterns = new Set<any>(["auth-missing", "all-timeout", "no-results"]);
    const recs = generateRecommendations(
      patterns,
      ctx({
        reports: [
          makeReport("unsplash", { ok: false, count: 0, skipped: "missing-auth", errorKind: "network" }),
        ],
        timeoutMs: 10_000,
        requestedProviders: ["unsplash"],
      }),
    );
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1]!.estimatedImpact).toBeGreaterThanOrEqual(recs[i]!.estimatedImpact);
    }
  });

  test("each action appears at most once (deduplication)", () => {
    // Trigger patterns that could both emit relax-policy
    const patterns = new Set<any>(["no-results", "all-unknown-license", "low-confidence"]);
    const recs = generateRecommendations(patterns, ctx({ licensePolicy: "safe-only" }));
    const actions = recs.map((r) => r.action);
    const uniqueActions = new Set(actions);
    expect(actions.length).toBe(uniqueActions.size);
  });

  test("empty pattern set → empty recommendations", () => {
    const recs = generateRecommendations(new Set(), ctx());
    expect(recs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unit: getFederationRepairPlan
// ---------------------------------------------------------------------------

describe("getFederationRepairPlan", () => {
  test("healthy plan: no failures, results present", () => {
    const plan = getFederationRepairPlan(
      ctx({
        reports: [makeReport("wikimedia", { ok: true, count: 5 })],
        candidates: [makeCandidate(), makeCandidate()],
      }),
    );
    expect(plan.healthy).toBe(true);
    expect(plan.recommendations).toEqual([]);
    expect(plan.detectedPatterns).toEqual([]);
    expect(typeof plan.generatedAt).toBe("string");
  });

  test("plan includes generatedAt as ISO-8601 string", () => {
    const before = new Date().toISOString();
    const plan = getFederationRepairPlan(ctx());
    const after = new Date().toISOString();
    expect(plan.generatedAt >= before).toBe(true);
    expect(plan.generatedAt <= after).toBe(true);
  });

  test("all-timeout plan has detectedPatterns and recommendations", () => {
    const plan = getFederationRepairPlan(
      ctx({
        reports: [
          makeReport("wikimedia", { ok: false, count: 0, errorKind: "timeout" }),
          makeReport("openverse", { ok: false, count: 0, errorKind: "timeout" }),
        ],
        candidates: [],
        timeoutMs: 5_000,
      }),
    );
    expect(plan.healthy).toBe(false);
    expect(plan.detectedPatterns).toContain("all-timeout");
    expect(plan.recommendations.length).toBeGreaterThan(0);
    const top = plan.recommendations[0]!;
    expect(top.action).toBe("increase-timeout");
    expect(top.parameters.suggestedTimeoutMs).toBe(10_000);
  });

  test("mixed pattern: auth-missing + no-results both produce recommendations", () => {
    const plan = getFederationRepairPlan(
      ctx({
        reports: [
          makeReport("unsplash", { ok: false, count: 0, skipped: "missing-auth", errorKind: "network" }),
          makeReport("wikimedia", { ok: true, count: 0 }),
        ],
        candidates: [],
        requestedProviders: ["unsplash", "wikimedia"],
      }),
    );
    expect(plan.healthy).toBe(false);
    expect(plan.detectedPatterns).toContain("auth-missing");
    expect(plan.detectedPatterns).toContain("no-results");
    const actions = plan.recommendations.map((r) => r.action);
    expect(actions).toContain("set-auth");
  });

  test("no repairs possible scenario: single-provider success", () => {
    const plan = getFederationRepairPlan(
      ctx({
        reports: [makeReport("nasa", { ok: true, count: 3 })],
        candidates: [makeCandidate(), makeCandidate(), makeCandidate()],
      }),
    );
    expect(plan.healthy).toBe(true);
    expect(plan.recommendations.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: searchImages + repair plan via opts.repairPlan
// ---------------------------------------------------------------------------

describe("searchImages integration with repairPlan", () => {
  beforeEach(() => {
    _resetTelemetry();
    _resetBuckets();
  });

  test("opts.repairPlan=false → no repairPlan on bundle", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);

    const bundle = await searchImages("test query", {
      providers: ["wikimedia"],
      fetcher,
      repairPlan: false,
    });

    expect(bundle.repairPlan).toBeUndefined();
  });

  test("opts.repairPlan=true + success → repairPlan.healthy=true", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => jsonResponse(fixture("wikimedia.json")),
      },
    ]);

    const bundle = await searchImages("jazz festival", {
      providers: ["wikimedia"],
      fetcher,
      repairPlan: true,
    });

    expect(bundle.repairPlan).toBeDefined();
    // If wikimedia returned results the plan should be healthy
    if (bundle.candidates.length > 0) {
      expect(bundle.repairPlan!.healthy).toBe(true);
    }
    expect(typeof bundle.repairPlan!.generatedAt).toBe("string");
  });

  test("opts.repairPlan=true + all providers fail → plan has recommendations", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: async () => {
          throw new Error("HTTP 503 Service Unavailable");
        },
      },
      {
        match: (u) => u.includes("api.openverse.org"),
        handler: async () => {
          throw new Error("HTTP 503 Service Unavailable");
        },
      },
    ]);

    const bundle = await searchImages("broken query", {
      providers: ["wikimedia", "openverse"],
      fetcher,
      repairPlan: true,
    });

    expect(bundle.repairPlan).toBeDefined();
    expect(bundle.repairPlan!.healthy).toBe(false);
    expect(bundle.repairPlan!.recommendations.length).toBeGreaterThan(0);
    expect(bundle.repairPlan!.detectedPatterns).toContain("all-failed");
  });

  test("opts.repairPlan=true + timeout → increase-timeout recommendation", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("commons.wikimedia.org"),
        handler: (_url, init) =>
          new Promise<never>((_, reject) => {
            // Resolve as soon as the AbortSignal fires so the test stays fast
            const sig = (init as RequestInit | undefined)?.signal;
            if (sig?.aborted) {
              reject(new Error("The operation was aborted"));
              return;
            }
            sig?.addEventListener("abort", () =>
              reject(new Error("The operation was aborted")),
            );
          }),
      },
    ]);

    const bundle = await searchImages("timeout test", {
      providers: ["wikimedia"],
      fetcher,
      timeoutMs: 50, // very short timeout to force abort
      repairPlan: true,
    });

    expect(bundle.repairPlan).toBeDefined();
    expect(bundle.repairPlan!.detectedPatterns).toContain("all-timeout");
    const timeoutRec = bundle.repairPlan!.recommendations.find(
      (r) => r.action === "increase-timeout",
    );
    expect(timeoutRec).toBeDefined();
  }, 5_000);

  test("opts.repairPlan=true + missing-auth provider → set-auth recommendation", async () => {
    // unsplash requires auth and will be skipped when no auth provided
    const bundle = await searchImages("portrait", {
      providers: ["unsplash"],
      // no auth provided → provider skipped with missing-auth
      repairPlan: true,
    });

    expect(bundle.repairPlan).toBeDefined();
    // unsplash should be skipped → auth-missing pattern
    const missingAuth = bundle.providerReports.find(
      (r) => r.provider === "unsplash" && r.skipped === "missing-auth",
    );
    if (missingAuth) {
      expect(bundle.repairPlan!.detectedPatterns).toContain("auth-missing");
      const setAuthRec = bundle.repairPlan!.recommendations.find((r) => r.action === "set-auth");
      expect(setAuthRec).toBeDefined();
      expect((setAuthRec!.parameters.envVars as string[])).toContain("UNSPLASH_ACCESS_KEY");
    }
  });
});

// ---------------------------------------------------------------------------
// Edge: retry recommendation content
// ---------------------------------------------------------------------------

describe("recommendation content and examples", () => {
  test("retry rationale mentions rate-limit when triggered by rate-limited pattern", () => {
    const patterns = new Set<any>(["rate-limited"]);
    const recs = generateRecommendations(patterns, ctx());
    const retryRec = recs.find((r) => r.action === "retry");
    expect(retryRec!.rationale.toLowerCase()).toContain("rate-limit");
  });

  test("set-auth parameters include providers list and env vars", () => {
    const patterns = new Set<any>(["auth-missing"]);
    const recs = generateRecommendations(
      patterns,
      ctx({
        reports: [
          makeReport("pexels", { ok: false, count: 0, skipped: "missing-auth", errorKind: "network" }),
          makeReport("flickr", { ok: false, count: 0, skipped: "missing-auth", errorKind: "network" }),
        ],
      }),
    );
    const r = recs.find((r) => r.action === "set-auth")!;
    expect(r).toBeDefined();
    const providers = r.parameters.providers as string[];
    expect(providers).toContain("pexels");
    expect(providers).toContain("flickr");
    const envVars = r.parameters.envVars as string[];
    expect(envVars).toContain("PEXELS_API_KEY");
    expect(envVars).toContain("FLICKR_API_KEY");
  });

  test("add-provider does not suggest already-requested providers", () => {
    const alreadyRequested = [
      "wikimedia",
      "openverse",
      "nasa",
      "met-museum",
      "library-of-congress",
      "internet-archive",
    ] as any[];

    const patterns = new Set<any>(["no-results"]);
    const recs = generateRecommendations(
      patterns,
      ctx({
        reports: alreadyRequested.map((p) => makeReport(p, { ok: true, count: 0 })),
        requestedProviders: alreadyRequested,
      }),
    );
    const addProv = recs.find((r) => r.action === "add-provider");
    if (addProv) {
      const suggested = addProv.parameters.providers as string[];
      for (const p of suggested) {
        expect(alreadyRequested).not.toContain(p);
      }
    }
  });

  test("estimatedImpact is between 0 and 1 for all recommendations", () => {
    const patterns = new Set<any>([
      "all-timeout",
      "auth-missing",
      "no-results",
      "rate-limited",
      "all-unknown-license",
      "no-browser-provider",
      "low-confidence",
    ]);
    const recs = generateRecommendations(
      patterns,
      ctx({
        reports: [
          makeReport("unsplash", { ok: false, count: 0, skipped: "missing-auth", errorKind: "network" }),
          makeReport("wikimedia", { ok: false, count: 0, errorKind: "timeout" }),
        ],
        requestedProviders: ["unsplash", "wikimedia"],
        candidates: [
          makeCandidate({ license: "UNKNOWN", confidence: 0.1 }),
          makeCandidate({ license: "UNKNOWN", confidence: 0.2 }),
          makeCandidate({ license: "CC0", confidence: 0.9 }),
        ],
        timeoutMs: 10_000,
      }),
    );
    for (const r of recs) {
      expect(r.estimatedImpact).toBeGreaterThanOrEqual(0);
      expect(r.estimatedImpact).toBeLessThanOrEqual(1);
    }
  });
});
