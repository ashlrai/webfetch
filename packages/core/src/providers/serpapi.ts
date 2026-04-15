/**
 * SerpAPI — Google Images wrapper. Opt-in (default-off) because it's the
 * "when you really need Google Images" escape hatch. License metadata is
 * almost never structured; we rely on heuristics + require the caller to
 * use licensePolicy: "any" or "prefer-safe" to see these results at all.
 */

import { heuristicLicenseFromUrl } from "../license.ts";
import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const serpapi: Provider = {
  id: "serpapi",
  defaultLicense: "UNKNOWN",
  requiresAuth: true,
  optIn: true,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    const key = opts.auth?.serpApiKey ?? process.env.SERPAPI_KEY;
    if (!key) throw new Error("SERPAPI_KEY missing");
    await getBucket("serpapi").take();
    const fetcher = opts.fetcher ?? fetch;
    const url = `https://serpapi.com/search.json?${new URLSearchParams({
      engine: "google_images",
      q: query,
      api_key: key,
      safe: opts.safeSearch === "off" ? "off" : "active",
      num: String(opts.maxPerProvider ?? 10),
    })}`;
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`serpapi http ${resp.status}`);
    const json = (await resp.json()) as any;
    return (json.images_results ?? [])
      .slice(0, opts.maxPerProvider ?? 10)
      .map((r: any): ImageCandidate => {
        const heur = heuristicLicenseFromUrl(r.original ?? r.thumbnail);
        return {
          url: r.original ?? r.thumbnail,
          thumbnailUrl: r.thumbnail,
          width: r.original_width,
          height: r.original_height,
          source: "serpapi",
          sourcePageUrl: r.link,
          title: r.title,
          author: r.source,
          license: heur.license,
          confidence: heur.confidence,
        };
      });
  },
};
