/** Pixabay — free key. Pixabay License is CC0-like. */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const pixabay: Provider = {
  id: "pixabay",
  defaultLicense: "CC0",
  requiresAuth: true,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    const key = opts.auth?.pixabayApiKey ?? process.env.PIXABAY_API_KEY;
    if (!key) throw new Error("PIXABAY_API_KEY missing");
    await getBucket("pixabay").take();
    const fetcher = opts.fetcher ?? fetch;
    const url =
      "https://pixabay.com/api/?" +
      new URLSearchParams({
        key,
        q: query,
        per_page: String(opts.maxPerProvider ?? 10),
        safesearch: opts.safeSearch === "off" ? "false" : "true",
      });
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`pixabay http ${resp.status}`);
    const json = (await resp.json()) as any;
    return (json.hits ?? []).map((p: any): ImageCandidate => ({
      url: p.largeImageURL ?? p.webformatURL,
      thumbnailUrl: p.previewURL,
      width: p.imageWidth,
      height: p.imageHeight,
      source: "pixabay",
      sourcePageUrl: p.pageURL,
      author: p.user,
      license: "CC0",
      licenseUrl: "https://pixabay.com/service/license-summary/",
      confidence: 0.85,
    }));
  },
};
