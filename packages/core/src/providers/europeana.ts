/**
 * Europeana — cultural heritage aggregator. Requires free API key via
 * `auth.europeanaApiKey` or env `EUROPEANA_API_KEY`.
 * `qf=REUSABILITY:open` restricts to CC-licensed / PD / CC0.
 */

import { coerceLicense } from "../license.ts";
import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const europeana: Provider = {
  id: "europeana",
  defaultLicense: "CC_BY",
  requiresAuth: true,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    const key =
      opts.auth?.europeanaApiKey ?? (globalThis as any).process?.env?.EUROPEANA_API_KEY;
    if (!key) throw new Error("europeana missing EUROPEANA_API_KEY");

    await getBucket("europeana").take();
    const fetcher = opts.fetcher ?? fetch;
    const url =
      "https://api.europeana.eu/record/v2/search.json?" +
      new URLSearchParams({
        wskey: key,
        query,
        qf: "TYPE:IMAGE",
        reusability: "open",
        media: "true",
        thumbnail: "true",
        rows: String(opts.maxPerProvider ?? 10),
      });
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`europeana http ${resp.status}`);
    const json = (await resp.json()) as any;
    const items = json?.items ?? [];

    const out: ImageCandidate[] = [];
    for (const it of items) {
      const imgUrl = it.edmIsShownBy?.[0] ?? it.edmPreview?.[0];
      if (!imgUrl) continue;
      const rights = it.rights?.[0] ?? "";
      const license = coerceLicense(rights);
      if (license === "UNKNOWN") continue;
      out.push({
        url: imgUrl,
        thumbnailUrl: it.edmPreview?.[0],
        source: "europeana",
        sourcePageUrl: it.guid ?? it.edmIsShownAt?.[0],
        title: Array.isArray(it.title) ? it.title[0] : it.title,
        author: Array.isArray(it.dcCreator) ? it.dcCreator[0] : it.dcCreator,
        license,
        licenseUrl: rights,
        confidence: 0.85,
      });
    }
    return out;
  },
};
