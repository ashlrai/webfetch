/**
 * Tests for Provider Fallback Strategy & Auto-Degradation Router.
 *
 * Covers:
 *  1. Basic chain building — primary vs fallback split
 *  2. Timeout cascade — 2+ timeouts → fallback, 1 timeout → soft penalty
 *  3. UNKNOWN-license rate spikes → fallback
 *  4. Auth-missing → fallback
 *  5. Low composite score → fallback
 *  6. Recovery after 5 consecutive successes
 *  7. Cold-start providers get primary placement
 *  8. providerDegradationRouting convenience wrapper
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  _resetDegradationState,
  _sessionTimeouts,
  _sessionSuccesses,
  providerDegradationRouting,
  recordProviderSuccess,
  recordProviderTimeout,
  selectProviderChain,
} from "../packages/core/src/provider-degradation.ts";
import type { ProviderChain } from "../packages/core/src/provider-degradation.ts";
import {
  _resetScorecard,
  recordScorecardEvent,
} from "../packages/core/src/provider-scorecard.ts";
import type { ProviderScore } from "../packages/core/src/provider-scorecard.ts";
import type { ImageCandidate, ProviderId } from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    url: `https://example.com/${Math.random()}.jpg`,
    source: "wikimedia",
    license: "CC0",
    confidence: 1.0,
    width: 800,
    height: 600,
    ...overrides,
  };
}

function makeResults(n: number, overrides: Partial<ImageCandidate> = {}): ImageCandidate[] {
  return Array.from({ length: n }, () => makeCandidate(overrides));
}

/** Build a synthetic ProviderScore with defaults. */
function makeScore(
  provider: ProviderId,
  overrides: Partial<ProviderScore> = {},
): ProviderScore {
  return {
    provider,
    sampleCount: 10,
    successRate: 0.9,
    avgConfidence: 0.85,
    avgUnknownFraction: 0.05,
    avgCacheHitFraction: 0.1,
    medianResolution: 400000,
    p50Ms: 300,
    p95Ms: 800,
    p99Ms: 1200,
    avgLicenseDiversity: 0.5,
    compositeScore: 0.75,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset before/after each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  _resetDegradationState();
  _resetScorecard();
});

afterEach(() => {
  _resetDegradationState();
  _resetScorecard();
});

// ---------------------------------------------------------------------------
// 1. Basic chain building
// ---------------------------------------------------------------------------

describe("selectProviderChain — basic chain building", () => {
  test("all healthy providers end up in primary with no fallback", () => {
    const providers: ProviderId[] = ["wikimedia", "openverse", "pexels"];
    const scores = providers.map((id) => makeScore(id));
    const chain = selectProviderChain(providers, scores);

    expect(chain.primary).toHaveLength(3);
    expect(chain.fallback).toHaveLength(0);
    expect(chain.diagnostics.skippedProviders).toHaveLength(0);
    for (const p of providers) {
      expect(chain.primary).toContain(p);
    }
  });

  test("empty providers list returns empty chain", () => {
    const chain = selectProviderChain([], []);
    expect(chain.primary).toHaveLength(0);
    expect(chain.fallback).toHaveLength(0);
    expect(chain.diagnostics.skippedProviders).toHaveLength(0);
  });

  test("primary is ordered highest composite score first", () => {
    const providers: ProviderId[] = ["pexels", "wikimedia", "openverse"];
    const scores = [
      makeScore("pexels", { compositeScore: 0.4 }),
      makeScore("wikimedia", { compositeScore: 0.9 }),
      makeScore("openverse", { compositeScore: 0.65 }),
    ];
    const chain = selectProviderChain(providers, scores);

    expect(chain.primary[0]).toBe("wikimedia");
    expect(chain.primary[1]).toBe("openverse");
    expect(chain.primary[2]).toBe("pexels");
  });

  test("single provider always in primary when healthy", () => {
    const chain = selectProviderChain(
      ["wikimedia"],
      [makeScore("wikimedia")],
    );
    expect(chain.primary).toEqual(["wikimedia"]);
    expect(chain.fallback).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Timeout cascades
// ---------------------------------------------------------------------------

describe("timeout cascade — session timeout history", () => {
  test("1 session timeout → provider stays in primary but with soft score penalty", () => {
    recordProviderTimeout("openverse");
    expect(_sessionTimeouts.get("openverse")).toBe(1);

    const chain = selectProviderChain(
      ["wikimedia", "openverse"],
      [
        makeScore("wikimedia", { compositeScore: 0.8 }),
        makeScore("openverse", { compositeScore: 0.8 }),
      ],
    );

    // Both still in primary (only 1 timeout, below demotion threshold of 2)
    expect(chain.primary).toContain("openverse");
    expect(chain.fallback).not.toContain("openverse");
    // wikimedia should rank ahead due to no timeout penalty
    expect(chain.primary[0]).toBe("wikimedia");
  });

  test("2 session timeouts → provider demoted to fallback", () => {
    recordProviderTimeout("openverse");
    recordProviderTimeout("openverse");

    const chain = selectProviderChain(
      ["wikimedia", "openverse"],
      [
        makeScore("wikimedia", { compositeScore: 0.8 }),
        makeScore("openverse", { compositeScore: 0.8 }),
      ],
    );

    expect(chain.primary).not.toContain("openverse");
    expect(chain.fallback).toContain("openverse");
    const diag = chain.diagnostics.skippedProviders.find((s) => s.id === "openverse");
    expect(diag).toBeDefined();
    expect(diag!.reason).toBe("timeout");
    expect(diag!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  test("3+ timeouts → high confidence demotion", () => {
    recordProviderTimeout("bing");
    recordProviderTimeout("bing");
    recordProviderTimeout("bing");

    const chain = selectProviderChain(
      ["wikimedia", "bing"],
      [makeScore("wikimedia"), makeScore("bing")],
    );

    const diag = chain.diagnostics.skippedProviders.find((s) => s.id === "bing");
    expect(diag!.confidence).toBeGreaterThan(0.8);
  });

  test("timeout cascade: all providers timed out → all in fallback", () => {
    const providers: ProviderId[] = ["wikimedia", "openverse", "pexels"];
    for (const p of providers) {
      recordProviderTimeout(p);
      recordProviderTimeout(p);
    }

    const chain = selectProviderChain(
      providers,
      providers.map((id) => makeScore(id)),
    );

    expect(chain.primary).toHaveLength(0);
    expect(chain.fallback).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 3. UNKNOWN-license rate spikes
// ---------------------------------------------------------------------------

describe("UNKNOWN-license rate spikes", () => {
  test("high UNKNOWN fraction (≥0.6) → demoted to fallback", () => {
    const chain = selectProviderChain(
      ["brave", "wikimedia"],
      [
        makeScore("brave", { avgUnknownFraction: 0.75, compositeScore: 0.5 }),
        makeScore("wikimedia", { avgUnknownFraction: 0.02, compositeScore: 0.8 }),
      ],
    );

    expect(chain.fallback).toContain("brave");
    expect(chain.primary).toContain("wikimedia");
    const diag = chain.diagnostics.skippedProviders.find((s) => s.id === "brave");
    expect(diag!.reason).toBe("unknown-rate");
    expect(diag!.confidence).toBeCloseTo(0.75, 2);
  });

  test("borderline UNKNOWN fraction (0.59) → stays in primary", () => {
    const chain = selectProviderChain(
      ["brave"],
      [makeScore("brave", { avgUnknownFraction: 0.59, compositeScore: 0.4 })],
    );
    // 0.59 < 0.6 threshold — not demoted for unknown-rate (may still be demoted for low-score)
    // compositeScore 0.4 > LOW_SCORE_THRESHOLD 0.25 so stays primary
    expect(chain.primary).toContain("brave");
  });

  test("UNKNOWN rate spike via real scorecard events", () => {
    // Record many events with all-UNKNOWN results
    for (let i = 0; i < 10; i++) {
      recordScorecardEvent(
        "brave",
        true,
        200,
        makeResults(5, { license: "UNKNOWN" }),
      );
    }

    // providerDegradationRouting fetches real scorecard
    const chain = providerDegradationRouting(["brave", "wikimedia"]);

    expect(chain.fallback).toContain("brave");
    const diag = chain.diagnostics.skippedProviders.find((s) => s.id === "brave");
    expect(diag!.reason).toBe("unknown-rate");
  });
});

// ---------------------------------------------------------------------------
// 4. Auth failures
// ---------------------------------------------------------------------------

describe("auth failures", () => {
  test("provider in missingAuthIds → fallback with auth-missing reason", () => {
    const chain = selectProviderChain(
      ["unsplash", "wikimedia"],
      [makeScore("unsplash"), makeScore("wikimedia")],
      ["unsplash"],
    );

    expect(chain.fallback).toContain("unsplash");
    expect(chain.primary).not.toContain("unsplash");
    const diag = chain.diagnostics.skippedProviders.find((s) => s.id === "unsplash");
    expect(diag!.reason).toBe("auth-missing");
    expect(diag!.confidence).toBe(1.0);
  });

  test("multiple providers missing auth → all in fallback", () => {
    const providers: ProviderId[] = ["unsplash", "pexels", "wikimedia"];
    const chain = selectProviderChain(
      providers,
      providers.map((id) => makeScore(id)),
      ["unsplash", "pexels"],
    );

    expect(chain.fallback).toContain("unsplash");
    expect(chain.fallback).toContain("pexels");
    expect(chain.primary).toEqual(["wikimedia"]);
  });

  test("auth-missing takes precedence over other failure reasons", () => {
    // Provider also has timeouts — auth-missing should be the reported reason
    recordProviderTimeout("unsplash");
    recordProviderTimeout("unsplash");

    const chain = selectProviderChain(
      ["unsplash"],
      [makeScore("unsplash")],
      ["unsplash"],
    );

    const diag = chain.diagnostics.skippedProviders[0];
    expect(diag!.reason).toBe("auth-missing");
  });
});

// ---------------------------------------------------------------------------
// 5. Low composite score
// ---------------------------------------------------------------------------

describe("low composite score", () => {
  test("compositeScore < 0.25 → demoted to fallback with low-score reason", () => {
    const chain = selectProviderChain(
      ["serpapi", "wikimedia"],
      [
        makeScore("serpapi", { compositeScore: 0.1, sampleCount: 10 }),
        makeScore("wikimedia", { compositeScore: 0.8 }),
      ],
    );

    expect(chain.fallback).toContain("serpapi");
    const diag = chain.diagnostics.skippedProviders.find((s) => s.id === "serpapi");
    expect(diag!.reason).toBe("low-score");
    expect(diag!.confidence).toBeGreaterThan(0);
  });

  test("compositeScore exactly at threshold (0.25) → stays in primary", () => {
    const chain = selectProviderChain(
      ["openverse"],
      [makeScore("openverse", { compositeScore: 0.25, sampleCount: 5 })],
    );
    // 0.25 is NOT < 0.25, so should remain primary
    expect(chain.primary).toContain("openverse");
  });

  test("cold-start provider (sampleCount=0) → placed in primary regardless of score", () => {
    const chain = selectProviderChain(
      ["internet-archive"],
      [makeScore("internet-archive", { sampleCount: 0, compositeScore: 1.0 })],
    );
    expect(chain.primary).toContain("internet-archive");
    expect(chain.fallback).not.toContain("internet-archive");
  });
});

// ---------------------------------------------------------------------------
// 6. Recovery after successes
// ---------------------------------------------------------------------------

describe("decay/recovery — 5 successes reset timeout penalty", () => {
  test("5 consecutive successes reset the session timeout count", () => {
    recordProviderTimeout("openverse");
    recordProviderTimeout("openverse");
    expect(_sessionTimeouts.get("openverse")).toBe(2);

    // 5 successes trigger recovery
    for (let i = 0; i < 5; i++) {
      recordProviderSuccess("openverse");
    }

    expect(_sessionTimeouts.get("openverse")).toBe(0);
    expect(_sessionSuccesses.get("openverse")).toBe(0);

    // After recovery, provider should be in primary
    const chain = selectProviderChain(
      ["openverse", "wikimedia"],
      [makeScore("openverse"), makeScore("wikimedia")],
    );
    expect(chain.primary).toContain("openverse");
    expect(chain.fallback).not.toContain("openverse");
  });

  test("4 successes do NOT yet recover the provider", () => {
    recordProviderTimeout("pexels");
    recordProviderTimeout("pexels");

    for (let i = 0; i < 4; i++) {
      recordProviderSuccess("pexels");
    }

    // Still 2 timeouts recorded, not yet recovered
    expect(_sessionTimeouts.get("pexels")).toBe(2);

    const chain = selectProviderChain(
      ["pexels"],
      [makeScore("pexels")],
    );
    expect(chain.fallback).toContain("pexels");
  });

  test("timeout after partial recovery resets success counter", () => {
    recordProviderTimeout("flickr");
    for (let i = 0; i < 3; i++) {
      recordProviderSuccess("flickr");
    }
    expect(_sessionSuccesses.get("flickr")).toBe(3);

    // Another timeout resets success counter
    recordProviderTimeout("flickr");
    expect(_sessionSuccesses.get("flickr")).toBe(0);
    expect(_sessionTimeouts.get("flickr")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 7. Cold-start providers
// ---------------------------------------------------------------------------

describe("cold-start providers", () => {
  test("provider with no scorecard data placed in primary (optimistic)", () => {
    // No scores passed — empty array means cold-start
    const chain = selectProviderChain(["wikimedia", "openverse"], []);
    expect(chain.primary).toContain("wikimedia");
    expect(chain.primary).toContain("openverse");
    expect(chain.fallback).toHaveLength(0);
  });

  test("cold-start providers sorted stably by original order", () => {
    const providers: ProviderId[] = ["pexels", "pixabay", "unsplash"];
    const chain = selectProviderChain(providers, []);
    // All cold-start → same adjustedScore → original order preserved
    expect(chain.primary).toEqual(providers);
  });
});

// ---------------------------------------------------------------------------
// 8. providerDegradationRouting convenience wrapper
// ---------------------------------------------------------------------------

describe("providerDegradationRouting", () => {
  test("returns a valid ProviderChain with no scorecard data", () => {
    const chain = providerDegradationRouting(["wikimedia", "openverse"]);
    expect(Array.isArray(chain.primary)).toBe(true);
    expect(Array.isArray(chain.fallback)).toBe(true);
    expect(chain.diagnostics).toBeDefined();
    expect(chain.diagnostics.skippedProviders).toBeDefined();
  });

  test("uses real scorecard data — failing provider demoted", () => {
    // Build bad scorecard for serpapi
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("serpapi", false, 5000, []);
    }

    const chain = providerDegradationRouting(["wikimedia", "serpapi"]);
    // serpapi compositeScore should be near 0 → low-score demotion
    expect(chain.fallback).toContain("serpapi");
    expect(chain.primary).toContain("wikimedia");
  });

  test("missingAuthIds option flows through to chain", () => {
    const chain = providerDegradationRouting(["unsplash", "wikimedia"], {
      missingAuthIds: ["unsplash"],
    });
    expect(chain.fallback).toContain("unsplash");
    const diag = chain.diagnostics.skippedProviders[0];
    expect(diag!.reason).toBe("auth-missing");
  });

  test("healthy providers with good scorecard all land in primary", () => {
    for (let i = 0; i < 5; i++) {
      recordScorecardEvent("wikimedia", true, 200, makeResults(3, { confidence: 0.9, license: "CC0" }));
      recordScorecardEvent("openverse", true, 300, makeResults(3, { confidence: 0.85, license: "CC_BY" }));
    }

    const chain = providerDegradationRouting(["wikimedia", "openverse"]);
    expect(chain.primary).toContain("wikimedia");
    expect(chain.primary).toContain("openverse");
    expect(chain.fallback).toHaveLength(0);
  });

  test("empty provider list returns empty chain", () => {
    const chain = providerDegradationRouting([]);
    expect(chain.primary).toHaveLength(0);
    expect(chain.fallback).toHaveLength(0);
  });

  test("diagnostics include all demoted providers with correct reasons", () => {
    recordProviderTimeout("pexels");
    recordProviderTimeout("pexels");

    const chain = providerDegradationRouting(["pexels", "wikimedia"], {
      missingAuthIds: [],
    });

    const timeoutDiag = chain.diagnostics.skippedProviders.find(
      (d) => d.id === "pexels",
    );
    expect(timeoutDiag).toBeDefined();
    expect(timeoutDiag!.reason).toBe("timeout");
  });
});
