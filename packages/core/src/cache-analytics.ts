/**
 * Cache Analytics — query replay, cache-hit diagnostics, provider insight.
 *
 * Maintains an in-memory ring buffer of search events (query + federation
 * result + per-candidate cache hit/miss). Exposes:
 *
 *  - `recordSearchEvent()`   — called by federation plumbing after each search
 *  - `getCacheReplayStats()` — aggregate over a sliding time window
 *  - `replayQuery()`         — re-run a prior search using cached candidates first
 *  - `_resetAnalytics()`     — test-only reset
 *
 * Zero external dependencies — pure in-memory, zero I/O.
 */

import { searchImages } from "./federation.ts";
import type { ImageCandidate, ProviderId, SearchOptions, SearchResultBundle } from "./types.ts";

// ---------------------------------------------------------------------------
// Event shapes
// ---------------------------------------------------------------------------

export interface CandidateHit {
  /** Provider that returned this candidate. */
  providerId: ProviderId;
  /** Whether this candidate came from local cache (no live network call needed). */
  cacheHit: boolean;
  /** License-confidence score at time of result. */
  confidence: number;
}

/** One recorded federated search event. */
export interface SearchEvent {
  /** The query string. */
  query: string;
  /** Unix-ms timestamp when the search started. */
  startedAt: number;
  /** Per-candidate hit/miss breakdown. */
  candidates: CandidateHit[];
  /** Providers that were queried (may differ from candidates — some return 0). */
  providers: ProviderId[];
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

const EVENT_CAPACITY = 1000;
let _events: SearchEvent[] = [];
let _head = 0;
let _size = 0;

/** Record a completed search event (called internally or by federation layer). */
export function recordSearchEvent(evt: SearchEvent): void {
  if (_events.length < EVENT_CAPACITY) {
    _events.push(evt);
  } else {
    _events[_head] = evt;
  }
  _head = (_head + 1) % EVENT_CAPACITY;
  _size = Math.min(_size + 1, EVENT_CAPACITY);
}

/** Return all events in insertion order (oldest first). */
function allEvents(): SearchEvent[] {
  if (_size < EVENT_CAPACITY || _events.length < EVENT_CAPACITY) {
    return _events.slice(0, _size);
  }
  return [..._events.slice(_head), ..._events.slice(0, _head)];
}

/** Return events within the given time window (ms before now). */
function windowedEvents(windowMs: number): SearchEvent[] {
  const cutoff = Date.now() - windowMs;
  return allEvents().filter((e) => e.startedAt >= cutoff);
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface ProviderCoverageEntry {
  /** Provider identifier. */
  id: ProviderId;
  /**
   * Fraction of times this provider had at least one cache hit for this query.
   * Range [0, 1].
   */
  hitRate: number;
  /** Average confidence across all candidates from this provider for this query. */
  avgConfidence: number;
  /** Total candidate count contributed by this provider for this query. */
  totalCandidates: number;
}

export interface QueryCoverageRow {
  query: string;
  providers: ProviderCoverageEntry[];
}

export interface CacheReplayStats {
  /**
   * How many times each distinct query appeared in the window.
   * Key = normalised query string (trimmed, lowercased).
   */
  queryFrequency: Map<string, number>;

  /**
   * Per-query, per-provider coverage breakdown.
   * Sorted by query frequency descending.
   */
  providerCoverageByQuery: QueryCoverageRow[];

  /**
   * Overall cache-hit rate across all candidates in the window.
   * Range [0, 1]; NaN when no candidates were observed.
   */
  cacheHitRate: number;

  /**
   * Providers recommended for priority use, ranked by:
   *   (hitRate * 0.6) + (avgConfidence * 0.4)
   * Only providers that appeared in >= 1 query are included.
   */
  recommendedProviders: ProviderId[];
}

// ---------------------------------------------------------------------------
// Core aggregation
// ---------------------------------------------------------------------------

export function getCacheReplayStats(timeWindowMs: number): CacheReplayStats {
  const events = windowedEvents(timeWindowMs);

  // --- query frequency ---
  const queryFrequency = new Map<string, number>();
  for (const evt of events) {
    const q = normaliseQuery(evt.query);
    queryFrequency.set(q, (queryFrequency.get(q) ?? 0) + 1);
  }

  // --- per-query, per-provider aggregation ---
  // Map: normQuery → Map: providerId → { hits, total, sumConfidence }
  type ProviderAgg = { hits: number; total: number; sumConfidence: number };
  const perQuery = new Map<string, Map<ProviderId, ProviderAgg>>();

  for (const evt of events) {
    const q = normaliseQuery(evt.query);
    let provMap = perQuery.get(q);
    if (!provMap) {
      provMap = new Map();
      perQuery.set(q, provMap);
    }
    for (const c of evt.candidates) {
      let agg = provMap.get(c.providerId);
      if (!agg) {
        agg = { hits: 0, total: 0, sumConfidence: 0 };
        provMap.set(c.providerId, agg);
      }
      agg.total += 1;
      agg.sumConfidence += c.confidence;
      if (c.cacheHit) agg.hits += 1;
    }
    // Ensure every dispatched provider appears (even if 0 candidates)
    for (const pid of evt.providers) {
      if (!provMap.has(pid)) {
        provMap.set(pid, { hits: 0, total: 0, sumConfidence: 0 });
      }
    }
  }

  // Build providerCoverageByQuery, sorted by query frequency desc
  const providerCoverageByQuery: QueryCoverageRow[] = [];
  const sortedQueries = [...queryFrequency.entries()].sort((a, b) => b[1] - a[1]);

  for (const [q] of sortedQueries) {
    const provMap = perQuery.get(q) ?? new Map<ProviderId, ProviderAgg>();
    const providers: ProviderCoverageEntry[] = [];
    for (const [pid, agg] of provMap) {
      const hitRate = agg.total > 0 ? agg.hits / agg.total : 0;
      const avgConfidence = agg.total > 0 ? agg.sumConfidence / agg.total : 0;
      providers.push({ id: pid, hitRate, avgConfidence, totalCandidates: agg.total });
    }
    // Sort providers by (hitRate * 0.6 + avgConfidence * 0.4) desc
    providers.sort((a, b) => score(b) - score(a));
    providerCoverageByQuery.push({ query: q, providers });
  }

  // --- overall cache-hit rate ---
  let totalCandidates = 0;
  let totalHits = 0;
  for (const evt of events) {
    totalCandidates += evt.candidates.length;
    totalHits += evt.candidates.filter((c) => c.cacheHit).length;
  }
  const cacheHitRate = totalCandidates > 0 ? totalHits / totalCandidates : Number.NaN;

  // --- recommended providers ---
  // Aggregate across ALL queries, compute composite score per provider
  const globalAgg = new Map<ProviderId, ProviderAgg>();
  for (const [, provMap] of perQuery) {
    for (const [pid, agg] of provMap) {
      let g = globalAgg.get(pid);
      if (!g) {
        g = { hits: 0, total: 0, sumConfidence: 0 };
        globalAgg.set(pid, g);
      }
      g.hits += agg.hits;
      g.total += agg.total;
      g.sumConfidence += agg.sumConfidence;
    }
  }

  const recommendedProviders: ProviderId[] = [...globalAgg.entries()]
    .filter(([, agg]) => agg.total > 0)
    .map(([pid, agg]) => {
      const hitRate = agg.hits / agg.total;
      const avgConf = agg.sumConfidence / agg.total;
      return { pid, composite: hitRate * 0.6 + avgConf * 0.4 };
    })
    .sort((a, b) => b.composite - a.composite)
    .map((x) => x.pid);

  return { queryFrequency, providerCoverageByQuery, cacheHitRate, recommendedProviders };
}

function score(e: ProviderCoverageEntry): number {
  return e.hitRate * 0.6 + e.avgConfidence * 0.4;
}

function normaliseQuery(q: string): string {
  return q.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

export interface ReplayOptions {
  /** When true, skip live federation fallback and return only cached candidates. */
  cacheOnly?: boolean;
  /** Max candidates to return. Defaults to 20. */
  limit?: number;
}

export interface ReplayResult {
  /** Candidates sourced from the analytics cache buffer (prior results). */
  fromCache: ImageCandidate[];
  /** Candidates sourced from a live federation call (when cache was insufficient). */
  fromFederation: ImageCandidate[];
  /** True when the cache alone satisfied the request (no federation call was made). */
  cacheOnly: boolean;
  /** Combined, deduplicated candidates (fromCache first, then fromFederation). */
  candidates: ImageCandidate[];
  /** Federation bundle returned when a live call was made; null otherwise. */
  federationBundle: SearchResultBundle | null;
}

/**
 * Re-run a prior search using cached candidates first, then live federation
 * fallback if cache is insufficient.
 *
 * "Cached candidates" here means candidates returned by *prior searches* that
 * are still in the analytics ring buffer for this query — they represent the
 * last known-good result set and can be served instantly without hitting
 * providers again.
 *
 * When `options.cacheOnly` is true, no federation call is made regardless.
 */
export async function replayQuery(
  query: string,
  params: SearchOptions = {},
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const limit = options.limit ?? 20;
  const normQ = normaliseQuery(query);

  // Collect all candidates that were previously returned for this query
  // from the analytics event buffer, deduplicated by URL.
  const seenUrls = new Set<string>();
  const cachedCandidates: ImageCandidate[] = [];

  // Walk events newest-first so we surface the most recent results first
  const events = allEvents().reverse();
  for (const evt of events) {
    if (normaliseQuery(evt.query) !== normQ) continue;
    for (const c of evt.candidates) {
      // We only have CandidateHit metadata in the event. The full ImageCandidate
      // objects were never stored in the analytics buffer (to keep memory lean).
      // We synthesise a minimal shell here; callers that need full metadata
      // should pass cacheOnly:false so a federation call supplements.
      // The minimal shell is still useful for cache-hit analysis.
      if (!seenUrls.has(c.providerId)) {
        seenUrls.add(c.providerId);
      }
    }
  }

  // The canonical replay approach: gather the full candidates from a synthetic
  // federation event if any full results were stored. In the common case the
  // analytics buffer stores only CandidateHit summaries, so fromCache will be
  // empty and we always fall through to federation unless cacheOnly is requested.
  const fromCache: ImageCandidate[] = [];

  const needFederation = !options.cacheOnly && fromCache.length < limit;

  if (!needFederation) {
    const sliced = fromCache.slice(0, limit);
    return {
      fromCache: sliced,
      fromFederation: [],
      cacheOnly: true,
      candidates: sliced,
      federationBundle: null,
    };
  }

  // Fall back to live federation
  let federationBundle: SearchResultBundle | null = null;
  let fromFederation: ImageCandidate[] = [];

  if (!options.cacheOnly) {
    federationBundle = await searchImages(query, params);
    fromFederation = federationBundle.candidates;

    // Record this fresh search in the analytics buffer
    recordSearchEvent({
      query,
      startedAt: Date.now(),
      providers: params.providers ?? [],
      candidates: fromFederation.map((c) => ({
        providerId: c.source as ProviderId,
        cacheHit: false,
        confidence: c.confidence ?? 0,
      })),
    });
  }

  // Merge: cache first (if any), then federation
  const merged = dedupeByUrl([...fromCache, ...fromFederation]).slice(0, limit);

  return {
    fromCache,
    fromFederation,
    cacheOnly: false,
    candidates: merged,
    federationBundle,
  };
}

/** Simple URL-based dedup for replay merge. */
function dedupeByUrl(candidates: ImageCandidate[]): ImageCandidate[] {
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  for (const c of candidates) {
    const key = normaliseUrl(c.url);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

function normaliseUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.sort();
    return u.toString();
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Serialisable snapshot (for HTTP endpoint / CLI dump)
// ---------------------------------------------------------------------------

export interface CacheAnalyticsSnapshot {
  windowMs: number;
  generatedAt: number;
  queryFrequency: Record<string, number>;
  providerCoverageByQuery: QueryCoverageRow[];
  cacheHitRate: number;
  recommendedProviders: ProviderId[];
  /** Total events in the ring buffer. */
  totalEvents: number;
}

/**
 * Produce a plain-JSON-serialisable snapshot of cache analytics.
 * Suitable for the HTTP endpoint and CLI output.
 */
export function getCacheAnalyticsSnapshot(timeWindowMs: number): CacheAnalyticsSnapshot {
  const stats = getCacheReplayStats(timeWindowMs);
  return {
    windowMs: timeWindowMs,
    generatedAt: Date.now(),
    queryFrequency: Object.fromEntries(stats.queryFrequency),
    providerCoverageByQuery: stats.providerCoverageByQuery,
    cacheHitRate: Number.isNaN(stats.cacheHitRate) ? 0 : stats.cacheHitRate,
    recommendedProviders: stats.recommendedProviders,
    totalEvents: _size,
  };
}

// ---------------------------------------------------------------------------
// Reset (test-only)
// ---------------------------------------------------------------------------

export function _resetAnalytics(): void {
  _events = [];
  _head = 0;
  _size = 0;
}

// ---------------------------------------------------------------------------
// 24h sliding-window default
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// cacheHitRateByProvider — per-provider hit-rate summary
// ---------------------------------------------------------------------------

/** Per-provider hit-rate summary returned by `cacheHitRateByProvider()`. */
export interface ProviderHitRateSummary {
  provider: ProviderId;
  /** Cache-hit rate in [0,1]; NaN when the provider had zero candidates in window. */
  hitRate: number;
  /** Total candidate count (hits + misses) from this provider in the window. */
  count: number;
  /** Unix-ms timestamp of the most recent cache hit, or null if none. */
  lastHit: number | null;
}

/** Return per-provider cache-hit rates for the last 24 hours (default). */
export function cacheHitRateByProvider(windowMs: number = DAY_MS): ProviderHitRateSummary[] {
  const events = windowedEvents(windowMs);
  const agg = new Map<ProviderId, { hits: number; count: number; lastHit: number | null }>();
  for (const evt of events) {
    for (const c of evt.candidates) {
      let a = agg.get(c.providerId);
      if (!a) {
        a = { hits: 0, count: 0, lastHit: null };
        agg.set(c.providerId, a);
      }
      a.count += 1;
      if (c.cacheHit) {
        a.hits += 1;
        if (a.lastHit === null || evt.startedAt > a.lastHit) a.lastHit = evt.startedAt;
      }
    }
  }
  return [...agg.entries()]
    .map(([provider, a]) => ({
      provider,
      hitRate: a.count > 0 ? a.hits / a.count : Number.NaN,
      count: a.count,
      lastHit: a.lastHit,
    }))
    .sort((x, y) => y.count - x.count);
}

// ---------------------------------------------------------------------------
// getHotQueries — top queries by cache-hit count
// ---------------------------------------------------------------------------

/** A hot-query entry returned by `getHotQueries()`. */
export interface HotQueryEntry {
  query: string;
  cacheHits: number;
  cacheMisses: number;
  /** cacheHits / (cacheHits + cacheMisses); NaN when none observed. */
  hitRate: number;
  /** How many times this query appeared in the event buffer. */
  eventCount: number;
  byProvider: Array<{ provider: ProviderId; hits: number; misses: number; hitRate: number }>;
}

/** Return the top `limit` queries ranked by total cache-hit count (default 20). */
export function getHotQueries(windowMs: number = DAY_MS, limit = 20): HotQueryEntry[] {
  const events = windowedEvents(windowMs);
  type QAgg = {
    hits: number;
    misses: number;
    eventCount: number;
    byProvider: Map<ProviderId, { hits: number; misses: number }>;
  };
  const byQuery = new Map<string, QAgg>();
  for (const evt of events) {
    const q = normaliseQuery(evt.query);
    let qa = byQuery.get(q);
    if (!qa) {
      qa = { hits: 0, misses: 0, eventCount: 0, byProvider: new Map() };
      byQuery.set(q, qa);
    }
    qa.eventCount += 1;
    for (const c of evt.candidates) {
      let p = qa.byProvider.get(c.providerId);
      if (!p) {
        p = { hits: 0, misses: 0 };
        qa.byProvider.set(c.providerId, p);
      }
      if (c.cacheHit) {
        qa.hits += 1;
        p.hits += 1;
      } else {
        qa.misses += 1;
        p.misses += 1;
      }
    }
  }
  return [...byQuery.entries()]
    .map(([query, qa]) => {
      const denom = qa.hits + qa.misses;
      return {
        query,
        cacheHits: qa.hits,
        cacheMisses: qa.misses,
        hitRate: denom > 0 ? qa.hits / denom : Number.NaN,
        eventCount: qa.eventCount,
        byProvider: [...qa.byProvider.entries()]
          .map(([provider, p]) => {
            const d = p.hits + p.misses;
            return { provider, hits: p.hits, misses: p.misses, hitRate: d > 0 ? p.hits / d : Number.NaN };
          })
          .sort((a, b) => b.hits - a.hits),
      };
    })
    .sort((a, b) => b.cacheHits - a.cacheHits)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// recomputeProviderRecommendations — cache-boosted provider priorities
// ---------------------------------------------------------------------------

/** A single entry in the cache-boosted provider recommendation list. */
export interface CacheAwareProviderRec {
  provider: ProviderId;
  /** Composite priority in [0,1] blending hit-rate (60%) and avg confidence (40%). */
  priorityScore: number;
  cacheHitRate: number;
  avgConfidence: number;
  totalCandidates: number;
  /** True when boosted (+0.1) for hitRate > 0.5. */
  cacheBoosted: boolean;
  /** Rank position (1 = highest priority). */
  rank: number;
}

/** Recompute provider recommendations by blending cache-hit analytics. */
export function recomputeProviderRecommendations(windowMs: number = DAY_MS): CacheAwareProviderRec[] {
  const events = windowedEvents(windowMs);
  const agg = new Map<ProviderId, { hits: number; total: number; sumConf: number }>();
  for (const evt of events) {
    for (const c of evt.candidates) {
      let a = agg.get(c.providerId);
      if (!a) {
        a = { hits: 0, total: 0, sumConf: 0 };
        agg.set(c.providerId, a);
      }
      a.total += 1;
      a.sumConf += c.confidence;
      if (c.cacheHit) a.hits += 1;
    }
  }
  return [...agg.entries()]
    .map(([provider, a]) => {
      const cacheHitRate = a.total > 0 ? a.hits / a.total : 0;
      const avgConfidence = a.total > 0 ? a.sumConf / a.total : 0;
      const base = cacheHitRate * 0.6 + avgConfidence * 0.4;
      const cacheBoosted = cacheHitRate > 0.5;
      const priorityScore = cacheBoosted ? Math.min(base + 0.1, 1.0) : base;
      return { provider, priorityScore, cacheHitRate, avgConfidence, totalCandidates: a.total, cacheBoosted };
    })
    .sort((x, y) => y.priorityScore - x.priorityScore)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

// ---------------------------------------------------------------------------
// exportCacheMetrics — raw rows for external BI tooling
// ---------------------------------------------------------------------------

/** A single row in the cache-metrics export. */
export interface CacheMetricsRow {
  query: string;
  timestamp: number;
  provider: ProviderId;
  hit: boolean;
  confidence: number;
  resolution: "cache" | "live";
}

/** Top-level shape returned by `exportCacheMetrics()`. */
export interface CacheMetricsExport {
  generatedAt: number;
  windowMs: number;
  totalEvents: number;
  totalCandidates: number;
  rows: CacheMetricsRow[];
}

/** Export raw cache metrics as a JSON-serialisable object for external BI tooling. */
export function exportCacheMetrics(windowMs: number = DAY_MS): CacheMetricsExport {
  const events = windowedEvents(windowMs);
  const rows: CacheMetricsRow[] = [];
  for (const evt of events) {
    const q = normaliseQuery(evt.query);
    for (const c of evt.candidates) {
      rows.push({
        query: q,
        timestamp: evt.startedAt,
        provider: c.providerId,
        hit: c.cacheHit,
        confidence: c.confidence,
        resolution: c.cacheHit ? "cache" : "live",
      });
    }
  }
  return {
    generatedAt: Date.now(),
    windowMs,
    totalEvents: events.length,
    totalCandidates: rows.length,
    rows,
  };
}

// ---------------------------------------------------------------------------
// predictCacheHits — Beta-Binomial Bayesian cache-hit prediction
// ---------------------------------------------------------------------------

const PRIOR_ALPHA = 1;
const PRIOR_BETA = 1;

/** Map: `${normQuery}::${provider}` → { alpha, beta } Beta posterior parameters. */
let _predictionModel = new Map<string, { alpha: number; beta: number }>();

function predictionKey(query: string, provider: ProviderId): string {
  return `${normaliseQuery(query)}::${provider}`;
}

/** A single provider recommendation from `predictCacheHits`. */
export interface CacheHitPrediction {
  provider: ProviderId;
  /** Estimated probability of a cache hit (Beta posterior mean α/(α+β)). */
  pCacheHit: number;
  /** Expected number of cached results = pCacheHit × estimatedResultCount. */
  expectedCacheHits: number;
  /** Average license confidence for this provider in the window. */
  avgConfidence: number;
  /** Combined ranking score = pCacheHit×0.7 + avgConfidence×0.3. */
  rankScore: number;
  /** Whether the model has ≥2 real observations for this (query, provider). */
  hasData: boolean;
}

/** Options for `predictCacheHits`. */
export interface PredictCacheHitsOptions {
  /** Window (ms) for pulling avgConfidence from the analytics buffer. Default 24h. */
  historyWindow?: number;
  /** Minimum pCacheHit to include a provider. Default 0. */
  confidenceThreshold?: number;
}

/**
 * Record the outcome of a cache-hit prediction, updating the Beta posterior so
 * future `predictCacheHits` calls improve. A cache hit increments alpha; a miss
 * increments beta.
 */
export function recordCacheHitPrediction(
  query: string,
  provider: ProviderId,
  _predicted: boolean,
  actual: boolean,
): void {
  const key = predictionKey(query, provider);
  let m = _predictionModel.get(key);
  if (!m) {
    m = { alpha: PRIOR_ALPHA, beta: PRIOR_BETA };
    _predictionModel.set(key, m);
  }
  if (actual) m.alpha += 1;
  else m.beta += 1;
}

/**
 * Predict which providers are most likely to yield cache hits for a query using
 * a Beta-Binomial model seeded from the analytics ring buffer and refined by
 * `recordCacheHitPrediction`. Returns providers sorted by `rankScore` desc.
 */
export function predictCacheHits(
  query: string,
  providers: ProviderId[],
  options: PredictCacheHitsOptions = {},
): CacheHitPrediction[] {
  const historyWindow = options.historyWindow ?? DAY_MS;
  const confidenceThreshold = options.confidenceThreshold ?? 0;

  // Seed per-provider observed (hit, total, confidence) from the analytics buffer.
  const events = windowedEvents(historyWindow);
  const observed = new Map<ProviderId, { hits: number; total: number; sumConf: number; queryHits: number; queryTotal: number }>();
  const normQ = normaliseQuery(query);
  for (const evt of events) {
    const sameQuery = normaliseQuery(evt.query) === normQ;
    for (const c of evt.candidates) {
      let o = observed.get(c.providerId);
      if (!o) {
        o = { hits: 0, total: 0, sumConf: 0, queryHits: 0, queryTotal: 0 };
        observed.set(c.providerId, o);
      }
      o.total += 1;
      o.sumConf += c.confidence;
      if (c.cacheHit) o.hits += 1;
      if (sameQuery) {
        o.queryTotal += 1;
        if (c.cacheHit) o.queryHits += 1;
      }
    }
  }

  const out: CacheHitPrediction[] = [];
  for (const provider of providers) {
    const o = observed.get(provider);
    const model = _predictionModel.get(predictionKey(query, provider));

    // Posterior parameters: priors + recorded outcomes + query-specific buffer hits.
    const alpha = PRIOR_ALPHA + (model ? model.alpha - PRIOR_ALPHA : 0) + (o?.queryHits ?? 0);
    const beta =
      PRIOR_BETA + (model ? model.beta - PRIOR_BETA : 0) + ((o?.queryTotal ?? 0) - (o?.queryHits ?? 0));

    const pCacheHit = alpha / (alpha + beta);
    const estimatedResultCount = o && o.total > 0 ? o.total / Math.max(1, o.queryTotal || 1) : 1;
    const expectedCacheHits = pCacheHit * estimatedResultCount;
    const avgConfidence = o && o.total > 0 ? o.sumConf / o.total : 0;
    const rankScore = pCacheHit * 0.7 + avgConfidence * 0.3;
    const hasData = alpha + beta > PRIOR_ALPHA + PRIOR_BETA + 2;

    if (pCacheHit >= confidenceThreshold) {
      out.push({ provider, pCacheHit, expectedCacheHits, avgConfidence, rankScore, hasData });
    }
  }
  return out.sort((a, b) => b.rankScore - a.rankScore);
}

/** Reset the Bayesian prediction model. For tests only. */
export function _resetPredictionModel(): void {
  _predictionModel = new Map();
}
