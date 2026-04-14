/**
 * Specialized album-cover search. Prefers authoritative sources over generic
 * image search because album covers have canonical artwork.
 */

import { searchImages } from "../federation.ts";
import type { SearchOptions, SearchResultBundle } from "../types.ts";

export async function searchAlbumCover(
  artist: string,
  album: string,
  opts: SearchOptions = {},
): Promise<SearchResultBundle> {
  return searchImages(`${artist} ${album}`, {
    ...opts,
    providers: opts.providers ?? ["musicbrainz-caa", "itunes", "spotify", "wikimedia"],
    maxPerProvider: opts.maxPerProvider ?? 5,
  });
}
