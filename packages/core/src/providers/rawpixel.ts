/**
 * Rawpixel — free CC0 stock via the `freecc0=1` query param.
 * No auth required today; optionally sends `RAWPIXEL_API_KEY` if present.
 * Every image returned is forced to CC0 by the query filter.
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const rawpixel: Provider = {
  id: "rawpixel",
  defaultLicense: "CC0",
  requiresAuth: false,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    await getBucket("rawpixel").take();
    const fetcher = opts.fetcher ?? fetch;
    const url = `https://www.rawpixel.com/api/v1/search?${new URLSearchParams({
      freecc0: "1",
      q: query,
      page: "1",
      pagination: "1",
    })}`;
    const key = opts.auth?.rawpixelApiKey ?? (globalThis as any).process?.env?.RAWPIXEL_API_KEY;
    const headers: Record<string, string> = { accept: "application/json" };
    if (key) headers.authorization = `Bearer ${key}`;

    const resp = await fetcher(url, { signal: opts.signal, headers });
    if (!resp.ok) throw new Error(`rawpixel http ${resp.status}`);
    const json = (await resp.json()) as any;
    const results: any[] = json?.results ?? [];

    const out: ImageCandidate[] = [];
    for (const r of results) {
      const imgUrl = r.image_1300 ?? r.image_md ?? r.image;
      if (!imgUrl) continue;
      out.push({
        url: imgUrl,
        thumbnailUrl: r.image_md ?? imgUrl,
        source: "rawpixel",
        sourcePageUrl: r.pageURL ?? r.url,
        title: r.title,
        author: r.user?.display_name ?? r.user?.username,
        license: "CC0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        confidence: 0.9,
      });
    }
    return out;
  },
};
