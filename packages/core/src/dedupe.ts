/**
 * Near-duplicate detection.
 *
 * Two layers:
 *   1. URL / host-based dedupe — very cheap, runs on every federation call.
 *   2. Perceptual hash (pHash) — a true DCT-based pHash via `sharp` when
 *      available; gracefully falls back to a byte-window aHash when not.
 *      See `perceptual-hash.ts` for the algorithm.
 */

import { downloadImage } from "./download.ts";
import { findDuplicates, hammingDistance, perceptualHash, perceptualHashStructured, phashToString } from "./perceptual-hash.ts";
import type { DedupeGroupMember, DuplicateGroup, Fetcher, ImageCandidate, ProviderDedupeReport, SearchResultBundle } from "./types.ts";

export { perceptualHash, perceptualHashStructured, phashToString, hammingDistance, findDuplicates };

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Drop common cache-buster params.
    for (const k of ["w", "h", "fit", "auto", "q", "fm", "dpr", "crop", "s", "t"])
      u.searchParams.delete(k);
    u.hash = "";
    return (
      u.origin + u.pathname + (u.searchParams.toString() ? `?${u.searchParams.toString()}` : "")
    );
  } catch {
    return url;
  }
}

/** URL-level dedupe — keeps the first occurrence (which, post-sort, is the best one). */
export function dedupeByUrl(candidates: ImageCandidate[]): ImageCandidate[] {
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  for (const c of candidates) {
    const k = normalizeUrl(c.url);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

export interface DedupeByHashOptions {
  hammingThreshold?: number;
  /** When true, compute missing phashes by downloading bytes. Expensive. */
  computeHashes?: boolean;
  fetcher?: Fetcher;
  userAgent?: string;
  signal?: AbortSignal;
}

/** pHash-level dedupe. Skips candidates without phash unless `computeHashes`. */
export function dedupeByHash(candidates: ImageCandidate[], opts?: number): ImageCandidate[];
export function dedupeByHash(
  candidates: ImageCandidate[],
  opts: DedupeByHashOptions,
): Promise<ImageCandidate[]>;
export function dedupeByHash(
  candidates: ImageCandidate[],
  opts: DedupeByHashOptions | number = {},
): ImageCandidate[] | Promise<ImageCandidate[]> {
  // Back-compat: number => threshold, sync-style.
  if (typeof opts === "number" || opts === undefined) {
    return dedupeByHashSync(candidates, typeof opts === "number" ? opts : 6);
  }
  return dedupeByHashAsync(candidates, opts);
}

async function dedupeByHashAsync(
  candidates: ImageCandidate[],
  opts: DedupeByHashOptions,
): Promise<ImageCandidate[]> {
  const threshold = opts.hammingThreshold ?? 6;
  const withHashes: ImageCandidate[] = [];
  for (const c of candidates) {
    if (c.phash || !opts.computeHashes) {
      withHashes.push(c);
      continue;
    }
    try {
      const dl = await downloadImage(c.url, {
        fetcher: opts.fetcher,
        userAgent: opts.userAgent,
        signal: opts.signal,
      });
      const result = await perceptualHashStructured(dl.bytes);
      withHashes.push({
        ...c,
        phash: result.hash,
        phashResult: result,
        phashAlgorithm: result.algorithm,
      });
    } catch {
      withHashes.push(c);
    }
  }
  return dedupeByHashSync(withHashes, threshold);
}

function dedupeByHashSync(candidates: ImageCandidate[], threshold: number): ImageCandidate[] {
  const kept: ImageCandidate[] = [];
  for (const c of candidates) {
    if (!c.phash) {
      kept.push(c);
      continue;
    }
    const dup = kept.find((k) => k.phash && hammingDistance(k.phash, c.phash!) <= threshold);
    if (!dup) kept.push(c);
  }
  return kept;
}

export interface CompareCandidatesOptions {
  /**
   * Maximum Hamming distance (inclusive) between two pHashes to be considered
   * visual duplicates. Default: 6 (matches `dedupeByHash` default).
   */
  hammingThreshold?: number;
}

/**
 * Analyse a `SearchResultBundle` for cross-provider duplicates without
 * mutating the original candidates.
 *
 * Two detection passes are run in order:
 *   1. **URL dedupe** — normalised URLs (cache-buster params stripped) that
 *      appear more than once form a `'url'` group with confidence 1.0.
 *   2. **pHash dedupe** — pairs not already unified by URL whose pHashes
 *      are within `hammingThreshold` form `'phash'` groups.  Confidence is
 *      derived from the algorithm quality of the lowest-confidence member.
 *
 * Groups with a single effective member after merging are omitted.
 *
 * `merged` is a deduplicated representative list (highest-scored or first
 * occurrence wins within each group, then sorted by score descending).
 */
export function compareCandidates(
  bundle: SearchResultBundle,
  opts: CompareCandidatesOptions = {},
): ProviderDedupeReport {
  const threshold = opts.hammingThreshold ?? 6;
  const { candidates } = bundle;

  // Union-Find helpers (path-compressed).
  const parent = candidates.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!; // path halving
      x = parent[x]!;
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  // Track how each index was grouped and with what confidence.
  const groupReason = new Map<string, "phash" | "url">(); // key = "rootA-rootB" → not needed after; just union directly
  // We store the reason per root after all unions.
  const rootReason = new Map<number, "phash" | "url">();
  const rootConfidence = new Map<number, number>();

  // Pass 1: URL-based grouping.
  const urlIndex = new Map<string, number>(); // normalised url → first index
  for (let i = 0; i < candidates.length; i++) {
    const norm = normalizeUrl(candidates[i]!.url);
    const existing = urlIndex.get(norm);
    if (existing === undefined) {
      urlIndex.set(norm, i);
    } else {
      const ra = find(existing);
      const rb = find(i);
      union(ra, rb);
      const root = find(ra);
      rootReason.set(root, "url");
      rootConfidence.set(root, 1.0);
    }
  }

  // Pass 2: pHash-based grouping (only for pairs not already URL-unified).
  const phashPairs = findDuplicates(candidates, threshold);
  for (const [i, j] of phashPairs) {
    const ra = find(i);
    const rb = find(j);
    if (ra === rb) continue; // already same group
    union(ra, rb);
    const root = find(ra);
    // Don't downgrade a url-based group reason.
    if (!rootReason.has(root) || rootReason.get(root) !== "url") {
      rootReason.set(root, "phash");
      // Confidence: based on minimum phashResult confidence among the two candidates.
      const cA = candidates[i]?.phashResult?.confidence ?? (candidates[i]?.phash ? 0.5 : 0);
      const cB = candidates[j]?.phashResult?.confidence ?? (candidates[j]?.phash ? 0.5 : 0);
      const existing = rootConfidence.get(root) ?? 1.0;
      rootConfidence.set(root, Math.min(existing, cA, cB));
    }
  }

  // Collect groups: root → member indices.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  // Build DuplicateGroup array (only groups with 2+ members).
  const duplicateGroups: DuplicateGroup[] = [];
  const representativeIndices = new Set<number>(); // one per group for `merged`

  for (const [root, indices] of groups) {
    // Pick representative: highest score, then lowest index.
    const rep = indices.reduce((best, idx) => {
      const bScore = candidates[best]?.score ?? 0;
      const iScore = candidates[idx]?.score ?? 0;
      return iScore > bScore ? idx : best;
    }, indices[0]!);
    representativeIndices.add(rep);

    if (indices.length < 2) continue; // singleton — not a duplicate group

    const members: DedupeGroupMember[] = indices.map((idx) => ({
      index: idx,
      url: candidates[idx]!.url,
      provider: candidates[idx]!.source,
      phash: candidates[idx]!.phash,
    }));

    duplicateGroups.push({
      members,
      reason: rootReason.get(root) ?? "url",
      confidence: rootConfidence.get(root) ?? 1.0,
    });
  }

  // Build merged list: one representative per group, sorted by score desc.
  const merged = [...representativeIndices]
    .map((i) => candidates[i]!)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return { duplicateGroups, merged };
}
