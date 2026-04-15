/**
 * Twitter / X extractor — Tier 2. Stub for now.
 *
 * Real impl will either hit the official X API (paid, $100+/mo minimum) or
 * xpoz.ai as a cheap public-tweet proxy. Until that's wired, this extractor
 * falls back to og:image + pbs.twimg.com URLs in the page HTML so it at
 * least works on a rendered tweet URL via the generic stack.
 */

import type { ImageCandidate } from "@webfetch/core";
import type { ExtractContext, ExtractResult } from "./types.ts";

export function extractTwitter(ctx: ExtractContext): ExtractResult {
  const { html, sourcePageUrl } = ctx;
  const out: ImageCandidate[] = [];
  const seen = new Set<string>();
  const warnings: string[] = [
    "twitter extractor is a Tier-2 stub; results are best-effort from rendered HTML only",
  ];

  const normalized = html.replace(/&amp;/g, "&");
  const re = /https?:\/\/pbs\.twimg\.com\/media\/[^"'\s)<>]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const raw = m[0];
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    // Strip query variants and request name=orig for the full-res form.
    const url = /([?&]name=)/.test(raw)
      ? raw.replace(/([?&]name=)[^&]+/, "$1orig")
      : `${raw}${raw.includes("?") ? "&" : "?"}name=orig`;
    out.push({
      url,
      source: "browser",
      sourcePageUrl,
      license: "UNKNOWN",
      confidence: 0,
      viaBrowserFallback: true,
    });
  }

  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  if (og?.[1] && !seen.has(og[1])) {
    seen.add(og[1]);
    out.push({
      url: og[1],
      source: "browser",
      sourcePageUrl,
      license: "UNKNOWN",
      confidence: 0,
      viaBrowserFallback: true,
    });
  }

  return { extractor: "twitter", candidates: out, warnings };
}
