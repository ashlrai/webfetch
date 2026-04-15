/**
 * Pexels — free key. Pexels License is CC0-like; commercial OK, no attribution required.
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const pexels: Provider = {
  id: "pexels",
  defaultLicense: "CC0",
  requiresAuth: true,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    const key = opts.auth?.pexelsApiKey ?? process.env.PEXELS_API_KEY;
    if (!key) throw new Error("PEXELS_API_KEY missing");
    await getBucket("pexels").take();
    const fetcher = opts.fetcher ?? fetch;
    const url = `https://api.pexels.com/v1/search?${new URLSearchParams({ query, per_page: String(opts.maxPerProvider ?? 10) })}`;
    const resp = await fetcher(url, { headers: { Authorization: key }, signal: opts.signal });
    if (!resp.ok) throw new Error(`pexels http ${resp.status}`);
    const json = (await resp.json()) as any;
    return (json.photos ?? []).map(
      (p: any): ImageCandidate => ({
        url: p.src?.original,
        thumbnailUrl: p.src?.medium,
        width: p.width,
        height: p.height,
        source: "pexels",
        sourcePageUrl: p.url,
        title: p.alt,
        author: p.photographer,
        license: "CC0",
        licenseUrl: "https://www.pexels.com/license/",
        confidence: 0.85,
      }),
    );
  },
};
