/**
 * Zod input schemas per tool. Kept here so we can share them with render.ts
 * and a future HTTP transport without duplicating.
 */

import { z } from "zod";
import { LICENSE_POLICIES, PROVIDER_IDS } from "../../core/src/types.ts";

export const providerIdSchema = z.enum(PROVIDER_IDS);

export const commonSearchOpts = {
  providers: z.array(providerIdSchema).optional(),
  safeSearch: z.enum(["strict", "moderate", "off"]).optional(),
  licensePolicy: z.enum(LICENSE_POLICIES).optional(),
  maxPerProvider: z.number().int().min(1).max(50).optional(),
  minWidth: z.number().int().min(1).optional(),
  minHeight: z.number().int().min(1).optional(),
  timeoutMs: z.number().int().min(500).max(60_000).optional(),
};

export const searchImagesSchema = z.object({
  query: z.string().min(1).describe("What to search for (e.g., 'Drake musician portrait')"),
  ...commonSearchOpts,
});

export const searchArtistImagesSchema = z.object({
  artist: z.string().min(1),
  kind: z.enum(["portrait", "album", "logo", "performing"]).default("portrait"),
  ...commonSearchOpts,
});

export const searchAlbumCoverSchema = z.object({
  artist: z.string().min(1),
  album: z.string().min(1),
  ...commonSearchOpts,
});

export const downloadImageSchema = z.object({
  url: z.string().url(),
  maxBytes: z
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .optional(),
  cacheDir: z.string().optional(),
});

export const fetchWithLicenseSchema = z.object({
  url: z.string().url(),
  probe: z
    .boolean()
    .default(false)
    .describe("When true, also download the bytes if this URL is an image"),
});

export const findSimilarSchema = z.object({
  url: z.string().url().describe("Public URL of the reference image"),
  providers: z.array(providerIdSchema).optional(),
});

export const probePageSchema = z.object({
  url: z.string().url(),
  respectRobots: z.boolean().default(true),
});

export const comparePhashesSchema = z.object({
  urlA: z.string().url().describe("First image URL to compare"),
  urlB: z.string().url().describe("Second image URL to compare"),
});

export const batchFindSimilarSchema = z.object({
  urls: z
    .array(z.string().url())
    .min(1)
    .max(50)
    .describe("Public image URLs to reverse-search (max 50)"),
  providers: z
    .array(providerIdSchema)
    .optional()
    .describe("Providers to use; supported: 'brave', 'serpapi'"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max candidates per URL after deduplication (default 20)"),
});

/** Inline ImageCandidate shape accepted by compare_candidates (subset of ImageCandidate). */
const candidateInputSchema = z.object({
  url: z.string().url().describe("Candidate image URL"),
  source: z.string().describe("Provider id that returned this candidate (e.g. 'wikimedia')"),
  license: z.string().describe("License tag (e.g. 'CC0', 'UNKNOWN')"),
  phash: z.string().optional().describe("Pre-computed perceptual hash (16-hex-char)"),
  phashResult: z
    .object({
      hash: z.string(),
      algorithm: z.enum(["dct-phash", "ahash-fallback"]),
      confidence: z.number().min(0).max(1),
    })
    .optional()
    .describe("Structured pHash result if available"),
  score: z.number().optional().describe("Composite ranker score (higher = better)"),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
});

export const compareCandidatesSchema = z.object({
  candidates: z
    .array(candidateInputSchema)
    .min(1)
    .max(500)
    .describe(
      "Array of ImageCandidate objects — typically the candidates field from a prior search_images / search_artist_images result",
    ),
  providerReports: z
    .array(z.any())
    .optional()
    .describe("ProviderReport array from the same bundle (pass-through; not used for analysis)"),
  warnings: z
    .array(z.string())
    .optional()
    .describe("Warnings array from the same bundle (pass-through)"),
  hammingThreshold: z
    .number()
    .int()
    .min(0)
    .max(64)
    .optional()
    .describe(
      "Maximum Hamming distance between two pHashes to be counted as visual duplicates (default 6)",
    ),
});

/** Inline ImageCandidate shape used by refine_search_results. */
const refineCandidateInputSchema = z.object({
  url: z.string().url(),
  source: z.string(),
  license: z.string(),
  confidence: z.number().min(0).max(1).optional(),
  sourcePageUrl: z.string().url().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  score: z.number().optional(),
});

export const refineSearchResultsSchema = z.object({
  candidates: z
    .array(refineCandidateInputSchema)
    .min(1)
    .max(500)
    .describe(
      "Array of ImageCandidate objects from a prior search_images / search_artist_images call",
    ),
  providerReports: z.array(z.any()).optional().describe("ProviderReport array from the same bundle"),
  warnings: z.array(z.string()).optional().describe("Warnings array from the same bundle"),
  candidateIndex: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Zero-based index of a specific candidate to probe. When provided, the tool fetches its sourcePageUrl for additional license metadata.",
    ),
  confidenceThreshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "Confidence score below which a candidate is flagged as low-confidence (default 0.5)",
    ),
});

export const providerRecommendationsSchema = z.object({
  windowMs: z
    .number()
    .int()
    .min(1000)
    .max(3_600_000)
    .optional()
    .describe("Sliding window size in ms (default 300000 = 5 minutes)"),
});

export const batchFindSimilarWithDistancesSchema = z.object({
  references: z
    .array(
      z.object({
        url: z.string().url().optional().describe("Public URL of a reference image"),
      }),
    )
    .min(1)
    .max(10)
    .describe("Reference images to reverse-search (max 10). Each entry needs a url."),
  providers: z
    .array(providerIdSchema)
    .optional()
    .describe("Providers to use; supported: 'brave', 'serpapi'"),
  dedupeAcrossReferences: z
    .boolean()
    .optional()
    .describe(
      "When true, if the same candidate URL appears for multiple references keep only the closest match. Default false.",
    ),
  maxCandidatesPerReference: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe("Max raw candidates collected per reference before ranking (default 50)."),
});

/** Inline ImageCandidate shape accepted by batch_cluster_by_phash. */
export const clusterCandidateInputSchema = z.object({
  url: z.string().url().describe("Candidate image URL"),
  source: z.string().describe("Provider id that returned this candidate (e.g. 'wikimedia')"),
  license: z.string().describe("License tag (e.g. 'CC0', 'UNKNOWN')"),
  phash: z.string().optional().describe("Pre-computed perceptual hash (16-hex-char)"),
  phashResult: z
    .object({
      hash: z.string(),
      algorithm: z.enum(["dct-phash", "ahash-fallback"]),
      confidence: z.number().min(0).max(1),
    })
    .optional()
    .describe("Structured pHash result if available"),
  phashAlgorithm: z.enum(["dct-phash", "ahash-fallback"]).optional(),
  confidence: z.number().min(0).max(1).optional().describe("License-confidence (0..1)"),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  score: z.number().optional().describe("Composite ranker score (higher = better)"),
});

export const batchClusterByPhashSchema = z.object({
  candidates: z
    .array(clusterCandidateInputSchema)
    .min(1)
    .max(500)
    .describe(
      "Array of ImageCandidate objects to cluster — typically from a prior search or reverse-image-search result",
    ),
  hammingThreshold: z
    .number()
    .int()
    .min(0)
    .max(64)
    .optional()
    .describe(
      "Maximum Hamming distance (inclusive) to group two candidates as visually similar. Default 10.",
    ),
  minClusterSize: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Only include clusters with at least this many members. Default 1 (include singletons).",
    ),
  confidenceDecay: z
    .boolean()
    .optional()
    .describe(
      "When true, apply a 0.02/hour decay to confidence of stale cached results (requires raw._cachedAt ISO timestamp or epoch-ms). Default false.",
    ),
});

/** Inline ProviderReport shape accepted by compute_federation_fallback. */
const providerReportInputSchema = z.object({
  provider: providerIdSchema,
  ok: z.boolean(),
  count: z.number().int().min(0),
  timeMs: z.number().min(0),
  error: z.string().optional(),
  skipped: z.enum(["missing-auth", "disabled", "rate-limited", "not-enabled"]).optional(),
  errorKind: z
    .enum(["ok", "timeout", "http-4xx", "http-5xx", "network", "decode", "rate-limited"])
    .optional(),
});

/** Inline FederationRepairPlan shape accepted by compute_federation_fallback. */
const repairPlanInputSchema = z.object({
  detectedPatterns: z.array(z.string()),
  recommendations: z.array(z.any()),
  healthy: z.boolean(),
  generatedAt: z.string(),
});

export const computeFederationFallbackSchema = z.object({
  repairPlan: repairPlanInputSchema.describe(
    "FederationRepairPlan from a prior searchImages call with repairPlan:true",
  ),
  originalLicensePolicy: z
    .enum(LICENSE_POLICIES)
    .describe("License policy that was active during the original query"),
  query: z.string().min(1).describe("The original search query string"),
  detectedPatterns: z
    .array(
      z.enum([
        "all-timeout",
        "all-unknown-license",
        "auth-missing",
        "low-confidence",
        "no-results",
        "all-failed",
        "partial-failure",
        "rate-limited",
        "no-browser-provider",
      ]),
    )
    .describe(
      "Failure patterns to address — typically repairPlan.detectedPatterns cast to FailurePattern[]",
    ),
  providerReports: z
    .array(providerReportInputSchema)
    .optional()
    .describe(
      "ProviderReport array from the original federation run — used to identify failed/healthy providers",
    ),
});

/** Inline ImageCandidate shape accepted by extract_image_metadata_audit. */
const auditCandidateInputSchema = z.object({
  url: z.string().url().describe("Candidate image URL"),
  source: z.string().describe("Provider id that returned this candidate (e.g. 'wikimedia')"),
  license: z.string().describe("License tag (e.g. 'CC0', 'UNKNOWN')"),
  author: z.string().optional().describe("Author/creator from the provider"),
  licenseUrl: z.string().url().optional().describe("URL of the license"),
  attributionLine: z.string().optional().describe("Provider-supplied attribution string"),
  title: z.string().optional(),
  sourcePageUrl: z.string().url().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const extractImageMetadataAuditSchema = z.object({
  imageBase64: z
    .string()
    .describe(
      "Base64-encoded bytes of the downloaded image to audit. Obtain these bytes via download_image first.",
    ),
  candidate: auditCandidateInputSchema.describe(
    "Provider-supplied ImageCandidate metadata to cross-check against the embedded bytes.",
  ),
  resolveConflicts: z
    .enum(["provider-first", "embedded-first", "conservative"])
    .default("conservative")
    .describe(
      "Conflict resolution strategy when embedded and provider metadata disagree. " +
      "'conservative' (default) prefers the higher-confidence source. " +
      "'provider-first' always trusts the provider. " +
      "'embedded-first' always trusts the image file.",
    ),
});

export const schemas = {
  search_images: searchImagesSchema,
  search_artist_images: searchArtistImagesSchema,
  search_album_cover: searchAlbumCoverSchema,
  download_image: downloadImageSchema,
  fetch_with_license: fetchWithLicenseSchema,
  find_similar: findSimilarSchema,
  batch_find_similar: batchFindSimilarSchema,
  batch_find_similar_with_distances: batchFindSimilarWithDistancesSchema,
  probe_page: probePageSchema,
  compare_phashes: comparePhashesSchema,
  compare_candidates: compareCandidatesSchema,
  refine_search_results: refineSearchResultsSchema,
  provider_recommendations: providerRecommendationsSchema,
  batch_cluster_by_phash: batchClusterByPhashSchema,
  compute_federation_fallback: computeFederationFallbackSchema,
  extract_image_metadata_audit: extractImageMetadataAuditSchema,
} as const;

export type ToolName = keyof typeof schemas;
