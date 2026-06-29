/**
 * MCP tool definitions + handlers.
 *
 * Descriptions here are PROMPT SURFACE for agents. Craft them so an LLM
 * reading them picks the right tool and passes the right args.
 */

import {
  batchFindSimilar,
  compareCandidates,
  downloadImage,
  exportCache,
  fetchWithLicense,
  findSimilar,
  getCacheStats,
  getFederationDiagnostics,
  hammingDistance,
  listCacheEntries,
  perceptualHashStructured,
  probePage,
  searchAlbumCover,
  searchArtistImages,
  searchImages,
} from "webfetch-core";
import { z } from "zod";
import { renderJson, renderSearch } from "./render.ts";
import {
  batchFindSimilarSchema,
  compareCandidatesSchema,
  comparePhashesSchema,
  downloadImageSchema,
  fetchWithLicenseSchema,
  findSimilarSchema,
  probePageSchema,
  searchAlbumCoverSchema,
  searchArtistImagesSchema,
  searchImagesSchema,
} from "./schema.ts";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodObject<any>;
  handler: (
    args: any,
  ) => Promise<{ content: unknown[]; structuredContent: unknown; isError?: boolean }>;
}

export const TOOLS: ToolDef[] = [
  {
    name: "search_images",
    description:
      "Federated image search across license-aware providers (Wikimedia Commons, Openverse, Unsplash, Pexels, Pixabay, iTunes, MusicBrainz CAA, Spotify, Brave). Returns concise ranked candidates with license + attribution. Does NOT auto-download — call `download_image` after. Default safe-only policy includes open, platform-license, editorial/press tags and rejects UNKNOWN. Use open-only for CC/public-domain only. For large batches, prefer CLI: webfetch batch --jsonl --continue-on-error.",
    inputSchema: searchImagesSchema,
    async handler(args) {
      const out = await searchImages(args.query, args);
      return renderSearch(out.candidates, out.providerReports, out.warnings);
    },
  },
  {
    name: "search_artist_images",
    description:
      "Specialized image search for a musical artist. `kind` selects provider set + query expansion: 'portrait' (Wikimedia + Unsplash + Spotify), 'album' (MusicBrainz CAA + iTunes + Spotify), 'logo' (Wikimedia), 'performing' (Wikimedia + Pexels). Prefer this over `search_images` when building artist/band content.",
    inputSchema: searchArtistImagesSchema,
    async handler(args) {
      const out = await searchArtistImages(args.artist, args.kind, args);
      return renderSearch(out.candidates, out.providerReports, out.warnings);
    },
  },
  {
    name: "search_album_cover",
    description:
      "Find canonical album artwork. Uses MusicBrainz Cover Art Archive + iTunes + Spotify. Results are EDITORIAL_LICENSED — safe for album identification UI per platform ToS; always show attribution.",
    inputSchema: searchAlbumCoverSchema,
    async handler(args) {
      const out = await searchAlbumCover(args.artist, args.album, args);
      return renderSearch(out.candidates, out.providerReports, out.warnings);
    },
  },
  {
    name: "download_image",
    description:
      "Download an image URL (typically from a prior search_images result) to the local disk cache. Streams with a 20MB hard cap, content-type guard, SHA-256 hash, and returns the cached file path. Host blocklist enforced.",
    inputSchema: downloadImageSchema,
    async handler(args) {
      const r = await downloadImage(args.url, { maxBytes: args.maxBytes, cacheDir: args.cacheDir });
      return renderJson({
        url: args.url,
        sha256: r.sha256,
        mime: r.mime,
        byteSize: r.bytes.byteLength,
        cachedPath: r.cachedPath,
      });
    },
  },
  {
    name: "fetch_with_license",
    description:
      "Given an arbitrary URL (image or webpage), determine its license via host heuristics + page metadata (<link rel=license>, dc.rights, og tags). Set probe: true to also download the bytes. Use when an agent already has a URL and needs a go/no-go decision before shipping.",
    inputSchema: fetchWithLicenseSchema,
    async handler(args) {
      const r = await fetchWithLicense(args.url, { probe: args.probe });
      return renderJson({
        license: r.license,
        confidence: r.confidence,
        author: r.author,
        attributionLine: r.attributionLine,
        sourcePageUrl: r.sourcePageUrl,
        mime: r.mime,
        sha256: r.sha256,
        cachedPath: r.cachedPath,
        byteSize: r.bytes?.byteLength,
      });
    },
  },
  {
    name: "find_similar",
    description:
      "Reverse-image-search: given a public image URL, find visually similar images. Requires SERPAPI_KEY env var and providers: ['serpapi']. Returns candidates with heuristic licenses — treat results as leads, not shippable.",
    inputSchema: findSimilarSchema,
    async handler(args) {
      const out = await findSimilar({ url: args.url }, { providers: args.providers });
      return renderJson(out);
    },
  },
  {
    name: "probe_page",
    description:
      "Given a webpage URL, return every <img> on the page with inferred dimensions and a heuristic license per image. Respects robots.txt by default. Use to triage a candidate source page before picking.",
    inputSchema: probePageSchema,
    async handler(args) {
      const r = await probePage(args.url, { respectRobots: args.respectRobots });
      return renderJson(r);
    },
  },
  {
    name: "compare_phashes",
    description:
      "Download two image URLs, compute structured perceptual hashes for each (DCT pHash via sharp when available, aHash fallback otherwise), and return per-image metadata plus the Hamming distance. `isMatch` is true when distance ≤ 6 (near-duplicate). Use to rank candidates by perceptual stability, choose between fast (aHash) vs accurate (DCT) deduplication, and build confidence-aware deduplication pipelines.",
    inputSchema: comparePhashesSchema,
    async handler(args) {
      const [dlA, dlB] = await Promise.all([
        downloadImage(args.urlA),
        downloadImage(args.urlB),
      ]);
      const [hashA, hashB] = await Promise.all([
        perceptualHashStructured(dlA.bytes),
        perceptualHashStructured(dlB.bytes),
      ]);
      const hamming = hammingDistance(hashA.hash, hashB.hash);
      return renderJson({
        candidates: [
          { url: args.urlA, phash: hashA.hash, algorithm: hashA.algorithm, confidence: hashA.confidence },
          { url: args.urlB, phash: hashB.hash, algorithm: hashB.algorithm, confidence: hashB.confidence },
        ],
        hamming,
        isMatch: hamming <= 6,
      });
    },
  },
  {
    name: "batch_find_similar",
    description:
      "Reverse-image-search multiple public image URLs in a single call, across one or more providers (brave, serpapi). Returns per-URL candidate lists with heuristic licenses, deduplicated across providers. Federation-level rate-limit state is checked per-provider per-URL; saturated providers are skipped with a warning rather than blocking the batch. Use when an agent needs to discover similar content for many images at once.",
    inputSchema: batchFindSimilarSchema,
    async handler(args) {
      const out = await batchFindSimilar(
        { urls: args.urls, providers: args.providers, limit: args.limit },
        {},
      );
      return renderJson(out);
    },
  },
  {
    name: "get_federation_diagnostics",
    description:
      "Returns real-time aggregated provider telemetry over a sliding 5-minute window. Shows per-provider avg latency, result counts, error rates, last-success timestamp, and rate-limit bucket state (saturated / nextTokenAt). Use to detect slow/failing providers, spot rate-limit saturation, and optimize provider selection mid-run. windowMs defaults to 5 minutes (300000).",
    inputSchema: z.object({
      windowMs: z
        .number()
        .int()
        .min(1000)
        .max(3_600_000)
        .optional()
        .describe("Sliding window size in ms (default 300000 = 5 minutes)"),
    }),
    async handler(args) {
      const diag = getFederationDiagnostics(args.windowMs);
      return renderJson(diag);
    },
  },
  {
    name: "inspect_cache",
    description:
      "Return cache statistics (total entries, bytes, content-type breakdown, oldest/newest sha) plus the most recent cache entries. Use to debug cache state, understand what is cached locally, and confirm that prior downloads are available for replay without network calls.",
    inputSchema: z.object({
      cacheDir: z.string().optional().describe("Override the default ~/.webfetch/cache directory"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(20)
        .describe("Number of recent entries to include in the listing (default 20)"),
    }),
    async handler(args) {
      const [stats, entries] = await Promise.all([
        getCacheStats(args.cacheDir),
        listCacheEntries(args.cacheDir, args.limit ?? 20, 0),
      ]);
      return renderJson({ stats, recentEntries: entries });
    },
  },
  {
    name: "export_cache_for_replay",
    description:
      "Export cached images as a tar archive suitable for CI test fixtures and local-first development. Optionally filter by mimeType prefix (e.g. 'image/jpeg') or ageMs (only include entries younger than this many ms). The tarball can be imported later with importCache / POST /v1/cache/import to restore a deterministic cache state without network calls.",
    inputSchema: z.object({
      cacheDir: z.string().optional().describe("Override the default ~/.webfetch/cache directory"),
      outputPath: z
        .string()
        .optional()
        .describe("Destination path for the .tar file (default: <cacheDir>/cache-export-<ts>.tar)"),
      mimeType: z
        .string()
        .optional()
        .describe("Only export entries whose sniffed MIME type starts with this string"),
      ageMs: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Only export entries modified within the last ageMs milliseconds"),
    }),
    async handler(args) {
      const filter =
        args.mimeType !== undefined || args.ageMs !== undefined
          ? { mimeType: args.mimeType, ageMs: args.ageMs }
          : undefined;
      const result = await exportCache(args.cacheDir, args.outputPath, filter);
      return renderJson(result);
    },
  },
  {
    name: "compare_candidates",
    description:
      "Analyse a SearchResultBundle for cross-provider duplicates. Runs two detection passes: (1) URL-level — normalised URLs that appear from multiple providers form a 'url' group (confidence 1.0); (2) pHash-level — candidates whose perceptual hashes are within a Hamming distance threshold form 'phash' groups. Returns a structured ProviderDedupeReport: { duplicateGroups: [{members, reason, confidence}], merged }. Use this after search_images or search_artist_images to understand which providers returned the same image, to tune federation provider selection, and to inform cache strategy. hammingThreshold defaults to 6.",
    inputSchema: compareCandidatesSchema,
    async handler(args) {
      const bundle = {
        candidates: args.candidates,
        providerReports: args.providerReports ?? [],
        warnings: args.warnings ?? [],
      };
      const report = compareCandidates(bundle, {
        hammingThreshold: args.hammingThreshold,
      });

      // Build a human-readable digest.
      const groupLines = report.duplicateGroups.map((g, i) => {
        const providerList = g.members.map((m) => m.provider).join(", ");
        return `  Group ${i + 1} [${g.reason}, confidence=${g.confidence.toFixed(2)}]: ${g.members.length} members across providers: ${providerList}`;
      });
      const digest =
        report.duplicateGroups.length === 0
          ? "No duplicates detected across providers."
          : [
              `${report.duplicateGroups.length} duplicate group(s) found. ${bundle.candidates.length - report.merged.length} candidate(s) collapsed.`,
              ...groupLines,
            ].join("\n");

      return {
        content: [{ type: "text", text: digest }],
        structuredContent: report,
      };
    },
  },
];
