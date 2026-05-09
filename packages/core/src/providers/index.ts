import type { Provider, ProviderAuthRequirement, ProviderId } from "../types.ts";
export { PROVIDER_IDS } from "../types.ts";
import { bing } from "./bing.ts";
import { brave } from "./brave.ts";
import { browser } from "./browser.ts";
import { burst } from "./burst.ts";
import { europeanaArchival } from "./europeana-archival.ts";
import { europeana } from "./europeana.ts";
import { flickr } from "./flickr.ts";
import { internetArchive } from "./internet-archive.ts";
import { itunes } from "./itunes.ts";
import { libraryOfCongress } from "./library-of-congress.ts";
import { managedBrowser } from "./managed-browser.ts";
import { metMuseum } from "./met-museum.ts";
import { musicbrainzCaa } from "./musicbrainz-caa.ts";
import { nasa } from "./nasa.ts";
import { openverse } from "./openverse.ts";
import { pexels } from "./pexels.ts";
import { pixabay } from "./pixabay.ts";
import { rawpixel } from "./rawpixel.ts";
import { serpapi } from "./serpapi.ts";
import { smithsonian } from "./smithsonian.ts";
import { spotify } from "./spotify.ts";
import { unsplash } from "./unsplash.ts";
import { wellcomeCollection } from "./wellcome-collection.ts";
import { wikimedia } from "./wikimedia.ts";
import { youtubeThumb } from "./youtube-thumb.ts";

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
  "library-of-congress": libraryOfCongress,
  "wellcome-collection": wellcomeCollection,
  rawpixel,
  burst,
  "europeana-archival": europeanaArchival,
  "managed-browser": managedBrowser,
};

export const PROVIDER_AUTH: Partial<Record<ProviderId, ProviderAuthRequirement>> = {
  unsplash: { keys: ["unsplashAccessKey"], env: ["UNSPLASH_ACCESS_KEY"] },
  pexels: { keys: ["pexelsApiKey"], env: ["PEXELS_API_KEY"] },
  pixabay: { keys: ["pixabayApiKey"], env: ["PIXABAY_API_KEY"] },
  spotify: {
    keys: ["spotifyClientId", "spotifyClientSecret"],
    env: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
  },
  brave: { keys: ["braveApiKey"], env: ["BRAVE_API_KEY"] },
  bing: { keys: ["bingApiKey"], env: ["BING_API_KEY"] },
  serpapi: { keys: ["serpApiKey"], env: ["SERPAPI_KEY"] },
  flickr: { keys: ["flickrApiKey"], env: ["FLICKR_API_KEY"] },
  smithsonian: { keys: ["smithsonianApiKey"], env: ["SMITHSONIAN_API_KEY"] },
  europeana: { keys: ["europeanaApiKey"], env: ["EUROPEANA_API_KEY"] },
  "europeana-archival": { keys: ["europeanaApiKey"], env: ["EUROPEANA_API_KEY"] },
  "managed-browser": { keys: ["brightDataApiToken"], env: ["BRIGHTDATA_API_TOKEN"] },
};

for (const id of Object.keys(PROVIDER_AUTH) as ProviderId[]) {
  const provider = ALL_PROVIDERS[id];
  if (provider) provider.auth = PROVIDER_AUTH[id];
}

/**
 * Safe defaults: providers run when no `providers` list is supplied.
 * Excludes browser/serpapi/bing (opt-in / ToS-grey / deprecation-risk).
 * Includes only providers that either need no auth OR gracefully skip when
 * their auth is missing.
 *
 * `europeana-archival` is excluded from defaults — it's an opt-in variant of
 * the base `europeana` adapter targeting TEXT records for editorial use.
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
  "library-of-congress",
  "wellcome-collection",
  "rawpixel",
  "burst",
];

export {
  bing,
  brave,
  browser,
  burst,
  europeana,
  europeanaArchival,
  flickr,
  internetArchive,
  itunes,
  libraryOfCongress,
  managedBrowser,
  metMuseum,
  musicbrainzCaa,
  nasa,
  openverse,
  pexels,
  pixabay,
  rawpixel,
  serpapi,
  smithsonian,
  spotify,
  unsplash,
  wellcomeCollection,
  wikimedia,
  youtubeThumb,
};
