/**
 * Reverse-image search. Only a few providers support it in practice:
 *   - Brave (by URL)
 *   - SerpAPI (by URL)
 * For local bytes, the caller must host them on a public URL first.
 */

import { heuristicLicenseFromUrl } from "./license.ts";
import { getBucket } from "./rate-limit.ts";
import type { ImageCandidate, SearchOptions } from "./types.ts";

export async function findSimilar(
  ref: { url: string },
  opts: SearchOptions = {},
): Promise<{ candidates: ImageCandidate[]; warnings: string[] }> {
  const warnings: string[] = [];
  const out: ImageCandidate[] = [];

  const fetcher = opts.fetcher ?? fetch;
  const serpKey = opts.auth?.serpApiKey ?? process.env.SERPAPI_KEY;
  if (serpKey && (opts.providers ?? []).includes("serpapi")) {
    await getBucket("serpapi").take();
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
      }
    } catch (e) {
      warnings.push(`serpapi reverse failed: ${(e as Error).message}`);
    }
  } else {
    warnings.push(
      'find_similar requires SERPAPI_KEY and providers: ["serpapi"] (or brave with reverse support)',
    );
  }

  return { candidates: out, warnings };
}
