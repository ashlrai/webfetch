/**
 * Batch Reverse-Image Search with Perceptual Distance Ranking.
 *
 * Algorithm:
 *   1. Compute pHash for each reference image (URL or bytes).
 *   2. Fan out to findSimilar on 2-3 providers per reference.
 *   3. Build Hamming-distance matrix between reference hashes and candidate hashes.
 *   4. Group candidates by distance thresholds:
 *        exact          0–3   (same image / trivial re-encode)
 *        near-duplicate 4–8   (minor crop / resize / compression)
 *        similar        9–15  (visually related)
 *        loosely-related 16–25 (same subject, different angle/lighting)
 *   5. Rank within groups: license-first, then phash confidence, then provider priority.
 *   6. Optional dedupeAcrossReferences: merge candidates similar to multiple references.
 */

import { downloadImage } from "./download.ts";
import { findSimilar } from "./find-similar.ts";
import { hammingDistance, hammingPercentile } from "./perceptual-hash.ts";
import { perceptualHashStructured } from "./perceptual-hash.ts";
import { LICENSE_RANK } from "./license.ts";
import type {
  BatchFindSimilarOptions,
  PerceptualDistance,
  SimilarityBand,
  SimilarityCluster,
  SimilarityResult,
  BatchFindSimilarBundleResult,
} from "./types.ts";
import type { ImageCandidate, PerceptualHashResult, ProviderId, SearchOptions } from "./types.ts";

// ---------------------------------------------------------------------------
// Provider priority list (lower index = higher priority when ranking within group)
// ---------------------------------------------------------------------------
const PROVIDER_PRIORITY: ProviderId[] = [
  "wikimedia",
  "openverse",
  "unsplash",
  "pexels",
  "pixabay",
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
  "musicbrainz-caa",
  "itunes",
  "spotify",
  "youtube-thumb",
  "brave",
  "serpapi",
  "bing",
  "browser",
  "managed-browser",
];

function providerPriority(source: string): number {
  const idx = PROVIDER_PRIORITY.indexOf(source as ProviderId);
  return idx === -1 ? PROVIDER_PRIORITY.length : idx;
}

/** Classify a Hamming distance into a similarity band. Returns null if > 25 (out of range). */
export function classifyDistance(distance: number): SimilarityBand | null {
  if (distance <= 3) return "exact";
  if (distance <= 8) return "near-duplicate";
  if (distance <= 15) return "similar";
  if (distance <= 25) return "loosely-related";
  return null;
}

/** Compute pHash for a reference (downloads URL if bytes not provided). */
async function resolveReferenceHash(
  ref: { url?: string; bytes?: Uint8Array },
  opts: SearchOptions,
): Promise<{ hash: PerceptualHashResult | null; url?: string }> {
  try {
    let bytes: Uint8Array;
    if (ref.bytes) {
      bytes = ref.bytes;
    } else if (ref.url) {
      const dl = await downloadImage(ref.url, { fetcher: opts.fetcher });
      bytes = dl.bytes;
    } else {
      return { hash: null };
    }
    const hash = await perceptualHashStructured(bytes);
    return { hash, url: ref.url };
  } catch {
    return { hash: null, url: ref.url };
  }
}

/** Rank candidates within a similarity cluster (license-first). */
function rankCandidates(candidates: SimilarityResult[]): SimilarityResult[] {
  return [...candidates].sort((a, b) => {
    // 1. License rank (lower = more open = better)
    const lr = (LICENSE_RANK[a.candidate.license] ?? 99) - (LICENSE_RANK[b.candidate.license] ?? 99);
    if (lr !== 0) return lr;

    // 2. phash confidence (higher = better)
    const ca = a.candidate.phashResult?.confidence ?? a.candidate.confidence ?? 0;
    const cb = b.candidate.phashResult?.confidence ?? b.candidate.confidence ?? 0;
    if (Math.abs(ca - cb) > 1e-6) return cb - ca;

    // 3. Provider priority (lower idx = better)
    const pa = providerPriority(a.candidate.source);
    const pb = providerPriority(b.candidate.source);
    if (pa !== pb) return pa - pb;

    // 4. Hamming distance (lower = more similar)
    return a.distance - b.distance;
  });
}

/**
 * Find visually similar images for multiple reference images, returning
 * results grouped into perceptual-distance clusters.
 *
 * @param references   One or more reference images (URL and/or raw bytes).
 * @param opts         Standard SearchOptions + batch-specific extensions.
 */
export async function findSimilarBatch(
  references: Array<{ url?: string; bytes?: Uint8Array }>,
  opts: BatchFindSimilarOptions = {},
): Promise<BatchFindSimilarBundleResult> {
  const warnings: string[] = [];
  const providers = (opts.providers ?? []) as ProviderId[];
  const dedupeAcrossReferences = opts.dedupeAcrossReferences ?? false;
  const maxCandidatesPerReference = opts.maxCandidatesPerReference ?? 50;

  if (references.length === 0) {
    return {
      references: [],
      clusters: [],
      statistics: {
        totalCandidates: 0,
        uniqueCandidates: 0,
        clusterCount: 0,
        referenceCount: 0,
        bandBreakdown: { exact: 0, "near-duplicate": 0, similar: 0, "loosely-related": 0 },
        medianHammingDistance: null,
        p90HammingDistance: null,
      },
      warnings: ["no references provided"],
    };
  }

  // ── Step 1: compute pHash for each reference ────────────────────────────
  const refHashResults = await Promise.all(
    references.map((r) => resolveReferenceHash(r, opts)),
  );

  const refInfos: Array<{
    pHash: string | null;
    algorithm: PerceptualHashResult["algorithm"] | null;
    confidence: number | null;
    url?: string;
  }> = refHashResults.map((r) => ({
    pHash: r.hash?.hash ?? null,
    algorithm: r.hash?.algorithm ?? null,
    confidence: r.hash?.confidence ?? null,
    url: r.url,
  }));

  // ── Step 2: fan out findSimilar per reference ────────────────────────────
  // Run all references concurrently; errors per reference are captured as warnings.
  const perRefCandidates: ImageCandidate[][] = await Promise.all(
    references.map(async (ref, idx) => {
      if (!ref.url && !ref.bytes) {
        warnings.push(`reference[${idx}]: no url or bytes — skipped`);
        return [];
      }
      try {
        const result = await findSimilar(
          { url: ref.url ?? "", bytes: ref.bytes },
          { ...opts, providers },
        );
        warnings.push(...result.warnings);
        return result.candidates.slice(0, maxCandidatesPerReference);
      } catch (e) {
        warnings.push(`reference[${idx}] findSimilar failed: ${(e as Error).message}`);
        return [];
      }
    }),
  );

  // ── Step 3: build distance matrix + collect SimilarityResults ───────────
  // For each candidate, compute minimum Hamming distance across all references.
  const allDistances: number[] = [];

  // Collect (candidate, distance, referenceIndex, band) tuples
  type CandEntry = {
    candidate: ImageCandidate;
    distance: number;
    referenceIndex: number;
    band: SimilarityBand;
    key: string; // dedup key = url
  };

  const allEntries: CandEntry[] = [];

  for (let refIdx = 0; refIdx < references.length; refIdx++) {
    const refHash = refInfos[refIdx]?.pHash;
    const candidates = perRefCandidates[refIdx] ?? [];

    for (const cand of candidates) {
      const candHash = cand.phash ?? cand.phashResult?.hash;
      let distance: number;

      if (refHash && candHash) {
        distance = hammingDistance(refHash, candHash);
      } else {
        // No hash available — assign to loosely-related with max band distance
        distance = 20;
      }

      const band = classifyDistance(distance);
      if (band === null) continue; // > 25 — out of range, discard

      allDistances.push(distance);
      allEntries.push({ candidate: cand, distance, referenceIndex: refIdx, band, key: cand.url });
    }
  }

  // ── Step 4: optional deduplication across references ────────────────────
  let entries = allEntries;
  if (dedupeAcrossReferences) {
    // Keep the entry with the smallest Hamming distance when a URL appears for multiple refs
    const bestByUrl = new Map<string, CandEntry>();
    for (const entry of allEntries) {
      const existing = bestByUrl.get(entry.key);
      if (!existing || entry.distance < existing.distance) {
        bestByUrl.set(entry.key, entry);
      }
    }
    entries = Array.from(bestByUrl.values());
  }

  // ── Step 5: group into clusters by band ─────────────────────────────────
  const bandMap = new Map<SimilarityBand, CandEntry[]>([
    ["exact", []],
    ["near-duplicate", []],
    ["similar", []],
    ["loosely-related", []],
  ]);

  for (const entry of entries) {
    bandMap.get(entry.band)!.push(entry);
  }

  const BAND_ORDER: SimilarityBand[] = ["exact", "near-duplicate", "similar", "loosely-related"];

  const clusters: SimilarityCluster[] = [];
  for (const band of BAND_ORDER) {
    const bandEntries = bandMap.get(band)!;
    if (bandEntries.length === 0) continue;

    const similarityResults: SimilarityResult[] = bandEntries.map((e) => ({
      candidate: e.candidate,
      distance: e.distance,
      referenceIndex: e.referenceIndex,
      distanceLabel: classifyDistance(e.distance) ?? "loosely-related",
    }));

    const ranked = rankCandidates(similarityResults);

    clusters.push({
      similarity: band,
      candidates: ranked,
      count: ranked.length,
    });
  }

  // ── Step 6: statistics ───────────────────────────────────────────────────
  const bandBreakdown: Record<SimilarityBand, number> = {
    exact: 0,
    "near-duplicate": 0,
    similar: 0,
    "loosely-related": 0,
  };
  for (const cluster of clusters) {
    bandBreakdown[cluster.similarity] = cluster.count;
  }

  const totalCandidates = entries.length;
  const uniqueUrls = new Set(entries.map((e) => e.key));

  const medianHammingDistance =
    allDistances.length > 0 ? hammingPercentile(allDistances, 0.5) : null;
  const p90HammingDistance =
    allDistances.length > 0 ? hammingPercentile(allDistances, 0.9) : null;

  return {
    references: refInfos.map((r) => ({
      pHash: r.pHash,
      algorithm: r.algorithm,
      confidence: r.confidence,
      ...(r.url !== undefined ? { url: r.url } : {}),
    })),
    clusters,
    statistics: {
      totalCandidates,
      uniqueCandidates: uniqueUrls.size,
      clusterCount: clusters.length,
      referenceCount: references.length,
      bandBreakdown,
      medianHammingDistance,
      p90HammingDistance,
    },
    warnings,
  };
}
