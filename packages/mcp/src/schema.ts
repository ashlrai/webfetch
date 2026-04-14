/**
 * Zod input schemas per tool. Kept here so we can share them with render.ts
 * and a future HTTP transport without duplicating.
 */

import { z } from "zod";

export const providerIdSchema = z.enum([
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
]);

export const commonSearchOpts = {
  providers: z.array(providerIdSchema).optional(),
  safeSearch: z.enum(["strict", "moderate", "off"]).optional(),
  licensePolicy: z.enum(["safe-only", "prefer-safe", "any"]).optional(),
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
  maxBytes: z.number().int().min(1024).max(100 * 1024 * 1024).optional(),
  cacheDir: z.string().optional(),
});

export const fetchWithLicenseSchema = z.object({
  url: z.string().url(),
  probe: z.boolean().default(false).describe("When true, also download the bytes if this URL is an image"),
});

export const findSimilarSchema = z.object({
  url: z.string().url().describe("Public URL of the reference image"),
  providers: z.array(providerIdSchema).optional(),
});

export const probePageSchema = z.object({
  url: z.string().url(),
  respectRobots: z.boolean().default(true),
});

export const schemas = {
  search_images: searchImagesSchema,
  search_artist_images: searchArtistImagesSchema,
  search_album_cover: searchAlbumCoverSchema,
  download_image: downloadImageSchema,
  fetch_with_license: fetchWithLicenseSchema,
  find_similar: findSimilarSchema,
  probe_page: probePageSchema,
} as const;

export type ToolName = keyof typeof schemas;
