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
  /**
   * Comparative performance ranking: narrative insights per provider
   * (e.g. "Unsplash consistently fastest; Bing has 15% timeouts").
   * Only populated for providers that have data in the window.
   */
  performanceInsights: PerformanceInsight[];
  /**
   * License-coverage heatmap: which providers returned the most OPEN vs
   * UNKNOWN results, based on each provider's known license profile.
   */
  licenseCoverageHeatmap: LicenseCoverageHeatmap;
  /**
   * Per-query-category provider selection advice.
   * e.g. for "portraits" → prioritize wikimedia + spotify.
   */
  perQueryAdvice: PerQueryAdvice[];
  /**
   * Cost-benefit analysis per provider: free vs paid, license profile,
   * gap-coverage verdict.
   */
  costBenefitAnalysis: CostBenefitEntry[];
  /** Window these recommendations were computed over. */
  windowMs: number;
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Enhanced recommendation types
// ---------------------------------------------------------------------------

/**
 * Narrative performance insight for a provider, comparing it to peers.
 * e.g. "Unsplash is the fastest provider (p50=120ms, 2.4× faster than average)"
 */
export interface PerformanceInsight {
  /** Provider this insight describes. */
  providerId: ProviderId;
  /**
   * Short human-readable summary suitable for display in a diagnostics dashboard.
   * e.g. "Unsplash consistently fastest (p50=120ms). Bing has 15% timeouts."
   */
  summary: string;
  /** p50 latency for this provider in ms (0 = no data). */
  latencyP50Ms: number;
  /** Ratio of this provider's p50 to the fleet average p50 (<1 = faster than average). */
  relativeLatency: number;
  /** Timeout/error rate over the window (0–1). */
  errorRate: number;
}

/**
 * License-coverage breakdown for a single provider based on its known
 * license profile. Since individual search results are not tracked in the
 * telemetry buffer, this uses a static knowledge map.
 */
export interface LicenseCoverageEntry {
  /** Provider identifier. */
  providerId: ProviderId;
  /**
   * Estimated fraction of results that are openly-licensed (CC0, CC-BY, CC-BY-SA, etc.).
   * Value in [0, 1].
   */
  openFraction: number;
  /**
   * Estimated fraction of results with UNKNOWN license.
   * Value in [0, 1].
   */
  unknownFraction: number;
  /**
   * Estimated fraction of results that are platform-licensed (editorial/press).
   * Value in [0, 1].
   */
  platformFraction: number;
  /**
   * Human-readable coverage note.
   * e.g. "Wikimedia: 95% open (CC0/CC-BY). Bing: ~80% unknown license."
   */
  note: string;
}

/**
 * License-coverage heatmap: ranked list of providers by openness.
 * Providers with more openly-licensed content rank higher.
 */
export interface LicenseCoverageHeatmap {
  /** Providers sorted by openFraction descending (most open first). */
  byOpenness: LicenseCoverageEntry[];
  /** Provider with the highest fraction of UNKNOWN results. */
  mostUnknown: ProviderId | null;
  /** Provider with the highest fraction of openly-licensed results. */
  mostOpen: ProviderId | null;
}

/**
 * Query-category → recommended provider list.
 * e.g. for "portraits" → ["wikimedia", "unsplash", "spotify"]
 */
export interface PerQueryAdvice {
  /** Query category label (e.g. "portraits", "album_art", "logos"). */
  category: string;
  /**
   * Ordered list of providers recommended for this category,
   * filtered to only include currently healthy/degraded providers.
   */
  recommendedProviders: ProviderId[];
  /** Human-readable rationale. */
  rationale: string;
}

/**
 * Cost-benefit analysis entry for a single provider.
 */
export interface CostBenefitEntry {
  /** Provider identifier. */
  providerId: ProviderId;
  /** Whether this provider requires a paid API key. */
  isPaid: boolean;
  /** Short description of cost tier (e.g. "free", "free tier / API key", "paid"). */
  costTier: string;
  /** Primary license profile for this provider (e.g. "CC0/public-domain", "editorial"). */
  licenseProfile: string;
  /** Whether this provider covers gaps the free providers do not. */
  coversGaps: boolean;
  /**
   * Human-readable verdict.
   * e.g. "Smithsonian: free + CC0 but slow (p50≈2s); use for public-domain deep cuts."
   */
  verdict: string;
  /** Current health status for this provider. */
  currentStatus: ProviderHealthStatus;
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

// ---------------------------------------------------------------------------
// Static provider knowledge maps (license profile, cost, query affinity)
// ---------------------------------------------------------------------------

interface ProviderMeta {
  isPaid: boolean;
  costTier: string;
  licenseProfile: string;
  openFraction: number;    // estimated fraction of openly-licensed results [0,1]
  unknownFraction: number; // estimated fraction of UNKNOWN-license results [0,1]
  platformFraction: number;// editorial/platform-license fraction [0,1]
  coversGaps: boolean;
  licenseCoverageNote: string;
  costBenefitNote: string;
  queryAffinities: string[]; // categories this provider excels at
}

const PROVIDER_META: Partial<Record<ProviderId, ProviderMeta>> = {
  wikimedia: {
    isPaid: false, costTier: "free",
    licenseProfile: "CC0/CC-BY/public-domain",
    openFraction: 0.95, unknownFraction: 0.03, platformFraction: 0.02,
    coversGaps: false,
    licenseCoverageNote: "Wikimedia Commons: ~95% openly licensed (CC0/CC-BY). Excellent for editorial and commercial use.",
    costBenefitNote: "Wikimedia: free + open-license. Best first stop for publicly-safe content.",
    queryAffinities: ["portraits", "logos", "landmarks", "historical"],
  },
  openverse: {
    isPaid: false, costTier: "free",
    licenseProfile: "CC0/CC-BY/open",
    openFraction: 0.90, unknownFraction: 0.05, platformFraction: 0.05,
    coversGaps: false,
    licenseCoverageNote: "Openverse: ~90% openly licensed (aggregates CC commons). Low UNKNOWN rate.",
    costBenefitNote: "Openverse: free, high open-license coverage. Aggregates multiple CC sources.",
    queryAffinities: ["portraits", "nature", "objects", "art"],
  },
  unsplash: {
    isPaid: false, costTier: "free tier / API key required",
    licenseProfile: "Unsplash License (commercial-safe)",
    openFraction: 0.0, unknownFraction: 0.05, platformFraction: 0.95,
    coversGaps: true,
    licenseCoverageNote: "Unsplash: Unsplash License (platform-specific, not CC). High-quality but attribution required.",
    costBenefitNote: "Unsplash: free API tier, platform-licensed. Fast and high-quality for editorial/commercial with attribution.",
    queryAffinities: ["portraits", "lifestyle", "nature", "products"],
  },
  pexels: {
    isPaid: false, costTier: "free / API key required",
    licenseProfile: "Pexels License (commercial-safe)",
    openFraction: 0.0, unknownFraction: 0.03, platformFraction: 0.97,
    coversGaps: true,
    licenseCoverageNote: "Pexels: Pexels License (platform-specific). Very low UNKNOWN rate.",
    costBenefitNote: "Pexels: free API, platform-licensed. Good for lifestyle/product imagery.",
    queryAffinities: ["lifestyle", "products", "food", "business"],
  },
  pixabay: {
    isPaid: false, costTier: "free / API key required",
    licenseProfile: "Pixabay License (commercial-safe) / CC0",
    openFraction: 0.40, unknownFraction: 0.05, platformFraction: 0.55,
    coversGaps: false,
    licenseCoverageNote: "Pixabay: mix of CC0 and Pixabay License. ~40% open.",
    costBenefitNote: "Pixabay: free API, mix of CC0 and platform-license. Good volume source.",
    queryAffinities: ["objects", "backgrounds", "nature", "icons"],
  },
  itunes: {
    isPaid: false, costTier: "free (Apple Music API)",
    licenseProfile: "Editorial (Apple ToS)",
    openFraction: 0.0, unknownFraction: 0.05, platformFraction: 0.95,
    coversGaps: true,
    licenseCoverageNote: "iTunes/Apple Music: editorial-licensed artwork, Apple ToS. Not for commercial redistribution.",
    costBenefitNote: "iTunes: free, excellent for music metadata artwork. Restricted to editorial/app use.",
    queryAffinities: ["album_art", "music", "artists"],
  },
  "musicbrainz-caa": {
    isPaid: false, costTier: "free (MusicBrainz)",
    licenseProfile: "CC0/CC-BY/community",
    openFraction: 0.80, unknownFraction: 0.15, platformFraction: 0.05,
    coversGaps: false,
    licenseCoverageNote: "MusicBrainz CAA: community-curated, ~80% openly licensed. Some UNKNOWN from old submissions.",
    costBenefitNote: "MusicBrainz CAA: free, open-license focus. Best for verified album art with provenance.",
    queryAffinities: ["album_art", "music", "artists"],
  },
  spotify: {
    isPaid: false, costTier: "free (Spotify API)",
    licenseProfile: "Editorial (Spotify ToS)",
    openFraction: 0.0, unknownFraction: 0.10, platformFraction: 0.90,
    coversGaps: true,
    licenseCoverageNote: "Spotify: editorial-licensed artwork per Spotify ToS. Good coverage for modern artists.",
    costBenefitNote: "Spotify: free API, editorial-only. Essential for current artist/album imagery.",
    queryAffinities: ["portraits", "album_art", "artists"],
  },
  "youtube-thumb": {
    isPaid: false, costTier: "free (YouTube Data API)",
    licenseProfile: "Editorial (YouTube ToS)",
    openFraction: 0.0, unknownFraction: 0.20, platformFraction: 0.80,
    coversGaps: true,
    licenseCoverageNote: "YouTube thumbnails: editorial only per YouTube ToS. ~20% UNKNOWN due to varied uploader rights.",
    costBenefitNote: "YouTube: free API, editorial-only. Useful for video content and creators.",
    queryAffinities: ["music_video", "content_creators", "events"],
  },
  brave: {
    isPaid: false, costTier: "free tier (Brave Search API)",
    licenseProfile: "Mixed (UNKNOWN-heavy)",
    openFraction: 0.10, unknownFraction: 0.75, platformFraction: 0.15,
    coversGaps: true,
    licenseCoverageNote: "Brave Search: broad web coverage but ~75% UNKNOWN license. Requires rights verification.",
    costBenefitNote: "Brave: free tier, broad coverage, high UNKNOWN rate. Best for discovery/leads, not final assets.",
    queryAffinities: ["general", "web_content", "news"],
  },
  bing: {
    isPaid: false, costTier: "free tier (Bing Image Search API / Azure)",
    licenseProfile: "Mixed (UNKNOWN-heavy)",
    openFraction: 0.10, unknownFraction: 0.70, platformFraction: 0.20,
    coversGaps: true,
    licenseCoverageNote: "Bing: broad web index, ~70% UNKNOWN license. Higher timeout rate under load.",
    costBenefitNote: "Bing: free tier via Azure, broad coverage but high UNKNOWN and occasional timeouts. Supplement, not primary.",
    queryAffinities: ["general", "web_content", "products"],
  },
  serpapi: {
    isPaid: true, costTier: "paid (SerpAPI subscription)",
    licenseProfile: "Mixed (UNKNOWN-heavy)",
    openFraction: 0.05, unknownFraction: 0.80, platformFraction: 0.15,
    coversGaps: true,
    licenseCoverageNote: "SerpAPI: aggregates Google Images, ~80% UNKNOWN. Use only when other sources insufficient.",
    costBenefitNote: "SerpAPI: paid subscription, widest web coverage, fills gaps free providers miss. High UNKNOWN — verify rights.",
    queryAffinities: ["reverse_image", "niche_queries", "web_content"],
  },
  smithsonian: {
    isPaid: false, costTier: "free (Smithsonian Open Access API)",
    licenseProfile: "CC0/public-domain",
    openFraction: 0.98, unknownFraction: 0.02, platformFraction: 0.0,
    coversGaps: false,
    licenseCoverageNote: "Smithsonian: ~98% CC0/public-domain. Curated museum collection, unique historical content.",
    costBenefitNote: "Smithsonian: free + CC0, unique cultural heritage content. Slow rate-limit (30 req/hr on demo key) — cache aggressively.",
    queryAffinities: ["historical", "art", "science", "cultural"],
  },
  nasa: {
    isPaid: false, costTier: "free (NASA Image API)",
    licenseProfile: "Public domain / US Gov",
    openFraction: 0.99, unknownFraction: 0.01, platformFraction: 0.0,
    coversGaps: false,
    licenseCoverageNote: "NASA: virtually all public domain (US Government works). Unique space/science imagery.",
    costBenefitNote: "NASA: free, public domain. Niche but unbeatable for space/science content.",
    queryAffinities: ["space", "science", "astronomy"],
  },
  "met-museum": {
    isPaid: false, costTier: "free (The Met Open Access API)",
    licenseProfile: "CC0/public-domain",
    openFraction: 0.97, unknownFraction: 0.03, platformFraction: 0.0,
    coversGaps: false,
    licenseCoverageNote: "The Met: ~97% CC0. Extensive fine art and artifacts, all openly licensed.",
    costBenefitNote: "The Met: free + CC0. Excellent for fine art, particularly pre-20th century works.",
    queryAffinities: ["art", "historical", "cultural", "portraits"],
  },
  europeana: {
    isPaid: false, costTier: "free (Europeana API)",
    licenseProfile: "Mix CC0/CC-BY/restricted",
    openFraction: 0.65, unknownFraction: 0.15, platformFraction: 0.20,
    coversGaps: false,
    licenseCoverageNote: "Europeana: ~65% open (CC0/CC-BY), 20% institution-restricted. Good for European cultural heritage.",
    costBenefitNote: "Europeana: free, broad European cultural heritage. Check per-item rights (20% restricted).",
    queryAffinities: ["art", "historical", "cultural", "european"],
  },
  "library-of-congress": {
    isPaid: false, costTier: "free (LoC API)",
    licenseProfile: "Public domain / mixed",
    openFraction: 0.85, unknownFraction: 0.10, platformFraction: 0.05,
    coversGaps: false,
    licenseCoverageNote: "Library of Congress: ~85% public domain. Unique historical US content.",
    costBenefitNote: "LoC: free, public domain focus. Essential for US historical photography and documents.",
    queryAffinities: ["historical", "american_history", "documents"],
  },
  "wellcome-collection": {
    isPaid: false, costTier: "free (Wellcome Collection API)",
    licenseProfile: "CC0/CC-BY",
    openFraction: 0.90, unknownFraction: 0.05, platformFraction: 0.05,
    coversGaps: false,
    licenseCoverageNote: "Wellcome Collection: ~90% CC0/CC-BY. Medical and life science imagery, openly licensed.",
    costBenefitNote: "Wellcome Collection: free + open-license, unique medical/science imagery.",
    queryAffinities: ["medical", "science", "historical"],
  },
  rawpixel: {
    isPaid: false, costTier: "free tier / premium",
    licenseProfile: "CC0/public-domain (free tier) + commercial (premium)",
    openFraction: 0.50, unknownFraction: 0.10, platformFraction: 0.40,
    coversGaps: true,
    licenseCoverageNote: "Rawpixel: ~50% CC0 on free tier, balance commercial. High design quality.",
    costBenefitNote: "Rawpixel: mixed free/paid. Good for design assets; verify tier before use.",
    queryAffinities: ["design", "backgrounds", "patterns", "products"],
  },
  burst: {
    isPaid: false, costTier: "free (Shopify Burst)",
    licenseProfile: "CC0/commercial-safe",
    openFraction: 0.95, unknownFraction: 0.03, platformFraction: 0.02,
    coversGaps: false,
    licenseCoverageNote: "Burst (Shopify): ~95% CC0/commercial-safe. Curated e-commerce photography.",
    costBenefitNote: "Burst: free + open-license, optimised for e-commerce product shots.",
    queryAffinities: ["products", "lifestyle", "e-commerce"],
  },
  "internet-archive": {
    isPaid: false, costTier: "free (Internet Archive API)",
    licenseProfile: "Mixed (CC/public-domain/restricted)",
    openFraction: 0.55, unknownFraction: 0.30, platformFraction: 0.15,
    coversGaps: false,
    licenseCoverageNote: "Internet Archive: ~55% open, 30% UNKNOWN (legacy scans with unclear rights). Check per-item.",
    costBenefitNote: "Internet Archive: free, vast historical content but high UNKNOWN rate on older items.",
    queryAffinities: ["historical", "books", "archival"],
  },
  "europeana-archival": {
    isPaid: false, costTier: "free (Europeana Archival endpoint)",
    licenseProfile: "Mix CC0/CC-BY/restricted",
    openFraction: 0.60, unknownFraction: 0.20, platformFraction: 0.20,
    coversGaps: false,
    licenseCoverageNote: "Europeana Archival: ~60% open. Deeper archival collection, more restricted items.",
    costBenefitNote: "Europeana Archival: free, deeper European archive. 20% restricted — verify per-item.",
    queryAffinities: ["archival", "european", "historical"],
  },
  browser: {
    isPaid: false, costTier: "free (browser fallback)",
    licenseProfile: "UNKNOWN (web-sourced)",
    openFraction: 0.0, unknownFraction: 0.95, platformFraction: 0.05,
    coversGaps: true,
    licenseCoverageNote: "Browser fallback: nearly all UNKNOWN license. Use only as last resort, verify rights manually.",
    costBenefitNote: "Browser fallback: free, broad reach, ~95% UNKNOWN. Only for discovery leads.",
    queryAffinities: ["general"],
  },
  "managed-browser": {
    isPaid: false, costTier: "free (managed browser fallback)",
    licenseProfile: "UNKNOWN (web-sourced)",
    openFraction: 0.0, unknownFraction: 0.95, platformFraction: 0.05,
    coversGaps: true,
    licenseCoverageNote: "Managed browser: nearly all UNKNOWN license. Use only as last resort.",
    costBenefitNote: "Managed browser: free, broad reach, ~95% UNKNOWN. Only for discovery leads.",
    queryAffinities: ["general"],
  },
};

/** Default metadata for providers not in PROVIDER_META. */
const DEFAULT_PROVIDER_META: ProviderMeta = {
  isPaid: false, costTier: "unknown",
  licenseProfile: "unknown",
  openFraction: 0.0, unknownFraction: 0.5, platformFraction: 0.5,
  coversGaps: false,
  licenseCoverageNote: "License profile unknown.",
  costBenefitNote: "No cost/benefit data available.",
  queryAffinities: [],
};

/** Static per-category provider affinities (ordered by quality for that category). */
const QUERY_CATEGORY_AFFINITIES: Array<{
  category: string;
  providers: ProviderId[];
  rationale: string;
}> = [
  {
    category: "portraits",
    providers: ["wikimedia", "spotify", "unsplash", "pexels", "openverse"],
    rationale: "For portraits, prioritize Wikimedia (open-license, broad coverage) + Spotify (current artists). Unsplash/Pexels provide high-quality professional shots.",
  },
  {
    category: "album_art",
    providers: ["musicbrainz-caa", "itunes", "spotify"],
    rationale: "For album art, use MusicBrainz CAA (CC0 community-curated) then iTunes + Spotify (editorial, platform ToS).",
  },
  {
    category: "logos",
    providers: ["wikimedia", "openverse"],
    rationale: "For logos, Wikimedia Commons has the broadest open-license SVG/PNG collection. Openverse aggregates additional CC sources.",
  },
  {
    category: "historical",
    providers: ["wikimedia", "library-of-congress", "smithsonian", "met-museum", "europeana"],
    rationale: "For historical content, use cultural institution sources (Wikimedia, LoC, Smithsonian, Met, Europeana) — all free + open-license.",
  },
  {
    category: "art",
    providers: ["met-museum", "wikimedia", "europeana", "openverse"],
    rationale: "For fine art, The Met and Wikimedia provide CC0-licensed high-resolution works. Europeana adds European collections.",
  },
  {
    category: "products",
    providers: ["burst", "pexels", "pixabay", "unsplash"],
    rationale: "For product photography, Burst (CC0/commercial-safe) and Pexels/Pixabay are optimized for e-commerce.",
  },
  {
    category: "general",
    providers: ["wikimedia", "openverse", "unsplash", "pexels", "brave"],
    rationale: "For general queries, start with open-license sources (Wikimedia, Openverse) then platform-licensed (Unsplash, Pexels). Brave for broad web coverage.",
  },
  {
    category: "space_science",
    providers: ["nasa", "wikimedia", "smithsonian"],
    rationale: "For space/science content, NASA (public domain) is authoritative. Wikimedia and Smithsonian supplement.",
  },
  {
    category: "medical",
    providers: ["wellcome-collection", "wikimedia", "openverse"],
    rationale: "For medical imagery, Wellcome Collection (CC0) is the primary source. Wikimedia provides additional openly-licensed anatomical/clinical content.",
  },
];

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

  // Track per-provider status for cross-reference in enhanced fields
  const statusMap = new Map<ProviderId, ProviderHealthStatus>();

  for (const stat of diag.providerStats) {
    const latencies = latencyMap.get(stat.id) ?? [];
    const latencyP50Ms = percentile50(latencies);

    const status = deriveStatus(stat.errorRate, stat.saturated, latencies.length);
    statusMap.set(stat.id, status);

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

  // ---------------------------------------------------------------------------
  // Enhanced field 1: Performance insights (comparative ranking narrative)
  // ---------------------------------------------------------------------------
  const performanceInsights: PerformanceInsight[] = [];
  if (recommendations.length > 0) {
    // Compute fleet average p50 across providers that have data
    const p50Values = recommendations.map((r) => r.latencyP50Ms).filter((v) => v > 0);
    const fleetAvgP50 = p50Values.length > 0
      ? p50Values.reduce((s, v) => s + v, 0) / p50Values.length
      : 0;

    for (const rec of recommendations) {
      const relativeLatency = fleetAvgP50 > 0 && rec.latencyP50Ms > 0
        ? rec.latencyP50Ms / fleetAvgP50
        : 1.0;

      let summary: string;
      const errorPct = Math.round(rec.errorRate * 100);
      const timeoutNote = rec.errorRate > 0.1 ? ` has ${errorPct}% error rate` : "";

      if (rec.status === "unavailable") {
        summary = `${rec.id}: unavailable (100% failure rate in window)`;
      } else if (rec.status === "saturated") {
        const recoveryS = Math.round(rec.estimatedRecoveryMs / 1000);
        summary = `${rec.id}: rate-limited — recovers in ~${recoveryS}s`;
      } else if (rec.latencyP50Ms === 0) {
        summary = `${rec.id}: no data in window (optimistic — try first)`;
      } else if (relativeLatency < 0.7) {
        const xFaster = (1 / relativeLatency).toFixed(1);
        summary = `${rec.id}: consistently fastest (p50=${rec.latencyP50Ms}ms, ${xFaster}× faster than average)${timeoutNote}`;
      } else if (relativeLatency > 1.5) {
        const xSlower = relativeLatency.toFixed(1);
        summary = `${rec.id}: slower than average (p50=${rec.latencyP50Ms}ms, ${xSlower}× avg)${timeoutNote}`;
      } else {
        summary = `${rec.id}: average latency (p50=${rec.latencyP50Ms}ms)${timeoutNote}`;
      }

      performanceInsights.push({
        providerId: rec.id,
        summary,
        latencyP50Ms: rec.latencyP50Ms,
        relativeLatency,
        errorRate: rec.errorRate,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Enhanced field 2: License-coverage heatmap
  // ---------------------------------------------------------------------------
  // Include providers that have data in the window
  const activeProviderIds = recommendations.map((r) => r.id);
  const licenseCoverageEntries: LicenseCoverageEntry[] = activeProviderIds.map((id) => {
    const meta = PROVIDER_META[id] ?? DEFAULT_PROVIDER_META;
    return {
      providerId: id,
      openFraction: meta.openFraction,
      unknownFraction: meta.unknownFraction,
      platformFraction: meta.platformFraction,
      note: meta.licenseCoverageNote,
    };
  });

  // Sort by openFraction descending
  const byOpenness = [...licenseCoverageEntries].sort(
    (a, b) => b.openFraction - a.openFraction,
  );

  const mostOpen = byOpenness.length > 0 ? byOpenness[0]!.providerId : null;
  const mostUnknownEntry = [...licenseCoverageEntries].sort(
    (a, b) => b.unknownFraction - a.unknownFraction,
  )[0];
  const mostUnknown = mostUnknownEntry ? mostUnknownEntry.providerId : null;

  const licenseCoverageHeatmap: LicenseCoverageHeatmap = {
    byOpenness,
    mostOpen,
    mostUnknown,
  };

  // ---------------------------------------------------------------------------
  // Enhanced field 3: Per-query provider selection advice
  // ---------------------------------------------------------------------------
  const perQueryAdvice: PerQueryAdvice[] = QUERY_CATEGORY_AFFINITIES.map(({ category, providers, rationale }) => {
    // Filter to providers currently active (have data in window) AND healthy/degraded
    // If no active providers match, fall back to the static list
    const activeHealthy = providers.filter((id) => {
      const status = statusMap.get(id);
      // If provider has no data in window, treat as optimistically available
      return status === undefined || status === "healthy" || status === "degraded";
    });
    return {
      category,
      recommendedProviders: activeHealthy,
      rationale,
    };
  });

  // ---------------------------------------------------------------------------
  // Enhanced field 4: Cost-benefit analysis
  // ---------------------------------------------------------------------------
  const costBenefitAnalysis: CostBenefitEntry[] = activeProviderIds.map((id) => {
    const meta = PROVIDER_META[id] ?? DEFAULT_PROVIDER_META;
    const status = statusMap.get(id) ?? "healthy";
    const rec = recommendations.find((r) => r.id === id);

    let verdict = meta.costBenefitNote;
    // Append current health context to verdict
    if (status === "unavailable") {
      verdict += ` Currently UNAVAILABLE — not recommended.`;
    } else if (status === "saturated") {
      const recoveryS = rec ? Math.round(rec.estimatedRecoveryMs / 1000) : 0;
      verdict += ` Currently RATE-LIMITED (recovers in ~${recoveryS}s).`;
    } else if (status === "degraded") {
      const errorPct = rec ? Math.round(rec.errorRate * 100) : 0;
      verdict += ` Currently DEGRADED (${errorPct}% error rate).`;
    }

    return {
      providerId: id,
      isPaid: meta.isPaid,
      costTier: meta.costTier,
      licenseProfile: meta.licenseProfile,
      coversGaps: meta.coversGaps,
      verdict,
      currentStatus: status,
    };
  });

  return {
    rankedProviders: recommendations,
    suggestedFallbackChain,
    performanceInsights,
    licenseCoverageHeatmap,
    perQueryAdvice,
    costBenefitAnalysis,
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
// Historical health-trend analyzer
// ---------------------------------------------------------------------------

/** Latency percentiles for a provider over one time window. */
export interface LatencyPercentiles {
  p50: number;
  p95: number;
  p99: number;
}

/** Per-provider trend data aggregated over a single window. */
export interface ProviderWindowTrend {
  /** Provider identifier. */
  providerId: ProviderId;
  /** Window length in ms (e.g. 300_000 for 5 min). */
  windowMs: number;
  /** Human-readable label for this window (e.g. "5min", "1hr", "24hr"). */
  windowLabel: string;
  /** Number of events in this window. */
  sampleCount: number;
  /** Latency percentiles over this window (all 0 if no data). */
  latencyPercentiles: LatencyPercentiles;
  /** Error rate in [0, 1] over this window. */
  errorRate: number;
  /** Total result count returned by this provider in this window. */
  resultCount: number;
  /** Whether the rate-limit bucket is currently saturated. */
  saturated: boolean;
}

/** Per-provider trend report across all three windows. */
export interface FederationTrendReport {
  /** Provider identifier. */
  providerId: ProviderId;
  /** Window snapshots: 5min, 1hr, 24hr. */
  windows: ProviderWindowTrend[];
}

/** Anomaly event flagged by detectProviderAnomalies(). */
export interface AnomalyEvent {
  /** Provider that triggered the anomaly. */
  providerId: ProviderId;
  /** Machine-readable anomaly kind. */
  kind:
    | "latency-spike"        // p50→p95 delta >50% of p50 baseline
    | "sustained-errors"     // error rate >10% for >2 min
    | "result-count-drop"    // result count dropped >60% vs last successful batch
    | "rate-limit-exhaustion"; // saturated flag is true
  /** Human-readable description. */
  description: string;
  /** Unix-ms when the anomaly was detected. */
  detectedAt: number;
  /** Additional numeric context (threshold, observed value, etc.). */
  context: Record<string, number>;
}

/** Result shape of the /v1/federation-diagnostics-trends endpoint. */
export interface FederationDiagnosticsTrendsResult {
  trends: FederationTrendReport[];
  anomalies: AnomalyEvent[];
  lastUpdatedMs: number;
}

// Ordered windows: 5 min, 1 hr, 24 hr
const TREND_WINDOWS: Array<{ ms: number; label: string }> = [
  { ms: 5 * 60 * 1000,       label: "5min" },
  { ms: 60 * 60 * 1000,      label: "1hr"  },
  { ms: 24 * 60 * 60 * 1000, label: "24hr" },
];

/** Compute a specific percentile from a sorted array (already sorted ascending). */
function percentileFromSorted(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return Math.round(sorted[lo]! * (1 - frac) + sorted[hi]! * frac);
}

/**
 * Compute per-provider latency percentiles (p50/p95/p99) and error-rate trends
 * over 5min / 1hr / 24hr sliding windows.
 */
export function getFederationTrends(): FederationTrendReport[] {
  const allEvts = allEvents();
  const now = Date.now();

  // Collect all provider IDs that appear in any window
  const providerSet = new Set<ProviderId>(allEvts.map((e) => e.providerId));

  const reports: FederationTrendReport[] = [];

  for (const providerId of providerSet) {
    const windows: ProviderWindowTrend[] = [];

    for (const win of TREND_WINDOWS) {
      const cutoff = now - win.ms;
      const evts = allEvts.filter(
        (e) => e.providerId === providerId && e.startedAt >= cutoff,
      );

      const durations = evts.map((e) => e.durationMs).sort((a, b) => a - b);
      const errors = evts.filter((e) => !e.ok).length;
      const resultCount = evts.reduce((s, e) => s + e.resultCount, 0);
      const errorRate = evts.length > 0 ? errors / evts.length : 0;

      const bs = getBucketState(providerId);

      windows.push({
        providerId,
        windowMs: win.ms,
        windowLabel: win.label,
        sampleCount: evts.length,
        latencyPercentiles: {
          p50: percentileFromSorted(durations, 50),
          p95: percentileFromSorted(durations, 95),
          p99: percentileFromSorted(durations, 99),
        },
        errorRate: Math.round(errorRate * 1000) / 1000,
        resultCount,
        saturated: bs.saturated,
      });
    }

    reports.push({ providerId, windows });
  }

  return reports;
}

/**
 * Detect anomalies across all providers using the 5-min window as the baseline.
 *
 * Flags:
 *  - latency-spike:        p95 > p50 * 1.5 (i.e. >50% jump from baseline)
 *  - sustained-errors:     error rate >10% and the earliest failing event in the
 *                          window is >2 min old (sustained for >2 min)
 *  - result-count-drop:    latest batch result count dropped >60% vs prior batch
 *  - rate-limit-exhaustion: saturated bucket
 */
export function detectProviderAnomalies(windowMs = WINDOW_MS): AnomalyEvent[] {
  const now = Date.now();
  const allEvts = allEvents();
  const anomalies: AnomalyEvent[] = [];

  // Collect providers active in the given window
  const cutoff = now - windowMs;
  const recentEvts = allEvts.filter((e) => e.startedAt >= cutoff);
  const providerSet = new Set<ProviderId>(recentEvts.map((e) => e.providerId));

  for (const providerId of providerSet) {
    const evts = recentEvts.filter((e) => e.providerId === providerId);
    const durations = evts.map((e) => e.durationMs).sort((a, b) => a - b);
    const errors = evts.filter((e) => !e.ok);
    const errorRate = evts.length > 0 ? errors.length / evts.length : 0;

    // 1. Latency spike: p95 > 1.5 × p50
    const p50 = percentileFromSorted(durations, 50);
    const p95 = percentileFromSorted(durations, 95);
    if (p50 > 0 && p95 > p50 * 1.5 && durations.length >= 3) {
      const delta = p95 - p50;
      const pctIncrease = Math.round((delta / p50) * 100);
      anomalies.push({
        providerId,
        kind: "latency-spike",
        description:
          `${providerId}: latency spike detected — p95 (${p95}ms) is ${pctIncrease}% above p50 (${p50}ms)`,
        detectedAt: now,
        context: { p50, p95, deltaMs: delta, thresholdPct: 50 },
      });
    }

    // 2. Sustained errors: rate >10% AND earliest error >2 min ago
    const TWO_MIN_MS = 2 * 60 * 1000;
    if (errorRate > 0.1 && errors.length > 0) {
      const earliestError = Math.min(...errors.map((e) => e.startedAt));
      const sustainedMs = now - earliestError;
      if (sustainedMs > TWO_MIN_MS) {
        anomalies.push({
          providerId,
          kind: "sustained-errors",
          description:
            `${providerId}: error rate ${Math.round(errorRate * 100)}% sustained for ${Math.round(sustainedMs / 1000)}s (threshold: >10% for >2min)`,
          detectedAt: now,
          context: {
            errorRate: Math.round(errorRate * 1000) / 1000,
            sustainedMs: Math.round(sustainedMs),
            thresholdPct: 10,
            thresholdMs: TWO_MIN_MS,
          },
        });
      }
    }

    // 3. Result count drop: compare last two successful batches
    const successEvts = evts.filter((e) => e.ok && e.resultCount > 0);
    if (successEvts.length >= 2) {
      const sorted = [...successEvts].sort((a, b) => a.startedAt - b.startedAt);
      const prev = sorted[sorted.length - 2]!;
      const last = sorted[sorted.length - 1]!;
      if (prev.resultCount > 0) {
        const dropFrac = (prev.resultCount - last.resultCount) / prev.resultCount;
        if (dropFrac > 0.6) {
          anomalies.push({
            providerId,
            kind: "result-count-drop",
            description:
              `${providerId}: result count dropped ${Math.round(dropFrac * 100)}% ` +
              `(from ${prev.resultCount} to ${last.resultCount})`,
            detectedAt: now,
            context: {
              prevCount: prev.resultCount,
              lastCount: last.resultCount,
              dropFraction: Math.round(dropFrac * 1000) / 1000,
              thresholdFraction: 0.6,
            },
          });
        }
      }
    }

    // 4. Rate-limit exhaustion
    const bs = getBucketState(providerId);
    if (bs.saturated) {
      anomalies.push({
        providerId,
        kind: "rate-limit-exhaustion",
        description:
          `${providerId}: rate-limit bucket exhausted — next token available in ${bs.waitTimeMs}ms`,
        detectedAt: now,
        context: { waitTimeMs: bs.waitTimeMs, tokensAvailable: bs.tokensAvailable },
      });
    }
  }

  return anomalies;
}

/**
 * Export the full event history (from allEvents()) with anomaly markers for
 * debugging / compliance. By default exports the last windowMs of events;
 * pass windowMs=Infinity to export all.
 *
 * @param format  'json' → JSON string, 'csv' → RFC-4180 CSV string.
 * @param windowMs  Time window to include (default: last 24 hr). Pass 0 to export all.
 */
export function exportFederationAudit(
  format: "json" | "csv",
  windowMs?: number,
): string {
  const effectiveWindow = windowMs === undefined ? 24 * 60 * 60 * 1000 : windowMs;
  const now = Date.now();
  const cutoff = effectiveWindow === 0 ? 0 : now - effectiveWindow;
  const evts = allEvents().filter((e) => e.startedAt >= cutoff);

  // Compute anomaly provider set for marker injection
  const anomalies = detectProviderAnomalies(
    effectiveWindow === 0 ? 24 * 60 * 60 * 1000 : effectiveWindow,
  );
  const anomalyProviders = new Set<string>(anomalies.map((a) => `${a.providerId}:${a.kind}`));

  if (format === "json") {
    const rows = evts.map((e) => {
      const markers = anomalies
        .filter((a) => a.providerId === e.providerId)
        .map((a) => a.kind);
      return { ...e, anomalyMarkers: markers };
    });
    return JSON.stringify(
      {
        exportedAt: now,
        windowMs: effectiveWindow,
        eventCount: rows.length,
        anomalyCount: anomalies.length,
        events: rows,
      },
      null,
      2,
    );
  }

  // CSV format
  const CSV_HEADERS = [
    "providerId",
    "startedAt",
    "endedAt",
    "durationMs",
    "resultCount",
    "ok",
    "errorKind",
    "errorMessage",
    "payloadBytes",
    "anomalyMarkers",
  ];

  function csvEscape(val: unknown): string {
    const s = val === undefined || val === null ? "" : String(val);
    // Quote if contains comma, double-quote, newline
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const lines: string[] = [CSV_HEADERS.join(",")];
  for (const e of evts) {
    const markers = anomalies
      .filter((a) => a.providerId === e.providerId)
      .map((a) => a.kind)
      .join("|");
    lines.push(
      [
        csvEscape(e.providerId),
        csvEscape(e.startedAt),
        csvEscape(e.endedAt),
        csvEscape(e.durationMs),
        csvEscape(e.resultCount),
        csvEscape(e.ok),
        csvEscape(e.errorKind ?? ""),
        csvEscape(e.errorMessage ?? ""),
        csvEscape(e.payloadBytes),
        csvEscape(markers),
      ].join(","),
    );
  }
  return lines.join("\n");
}

/**
 * Combined diagnostics-trends result: trends + anomalies + timestamp.
 * Used by the /v1/federation-diagnostics-trends HTTP endpoint.
 */
export function getFederationDiagnosticsTrends(
  windowMs = WINDOW_MS,
): FederationDiagnosticsTrendsResult {
  const trends = getFederationTrends();
  const anomalies = detectProviderAnomalies(windowMs);
  return {
    trends,
    anomalies,
    lastUpdatedMs: Date.now(),
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
