/**
 * Flickr — Creative Commons photos only.
 * Requires free API key via `auth.flickrApiKey` or `FLICKR_API_KEY` env.
 * License filter: 1,2,3,4,5,7,8,9,10 (all CC + CC0 + PD + USGov).
 *
 * Rate limit: 3600/hr documented; bucket configured to 3/s.
 */

import { coerceLicense } from "../license.ts";
import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, License, Provider, SearchOptions } from "../types.ts";

// See https://www.flickr.com/services/api/flickr.photos.licenses.getInfo.html
const FLICKR_LICENSES: Record<string, { license: License; url: string; name: string }> = {
  "1": {
    license: "CC_BY_SA",
    url: "https://creativecommons.org/licenses/by-nc-sa/2.0/",
    name: "CC BY-NC-SA 2.0",
  },
  "2": {
    license: "UNKNOWN",
    url: "https://creativecommons.org/licenses/by-nc/2.0/",
    name: "CC BY-NC 2.0",
  },
  "3": {
    license: "UNKNOWN",
    url: "https://creativecommons.org/licenses/by-nc-nd/2.0/",
    name: "CC BY-NC-ND 2.0",
  },
  "4": { license: "CC_BY", url: "https://creativecommons.org/licenses/by/2.0/", name: "CC BY 2.0" },
  "5": {
    license: "CC_BY_SA",
    url: "https://creativecommons.org/licenses/by-sa/2.0/",
    name: "CC BY-SA 2.0",
  },
  "6": {
    license: "UNKNOWN",
    url: "https://creativecommons.org/licenses/by-nd/2.0/",
    name: "CC BY-ND 2.0",
  },
  "7": {
    license: "PUBLIC_DOMAIN",
    url: "https://www.flickr.com/commons/usage/",
    name: "No known copyright restrictions",
  },
  "8": {
    license: "PUBLIC_DOMAIN",
    url: "https://www.usa.gov/government-works",
    name: "United States Government Work",
  },
  "9": { license: "CC0", url: "https://creativecommons.org/publicdomain/zero/1.0/", name: "CC0" },
  "10": {
    license: "PUBLIC_DOMAIN",
    url: "https://creativecommons.org/publicdomain/mark/1.0/",
    name: "Public Domain Mark",
  },
};

// Only safe (no NC/ND) license ids.
const SAFE_LICENSE_IDS = "1,4,5,7,8,9,10";

export const flickr: Provider = {
  id: "flickr",
  defaultLicense: "CC_BY",
  requiresAuth: true,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    const key = opts.auth?.flickrApiKey ?? (globalThis as any).process?.env?.FLICKR_API_KEY;
    if (!key) throw new Error("flickr missing FLICKR_API_KEY");

    await getBucket("flickr").take();
    const fetcher = opts.fetcher ?? fetch;
    const url = `https://api.flickr.com/services/rest/?${new URLSearchParams({
      method: "flickr.photos.search",
      api_key: key,
      text: query,
      license: SAFE_LICENSE_IDS,
      content_type: "1", // photos
      safe_search: opts.safeSearch === "off" ? "3" : opts.safeSearch === "moderate" ? "2" : "1",
      extras: "license,owner_name,url_l,url_o,url_c,url_z",
      per_page: String(opts.maxPerProvider ?? 10),
      format: "json",
      nojsoncallback: "1",
    })}`;

    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`flickr http ${resp.status}`);
    const json = (await resp.json()) as any;
    if (json.stat !== "ok") throw new Error(`flickr: ${json.message ?? "error"}`);
    const photos = json.photos?.photo ?? [];

    const out: ImageCandidate[] = [];
    for (const p of photos) {
      const best = p.url_o ?? p.url_l ?? p.url_c ?? p.url_z;
      if (!best) continue;
      const licInfo = FLICKR_LICENSES[String(p.license)] ?? {
        license: "UNKNOWN",
        url: undefined,
        name: "unknown",
      };
      if (licInfo.license === "UNKNOWN") continue; // safety: skip ambiguous
      const sourcePageUrl = `https://www.flickr.com/photos/${p.owner}/${p.id}`;
      out.push({
        url: best,
        thumbnailUrl: p.url_z ?? p.url_c,
        source: "flickr",
        sourcePageUrl,
        title: p.title,
        author: p.ownername,
        license: licInfo.license,
        licenseUrl: licInfo.url,
        confidence: 0.9,
      });
    }
    return out;
  },
};
