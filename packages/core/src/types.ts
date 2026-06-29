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

/**
 * Metrics describing a semantic cluster produced by `clusterCandidates()`.
 *
 * - `pHashSimilarity`   — average pHash Hamming similarity (0..1; 1 = identical).
 * - `metadataSimilarity` — average title/author overlap (0..1; Levenshtein-based).
 * - `providerRankScore`  — weighted average of per-member provider-rank contributions.
 * - `compositeConfidence` — 0.4*pHashSimilarity + 0.4*metadataSimilarity + 0.2*providerRankScore.
 */
export interface ClusterMetrics {
  pHashSimilarity: number;
  metadataSimilarity: number;
  providerRankScore: number;
  compositeConfidence: number;
}

/**
 * A canonical group produced by `clusterCandidates()`.
 *
 * - `representative` — the best candidate in the group (highest scorer, then best license).
 * - `alternatives`   — all other members of the group (sorted by score desc).
 * - `clusterMetrics` — similarity & confidence breakdown for the group.
 * - `clusterAnnotation` — human-readable label: `"cluster"` when the group has 2+ members,
 *   `"unique"` when it is a singleton.
 */
export interface ClusterGroup {
  representative: ImageCandidate;
  alternatives: ImageCandidate[];
  clusterMetrics: ClusterMetrics;
  clusterAnnotation: "cluster" | "unique";
}

/**
 * Options for `clusterCandidates()`.
 *
 * All thresholds are expressed as **similarity** values in [0, 1] (1 = identical):
 *   - `pHashThreshold`    — minimum pHash similarity to consider two images visually alike.
 *     Default: 0.875 (≈ Hamming distance ≤ 8 on 64-bit hash).
 *     Valid range: 0.7 – 0.95 (clamped).
 *   - `metaThreshold`     — minimum normalised metadata (title/author) similarity.
 *     Default: 0.6.
 *   - `requireBothSignals` — when true, *both* pHash AND metadata signals must individually
 *     exceed their respective thresholds for a merge.  Default: false (single strong signal
 *     is sufficient — OR-mode).
 */
export interface SemanticClusteringOptions {
  /** Minimum pHash similarity (0..1) to consider two candidates visually alike. Default 0.875. */
  pHashThreshold?: number;
  /** Minimum normalised metadata similarity (0..1). Default 0.6. */
  metaThreshold?: number;
  /**
   * When true, require BOTH pHash AND metadata signals to exceed their
   * respective thresholds (AND-mode).  Default false (OR-mode).
   */
  requireBothSignals?: boolean;
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
  /**
   * When true, run the semantic clustering layer after ranking.
   * Populates `SearchResultBundle.candidateClusters` with `ClusterGroup[]`.
   * Candidates that share the same visual appear as a single cluster group with
   * alternatives listed — enabling an "expand alternatives" UX.
   */
  clusterSimilar?: boolean;
  /** Fine-tune the clustering algorithm when `clusterSimilar` is true. */
  clusteringOptions?: SemanticClusteringOptions;

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

  /**
   * When true, analyze provider outcomes after federation and attach a
   * `FederationRepairPlan` to the returned `SearchResultBundle.repairPlan`.
   * Off by default — opt in when you need actionable failure diagnostics.
   */
  repairPlan?: boolean;
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
  /**
   * Populated when `SearchOptions.clusterSimilar` is true.
   * Each entry is a canonical cluster group: one representative + zero or more
   * visually/semantically similar alternatives. Single candidates with no
   * neighbours appear as a cluster with an empty `alternatives` array and
   * `clusterAnnotation: "unique"`.
   */
  candidateClusters?: ClusterGroup[];
  /**
   * Populated when `SearchOptions.repairPlan` is true (opt-in, off by default).
   * Provides actionable repair recommendations when providers failed, returned
   * no results, or produced low-confidence results.
   */
  repairPlan?: FederationRepairPlan;
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

// ---------------------------------------------------------------------------
// Federation Repair Plan types
// ---------------------------------------------------------------------------

/**
 * The concrete action a repair recommendation advises.
 *
 * - `'retry'`           — re-run the same query; transient error may have cleared.
 * - `'relax-policy'`    — loosen the licensePolicy (e.g. safe-only → prefer-safe).
 * - `'add-provider'`    — add one or more providers to the request.
 * - `'enable-browser'`  — opt-in to the browser/managed-browser provider for JS-gated sites.
 * - `'set-auth'`        — configure missing API credentials for a skipped provider.
 * - `'increase-timeout'`— raise timeoutMs; providers timed out before returning results.
 */
export type RepairAction =
  | "retry"
  | "relax-policy"
  | "add-provider"
  | "enable-browser"
  | "set-auth"
  | "increase-timeout";

/**
 * A single actionable repair step produced by `getFederationRepairPlan()`.
 */
export interface RepairRecommendation {
  /** The action class to take. */
  action: RepairAction;
  /** Human-readable explanation of why this action is recommended. */
  rationale: string;
  /**
   * Structured parameters for the action.
   * Shape depends on `action`:
   *   - `add-provider`    → `{ providers: ProviderId[] }`
   *   - `set-auth`        → `{ providers: ProviderId[]; envVars: string[] }`
   *   - `relax-policy`    → `{ suggestedPolicy: LicensePolicy }`
   *   - `increase-timeout`→ `{ suggestedTimeoutMs: number }`
   *   - `retry` / `enable-browser` → `{}`
   */
  parameters: Record<string, unknown>;
  /**
   * Estimated fraction of the issue that this action resolves (0..1).
   * Used for ranking recommendations — higher = more impactful first.
   */
  estimatedImpact: number;
}

/**
 * Structured repair plan returned by `getFederationRepairPlan()` and
 * optionally embedded in `SearchResultBundle.repairPlan`.
 */
export interface FederationRepairPlan {
  /** All detected patterns that triggered recommendations. */
  detectedPatterns: string[];
  /**
   * Ordered recommendations — highest `estimatedImpact` first.
   * Empty when no issues are detected (all providers succeeded with results).
   */
  recommendations: RepairRecommendation[];
  /**
   * True when the repair engine found no actionable issues
   * (every active provider succeeded and returned ≥1 result).
   */
  healthy: boolean;
  /** ISO-8601 timestamp of when this plan was generated. */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Batch Reverse-Image Search with Perceptual Distance Ranking
// ---------------------------------------------------------------------------

/**
 * Similarity band derived from Hamming distance between two 64-bit pHashes:
 *   - `exact`           0–3   (same image or trivial re-encode)
 *   - `near-duplicate`  4–8   (minor crop/resize/compression)
 *   - `similar`         9–15  (visually related)
 *   - `loosely-related` 16–25 (same subject, different angle/lighting)
 */
export type SimilarityBand = "exact" | "near-duplicate" | "similar" | "loosely-related";

/**
 * A single candidate returned by `findSimilarBatch`, annotated with its
 * Hamming distance from the closest reference image.
 */
export interface SimilarityResult {
  /** The found image candidate. */
  candidate: ImageCandidate;
  /** Hamming distance to the nearest reference hash (0 = identical). */
  distance: number;
  /** Index into the `references` array this candidate is closest to. */
  referenceIndex: number;
  /** Human-readable distance label derived from `distance`. */
  distanceLabel: SimilarityBand;
}

/**
 * A cluster of candidates sharing the same perceptual-distance band.
 */
export interface SimilarityCluster {
  /** Distance band for all candidates in this cluster. */
  similarity: SimilarityBand;
  /** Candidates ranked: license-first, then phash confidence, then provider priority. */
  candidates: SimilarityResult[];
  /** Total number of candidates in this cluster. */
  count: number;
}

/**
 * Per-reference pHash metadata returned in `BatchFindSimilarBundleResult.references`.
 */
export interface PerceptualDistance {
  /** 16-hex-char perceptual hash for this reference, or null if hashing failed. */
  pHash: string | null;
  /** Algorithm used — null when hashing failed. */
  algorithm: "dct-phash" | "ahash-fallback" | null;
  /** Hash confidence (0..1), or null when hashing failed. */
  confidence: number | null;
  /** Source URL of the reference image, when provided by the caller. */
  url?: string;
}

/**
 * Options for `findSimilarBatch`.
 */
export interface BatchFindSimilarOptions extends SearchOptions {
  /**
   * When true, if the same candidate URL appears for multiple references, keep
   * only the entry with the smallest Hamming distance (best match).
   * Default: false (each reference gets its own result set).
   */
  dedupeAcrossReferences?: boolean;
  /**
   * Maximum number of raw candidates to collect per reference before distance
   * ranking. Default: 50.
   */
  maxCandidatesPerReference?: number;
}

/**
 * Full result bundle returned by `findSimilarBatch`.
 */
export interface BatchFindSimilarBundleResult {
  /**
   * One entry per input reference — pHash metadata computed during the run.
   * Entries are in the same order as the input `references` array.
   */
  references: PerceptualDistance[];
  /**
   * Candidates grouped by similarity band, ordered from most to least similar.
   * Bands with zero candidates are omitted.
   */
  clusters: SimilarityCluster[];
  /** Aggregate statistics for the entire batch run. */
  statistics: {
    /** Total candidate entries (before URL-deduplication across references when dedupeAcrossReferences is off). */
    totalCandidates: number;
    /** Unique candidate URLs across all references and bands. */
    uniqueCandidates: number;
    /** Number of non-empty clusters. */
    clusterCount: number;
    /** Number of reference images provided. */
    referenceCount: number;
    /** Per-band candidate counts. */
    bandBreakdown: Record<SimilarityBand, number>;
    /** Median Hamming distance across all candidates, or null if no candidates. */
    medianHammingDistance: number | null;
    /** 90th-percentile Hamming distance, or null if no candidates. */
    p90HammingDistance: number | null;
  };
  /** Non-fatal warnings (skipped references, missing API keys, etc.). */
  warnings: string[];
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
