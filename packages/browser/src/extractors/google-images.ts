/**
 * Google Images parser. Operates on the HTML of a rendered
 * `https://www.google.com/search?tbm=isch&q=<query>` page.
 *
 * Google's SERP HTML is volatile. We use multiple strategies:
 *   1. Parse embedded `AF_initDataCallback` JSON blobs that carry full-res URLs.
 *   2. Fallback: `<img src>` + parent `<a href>` (decode `/imgres?imgurl=...`).
 *
 * All candidates get license:"UNKNOWN" and viaBrowserFallback:true. Caller is
 * responsible for downstream license classification + ToS acceptance.
 */

import type { ImageCandidate } from "@webfetch/core";
import type { ExtractContext, ExtractResult } from "./types.ts";

function decodeImgresHref(href: string): { full?: string; page?: string } | null {
  try {
    // Some SERP HTML has HTML-entity-escaped ampersands; normalize first.
    const cleaned = href.replace(/&amp;/g, "&");
    const u = new URL(cleaned, "https://www.google.com");
    if (!u.pathname.startsWith("/imgres")) return null;
    return {
      full: u.searchParams.get("imgurl") ?? undefined,
      page: u.searchParams.get("imgrefurl") ?? undefined,
    };
  } catch {
    return null;
  }
}

export function extractGoogleImages(ctx: ExtractContext): ExtractResult {
  const { html, sourcePageUrl } = ctx;
  const out: ImageCandidate[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];

  // Strategy 1: pairs of ["https://full.example.com/a.jpg",W,H] embedded in scripts.
  const jsonPairRe = /\["(https?:\/\/[^"\s]+?\.(?:jpe?g|png|webp|gif|avif))",(\d+),(\d+)\]/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jsonPairRe.exec(html)) !== null) {
    const url = jm[1];
    if (!url) continue;
    if (seen.has(url)) continue;
    // Skip google's own gstatic thumbs — those aren't hero images.
    if (url.includes("gstatic.com") || url.includes("google.com/images")) continue;
    seen.add(url);
    out.push({
      url,
      width: jm[2] ? Number(jm[2]) : undefined,
      height: jm[3] ? Number(jm[3]) : undefined,
      source: "browser",
      sourcePageUrl,
      license: "UNKNOWN",
      confidence: 0,
      viaBrowserFallback: true,
    });
  }

  // Strategy 2: /imgres links carry imgurl + imgrefurl.
  const imgresRe = /href=["'](\/imgres\?[^"']+)["']/gi;
  let im: RegExpExecArray | null;
  while ((im = imgresRe.exec(html)) !== null) {
    const decoded = im[1] ? decodeImgresHref(im[1]) : null;
    if (!decoded?.full) continue;
    if (seen.has(decoded.full)) continue;
    seen.add(decoded.full);
    out.push({
      url: decoded.full,
      source: "browser",
      sourcePageUrl: decoded.page ?? sourcePageUrl,
      license: "UNKNOWN",
      confidence: 0,
      viaBrowserFallback: true,
    });
  }

  // Strategy 3: fall back to <img src> for rendered thumbnails.
  if (out.length === 0) {
    const imgRe = /<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
    let mm: RegExpExecArray | null;
    while ((mm = imgRe.exec(html)) !== null) {
      const src = mm[1];
      if (!src) continue;
      if (seen.has(src)) continue;
      if (src.includes("gstatic.com/images/branding")) continue;
      seen.add(src);
      out.push({
        url: src,
        source: "browser",
        sourcePageUrl,
        license: "UNKNOWN",
        confidence: 0,
        viaBrowserFallback: true,
      });
    }
  }

  if (out.length === 0) warnings.push("no google-images candidates parsed");
  return { extractor: "google-images", candidates: out, warnings };
}
