/**
 * Request schemas for `/v1/*` endpoints. Mirrors
 * `packages/server/src/schema.ts` and `packages/mcp/src/schema.ts` exactly so
 * the cloud API is a drop-in substitute.
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
  query: z.string().min(1),
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
});

export const fetchWithLicenseSchema = z.object({
  url: z.string().url(),
  probe: z.boolean().default(false),
});

export const findSimilarSchema = z.object({
  url: z.string().url(),
  providers: z.array(providerIdSchema).optional(),
});

export const probePageSchema = z.object({
  url: z.string().url(),
  respectRobots: z.boolean().default(true),
});

export const createKeySchema = z.object({
  name: z.string().min(1).max(80),
});

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
});

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member", "billing", "readonly"]),
});

export const updateMemberSchema = z.object({
  role: z.enum(["admin", "member", "billing", "readonly"]),
});

export const createCheckoutSchema = z.object({
  plan: z.enum(["pro", "team"]),
  seats: z.number().int().min(1).max(100).optional(),
});
