/**
 * Internet Archive — advanced search for image mediatype with CC or PD rights.
 * No auth required. All output is CC0 / CC_BY-family / PD based on licenseurl.
 */

import { coerceLicense } from "../license.ts";
import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, License, Provider, SearchOptions } from "../types.ts";

export const internetArchive: Provider = {
  id: "internet-archive",
  defaultLicense: "PUBLIC_DOMAIN",
  requiresAuth: false,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    await getBucket("internet-archive").take();
    const fetcher = opts.fetcher ?? fetch;
    const q = `(${query}) AND mediatype:image AND (licenseurl:*creativecommons* OR rights:*public\\ domain*)`;
    const url = `https://archive.org/advancedsearch.php?${new URLSearchParams({
      q,
      "fl[]": "identifier,title,creator,licenseurl,rights,mediatype",
      rows: String(opts.maxPerProvider ?? 10),
      page: "1",
      output: "json",
    })}`;
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`internet-archive http ${resp.status}`);
    const json = (await resp.json()) as any;
    const docs = json?.response?.docs ?? [];

    const out: ImageCandidate[] = [];
    for (const d of docs) {
      if (!d.identifier) continue;
      const license = mapLicense(d.licenseurl, d.rights);
      const sourcePageUrl = `https://archive.org/details/${encodeURIComponent(d.identifier)}`;
      // IA exposes a __ia_thumb.jpg and a services/img endpoint.
      const url = `https://archive.org/services/img/${encodeURIComponent(d.identifier)}`;
      out.push({
        url,
        thumbnailUrl: url,
        source: "internet-archive",
        sourcePageUrl,
        title: d.title,
        author: Array.isArray(d.creator) ? d.creator.join(", ") : d.creator,
        license,
        licenseUrl: d.licenseurl,
        confidence: license === "UNKNOWN" ? 0.2 : 0.85,
      });
    }
    return out;
  },
};

function mapLicense(licenseUrl: string | undefined, rights: string | undefined): License {
  if (licenseUrl) {
    const s = licenseUrl.toLowerCase();
    if (s.includes("publicdomain/zero")) return "CC0";
    if (s.includes("publicdomain")) return "PUBLIC_DOMAIN";
    const coerced = coerceLicense(licenseUrl);
    if (coerced !== "UNKNOWN") return coerced;
  }
  if (rights && /public.domain/i.test(String(rights))) return "PUBLIC_DOMAIN";
  return "UNKNOWN";
}
