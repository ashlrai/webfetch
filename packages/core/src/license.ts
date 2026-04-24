/**
 * License classification + safety rules.
 *
 * MIRROR of `artist-encyclopedia-factory/packages/assets/src/license.ts`.
 * Intentionally duplicated (not imported) so this repo ships independently.
 *
 * Hard rule: we never ship UNKNOWN — the picker rejects it. A missing license
 * is always treated as unsafe; we never infer "probably fine" silently.
 */

import type { License } from "./types.ts";

export const LICENSE_RANK: Record<License, number> = {
  CC0: 1,
  PUBLIC_DOMAIN: 2,
  CC_BY: 3,
  CC_BY_SA: 4,
  EDITORIAL_LICENSED: 5,
  PRESS_KIT_ALLOWLIST: 6,
  UNKNOWN: 99,
};

export const OPEN_LICENSES: readonly License[] = ["CC0", "PUBLIC_DOMAIN", "CC_BY", "CC_BY_SA"];

export const CONTEXT_SAFE_LICENSES: readonly License[] = [
  "CC0",
  "PUBLIC_DOMAIN",
  "CC_BY",
  "CC_BY_SA",
  "EDITORIAL_LICENSED",
  "PRESS_KIT_ALLOWLIST",
];

/**
 * Compatibility alias for the historical `safe-only` policy. Prefer
 * `CONTEXT_SAFE_LICENSES` for new code when editorial/press assets are allowed.
 */
export const SAFE_LICENSES = CONTEXT_SAFE_LICENSES;

export function isOpenLicense(tag: License): boolean {
  return OPEN_LICENSES.includes(tag);
}

export function isContextSafeLicense(tag: License): boolean {
  return CONTEXT_SAFE_LICENSES.includes(tag);
}

export function isSafeLicense(tag: License): boolean {
  return isContextSafeLicense(tag);
}

export function requiresAttribution(tag: License): boolean {
  return (
    tag === "CC_BY" ||
    tag === "CC_BY_SA" ||
    tag === "EDITORIAL_LICENSED" ||
    tag === "PRESS_KIT_ALLOWLIST"
  );
}

export interface AttributionInput {
  license: License;
  author?: string;
  sourceName?: string;
  sourceUrl?: string;
  title?: string;
}

export function buildAttribution(input: AttributionInput): string {
  const { license, author, sourceName, sourceUrl, title } = input;
  const prettyLicense = prettyLicenseName(license);
  const parts: string[] = [];

  if (title) {
    parts.push(`"${title}"`);
    if (author) parts.push(`by ${author}`);
  } else if (author) {
    parts.push(`Photo by ${author}`);
  } else {
    parts.push("Photo");
  }

  if (sourceName) parts.push(`(${sourceName})`);

  const head = parts.join(" ");
  const tail = sourceUrl ? `licensed ${prettyLicense} — ${sourceUrl}` : `licensed ${prettyLicense}`;
  return `${head}, ${tail}`;
}

export function prettyLicenseName(tag: License): string {
  switch (tag) {
    case "CC0":
      return "CC0 / Public Domain Dedication";
    case "PUBLIC_DOMAIN":
      return "Public Domain";
    case "CC_BY":
      return "CC BY 4.0";
    case "CC_BY_SA":
      return "CC BY-SA 4.0";
    case "EDITORIAL_LICENSED":
      return "Editorial Use (platform-licensed)";
    case "PRESS_KIT_ALLOWLIST":
      return "Official Press Kit";
    case "UNKNOWN":
      return "Unknown (rejected)";
  }
}

/**
 * Coerce a free-form license string into our enum.
 * When in doubt: UNKNOWN. Never guess "safe".
 */
export function coerceLicense(raw: string | undefined | null): License {
  if (!raw) return "UNKNOWN";
  const s = raw.trim().toLowerCase();
  if (s === "cc0" || s.includes("public domain dedication") || s.includes("publicdomain/zero"))
    return "CC0";
  if (s.includes("public domain") || s === "pd" || s.includes("pdm")) return "PUBLIC_DOMAIN";
  if (
    s.includes("by-sa") ||
    s.includes("by sa") ||
    s.includes("sharealike") ||
    s.includes("by-sa-")
  )
    return "CC_BY_SA";
  if (s.includes("cc-by") || s.includes("cc by") || s === "ccby" || /\bby\b/.test(s))
    return "CC_BY";
  if (s.includes("editorial") || s.includes("spotify") || s.includes("caa") || s.includes("itunes"))
    return "EDITORIAL_LICENSED";
  if (s.includes("press") || s.includes("promo")) return "PRESS_KIT_ALLOWLIST";
  // NC / ND / proprietary / all-rights-reserved are not safe for our use case.
  return "UNKNOWN";
}

/**
 * URL-based heuristics used by `probe_page` and generic page fetch.
 * These are low-confidence and should be combined with structured evidence
 * (page meta tags, EXIF) to cross-check.
 */
export function heuristicLicenseFromUrl(url: string): { license: License; confidence: number } {
  const host = safeHost(url);
  if (!host) return { license: "UNKNOWN", confidence: 0 };
  if (host.endsWith("commons.wikimedia.org") || host.endsWith("upload.wikimedia.org"))
    return { license: "CC_BY_SA", confidence: 0.4 }; // Commons mix — must be verified per-file
  if (host.endsWith("flickr.com") || host.endsWith("staticflickr.com"))
    return { license: "UNKNOWN", confidence: 0.1 };
  if (host.endsWith("unsplash.com") || host.endsWith("images.unsplash.com"))
    return { license: "CC0", confidence: 0.8 }; // Unsplash license is CC0-like
  if (host.endsWith("pexels.com") || host.endsWith("images.pexels.com"))
    return { license: "CC0", confidence: 0.8 };
  if (host.endsWith("pixabay.com") || host.endsWith("cdn.pixabay.com"))
    return { license: "CC0", confidence: 0.8 };
  if (host.endsWith("openverse.org")) return { license: "CC_BY", confidence: 0.4 };
  if (host.endsWith("coverartarchive.org") || host.endsWith("archive.org"))
    return { license: "EDITORIAL_LICENSED", confidence: 0.6 };
  if (host.endsWith("scdn.co") || host.endsWith("spotifycdn.com") || host.endsWith("i.scdn.co"))
    return { license: "EDITORIAL_LICENSED", confidence: 0.7 };
  if (host.endsWith("ytimg.com") || host.endsWith("i.ytimg.com"))
    return { license: "EDITORIAL_LICENSED", confidence: 0.5 };
  return { license: "UNKNOWN", confidence: 0 };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
