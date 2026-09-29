/**
 * Multi-Provider Batch Reverse-Image Search with Aggregated Confidence Scores.
 *
 * Extends the existing `batchFindSimilarWithFederation` contract to add:
 *   - Support for 10–100+ images in a single call (batch cap: 500).
 *   - Per-reference provider parallelisation with early-exit on a configurable
 *     confidence threshold (default: 0.85).
 *   - Aggregated result ranking: similarity score × provider rank × license
 *     confidence, yielding a single `aggregatedScore` per candidate.
 *   - Cross-provider deduplication via pHash clustering (reuses
 *     `clusterCandidatesBySemantic` from semantic-dedupe.ts).
 *   - Detailed telemetry: per-provider search latency, result spread, and
 *     confidence distribution histograms for the entire batch.
 *
 * Primary entry-point: `batchReverseImageSearch`.
 */

import { dedupeByUrl } from "./dedupe.ts";
import { findSimilar } from "./find-similar.ts";
import { LICENSE_RANK } from "./license.ts";
import { clusterCandidatesBySemantic } from "./semantic-dedupe.ts";
import type { ImageCandidate, ProviderId, ProviderReport, SearchOptions } from "./types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single image reference. Provide either `url`, `bytes`, or both. */
export interface ReverseImageRef {
  url?: string;
  bytes?: Uint8Array;
}

/** A ranked candidate enriched with the composite aggregated score. */
export interface RankedCandidate extends ImageCandidate {
  /** similarityScore × providerRankFactor × licenseConfidence, range 0..1. */
  aggregatedScore: number;
  /** Similarity component (0..1) from pHash/provider confidence (0.5 baseline). */
  similarityScore: number;
  /** Provider rank factor (0..1) — open providers score higher. */
  providerRankFactor: number;
  /** License confidence component (0..1) from confidence or LICENSE_RANK. */
  licenseConfidence: number;
}

/** Per-provider telemetry collected during a run. */
export interface ProviderBatchTelemetry {
  provider: ProviderId;
  attempts: number;
  successes: number;
  rateLimitSkips: number;
  failures: number;
  totalCandidates: number;
  latenciesMs: number[];
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  meanLatencyMs: number | null;
  medianLatencyMs: number | null;
}

/** Confidence distribution histogram over [0,1] values (5 bands). */
export interface ConfidenceHistogram {
  band0_20: number;
  band20_40: number;
  band40_60: number;
  band60_80: number;
  band80_100: number;
  total: number;
  mean: number | null;
}

/** Batch-level telemetry. */
export interface BatchReverseTelemetry {
  batchId: string;
  totalImages: number;
  processedImages: number;
  timedOutImages: number;
  totalWallTimeMs: number;
  providerTelemetry: ProviderBatchTelemetry[];
  aggregatedScoreHistogram: ConfidenceHistogram;
  licenseConfidenceHistogram: ConfidenceHistogram;
  resultSpread: {
    avgCandidatesPerImage: number;
    stdDevCandidatesPerImage: number;
    minCandidatesPerImage: number;
    maxCandidatesPerImage: number;
  };
}

/** Per-image result. */
export interface ReverseImageResult {
  imageIndex: number;
  url?: string;
  candidates: RankedCandidate[];
  providerReports: ProviderReport[];
  warnings: string[];
  timedOut: boolean;
  earlyExit: boolean;
}

/** Full output of `batchReverseImageSearch`. */
export interface BatchReverseImageOutput {
  batchId: string;
  results: ReverseImageResult[];
  telemetry: BatchReverseTelemetry;
}

/** Options for `batchReverseImageSearch`. */
export interface BatchReverseSearchOptions extends SearchOptions {
  perImageTimeoutMs?: number;
  limitPerImage?: number;
  confidenceThreshold?: number;
  dedupeSameImageInBatch?: boolean;
  phashDedupThreshold?: number;
}

// ---------------------------------------------------------------------------
// Provider rank factors — open/public-domain providers rank highest.
// ---------------------------------------------------------------------------

const PROVIDER_RANK_FACTOR: Partial<Record<ProviderId, number>> = {
  wikimedia: 1.0,
  openverse: 1.0,
  "internet-archive": 0.95,
  smithsonian: 0.95,
  nasa: 0.95,
  "met-museum": 0.95,
  europeana: 0.9,
  "europeana-archival": 0.9,
  "library-of-congress": 0.9,
  "wellcome-collection": 0.9,
  flickr: 0.8,
  unsplash: 0.75,
  pexels: 0.75,
  pixabay: 0.75,
  rawpixel: 0.7,
  burst: 0.7,
  "musicbrainz-caa": 0.7,
  itunes: 0.6,
  spotify: 0.6,
  "youtube-thumb": 0.5,
  brave: 0.3,
  bing: 0.3,
  serpapi: 0.15,
  browser: 0.1,
  "managed-browser": 0.1,
};

function providerRankFactor(source: string): number {
  return PROVIDER_RANK_FACTOR[source as ProviderId] ?? 0.4;
}

/** License confidence from the candidate's own field or its LICENSE_RANK. */
function licenseConfidence(c: ImageCandidate): number {
  if (typeof c.confidence === "number") return Math.max(0, Math.min(1, c.confidence));
  const rank = LICENSE_RANK[c.license] ?? 99;
  return Math.max(0, Math.min(1, 1 / rank));
}

/** Similarity from pHash algorithm confidence, else provider confidence, else 0.5. */
function similarityScore(c: ImageCandidate): number {
  if (c.phashResult) return c.phashResult.confidence;
  if (typeof c.confidence === "number") return Math.max(0, Math.min(1, c.confidence));
  return 0.5;
}

function rankCandidate(c: ImageCandidate): RankedCandidate {
  const sim = similarityScore(c);
  const prf = providerRankFactor(c.source);
  const lic = licenseConfidence(c);
  return {
    ...c,
    similarityScore: sim,
    providerRankFactor: prf,
    licenseConfidence: lic,
    aggregatedScore: sim * prf * lic,
  };
}

function makeHistogram(values: number[]): ConfidenceHistogram {
  const h: ConfidenceHistogram = {
    band0_20: 0,
    band20_40: 0,
    band40_60: 0,
    band60_80: 0,
    band80_100: 0,
    total: values.length,
    mean: values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : null,
  };
  for (const v of values) {
    if (v < 0.2) h.band0_20++;
    else if (v < 0.4) h.band20_40++;
    else if (v < 0.6) h.band40_60++;
    else if (v < 0.8) h.band60_80++;
    else h.band80_100++;
  }
  return h;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const BATCH_CAP = 500;

/**
 * Multi-provider batch reverse-image search for 10–500 images. All images run
 * concurrently; each gets its own AbortController tied to `perImageTimeoutMs`.
 * Candidates are ranked `similarityScore × providerRankFactor × licenseConfidence`,
 * cross-provider duplicates are collapsed via `clusterCandidatesBySemantic`, and
 * detailed telemetry (per-provider latency, result spread, histograms) is emitted.
 */
export async function batchReverseImageSearch(
  refs: Array<ReverseImageRef>,
  opts: BatchReverseSearchOptions = {},
): Promise<BatchReverseImageOutput> {
  const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const batchStart = Date.now();

  const limitPerImage = opts.limitPerImage ?? 20;
  const confidenceThreshold = opts.confidenceThreshold ?? 0.85;
  const perImageTimeoutMs = opts.perImageTimeoutMs ?? opts.timeoutMs ?? 15_000;
  const phashThreshold = opts.phashDedupThreshold ?? 8;
  const providers: ProviderId[] = opts.providers ?? [];

  // Clamp to the batch cap.
  const clamped = refs.slice(0, BATCH_CAP);

  // Per-provider telemetry accumulators.
  const provAcc = new Map<
    ProviderId,
    {
      attempts: number;
      successes: number;
      rateLimitSkips: number;
      failures: number;
      totalCandidates: number;
      latencies: number[];
    }
  >();
  const ensureProv = (p: ProviderId) => {
    let a = provAcc.get(p);
    if (!a) {
      a = {
        attempts: 0,
        successes: 0,
        rateLimitSkips: 0,
        failures: 0,
        totalCandidates: 0,
        latencies: [],
      };
      provAcc.set(p, a);
    }
    return a;
  };

  // Optional same-image dedup: share results for identical URL inputs.
  const sharedCache = new Map<string, ReverseImageResult>();

  const perImage = async (
    ref: ReverseImageRef,
    imageIndex: number,
  ): Promise<ReverseImageResult> => {
    if (opts.dedupeSameImageInBatch && ref.url) {
      const cached = sharedCache.get(ref.url);
      if (cached) return { ...cached, imageIndex };
    }

    const warnings: string[] = [];
    const providerReports: ProviderReport[] = [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), perImageTimeoutMs);
    let timedOut = false;
    let earlyExit = false;
    const ranked: RankedCandidate[] = [];

    try {
      // Run each provider independently so a single failure never aborts siblings.
      for (const provider of providers) {
        if (controller.signal.aborted) {
          timedOut = true;
          break;
        }
        const acc = ensureProv(provider);
        acc.attempts++;
        const t0 = Date.now();
        try {
          const { candidates, warnings: w } = await findSimilar(
            { url: ref.url ?? "", bytes: ref.bytes },
            { ...opts, providers: [provider], signal: controller.signal },
          );
          const elapsed = Date.now() - t0;
          acc.latencies.push(elapsed);
          warnings.push(...w);
          if (w.some((m) => /saturated|rate-limit/i.test(m))) acc.rateLimitSkips++;
          if (candidates.length > 0) {
            acc.successes++;
            acc.totalCandidates += candidates.length;
            providerReports.push({ provider, ok: true, count: candidates.length, timeMs: elapsed });
            for (const cand of candidates) ranked.push(rankCandidate(cand));
          } else {
            providerReports.push({ provider, ok: true, count: 0, timeMs: elapsed });
          }

          // Early-exit: any candidate over the confidence threshold.
          if (ranked.some((r) => r.aggregatedScore >= confidenceThreshold)) {
            earlyExit = true;
            break;
          }
        } catch (err) {
          const elapsed = Date.now() - t0;
          acc.latencies.push(elapsed);
          if (controller.signal.aborted) {
            timedOut = true;
            providerReports.push({
              provider,
              ok: false,
              count: 0,
              timeMs: elapsed,
              error: "timeout",
              errorKind: "timeout",
            });
            break;
          }
          acc.failures++;
          providerReports.push({
            provider,
            ok: false,
            count: 0,
            timeMs: elapsed,
            error: err instanceof Error ? err.message : String(err),
            errorKind: "network",
          });
        }
      }
    } finally {
      clearTimeout(timer);
    }

    // Cross-provider dedup via semantic clustering, preserving the highest score.
    const deduped = dedupeByUrl(ranked) as RankedCandidate[];
    const { allRepresentatives } = clusterCandidatesBySemantic(deduped, {
      hammingThreshold: phashThreshold,
    });
    const repUrls = new Set(allRepresentatives.map((r) => r.url));
    const finalRanked = deduped
      .filter((c) => repUrls.has(c.url))
      .sort((a, b) => b.aggregatedScore - a.aggregatedScore)
      .slice(0, limitPerImage);

    const result: ReverseImageResult = {
      imageIndex,
      ...(ref.url !== undefined ? { url: ref.url } : {}),
      candidates: finalRanked,
      providerReports,
      warnings,
      timedOut,
      earlyExit,
    };

    if (opts.dedupeSameImageInBatch && ref.url) sharedCache.set(ref.url, result);
    return result;
  };

  const settled = await Promise.allSettled(clamped.map((ref, i) => perImage(ref, i)));
  const results: ReverseImageResult[] = settled.map((s, i) =>
    s.status === "fulfilled"
      ? s.value
      : {
          imageIndex: i,
          ...(clamped[i]!.url !== undefined ? { url: clamped[i]!.url } : {}),
          candidates: [],
          providerReports: [],
          warnings: [s.reason instanceof Error ? s.reason.message : String(s.reason)],
          timedOut: false,
          earlyExit: false,
        },
  );

  // ---- Telemetry ----------------------------------------------------------
  const providerTelemetry: ProviderBatchTelemetry[] = [...provAcc.entries()]
    .map(([provider, a]) => {
      const sorted = [...a.latencies].sort((x, y) => x - y);
      return {
        provider,
        attempts: a.attempts,
        successes: a.successes,
        rateLimitSkips: a.rateLimitSkips,
        failures: a.failures,
        totalCandidates: a.totalCandidates,
        latenciesMs: a.latencies,
        minLatencyMs: sorted.length > 0 ? sorted[0]! : null,
        maxLatencyMs: sorted.length > 0 ? sorted[sorted.length - 1]! : null,
        meanLatencyMs: sorted.length > 0 ? sorted.reduce((s, v) => s + v, 0) / sorted.length : null,
        medianLatencyMs: median(sorted),
      };
    })
    .sort((x, y) => y.totalCandidates - x.totalCandidates);

  const allCandidates = results.flatMap((r) => r.candidates);
  const aggregatedScoreHistogram = makeHistogram(allCandidates.map((c) => c.aggregatedScore));
  const licenseConfidenceHistogram = makeHistogram(allCandidates.map((c) => c.licenseConfidence));

  const counts = results.map((r) => r.candidates.length);
  const avgCandidatesPerImage =
    counts.length > 0 ? counts.reduce((s, v) => s + v, 0) / counts.length : 0;
  const variance =
    counts.length > 0
      ? counts.reduce((s, v) => s + (v - avgCandidatesPerImage) ** 2, 0) / counts.length
      : 0;

  const telemetry: BatchReverseTelemetry = {
    batchId,
    totalImages: clamped.length,
    processedImages: results.filter((r) => !r.timedOut || r.candidates.length > 0).length,
    timedOutImages: results.filter((r) => r.timedOut).length,
    totalWallTimeMs: Date.now() - batchStart,
    providerTelemetry,
    aggregatedScoreHistogram,
    licenseConfidenceHistogram,
    resultSpread: {
      avgCandidatesPerImage,
      stdDevCandidatesPerImage: Math.sqrt(variance),
      minCandidatesPerImage: counts.length > 0 ? Math.min(...counts) : 0,
      maxCandidatesPerImage: counts.length > 0 ? Math.max(...counts) : 0,
    },
  };

  return { batchId, results, telemetry };
}
