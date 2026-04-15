/**
 * MCP tool definitions + handlers.
 *
 * Descriptions here are PROMPT SURFACE for agents. Craft them so an LLM
 * reading them picks the right tool and passes the right args.
 */

import {
  downloadImage,
  fetchWithLicense,
  findSimilar,
  probePage,
  searchAlbumCover,
  searchArtistImages,
  searchImages,
} from "@webfetch/core";
import { z } from "zod";
import { renderJson, renderSearch } from "./render.ts";
import {
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
      "Federated image search across license-aware providers (Wikimedia Commons, Openverse, Unsplash, Pexels, Pixabay, iTunes, MusicBrainz CAA, Spotify, Brave). Returns ranked candidates with license + attribution. Does NOT auto-download — call `download_image` after. Use this instead of manually browsing Google Images. By default uses safe-only license policy (CC0/CC-BY/CC-BY-SA/editorial/press). Pass providers: ['serpapi'] or ['browser'] only if direct-source APIs fail.",
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
];
