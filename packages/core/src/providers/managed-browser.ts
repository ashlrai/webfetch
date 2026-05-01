/**
 * Managed-browser provider — server-side fallback that fetches Google Images
 * and Pinterest through Bright Data's Web Unlocker REST API. This is the
 * paid-tier moat: when the 19+ licensed providers all miss, Pro / Team users
 * still get a result, tagged license=UNKNOWN with a sidecar attribution.
 *
 * Why Web Unlocker (not Scraping Browser / residential proxy)?
 *   - Workers `fetch` cannot route through arbitrary HTTP proxies; Web Unlocker
 *     is a plain HTTPS POST that returns the rendered HTML, billed per request.
 *   - No Playwright dependency — keeps @webfetch/core Workers-compatible.
 *
 * Auth: requires `auth.brightDataApiToken` (single account-level Bearer token
 * from Bright Data dashboard → Account settings → API tokens). When missing,
 * returns [] (caller treats as "skipped: missing-auth").
 *
 * Output safety:
 *   - Every result is tagged `license: "UNKNOWN"` regardless of source.
 *   - `viaBrowserFallback: true` — the ranker always sorts these last under
 *     `safe-only` policy and rejects them under `open-only`.
 *   - `confidence: 0` — caller can never confuse this with structured metadata.
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

const BRIGHTDATA_ENDPOINT = "https://api.brightdata.com/request";

interface BrightDataRequest {
  zone: string;
  url: string;
  format: "raw";
  // Tell Bright Data to JS-render Google Images so the lazy-loaded thumbs are present.
  data_format?: "html";
  country?: string;
}

export const managedBrowser: Provider = {
  id: "managed-browser",
  defaultLicense: "UNKNOWN",
  requiresAuth: true,
  optIn: true,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    const apiToken = opts.auth?.brightDataApiToken;
    const zone = opts.auth?.brightDataZone || "web_unlocker";
    if (!apiToken) return [];

    await getBucket("managed-browser").take();

    const fetcher = opts.fetcher ?? fetch;
    const limit = Math.max(1, Math.min(opts.maxPerProvider ?? 10, 25));
    const safe = opts.safeSearch === "off" ? "off" : "active";
    const targets: { url: string; site: "google" | "pinterest" }[] = [
      {
        url: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}&safe=${safe}`,
        site: "google",
      },
      {
        url: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
        site: "pinterest",
      },
    ];

    const auth = `Bearer ${apiToken}`;
    const results: ImageCandidate[] = [];

    for (const target of targets) {
      if (results.length >= limit) break;
      const body: BrightDataRequest = {
        zone,
        url: target.url,
        format: "raw",
        data_format: "html",
      };
      let html: string;
      try {
        const res = await fetcher(BRIGHTDATA_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: auth,
            "content-type": "application/json",
            accept: "text/html, application/json",
          },
          body: JSON.stringify(body),
          signal: opts.signal,
        });
        if (!res.ok) {
          // Skip this site; let the other one (or the ranker) fill in.
          continue;
        }
        html = await res.text();
      } catch {
        continue;
      }

      const remaining = limit - results.length;
      results.push(...parseImagesFromHtml(html, target.site, remaining));
    }

    return results;
  },
};

/**
 * Extract candidate <img> URLs from a Google Images / Pinterest results page.
 *
 * Deliberately narrow regex: we only want absolute https URLs that look like
 * real photo content, not 1px tracking pixels or sprite icons. We also pull
 * the closest preceding anchor href as the source page URL when available.
 *
 * Google occasionally re-renders this markup; if the regex starts returning 0
 * for everything, refresh against the live HTML and adjust.
 */
function parseImagesFromHtml(
  html: string,
  site: "google" | "pinterest",
  limit: number,
): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  const seen = new Set<string>();

  // Google: <img class="..." alt="..." src="https://..."> with width/height attributes.
  // Pinterest: <img src="https://i.pinimg.com/..."> in a <a href="/pin/..."> wrapper.
  const imgRe = /<img\b[^>]*?\bsrc=["'](https?:\/\/[^"']+)["'][^>]*?>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) != null) {
    if (candidates.length >= limit) break;
    const url = m[1];
    if (!url || seen.has(url)) continue;
    if (!isPlausibleImageUrl(url, site)) continue;
    seen.add(url);

    const tag = m[0];
    const alt = /\balt=["']([^"']*)["']/i.exec(tag)?.[1];
    const width = Number(/\bwidth=["']?(\d+)/i.exec(tag)?.[1] ?? 0) || undefined;
    const height = Number(/\bheight=["']?(\d+)/i.exec(tag)?.[1] ?? 0) || undefined;

    // Find the nearest preceding <a href="..."> for source page attribution.
    const before = html.slice(0, m.index);
    const aRe = /<a\b[^>]*?\bhref=["']([^"']+)["']/gi;
    let lastHref: string | undefined;
    let am: RegExpExecArray | null;
    while ((am = aRe.exec(before)) != null) lastHref = am[1];
    const sourcePageUrl =
      lastHref && /^https?:\/\//.test(lastHref)
        ? lastHref
        : site === "pinterest" && lastHref?.startsWith("/pin/")
          ? `https://www.pinterest.com${lastHref}`
          : undefined;

    candidates.push({
      url,
      sourcePageUrl,
      title: alt && alt.length > 0 ? alt : undefined,
      width,
      height,
      source: "managed-browser",
      license: "UNKNOWN",
      confidence: 0,
      viaBrowserFallback: true,
      attributionLine: `Source: ${site === "google" ? "Google Images" : "Pinterest"} via Bright Data (license unknown)`,
      raw: { brightData: true, site },
    });
  }

  return candidates;
}

function isPlausibleImageUrl(url: string, site: "google" | "pinterest"): boolean {
  // Filter out icons, sprites, and known tracking pixels.
  if (/\/(spinner|loading|sprite|favicon|gstatic\/images\/branding)/i.test(url)) return false;
  if (/[?&](w|width)=1\b/i.test(url)) return false;
  if (url.endsWith(".svg")) return false;
  if (site === "google") {
    // Google Images thumbnails come from gstatic + encrypted-tbn; the inline preview
    // images are data: URIs which won't match our https filter.
    return /encrypted-tbn|gstatic\.com\/images|googleusercontent\.com/i.test(url) ||
      /\.(jpe?g|png|webp|gif)(\?|$)/i.test(url);
  }
  if (site === "pinterest") {
    return /pinimg\.com/i.test(url);
  }
  return true;
}
