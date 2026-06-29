/**
 * Batch reverse-image search.
 *
 * Accepts a list of image URLs, fans out to one or more providers
 * (brave, serpapi), respects per-provider rate-limit buckets, and
 * deduplicates candidates across providers per source URL.
 *
 * Rate-limit behaviour:
 *   - If a provider's token bucket is saturated when a slot is about to
 *     run, the slot is skipped with a warning rather than blocking the
 *     entire batch. Callers should retry saturated slots later.
 *   - Within a single slot, providers execute concurrently; across slots
 *     execution is sequential to avoid thundering-herd on shared buckets.
 *
 * Also exports `batchFindSimilarWithFederation` — a higher-level entry point
 * for 10–100 image batches that leverages the federation infrastructure
 * (raceProviders, earlyExitCriteria, rate-limit awareness, tier-1 wave
 * prioritisation) and returns per-image deduped candidates alongside a
 * batch-level federation summary.
 */

import { dedupeByUrl } from "./dedupe.ts";
import { findSimilar } from "./find-similar.ts";
import { getBucket } from "./rate-limit.ts";
import type {
  EarlyExitCriteria,
  ImageCandidate,
  LicensePolicy,
  ProviderId,
  ProviderReport,
  SearchOptions,
} from "./types.ts";

export interface BatchFindSimilarInput {
  urls: string[];
  providers?: ProviderId[];
  limit?: number;
}

export interface BatchFindSimilarResult {
  url: string;
  candidates: ImageCandidate[];
  warnings: string[];
}

export interface BatchFindSimilarOutput {
  results: BatchFindSimilarResult[];
}

/**
 * Reverse-search multiple image URLs across providers.
 *
 * @param input.urls      Image URLs to reverse-search (max 50).
 * @param input.providers Providers to query; defaults to [] (no providers = warning).
 * @param input.limit     Max candidates per URL after deduplication (default 20).
 * @param opts            Standard SearchOptions (auth, fetcher, signal, etc.).
 */
export async function batchFindSimilar(
  input: BatchFindSimilarInput,
  opts: SearchOptions = {},
): Promise<BatchFindSimilarOutput> {
  const { urls, providers = [], limit = 20 } = input;
  const results: BatchFindSimilarResult[] = [];

  for (const url of urls) {
    const slotWarnings: string[] = [];

    // Check saturation before issuing calls; emit per-provider warnings.
    const saturatedProviders = providers.filter((p) => {
      // Only check providers that need a key we'd attempt.
      if (p === "brave") {
        const key = opts.auth?.braveApiKey ?? process.env.BRAVE_API_KEY;
        if (!key) return false; // missing-key warning handled inside findSimilar
        return getBucket("brave").saturated();
      }
      if (p === "serpapi") {
        const key = opts.auth?.serpApiKey ?? process.env.SERPAPI_KEY;
        if (!key) return false;
        return getBucket("serpapi").saturated();
      }
      return false;
    });

    for (const p of saturatedProviders) {
      slotWarnings.push(`${p} rate-limit saturated for ${url} — skipped`);
    }

    const availableProviders = providers.filter((p) => !saturatedProviders.includes(p));

    let candidates: ImageCandidate[] = [];

    if (availableProviders.length > 0) {
      const { candidates: raw, warnings } = await findSimilar(
        { url },
        { ...opts, providers: availableProviders },
      );
      slotWarnings.push(...warnings);
      // Deduplicate across providers before capping.
      candidates = dedupeByUrl(raw).slice(0, limit);
    } else if (saturatedProviders.length === 0) {
      // No providers available and none saturated — must be missing-key situation.
      const { warnings } = await findSimilar({ url }, { ...opts, providers });
      slotWarnings.push(...warnings);
    }

    results.push({ url, candidates, warnings: slotWarnings });
  }

  return { results };
}

// ---------------------------------------------------------------------------
// Batch Reverse-Image Search with Parallel Federation
// ---------------------------------------------------------------------------

/**
 * A single image input for `batchFindSimilarWithFederation`.
 * Exactly one of `url` or `bytes` must be provided.
 */
export interface FederatedImageInput {
  /** Public URL of the image to reverse-search. */
  url?: string;
  /** Raw image bytes (e.g. from disk or a prior download). */
  bytes?: Uint8Array;
}

/**
 * Per-image result returned inside `BatchFederationOutput.results`.
 */
export interface FederatedImageResult {
  /** Zero-based index into the input array. */
  imageIndex: number;
  /** Deduped, ranked candidates found for this image. */
  candidates: ImageCandidate[];
  /** Per-provider reports for this image's federation round. */
  providerReports: ProviderReport[];
  /** Non-fatal warnings for this image (rate-limit skips, missing keys, etc.). */
  warnings: string[];
  /** True when the per-image timeout fired before all providers responded. */
  timedOut: boolean;
}

/**
 * Batch-level provider summary aggregated across all images.
 */
export interface BatchProviderSummary {
  /** Provider id. */
  provider: ProviderId;
  /** How many images this provider was attempted for. */
  attempts: number;
  /** How many attempts succeeded (ok: true). */
  successes: number;
  /** How many attempts were skipped due to rate-limit saturation. */
  rateLimitSkips: number;
  /** How many attempts failed (ok: false and not a rate-limit skip). */
  failures: number;
  /** Total candidates contributed by this provider across all images. */
  totalCandidates: number;
}

/**
 * Top-level result of `batchFindSimilarWithFederation`.
 */
export interface BatchFederationOutput {
  /** Unique identifier for this batch run (monotonic wall-clock string). */
  batchId: string;
  /** Per-image results in input order. */
  results: FederatedImageResult[];
  /** Aggregate provider behaviour across all images. */
  federationSummary: BatchProviderSummary[];
}

/**
 * Options for `batchFindSimilarWithFederation`.
 *
 * Extends `SearchOptions` with batch-specific knobs.
 */
export interface BatchFederationOptions extends SearchOptions {
  /**
   * Per-image timeout in milliseconds.
   * Defaults to `timeoutMs ?? 15_000`.
   * Each image gets its own AbortController wired to this budget; a timeout
   * on one image never affects other images in the batch.
   */
  perImageTimeoutMs?: number;
  /**
   * Max candidates to return per image after cross-provider deduplication.
   * Default: 20.
   */
  limitPerImage?: number;
  /**
   * When true, if an image URL/bytes appears more than once in the input array
   * the second+ occurrence copies the result of the first (no redundant calls).
   * Matching for URL inputs is by exact string equality.
   * Default: false.
   */
  dedupeSameImageInBatch?: boolean;
  /**
   * Optional early-exit criteria applied per image (forwarded to `findSimilar`
   * as `earlyExitCriteria` on the per-image SearchOptions).
   * When supplied together with `raceProviders: true`, each image's federation
   * round stops as soon as the qualifying count is reached.
   */
  earlyExitCriteria?: EarlyExitCriteria;
  /**
   * License policy forwarded to per-image calls. Default: "safe-only".
   */
  licensePolicy?: LicensePolicy;
}

// ---------------------------------------------------------------------------
// Tier-1 providers (public-domain heavy) — dispatched in the first wave when
// providerQueueing is active. Mirrors the definition in federation.ts.
// ---------------------------------------------------------------------------
const TIER1_PROVIDER_IDS = new Set<ProviderId>([
  "wikimedia",
  "openverse",
  "internet-archive",
  "smithsonian",
  "nasa",
  "met-museum",
  "library-of-congress",
  "wellcome-collection",
  "rawpixel",
  "burst",
]);

/**
 * Partition a provider list into [tier1, tier2].
 * Used to queue images so tier-1 (public-domain) providers get first wave.
 */
function partitionByTier(
  providers: ProviderId[],
): { tier1: ProviderId[]; tier2: ProviderId[] } {
  const tier1 = providers.filter((p) => TIER1_PROVIDER_IDS.has(p));
  const tier2 = providers.filter((p) => !TIER1_PROVIDER_IDS.has(p));
  return { tier1, tier2 };
}

/**
 * Check rate-limit saturation for a provider.
 * Returns true when the provider's token bucket is currently empty.
 */
function isProviderSaturated(p: ProviderId, opts: SearchOptions): boolean {
  if (p === "brave") {
    const key = opts.auth?.braveApiKey ?? process.env.BRAVE_API_KEY;
    if (!key) return false;
    return getBucket("brave").saturated();
  }
  if (p === "serpapi") {
    const key = opts.auth?.serpApiKey ?? process.env.SERPAPI_KEY;
    if (!key) return false;
    return getBucket("serpapi").saturated();
  }
  // Other providers: check their bucket directly (no auth gate needed).
  return getBucket(p).saturated();
}

/**
 * Run a single reverse-image search for one image with an independent timeout.
 * Returns a `FederatedImageResult` regardless of success or partial failure.
 */
async function runOneImage(
  imageIndex: number,
  input: FederatedImageInput,
  providers: ProviderId[],
  opts: BatchFederationOptions,
  perImageTimeoutMs: number,
  limitPerImage: number,
): Promise<FederatedImageResult> {
  const warnings: string[] = [];
  const providerReports: ProviderReport[] = [];

  // Partition providers into tier-1 and tier-2 for ordered dispatch.
  const { tier1, tier2 } = partitionByTier(providers);
  // Build final ordered list: tier-1 first, then tier-2.
  const orderedProviders = [...tier1, ...tier2];

  // Check saturation per-provider before dispatch; emit warnings for skipped ones.
  const saturatedProviders: ProviderId[] = [];
  const availableProviders: ProviderId[] = [];
  for (const p of orderedProviders) {
    if (isProviderSaturated(p, opts)) {
      saturatedProviders.push(p);
      const label = input.url ?? `image[${imageIndex}]`;
      warnings.push(`${p} rate-limit saturated for ${label} — skipped`);
      providerReports.push({
        provider: p,
        ok: false,
        count: 0,
        timeMs: 0,
        skipped: "rate-limited",
        errorKind: "rate-limited",
      });
    } else {
      availableProviders.push(p);
    }
  }

  if (availableProviders.length === 0) {
    // All providers saturated or no providers supplied.
    return {
      imageIndex,
      candidates: [],
      providerReports,
      warnings,
      timedOut: false,
    };
  }

  // Per-image AbortController — timeout never affects sibling images.
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, perImageTimeoutMs);

  // Compose with outer signal if provided.
  const outerSignal = opts.signal;
  const onOuterAbort = () => ctl.abort();
  outerSignal?.addEventListener("abort", onOuterAbort);

  try {
    const perImageOpts: SearchOptions = {
      ...opts,
      providers: availableProviders,
      signal: ctl.signal,
      // Forward early-exit criteria when raceProviders is active.
      ...(opts.earlyExitCriteria ? { earlyExitCriteria: opts.earlyExitCriteria } : {}),
    };

    const ref = input.url !== undefined
      ? { url: input.url, bytes: input.bytes }
      : { url: "", bytes: input.bytes };

    const { candidates: raw, warnings: findWarnings } = await findSimilar(ref, perImageOpts);
    warnings.push(...findWarnings);

    // If our timer fired while findSimilar was running (it swallows AbortError
    // internally and returns empty), surface a timeout warning here too.
    if (timedOut) {
      warnings.push(`image[${imageIndex}] timed out after ${perImageTimeoutMs} ms`);
    }

    // Build synthetic provider reports from the candidate list (findSimilar
    // does not return ProviderReport structs, so we synthesise one per provider
    // that contributed candidates).
    const candidatesByProvider = new Map<string, number>();
    for (const c of raw) {
      candidatesByProvider.set(c.source, (candidatesByProvider.get(c.source) ?? 0) + 1);
    }
    for (const p of availableProviders) {
      const count = candidatesByProvider.get(p) ?? 0;
      // Mark as failed when we timed out (even though findSimilar returned ok).
      const ok = !timedOut;
      providerReports.push({
        provider: p,
        ok,
        count,
        timeMs: 0, // timing not available from findSimilar
        errorKind: timedOut ? "timeout" : "ok",
        ...(timedOut ? { error: `timed out after ${perImageTimeoutMs} ms` } : {}),
      });
    }

    const deduped = timedOut ? [] : dedupeByUrl(raw).slice(0, limitPerImage);
    return {
      imageIndex,
      candidates: deduped,
      providerReports,
      warnings,
      timedOut,
    };
  } catch (e) {
    const msg = (e as Error).message ?? "unknown";
    // On timeout the AbortController fires — surface a clear warning.
    if (timedOut) {
      warnings.push(`image[${imageIndex}] timed out after ${perImageTimeoutMs} ms`);
    } else {
      warnings.push(`image[${imageIndex}] failed: ${msg}`);
    }
    // Mark all available providers as failed.
    for (const p of availableProviders) {
      providerReports.push({
        provider: p,
        ok: false,
        count: 0,
        timeMs: perImageTimeoutMs,
        error: msg,
        errorKind: timedOut ? "timeout" : "network",
      });
    }
    return {
      imageIndex,
      candidates: [],
      providerReports,
      warnings,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

/**
 * Aggregate per-image `ProviderReport[]` into a batch-level summary.
 */
function buildFederationSummary(
  results: FederatedImageResult[],
): BatchProviderSummary[] {
  const map = new Map<
    ProviderId,
    { attempts: number; successes: number; rateLimitSkips: number; failures: number; totalCandidates: number }
  >();

  for (const result of results) {
    for (const report of result.providerReports) {
      let entry = map.get(report.provider);
      if (!entry) {
        entry = { attempts: 0, successes: 0, rateLimitSkips: 0, failures: 0, totalCandidates: 0 };
        map.set(report.provider, entry);
      }
      entry.attempts += 1;
      if (report.skipped === "rate-limited") {
        entry.rateLimitSkips += 1;
      } else if (report.ok) {
        entry.successes += 1;
        entry.totalCandidates += report.count;
      } else {
        entry.failures += 1;
      }
    }
  }

  return Array.from(map.entries())
    .map(([provider, stats]) => ({ provider, ...stats }))
    .sort((a, b) => b.totalCandidates - a.totalCandidates);
}

/**
 * Efficient reverse-image search for 10–100 images in a single call.
 *
 * Key behaviours:
 *   - All images are processed concurrently (Promise.allSettled).
 *   - Tier-1 (public-domain heavy) providers are ordered first per image.
 *   - Rate-limit saturation is checked before each image; saturated providers
 *     are skipped with a warning rather than blocking the batch.
 *   - Each image gets an independent timeout (`perImageTimeoutMs`); a slow
 *     image never delays other images in the batch.
 *   - Cross-provider candidates are deduped by URL per image before capping.
 *   - When `dedupeSameImageInBatch` is true, duplicate URL inputs share their
 *     result without re-issuing network calls.
 *   - `earlyExitCriteria` (forwarded via raceProviders) lets each image's
 *     federation stop as soon as N qualifying results have arrived.
 *
 * @param images   Array of `{url} | {bytes}` inputs (max 100; excess are warned).
 * @param opts     Batch-federation options (extends SearchOptions).
 * @returns        `{batchId, results, federationSummary}`.
 */
export async function batchFindSimilarWithFederation(
  images: FederatedImageInput[],
  opts: BatchFederationOptions = {},
): Promise<BatchFederationOutput> {
  const MAX_BATCH_SIZE = 100;
  const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const warnings: string[] = [];

  // Clamp batch size.
  let inputs = images;
  if (inputs.length > MAX_BATCH_SIZE) {
    warnings.push(
      `batchFindSimilarWithFederation: input truncated from ${inputs.length} to ${MAX_BATCH_SIZE}`,
    );
    inputs = inputs.slice(0, MAX_BATCH_SIZE);
  }

  if (inputs.length === 0) {
    return {
      batchId,
      results: [],
      federationSummary: [],
    };
  }

  const providers: ProviderId[] = (opts.providers ?? []) as ProviderId[];
  const perImageTimeoutMs = opts.perImageTimeoutMs ?? opts.timeoutMs ?? 15_000;
  const limitPerImage = opts.limitPerImage ?? 20;
  const dedupeSameImageInBatch = opts.dedupeSameImageInBatch ?? false;

  // Optional same-image dedup: cache the in-flight Promise keyed by URL so that
  // concurrent calls for the same URL share one network round-trip. Bytes inputs
  // always run independently (no stable key).
  const urlPromiseCache = new Map<string, Promise<FederatedImageResult>>();

  // Run all images concurrently; each has its own timeout and never blocks others.
  const settled = await Promise.allSettled(
    inputs.map((input, idx): Promise<FederatedImageResult> => {
      if (dedupeSameImageInBatch && input.url) {
        const existing = urlPromiseCache.get(input.url);
        if (existing) {
          // Re-use the in-flight (or already-resolved) promise, but patch imageIndex.
          return existing.then((r) => ({ ...r, imageIndex: idx }));
        }
      }

      const promise = runOneImage(
        idx,
        input,
        providers,
        opts,
        perImageTimeoutMs,
        limitPerImage,
      );

      if (dedupeSameImageInBatch && input.url) {
        urlPromiseCache.set(input.url, promise);
      }

      return promise;
    }),
  );

  // Collect results; convert rejections to error entries (should not happen
  // since runOneImage never throws, but guard defensively).
  const results: FederatedImageResult[] = settled.map((s, idx) => {
    if (s.status === "fulfilled") return s.value;
    return {
      imageIndex: idx,
      candidates: [],
      providerReports: [],
      warnings: [`image[${idx}] unexpected rejection: ${(s.reason as Error)?.message ?? s.reason}`],
      timedOut: false,
    };
  });

  // Prepend any batch-level warnings to the first result's warnings array so
  // callers can surface them without a separate field.
  if (warnings.length > 0 && results.length > 0) {
    results[0]!.warnings = [...warnings, ...results[0]!.warnings];
  }

  const federationSummary = buildFederationSummary(results);

  return { batchId, results, federationSummary };
}
