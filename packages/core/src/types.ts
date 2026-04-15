/**
 * Public types for @webfetch/core.
 *
 * The `ImageCandidate` shape is intentionally a superset of the one used by
 * `artist-encyclopedia-factory/packages/ingest` so consumers can pass results
 * straight into that factory's pick/download pipeline without any adapter.
 */

export type License =
  | "CC0"
  | "PUBLIC_DOMAIN"
  | "CC_BY"
  | "CC_BY_SA"
  | "EDITORIAL_LICENSED"
  | "PRESS_KIT_ALLOWLIST"
  | "UNKNOWN";

export type ProviderId =
  | "wikimedia"
  | "openverse"
  | "unsplash"
  | "pexels"
  | "pixabay"
  | "itunes"
  | "musicbrainz-caa"
  | "spotify"
  | "youtube-thumb"
  | "brave"
  | "bing"
  | "serpapi"
  | "browser"
  | "flickr"
  | "internet-archive"
  | "smithsonian"
  | "nasa"
  | "met-museum"
  | "europeana"
  | "library-of-congress"
  | "wellcome-collection"
  | "rawpixel"
  | "burst"
  | "europeana-archival";

export type LicensePolicy = "safe-only" | "prefer-safe" | "any";
export type SafeSearchMode = "strict" | "moderate" | "off";

export interface ImageCandidate {
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  mime?: string;
  byteSize?: number;
  source: string; // provider id
  sourcePageUrl?: string; // attribution / canonical page
  title?: string;
  author?: string;
  license: License;
  licenseUrl?: string;
  attributionLine?: string;
  /** Composite ranker score (higher = better). */
  score?: number;
  /** License-confidence (0..1). 1 = structured metadata from authoritative source. */
  confidence?: number;
  /** Set by dedupe when present. */
  phash?: string;
  /** Free-form marker for provider-specific metadata; opaque to callers. */
  raw?: unknown;
  /** When true, this result was sourced via an opt-in browser fallback (see providers/browser.ts). */
  viaBrowserFallback?: boolean;
}

export interface ProviderReport {
  provider: ProviderId;
  ok: boolean;
  count: number;
  timeMs: number;
  error?: string;
  skipped?: "missing-auth" | "disabled" | "rate-limited" | "not-enabled";
}

export interface SearchOptions {
  providers?: ProviderId[];
  safeSearch?: SafeSearchMode;
  licensePolicy?: LicensePolicy;
  maxPerProvider?: number;
  timeoutMs?: number;
  minWidth?: number;
  minHeight?: number;
  signal?: AbortSignal;
  /** Injectable fetch for testing. */
  fetcher?: Fetcher;
  /** Provider auth bag; anything missing causes that provider to be skipped. */
  auth?: ProviderAuth;
  /** When true, skip real network calls and return provider names that *would* be hit. */
  dryRun?: boolean;
}

export interface ProviderAuth {
  unsplashAccessKey?: string;
  pexelsApiKey?: string;
  pixabayApiKey?: string;
  braveApiKey?: string;
  bingApiKey?: string;
  serpApiKey?: string;
  spotifyClientId?: string;
  spotifyClientSecret?: string;
  /** User-Agent required by Wikimedia/MusicBrainz — should include contact info. */
  userAgent?: string;
  flickrApiKey?: string;
  smithsonianApiKey?: string;
  europeanaApiKey?: string;
  rawpixelApiKey?: string;
}

export interface SearchResultBundle {
  candidates: ImageCandidate[];
  providerReports: ProviderReport[];
  warnings: string[];
}

export type Fetcher = typeof fetch;

export interface Provider {
  id: ProviderId;
  /** License tag the provider's results default to when metadata is missing. */
  defaultLicense: License;
  /** Whether this provider requires auth (and therefore should be skipped when none is configured). */
  requiresAuth: boolean;
  /** When true, provider is only run on explicit opt-in. */
  optIn?: boolean;
  search: (query: string, opts: SearchOptions) => Promise<ImageCandidate[]>;
  /** Optional: reverse-image-search given a local image or URL. */
  findSimilar?: (ref: { url?: string; bytes?: Uint8Array }, opts: SearchOptions) => Promise<ImageCandidate[]>;
}
