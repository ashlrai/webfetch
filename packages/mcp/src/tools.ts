/**
 * MCP tool definitions + handlers.
 *
 * Descriptions here are PROMPT SURFACE for agents. Craft them so an LLM
 * reading them picks the right tool and passes the right args.
 */

import {
  batchClusterByPhash,
  batchFindSimilar,
  compareCandidates,
  computeFederationFallback,
  computeProviderRecommendations,
  downloadImage,
  exportCache,
  fetchWithLicense,
  findSimilar,
  findSimilarBatch,
  getCacheStats,
  getFederationDiagnostics,
  getFederationHealthReport,
  hammingDistance,
  listCacheEntries,
  perceptualHashStructured,
  probePage,
  reconcileLicenses,
  reconcileLicensesAll,
  refineSearchResults,
  searchAlbumCover,
  searchArtistImages,
  searchImages,
  auditImageMetadata,
  generateDeduplicationReport,
  exportClusteringMetrics,
} from "webfetch-core";
import { z } from "zod";
import { renderJson, renderSearch } from "./render.ts";
import {
  auditLicenseConsensusSchema,
  batchClusterByPhashSchema,
  batchFindSimilarSchema,
  batchFindSimilarWithDistancesSchema,
  compareCandidatesSchema,
  comparePhashesSchema,
  computeFederationFallbackSchema,
  downloadImageSchema,
  extractImageMetadataAuditSchema,
  fetchWithLicenseSchema,
  findSimilarSchema,
  probePageSchema,
  providerRecommendationsSchema,
  refineSearchResultsSchema,
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
    name: "get_federation_health_report",
    description:
      "Returns a comprehensive federation health report combining real-time diagnostics with actionable provider recommendations over a sliding 5-minute window. " +
      "Includes: per-provider health status (healthy/degraded/saturated/unavailable), ranked provider list by composite score (latency_p50, error_rate, throughput), " +
      "suggested fallbackChain ordered by reliability (excludes saturated/unavailable providers), estimated recovery time from rate-limit buckets, " +
      "and the full diagnostics dashboard. Use this instead of get_federation_diagnostics when you need both health analysis and routing recommendations in a single call.",
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
      const report = getFederationHealthReport(args.windowMs);
      return renderJson(report);
    },
  },
  {
    name: "provider_recommendations",
    description:
      "Returns actionable per-provider recommendations with four enhanced diagnostics surfaces: " +
      "(1) Comparative performance ranking — narrative insights per provider (e.g. 'Unsplash consistently fastest at p50=120ms; Bing has 15% error rate'). " +
      "(2) License-coverage heatmap — which providers return the most OPEN vs UNKNOWN results, ranked by openness, based on each provider's known license profile. " +
      "(3) Per-query-category provider selection advice — e.g. for 'portraits' prioritize wikimedia + spotify; for 'album_art' use musicbrainz-caa + itunes. " +
      "(4) Cost-benefit analysis — free vs paid tiers, license profiles, gap-coverage verdicts with current health context. " +
      "Also includes ranked provider list by composite score and suggested fallback chain. " +
      "Use this tool when deciding which providers to use for a specific query type, optimizing federation routing, or diagnosing license coverage gaps.",
    inputSchema: providerRecommendationsSchema,
    async handler(args) {
      const recs = computeProviderRecommendations(args.windowMs);
      // Build a human-readable digest
      const lines: string[] = [];

      if (recs.performanceInsights.length > 0) {
        lines.push("Performance insights:");
        for (const p of recs.performanceInsights) {
          lines.push(`  ${p.summary}`);
        }
      } else {
        lines.push("Performance insights: no provider data in window yet.");
      }

      if (recs.licenseCoverageHeatmap.mostOpen) {
        lines.push(`License coverage: most open = ${recs.licenseCoverageHeatmap.mostOpen}` +
          (recs.licenseCoverageHeatmap.mostUnknown
            ? `; most UNKNOWN = ${recs.licenseCoverageHeatmap.mostUnknown}`
            : ""));
      }

      if (recs.suggestedFallbackChain.length > 0) {
        lines.push(`Suggested fallback chain: ${recs.suggestedFallbackChain.join(" → ")}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: recs,
      };
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
    name: "refine_search_results",
    description:
      "Post-process a SearchResultBundle to identify low-confidence candidates and emit a RefinementPlan. " +
      "For each low-confidence or UNKNOWN-license candidate the tool assigns one of three actions: " +
      "'probe-page' (fetch sourcePageUrl for richer metadata), 'upgrade-provider' (retry with a provider " +
      "that returns structured license data), or 'fallback-to-open-only' (restrict licensePolicy to eliminate " +
      "UNKNOWN results). Also returns an ordered upgradePath of licensePolicy changes ranked by expected " +
      "confidence gain, and lists providers observed to have high confidence for similar queries via " +
      "federation diagnostics. Pass candidateIndex to additionally probe that specific candidate's " +
      "sourcePageUrl for fresh metadata.",
    inputSchema: refineSearchResultsSchema,
    async handler(args) {
      const bundle = {
        candidates: args.candidates as any[],
        providerReports: args.providerReports ?? [],
        warnings: args.warnings ?? [],
      };

      // Gather high-confidence providers from federation diagnostics.
      const diag = getFederationDiagnostics();
      const highConfidenceProviders = diag.providerStats
        .filter((s) => s.errorRate < 0.2 && s.resultCount > 0)
        .sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)
        .map((s) => s.id);

      // Build the base refinement plan.
      const plan = refineSearchResults(bundle as any, {
        confidenceThreshold: args.confidenceThreshold,
        highConfidenceProviders,
      });

      // Optionally probe a specific candidate's sourcePageUrl.
      let probeResult: unknown = null;
      if (args.candidateIndex !== undefined) {
        const cand = bundle.candidates[args.candidateIndex];
        if (cand?.sourcePageUrl) {
          try {
            const fetched = await fetchWithLicense(cand.sourcePageUrl, { probe: false });
            probeResult = {
              sourcePageUrl: cand.sourcePageUrl,
              detectedLicense: fetched.license,
              detectedConfidence: fetched.confidence,
              author: fetched.author,
              attributionLine: fetched.attributionLine,
            };
          } catch (err) {
            probeResult = {
              sourcePageUrl: cand.sourcePageUrl,
              error: String(err),
            };
          }
        } else {
          probeResult = {
            note: `Candidate at index ${args.candidateIndex} has no sourcePageUrl to probe`,
          };
        }
      }

      const lines: string[] = [
        `Refinement plan: ${plan.summary.lowConfidenceCount}/${plan.summary.totalCandidates} low-confidence candidate(s) (gapRatio=${plan.summary.gapRatio.toFixed(2)}, unknownLicense=${plan.summary.unknownLicenseCount}).`,
      ];
      if (plan.confidenceGaps.length > 0) {
        lines.push("Gaps:");
        plan.confidenceGaps.slice(0, 5).forEach((g) => {
          lines.push(
            `  [${g.candidateIndex}] ${g.suggestedAction} — ${g.reason}`,
          );
        });
        if (plan.confidenceGaps.length > 5) {
          lines.push(`  ... and ${plan.confidenceGaps.length - 5} more`);
        }
      }
      const topUpgrade = plan.upgradePath[0];
      if (topUpgrade) {
        lines.push(
          `Top upgrade: licensePolicy="${topUpgrade.targetLicensePolicy}" (+${(topUpgrade.expectedConfidenceGain * 100).toFixed(0)}% confidence gain). ${topUpgrade.rationale}`,
        );
      }
      if (highConfidenceProviders.length > 0) {
        lines.push(`High-confidence providers: ${highConfidenceProviders.slice(0, 5).join(", ")}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { plan, probeResult },
      };
    },
  },
  {
    name: "batch_find_similar_with_distances",
    description:
      "Batch reverse-image search: given multiple reference image URLs, find visually similar images across providers (brave, serpapi) and return results grouped by perceptual-distance clusters. " +
      "Clusters: 'exact' (Hamming 0-3), 'near-duplicate' (4-8), 'similar' (9-15), 'loosely-related' (16-25). " +
      "Within each cluster, candidates are ranked license-first (open > platform > editorial > unknown), then by pHash confidence, then provider quality. " +
      "Returns per-reference pHash metadata, clusters with ranked candidates, aggregate statistics (band breakdown, median/p90 Hamming distances), and non-fatal warnings. " +
      "Use for: finding other uses of a product photo, content moderation, brand monitoring, or any workflow needing perceptual grouping across multiple reference images. " +
      "Set dedupeAcrossReferences: true to collapse candidates that match multiple references into the closest match only.",
    inputSchema: batchFindSimilarWithDistancesSchema,
    async handler(args) {
      const refs = (args.references as Array<{ url?: string }>).map((r) => ({
        url: r.url,
      }));
      const out = await findSimilarBatch(refs, {
        providers: args.providers,
        dedupeAcrossReferences: args.dedupeAcrossReferences,
        maxCandidatesPerReference: args.maxCandidatesPerReference,
      });

      const lines: string[] = [];
      lines.push(
        `Batch result: ${out.statistics.referenceCount} reference(s), ` +
        `${out.statistics.uniqueCandidates} unique candidates across ${out.statistics.clusterCount} cluster(s).`,
      );
      for (const cluster of out.clusters) {
        lines.push(`  ${cluster.similarity}: ${cluster.count} candidate(s)`);
      }
      if (out.statistics.medianHammingDistance !== null) {
        lines.push(
          `  Hamming — median: ${out.statistics.medianHammingDistance}, p90: ${out.statistics.p90HammingDistance}`,
        );
      }
      if (out.warnings.length > 0) {
        lines.push(`Warnings: ${out.warnings.join("; ")}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: out,
      };
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
  {
    name: "compute_federation_fallback",
    description:
      "Given a FederationRepairPlan (from a prior searchImages call with repairPlan:true) and the detected failure patterns, compute an ordered list of concrete fallback provider substitutions that match the original license policy. " +
      "Patterns handled: all-unknown-license (switches to providers with structured license metadata, filtered by open-only vs safe-only policy), " +
      "auth-missing (auto-disables paid/credentialed providers, suggests free alternatives), " +
      "all-timeout (adds managed-browser opt-in and lower-latency providers), " +
      "partial-failure (promotes healthy providers, adds backup providers for the failed subset), " +
      "low-confidence (prioritises authoritative open-license providers with structured metadata). " +
      "Returns: fallbackProviders (ordered best-first), rationale (explains each substitution), estimatedLiftPercent (0..1 — expected fraction of original failure resolved), costBenefitRatio (higher = more worth it; free providers >> 1). " +
      "Use this after detecting a non-healthy repairPlan to automatically recover from federation failures without manual intervention.",
    inputSchema: computeFederationFallbackSchema,
    async handler(args) {
      const result = computeFederationFallback({
        repairPlan: args.repairPlan as any,
        originalLicensePolicy: args.originalLicensePolicy,
        query: args.query,
        detectedPatterns: new Set(args.detectedPatterns as any[]),
        providerReports: args.providerReports as any[] | undefined,
      });

      const lines: string[] = [];
      if (result.fallbackProviders.length === 0) {
        lines.push("No actionable fallback providers found for the detected patterns under the active license policy.");
      } else {
        lines.push(`Fallback providers (${result.fallbackProviders.length}): ${result.fallbackProviders.join(", ")}`);
        lines.push(`Estimated lift: ${(result.estimatedLiftPercent * 100).toFixed(0)}%`);
        lines.push(`Cost/benefit ratio: ${result.costBenefitRatio.toFixed(2)} (≥1.0 is worthwhile)`);
        lines.push(`Rationale: ${result.rationale}`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: result,
      };
    },
  },
  {
    name: "batch_cluster_by_phash",
    description:
      "Cluster a set of ImageCandidates by perceptual similarity using Hamming distance on their pHashes. " +
      "Candidates are grouped using single-linkage clustering (connect when Hamming distance ≤ hammingThreshold). " +
      "Within each cluster, the best candidate is promoted to 'representative' — ranked by: license openness (CC0 > CC_BY > … > UNKNOWN), " +
      "then phash confidence, then image resolution, then provider priority (wikimedia > openverse > unsplash > …). " +
      "Returns: clusters (sorted largest-first then by top score), clusterMetrics (avgClusterSize, lonelyCount, discardedCount), " +
      "and dedupeRate (fraction of candidates that share a cluster with another). " +
      "Candidates with phashResult.confidence < 0.3 or no pHash are discarded and counted in discardedCount. " +
      "Set confidenceDecay=true to demote stale cached results: requires raw._cachedAt (ISO string or epoch-ms); applies 0.02/hour decay. " +
      "Use this tool to: deduplicate visually-identical results across providers, expose deduplication rate in diagnostics, " +
      "pick the best copy of an image, or reduce redundant downloads before calling download_image. " +
      "hammingThreshold default 10 (near-duplicate); use 0 for exact-only, 20+ for loose visual similarity.",
    inputSchema: batchClusterByPhashSchema,
    async handler(args) {
      const result = await batchClusterByPhash(args.candidates as any[], {
        hammingThreshold: args.hammingThreshold,
        minClusterSize: args.minClusterSize,
        confidenceDecay: args.confidenceDecay,
      });

      const lines: string[] = [
        `Clustered ${args.candidates.length} candidate(s) → ${result.clusters.length} cluster(s). ` +
        `dedupeRate=${(result.dedupeRate * 100).toFixed(1)}%, ` +
        `discarded=${result.clusterMetrics.discardedCount}, ` +
        `singletons=${result.clusterMetrics.lonelyCount}, ` +
        `avgClusterSize=${result.clusterMetrics.avgClusterSize.toFixed(2)}.`,
      ];

      for (const cluster of result.clusters.slice(0, 5)) {
        const rep = cluster.representative;
        lines.push(
          `  [size=${cluster.size}, dist=${cluster.avgIntraDistance.toFixed(1)}] ` +
          `${rep.url} (${rep.license}, src=${rep.source})` +
          (cluster.alternatives.length > 0
            ? ` + ${cluster.alternatives.length} alternative(s)`
            : ""),
        );
      }
      if (result.clusters.length > 5) {
        lines.push(`  … and ${result.clusters.length - 5} more cluster(s)`);
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: result,
      };
    },
  },
  {
    name: "extract_image_metadata_audit",
    description:
      "Extract embedded metadata (EXIF artist/copyright, XMP dc:creator/dc:rights/cc:license/xmpRights:UsageTerms, IPTC record 2) from downloaded image bytes, " +
      "cross-check against provider-supplied candidate metadata, and return a full ImageMetadataAuditResult with per-field confidence scores and a conflict resolution log. " +
      "Input: base64-encoded image bytes (obtain via download_image) + the ImageCandidate used to find the image. " +
      "Conflict detection: compares embedded vs provider values using Levenshtein similarity. " +
      "When similarity > 0.8 (near-agreement), fields are merged and confidence is boosted to 0.95. " +
      "When below threshold, the resolveConflicts strategy applies: " +
      "'conservative' (default) prefers the higher-confidence source (XMP > IPTC > EXIF > provider baseline 0.7); " +
      "'provider-first' always trusts the provider; 'embedded-first' always trusts the image file. " +
      "Returns: embeddedMetadata (raw extracted fields), providerMetadata (from candidate), mergedResult (reconciled best view with confidence), " +
      "conflicts (per-field disagreements with similarity scores and resolution), auditTrail (ordered decision log with timestamps and confidence). " +
      "Use to: verify provider attribution against the actual image file, catch misattribution, boost confidence for well-annotated images, " +
      "detect license inconsistencies before publishing, or enrich metadata for open-license assets.",
    inputSchema: extractImageMetadataAuditSchema,
    async handler(args) {
      // Decode base64 → Uint8Array
      let bytes: Uint8Array;
      try {
        const bin = atob(args.imageBase64);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } catch {
        return {
          content: [{ type: "text", text: "Error: imageBase64 is not valid base64." }],
          structuredContent: { error: "invalid-base64" },
          isError: true,
        };
      }

      const result = await auditImageMetadata({
        downloadedBytes: bytes,
        candidate: args.candidate as any,
        resolveConflicts: args.resolveConflicts as any,
      });

      const lines: string[] = [];
      lines.push(
        `Audit complete: ${result.conflicts.length} conflict(s), ` +
        `artist confidence=${result.mergedResult.confidence.artist.toFixed(2)}, ` +
        `copyright confidence=${result.mergedResult.confidence.copyright.toFixed(2)}, ` +
        `license confidence=${result.mergedResult.confidence.license.toFixed(2)}.`,
      );
      lines.push(`Embedded license: ${result.embeddedMetadata.license} | Provider license: ${result.providerMetadata.license} | Merged: ${result.mergedResult.license}`);
      if (result.mergedResult.artist) {
        lines.push(`Artist: ${result.mergedResult.artist}`);
      }
      if (result.conflicts.length > 0) {
        lines.push("Conflicts:");
        for (const c of result.conflicts) {
          const simStr = c.similarity !== undefined ? ` (similarity=${c.similarity.toFixed(3)})` : "";
          lines.push(`  [${c.field}] embedded="${c.embedded}" vs provider="${c.provider}"${simStr} → resolved as ${c.resolution}`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: result,
      };
    },
  },
  {
    name: "audit_license_consensus",
    description:
      "Reconcile licenses across multiple ImageCandidate objects that may represent the same image " +
      "from different providers (e.g. wikimedia=CC_BY_SA, unsplash=UNSPLASH_LICENSE). " +
      "Candidates are grouped automatically by pHash proximity (or URL fallback). " +
      "For each group the tool: (1) computes pairwise Levenshtein similarity on license strings, " +
      "(2) determines consensus (similarity > 0.85) or flags a conflict, " +
      "(3) emits a per-provider audit trail with reasoning sourced from licenseAuditTrail when available, " +
      "(4) returns a composite confidence score that decays with disagreement and low per-candidate confidence, " +
      "(5) emits a human-readable recommendation for operators and legal review pipelines. " +
      "Set allGroups:true to return reconciliation for every detected pHash/URL cluster independently. " +
      "Use after search_images / compare_candidates to understand WHY providers disagree on license, " +
      "detect licensing ambiguity before publishing, and feed into legal review pipelines.",
    inputSchema: auditLicenseConsensusSchema,
    async handler(args) {
      const candidates = args.candidates as any[];

      const lines: string[] = [];

      if (args.allGroups) {
        const results = reconcileLicensesAll(candidates);
        lines.push(`Reconciled ${results.length} group(s) from ${candidates.length} candidate(s).`);
        for (let i = 0; i < results.length; i++) {
          const r = results[i]!;
          lines.push(
            `  Group ${i + 1}: consensus="${r.consensusLicense}", ` +
            `confidence=${(r.confidence * 100).toFixed(0)}%, ` +
            `conflicts=${r.conflictCount}/${r.conflictLog.length} provider(s).`,
          );
          if (r.conflictCount > 0) {
            for (const entry of r.conflictLog.filter((e) => e.assertedLicense !== r.consensusLicense)) {
              lines.push(`    CONFLICT — provider="${entry.provider}" asserted "${entry.assertedLicense}"`);
            }
          }
        }
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: { groups: results },
        };
      }

      const result = reconcileLicenses(candidates);
      lines.push(
        `License consensus: "${result.consensusLicense}" ` +
        `(confidence=${(result.confidence * 100).toFixed(0)}%, ` +
        `conflicts=${result.conflictCount}/${result.conflictLog.length}).`,
      );
      lines.push(result.recommendation);
      if (result.conflictCount > 0) {
        lines.push("Conflict log:");
        for (const entry of result.conflictLog) {
          const marker = entry.assertedLicense !== result.consensusLicense ? "CONFLICT" : "agree";
          lines.push(
            `  [${marker}] provider="${entry.provider}" license="${entry.assertedLicense}" ` +
            `conf=${(entry.licenseConfidence * 100).toFixed(0)}% — ${entry.reasoning}`,
          );
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: result,
      };
    },
  },
  {
    name: "analyze_deduplication_quality",
    description:
      "Analyze deduplication quality for a set of ImageCandidates by orchestrating semantic + pHash clustering and surfacing actionable metrics. " +
      "Returns per-cluster false-positive risk (same hash, different visual — threshold too permissive), " +
      "false-negative risk (same visual split across clusters — threshold too strict due to compression/alt-source), " +
      "composite confidence (pHash similarity + metadata similarity), provider diversity, and a recommended threshold. " +
      "Also generates a flat export-ready metrics table. " +
      "phashThreshold: maximum Hamming distance (default 8) to merge two candidates. " +
      "semanticWeight: 0..1 weight for title/author metadata similarity vs pHash (default 0.3). " +
      "confidenceFloor: clusters below this composite confidence are flagged for review (default 0.5). " +
      "Use after search_images / compare_candidates to decide whether to tighten or loosen the dedup threshold, " +
      "identify high-risk cluster merges before publishing, and export metrics for ML threshold tuning.",
    inputSchema: z.object({
      candidates: z
        .array(
          z.object({
            url: z.string().url(),
            source: z.string(),
            license: z.string(),
            phash: z.string().optional(),
            phashResult: z
              .object({
                hash: z.string(),
                algorithm: z.enum(["dct-phash", "ahash-fallback"]),
                confidence: z.number().min(0).max(1),
              })
              .optional(),
            phashAlgorithm: z.enum(["dct-phash", "ahash-fallback"]).optional(),
            confidence: z.number().min(0).max(1).optional(),
            score: z.number().optional(),
            title: z.string().optional(),
            author: z.string().optional(),
            width: z.number().int().optional(),
            height: z.number().int().optional(),
          }),
        )
        .min(1)
        .max(500)
        .describe("Array of ImageCandidate objects to analyze — typically from search_images or compare_candidates"),
      phashThreshold: z
        .number()
        .int()
        .min(1)
        .max(32)
        .optional()
        .describe("Maximum Hamming distance to merge two candidates (default 8). Lower = stricter dedup."),
      semanticWeight: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Weight for title/author metadata similarity vs pHash similarity in composite confidence (default 0.3)."),
      confidenceFloor: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Minimum composite confidence for a cluster to be accepted without review (default 0.5)."),
      exportFormat: z
        .enum(["json", "csv"])
        .optional()
        .describe("Format for the metrics export table: 'json' (default) or 'csv'."),
    }),
    async handler(args) {
      const report = generateDeduplicationReport(args.candidates as any[], {
        phashThreshold: args.phashThreshold,
        semanticWeight: args.semanticWeight,
        confidenceFloor: args.confidenceFloor,
      });

      const metricsExport = exportClusteringMetrics(
        report,
        (args.exportFormat as "json" | "csv" | undefined) ?? "json",
      );

      const lines: string[] = [];
      lines.push(
        `Deduplication quality: ${report.totalCandidates} candidates → ${report.totalClusters} clusters ` +
        `(${report.multiCandidateClusters.length} multi-candidate, ${report.singletons.length} singletons). ` +
        `dedupeRate=${(report.dedupeRate * 100).toFixed(1)}%`,
      );
      lines.push(
        `Overall risk — FP: ${report.falsePositiveRisk}, FN: ${report.falseNegativeRisk}. ` +
        `Recommended threshold: ${report.recommendedThreshold} (current: ${report.options.phashThreshold}).`,
      );
      if (report.multiCandidateClusters.length > 0) {
        lines.push("Top clusters:");
        for (const c of report.multiCandidateClusters.slice(0, 5)) {
          lines.push(
            `  [cluster ${c.clusterId}] size=${c.size} providers=${c.providerDiversity} ` +
            `conf=${c.compositeConfidence.toFixed(2)} FP=${c.falsePositiveRisk} FN=${c.falseNegativeRisk} → ${c.recommendation}`,
          );
        }
        if (report.multiCandidateClusters.length > 5) {
          lines.push(`  … and ${report.multiCandidateClusters.length - 5} more cluster(s)`);
        }
      }
      lines.push(`Metrics export: ${metricsExport.rowCount} row(s) in ${metricsExport.format} format.`);

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { report, metricsExport },
      };
    },
  },
]; // end TOOLS
