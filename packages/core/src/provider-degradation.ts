/**
 * Provider Fallback Strategy & Auto-Degradation Router.
 *
 * Builds a per-query smart provider chain that automatically deprioritises
 * providers that have experienced timeouts, returned high UNKNOWN-license
 * fractions, or failed auth in the current session.
 *
 * Design goals:
 *  - Zero mandatory I/O — pure in-memory; no external deps.
 *  - Composable with existing `selectProvidersForQuery` and `_timeoutHistory`.
 *  - Decay/recovery: 2+ session timeouts → move to fallback; recover after
 *    5 consecutive successes.
 *  - Returns a structured chain with diagnostics so callers know *why* a
 *    provider was demoted.
 */

import { getProviderScore, recordScorecardEvent } from "./provider-scorecard.ts";
import type { ProviderScore } from "./provider-scorecard.ts";
import type { ProviderId } from "./types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Reason a provider was moved to fallback or skipped. */
export type DegradationReason =
  | "timeout"
  | "unknown-rate"
  | "auth-missing"
  | "low-score";

/** Entry in the diagnostics list describing why a provider was deprioritised. */
export interface SkippedProviderDiagnostic {
  id: ProviderId;
  reason: DegradationReason;
  /** 0..1 — how confident we are in the demotion (1 = certain). */
  confidence: number;
}

/** Result of `selectProviderChain()`. */
export interface ProviderChain {
  /** Providers to try first, in priority order. */
  primary: ProviderId[];
  /** Providers to try if primary providers all fail/return nothing. */
  fallback: ProviderId[];
  /** Diagnostic information about why providers were demoted or skipped. */
  diagnostics: {
    skippedProviders: SkippedProviderDiagnostic[];
  };
}

// ---------------------------------------------------------------------------
// Session-scoped state
// ---------------------------------------------------------------------------

/**
 * Per-session timeout count per provider.
 * Exported for federation.ts integration and test resets.
 */
export const _sessionTimeouts = new Map<ProviderId, number>();

/**
 * Per-session consecutive-success count per provider.
 * Used for decay recovery: 5 successes reset timeout penalty.
 */
export const _sessionSuccesses = new Map<ProviderId, number>();

/** Reset all session state (test-only). */
export function _resetDegradationState(): void {
  _sessionTimeouts.clear();
  _sessionSuccesses.clear();
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Providers with 2+ session timeouts are demoted to fallback. */
const TIMEOUT_DEMOTION_THRESHOLD = 2;

/** After this many consecutive successes, a provider's timeout count is reset. */
const RECOVERY_SUCCESS_COUNT = 5;

/** avgUnknownFraction above this triggers an `unknown-rate` demotion. */
const UNKNOWN_RATE_THRESHOLD = 0.6;

/** compositeScore below this triggers a `low-score` demotion (cold-start exempt). */
const LOW_SCORE_THRESHOLD = 0.25;

// ---------------------------------------------------------------------------
// Session event recording
// ---------------------------------------------------------------------------

/**
 * Record a provider timeout in the session.
 *
 * Call this from federation.ts whenever a provider times out.
 * Resets consecutive-success counter for the provider.
 */
export function recordProviderTimeout(id: ProviderId): void {
  _sessionTimeouts.set(id, (_sessionTimeouts.get(id) ?? 0) + 1);
  _sessionSuccesses.set(id, 0); // reset recovery counter
}

/**
 * Record a provider success in the session.
 *
 * After RECOVERY_SUCCESS_COUNT consecutive successes, the session timeout
 * count is reset so the provider regains normal priority.
 */
export function recordProviderSuccess(id: ProviderId): void {
  const prev = _sessionSuccesses.get(id) ?? 0;
  const next = prev + 1;
  _sessionSuccesses.set(id, next);
  if (next >= RECOVERY_SUCCESS_COUNT) {
    _sessionTimeouts.set(id, 0);
    _sessionSuccesses.set(id, 0);
  }
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Build a smart provider chain for a query.
 *
 * Analyses:
 *  1. Session timeout history — providers with 2+ timeouts → fallback.
 *  2. Scorecard UNKNOWN-license rate — high unknown rate → fallback.
 *  3. Auth availability — providers in `missingAuthIds` → fallback (auth-missing).
 *  4. Composite scorecard score — low-scoring providers → fallback.
 *
 * Returns `{ primary, fallback, diagnostics }` where `primary` is ordered
 * best-first (highest composite score, adjusted for session penalties).
 *
 * @param providers      Full set of candidate providers for this query.
 * @param scores         Pre-fetched `ProviderScore[]` for the providers
 *                       (pass the result of `getAllProviderScores()` or
 *                       individual `getProviderScore()` calls). Providers
 *                       absent from this array are treated as cold-start.
 * @param missingAuthIds Providers known to be missing credentials.
 */
export function selectProviderChain(
  providers: ProviderId[],
  scores: ProviderScore[],
  missingAuthIds: ProviderId[] = [],
): ProviderChain {
  if (providers.length === 0) {
    return { primary: [], fallback: [], diagnostics: { skippedProviders: [] } };
  }

  const scoreMap = new Map<ProviderId, ProviderScore>();
  for (const s of scores) {
    scoreMap.set(s.provider, s);
  }

  const missingAuthSet = new Set(missingAuthIds);

  const primary: ProviderId[] = [];
  const fallback: ProviderId[] = [];
  const skipped: SkippedProviderDiagnostic[] = [];

  // Score-adjusted ranking data for the primary sort
  const primaryScores: Array<{ id: ProviderId; adjustedScore: number }> = [];

  for (const id of providers) {
    const score = scoreMap.get(id);
    const sessionTimeouts = _sessionTimeouts.get(id) ?? 0;

    // --- Auth missing → always fallback ---
    if (missingAuthSet.has(id)) {
      fallback.push(id);
      skipped.push({ id, reason: "auth-missing", confidence: 1.0 });
      continue;
    }

    // --- Timeout demotion ---
    if (sessionTimeouts >= TIMEOUT_DEMOTION_THRESHOLD) {
      fallback.push(id);
      // Confidence grows with number of timeouts (capped at 1)
      const confidence = Math.min(1, 0.7 + (sessionTimeouts - TIMEOUT_DEMOTION_THRESHOLD) * 0.15);
      skipped.push({ id, reason: "timeout", confidence });
      continue;
    }

    // Cold-start: no scorecard data yet — optimistic, place in primary
    if (!score || score.sampleCount === 0) {
      primaryScores.push({ id, adjustedScore: 1.0 });
      continue;
    }

    // --- UNKNOWN-rate demotion ---
    if (score.avgUnknownFraction >= UNKNOWN_RATE_THRESHOLD) {
      fallback.push(id);
      const confidence = Math.min(1, score.avgUnknownFraction);
      skipped.push({ id, reason: "unknown-rate", confidence });
      continue;
    }

    // --- Low composite score demotion ---
    if (score.compositeScore < LOW_SCORE_THRESHOLD) {
      fallback.push(id);
      const confidence = Math.min(1, 1 - score.compositeScore / LOW_SCORE_THRESHOLD);
      skipped.push({ id, reason: "low-score", confidence });
      continue;
    }

    // --- Primary provider: compute adjusted score ---
    let adjustedScore = score.compositeScore;

    // Session-timeout soft penalty: 1 timeout → 30% score reduction
    if (sessionTimeouts === 1) {
      adjustedScore *= 0.7;
    }

    primaryScores.push({ id, adjustedScore });
  }

  // Sort primary providers by adjusted score descending; stable tie-break by original order
  primaryScores.sort((a, b) => {
    const diff = b.adjustedScore - a.adjustedScore;
    if (Math.abs(diff) > 1e-9) return diff;
    return providers.indexOf(a.id) - providers.indexOf(b.id);
  });

  for (const { id } of primaryScores) {
    primary.push(id);
  }

  return {
    primary,
    fallback,
    diagnostics: { skippedProviders: skipped },
  };
}

// ---------------------------------------------------------------------------
// Degradation routing API
// ---------------------------------------------------------------------------

/**
 * Options for `providerDegradationRouting`.
 */
export interface DegradationRoutingOptions {
  /**
   * Provider IDs known to be missing auth credentials.
   * These are placed in the fallback chain with reason `auth-missing`.
   */
  missingAuthIds?: ProviderId[];
}

/**
 * High-level degradation router.
 *
 * Fetches scorecard data for each provider, then delegates to
 * `selectProviderChain` to build the chain. The difference from
 * `selectProviderChain` is that this function fetches scores itself —
 * callers don't need to pass pre-fetched scores.
 *
 * Suitable for use in `federation.ts` as the `providerChain` override.
 *
 * @param providers Candidate provider IDs for this query.
 * @param opts      Optional routing options.
 */
export function providerDegradationRouting(
  providers: ProviderId[],
  opts: DegradationRoutingOptions = {},
): ProviderChain {
  if (providers.length === 0) {
    return { primary: [], fallback: [], diagnostics: { skippedProviders: [] } };
  }

  // Fetch current scorecard data for all providers in one pass
  const scores: ProviderScore[] = providers.map((id) => getProviderScore(id));

  return selectProviderChain(providers, scores, opts.missingAuthIds ?? []);
}
