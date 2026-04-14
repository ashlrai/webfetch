/**
 * MusicBrainz + Cover Art Archive — no key. Two-step: search MB for
 * release(s), then fetch CAA front covers.
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

export const musicbrainzCaa: Provider = {
  id: "musicbrainz-caa",
  defaultLicense: "EDITORIAL_LICENSED",
  requiresAuth: false,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    await getBucket("musicbrainz-caa").take();
    const fetcher = opts.fetcher ?? fetch;
    const ua = opts.auth?.userAgent ?? "webfetch-mcp/0.1 ( https://github.com/ )";
    const mbUrl =
      "https://musicbrainz.org/ws/2/release/?" +
      new URLSearchParams({
        query,
        fmt: "json",
        limit: String(Math.min(opts.maxPerProvider ?? 10, 10)),
      });
    const mbResp = await fetcher(mbUrl, {
      headers: { "User-Agent": ua, Accept: "application/json" },
      signal: opts.signal,
    });
    if (!mbResp.ok) throw new Error(`musicbrainz http ${mbResp.status}`);
    const mbJson = (await mbResp.json()) as any;
    const releases = mbJson.releases ?? [];
    const out: ImageCandidate[] = [];
    // CAA front URL pattern: https://coverartarchive.org/release/<mbid>/front
    for (const r of releases) {
      if (!r.id) continue;
      const url = `https://coverartarchive.org/release/${r.id}/front-1200`;
      const thumb = `https://coverartarchive.org/release/${r.id}/front-250`;
      out.push({
        url,
        thumbnailUrl: thumb,
        source: "musicbrainz-caa",
        sourcePageUrl: `https://musicbrainz.org/release/${r.id}`,
        title: r.title,
        author: r["artist-credit"]?.[0]?.name,
        license: "EDITORIAL_LICENSED",
        licenseUrl: "https://musicbrainz.org/doc/Cover_Art_Archive",
        confidence: 0.75,
      });
    }
    return out;
  },
};
