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
// Reset helper (test-only)
// ---------------------------------------------------------------------------

export function _resetTelemetry(capacity = DEFAULT_CAPACITY): void {
  _buf = [];
  _head = 0;
  _size = 0;
  _capacity = capacity;
}
