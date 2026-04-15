/**
 * Europeana archival/editorial variant — targets TEXT records (manuscripts,
 * newspapers, book scans, ephemera) and surfaces their `edmPreview` thumbnails
 * as candidates. Useful for editorial / historical layouts where an image of
 * a page, poster, or document is wanted.
 *
 * Requires `EUROPEANA_API_KEY` (same key as `europeana`). Not in
 * DEFAULT_PROVIDERS — callers opt in explicitly.
 */

import { coerceLicense } from "../license.ts";
import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const europeanaArchival: Provider = {
  id: "europeana-archival",
  defaultLicense: "CC_BY",
  requiresAuth: true,
  optIn: true,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    const key = opts.auth?.europeanaApiKey ?? (globalThis as any).process?.env?.EUROPEANA_API_KEY;
    if (!key) throw new Error("europeana-archival missing EUROPEANA_API_KEY");

    await getBucket("europeana-archival").take();
    const fetcher = opts.fetcher ?? fetch;
    const url = `https://api.europeana.eu/record/v2/search.json?${new URLSearchParams({
      wskey: key,
      query,
      qf: "TYPE:TEXT",
      reusability: "open",
      thumbnail: "true",
      rows: String(opts.maxPerProvider ?? 10),
    })}`;
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`europeana-archival http ${resp.status}`);
    const json = (await resp.json()) as any;
    const items: any[] = json?.items ?? [];

    const out: ImageCandidate[] = [];
    for (const it of items) {
      const imgUrl = it.edmPreview?.[0];
      if (!imgUrl) continue;
      const rights = it.rights?.[0] ?? "";
      const license = coerceLicense(rights);
      if (license === "UNKNOWN") continue;
      out.push({
        url: imgUrl,
        thumbnailUrl: imgUrl,
        source: "europeana-archival",
        sourcePageUrl: it.guid ?? it.edmIsShownAt?.[0],
        title: Array.isArray(it.title) ? it.title[0] : it.title,
        author: Array.isArray(it.dcCreator) ? it.dcCreator[0] : it.dcCreator,
        license,
        licenseUrl: rights,
        confidence: 0.8,
      });
    }
    return out;
  },
};
