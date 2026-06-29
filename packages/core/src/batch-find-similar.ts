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
 */

import { dedupeByUrl } from "./dedupe.ts";
import { findSimilar } from "./find-similar.ts";
import { getBucket } from "./rate-limit.ts";
import type { ImageCandidate, ProviderId, SearchOptions } from "./types.ts";

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
