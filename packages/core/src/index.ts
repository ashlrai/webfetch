/**
 * @webfetch/core public API surface.
 *
 * Zero MCP concerns live here — this is a pure TypeScript library that an
 * agent, CLI, or any other runtime can use directly.
 */

export * from "./types.ts";
export { searchImages } from "./federation.ts";
export { pickBest, rankAll } from "./pick.ts";
export { assertPublicHttpUrl, downloadImage, DownloadError } from "./download.ts";
export { fetchWithLicense, parseHtmlLicense } from "./fetch-with-license.ts";
export { probePage, extractImages } from "./probe-page.ts";
export { findSimilar } from "./find-similar.ts";
export {
  perceptualHash,
  dedupeByHash,
  dedupeByUrl,
  hammingDistance,
  findDuplicates,
} from "./dedupe.ts";
export { readImageMetadata, parseXmp, parseIptc, parseExifBuffer } from "./metadata-reader.ts";
export type { EmbeddedMetadata } from "./metadata-reader.ts";
export {
  buildAttribution,
  coerceLicense,
  heuristicLicenseFromUrl,
  isContextSafeLicense,
  isOpenLicense,
  isSafeLicense,
  prettyLicenseName,
  requiresAttribution,
  CONTEXT_SAFE_LICENSES,
  OPEN_LICENSES,
  SAFE_LICENSES,
  LICENSE_RANK,
} from "./license.ts";
export { searchArtistImages, searchAlbumCover, searchEventPhotos } from "./hints/index.ts";
export type { ArtistImageKind } from "./hints/index.ts";
export { ALL_PROVIDERS, DEFAULT_PROVIDERS, PROVIDER_IDS } from "./providers/index.ts";
export { defaultCacheDir } from "./cache.ts";
export {
  trackEvent,
  isTelemetryEnabled,
  installHash,
  buildPayload,
  ALLOWED_EVENTS,
  DEFAULT_ENDPOINT,
  FALLBACK_ENDPOINT,
  TELEMETRY_SALT,
} from "./telemetry.ts";
export type {
  TelemetryEvent,
  TelemetryProps,
  TelemetryOptions,
  TelemetryConfig,
  TelemetryPayload,
  Fetcher as TelemetryFetcher,
} from "./telemetry.ts";
