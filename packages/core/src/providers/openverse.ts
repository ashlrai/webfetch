/**
 * Openverse — CC-aggregator, no key required for light use.
 * API returns structured license strings we can coerce cleanly.
 */

import { coerceLicense } from "../license.ts";
import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const openverse: Provider = {
  id: "openverse",
  defaultLicense: "CC_BY",
  requiresAuth: false,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    await getBucket("openverse").take();
    const fetcher = opts.fetcher ?? fetch;
    const url =
      "https://api.openverse.org/v1/images/?" +
      new URLSearchParams({
        q: query,
        page_size: String(opts.maxPerProvider ?? 10),
        license_type: "commercial,modification",
        mature: opts.safeSearch === "off" ? "true" : "false",
      });
    const resp = await fetcher(url, { signal: opts.signal });
    if (!resp.ok) throw new Error(`openverse http ${resp.status}`);
    const json = (await resp.json()) as any;
    return (json.results ?? []).map((r: any): ImageCandidate => {
      const license = coerceLicense([r.license, r.license_version].filter(Boolean).join(" "));
      return {
        url: r.url,
        thumbnailUrl: r.thumbnail,
        width: r.width,
        height: r.height,
        source: "openverse",
        sourcePageUrl: r.foreign_landing_url ?? r.detail_url,
        title: r.title,
        author: r.creator,
        license,
        licenseUrl: r.license_url,
        confidence: license === "UNKNOWN" ? 0.2 : 0.9,
      };
    });
  },
};
