/**
 * Seam for injecting a stubbed core in tests. Re-exports everything we use
 * from @webfetch/core behind a mutable binding so `cli.test.ts` can swap
 * implementations without touching the network.
 */

import * as realCore from "@webfetch/core";

export type CoreApi = {
  searchImages: typeof realCore.searchImages;
  searchArtistImages: typeof realCore.searchArtistImages;
  searchAlbumCover: typeof realCore.searchAlbumCover;
  downloadImage: typeof realCore.downloadImage;
  probePage: typeof realCore.probePage;
  fetchWithLicense: typeof realCore.fetchWithLicense;
  ALL_PROVIDERS: typeof realCore.ALL_PROVIDERS;
  DEFAULT_PROVIDERS: typeof realCore.DEFAULT_PROVIDERS;
  defaultCacheDir: typeof realCore.defaultCacheDir;
};

let impl: CoreApi = {
  searchImages: realCore.searchImages,
  searchArtistImages: realCore.searchArtistImages,
  searchAlbumCover: realCore.searchAlbumCover,
  downloadImage: realCore.downloadImage,
  probePage: realCore.probePage,
  fetchWithLicense: realCore.fetchWithLicense,
  ALL_PROVIDERS: realCore.ALL_PROVIDERS,
  DEFAULT_PROVIDERS: realCore.DEFAULT_PROVIDERS,
  defaultCacheDir: realCore.defaultCacheDir,
};

export function core(): CoreApi {
  return impl;
}

/** Test-only override. */
export function __setCoreForTests(patch: Partial<CoreApi>): void {
  impl = { ...impl, ...patch };
}
