/**
 * Federation Diagnostic Repair Engine.
 *
 * Analyses `ProviderReport[]` and `ImageCandidate[]` produced by a federation
 * run to detect failure patterns and generate an ordered `FederationRepairPlan`
 * with concrete, actionable `RepairRecommendation[]`.
 *
 * Design principles:
 *  - Pure function — no side-effects, no I/O.
 *  - Pattern detection is independent of recommendation generation, so each
 *    can be unit-tested in isolation.
 *  - Recommendations are ranked by `estimatedImpact` descending so callers
 *    always get the most useful fix first.
 *  - Off by default: `searchImages` only runs this when `opts.repairPlan` is true.
 */

import type {
  FederationRepairPlan,
  ImageCandidate,
  LicensePolicy,
  ProviderId,
  ProviderReport,
  RepairAction,
  RepairRecommendation,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Pattern detection
// ---------------------------------------------------------------------------

/** Resolved context gathered from a federation result for pattern matching. */
export interface FederationContext {
  reports: ProviderReport[];
  candidates: ImageCandidate[];
  /** The licensePolicy that was active during the run. */
  licensePolicy?: LicensePolicy;
  /** The timeoutMs that was active during the run. */
  timeoutMs?: number;
  /** Provider IDs that were requested (may differ from what actually ran). */
  requestedProviders?: ProviderId[];
}

/** Detected failure/degradation patterns. */
export type FailurePattern =
  | "all-timeout"
  | "all-unknown-license"
  | "auth-missing"
  | "low-confidence"
  | "no-results"
  | "all-failed"
  | "partial-failure"
  | "rate-limited"
  | "no-browser-provider";

/**
 * Detect failure patterns from the federation context.
 * Returns a deduplicated set of pattern labels — callers can test membership
 * without caring about order.
 */
export function detectPatterns(ctx: FederationContext): Set<FailurePattern> {
  const patterns = new Set<FailurePattern>();
  const { reports, candidates } = ctx;

  if (reports.length === 0) return patterns;

  const active = reports.filter((r) => !r.skipped);
  const skipped = reports.filter((r) => r.skipped);
  const failed = active.filter((r) => !r.ok);
  const succeeded = active.filter((r) => r.ok);

  // --- all-failed: every non-skipped provider errored ---
  if (active.length > 0 && failed.length === active.length) {
    patterns.add("all-failed");
  }

  // --- partial-failure: some but not all non-skipped providers errored ---
  if (active.length > 1 && failed.length > 0 && failed.length < active.length) {
    patterns.add("partial-failure");
  }

  // --- all-timeout: every failure was a timeout ---
  if (
    failed.length > 0 &&
    failed.every((r) => r.errorKind === "timeout")
  ) {
    patterns.add("all-timeout");
  }

  // --- rate-limited: at least one provider was rate-limited ---
  const rateLimited = reports.filter(
    (r) => r.errorKind === "rate-limited" || r.skipped === "rate-limited",
  );
  if (rateLimited.length > 0) {
    patterns.add("rate-limited");
  }

  // --- auth-missing: at least one provider was skipped due to missing auth ---
  const missingAuth = skipped.filter((r) => r.skipped === "missing-auth");
  if (missingAuth.length > 0) {
    patterns.add("auth-missing");
  }

  // --- no-results: federation ran but no candidates came back ---
  if (candidates.length === 0 && (succeeded.length > 0 || active.length > 0)) {
    patterns.add("no-results");
  }

  // --- all-unknown-license: candidates exist but every license is UNKNOWN ---
  if (
    candidates.length > 0 &&
    candidates.every((c) => c.license === "UNKNOWN")
  ) {
    patterns.add("all-unknown-license");
  }

  // --- low-confidence: >50% of candidates have confidence < 0.5 ---
  if (candidates.length >= 2) {
    const lowConf = candidates.filter((c) => (c.confidence ?? 1) < 0.5);
    if (lowConf.length / candidates.length > 0.5) {
      patterns.add("low-confidence");
    }
  }

  // --- no-browser-provider: no browser/managed-browser was in the request ---
  const requestedProviders = ctx.requestedProviders ?? reports.map((r) => r.provider);
  const hasBrowser = requestedProviders.some(
    (id) => id === "browser" || id === "managed-browser",
  );
  if (!hasBrowser && (patterns.has("no-results") || patterns.has("all-failed"))) {
    patterns.add("no-browser-provider");
  }

  return patterns;
}

// ---------------------------------------------------------------------------
// Auth provider map — which providers need which env vars
// ---------------------------------------------------------------------------

const AUTH_ENV_MAP: Partial<Record<ProviderId, string[]>> = {
  unsplash: ["UNSPLASH_ACCESS_KEY"],
  pexels: ["PEXELS_API_KEY"],
  pixabay: ["PIXABAY_API_KEY"],
  brave: ["BRAVE_API_KEY"],
  bing: ["BING_API_KEY"],
  serpapi: ["SERPAPI_KEY"],
  spotify: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
  flickr: ["FLICKR_API_KEY"],
  smithsonian: ["SMITHSONIAN_API_KEY"],
  europeana: ["EUROPEANA_API_KEY"],
  rawpixel: ["RAWPIXEL_API_KEY"],
};

// ---------------------------------------------------------------------------
// Recommendation generation
// ---------------------------------------------------------------------------

/**
 * Build a `RepairRecommendation` with typed parameters.
 */
function rec(
  action: RepairAction,
  rationale: string,
  parameters: Record<string, unknown>,
  estimatedImpact: number,
): RepairRecommendation {
  return { action, rationale, parameters, estimatedImpact };
}

/**
 * Generate recommendations from detected patterns.
 *
 * Multiple recommendations may be generated for a single pattern.
 * They are ranked by `estimatedImpact` before being returned.
 */
export function generateRecommendations(
  patterns: Set<FailurePattern>,
  ctx: FederationContext,
): RepairRecommendation[] {
  const recs: RepairRecommendation[] = [];

  // --- retry on transient failures ---
  if (patterns.has("partial-failure") || patterns.has("rate-limited")) {
    recs.push(
      rec(
        "retry",
        patterns.has("rate-limited")
          ? "One or more providers returned rate-limit errors. Waiting and retrying often resolves this."
          : "Some providers returned transient errors. A retry may succeed.",
        {},
        patterns.has("rate-limited") ? 0.55 : 0.4,
      ),
    );
  }

  // --- increase timeout when all failures were timeouts ---
  if (patterns.has("all-timeout")) {
    const current = ctx.timeoutMs ?? 15_000;
    const suggested = Math.min(current * 2, 60_000);
    recs.push(
      rec(
        "increase-timeout",
        `All providers timed out (current timeout: ${current}ms). Increasing the timeout gives slow providers more time to respond.`,
        { suggestedTimeoutMs: suggested },
        0.75,
      ),
    );
    // Also suggest retry after the timeout increase
    recs.push(
      rec(
        "retry",
        "After increasing timeoutMs, retry the query to give providers adequate time.",
        {},
        0.5,
      ),
    );
  }

  // --- relax policy when license filter is likely blocking results ---
  if (patterns.has("all-unknown-license") || patterns.has("no-results")) {
    const current = ctx.licensePolicy ?? "safe-only";
    const nextPolicy = relaxPolicy(current);
    if (nextPolicy) {
      recs.push(
        rec(
          "relax-policy",
          `The current licensePolicy "${current}" may be filtering out available results. ` +
            `Switching to "${nextPolicy}" will include more candidates while staying rights-aware.`,
          { suggestedPolicy: nextPolicy },
          patterns.has("no-results") ? 0.7 : 0.5,
        ),
      );
    }
  }

  // --- add more providers when results are thin ---
  if (patterns.has("no-results") || patterns.has("all-failed")) {
    const alreadyRequested = new Set(
      ctx.requestedProviders ?? ctx.reports.map((r) => r.provider),
    );
    // Suggest well-known open-license providers not already in the request
    const openSuggestions: ProviderId[] = [
      "wikimedia",
      "openverse",
      "nasa",
      "met-museum",
      "library-of-congress",
      "internet-archive",
    ].filter((p) => !alreadyRequested.has(p as ProviderId)) as ProviderId[];

    if (openSuggestions.length > 0) {
      recs.push(
        rec(
          "add-provider",
          `Adding open-license providers (${openSuggestions.slice(0, 3).join(", ")}) can surface results ` +
            "that don't require API credentials.",
          { providers: openSuggestions.slice(0, 3) },
          0.65,
        ),
      );
    }
  }

  // --- enable browser provider when no results and no browser in set ---
  if (patterns.has("no-browser-provider")) {
    recs.push(
      rec(
        "enable-browser",
        "Enabling the browser or managed-browser provider allows fetching results from " +
          "JavaScript-rendered pages that API-only providers cannot reach. " +
          "Note: review each site's Terms of Service before opting in.",
        { providers: ["browser", "managed-browser"] as ProviderId[] },
        0.45,
      ),
    );
  }

  // --- set auth for skipped providers ---
  if (patterns.has("auth-missing")) {
    const missingAuthProviders = ctx.reports
      .filter((r) => r.skipped === "missing-auth")
      .map((r) => r.provider);

    // Deduplicate and gather env var names
    const envVars: string[] = [];
    for (const pid of missingAuthProviders) {
      const vars = AUTH_ENV_MAP[pid] ?? [];
      for (const v of vars) {
        if (!envVars.includes(v)) envVars.push(v);
      }
    }

    recs.push(
      rec(
        "set-auth",
        `${missingAuthProviders.length} provider(s) were skipped due to missing credentials ` +
          `(${missingAuthProviders.join(", ")}). Configuring the required API keys will activate them.`,
        {
          providers: missingAuthProviders,
          envVars: envVars.length > 0 ? envVars : missingAuthProviders.map((p) => `<${p.toUpperCase()}_API_KEY>`),
        },
        0.8,
      ),
    );
  }

  // --- low confidence: suggest open-only or probing ---
  if (patterns.has("low-confidence")) {
    recs.push(
      rec(
        "relax-policy",
        "More than half of the returned candidates have confidence < 0.5. " +
          "Switching to 'open-only' will restrict to candidates with known open licenses, " +
          "raising overall result quality even if count is lower.",
        { suggestedPolicy: "open-only" as LicensePolicy },
        0.45,
      ),
    );
  }

  // Deduplicate by action (keep highest impact per action type)
  return dedupeAndRank(recs);
}

/** Remove lower-impact duplicates of the same action, then sort by impact desc. */
function dedupeAndRank(recs: RepairRecommendation[]): RepairRecommendation[] {
  const best = new Map<RepairAction, RepairRecommendation>();
  for (const r of recs) {
    const existing = best.get(r.action);
    if (!existing || r.estimatedImpact > existing.estimatedImpact) {
      best.set(r.action, r);
    }
  }
  return Array.from(best.values()).sort((a, b) => b.estimatedImpact - a.estimatedImpact);
}

/**
 * Return the next-relaxed license policy, or null if already at maximum
 * permissiveness.
 */
function relaxPolicy(current: LicensePolicy): LicensePolicy | null {
  const ladder: LicensePolicy[] = ["open-only", "safe-only", "prefer-safe", "context-safe", "any"];
  const idx = ladder.indexOf(current);
  if (idx < 0 || idx >= ladder.length - 1) return null;
  return ladder[idx + 1]!;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyse the results of a federation call and return a structured
 * `FederationRepairPlan` with ranked actionable recommendations.
 *
 * This is a pure synchronous function — safe to call after `searchImages`
 * without any additional I/O.
 *
 * @example
 * ```ts
 * const bundle = await searchImages("jazz festival", { providers: ["unsplash"] });
 * const plan = getFederationRepairPlan({
 *   reports: bundle.providerReports,
 *   candidates: bundle.candidates,
 *   licensePolicy: "safe-only",
 *   timeoutMs: 15_000,
 *   requestedProviders: ["unsplash"],
 * });
 * if (!plan.healthy) {
 *   console.log(plan.recommendations[0]);
 * }
 * ```
 */
export function getFederationRepairPlan(ctx: FederationContext): FederationRepairPlan {
  const patterns = detectPatterns(ctx);
  const recommendations = generateRecommendations(patterns, ctx);

  // "Healthy" means no actionable patterns were found (either empty or the
  // only pattern is partial-failure with 0 recommendations).
  const healthy = recommendations.length === 0;

  return {
    detectedPatterns: Array.from(patterns),
    recommendations,
    healthy,
    generatedAt: new Date().toISOString(),
  };
}
