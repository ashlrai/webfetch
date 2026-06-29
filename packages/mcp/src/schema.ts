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

export const schemas = {
  search_images: searchImagesSchema,
  search_artist_images: searchArtistImagesSchema,
  search_album_cover: searchAlbumCoverSchema,
  download_image: downloadImageSchema,
  fetch_with_license: fetchWithLicenseSchema,
  find_similar: findSimilarSchema,
  batch_find_similar: batchFindSimilarSchema,
  probe_page: probePageSchema,
  compare_phashes: comparePhashesSchema,
  compare_candidates: compareCandidatesSchema,
} as const;

export type ToolName = keyof typeof schemas;
