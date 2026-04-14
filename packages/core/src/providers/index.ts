import { bing } from "./bing.ts";
import { brave } from "./brave.ts";
import { browser } from "./browser.ts";
import { europeana } from "./europeana.ts";
import { flickr } from "./flickr.ts";
import { internetArchive } from "./internet-archive.ts";
import { itunes } from "./itunes.ts";
import { metMuseum } from "./met-museum.ts";
import { musicbrainzCaa } from "./musicbrainz-caa.ts";
import { nasa } from "./nasa.ts";
import { openverse } from "./openverse.ts";
import { pexels } from "./pexels.ts";
import { pixabay } from "./pixabay.ts";
import { serpapi } from "./serpapi.ts";
import { smithsonian } from "./smithsonian.ts";
import { spotify } from "./spotify.ts";
import { unsplash } from "./unsplash.ts";
import { wikimedia } from "./wikimedia.ts";
import { youtubeThumb } from "./youtube-thumb.ts";
import type { Provider, ProviderId } from "../types.ts";

export const ALL_PROVIDERS: Record<ProviderId, Provider> = {
  wikimedia,
  openverse,
  unsplash,
  pexels,
  pixabay,
  itunes,
  "musicbrainz-caa": musicbrainzCaa,
  spotify,
  "youtube-thumb": youtubeThumb,
  brave,
  bing,
  serpapi,
  browser,
  flickr,
  "internet-archive": internetArchive,
  smithsonian,
  nasa,
  "met-museum": metMuseum,
  europeana,
};

/**
 * Safe defaults: providers run when no `providers` list is supplied.
 * Excludes browser/serpapi/bing (opt-in / ToS-grey / deprecation-risk).
 * Includes only providers that either need no auth OR gracefully skip when
 * their auth is missing.
 *
 * The six new CC / PD providers are all either no-auth (internet-archive,
 * smithsonian via DEMO_KEY, nasa, met-museum) or gracefully skip when the
 * key is missing (flickr, europeana) — so they're all safe to default-on.
 */
export const DEFAULT_PROVIDERS: ProviderId[] = [
  "wikimedia",
  "openverse",
  "itunes",
  "musicbrainz-caa",
  "unsplash",
  "pexels",
  "pixabay",
  "spotify",
  "brave", // brave is a search API (not ToS-grey) but requires a key
  "internet-archive",
  "smithsonian",
  "nasa",
  "met-museum",
  "flickr", // skipped if no FLICKR_API_KEY
  "europeana", // skipped if no EUROPEANA_API_KEY
];

export {
  bing,
  brave,
  browser,
  europeana,
  flickr,
  internetArchive,
  itunes,
  metMuseum,
  musicbrainzCaa,
  nasa,
  openverse,
  pexels,
  pixabay,
  serpapi,
  smithsonian,
  spotify,
  unsplash,
  wikimedia,
  youtubeThumb,
};
