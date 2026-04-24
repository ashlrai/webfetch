/**
 * Page-level license probe. Given an arbitrary URL:
 *   - if it's an image URL: fetch it (optional) + classify via host heuristic.
 *   - if it's a webpage: parse <meta> OG/license tags + visible link-rels.
 *
 * Evidence sources (combined for confidence):
 *   - URL host heuristic (heuristicLicenseFromUrl)
 *   - <meta property="og:image:license"> / <link rel="license">
 *   - <meta name="dc.rights"> / Dublin Core
 *   - Visible attribution on the page (basic regex)
 */

import { assertPublicHttpUrl, downloadImage } from "./download.ts";
import { buildAttribution, coerceLicense, heuristicLicenseFromUrl } from "./license.ts";
import { type EmbeddedMetadata, readImageMetadata } from "./metadata-reader.ts";
import type { Fetcher, License } from "./types.ts";

export interface FetchWithLicenseOptions {
  probe?: boolean; // if true, also attempt to fetch bytes
  fetcher?: Fetcher;
  userAgent?: string;
  signal?: AbortSignal;
}

export interface FetchWithLicenseResult {
  bytes?: Uint8Array;
  license: License;
  licenseUrl?: string;
  confidence: number;
  sourcePageUrl?: string;
  author?: string;
  copyright?: string;
  attributionLine?: string;
  mime?: string;
  sha256?: string;
  cachedPath?: string;
  embeddedMetadata?: EmbeddedMetadata;
}

export async function fetchWithLicense(
  url: string,
  opts: FetchWithLicenseOptions = {},
): Promise<FetchWithLicenseResult> {
  const fetcher = opts.fetcher ?? fetch;
  const ua = opts.userAgent ?? "webfetch-mcp/0.1";
  const publicUrl = assertPublicHttpUrl(url);
  if (!publicUrl.ok) throw new Error(publicUrl.error);
  // Probe the URL shallowly to see if it's an image.
  let head: Response;
  try {
    head = await fetcher(url, {
      method: "HEAD",
      headers: { "User-Agent": ua },
      signal: opts.signal,
    });
  } catch {
    // Some servers disallow HEAD; fall through to GET.
    head = new Response(null);
  }
  const ct = (head.headers.get("content-type") ?? "").split(";")[0]!.trim();

  if (ct.startsWith("image/")) {
    const heur = heuristicLicenseFromUrl(url);
    const res: FetchWithLicenseResult = {
      license: heur.license,
      confidence: heur.confidence,
      sourcePageUrl: url,
      attributionLine: buildAttribution({ license: heur.license, sourceUrl: url }),
    };
    if (opts.probe) {
      const dl = await downloadImage(url, { fetcher, userAgent: ua, signal: opts.signal });
      res.bytes = dl.bytes;
      res.mime = dl.mime;
      res.sha256 = dl.sha256;
      res.cachedPath = dl.cachedPath;
      try {
        const meta = await readImageMetadata(dl.bytes);
        res.embeddedMetadata = meta;
        // Reconcile — embedded metadata wins on tie.
        if (meta.artist && !res.author) res.author = meta.artist;
        if (meta.copyright) res.copyright = meta.copyright;
        if (meta.license !== "UNKNOWN" && meta.confidence.license >= res.confidence) {
          res.license = meta.license;
          res.confidence = Math.max(res.confidence, meta.confidence.license);
          if (meta.licenseUrl) res.licenseUrl = meta.licenseUrl;
        }
        res.attributionLine = buildAttribution({
          license: res.license,
          author: res.author,
          sourceUrl: res.sourcePageUrl,
        });
      } catch {
        // non-fatal — keep host-heuristic result
      }
    }
    return res;
  }

  // Treat as webpage: fetch HTML and extract hints.
  const resp = await fetcher(url, {
    headers: { "User-Agent": ua, Accept: "text/html" },
    signal: opts.signal,
  });
  if (!resp.ok) {
    return { license: "UNKNOWN", confidence: 0, sourcePageUrl: url };
  }
  const html = await resp.text();
  return parseHtmlLicense(html, url);
}

/** Exposed for testing. */
export function parseHtmlLicense(html: string, url: string): FetchWithLicenseResult {
  const metaLicense =
    matchAttr(html, /<link[^>]+rel=["']license["'][^>]+href=["']([^"']+)["']/i) ??
    matchAttr(html, /<meta[^>]+name=["']dc.rights["'][^>]+content=["']([^"']+)["']/i) ??
    matchAttr(html, /<meta[^>]+property=["']og:image:license["'][^>]+content=["']([^"']+)["']/i);
  const ogAuthor = matchAttr(
    html,
    /<meta[^>]+property=["']article:author["'][^>]+content=["']([^"']+)["']/i,
  );
  const heur = heuristicLicenseFromUrl(url);

  let license: License = heur.license;
  let confidence = heur.confidence;
  if (metaLicense) {
    const coerced = coerceLicense(metaLicense);
    if (coerced !== "UNKNOWN") {
      license = coerced;
      confidence = Math.max(confidence, 0.7);
    }
  }

  return {
    license,
    confidence,
    sourcePageUrl: url,
    author: ogAuthor ?? undefined,
    attributionLine: buildAttribution({
      license,
      author: ogAuthor ?? undefined,
      sourceUrl: url,
    }),
  };
}

function matchAttr(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1]! : null;
}
