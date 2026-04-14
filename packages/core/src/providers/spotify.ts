/**
 * Spotify Web API — client-credentials OAuth. Caches token in-memory.
 * Images are EDITORIAL_LICENSED per Spotify ToS when displayed as part of
 * track/album/artist identification UI.
 */

import { getBucket } from "../rate-limit.ts";
import type { ImageCandidate, Provider, SearchOptions } from "../types.ts";

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getToken(clientId: string, clientSecret: string, fetcher: typeof fetch): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const auth = btoa(`${clientId}:${clientSecret}`);
  const resp = await fetcher("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) throw new Error(`spotify token http ${resp.status}`);
  const json = (await resp.json()) as any;
  tokenCache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return tokenCache.token;
}

export const spotify: Provider = {
  id: "spotify",
  defaultLicense: "EDITORIAL_LICENSED",
  requiresAuth: true,
  async search(query: string, opts: SearchOptions): Promise<ImageCandidate[]> {
    const id = opts.auth?.spotifyClientId ?? process.env.SPOTIFY_CLIENT_ID;
    const secret = opts.auth?.spotifyClientSecret ?? process.env.SPOTIFY_CLIENT_SECRET;
    if (!id || !secret) throw new Error("SPOTIFY_CLIENT_ID/SECRET missing");
    const fetcher = opts.fetcher ?? fetch;
    await getBucket("spotify").take();
    const token = await getToken(id, secret, fetcher);
    const url =
      "https://api.spotify.com/v1/search?" +
      new URLSearchParams({
        q: query,
        type: "artist,album",
        limit: String(Math.min(opts.maxPerProvider ?? 10, 20)),
      });
    const resp = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: opts.signal,
    });
    if (!resp.ok) throw new Error(`spotify http ${resp.status}`);
    const json = (await resp.json()) as any;
    const out: ImageCandidate[] = [];
    for (const a of json.artists?.items ?? []) {
      const img = largest(a.images);
      if (!img) continue;
      out.push({
        url: img.url,
        width: img.width,
        height: img.height,
        source: "spotify",
        sourcePageUrl: a.external_urls?.spotify,
        title: a.name,
        author: a.name,
        license: "EDITORIAL_LICENSED",
        licenseUrl: "https://developer.spotify.com/policy",
        confidence: 0.8,
      });
    }
    for (const al of json.albums?.items ?? []) {
      const img = largest(al.images);
      if (!img) continue;
      out.push({
        url: img.url,
        width: img.width,
        height: img.height,
        source: "spotify",
        sourcePageUrl: al.external_urls?.spotify,
        title: al.name,
        author: al.artists?.[0]?.name,
        license: "EDITORIAL_LICENSED",
        licenseUrl: "https://developer.spotify.com/policy",
        confidence: 0.8,
      });
    }
    return out;
  },
};

function largest(imgs: { url: string; width: number; height: number }[] | undefined) {
  if (!imgs?.length) return null;
  return [...imgs].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
}

export function _resetSpotifyToken(): void {
  tokenCache = null;
}
