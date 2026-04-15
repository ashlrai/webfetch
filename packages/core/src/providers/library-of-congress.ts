/**
 * Library of Congress — massive public-domain / US-gov archive.
 * No auth required. Results are typically public domain; we coerce
 * conservatively against the per-item `rights` / `rights_information` field.
 * https://www.loc.gov/apis/json-and-yaml/
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, License, Provider, SearchOptions } from "../types.ts";

export const libraryOfCongress: Provider = {
  id: "library-of-congress",
  defaultLicense: "PUBLIC_DOMAIN",
  requiresAuth: false,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    await getBucket("library-of-congress").take();
    const fetcher = opts.fetcher ?? fetch;
    const url =
      "https://www.loc.gov/search/?" +
      new URLSearchParams({
        fo: "json",
        q: query,
        "fa": "original-format:photo, print, drawing|original-format:film, video",
        c: String(opts.maxPerProvider ?? 25),
      });
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`library-of-congress http ${resp.status}`);
    const json = (await resp.json()) as any;
    const results: any[] = json?.results ?? [];

    const out: ImageCandidate[] = [];
    for (const r of results) {
      const imgUrl = pickImageUrl(r);
      if (!imgUrl) continue;
      const license = mapRights(r.rights ?? r.rights_information ?? r.rights_advisory);
      out.push({
        url: imgUrl,
        thumbnailUrl: imgUrl,
        source: "library-of-congress",
        sourcePageUrl: r.url ?? r.id,
        title: typeof r.title === "string" ? r.title : Array.isArray(r.title) ? r.title[0] : undefined,
        author: pickAuthor(r),
        license,
        licenseUrl: typeof r.rights === "string" ? r.rights : undefined,
        confidence: license === "PUBLIC_DOMAIN" ? 0.85 : 0.2,
      });
    }
    return out;
  },
};

function pickImageUrl(r: any): string | undefined {
  const iu = r.image_url;
  if (!iu) return undefined;
  if (typeof iu === "string") return iu;
  if (Array.isArray(iu) && iu.length > 0) {
    // Pick the largest-looking entry (longest string usually == biggest variant).
    return iu.reduce((a: string, b: string) => (String(b).length > String(a).length ? b : a), iu[0]);
  }
  return undefined;
}

function pickAuthor(r: any): string | undefined {
  const c = r.contributor ?? r.creator;
  if (!c) return undefined;
  if (typeof c === "string") return c;
  if (Array.isArray(c) && c.length > 0) return String(c[0]);
  return undefined;
}

function mapRights(raw: unknown): License {
  if (!raw) return "PUBLIC_DOMAIN"; // LoC default posture is PD; most items are.
  const s = String(Array.isArray(raw) ? raw[0] : raw).toLowerCase();
  if (s.includes("no known restrictions") || s.includes("public domain")) return "PUBLIC_DOMAIN";
  if (s.includes("cc0") || s.includes("publicdomain/zero")) return "CC0";
  if (s.includes("rights") && (s.includes("restrict") || s.includes("may apply") || s.includes("copyright")))
    return "UNKNOWN";
  // Conservative: when the field is present but ambiguous, return UNKNOWN.
  return "UNKNOWN";
}
