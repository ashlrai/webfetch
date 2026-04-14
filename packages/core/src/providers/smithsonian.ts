/**
 * Smithsonian Open Access — all content is CC0.
 * API key: uses `auth.smithsonianApiKey` or env `SMITHSONIAN_API_KEY`,
 * otherwise falls back to `DEMO_KEY` (low rate limit, fine for dev).
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const smithsonian: Provider = {
  id: "smithsonian",
  defaultLicense: "CC0",
  requiresAuth: false,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    await getBucket("smithsonian").take();
    const fetcher = opts.fetcher ?? fetch;
    const key =
      opts.auth?.smithsonianApiKey ??
      (globalThis as any).process?.env?.SMITHSONIAN_API_KEY ??
      "DEMO_KEY";

    const url =
      "https://api.si.edu/openaccess/api/v1.0/search?" +
      new URLSearchParams({
        q: `${query} AND online_media_type:"Images"`,
        rows: String(opts.maxPerProvider ?? 10),
        api_key: key,
      });
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`smithsonian http ${resp.status}`);
    const json = (await resp.json()) as any;
    const rows = json?.response?.rows ?? [];

    const out: ImageCandidate[] = [];
    for (const r of rows) {
      const media = r?.content?.descriptiveNonRepeating?.online_media?.media ?? [];
      const img = media.find((m: any) => m?.type === "Images" && (m?.content || m?.thumbnail));
      if (!img) continue;
      const imgUrl = img.content ?? img.thumbnail;
      const author =
        r?.content?.freetext?.name?.[0]?.content ??
        r?.content?.indexedStructured?.name?.[0];
      out.push({
        url: imgUrl,
        thumbnailUrl: img.thumbnail,
        source: "smithsonian",
        sourcePageUrl: r?.content?.descriptiveNonRepeating?.record_link ?? r?.url,
        title: r?.title ?? r?.content?.descriptiveNonRepeating?.title?.content,
        author,
        license: "CC0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        confidence: 0.95,
      });
    }
    return out;
  },
};
