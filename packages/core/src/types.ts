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
  /**
   * License provenance audit trail — records how the license was determined and
   * how trustworthy that determination is. Set by providers / coercion helpers
   * that use `coerceLicenseWithTrail` or `heuristicLicenseFromUrlWithTrail`.
   * Used by `rankAll` as a secondary confidence tie-breaker.
   */
  licenseAuditTrail?: import("./attribution-audit.ts").LicenseAuditTrail;
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

  // ---------------------------------------------------------------------------
  // Provider Health & Failover Strategy (v4+)
  // ---------------------------------------------------------------------------

  /**
   * How to order providers before dispatching:
   * - `'fastest'`   — sort by avg latency ascending (lowest first).
   * - `'healthiest'` — sort by health score descending (health = 1 - errorRate - rateLimitPenalty).
   * - `'default'`   — preserve the order given in `providers` (or DEFAULT_PROVIDERS order).
   */
  providerPreference?: "fastest" | "healthiest" | "default";

  /**
   * When true, enable adaptive per-provider timeouts derived from observed
   * avg latency (clamped to `timeoutMs` as the ceiling).  Falls back to the
   * next-best provider in `fallbackChain` on timeout/error.
   */
  adaptiveTimeoutMs?: boolean;

  /**
   * Explicit ordered fallback chain.  When a provider in this list times out
   * or errors, the next provider in the chain is attempted sequentially.
   * Providers not in this list are still run in parallel as normal.
   */
  fallbackChain?: ProviderId[];

  /**
   * When true, run a live endpoint health-check for each requested provider
   * before dispatching searches. Providers whose circuit-breaker is open or
   * whose endpoint returns 5xx are removed from the dispatch list and reported
   * as skipped in providerReports. Adds one round-trip of latency.
   */
  healthCheck?: boolean;
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

/**
 * A canonical candidate produced by `dedupeWithPhashGrouping()`.
 *
 * The representative is the highest-scored (or first-seen) member of the
 * pHash cluster. Metadata from all group members is merged in:
 * - `author`, `title`, `sourcePageUrl` — first non-empty value wins.
 * - `alternateUrls` — every URL in the group except the canonical one.
 * - `providers` — all source provider ids that returned this visual.
 * - `confidence` — aggregated from phash algorithm quality and best license rank.
 */
export interface PhashCanonicalCandidate extends ImageCandidate {
  /** All provider ids that returned this visual (includes the representative's source). */
  providers: string[];
  /** All non-canonical URLs for this visual (from duplicate group members). */
  alternateUrls: string[];
  /**
   * Aggregated confidence: weighted combination of phash algorithm quality
   * and the best license rank in the group (lower rank = more open = higher
   * weight). Range 0..1.
   */
  aggregatedConfidence: number;
}

/**
 * Result of `dedupeWithPhashGrouping()`.
 *
 * - `canonical` — one entry per unique visual, with metadata merged from all providers.
 * - `groups`    — the underlying DuplicateGroup clusters (same shape as compareCandidates).
 * - `singletons` — candidates that were not part of any duplicate group (pass-through, unchanged).
 */
export interface PhashGroupingResult {
  canonical: PhashCanonicalCandidate[];
  groups: DuplicateGroup[];
  singletons: ImageCandidate[];
}

/**
 * Options for `dedupeWithPhashGrouping()`.
 */
export interface DedupeWithPhashGroupingOptions {
  /**
   * Maximum Hamming distance (inclusive) to consider two pHashes as the same
   * visual. Default: 8 (slightly more permissive than compareCandidates default
   * of 6 to handle minor re-encoding differences across providers).
   */
  hammingThreshold?: number;
  /**
   * When true, download and compute pHashes for candidates that don't have one.
   * Expensive — only enable when high deduplication accuracy matters more than speed.
   * Default: false.
   */
  computeHashes?: boolean;
  /** Injectable fetch implementation. Used when computeHashes is true. */
  fetcher?: Fetcher;
  /** User-Agent header passed to the downloader when computeHashes is true. */
  userAgent?: string;
  /** AbortSignal for cancelling in-flight hash computation. */
  signal?: AbortSignal;
  /**
   * Weight (0..1) given to the phash algorithm confidence when computing
   * `aggregatedConfidence`. The remainder (1 - phashWeight) is given to the
   * license rank score. Default: 0.6.
   */
  phashWeight?: number;
}

/**
 * A single gap entry in a RefinementPlan — describes one low-confidence
 * candidate and the recommended action to improve confidence.
 */
export interface ConfidenceGap {
  /** Index of the candidate in the SearchResultBundle.candidates array. */
  candidateIndex: number;
  /** The candidate itself (convenience copy). */
  candidate: ImageCandidate;
  /** Current license-confidence score (0..1). */
  currentConfidence: number;
  /** Recommended action to improve confidence. */
  suggestedAction: "probe-page" | "upgrade-provider" | "fallback-to-open-only";
  /** Human-readable reason for this suggestion. */
  reason: string;
}

/**
 * One step in the upgrade path — describes which target policy to try and
 * the expected confidence gain from switching.
 */
export interface UpgradePathStep {
  /** The license policy to target when re-running the search. */
  targetLicensePolicy: LicensePolicy;
  /** Estimated fractional confidence gain (0..1) from applying this step. */
  expectedConfidenceGain: number;
  /** Human-readable description of the trade-off. */
  rationale: string;
}

/**
 * Refinement plan produced by `refineSearchResults()`.
 *
 * Agents can use this to decide whether to re-query, probe source pages for
 * richer metadata, or accept lower-confidence results under a relaxed policy.
 */
export interface RefinementPlan {
  /** Gaps identified in the current result set (one per low-confidence candidate). */
  confidenceGaps: ConfidenceGap[];
  /**
   * Ordered upgrade-path suggestions — from highest expected gain to lowest.
   * Empty when all results already meet the confidence threshold.
   */
  upgradePath: UpgradePathStep[];
  /**
   * Providers observed to deliver high-confidence results for similar queries
   * (drawn from federation diagnostics when available).
   */
  highConfidenceProviders: string[];
  /** Summary counts. */
  summary: {
    totalCandidates: number;
    lowConfidenceCount: number;
    unknownLicenseCount: number;
    /** Fraction of candidates below the confidence threshold. */
    gapRatio: number;
  };
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
