/**
 * Burst (by Shopify) — 100% CC0 stock photography. No auth required.
 * https://burst.shopify.com/
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const burst: Provider = {
  id: "burst",
  defaultLicense: "CC0",
  requiresAuth: false,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    await getBucket("burst").take();
    const fetcher = opts.fetcher ?? fetch;
    const url =
      "https://burst.shopify.com/photos/search.json?" +
      new URLSearchParams({ q: query });
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`burst http ${resp.status}`);
    const json = (await resp.json()) as any;
    const photos: any[] = json?.photos ?? json?.results ?? [];
    const limit = opts.maxPerProvider ?? 10;

    const out: ImageCandidate[] = [];
    for (const p of photos.slice(0, limit)) {
      const imgUrl = p.image_url ?? p.url;
      if (!imgUrl) continue;
      out.push({
        url: imgUrl,
        thumbnailUrl: p.thumbnail_url ?? imgUrl,
        source: "burst",
        sourcePageUrl: p.permalink ?? p.page_url,
        title: p.title,
        author: p.photographer?.name ?? p.photographer,
        license: "CC0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        confidence: 0.95,
      });
    }
    return out;
  },
};
