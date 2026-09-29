/**
 * ProviderScorecard — persistent per-provider health + quality tracking.
 *
 * Tracks success rate, result quality (confidence, UNKNOWN license %, cache
 * hits, median resolution), latency percentiles (p50/p95/p99), and license
 * diversity (entropy) across all requests seen in this process lifetime.
 *
 * Optionally persists an append-only event log to ~/.webfetch/scorecard.json.
 * The scorecard influences provider ordering in federation.ts when no explicit
 * providerPreference is given.
 *
 * Design goals:
 *  - Zero mandatory I/O — works entirely in-memory; disk is opt-in.
 *  - No external dependencies.
 *  - Safe for concurrent module resets in tests.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ImageCandidate, License, LicensePolicy, ProviderId } from "./types.ts";

// ---------------------------------------------------------------------------
// Event shape (append-only log record)
// ---------------------------------------------------------------------------

/** A single observation recorded after a provider completes a request. */
export interface ScorecardEvent {
  /** ISO-8601 timestamp. */
  ts: string;
  provider: ProviderId;
  /** True when the provider returned at least one result without error. */
  ok: boolean;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Number of results returned (0 on error). */
  resultCount: number;
  /** Average license-confidence across returned candidates (0 if none). */
  avgConfidence: number;
  /** Fraction of results with license === "UNKNOWN" (0 if no results). */
  unknownFraction: number;
  /** Fraction of results that came from cache (0 if provider doesn't track). */
  cacheHitFraction: number;
  /** Median pixel resolution (width * height) across returned candidates (0 if unknown). */
  medianResolution: number;
  /** Shannon entropy of license type distribution across returned candidates. */
  licenseDiversity: number;
  /** License types observed (for diversity/entropy calculation cross-check). */
  licenseTypes: string[];
}

// ---------------------------------------------------------------------------
// Aggregate scorecard per provider
// ---------------------------------------------------------------------------

/** Computed aggregate view for a single provider. */
export interface ProviderScore {
  provider: ProviderId;
  /** Total events recorded for this provider. */
  sampleCount: number;
  /** Fraction of requests that returned ≥1 result (0..1). */
  successRate: number;
  /** Average confidence across all results seen (0..1). */
  avgConfidence: number;
  /** Average fraction of UNKNOWN-licensed results (0..1; lower = better). */
  avgUnknownFraction: number;
  /** Average cache-hit fraction across requests (0..1). */
  avgCacheHitFraction: number;
  /** Median pixel resolution across all seen results. */
  medianResolution: number;
  /** p50 latency in ms. */
  p50Ms: number;
  /** p95 latency in ms. */
  p95Ms: number;
  /** p99 latency in ms. */
  p99Ms: number;
  /** Average Shannon entropy of license distribution (higher = broader coverage). */
  avgLicenseDiversity: number;
  /**
   * Composite score in [0, 1].
   * = successRate × qualityScore × latencyScore
   * where:
   *   qualityScore  = avgConfidence × (1 - avgUnknownFraction) × (0.5 + 0.5 × avgCacheHitFraction)
   *   latencyScore  = 1 / (1 + p50Ms / 2000)   — sigmoid penalty for latency
   * Cold-start (no data): 1.0 (optimistic).
   */
  compositeScore: number;
}

// ---------------------------------------------------------------------------
// Selection weight presets
// ---------------------------------------------------------------------------

/** Weight tuning for `selectProvidersForQuery`. */
export interface SelectionWeights {
  /** Weight on successRate component (default 0.4). */
  success: number;
  /** Weight on quality component (default 0.35). */
  quality: number;
  /** Weight on latency-inverse component (default 0.25). */
  latency: number;
}

const WEIGHT_PRESETS: Record<ProviderSelectionMode, SelectionWeights> = {
  default: { success: 0.4, quality: 0.35, latency: 0.25 },
  quality: { success: 0.2, quality: 0.65, latency: 0.15 },
  latency: { success: 0.3, quality: 0.1, latency: 0.6 },
  balance: { success: 0.33, quality: 0.34, latency: 0.33 },
};

/**
 * CLI `--provider-selection` mode.
 *
 * - `default`  — balanced composite (successRate × quality × latency-inverse).
 * - `quality`  — maximise result quality + open licenses.
 * - `latency`  — minimise p50 latency above all else.
 * - `balance`  — equal weight on all three dimensions.
 */
export type ProviderSelectionMode = "default" | "quality" | "latency" | "balance";

// ---------------------------------------------------------------------------
// In-memory event ring buffer
// ---------------------------------------------------------------------------

const RING_CAPACITY = 5000;
const _ring: ScorecardEvent[] = [];
let _ringHead = 0;
let _ringSize = 0;

function pushEvent(evt: ScorecardEvent): void {
  if (_ring.length < RING_CAPACITY) {
    _ring.push(evt);
  } else {
    _ring[_ringHead] = evt;
  }
  _ringHead = (_ringHead + 1) % RING_CAPACITY;
  _ringSize = Math.min(_ringSize + 1, RING_CAPACITY);
}

function allEvents(): ScorecardEvent[] {
  if (_ringSize < RING_CAPACITY || _ring.length < RING_CAPACITY) {
    return _ring.slice(0, _ringSize);
  }
  return [..._ring.slice(_ringHead), ..._ring.slice(0, _ringHead)];
}

// ---------------------------------------------------------------------------
// Persistence helpers (append-only JSONL)
// ---------------------------------------------------------------------------

let _persistPath: string | null = null;
let _persistEnabled = false;

/** Enable append-only persistence to the given path (default ~/.webfetch/scorecard.json). */
export function enableScorecardPersistence(path?: string): void {
  _persistPath = path ?? join(homedir(), ".webfetch", "scorecard.json");
  _persistEnabled = true;
  // Ensure directory exists
  const dir = join(homedir(), ".webfetch");
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Non-fatal — persistence will silently fail if dir can't be created
    }
  }
}

/** Disable persistence without clearing in-memory state. */
export function disableScorecardPersistence(): void {
  _persistEnabled = false;
}

/** Load historic events from the JSONL file into the in-memory ring buffer. */
export function loadScorecardFromDisk(path?: string): void {
  const p = path ?? _persistPath ?? join(homedir(), ".webfetch", "scorecard.json");
  if (!existsSync(p)) return;
  try {
    const lines = readFileSync(p, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const evt = JSON.parse(line) as ScorecardEvent;
        pushEvent(evt);
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Non-fatal
  }
}

function persistEvent(evt: ScorecardEvent): void {
  if (!_persistEnabled || !_persistPath) return;
  try {
    appendFileSync(_persistPath, JSON.stringify(evt) + "\n", "utf8");
  } catch {
    // Non-fatal — in-memory state is still valid
  }
}

// ---------------------------------------------------------------------------
// Metric helpers
// ---------------------------------------------------------------------------

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]!;
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Shannon entropy of a frequency map (higher = more diverse). */
function shannonEntropy(counts: Map<string, number>, total: number): number {
  if (total === 0) return 0;
  let entropy = 0;
  for (const count of counts.values()) {
    if (count === 0) continue;
    const p = count / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Compute license Shannon entropy for a list of candidates. */
export function computeLicenseDiversity(candidates: ImageCandidate[]): number {
  if (candidates.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const c of candidates) {
    counts.set(c.license, (counts.get(c.license) ?? 0) + 1);
  }
  return shannonEntropy(counts, candidates.length);
}

// ---------------------------------------------------------------------------
// Observation recording
// ---------------------------------------------------------------------------

/**
 * Record a completed provider invocation into the scorecard.
 *
 * Call this after each provider returns (or fails). Designed to be called
 * from federation.ts or anywhere that has the final result set.
 *
 * @param provider   Provider that was called.
 * @param ok         Whether the call returned ≥1 result without error.
 * @param durationMs Wall-clock time for the call.
 * @param results    Candidate results returned (empty on failure).
 * @param cacheHitFraction  Fraction of results served from cache (0 if not tracked).
 */
export function recordScorecardEvent(
  provider: ProviderId,
  ok: boolean,
  durationMs: number,
  results: ImageCandidate[],
  cacheHitFraction = 0,
): void {
  const count = results.length;
  const avgConfidence =
    count > 0
      ? results.reduce((s, c) => s + (c.confidence ?? 0), 0) / count
      : 0;
  const unknownFraction =
    count > 0
      ? results.filter((c) => c.license === "UNKNOWN").length / count
      : 0;

  // Median resolution
  const resolutions = results
    .map((c) => (c.width ?? 0) * (c.height ?? 0))
    .filter((r) => r > 0);
  const medianResolution = computeMedian(resolutions);

  // License diversity
  const licenseDiversity = computeLicenseDiversity(results);
  const licenseTypes = [...new Set(results.map((c) => c.license))];

  const evt: ScorecardEvent = {
    ts: new Date().toISOString(),
    provider,
    ok,
    durationMs,
    resultCount: count,
    avgConfidence,
    unknownFraction,
    cacheHitFraction,
    medianResolution,
    licenseDiversity,
    licenseTypes,
  };

  pushEvent(evt);
  persistEvent(evt);
}

// ---------------------------------------------------------------------------
// Aggregate computation
// ---------------------------------------------------------------------------

/** Compute aggregate ProviderScore for a single provider from the ring buffer. */
export function getProviderScore(provider: ProviderId): ProviderScore {
  const events = allEvents().filter((e) => e.provider === provider);
  return _computeScore(provider, events);
}

/** Return ProviderScore for every provider that has any recorded events. */
export function getAllProviderScores(): ProviderScore[] {
  const events = allEvents();
  const byProvider = new Map<ProviderId, ScorecardEvent[]>();
  for (const e of events) {
    let arr = byProvider.get(e.provider);
    if (!arr) { arr = []; byProvider.set(e.provider, arr); }
    arr.push(e);
  }
  return [...byProvider.entries()].map(([id, evts]) => _computeScore(id, evts));
}

function _computeScore(provider: ProviderId, events: ScorecardEvent[]): ProviderScore {
  if (events.length === 0) {
    // Cold start — return optimistic defaults
    return {
      provider,
      sampleCount: 0,
      successRate: 1,
      avgConfidence: 1,
      avgUnknownFraction: 0,
      avgCacheHitFraction: 0,
      medianResolution: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      avgLicenseDiversity: 0,
      compositeScore: 1,
    };
  }

  const n = events.length;
  const successRate = events.filter((e) => e.ok).length / n;

  const avgConfidence = events.reduce((s, e) => s + e.avgConfidence, 0) / n;
  const avgUnknownFraction = events.reduce((s, e) => s + e.unknownFraction, 0) / n;
  const avgCacheHitFraction = events.reduce((s, e) => s + e.cacheHitFraction, 0) / n;
  const avgLicenseDiversity = events.reduce((s, e) => s + e.licenseDiversity, 0) / n;

  // Median resolution: collect all resolution values from events
  const allResolutions = events.map((e) => e.medianResolution).filter((r) => r > 0);
  const medianResolution = computeMedian(allResolutions);

  // Latency percentiles
  const sortedLatencies = events.map((e) => e.durationMs).sort((a, b) => a - b);
  const p50Ms = computePercentile(sortedLatencies, 50);
  const p95Ms = computePercentile(sortedLatencies, 95);
  const p99Ms = computePercentile(sortedLatencies, 99);

  // Composite score
  const compositeScore = _computeCompositeScore(
    successRate,
    avgConfidence,
    avgUnknownFraction,
    avgCacheHitFraction,
    p50Ms,
    WEIGHT_PRESETS.default,
  );

  return {
    provider,
    sampleCount: n,
    successRate,
    avgConfidence,
    avgUnknownFraction,
    avgCacheHitFraction,
    medianResolution,
    p50Ms,
    p95Ms,
    p99Ms,
    avgLicenseDiversity,
    compositeScore,
  };
}

function _computeCompositeScore(
  successRate: number,
  avgConfidence: number,
  avgUnknownFraction: number,
  avgCacheHitFraction: number,
  p50Ms: number,
  weights: SelectionWeights,
): number {
  // quality: high confidence + low unknown + cache bonus
  const qualityScore =
    avgConfidence * (1 - avgUnknownFraction) * (0.5 + 0.5 * avgCacheHitFraction);

  // latency: sigmoid penalty; p50=0 → 1.0, p50=2000ms → ~0.5, p50=∞ → 0
  const latencyScore = 1 / (1 + p50Ms / 2000);

  const total = weights.success + weights.quality + weights.latency;
  const composite =
    (weights.success * successRate + weights.quality * qualityScore + weights.latency * latencyScore) /
    total;

  return Math.max(0, Math.min(1, composite));
}

// ---------------------------------------------------------------------------
// Primary selection API
// ---------------------------------------------------------------------------

/**
 * Return providers ranked by composite scorecard score.
 *
 * Providers with no scorecard data sort by their index in `providers` (stable,
 * cold-start-friendly). When `licensePolicy` is `"open-only"` or `"cc0"`,
 * providers with high `avgUnknownFraction` get an additional penalty.
 *
 * @param providers          Candidate provider list (user hint or default set).
 * @param licensePolicy      Active license policy (influences quality weight).
 * @param userProvidersHint  When provided, these providers are always placed first
 *                           (explicit user preference preserved).
 * @param mode               Tuning preset for composite weights.
 */
export function selectProvidersForQuery(
  providers: ProviderId[],
  licensePolicy: LicensePolicy = "safe-only",
  userProvidersHint?: ProviderId[],
  mode: ProviderSelectionMode = "default",
  cacheHitPredictions?: Array<{ provider: ProviderId; rankScore: number }>,
  preferCachedProviders = false,
): ProviderId[] {
  if (providers.length <= 1) return providers;

  const weights = WEIGHT_PRESETS[mode];

  // Optional cache-hit prediction blend: when preferCachedProviders is set, mix
  // each provider's Bayesian cache-hit rankScore into its scorecard composite so
  // providers likely to serve from cache are tried first.
  const CACHE_BLEND = 0.35;
  const cacheRankMap = new Map<ProviderId, number>(
    (cacheHitPredictions ?? []).map((p) => [p.provider, p.rankScore]),
  );
  const blendCache = (provider: ProviderId, base: number): number => {
    if (!preferCachedProviders) return base;
    const cacheRank = cacheRankMap.get(provider);
    if (cacheRank === undefined) return base;
    return base * (1 - CACHE_BLEND) + cacheRank * CACHE_BLEND;
  };

  // Build score map (cold-start providers get compositeScore=1 — optimistic)
  const scoreMap = new Map<ProviderId, number>();
  const allScores = getAllProviderScores();
  for (const s of allScores) {
    // Apply license-policy penalty for open-only / cc0-heavy policies
    let score = _reweightedCompositeScore(s, weights, licensePolicy);
    scoreMap.set(s.provider, blendCache(s.provider, score));
  }

  // Providers not yet in scoreMap → cold start → score 1 (sorted to front by stable logic below)
  const ranked = [...providers].sort((a, b) => {
    const sa = scoreMap.get(a) ?? 1; // cold-start: optimistic
    const sb = scoreMap.get(b) ?? 1;
    const diff = sb - sa;
    if (Math.abs(diff) > 1e-9) return diff;
    // Tie-break: preserve original order
    return providers.indexOf(a) - providers.indexOf(b);
  });

  // If explicit user hint provided, those go first (in their original order),
  // followed by the scorecard-ranked remainder
  if (userProvidersHint && userProvidersHint.length > 0) {
    const hintSet = new Set(userProvidersHint);
    const hintOrdered = userProvidersHint.filter((p) => providers.includes(p));
    const rest = ranked.filter((p) => !hintSet.has(p));
    return [...hintOrdered, ...rest];
  }

  return ranked;
}

/**
 * Compute composite score with license-policy weighting applied.
 * Open-only / prefer-safe policies penalise high avgUnknownFraction providers.
 */
function _reweightedCompositeScore(
  score: ProviderScore,
  weights: SelectionWeights,
  policy: LicensePolicy,
): number {
  const {
    successRate,
    avgConfidence,
    avgUnknownFraction,
    avgCacheHitFraction,
    p50Ms,
  } = score;

  // For strict open policies, add an extra penalty for UNKNOWN-heavy providers
  let unknownPenaltyFactor = 1;
  if (policy === "open-only") {
    unknownPenaltyFactor = Math.max(0, 1 - avgUnknownFraction * 2);
  } else if (policy === "safe-only" || policy === "prefer-safe") {
    unknownPenaltyFactor = Math.max(0, 1 - avgUnknownFraction * 0.5);
  }

  const qualityScore =
    avgConfidence * (1 - avgUnknownFraction) * (0.5 + 0.5 * avgCacheHitFraction) *
    unknownPenaltyFactor;
  const latencyScore = 1 / (1 + p50Ms / 2000);

  const total = weights.success + weights.quality + weights.latency;
  const composite =
    (weights.success * successRate + weights.quality * qualityScore + weights.latency * latencyScore) /
    total;

  return Math.max(0, Math.min(1, composite));
}

// ---------------------------------------------------------------------------
// Snapshot export (for diagnostics / CLI display)
// ---------------------------------------------------------------------------

/** Return a read-only snapshot of all current provider scores, sorted by compositeScore desc. */
export function getScorecardSnapshot(): ProviderScore[] {
  return getAllProviderScores().sort((a, b) => b.compositeScore - a.compositeScore);
}

// ---------------------------------------------------------------------------
// Reset helper (test-only)
// ---------------------------------------------------------------------------

/** Reset all in-memory scorecard state. For tests only — do not call in production. */
export function _resetScorecard(): void {
  _ring.length = 0;
  _ringHead = 0;
  _ringSize = 0;
  _persistEnabled = false;
  _persistPath = null;
}
