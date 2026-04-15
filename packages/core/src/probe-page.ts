/**
 * Given a webpage URL, return all <img> candidates with dimensions inferred
 * from attributes and a heuristic license per image.
 */

import { heuristicLicenseFromUrl } from "./license.ts";
import type { Fetcher, ImageCandidate } from "./types.ts";

export interface ProbePageOptions {
  fetcher?: Fetcher;
  userAgent?: string;
  signal?: AbortSignal;
  /** Respect robots.txt — on by default. */
  respectRobots?: boolean;
}

export async function probePage(
  url: string,
  opts: ProbePageOptions = {},
): Promise<{ page: string; images: ImageCandidate[]; warnings: string[] }> {
  const fetcher = opts.fetcher ?? fetch;
  const ua = opts.userAgent ?? "webfetch-mcp/0.1";
  const warnings: string[] = [];

  if (opts.respectRobots !== false) {
    const allowed = await robotsAllows(url, ua, fetcher, opts.signal);
    if (!allowed) {
      return { page: url, images: [], warnings: ["blocked by robots.txt"] };
    }
  }

  const resp = await fetcher(url, {
    headers: { "User-Agent": ua, Accept: "text/html" },
    signal: opts.signal,
  });
  if (!resp.ok) throw new Error(`probe http ${resp.status}`);
  const html = await resp.text();
  return { page: url, images: extractImages(html, url), warnings };
}

export function extractImages(html: string, baseUrl: string): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  const re = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const src = attr(tag, "src") ?? attr(tag, "data-src");
    if (!src) continue;
    const abs = resolveUrl(src, baseUrl);
    if (!abs) continue;
    const w = numAttr(tag, "width");
    const h = numAttr(tag, "height");
    const alt = attr(tag, "alt");
    const heur = heuristicLicenseFromUrl(abs);
    out.push({
      url: abs,
      width: w,
      height: h,
      source: "probe",
      sourcePageUrl: baseUrl,
      title: alt,
      license: heur.license,
      confidence: heur.confidence,
    });
  }
  // Also scrape OG images — often the editorial hero.
  const og = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (og?.[1]) {
    const abs = resolveUrl(og[1], baseUrl);
    if (abs && !out.some((c) => c.url === abs)) {
      const heur = heuristicLicenseFromUrl(abs);
      out.unshift({
        url: abs,
        source: "probe",
        sourcePageUrl: baseUrl,
        title: "og:image",
        license: heur.license,
        confidence: heur.confidence,
      });
    }
  }
  return out;
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}=["']([^"']+)["']`, "i").exec(tag);
  return m ? m[1] : undefined;
}

function numAttr(tag: string, name: string): number | undefined {
  const v = attr(tag, name);
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function resolveUrl(src: string, base: string): string | null {
  try {
    return new URL(src, base).toString();
  } catch {
    return null;
  }
}

async function robotsAllows(
  url: string,
  ua: string,
  fetcher: Fetcher,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const u = new URL(url);
    const resp = await fetcher(`${u.origin}/robots.txt`, { headers: { "User-Agent": ua }, signal });
    if (!resp.ok) return true;
    const txt = await resp.text();
    // Very small robots parser: look for a section that disallows our path.
    const path = u.pathname || "/";
    const lines = txt.split(/\r?\n/);
    let active = false;
    for (const raw of lines) {
      const line = raw.split("#")[0]!.trim();
      if (!line) continue;
      const [k, v] = line.split(":").map((s) => s?.trim());
      if (!k || v === undefined) continue;
      if (k.toLowerCase() === "user-agent")
        active = v === "*" || ua.toLowerCase().includes(v.toLowerCase());
      if (active && k.toLowerCase() === "disallow" && v && path.startsWith(v)) return false;
    }
    return true;
  } catch {
    return true; // fail-open on robots fetch errors; we're not a crawler at scale
  }
}
