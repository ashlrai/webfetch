/**
 * Wikimedia Commons provider — no key required.
 *
 * Uses the MediaWiki API `generator=search` + `prop=imageinfo` to resolve
 * license metadata in a single round-trip. Commons is authoritative: when it
 * tells us the license, we trust it (confidence 0.95).
 */

import { coerceLicense } from "../license.ts";
import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const wikimedia: Provider = {
  id: "wikimedia",
  defaultLicense: "CC_BY_SA",
  requiresAuth: false,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    const limit = opts.maxPerProvider ?? 10;
    const fetcher = opts.fetcher ?? fetch;
    await getBucket("wikimedia").take();

    const url =
      "https://commons.wikimedia.org/w/api.php?" +
      new URLSearchParams({
        action: "query",
        format: "json",
        generator: "search",
        gsrsearch: `${query} filetype:bitmap|drawing`,
        gsrlimit: String(limit),
        gsrnamespace: "6",
        prop: "imageinfo",
        iiprop: "url|size|mime|extmetadata",
        iiurlwidth: "1600",
        origin: "*",
      });

    const resp = await fetcher(url, {
      headers: { "User-Agent": opts.auth?.userAgent ?? "webfetch-mcp/0.1" },
      signal: opts.signal,
    });
    if (!resp.ok) throw new Error(`wikimedia http ${resp.status}`);
    const json = (await resp.json()) as any;
    const pages = json?.query?.pages ?? {};

    const out: ImageCandidate[] = [];
    for (const k of Object.keys(pages)) {
      const p = pages[k];
      const info = p?.imageinfo?.[0];
      if (!info?.url) continue;
      const md = info.extmetadata ?? {};
      const licenseRaw = md?.LicenseShortName?.value ?? md?.License?.value ?? "";
      const license = coerceLicense(licenseRaw);
      const author = stripHtml(md?.Artist?.value) ?? undefined;
      const title = (p.title ?? "").replace(/^File:/, "");
      const sourcePageUrl = `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`;
      out.push({
        url: info.url,
        thumbnailUrl: info.thumburl,
        width: info.width,
        height: info.height,
        mime: info.mime,
        source: "wikimedia",
        sourcePageUrl,
        title,
        author,
        license,
        licenseUrl: md?.LicenseUrl?.value,
        confidence: license === "UNKNOWN" ? 0.2 : 0.95,
      });
    }
    return out;
  },
};

function stripHtml(s: unknown): string | undefined {
  if (typeof s !== "string") return undefined;
  return s.replace(/<[^>]+>/g, "").trim() || undefined;
}
