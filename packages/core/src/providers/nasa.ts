/**
 * NASA Images API — no auth. All results are public domain (US Government works).
 * https://images-api.nasa.gov/
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const nasa: Provider = {
  id: "nasa",
  defaultLicense: "PUBLIC_DOMAIN",
  requiresAuth: false,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    await getBucket("nasa").take();
    const fetcher = opts.fetcher ?? fetch;
    const url =
      "https://images-api.nasa.gov/search?" +
      new URLSearchParams({
        q: query,
        media_type: "image",
        page_size: String(opts.maxPerProvider ?? 10),
      });
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`nasa http ${resp.status}`);
    const json = (await resp.json()) as any;
    const items = json?.collection?.items ?? [];

    const out: ImageCandidate[] = [];
    for (const it of items) {
      const data = it.data?.[0];
      const link = it.links?.find((l: any) => l.render === "image") ?? it.links?.[0];
      if (!data || !link?.href) continue;
      out.push({
        url: link.href,
        thumbnailUrl: link.href,
        source: "nasa",
        sourcePageUrl: data.nasa_id ? `https://images.nasa.gov/details/${data.nasa_id}` : undefined,
        title: data.title,
        author: data.photographer ?? data.secondary_creator ?? data.center,
        license: "PUBLIC_DOMAIN",
        licenseUrl: "https://www.nasa.gov/nasa-brand-center/images-and-media/",
        confidence: 0.95,
      });
    }
    return out;
  },
};
