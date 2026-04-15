/**
 * Brave Image Search API — requires key. Brave returns arbitrary web results
 * with no reliable license metadata, so candidates come back with license
 * UNKNOWN unless url-heuristics upgrade them. For `safe-only` policy callers
 * these are mostly dropped — by design.
 */

import { heuristicLicenseFromUrl } from "../license.ts";
import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const brave: Provider = {
  id: "brave",
  defaultLicense: "UNKNOWN",
  requiresAuth: true,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    const key = opts.auth?.braveApiKey ?? process.env.BRAVE_API_KEY;
    if (!key) throw new Error("BRAVE_API_KEY missing");
    await getBucket("brave").take();
    const fetcher = opts.fetcher ?? fetch;
    const url = `https://api.search.brave.com/res/v1/images/search?${new URLSearchParams({
      q: query,
      count: String(opts.maxPerProvider ?? 10),
      safesearch: opts.safeSearch === "off" ? "off" : (opts.safeSearch ?? "strict"),
    })}`;
    const resp = await fetcher(url, {
      headers: { "X-Subscription-Token": key, Accept: "application/json" },
      signal: opts.signal,
    });
    if (!resp.ok) throw new Error(`brave http ${resp.status}`);
    const json = (await resp.json()) as any;
    return (json.results ?? []).map((r: any): ImageCandidate => {
      const imgUrl = r.properties?.url ?? r.thumbnail?.src ?? r.url;
      const heuristic = heuristicLicenseFromUrl(imgUrl);
      return {
        url: imgUrl,
        thumbnailUrl: r.thumbnail?.src,
        width: r.properties?.width,
        height: r.properties?.height,
        source: "brave",
        sourcePageUrl: r.url,
        title: r.title,
        license: heuristic.license,
        confidence: heuristic.confidence,
      };
    });
  },
};
