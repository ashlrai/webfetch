/**
 * Burst (by Shopify): CC0 stock photography. No auth required.
 *
 * Opt-in since 2026-09. burst.shopify.com/photos/search.json now 301s to
 * www.shopify.com/stock-photos/..., which answers the JSON request with
 * HTTP 406. The HTML search page is disallowed by robots.txt, so scraping
 * it is not an option. Kept as an opt-in adapter in case the JSON endpoint
 * comes back. See docs/PROVIDERS.md.
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const burst: Provider = {
  id: "burst",
  defaultLicense: "CC0",
  requiresAuth: false,
  optIn: true,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    await getBucket("burst").take();
    const fetcher = opts.fetcher ?? fetch;
    const url = `https://burst.shopify.com/photos/search.json?${new URLSearchParams({ q: query })}`;
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) {
      const retired = resp.status === 404 || resp.status === 406 || resp.status === 410;
      throw new Error(
        retired
          ? `burst http ${resp.status}: Burst's JSON search endpoint appears retired (burst.shopify.com now redirects to shopify.com/stock-photos)`
          : `burst http ${resp.status}`,
      );
    }
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
