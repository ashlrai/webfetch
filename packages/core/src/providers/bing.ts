/**
 * Bing Image Search API — requires key. Similar to Brave: license is
 * advisory at best. We respect Bing's `license` filter and map.
 * NOTE: Microsoft retired the classic Bing Search API in 2025. This module
 * still targets the v7 endpoint; callers may need to swap to a successor.
 */

import { coerceLicense, heuristicLicenseFromUrl } from "../license.ts";
import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const bing: Provider = {
  id: "bing",
  defaultLicense: "UNKNOWN",
  requiresAuth: true,
  optIn: true, // default-off due to Bing API deprecation risk
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    const key = opts.auth?.bingApiKey ?? process.env.BING_API_KEY;
    if (!key) throw new Error("BING_API_KEY missing");
    await getBucket("bing").take();
    const fetcher = opts.fetcher ?? fetch;
    const url =
      "https://api.bing.microsoft.com/v7.0/images/search?" +
      new URLSearchParams({
        q: query,
        count: String(opts.maxPerProvider ?? 10),
        safeSearch: opts.safeSearch === "off" ? "Off" : opts.safeSearch === "moderate" ? "Moderate" : "Strict",
        license: "ShareCommercially",
      });
    const resp = await fetcher(url, {
      headers: { "Ocp-Apim-Subscription-Key": key },
      signal: opts.signal,
    });
    if (!resp.ok) throw new Error(`bing http ${resp.status}`);
    const json = (await resp.json()) as any;
    return (json.value ?? []).map((r: any): ImageCandidate => {
      const declared = coerceLicense(r.insightsMetadata?.license ?? r.license);
      const heur = heuristicLicenseFromUrl(r.contentUrl ?? "");
      const license = declared !== "UNKNOWN" ? declared : heur.license;
      return {
        url: r.contentUrl,
        thumbnailUrl: r.thumbnailUrl,
        width: r.width,
        height: r.height,
        source: "bing",
        sourcePageUrl: r.hostPageUrl,
        title: r.name,
        license,
        confidence: declared !== "UNKNOWN" ? 0.6 : heur.confidence,
      };
    });
  },
};
