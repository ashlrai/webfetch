/**
 * Wellcome Collection — medical, historical, scientific imagery. Free, no auth.
 * All items exposed via the catalogue API carry a structured `license.id`.
 * https://developers.wellcomecollection.org/
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, License, Provider, SearchOptions } from "../types.ts";

export const wellcomeCollection: Provider = {
  id: "wellcome-collection",
  defaultLicense: "CC_BY",
  requiresAuth: false,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    await getBucket("wellcome-collection").take();
    const fetcher = opts.fetcher ?? fetch;
    const url = `https://api.wellcomecollection.org/catalogue/v2/images?${new URLSearchParams({
      query,
      license: "cc-by,cc-by-nc-nd,pdm,cc0",
      pageSize: String(opts.maxPerProvider ?? 10),
    })}`;
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`wellcome-collection http ${resp.status}`);
    const json = (await resp.json()) as any;
    const results: any[] = json?.results ?? [];

    const out: ImageCandidate[] = [];
    for (const r of results) {
      const imgUrl = r.thumbnail?.url ?? r.locations?.[0]?.url;
      if (!imgUrl) continue;
      const licenseId: string | undefined =
        r.locations?.[0]?.license?.id ?? r.thumbnail?.license?.id;
      const license = mapLicense(licenseId);
      if (license === "UNKNOWN") continue; // enforce safe-only filter
      const contributors = r.source?.contributors ?? [];
      const author = contributors
        .map((c: any) => c?.agent?.label)
        .filter(Boolean)
        .join(", ");
      out.push({
        url: imgUrl,
        thumbnailUrl: r.thumbnail?.url,
        source: "wellcome-collection",
        sourcePageUrl: r.id
          ? `https://wellcomecollection.org/works/${r.source?.id ?? r.id}`
          : undefined,
        title: r.source?.title,
        author: author || undefined,
        license,
        licenseUrl: r.locations?.[0]?.license?.url,
        confidence: 0.9,
      });
    }
    return out;
  },
};

function mapLicense(id: string | undefined): License {
  if (!id) return "UNKNOWN";
  const s = id.toLowerCase();
  if (s === "cc0") return "CC0";
  if (s === "pdm") return "PUBLIC_DOMAIN";
  if (s === "cc-by" || s === "cc-by-4.0") return "CC_BY";
  if (s === "cc-by-sa") return "CC_BY_SA";
  // cc-by-nc-nd, cc-by-nc, etc → not safe for commercial reuse.
  return "UNKNOWN";
}
