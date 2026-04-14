/**
 * YouTube thumbnail extractor. Not a search provider — a "given a video id
 * or YouTube URL, return the thumbnail set". Useful for event/performance
 * coverage in the factory's timeline.
 *
 * No key needed; thumbnails are served from i.ytimg.com and are EDITORIAL use.
 */

import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

function extractId(q: string): string | null {
  // Accept bare ids or full URLs.
  if (/^[A-Za-z0-9_-]{11}$/.test(q)) return q;
  try {
    const u = new URL(q);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1);
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v");
  } catch {
    // not a URL
  }
  return null;
}

export const youtubeThumb: Provider = {
  id: "youtube-thumb",
  defaultLicense: "EDITORIAL_LICENSED",
  requiresAuth: false,
  async search(query: string, _opts: SearchOptions): Promise<ImageCandidate[]> {
    const id = extractId(query);
    if (!id) return [];
    const sizes = [
      { name: "maxresdefault", w: 1280, h: 720 },
      { name: "sddefault", w: 640, h: 480 },
      { name: "hqdefault", w: 480, h: 360 },
    ];
    return sizes.map((s) => ({
      url: `https://i.ytimg.com/vi/${id}/${s.name}.jpg`,
      width: s.w,
      height: s.h,
      source: "youtube-thumb",
      sourcePageUrl: `https://www.youtube.com/watch?v=${id}`,
      title: `YouTube thumbnail (${s.name})`,
      license: "EDITORIAL_LICENSED",
      confidence: 0.6,
    }));
  },
};
