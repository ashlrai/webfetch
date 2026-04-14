/**
 * Pinterest parser. Works over board / search / pin-detail HTML.
 *
 * Pinterest embeds pin data in a __PWS_INITIAL_PROPS__ / __PWS_DATA__ JSON blob
 * and renders <img src="https://i.pinimg.com/<size>/..."> tags. We extract
 * both, dedupe by url, and always upgrade thumbnails to `/originals/` where
 * the CDN path makes it unambiguous.
 */

import type { ImageCandidate } from "@webfetch/core";
import type { ExtractContext, ExtractResult } from "./types.ts";

/** Upgrade `https://i.pinimg.com/236x/ab/cd/ef/<id>.jpg` → `/originals/` form. */
function upgradePinimg(url: string): string {
  return url.replace(
    /(https?:\/\/i\.pinimg\.com\/)(\d+x|\dx|[0-9]+x[0-9]+)(\/)/,
    "$1originals$3",
  );
}

export function extractPinterest(ctx: ExtractContext): ExtractResult {
  const { html, sourcePageUrl } = ctx;
  const out: ImageCandidate[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [];

  const push = (rawUrl: string, extra: Partial<ImageCandidate> = {}) => {
    const url = upgradePinimg(rawUrl);
    if (seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      thumbnailUrl: rawUrl !== url ? rawUrl : undefined,
      source: "browser",
      sourcePageUrl,
      license: "UNKNOWN",
      confidence: 0,
      viaBrowserFallback: true,
      ...extra,
    });
  };

  // pinimg URLs anywhere in the HTML (JSON payloads or <img> tags).
  const pinimgRe =
    /https?:\/\/i\.pinimg\.com\/[^"'\s)<>]+?\.(?:jpe?g|png|webp|gif)/gi;
  let m: RegExpExecArray | null;
  while ((m = pinimgRe.exec(html)) !== null) {
    if (m[0]) push(m[0]);
  }

  // og:image fallback (pin pages).
  const og = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  );
  if (og && og[1]) push(og[1], { title: "og:image" });

  if (out.length === 0) warnings.push("no pinterest candidates parsed");
  return { extractor: "pinterest", candidates: out, warnings };
}
