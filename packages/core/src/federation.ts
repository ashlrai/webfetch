/**
 * Federation orchestrator.
 *
 * Runs providers in parallel with per-provider timeouts, collects structured
 * ProviderReports (no throw propagation — a single bad provider never fails
 * the federation), dedupes by URL, ranks via pick.ts, and returns.
 *
 * Design call: we *do not* short-circuit on "good enough". Agents tend to
 * want the full ranked list so they can present options. If you need a single
 * best pick, call `pickBest()` on the returned candidates.
 */

import { dedupeByUrl } from "./dedupe.ts";
import {
  emitProviderEvent,
  emitProviderSequenceEvent,
  getFederationDiagnostics,
} from "./federation-telemetry.ts";
import { getFederationRepairPlan } from "./federation-repair.ts";
import { buildAttribution } from "./license.ts";
import { rankAll } from "./pick.ts";
import { healthCheckProvider } from "./provider-health-check.ts";
import { ALL_PROVIDERS, DEFAULT_PROVIDERS } from "./providers/index.ts";
import { clusterCandidates } from "./semantic-clustering.ts";
import type {
  ClusterGroup,
  ErrorKind,
  FederationRepairPlan,
  ImageCandidate,
  Provider,
  ProviderId,
  ProviderReport,
  SearchOptions,
  SearchResultBundle,
} from "./types.ts";

export async function searchImages(
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResultBundle> {
  if (!query || query.trim().length === 0) {
    return { candidates: [], providerReports: [], warnings: ["empty query"] };
  }

  const piiWarning = looksLikePII(query) ? ["query looks like PII; review before use"] : [];

  const requested = opts.providers ?? DEFAULT_PROVIDERS;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  // -------------------------------------------------------------------------
  // Optional pre-flight health check — skips providers whose endpoints are down
  // -------------------------------------------------------------------------
  let activeProviders = requested;
  const skippedByHealth: ProviderReport[] = [];
  if (opts.healthCheck) {
    const checks = await Promise.all(
      requested.map((id) =>
        healthCheckProvider(id, { fetcher: opts.fetcher, timeoutMs: Math.min(timeoutMs, 8_000) }).catch(
          () => null,
        ),
      ),
    );
    const filtered: ProviderId[] = [];
    for (let i = 0; i < requested.length; i++) {
      const check = checks[i];
      if (check && check.status === "down") {
        skippedByHealth.push({
          provider: requested[i]!,
          ok: false,
          count: 0,
          timeMs: check.metrics.httpLatencyMs,
          skipped: "disabled",
          errorKind: "network",
          errorContext: {
            healthCheckStatus: check.status,
            reason: check.reason ?? "endpoint reported down",
          },
        });
      } else {
        filtered.push(requested[i]!);
      }
    }
    activeProviders = filtered;
  }

  if (opts.dryRun) {
    return {
      candidates: [],
      providerReports: [
        ...skippedByHealth,
        ...activeProviders.map((p) => ({
          provider: p,
          ok: true,
          count: 0,
          timeMs: 0,
        })),
      ],
      warnings: ["dryRun: no network calls made", ...piiWarning],
      ...(opts.clusterSimilar ? { candidateClusters: [] } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Priority ordering based on providerPreference
  // -------------------------------------------------------------------------
  const preference = opts.providerPreference ?? "default";
  const ordered = orderProviders(activeProviders, preference, timeoutMs);

  // Emit a sequence event so telemetry can track dispatch order
  emitProviderSequenceEvent({
    query,
    dispatchOrder: ordered,
    preference,
    startedAt: Date.now(),
  });

  // -------------------------------------------------------------------------
  // Fallback chain: run chain providers sequentially with adaptive timeouts,
  // falling back on error/timeout. Non-chain providers run in parallel.
  // -------------------------------------------------------------------------
  const fallbackChain = opts.fallbackChain ?? [];
  const chainSet = new Set(fallbackChain);
  const parallelProviders = ordered.filter((id) => !chainSet.has(id));

  const reports: ProviderReport[] = [];
  const allResults: ImageCandidate[] = [];

  // Run parallel providers concurrently
  const parallelResults = await Promise.all(
    parallelProviders.map((id) =>
      runProvider(id, query, opts, resolveTimeout(id, timeoutMs, opts), reports),
    ),
  );
  allResults.push(...parallelResults.flat());

  // Run fallback chain sequentially — stop as soon as one succeeds
  for (const id of fallbackChain) {
    const chainTimeout = resolveTimeout(id, timeoutMs, opts);
    const out = await runProvider(id, query, opts, chainTimeout, reports);
    if (out.length > 0) {
      allResults.push(...out);
      break; // Got results — skip remaining fallbacks
    }
    // If the provider failed/timed-out, continue to the next in chain
  }

  const flat = allResults;
  const deduped = dedupeByUrl(flat);
  const ranked = rankAll(deduped, {
    licensePolicy: opts.licensePolicy ?? "safe-only",
    minWidth: opts.minWidth,
    minHeight: opts.minHeight,
  });

  // Attach pre-built attribution lines so model output can surface them.
  const enriched = ranked.map((c) => ({
    ...c,
    attributionLine:
      c.attributionLine ??
      buildAttribution({
        license: c.license,
        author: c.author,
        sourceName: prettySource(c.source),
        sourceUrl: c.sourcePageUrl,
        title: c.title,
      }),
  }));

  const warnings: string[] = [...piiWarning];
  if (enriched.some((c) => c.viaBrowserFallback)) {
    warnings.push("Results include browser-sourced fallback items. Verify ToS/license before use.");
  }
  if ((opts.licensePolicy ?? "safe-only") === "any") {
    warnings.push(
      "licensePolicy=any — UNKNOWN-licensed results included. Do not ship without clearing rights.",
    );
  }

  // -------------------------------------------------------------------------
  // Optional post-ranking semantic clustering
  // -------------------------------------------------------------------------
  let candidateClusters: ClusterGroup[] | undefined;
  if (opts.clusterSimilar) {
    candidateClusters = clusterCandidates(enriched, opts.clusteringOptions ?? {});
  }

  // -------------------------------------------------------------------------
  // Optional federation repair plan (opt-in via opts.repairPlan)
  // -------------------------------------------------------------------------
  const allReports = [...skippedByHealth, ...reports];
  let repairPlan: FederationRepairPlan | undefined;
  if (opts.repairPlan) {
    repairPlan = getFederationRepairPlan({
      reports: allReports,
      candidates: enriched,
      licensePolicy: opts.licensePolicy ?? "safe-only",
      timeoutMs: opts.timeoutMs ?? 15_000,
      requestedProviders: requested as ProviderId[],
    });
  }

  return {
    candidates: enriched,
    providerReports: allReports,
    warnings,
    ...(candidateClusters !== undefined ? { candidateClusters } : {}),
    ...(repairPlan !== undefined ? { repairPlan } : {}),
  };
}

// ---------------------------------------------------------------------------
// Priority queue helpers
// ---------------------------------------------------------------------------

/**
 * Re-order providers according to the requested preference mode.
 * Uses the 5-min diagnostics window to compute health scores / latencies.
 */
function orderProviders(
  ids: ProviderId[],
  preference: "fastest" | "healthiest" | "default",
  _timeoutMs: number,
): ProviderId[] {
  if (preference === "default" || ids.length <= 1) return ids;

  const diag = getFederationDiagnostics();
  const statsMap = new Map(diag.providerStats.map((s) => [s.id, s]));

  if (preference === "healthiest") {
    return [...ids].sort((a, b) => {
      const sa = statsMap.get(a);
      const sb = statsMap.get(b);
      const scoreA = sa ? Math.max(0, 1 - sa.errorRate - (sa.saturated ? 0.5 : 0)) : 1;
      const scoreB = sb ? Math.max(0, 1 - sb.errorRate - (sb.saturated ? 0.5 : 0)) : 1;
      const diff = scoreB - scoreA;
      if (Math.abs(diff) > 1e-9) return diff;
      // Tie-break by latency
      return (sa?.avgLatencyMs ?? 0) - (sb?.avgLatencyMs ?? 0);
    });
  }

  // fastest: lowest latency first, no-data providers go after those with data
  return [...ids].sort((a, b) => {
    const sa = statsMap.get(a);
    const sb = statsMap.get(b);
    if (!sa && !sb) return 0;
    if (!sa) return 1;
    if (!sb) return -1;
    const latDiff = sa.avgLatencyMs - sb.avgLatencyMs;
    if (Math.abs(latDiff) > 0) return latDiff;
    // Tie-break by health score
    const scoreA = Math.max(0, 1 - sa.errorRate - (sa.saturated ? 0.5 : 0));
    const scoreB = Math.max(0, 1 - sb.errorRate - (sb.saturated ? 0.5 : 0));
    return scoreB - scoreA;
  });
}

/**
 * Compute the effective timeout for a provider when adaptiveTimeoutMs is enabled.
 *
 * Adaptive timeout = clamp(avgLatency * 2.5, minAdaptiveMs, timeoutMs).
 * Falls back to the global timeoutMs when no latency data is available.
 */
function resolveTimeout(
  id: ProviderId,
  globalTimeoutMs: number,
  opts: SearchOptions,
): number {
  if (!opts.adaptiveTimeoutMs) return globalTimeoutMs;

  const MIN_ADAPTIVE_MS = 2_000; // never go below 2 s
  const diag = getFederationDiagnostics();
  const stat = diag.providerStats.find((s) => s.id === id);
  if (!stat || stat.avgLatencyMs === 0) return globalTimeoutMs;

  const adaptive = Math.round(stat.avgLatencyMs * 2.5);
  return Math.min(globalTimeoutMs, Math.max(MIN_ADAPTIVE_MS, adaptive));
}

async function runProvider(
  id: ProviderId,
  query: string,
  opts: SearchOptions,
  timeoutMs: number,
  reports: ProviderReport[],
): Promise<ImageCandidate[]> {
  const provider: Provider | undefined = ALL_PROVIDERS[id];
  if (!provider) {
    reports.push({ provider: id, ok: false, count: 0, timeMs: 0, error: "unknown provider", errorKind: "network" });
    return [];
  }
  // Opt-in providers that weren't requested explicitly are never run (already
  // filtered out in DEFAULT_PROVIDERS, but guard anyway).
  if (provider.optIn && !(opts.providers ?? []).includes(id)) {
    reports.push({ provider: id, ok: false, count: 0, timeMs: 0, skipped: "not-enabled", errorKind: "network" });
    return [];
  }
  if (!providerCanRun(provider, opts)) {
    reports.push({ provider: id, ok: false, count: 0, timeMs: 0, skipped: "missing-auth", errorKind: "network" });
    return [];
  }

  const started = Date.now();
  // Per-provider timeout wired onto a dedicated AbortController so the global
  // signal (if any) composes with it.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const outerAbort = opts.signal;
  const onAbort = () => ctl.abort();
  outerAbort?.addEventListener("abort", onAbort);
  const providerOpts: SearchOptions = { ...opts, signal: ctl.signal };

  try {
    const out = await provider.search(query, providerOpts);
    const elapsed = Date.now() - started;
    reports.push({ provider: id, ok: true, count: out.length, timeMs: elapsed, errorKind: "ok" });
    emitProviderEvent({
      providerId: id,
      startedAt: started,
      endedAt: started + elapsed,
      durationMs: elapsed,
      resultCount: out.length,
      ok: true,
      errorKind: "ok",
      payloadBytes: JSON.stringify(out).length,
    });
    return out;
  } catch (e) {
    const elapsed = Date.now() - started;
    const msg = (e as Error).message ?? "unknown";
    const kind = classifyError(e, ctl.signal.aborted);
    const ctx = kind === "http-4xx" || kind === "http-5xx" ? extractHttpContext(e) : undefined;
    reports.push({
      provider: id,
      ok: false,
      count: 0,
      timeMs: elapsed,
      error: msg,
      errorKind: kind,
      ...(ctx ? { errorContext: ctx } : {}),
    });
    emitProviderEvent({
      providerId: id,
      startedAt: started,
      endedAt: started + elapsed,
      durationMs: elapsed,
      resultCount: 0,
      ok: false,
      errorKind: kind,
      errorMessage: msg,
      ...(ctx ? { errorContext: ctx } : {}),
      payloadBytes: 0,
    });
    return [];
  } finally {
    clearTimeout(timer);
    outerAbort?.removeEventListener("abort", onAbort);
  }
}

/** Map a caught error to a structured ErrorKind. */
function classifyError(e: unknown, timedOut: boolean): ErrorKind {
  if (timedOut) return "timeout";
  const msg = (e as Error)?.message ?? "";
  // HTTP errors surfaced by providers as Error with status embedded in message.
  // Convention: providers throw `new Error("HTTP 429 …")` etc.
  const statusMatch = msg.match(/\bHTTP\s+(\d{3})\b/i) ?? msg.match(/\bstatus[:\s]+(\d{3})\b/i);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status === 429) return "rate-limited";
    if (status >= 400 && status < 500) return "http-4xx";
    if (status >= 500) return "http-5xx";
  }
  // Providers may also attach a .status property directly.
  const status = (e as any)?.status ?? (e as any)?.statusCode;
  if (typeof status === "number") {
    if (status === 429) return "rate-limited";
    if (status >= 400 && status < 500) return "http-4xx";
    if (status >= 500) return "http-5xx";
  }
  // JSON / schema parse failures.
  if (msg.includes("JSON") || msg.includes("parse") || msg.includes("unexpected token")) {
    return "decode";
  }
  return "network";
}

/** Pull HTTP status into errorContext when available. */
function extractHttpContext(e: unknown): Record<string, unknown> | undefined {
  const msg = (e as Error)?.message ?? "";
  const statusFromMsg = msg.match(/\bHTTP\s+(\d{3})\b/i)?.[1] ?? msg.match(/\bstatus[:\s]+(\d{3})\b/i)?.[1];
  const status = (e as any)?.status ?? (e as any)?.statusCode ?? (statusFromMsg ? Number(statusFromMsg) : undefined);
  return status !== undefined ? { httpStatus: status } : undefined;
}

function providerCanRun(provider: Provider, opts: SearchOptions): boolean {
  if (!provider.requiresAuth) return true;
  const req = provider.auth;
  if (!req || req.keys.length === 0) return true;
  return req.keys.every((key, index) => {
    const val = opts.auth?.[key];
    if (typeof val === "string" && val.length > 0) return true;
    const envName = req.env[index];
    return envName ? !!process.env[envName] : false;
  });
}

function prettySource(source: string): string {
  switch (source) {
    case "wikimedia":
      return "Wikimedia Commons";
    case "musicbrainz-caa":
      return "MusicBrainz Cover Art Archive";
    case "openverse":
      return "Openverse";
    case "unsplash":
      return "Unsplash";
    case "pexels":
      return "Pexels";
    case "pixabay":
      return "Pixabay";
    case "itunes":
      return "iTunes";
    case "spotify":
      return "Spotify";
    case "youtube-thumb":
      return "YouTube";
    case "brave":
      return "Brave Search";
    case "bing":
      return "Bing Image Search";
    case "serpapi":
      return "Google Images (via SerpAPI)";
    case "browser":
      return "Headless Browser (ToS-grey)";
    case "flickr":
      return "Flickr (CC)";
    case "internet-archive":
      return "Internet Archive";
    case "smithsonian":
      return "Smithsonian Open Access";
    case "nasa":
      return "NASA";
    case "met-museum":
      return "The Met";
    case "europeana":
      return "Europeana";
    case "library-of-congress":
      return "Library of Congress";
    case "wellcome-collection":
      return "Wellcome Collection";
    case "rawpixel":
      return "Rawpixel";
    case "burst":
      return "Burst (Shopify)";
    case "europeana-archival":
      return "Europeana Archival";
    default:
      return source;
  }
}

/**
 * Very light heuristic for PII detection in queries. Intentionally narrow —
 * we don't want to block the common case of "person name + photo".
 */
function looksLikePII(q: string): boolean {
  return /\b\d{3}-\d{2}-\d{4}\b|\b\d{16}\b|@[\w.-]+\.\w{2,}/.test(q);
}
