/**
 * Generic page extractor. Given rendered HTML, pull:
 *   - <meta property="og:image">
 *   - <meta name="twitter:image">
 *   - <link rel="image_src">
 *   - every <img src> (absolute URL resolved against the page URL)
 *   - <a href> pointing at image MIME extensions
 *
 * Dedupes by URL. All candidates get license:"UNKNOWN" and viaBrowserFallback:true.
 */

import type { ImageCandidate } from "@webfetch/core";
import type { ExtractContext, ExtractResult } from "./types.ts";

const IMAGE_EXTS = /\.(jpe?g|png|webp|gif|avif|bmp|tiff?)(?:\?.*)?$/i;

function toAbsolute(raw: string, base: string): string | null {
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

function match(re: RegExp, html: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  // Fresh regex each call: callers may pass non-global patterns.
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  while ((m = g.exec(html)) !== null) {
    const captured = m[1];
    if (captured) out.push(captured);
  }
  return out;
}

export function extractGenericPage(ctx: ExtractContext): ExtractResult {
  const { html, sourcePageUrl } = ctx;
  const seen = new Set<string>();
  const add = (url: string, extra: Partial<ImageCandidate> = {}): ImageCandidate | null => {
    const abs = toAbsolute(url, sourcePageUrl);
    if (!abs) return null;
    if (seen.has(abs)) return null;
    seen.add(abs);
    return {
      url: abs,
      source: "browser",
      sourcePageUrl,
      license: "UNKNOWN",
      confidence: 0,
      viaBrowserFallback: true,
      ...extra,
    };
  };

  const results: ImageCandidate[] = [];
  const warnings: string[] = [];

  // og:image (any attribute order)
  for (const og of [
    ...match(/<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i, html),
    ...match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i, html),
  ]) {
    const c = add(og, { title: "og:image", confidence: 0.2 });
    if (c) results.push(c);
  }

  // twitter:image
  for (const tw of [
    ...match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i, html),
    ...match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i, html),
  ]) {
    const c = add(tw, { title: "twitter:image", confidence: 0.15 });
    if (c) results.push(c);
  }

  // link rel=image_src
  for (const ls of match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i, html)) {
    const c = add(ls, { title: "image_src" });
    if (c) results.push(c);
  }

  // <img src="...">
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  for (const tag of imgTags) {
    const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch || !srcMatch[1]) continue;
    const src = srcMatch[1];
    if (src.startsWith("data:")) continue;
    const altMatch = tag.match(/\balt=["']([^"']*)["']/i);
    const widthMatch = tag.match(/\bwidth=["']?(\d+)/i);
    const heightMatch = tag.match(/\bheight=["']?(\d+)/i);
    const c = add(src, {
      title: altMatch?.[1] || undefined,
      width: widthMatch?.[1] ? Number(widthMatch[1]) : undefined,
      height: heightMatch?.[1] ? Number(heightMatch[1]) : undefined,
    });
    if (c) results.push(c);
  }

  // <a href="...jpg|png|..."> linked high-res
  const hrefRe = /<a\b[^>]*\bhref=["']([^"']+)["']/gi;
  let hm: RegExpExecArray | null;
  while ((hm = hrefRe.exec(html)) !== null) {
    const href = hm[1];
    if (!href || !IMAGE_EXTS.test(href)) continue;
    const c = add(href, { title: "linked", confidence: 0.1 });
    if (c) results.push(c);
  }

  if (results.length === 0) warnings.push("no images found on page");

  return { extractor: "generic-page", candidates: results, warnings };
}
