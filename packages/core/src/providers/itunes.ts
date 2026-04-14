/**
 * iTunes Search API — no key. Great for artist portraits + album covers.
 * License: EDITORIAL_LICENSED (Apple's terms allow editorial display alongside
 * track/album identification; see LICENSE_POLICY.md).
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const itunes: Provider = {
  id: "itunes",
  defaultLicense: "EDITORIAL_LICENSED",
  requiresAuth: false,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    await getBucket("itunes").take();
    const fetcher = opts.fetcher ?? fetch;
    const url =
      "https://itunes.apple.com/search?" +
      new URLSearchParams({
        term: query,
        entity: "musicArtist,album",
        limit: String(opts.maxPerProvider ?? 10),
        media: "music",
      });
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`itunes http ${resp.status}`);
    const json = (await resp.json()) as any;
    const out: ImageCandidate[] = [];
    for (const r of json.results ?? []) {
      const small = r.artworkUrl100 ?? r.artworkUrl60;
      if (!small) continue;
      // iTunes serves sized URLs; upscale by rewriting the segment.
      const big = small.replace(/\/\d+x\d+bb\.(jpg|png)/, "/1200x1200bb.$1");
      out.push({
        url: big,
        thumbnailUrl: small,
        width: 1200,
        height: 1200,
        source: "itunes",
        sourcePageUrl: r.collectionViewUrl ?? r.artistViewUrl,
        title: r.collectionName ?? r.artistName,
        author: r.artistName,
        license: "EDITORIAL_LICENSED",
        licenseUrl: "https://www.apple.com/legal/internet-services/itunes/",
        confidence: 0.8,
      });
    }
    return out;
  },
};
