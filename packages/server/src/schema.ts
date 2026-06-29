/**
 * Request schemas for HTTP endpoints.
 *
 * These mirror `webfetch-mcp/src/schema.ts` 1:1 — same field names, same
 * constraints — so the extension-facing HTTP API and the agent-facing MCP
 * API are interchangeable. Duplicated (not imported) because MCP's package
 * has no subpath exports; keeping both copies in lock-step is cheap.
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

export const comparePhashesSchema = z.object({
  urlA: z.string().url(),
  urlB: z.string().url(),
});

export const batchFindSimilarSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(50),
  providers: z.array(providerIdSchema).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/** Inline ImageCandidate shape accepted by POST /extract-metadata. */
const auditCandidateInputSchema = z.object({
  url: z.string().url(),
  source: z.string(),
  license: z.string(),
  author: z.string().optional(),
  licenseUrl: z.string().url().optional(),
  attributionLine: z.string().optional(),
  title: z.string().optional(),
  sourcePageUrl: z.string().url().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const extractImageMetadataAuditSchema = z.object({
  imageBase64: z
    .string()
    .describe("Base64-encoded bytes of the downloaded image to audit."),
  candidate: auditCandidateInputSchema,
  resolveConflicts: z
    .enum(["provider-first", "embedded-first", "conservative"])
    .default("conservative"),
});

/** Inline ImageCandidate shape accepted by POST /audit-license-consensus. */
const reconcileCandidateInputSchema = z.object({
  url: z.string().url(),
  source: z.string(),
  license: z.string(),
  phash: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  licenseUrl: z.string().url().optional(),
  title: z.string().optional(),
  author: z.string().optional(),
  licenseAuditTrail: z
    .object({
      source: z.enum(["api-metadata", "embedded-metadata", "heuristic-url", "fallback"]).optional(),
      provenance: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      flags: z.array(z.string()).optional(),
    })
    .optional(),
}).passthrough();

export const auditLicenseConsensusSchema = z.object({
  candidates: z
    .array(reconcileCandidateInputSchema)
    .min(1)
    .max(500),
  allGroups: z.boolean().optional(),
});

/** Schema for POST /audit-license-conflicts */
export const auditLicenseConflictsSchema = z.object({
  candidates: z
    .array(reconcileCandidateInputSchema)
    .min(1)
    .max(1000),
  detailedTrail: z.boolean().optional().default(true),
  severityFilter: z
    .enum(["none", "minor", "major", "critical"])
    .optional(),
});

/** Schema for POST /resolve-license-conflicts */
export const resolveLicenseConflictsSchema = z.object({
  candidates: z
    .array(reconcileCandidateInputSchema)
    .min(1)
    .max(1000),
  minAuthorityScore: z.number().min(0).max(1).optional(),
  maxResults: z.number().int().min(1).max(500).optional(),
  includeTrail: z.boolean().optional().default(false),
  suggestUpgrades: z.boolean().optional().default(true),
});
