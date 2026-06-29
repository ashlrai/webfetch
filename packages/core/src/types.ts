/**
 * Public types for webfetch-core.
 *
 * The `ImageCandidate` shape is intentionally a superset of the one used by
 * `artist-encyclopedia-factory/packages/ingest` so consumers can pass results
 * straight into that factory's pick/download pipeline without any adapter.
 */

/**
 * Structured perceptual hash result.
 *
 * - `hash`: 16-hex-char (64-bit) fingerprint.
 * - `algorithm`: `"dct-phash"` when sharp was available (real DCT-II pHash);
 *   `"ahash-fallback"` when sharp was unavailable and we used the byte-window fallback.
 * - `confidence`: 0..1. `1.0` for dct-phash (full image decoded + resized);
 *   `0.5` for ahash-fallback (raw bytes, no resize — less perceptually stable).
 */
export interface PerceptualHashResult {
  hash: string;
  algorithm: "dct-phash" | "ahash-fallback";
  confidence: number;
}

export type License =
  | "CC0"
  | "PUBLIC_DOMAIN"
  | "CC_BY"
  | "CC_BY_SA"
  | "UNSPLASH_LICENSE"
  | "PEXELS_LICENSE"
  | "PIXABAY_LICENSE"
  | "EDITORIAL_LICENSED"
  | "PRESS_KIT_ALLOWLIST"
  | "UNKNOWN";

export const PROVIDER_IDS = [
  "wikimedia",
  "openverse",
  "unsplash",
  "pexels",
  "pixabay",
  "itunes",
  "musicbrainz-caa",
  "spotify",
  "youtube-thumb",
  "brave",
  "bing",
  "serpapi",
  "browser",
  "flickr",
  "internet-archive",
  "smithsonian",
  "nasa",
  "met-museum",
  "europeana",
  "library-of-congress",
  "wellcome-collection",
  "rawpixel",
  "burst",
  "europeana-archival",
  "managed-browser",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export const LICENSE_POLICIES = [
  "open-only",
  "safe-only",
  "context-safe",
  "prefer-safe",
  "any",
] as const;

export type LicensePolicy = (typeof LICENSE_POLICIES)[number];
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
  /** Set by dedupe when present. String form is the legacy bare hex; structured form carries metadata. */
  phash?: string;
  /** Structured pHash result set by dedupe when computeHashes is used with perceptualHashStructured(). */
  phashResult?: PerceptualHashResult;
  /**
   * Algorithm used to compute `phash`. Mirrors `phashResult.algorithm` for callers
   * that want a quick top-level discriminant without destructuring `phashResult`.
   */
  phashAlgorithm?: "dct-phash" | "ahash-fallback";
  /** Free-form marker for provider-specific metadata; opaque to callers. */
  raw?: unknown;
  /** When true, this result was sourced via an opt-in browser fallback (see providers/browser.ts). */
  viaBrowserFallback?: boolean;
}

/**
 * Structured reason for a provider outcome.
 * "ok" is set on success; all other values indicate failure/skip categories.
 * Optional — callers that don't care can ignore it; shape remains back-compat.
 */
export type ErrorKind =
  | "ok"
  | "timeout"
  | "http-4xx"
  | "http-5xx"
  | "network"
  | "decode"
  | "rate-limited";

export interface ProviderReport {
  provider: ProviderId;
  ok: boolean;
  count: number;
  timeMs: number;
  error?: string;
  skipped?: "missing-auth" | "disabled" | "rate-limited" | "not-enabled";
  /** Structured failure category. Allows callers/agents to route on WHY a provider failed. */
  errorKind?: ErrorKind;
  /** Additional diagnostic context (e.g. HTTP status code, decode field). */
  errorContext?: Record<string, unknown>;
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
  /** Bright Data Web Unlocker — single account-level API token, server-side only. */
  brightDataApiToken?: string;
  brightDataZone?: string;
}

export interface ProviderAuthRequirement {
  /** Environment variables accepted by the provider when opts.auth omits a key. */
  env: string[];
  /** ProviderAuth fields accepted by the provider. All fields listed here are required. */
  keys: (keyof ProviderAuth)[];
}

export interface SearchResultBundle {
  candidates: ImageCandidate[];
  providerReports: ProviderReport[];
  warnings: string[];
}

/**
 * A single member of a duplicate group as returned by `compareCandidates()`.
 * `index` is the position in the original `SearchResultBundle.candidates` array.
 */
export interface DedupeGroupMember {
  index: number;
  url: string;
  provider: string;
  phash?: string;
}

/**
 * A cluster of candidates that are considered duplicates of each other.
 * - `reason: 'phash'`  — members share a perceptual hash within the Hamming threshold.
 * - `reason: 'url'`    — members share a normalised URL (after stripping cache-buster params).
 * - `confidence`       — 0..1; 1.0 for exact URL matches, scales with phash algorithm quality otherwise.
 */
export interface DuplicateGroup {
  members: DedupeGroupMember[];
  reason: "phash" | "url";
  /** 0..1 confidence that these are truly the same image. */
  confidence: number;
}

/**
 * Structured deduplication report returned by `compareCandidates()`.
 *
 * - `duplicateGroups` — every cluster of 2+ candidates detected as duplicates.
 * - `merged`          — deduplicated candidate list (one representative per group, highest-scored first).
 */
export interface ProviderDedupeReport {
  duplicateGroups: DuplicateGroup[];
  merged: ImageCandidate[];
}

export type Fetcher = typeof fetch;

export interface Provider {
  id: ProviderId;
  /** License tag the provider's results default to when metadata is missing. */
  defaultLicense: License;
  /** Whether this provider requires auth (and therefore should be skipped when none is configured). */
  requiresAuth: boolean;
  /** Declarative auth contract used by federation/CLI for deterministic skips. */
  auth?: ProviderAuthRequirement;
  /** When true, provider is only run on explicit opt-in. */
  optIn?: boolean;
  search: (query: string, opts: SearchOptions) => Promise<ImageCandidate[]>;
  /** Optional: reverse-image-search given a local image or URL. */
  findSimilar?: (
    ref: { url?: string; bytes?: Uint8Array },
    opts: SearchOptions,
  ) => Promise<ImageCandidate[]>;
}
