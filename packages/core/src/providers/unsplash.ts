/**
 * Unsplash — requires free access key. Results use the proprietary Unsplash
 * License: commercial reuse is broadly allowed, but it is not CC0.
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const unsplash: Provider = {
  id: "unsplash",
  defaultLicense: "UNSPLASH_LICENSE",
  requiresAuth: true,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    const key = opts.auth?.unsplashAccessKey ?? process.env.UNSPLASH_ACCESS_KEY;
    if (!key) throw new Error("UNSPLASH_ACCESS_KEY missing");
    await getBucket("unsplash").take();
    const fetcher = opts.fetcher ?? fetch;
    const url = `https://api.unsplash.com/search/photos?${new URLSearchParams({
      query,
      per_page: String(opts.maxPerProvider ?? 10),
      content_filter: opts.safeSearch === "off" ? "low" : "high",
    })}`;
    const resp = await fetcher(url, {
      headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
      signal: opts.signal,
    });
    if (!resp.ok) throw new Error(`unsplash http ${resp.status}`);
    const json = (await resp.json()) as any;
    return (json.results ?? []).map(
      (r: any): ImageCandidate => ({
        url: r.urls?.full ?? r.urls?.regular,
        thumbnailUrl: r.urls?.small,
        width: r.width,
        height: r.height,
        source: "unsplash",
        sourcePageUrl: r.links?.html,
        title: r.description ?? r.alt_description,
        author: r.user?.name,
        license: "UNSPLASH_LICENSE",
        licenseUrl: "https://unsplash.com/license",
        confidence: 0.85,
      }),
    );
  },
};
