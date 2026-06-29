/**
 * Reverse-image search across multiple providers.
 *
 * Supported providers: "brave", "serpapi"
 * For local bytes, the caller must either host them on a public URL first or
 * pass the raw bytes (Brave supports base64 content; SerpAPI is URL-only).
 */

import { heuristicLicenseFromUrl } from "./license.ts";
import { getBucket } from "./rate-limit.ts";
import { brave } from "./providers/brave.ts";
import type { ImageCandidate, ProviderId, SearchOptions } from "./types.ts";

export async function findSimilar(
  ref: { url: string; bytes?: Uint8Array },
  opts: SearchOptions = {},
): Promise<{ candidates: ImageCandidate[]; warnings: string[] }> {
  const warnings: string[] = [];
  const out: ImageCandidate[] = [];
  const fetcher = opts.fetcher ?? fetch;

  const activeProviders: ProviderId[] = opts.providers ?? [];

  // ── SerpAPI ───────────────────────────────────────────────────────────────
  if (activeProviders.includes("serpapi")) {
    const serpKey = opts.auth?.serpApiKey ?? process.env.SERPAPI_KEY;
    if (!serpKey) {
      warnings.push("serpapi reverse skipped: SERPAPI_KEY missing");
    } else {
      const bucket = getBucket("serpapi");
      if (bucket.saturated()) {
        warnings.push("serpapi reverse skipped: rate-limit bucket saturated");
      } else {
        await bucket.take();
        const u = `https://serpapi.com/search.json?${new URLSearchParams({
          engine: "google_reverse_image",
          image_url: ref.url,
          api_key: serpKey,
        })}`;
        try {
          const resp = await fetcher(u, { signal: opts.signal });
          if (resp.ok) {
            const json = (await resp.json()) as any;
            for (const r of json.image_results ?? []) {
              const heur = heuristicLicenseFromUrl(r.thumbnail ?? r.link);
              out.push({
                url: r.thumbnail ?? r.link,
                source: "serpapi",
                sourcePageUrl: r.link,
                title: r.title,
                license: heur.license,
                confidence: heur.confidence,
              });
            }
          } else {
            warnings.push(`serpapi reverse failed: http ${resp.status}`);
          }
        } catch (e) {
          warnings.push(`serpapi reverse failed: ${(e as Error).message}`);
        }
      }
    }
  }

  // ── Brave ─────────────────────────────────────────────────────────────────
  if (activeProviders.includes("brave")) {
    const braveKey = opts.auth?.braveApiKey ?? process.env.BRAVE_API_KEY;
    if (!braveKey) {
      warnings.push("brave reverse skipped: BRAVE_API_KEY missing");
    } else {
      const bucket = getBucket("brave");
      if (bucket.saturated()) {
        warnings.push("brave reverse skipped: rate-limit bucket saturated");
      } else {
        try {
          const candidates = await brave.findSimilar!(ref, { ...opts, fetcher });
          out.push(...candidates);
        } catch (e) {
          warnings.push(`brave reverse failed: ${(e as Error).message}`);
        }
      }
    }
  }

  if (activeProviders.length === 0) {
    warnings.push(
      'find_similar requires providers: ["brave"] and/or ["serpapi"] with appropriate API keys',
    );
  }

  return { candidates: out, warnings };
}
