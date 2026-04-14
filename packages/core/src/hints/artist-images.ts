/**
 * Convenience: search for images of a musical artist with kind-aware
 * provider selection and query expansion.
 *
 * Why: generic `searchImages("Drake")` returns whatever trend is hot that day.
 * For the factory's "portrait", "album", "logo", "performing" asset slots we
 * want different providers and queries.
 */

import { searchImages } from "../federation.ts";
import type { SearchOptions, SearchResultBundle, ProviderId } from "../types.ts";

export type ArtistImageKind = "portrait" | "album" | "logo" | "performing";

const KIND_PROVIDERS: Record<ArtistImageKind, ProviderId[]> = {
  portrait: ["wikimedia", "openverse", "unsplash", "spotify", "itunes"],
  album: ["musicbrainz-caa", "itunes", "spotify", "wikimedia"],
  logo: ["wikimedia", "openverse"], // logos lean CC-BY-SA from Commons
  performing: ["wikimedia", "openverse", "pexels", "unsplash"],
};

const KIND_QUERY: Record<ArtistImageKind, (name: string) => string> = {
  portrait: (n) => `${n} musician portrait`,
  album: (n) => `${n} album cover`,
  logo: (n) => `${n} logo`,
  performing: (n) => `${n} performing live concert`,
};

export async function searchArtistImages(
  artist: string,
  kind: ArtistImageKind,
  opts: SearchOptions = {},
): Promise<SearchResultBundle> {
  const providers = opts.providers ?? KIND_PROVIDERS[kind];
  const query = KIND_QUERY[kind](artist);
  return searchImages(query, { ...opts, providers });
}
