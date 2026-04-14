/**
 * Timeline / event photo helper — uses providers with strong CC/editorial
 * coverage for historical/news events.
 */

import { searchImages } from "../federation.ts";
import type { SearchOptions, SearchResultBundle } from "../types.ts";

export async function searchEventPhotos(
  query: string,
  opts: SearchOptions = {},
): Promise<SearchResultBundle> {
  return searchImages(query, {
    ...opts,
    providers: opts.providers ?? ["wikimedia", "openverse", "pexels"],
  });
}
