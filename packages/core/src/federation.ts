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

import { buildAttribution } from "./license.ts";
import { dedupeByUrl } from "./dedupe.ts";
import { ALL_PROVIDERS, DEFAULT_PROVIDERS } from "./providers/index.ts";
import { rankAll } from "./pick.ts";
import type {
  ImageCandidate,
  Provider,
  ProviderId,
  ProviderReport,
  SearchOptions,
  SearchResultBundle,
} from "./types.ts";

export async function searchImages(query: string, opts: SearchOptions = {}): Promise<SearchResultBundle> {
  if (!query || query.trim().length === 0) {
    return { candidates: [], providerReports: [], warnings: ["empty query"] };
  }

  const piiWarning = looksLikePII(query) ? ["query looks like PII; review before use"] : [];

  const requested = opts.providers ?? DEFAULT_PROVIDERS;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  if (opts.dryRun) {
    return {
      candidates: [],
      providerReports: requested.map((p) => ({
        provider: p,
        ok: true,
        count: 0,
        timeMs: 0,
      })),
      warnings: ["dryRun: no network calls made", ...piiWarning],
    };
  }

  const reports: ProviderReport[] = [];
  const results = await Promise.all(
    requested.map((id) => runProvider(id, query, opts, timeoutMs, reports)),
  );
  const flat = results.flat();
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
    warnings.push(
      "Results include browser-sourced fallback items. Verify ToS/license before use.",
    );
  }
  if ((opts.licensePolicy ?? "safe-only") === "any") {
    warnings.push(
      "licensePolicy=any — UNKNOWN-licensed results included. Do not ship without clearing rights.",
    );
  }

  return { candidates: enriched, providerReports: reports, warnings };
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
    reports.push({ provider: id, ok: false, count: 0, timeMs: 0, error: "unknown provider" });
    return [];
  }
  // Opt-in providers that weren't requested explicitly are never run (already
  // filtered out in DEFAULT_PROVIDERS, but guard anyway).
  if (provider.optIn && !(opts.providers ?? []).includes(id)) {
    reports.push({ provider: id, ok: false, count: 0, timeMs: 0, skipped: "not-enabled" });
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
    reports.push({ provider: id, ok: true, count: out.length, timeMs: Date.now() - started });
    return out;
  } catch (e) {
    const msg = (e as Error).message ?? "unknown";
    const skipped = /missing|disabled/i.test(msg) ? "missing-auth" : undefined;
    reports.push({
      provider: id,
      ok: false,
      count: 0,
      timeMs: Date.now() - started,
      error: msg,
      skipped,
    });
    return [];
  } finally {
    clearTimeout(timer);
    outerAbort?.removeEventListener("abort", onAbort);
  }
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
