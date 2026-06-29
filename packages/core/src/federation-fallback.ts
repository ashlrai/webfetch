/**
 * Provider Fallback Strategy Engine with License-Policy-Aware Adaptation.
 *
 * Analyses a `FederationRepairPlan` plus the detected failure patterns from a
 * federation run and produces an ordered list of concrete provider substitutions
 * that are compatible with the original query's license policy.
 *
 * Design principles:
 *  - Pure function — no side-effects, no I/O, no network calls.
 *  - License-policy isolation: provider suggestions respect the active policy so
 *    agents never accidentally suggest a paid/unknown-license provider under a
 *    strict open-only policy.
 *  - Cost/benefit scoring rewards high-coverage, zero-cost, open-license providers
 *    first, then safe-license platform providers, then paid API providers.
 *  - Each pattern has its own fallback chain; chains are merged and de-duped with
 *    the highest-scoring entry winning on conflict.
 */

import type { FailurePattern } from "./federation-repair.ts";
import type {
  FederationRepairPlan,
  LicensePolicy,
  ProviderId,
  ProviderReport,
  SearchOptions,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Public input / output types
// ---------------------------------------------------------------------------

/** Input for the fallback strategy engine. */
export interface FallbackStrategyInput {
  /** The repair plan produced by `getFederationRepairPlan()`. */
  repairPlan: FederationRepairPlan;
  /** The license policy that was active during the original query. */
  originalLicensePolicy: LicensePolicy;
  /** The original search query string (used for contextual scoring). */
  query: string;
  /**
   * The set of failure patterns detected during the federation run.
   * Typically `new Set(repairPlan.detectedPatterns)` but kept separate so
   * callers that pre-compute patterns can pass them directly.
   */
  detectedPatterns: Set<FailurePattern>;
  /**
   * Provider reports from the original run.
   * Used to identify which providers already ran (and can be demoted) and
   * which were healthy (and should be promoted).
   */
  providerReports?: ProviderReport[];
}

/** The result emitted by `computeFederationFallback()`. */
export interface FallbackStrategyResult {
  /**
   * Ordered list of provider IDs to use for the fallback run.
   * Ordered best-first (highest estimated success probability first).
   * Empty when no actionable fallback can be determined.
   */
  fallbackProviders: ProviderId[];
  /**
   * Human-readable explanation of why these providers were chosen and what
   * failure patterns each addresses.
   */
  rationale: string;
  /**
   * Estimated fraction of the original failure that this fallback will lift.
   * Range 0..1.  0 means "no improvement expected"; 1 means "full resolution".
   */
  estimatedLiftPercent: number;
  /**
   * Ratio of estimated lift to relative provider cost.
   * Higher is better — a ratio ≥ 1.0 means the fallback is worth trying.
   * Free providers with high lift produce ratios >> 1.
   */
  costBenefitRatio: number;
}

// ---------------------------------------------------------------------------
// Provider metadata used for scoring
// ---------------------------------------------------------------------------

/**
 * Rough cost tier for a provider.
 * "free"   — no API key required, no usage cost.
 * "freemium" — free tier with rate limits / key required.
 * "paid"   — paid API subscription required.
 */
type CostTier = "free" | "freemium" | "paid";

interface ProviderProfile {
  id: ProviderId;
  costTier: CostTier;
  /**
   * License bucket: which license policies this provider can satisfy.
   * "open"  — returns CC/public-domain only (safe for open-only policy).
   * "safe"  — returns platform-license content (safe for safe-only policy).
   * "any"   — may return UNKNOWN-license results.
   */
  licenseBucket: "open" | "safe" | "any";
  /**
   * Intrinsic quality score 0..1 based on typical result count, metadata
   * richness, and community trust.
   */
  baseScore: number;
  /** True when the provider requires explicit opt-in (browser, managed-browser). */
  optIn?: boolean;
}

const PROVIDER_PROFILES: ProviderProfile[] = [
  // Open-license, free, no key required
  { id: "wikimedia", costTier: "free", licenseBucket: "open", baseScore: 0.92 },
  { id: "openverse", costTier: "free", licenseBucket: "open", baseScore: 0.88 },
  { id: "nasa", costTier: "free", licenseBucket: "open", baseScore: 0.80 },
  { id: "met-museum", costTier: "free", licenseBucket: "open", baseScore: 0.78 },
  { id: "internet-archive", costTier: "free", licenseBucket: "open", baseScore: 0.75 },
  { id: "library-of-congress", costTier: "free", licenseBucket: "open", baseScore: 0.74 },
  { id: "smithsonian", costTier: "freemium", licenseBucket: "open", baseScore: 0.76 },
  { id: "europeana", costTier: "freemium", licenseBucket: "open", baseScore: 0.73 },
  { id: "europeana-archival", costTier: "freemium", licenseBucket: "open", baseScore: 0.70 },
  { id: "wellcome-collection", costTier: "free", licenseBucket: "open", baseScore: 0.69 },
  // Safe-license, paid API
  { id: "unsplash", costTier: "freemium", licenseBucket: "safe", baseScore: 0.87 },
  { id: "pexels", costTier: "freemium", licenseBucket: "safe", baseScore: 0.85 },
  { id: "pixabay", costTier: "freemium", licenseBucket: "safe", baseScore: 0.83 },
  { id: "burst", costTier: "free", licenseBucket: "safe", baseScore: 0.72 },
  { id: "rawpixel", costTier: "freemium", licenseBucket: "safe", baseScore: 0.71 },
  { id: "flickr", costTier: "freemium", licenseBucket: "open", baseScore: 0.74 },
  // Any / unknown license (search engines, paid APIs)
  { id: "brave", costTier: "paid", licenseBucket: "any", baseScore: 0.70 },
  { id: "bing", costTier: "paid", licenseBucket: "any", baseScore: 0.68 },
  { id: "serpapi", costTier: "paid", licenseBucket: "any", baseScore: 0.65 },
  { id: "musicbrainz-caa", costTier: "free", licenseBucket: "safe", baseScore: 0.77 },
  { id: "itunes", costTier: "free", licenseBucket: "safe", baseScore: 0.75 },
  { id: "spotify", costTier: "freemium", licenseBucket: "safe", baseScore: 0.73 },
  { id: "youtube-thumb", costTier: "free", licenseBucket: "any", baseScore: 0.60 },
  // Opt-in browser providers
  { id: "browser", costTier: "free", licenseBucket: "any", baseScore: 0.50, optIn: true },
  { id: "managed-browser", costTier: "paid", licenseBucket: "any", baseScore: 0.55, optIn: true },
];

const PROFILE_MAP = new Map<ProviderId, ProviderProfile>(
  PROVIDER_PROFILES.map((p) => [p.id, p]),
);

// ---------------------------------------------------------------------------
// Cost weights for costBenefitRatio
// ---------------------------------------------------------------------------

const COST_WEIGHT: Record<CostTier, number> = {
  free: 0.1,
  freemium: 0.4,
  paid: 1.0,
};

// ---------------------------------------------------------------------------
// License-policy gates
// ---------------------------------------------------------------------------

/**
 * Return true when a provider is compatible with the requested license policy.
 * "open-only"    → only providers whose licenseBucket is "open".
 * "safe-only"    → providers with "open" or "safe" buckets.
 * "prefer-safe"  → same as safe-only (may include open + safe).
 * "context-safe" → same as safe-only.
 * "any"          → all providers.
 */
function policyAllows(profile: ProviderProfile, policy: LicensePolicy): boolean {
  switch (policy) {
    case "open-only":
      return profile.licenseBucket === "open";
    case "safe-only":
    case "prefer-safe":
    case "context-safe":
      return profile.licenseBucket === "open" || profile.licenseBucket === "safe";
    case "any":
      return true;
  }
}

// ---------------------------------------------------------------------------
// Per-pattern fallback chain definitions
// ---------------------------------------------------------------------------

/**
 * For each failure pattern, return the ordered set of preferred provider IDs
 * to try as fallback, filtered by the active license policy.
 */
function fallbacksForPattern(
  pattern: FailurePattern,
  policy: LicensePolicy,
  failedProviders: Set<ProviderId>,
  requestedProviders: Set<ProviderId>,
): ProviderId[] {
  switch (pattern) {
    case "all-unknown-license": {
      // Switch to providers with known open/safe license metadata
      if (policy === "open-only") {
        return (["openverse", "wikimedia", "nasa", "met-museum", "internet-archive", "library-of-congress"] as ProviderId[])
          .filter((id) => !failedProviders.has(id));
      }
      // safe-only / prefer-safe / context-safe
      return (["unsplash", "pexels", "pixabay", "burst", "openverse", "wikimedia"] as ProviderId[])
        .filter((id) => !failedProviders.has(id));
    }

    case "auth-missing": {
      // Auto-disable paid providers — suggest free alternatives
      // e.g. brave (paid) → openverse, wikimedia (free, open)
      const freeAlternatives = PROVIDER_PROFILES.filter(
        (p) =>
          p.costTier === "free" &&
          policyAllows(p, policy) &&
          !failedProviders.has(p.id) &&
          !p.optIn,
      )
        .sort((a, b) => b.baseScore - a.baseScore)
        .map((p) => p.id);
      return freeAlternatives;
    }

    case "all-timeout": {
      // Suggest opt-in managed-browser; also reduce scope to fastest known providers
      const base: ProviderId[] = [];
      // managed-browser can handle JS-gated pages that timed out via direct API
      if (!failedProviders.has("managed-browser")) base.push("managed-browser");
      // Fastest / most reliable open providers (low latency)
      const fast: ProviderId[] = (["wikimedia", "openverse", "nasa", "unsplash"] as ProviderId[])
        .filter((id) => !failedProviders.has(id) && !requestedProviders.has(id));
      return [...base, ...fast];
    }

    case "partial-failure": {
      // Promote healthy providers; add open-license backup providers
      // The caller will have healthy providers from providerReports — we add extras
      const extras = PROVIDER_PROFILES.filter(
        (p) =>
          policyAllows(p, policy) &&
          !failedProviders.has(p.id) &&
          !requestedProviders.has(p.id) &&
          !p.optIn,
      )
        .sort((a, b) => b.baseScore - a.baseScore)
        .slice(0, 4)
        .map((p) => p.id);
      return extras;
    }

    case "low-confidence": {
      // Prefer authoritative open-license providers with structured metadata
      return (["openverse", "wikimedia", "nasa", "met-museum", "library-of-congress"] as ProviderId[])
        .filter((id) => !failedProviders.has(id))
        .filter((id) => {
          const profile = PROFILE_MAP.get(id);
          return profile ? policyAllows(profile, policy) : false;
        });
    }

    case "no-results": {
      const fallbacks = PROVIDER_PROFILES.filter(
        (p) =>
          policyAllows(p, policy) &&
          !failedProviders.has(p.id) &&
          !requestedProviders.has(p.id) &&
          !p.optIn,
      )
        .sort((a, b) => b.baseScore - a.baseScore)
        .slice(0, 5)
        .map((p) => p.id);
      return fallbacks;
    }

    case "all-failed": {
      const fallbacks = PROVIDER_PROFILES.filter(
        (p) =>
          policyAllows(p, policy) &&
          !failedProviders.has(p.id) &&
          !p.optIn,
      )
        .sort((a, b) => b.baseScore - a.baseScore)
        .slice(0, 5)
        .map((p) => p.id);
      return fallbacks;
    }

    case "no-browser-provider": {
      // Only suggest browser opt-ins when policy allows any license
      if (policy === "any") {
        return (["browser", "managed-browser"] as ProviderId[]).filter(
          (id) => !failedProviders.has(id),
        );
      }
      return [];
    }

    case "rate-limited": {
      // Fall back to providers not subject to the same rate-limit bucket
      const alts = PROVIDER_PROFILES.filter(
        (p) =>
          policyAllows(p, policy) &&
          !failedProviders.has(p.id) &&
          !requestedProviders.has(p.id) &&
          !p.optIn,
      )
        .sort((a, b) => b.baseScore - a.baseScore)
        .slice(0, 4)
        .map((p) => p.id);
      return alts;
    }

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/**
 * Compute a composite score for a provider candidate within a given policy context.
 *
 * Score = baseScore * licenseBonus * costPenalty
 *   - licenseBonus: 1.2 for "open" providers under open-only policy, else 1.0
 *   - costPenalty:  reduces score for paid providers (free → 1.0, freemium → 0.85, paid → 0.65)
 */
function scoreProvider(id: ProviderId, policy: LicensePolicy): number {
  const profile = PROFILE_MAP.get(id);
  if (!profile) return 0;
  if (!policyAllows(profile, policy)) return 0;

  const licenseBonus = policy === "open-only" && profile.licenseBucket === "open" ? 1.2 : 1.0;
  const costPenalty = profile.costTier === "free" ? 1.0 : profile.costTier === "freemium" ? 0.85 : 0.65;
  return Math.min(1.0, profile.baseScore * licenseBonus * costPenalty);
}

/**
 * Estimate the lift fraction for a set of fallback providers given a pattern.
 * Returns a 0..1 value representing how much of the original failure is likely resolved.
 */
function estimateLift(
  pattern: FailurePattern,
  fallbackProviders: ProviderId[],
  policy: LicensePolicy,
): number {
  if (fallbackProviders.length === 0) return 0;

  const avgScore =
    fallbackProviders.reduce((acc, id) => acc + scoreProvider(id, policy), 0) /
    fallbackProviders.length;

  // Pattern-specific base lift multipliers
  const patternMultiplier: Partial<Record<FailurePattern, number>> = {
    "all-unknown-license": 0.85,
    "auth-missing": 0.80,
    "all-timeout": 0.70,
    "partial-failure": 0.65,
    "low-confidence": 0.75,
    "no-results": 0.70,
    "all-failed": 0.75,
    "no-browser-provider": 0.60,
    "rate-limited": 0.55,
  };

  const multiplier = patternMultiplier[pattern] ?? 0.5;
  return Math.min(1.0, avgScore * multiplier * Math.min(1.0, 0.5 + fallbackProviders.length * 0.1));
}

/**
 * Compute the cost-benefit ratio.
 * lift / avg_cost_weight, normalised so free providers yield ratio >> 1.
 */
function computeCostBenefit(
  fallbackProviders: ProviderId[],
  estimatedLift: number,
): number {
  if (fallbackProviders.length === 0 || estimatedLift === 0) return 0;

  const avgCost =
    fallbackProviders.reduce((acc, id) => {
      const profile = PROFILE_MAP.get(id);
      return acc + (profile ? COST_WEIGHT[profile.costTier] : 1.0);
    }, 0) / fallbackProviders.length;

  return avgCost > 0 ? estimatedLift / avgCost : estimatedLift * 10;
}

// ---------------------------------------------------------------------------
// Rationale builder
// ---------------------------------------------------------------------------

function buildRationale(
  patterns: Set<FailurePattern>,
  providers: ProviderId[],
  policy: LicensePolicy,
): string {
  const patternList = Array.from(patterns).join(", ");
  if (providers.length === 0) {
    return `No actionable fallback providers found for patterns [${patternList}] under policy "${policy}".`;
  }

  const parts: string[] = [];

  if (patterns.has("all-unknown-license")) {
    parts.push(
      `all-unknown-license: switched to providers with structured license metadata (${providers.slice(0, 2).join(", ")})`,
    );
  }
  if (patterns.has("auth-missing")) {
    parts.push(
      `auth-missing: replaced paid/credentialed providers with free alternatives that don't require API keys`,
    );
  }
  if (patterns.has("all-timeout")) {
    parts.push(
      `all-timeout: added managed-browser opt-in and lower-latency providers to avoid repeated timeouts`,
    );
  }
  if (patterns.has("partial-failure")) {
    parts.push(
      `partial-failure: promoted healthy providers and added backup providers to cover the failed subset`,
    );
  }
  if (patterns.has("low-confidence")) {
    parts.push(
      `low-confidence: prioritised authoritative open-license providers with structured metadata`,
    );
  }

  const body =
    parts.length > 0
      ? parts.join("; ")
      : `Fallback addresses [${patternList}] under "${policy}" policy`;

  return (
    `${body}. Suggested providers: [${providers.join(", ")}]. ` +
    `License policy "${policy}" enforced throughout.`
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Compute a concrete provider fallback strategy from a `FederationRepairPlan`.
 *
 * This is a pure synchronous function — no network calls, no side-effects.
 *
 * @example
 * ```ts
 * const bundle = await searchImages("street art", { providers: ["brave"], repairPlan: true });
 * if (bundle.repairPlan && !bundle.repairPlan.healthy) {
 *   const fallback = computeFederationFallback({
 *     repairPlan: bundle.repairPlan,
 *     originalLicensePolicy: "open-only",
 *     query: "street art",
 *     detectedPatterns: new Set(bundle.repairPlan.detectedPatterns as FailurePattern[]),
 *     providerReports: bundle.providerReports,
 *   });
 *   if (fallback.fallbackProviders.length > 0) {
 *     const retryBundle = await searchImages("street art", {
 *       providers: fallback.fallbackProviders,
 *       licensePolicy: "open-only",
 *     });
 *   }
 * }
 * ```
 */
export function computeFederationFallback(
  input: FallbackStrategyInput,
): FallbackStrategyResult {
  const { repairPlan, originalLicensePolicy, query: _query, detectedPatterns, providerReports = [] } = input;

  // Collect providers that failed or were part of the original run
  const failedProviders = new Set<ProviderId>(
    providerReports
      .filter((r) => !r.ok || r.skipped)
      .map((r) => r.provider),
  );

  const requestedProviders = new Set<ProviderId>(
    providerReports.map((r) => r.provider),
  );

  // Identify providers that succeeded in the original run (promote these)
  const healthyProviders = providerReports
    .filter((r) => r.ok && !r.skipped && r.count > 0)
    .map((r) => r.provider);

  // Short-circuit: no patterns = healthy run, no fallback needed
  if (detectedPatterns.size === 0 && repairPlan.healthy) {
    return {
      fallbackProviders: [],
      rationale: "Federation run was healthy — no fallback required.",
      estimatedLiftPercent: 0,
      costBenefitRatio: 0,
    };
  }

  // Gather candidate providers from each pattern's fallback chain
  // Use a scored map to pick the best entry when a provider appears in multiple chains
  const scored = new Map<ProviderId, number>();

  for (const pattern of detectedPatterns) {
    const candidates = fallbacksForPattern(
      pattern,
      originalLicensePolicy,
      failedProviders,
      requestedProviders,
    );
    for (const id of candidates) {
      const s = scoreProvider(id, originalLicensePolicy);
      if (s > 0) {
        const existing = scored.get(id) ?? 0;
        // Take max so a provider appearing in multiple chains is scored once (highest)
        if (s > existing) scored.set(id, s);
      }
    }
  }

  // For partial-failure, promote healthy providers to the front
  const promoted: ProviderId[] = healthyProviders.filter((id) => {
    const profile = PROFILE_MAP.get(id);
    return profile && policyAllows(profile, originalLicensePolicy);
  });

  // Build ordered list: promoted healthy first, then scored candidates desc
  const sortedCandidates = Array.from(scored.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => id)
    .filter((id) => !promoted.includes(id));

  const fallbackProviders: ProviderId[] = [...promoted, ...sortedCandidates].slice(0, 6);

  // Compute aggregate lift estimate across all active patterns
  const liftValues: number[] = [];
  for (const pattern of detectedPatterns) {
    const relevant = fallbackProviders.filter((id) => {
      const candidates = fallbacksForPattern(pattern, originalLicensePolicy, failedProviders, requestedProviders);
      return candidates.includes(id) || promoted.includes(id);
    });
    if (relevant.length > 0) {
      liftValues.push(estimateLift(pattern, relevant, originalLicensePolicy));
    }
  }

  const estimatedLiftPercent =
    liftValues.length > 0 ? Math.min(1.0, liftValues.reduce((a, b) => a + b, 0) / liftValues.length) : 0;

  const costBenefitRatio = computeCostBenefit(fallbackProviders, estimatedLiftPercent);

  const rationale = buildRationale(detectedPatterns, fallbackProviders, originalLicensePolicy);

  return {
    fallbackProviders,
    rationale,
    estimatedLiftPercent,
    costBenefitRatio,
  };
}

// ---------------------------------------------------------------------------
// searchImages integration hook
// ---------------------------------------------------------------------------

/**
 * Extended search options that include the auto-fallback flag.
 * Passed as `opts` to `searchImages()`.
 */
export interface SearchOptionsWithFallback extends SearchOptions {
  /**
   * When true, if the primary federation run produces a non-healthy
   * `FederationRepairPlan`, automatically compute a fallback provider set via
   * `computeFederationFallback()` and re-run the search with those providers.
   *
   * The secondary run's results are merged with (and ranked over) the primary
   * results.  The returned `SearchResultBundle` will include the repair plan
   * from the primary run so callers can inspect what triggered the fallback.
   *
   * Requires `repairPlan: true` — if not set it will be enabled automatically.
   *
   * @default false
   */
  enableAutoFallback?: boolean;
}
