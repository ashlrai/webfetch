/**
 * Federation diagnostics telemetry — circular buffer + aggregation.
 *
 * Instruments runProvider calls via emitProviderEvent(). Keeps a fixed-size
 * ring buffer (default 2000 entries) and exposes getFederationDiagnostics()
 * which aggregates over a sliding 5-minute window into a health dashboard.
 *
 * Intentionally no external dependencies — pure in-memory, zero I/O.
 */

import type { ErrorKind, ProviderId } from "./types.ts";
import { getBucketState } from "./rate-limit.ts";

// ---------------------------------------------------------------------------
// Event shape
// ---------------------------------------------------------------------------

export interface ProviderEvent {
  /** Provider that was invoked. */
  providerId: ProviderId;
  /** Unix-ms start timestamp. */
  startedAt: number;
  /** Unix-ms end timestamp. */
  endedAt: number;
  /** Wall-clock duration. */
  durationMs: number;
  /** Number of ImageCandidates returned (0 on error). */
  resultCount: number;
  /** Whether the call succeeded. */
  ok: boolean;
  /** Structured failure category (undefined on success). */
  errorKind?: ErrorKind;
  /** Free-form error message (undefined on success). */
  errorMessage?: string;
  /** Additional HTTP/decode context. */
  errorContext?: Record<string, unknown>;
  /** Approximate payload size in bytes (JSON-serialized result array). */
  payloadBytes: number;
}

// ---------------------------------------------------------------------------
// Circular buffer
// ---------------------------------------------------------------------------

const DEFAULT_CAPACITY = 2000;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

let _buf: ProviderEvent[] = [];
let _head = 0; // next write index
let _size = 0; // current logical size
let _capacity = DEFAULT_CAPACITY;

/**
 * Emit a structured event for a completed provider call. Called by federation.ts.
 */
export function emitProviderEvent(evt: ProviderEvent): void {
  if (_buf.length < _capacity) {
    _buf.push(evt);
  } else {
    _buf[_head] = evt;
  }
  _head = (_head + 1) % _capacity;
  _size = Math.min(_size + 1, _capacity);
}

/** Return all events in insertion order (oldest first). */
function allEvents(): ProviderEvent[] {
  if (_size < _capacity || _buf.length < _capacity) {
    // Buffer hasn't wrapped yet — simple slice
    return _buf.slice(0, _size);
  }
  // Wrapped: _head points to the oldest slot
  return [..._buf.slice(_head), ..._buf.slice(0, _head)];
}

/** Return events within the sliding window from now. */
function windowEvents(windowMs = WINDOW_MS): ProviderEvent[] {
  const cutoff = Date.now() - windowMs;
  return allEvents().filter((e) => e.startedAt >= cutoff);
}

// ---------------------------------------------------------------------------
// Diagnostics output types
// ---------------------------------------------------------------------------

export interface ProviderStats {
  id: ProviderId;
  avgLatencyMs: number;
  resultCount: number;
  errorRate: number;
  lastSuccess: number | null; // unix-ms, null if never succeeded in window
  nextTokenAt: number; // unix-ms when bucket next has a token (≈now if available)
  saturated: boolean;
}

export interface FederationSummary {
  totalRequests: number;
  avgFederationTimeMs: number;
  providersHealthy: number;
  providersRateLimited: number;
}

export interface FederationDiagnostics {
  providerStats: ProviderStats[];
  summary: FederationSummary;
  warnings: string[];
  windowMs: number;
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Provider ranking types (for /v1/federation-strategy endpoint)
// ---------------------------------------------------------------------------

/** A single provider's computed rank entry. */
export interface ProviderRankEntry {
  /** Provider identifier. */
  id: ProviderId;
  /** Composite health score in [0, 1]: 1 - errorRate - rateLimitPenalty. */
  healthScore: number;
  /** Average latency in ms over the diagnostics window (0 if no data). */
  avgLatencyMs: number;
  /** Error rate in [0, 1] over the diagnostics window. */
  errorRate: number;
  /** True when the rate-limit bucket is saturated. */
  saturated: boolean;
  /**
   * Predicted success rate: probability the next call succeeds
   * (0 when saturated, else 1 - errorRate, clamped to [0, 1]).
   */
  predictedSuccessRate: number;
  /**
   * Rank position (1 = best) under the 'healthiest' ordering.
   */
  rankHealthiest: number;
  /**
   * Rank position (1 = best) under the 'fastest' ordering.
   */
  rankFastest: number;
}

export interface ProviderRanking {
  /** Providers ordered best → worst by health score. */
  byHealth: ProviderRankEntry[];
  /** Providers ordered best → worst by avg latency (fastest first). */
  byLatency: ProviderRankEntry[];
  /** The window these stats were computed over. */
  windowMs: number;
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Provider sequence event (emitted per federated query)
// ---------------------------------------------------------------------------

export interface ProviderSequenceEvent {
  /** The query string that triggered this federation call. */
  query: string;
  /** Ordered list of provider IDs as dispatched (post-ranking). */
  dispatchOrder: ProviderId[];
  /** The preference mode that drove the ordering. */
  preference: "fastest" | "healthiest" | "default";
  /** Unix-ms when the federation call started. */
  startedAt: number;
}

const _sequenceBuf: ProviderSequenceEvent[] = [];
let _seqHead = 0;
let _seqSize = 0;
const SEQ_CAPACITY = 200;

/** Emit a provider-sequence event for a federation call. */
export function emitProviderSequenceEvent(evt: ProviderSequenceEvent): void {
  if (_sequenceBuf.length < SEQ_CAPACITY) {
    _sequenceBuf.push(evt);
  } else {
    _sequenceBuf[_seqHead] = evt;
  }
  _seqHead = (_seqHead + 1) % SEQ_CAPACITY;
  _seqSize = Math.min(_seqSize + 1, SEQ_CAPACITY);
}

/** Return recent provider-sequence events (newest first, up to limit). */
export function getProviderSequenceEvents(limit = 20): ProviderSequenceEvent[] {
  const all: ProviderSequenceEvent[] = [];
  if (_seqSize < SEQ_CAPACITY || _sequenceBuf.length < SEQ_CAPACITY) {
    all.push(..._sequenceBuf.slice(0, _seqSize));
  } else {
    all.push(..._sequenceBuf.slice(_seqHead), ..._sequenceBuf.slice(0, _seqHead));
  }
  return all.slice(-limit).reverse();
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function getFederationDiagnostics(windowMs = WINDOW_MS): FederationDiagnostics {
  const events = windowEvents(windowMs);
  const now = Date.now();
  const warnings: string[] = [];

  // Group by provider
  const byProvider = new Map<ProviderId, ProviderEvent[]>();
  for (const e of events) {
    let arr = byProvider.get(e.providerId);
    if (!arr) {
      arr = [];
      byProvider.set(e.providerId, arr);
    }
    arr.push(e);
  }

  const providerStats: ProviderStats[] = [];

  for (const [id, evts] of byProvider) {
    const total = evts.length;
    const errors = evts.filter((e) => !e.ok).length;
    const successes = evts.filter((e) => e.ok);

    const avgLatencyMs =
      total > 0 ? Math.round(evts.reduce((s, e) => s + e.durationMs, 0) / total) : 0;

    const resultCount = evts.reduce((s, e) => s + e.resultCount, 0);
    const errorRate = total > 0 ? errors / total : 0;

    const lastSuccessEvt = successes.length > 0 ? successes[successes.length - 1] : null;
    const lastSuccess = lastSuccessEvt ? lastSuccessEvt.endedAt : null;

    // Rate-limit state from bucket
    const bs = getBucketState(id);
    const nextTokenAt = bs.saturated ? now + bs.waitTimeMs : now;

    providerStats.push({
      id,
      avgLatencyMs,
      resultCount,
      errorRate: Math.round(errorRate * 1000) / 1000, // 3 decimal places
      lastSuccess,
      nextTokenAt,
      saturated: bs.saturated,
    });

    // Warnings
    if (errorRate >= 1.0 && total >= 3) {
      warnings.push(`${id}: 100% error rate over last ${total} calls in window`);
    } else if (errorRate > 0.5 && total >= 5) {
      warnings.push(`${id}: high error rate (${Math.round(errorRate * 100)}%) over ${total} calls`);
    }
    if (bs.saturated) {
      warnings.push(
        `${id}: rate-limit bucket saturated — next token at ${new Date(nextTokenAt).toISOString()}`,
      );
    }
    if (avgLatencyMs > 10_000 && total >= 2) {
      warnings.push(`${id}: high avg latency (${avgLatencyMs}ms)`);
    }
  }

  // Summary
  const totalRequests = events.length;
  const avgFederationTimeMs =
    totalRequests > 0
      ? Math.round(events.reduce((s, e) => s + e.durationMs, 0) / totalRequests)
      : 0;

  const providersHealthy = providerStats.filter((p) => p.errorRate < 0.5 && !p.saturated).length;
  const providersRateLimited = providerStats.filter(
    (p) => p.saturated || p.errorRate > 0 && events.filter(
      (e) => e.providerId === p.id && e.errorKind === "rate-limited"
    ).length > 0,
  ).length;

  return {
    providerStats,
    summary: {
      totalRequests,
      avgFederationTimeMs,
      providersHealthy,
      providersRateLimited,
    },
    warnings,
    windowMs,
    generatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Provider ranking computation
// ---------------------------------------------------------------------------

/**
 * Compute a ranked list of providers based on 5-min diagnostics.
 *
 * Health score = 1 - errorRate - rateLimitPenalty
 *   where rateLimitPenalty = 0.5 when saturated, else 0.
 *
 * Providers with no data in the window get healthScore=1, avgLatencyMs=0
 * (optimistic — prefer to try them over known-bad ones).
 */
export function getProviderRanking(
  providerIds: ProviderId[],
  windowMs = WINDOW_MS,
): ProviderRanking {
  const diag = getFederationDiagnostics(windowMs);
  const statsMap = new Map<ProviderId, ProviderStats>(diag.providerStats.map((s) => [s.id, s]));

  const entries: ProviderRankEntry[] = providerIds.map((id) => {
    const stats = statsMap.get(id);
    const errorRate = stats?.errorRate ?? 0;
    const avgLatencyMs = stats?.avgLatencyMs ?? 0;
    const saturated = stats?.saturated ?? false;
    const rateLimitPenalty = saturated ? 0.5 : 0;
    const healthScore = Math.max(0, Math.min(1, 1 - errorRate - rateLimitPenalty));
    const predictedSuccessRate = saturated ? 0 : Math.max(0, Math.min(1, 1 - errorRate));

    return {
      id,
      healthScore,
      avgLatencyMs,
      errorRate,
      saturated,
      predictedSuccessRate,
      rankHealthiest: 0, // filled below
      rankFastest: 0,
    };
  });

  // Healthiest order: higher healthScore first; ties broken by lower latency.
  const byHealth = [...entries].sort((a, b) => {
    const hDiff = b.healthScore - a.healthScore;
    if (Math.abs(hDiff) > 1e-9) return hDiff;
    return a.avgLatencyMs - b.avgLatencyMs;
  });

  // Fastest order: lower latency first; ties broken by higher health score.
  // Providers with no latency data (avgLatencyMs=0 but also no events) sort last
  // so we don't blindly prefer untested providers as "fastest".
  const byLatency = [...entries].sort((a, b) => {
    const statsA = statsMap.get(a.id);
    const statsB = statsMap.get(b.id);
    const hasDataA = statsA !== undefined;
    const hasDataB = statsB !== undefined;
    // No-data providers go after ones with data
    if (hasDataA !== hasDataB) return hasDataA ? -1 : 1;
    const latDiff = a.avgLatencyMs - b.avgLatencyMs;
    if (Math.abs(latDiff) > 0) return latDiff;
    return b.healthScore - a.healthScore;
  });

  // Stamp rank positions (1-based)
  byHealth.forEach((e, i) => { e.rankHealthiest = i + 1; });
  byLatency.forEach((e, i) => { e.rankFastest = i + 1; });

  // Sync rank fields back into both arrays (they share object references)
  // Nothing to do — arrays share the same entry objects via spread-copy of
  // primitives, so we need to cross-update via the id map.
  const rankMap = new Map<ProviderId, { rankHealthiest: number; rankFastest: number }>();
  byHealth.forEach((e, i) => {
    rankMap.set(e.id, { rankHealthiest: i + 1, rankFastest: 0 });
  });
  byLatency.forEach((e, i) => {
    const r = rankMap.get(e.id);
    if (r) r.rankFastest = i + 1;
  });
  // Apply back to all entries arrays
  for (const e of byHealth) {
    const r = rankMap.get(e.id);
    if (r) { e.rankHealthiest = r.rankHealthiest; e.rankFastest = r.rankFastest; }
  }
  for (const e of byLatency) {
    const r = rankMap.get(e.id);
    if (r) { e.rankHealthiest = r.rankHealthiest; e.rankFastest = r.rankFastest; }
  }

  return { byHealth, byLatency, windowMs, generatedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Provider health recommendations
// ---------------------------------------------------------------------------

/**
 * Per-provider health status derived from the 5-minute event window and
 * rate-limit bucket state.
 *
 * - `healthy`    — low error rate, bucket available.
 * - `degraded`   — elevated error rate (>20%) but not fully failed.
 * - `saturated`  — rate-limit bucket is exhausted; should back off.
 * - `unavailable`— 100% error rate over ≥3 calls in the window.
 */
export type ProviderHealthStatus = "healthy" | "degraded" | "saturated" | "unavailable";

/** A single entry in the ranked provider recommendation list. */
export interface ProviderRecommendation {
  /** Provider identifier. */
  id: ProviderId;
  /** Composite health status. */
  status: ProviderHealthStatus;
  /**
   * Composite score in [0, 1] used for ranking.
   * score = (1 - errorRate) * throughputWeight * latencyWeight - saturationPenalty
   * Higher is better.
   */
  score: number;
  /** Median (p50) latency in ms over the window (0 if no data). */
  latencyP50Ms: number;
  /** Error rate in [0, 1] over the window (0 if no data). */
  errorRate: number;
  /** Total successful result count over the window. */
  throughput: number;
  /**
   * Estimated recovery time in ms from rate-limit saturation (0 when not
   * saturated). Derived from the token-bucket waitTimeMs.
   */
  estimatedRecoveryMs: number;
  /** Rank position (1 = best). */
  rank: number;
}

/** Suggested fallback chain + per-provider health dashboard. */
export interface ProviderRecommendations {
  /**
   * Providers ranked best → worst by composite score
   * (latency_p50, error_rate, throughput weighted together).
   */
  rankedProviders: ProviderRecommendation[];
  /**
   * Suggested fallback chain ordered by reliability.
   * Only includes providers with status healthy or degraded; saturated/unavailable
   * providers are omitted from the chain.
   */
  suggestedFallbackChain: ProviderId[];
  /** Window these recommendations were computed over. */
  windowMs: number;
  generatedAt: number;
}

/** Full federation health report: diagnostics + recommendations. */
export interface FederationHealthReport {
  diagnostics: FederationDiagnostics;
  recommendations: ProviderRecommendations;
}

/**
 * Compute p50 (median) of a numeric array. Returns 0 for empty arrays.
 */
function percentile50(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Derive ProviderHealthStatus from error rate and saturation state.
 */
function deriveStatus(
  errorRate: number,
  saturated: boolean,
  sampleCount: number,
): ProviderHealthStatus {
  if (saturated) return "saturated";
  if (sampleCount >= 3 && errorRate >= 1.0) return "unavailable";
  if (errorRate > 0.2) return "degraded";
  return "healthy";
}

/**
 * Analyze the 5-minute event window and compute ranked provider
 * recommendations with suggested fallback chains.
 *
 * Scoring formula per provider:
 *   latencyWeight = 1 / (1 + latencyP50Ms / 1000)   — sigmoid-shaped latency penalty
 *   throughputNorm = min(throughput / 10, 1)          — normalised (10 results = full score)
 *   baseScore = (1 - errorRate) * latencyWeight * (0.7 + 0.3 * throughputNorm)
 *   score = saturated ? 0 : baseScore
 */
export function computeProviderRecommendations(
  windowMs = WINDOW_MS,
): ProviderRecommendations {
  const diag = getFederationDiagnostics(windowMs);
  const events = windowEvents(windowMs);

  // Build per-provider latency arrays for p50 computation
  const latencyMap = new Map<ProviderId, number[]>();
  for (const e of events) {
    let arr = latencyMap.get(e.providerId);
    if (!arr) {
      arr = [];
      latencyMap.set(e.providerId, arr);
    }
    arr.push(e.durationMs);
  }

  const now = Date.now();
  const recommendations: ProviderRecommendation[] = [];

  for (const stat of diag.providerStats) {
    const latencies = latencyMap.get(stat.id) ?? [];
    const latencyP50Ms = percentile50(latencies);

    const status = deriveStatus(stat.errorRate, stat.saturated, latencies.length);

    // Scoring
    const latencyWeight = 1 / (1 + latencyP50Ms / 1000);
    const throughputNorm = Math.min(stat.resultCount / 10, 1);
    const baseScore = (1 - stat.errorRate) * latencyWeight * (0.7 + 0.3 * throughputNorm);
    const score = stat.saturated ? 0 : Math.max(0, Math.min(1, baseScore));

    // Recovery estimate from bucket state
    const bs = getBucketState(stat.id);
    const estimatedRecoveryMs = bs.saturated ? bs.waitTimeMs : 0;

    recommendations.push({
      id: stat.id,
      status,
      score,
      latencyP50Ms,
      errorRate: stat.errorRate,
      throughput: stat.resultCount,
      estimatedRecoveryMs,
      rank: 0, // filled below
    });
  }

  // Sort by score descending; ties broken by latencyP50Ms ascending
  recommendations.sort((a, b) => {
    const sDiff = b.score - a.score;
    if (Math.abs(sDiff) > 1e-9) return sDiff;
    return a.latencyP50Ms - b.latencyP50Ms;
  });

  // Stamp 1-based ranks
  recommendations.forEach((r, i) => {
    r.rank = i + 1;
  });

  // Suggested fallback chain: healthy/degraded providers only, in rank order
  const suggestedFallbackChain: ProviderId[] = recommendations
    .filter((r) => r.status === "healthy" || r.status === "degraded")
    .map((r) => r.id);

  return {
    rankedProviders: recommendations,
    suggestedFallbackChain,
    windowMs,
    generatedAt: now,
  };
}

/**
 * Produce a complete federation health report combining diagnostics and
 * recommendations in a single call. Safe to call frequently — pure in-memory,
 * no I/O.
 */
export function getFederationHealthReport(windowMs = WINDOW_MS): FederationHealthReport {
  return {
    diagnostics: getFederationDiagnostics(windowMs),
    recommendations: computeProviderRecommendations(windowMs),
  };
}

// ---------------------------------------------------------------------------
// Reset helper (test-only)
// ---------------------------------------------------------------------------

export function _resetTelemetry(capacity = DEFAULT_CAPACITY): void {
  _buf = [];
  _head = 0;
  _size = 0;
  _capacity = capacity;
  // Also reset sequence buffer
  _sequenceBuf.length = 0;
  _seqHead = 0;
  _seqSize = 0;
}
