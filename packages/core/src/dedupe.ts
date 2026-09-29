/**
 * Near-duplicate detection.
 *
 * Two layers:
 *   1. URL / host-based dedupe — very cheap, runs on every federation call.
 *   2. Perceptual hash (pHash) — a true DCT-based pHash via `sharp` when
 *      available; gracefully falls back to a byte-window aHash when not.
 *      See `perceptual-hash.ts` for the algorithm.
 *
 * Extended API: `dedupeWithPhashGrouping` builds a Hamming-distance similarity
 * graph across all candidates, merges same-image results from multiple providers
 * into canonical candidates with deduplicated metadata, confidence aggregation,
 * and alternate URL tracking.
 */

import { downloadImage } from "./download.ts";
import {
  findDuplicates,
  hammingDistance,
  perceptualHash,
  perceptualHashStructured,
  phashToString,
  routePerceptualHashByConfidence,
} from "./perceptual-hash.ts";
import { LICENSE_RANK } from "./license.ts";
import type {
  DedupeGroupMember,
  DedupeWithPhashGroupingOptions,
  DuplicateGroup,
  Fetcher,
  ImageCandidate,
  PhashCanonicalCandidate,
  PhashDedupeMetrics,
  PhashDedupeOptions,
  PhashDedupeResult,
  PhashGroupingResult,
  ProviderDedupeReport,
  SearchResultBundle,
} from "./types.ts";

export { perceptualHash, perceptualHashStructured, phashToString, hammingDistance, findDuplicates, routePerceptualHashByConfidence };

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

  // Route low-confidence candidates (< 0.6) through aHash verification first
  // to avoid expensively re-computing DCT on already-degraded candidates.
  // Low-confidence candidates are verified via their existing aHash (phash field)
  // before being admitted to the full DCT deduplication pass.
  const { highConfidence, lowConfidence } = routePerceptualHashByConfidence(withHashes);

  // Low-confidence candidates: dedupe against themselves first (cheap), then
  // merge surviving members into the high-confidence deduplication pass.
  const lowDeduped = dedupeByHashSync(lowConfidence, threshold);
  const combined = [...highConfidence, ...lowDeduped];

  return dedupeByHashSync(combined, threshold);
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

// ---------------------------------------------------------------------------
// dedupeWithPhashGrouping — multi-provider pHash similarity graph + canonical
// candidate synthesis with metadata union, confidence aggregation, and
// alternate URL tracking.
// ---------------------------------------------------------------------------

/**
 * Compute a phash algorithm-quality weight: dct-phash → 1.0, ahash-fallback → 0.5,
 * no hash → 0 (no contribution). Mirrors the algorithm confidence values in
 * perceptual-hash.ts but derived from the candidate fields.
 */
function phashAlgorithmConfidence(c: ImageCandidate): number {
  if (c.phashResult) return c.phashResult.confidence;
  if (c.phashAlgorithm === "dct-phash") return 1.0;
  if (c.phashAlgorithm === "ahash-fallback") return 0.5;
  if (c.phash) return 0.5; // bare hash, unknown algorithm — treat as fallback quality
  return 0;
}

/**
 * Map a License to a 0..1 score where lower LICENSE_RANK → more open → higher score.
 * CC0 (rank 1) → 1.0; UNKNOWN (rank 99) → ~0.
 */
function licenseScore(c: ImageCandidate): number {
  const rank = LICENSE_RANK[c.license] ?? 99;
  // Invert rank: rank 1 → 1.0, rank 99 → ~0.01. Cap at 1.
  return Math.max(0, Math.min(1, 1 / rank));
}

/**
 * Compute a confidence decay factor when a group mixes UNKNOWN-license
 * providers with known-license providers.
 *
 * Rationale: if the same visual is returned by both a trusted source (e.g.,
 * Wikimedia with CC0) and an UNKNOWN-license scraper (e.g., Brave/Bing), the
 * UNKNOWN members cast doubt on provenance — they may be hotlinking without
 * rights. The decay is proportional to the fraction of UNKNOWN members:
 *
 *   decay = 1 - unknownFraction × UNKNOWN_MIX_PENALTY
 *
 * where `UNKNOWN_MIX_PENALTY = 0.25` means a fully-UNKNOWN group is penalised
 * by 25%, and a 50/50 split is penalised by 12.5%. Pure known-license groups
 * (including pure-UNKNOWN groups that have no known comparator) receive no
 * decay — the penalty only fires when known and UNKNOWN providers co-exist.
 */
const UNKNOWN_MIX_PENALTY = 0.25;

function unknownMixDecay(members: ImageCandidate[]): number {
  if (members.length === 0) return 1;
  const unknownCount = members.filter((c) => (LICENSE_RANK[c.license] ?? 99) >= 99).length;
  const knownCount = members.length - unknownCount;
  // Only apply decay when there is at least one known AND at least one UNKNOWN member.
  if (knownCount === 0 || unknownCount === 0) return 1;
  const unknownFraction = unknownCount / members.length;
  return Math.max(0, 1 - unknownFraction * UNKNOWN_MIX_PENALTY);
}

/**
 * Compute aggregated confidence for a group of candidates.
 *
 * Formula:
 *   base = phashWeight × avgPhashConfidence + (1 - phashWeight) × bestLicenseScore
 *   result = base × unknownMixDecay(members)
 *
 * This rewards groups where all members used the high-quality DCT hash AND at
 * least one member has a well-known open license. It also penalises mixed
 * groups where UNKNOWN-license providers co-exist with known-license providers,
 * reflecting reduced provenance certainty.
 */
function aggregateGroupConfidence(
  members: ImageCandidate[],
  phashWeight: number,
): number {
  if (members.length === 0) return 0;

  const avgPhash =
    members.reduce((s, c) => s + phashAlgorithmConfidence(c), 0) / members.length;
  const bestLicense = members.reduce((best, c) => Math.max(best, licenseScore(c)), 0);

  const base = phashWeight * avgPhash + (1 - phashWeight) * bestLicense;
  return base * unknownMixDecay(members);
}

/**
 * Merge metadata fields from a group of candidates into the representative.
 * Strategy: first non-empty value wins for each field.
 */
function mergeMetadata(
  rep: ImageCandidate,
  members: ImageCandidate[],
): Pick<ImageCandidate, "author" | "title" | "sourcePageUrl" | "licenseUrl" | "attributionLine"> {
  let author = rep.author;
  let title = rep.title;
  let sourcePageUrl = rep.sourcePageUrl;
  let licenseUrl = rep.licenseUrl;
  let attributionLine = rep.attributionLine;

  for (const m of members) {
    if (!author && m.author) author = m.author;
    if (!title && m.title) title = m.title;
    if (!sourcePageUrl && m.sourcePageUrl) sourcePageUrl = m.sourcePageUrl;
    if (!licenseUrl && m.licenseUrl) licenseUrl = m.licenseUrl;
    if (!attributionLine && m.attributionLine) attributionLine = m.attributionLine;
  }

  return { author, title, sourcePageUrl, licenseUrl, attributionLine };
}

/**
 * Batch-efficient optional sharp pooling: when computeHashes is requested,
 * this function populates missing phashes across all candidates in a single
 * pass, reusing a single dynamically-loaded sharp reference.
 *
 * Returns a new array with hashes filled in (candidates that failed to hash
 * are returned unchanged).
 */
async function fillMissingHashes(
  candidates: ImageCandidate[],
  opts: Pick<DedupeWithPhashGroupingOptions, "fetcher" | "userAgent" | "signal">,
): Promise<ImageCandidate[]> {
  // Identify indices that need hashing.
  const toHash = candidates
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.phash);

  if (toHash.length === 0) return candidates;

  // Clone the array so we don't mutate the input.
  const result = [...candidates];

  // Process in parallel (bounded by Promise.allSettled — no rate-limiting needed
  // at this layer; callers should use AbortSignal for cancellation).
  await Promise.allSettled(
    toHash.map(async ({ c, i }) => {
      try {
        const dl = await downloadImage(c.url, {
          fetcher: opts.fetcher,
          userAgent: opts.userAgent,
          signal: opts.signal,
        });
        const hashResult = await perceptualHashStructured(dl.bytes);
        result[i] = {
          ...c,
          phash: hashResult.hash,
          phashResult: hashResult,
          phashAlgorithm: hashResult.algorithm,
        };
      } catch {
        // Leave unchanged on failure — graceful degradation.
      }
    }),
  );

  return result;
}

/**
 * Build a Hamming-distance similarity graph across all candidates, merge
 * same-image results from multiple providers into canonical candidates with:
 *
 * - **Deduplicated metadata**: `author`, `title`, `sourcePageUrl`, `licenseUrl`,
 *   and `attributionLine` are merged via first-non-empty wins across all group members.
 * - **Confidence aggregation**: `aggregatedConfidence` combines pHash algorithm
 *   quality (weighted by `opts.phashWeight`, default 0.6) with the best license
 *   rank score in the group.
 * - **Alternate URL tracking**: `alternateUrls` lists every non-canonical URL
 *   found in the group; `providers` lists all contributing provider ids.
 * - **Batch-efficient sharp pooling**: when `opts.computeHashes` is true, missing
 *   hashes are downloaded + computed in a single parallel pass before grouping.
 *
 * Candidates without any pHash that are not grouped by URL are returned as
 * `singletons` (unchanged). URL-equivalent variants (cache-busting params stripped)
 * are pre-collapsed before the pHash graph is built to avoid false positives.
 *
 * @example
 * ```ts
 * const { canonical, singletons } = await dedupeWithPhashGrouping(candidates, {
 *   hammingThreshold: 8,
 *   computeHashes: true,
 * });
 * const allUnique = [...canonical, ...singletons];
 * ```
 */
export async function dedupeWithPhashGrouping(
  candidates: ImageCandidate[],
  opts: DedupeWithPhashGroupingOptions = {},
): Promise<PhashGroupingResult> {
  const threshold = opts.hammingThreshold ?? 8;
  const phashWeight = Math.max(0, Math.min(1, opts.phashWeight ?? 0.6));

  // Step 1: URL-level pre-collapse to avoid treating CDN variants as distinct images.
  // We keep track of the original candidates by normalized URL → first index seen.
  const urlToFirst = new Map<string, number>();
  const urlGroups = new Map<number, number[]>(); // first-index → all indices with same norm URL

  for (let i = 0; i < candidates.length; i++) {
    const norm = normalizeUrl(candidates[i]!.url);
    const first = urlToFirst.get(norm);
    if (first === undefined) {
      urlToFirst.set(norm, i);
      urlGroups.set(i, [i]);
    } else {
      urlGroups.get(first)!.push(i);
    }
  }

  // Deduplicated representative set (one per unique URL).
  const repIndices = [...urlGroups.keys()];
  let repCandidates: ImageCandidate[] = repIndices.map((i) => candidates[i]!);

  // Step 2: Optionally compute missing hashes (batch pass with sharp reuse).
  if (opts.computeHashes) {
    repCandidates = await fillMissingHashes(repCandidates, {
      fetcher: opts.fetcher,
      userAgent: opts.userAgent,
      signal: opts.signal,
    });
  }

  // Step 3: Build pHash similarity graph using Union-Find.
  const n = repCandidates.length;
  const parent = repCandidates.map((_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  // pHash pairs within threshold.
  const pairs = findDuplicates(repCandidates, threshold);
  for (const [i, j] of pairs) {
    union(i, j);
  }

  // Step 4: Collect groups by root.
  const groupMap = new Map<number, number[]>(); // root → member indices in repCandidates
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groupMap.has(root)) groupMap.set(root, []);
    groupMap.get(root)!.push(i);
  }

  // Step 5: Build canonical candidates and DuplicateGroup records.
  const canonicalList: PhashCanonicalCandidate[] = [];
  const singletonList: ImageCandidate[] = [];
  const duplicateGroups: DuplicateGroup[] = [];

  for (const [, memberRepIndices] of groupMap) {
    // Gather all original candidates for every URL-group in this pHash cluster.
    const allOriginalMembers: ImageCandidate[] = [];
    for (const ri of memberRepIndices) {
      const origIdx = repIndices[ri]!;
      const urlGroup = urlGroups.get(origIdx)!;
      for (const oi of urlGroup) {
        allOriginalMembers.push(candidates[oi]!);
      }
    }

    if (memberRepIndices.length === 1 && allOriginalMembers.length === 1) {
      // True singleton — not part of any duplicate group.
      singletonList.push(allOriginalMembers[0]!);
      continue;
    }

    // Pick representative: highest score, then prefer known-license over UNKNOWN
    // (lower LICENSE_RANK = more open = preferred), then first in order.
    const repRi = memberRepIndices.reduce((best, ri) => {
      const bScore = repCandidates[best]?.score ?? 0;
      const iScore = repCandidates[ri]?.score ?? 0;
      if (iScore > bScore) return ri;
      if (iScore < bScore) return best;
      // Scores equal — prefer the candidate with the better (lower) license rank.
      const bRank = LICENSE_RANK[repCandidates[best]?.license ?? "UNKNOWN"] ?? 99;
      const iRank = LICENSE_RANK[repCandidates[ri]?.license ?? "UNKNOWN"] ?? 99;
      return iRank < bRank ? ri : best;
    }, memberRepIndices[0]!);

    const rep = repCandidates[repRi]!;

    // Merge metadata from all members.
    const merged = mergeMetadata(rep, allOriginalMembers);

    // Compute aggregated confidence.
    const aggregatedConfidence = aggregateGroupConfidence(allOriginalMembers, phashWeight);

    // Collect alternate URLs and all provider ids.
    const allUrls = allOriginalMembers.map((m) => m.url);
    const alternateUrls = allUrls.filter((u) => u !== rep.url);
    const providers = [...new Set(allOriginalMembers.map((m) => m.source))];

    const canonical: PhashCanonicalCandidate = {
      ...rep,
      ...merged,
      providers,
      alternateUrls,
      aggregatedConfidence,
    };
    canonicalList.push(canonical);

    // Build DuplicateGroup for callers who want the raw cluster data.
    // Only emit groups with 2+ distinct effective members.
    const effectiveMemberCount = allOriginalMembers.length;
    if (effectiveMemberCount >= 2) {
      // Determine the reason and confidence.
      const allSameUrl = new Set(allOriginalMembers.map((m) => normalizeUrl(m.url))).size === 1;
      const reason: "url" | "phash" = allSameUrl ? "url" : "phash";
      const confidence =
        reason === "url"
          ? 1.0
          : aggregateGroupConfidence(allOriginalMembers, phashWeight);

      const members: DedupeGroupMember[] = allOriginalMembers.map((m, idx) => ({
        index: candidates.indexOf(m),
        url: m.url,
        provider: m.source,
        phash: m.phash,
      }));

      duplicateGroups.push({ members, reason, confidence });
    }
  }

  // Sort canonical by score descending, then singletons by score descending.
  canonicalList.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  singletonList.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return {
    canonical: canonicalList,
    groups: duplicateGroups,
    singletons: singletonList,
  };
}

// ---------------------------------------------------------------------------
// dedupeImagesByPhash — federation-facing dedup that returns a cluster Map keyed
// by representative URL plus aggregate metrics. Built on the same URL-collapse +
// Hamming Union-Find machinery as dedupeWithPhashGrouping, but emits the
// PhashDedupeResult shape consumed by federation.ts and batch-phash-dedup.ts.
// ---------------------------------------------------------------------------

/**
 * Select the representative ("primary") candidate of a cluster: highest pHash
 * algorithm confidence first, then highest resolution (width×height), then best
 * (lowest) license rank, then highest composite score, then earliest member.
 */
function selectPhashRepresentative(members: ImageCandidate[]): ImageCandidate {
  return members.reduce((best, c) => {
    const bc = phashAlgorithmConfidence(best);
    const cc = phashAlgorithmConfidence(c);
    if (cc !== bc) return cc > bc ? c : best;
    const bRes = (best.width ?? 0) * (best.height ?? 0);
    const cRes = (c.width ?? 0) * (c.height ?? 0);
    if (cRes !== bRes) return cRes > bRes ? c : best;
    const bRank = LICENSE_RANK[best.license] ?? 99;
    const cRank = LICENSE_RANK[c.license] ?? 99;
    if (cRank !== bRank) return cRank < bRank ? c : best;
    const bScore = best.score ?? 0;
    const cScore = c.score ?? 0;
    return cScore > bScore ? c : best;
  }, members[0]!);
}

/**
 * Deduplicate `ImageCandidate[]` by perceptual-hash similarity and return a
 * cluster Map plus aggregate metrics.
 *
 * - URL-equivalent variants (cache-busting params stripped) are pre-collapsed.
 * - Candidates within `hammingThreshold` Hamming distance are grouped via
 *   Union-Find. Candidates without a pHash are always singletons.
 * - For each cluster the representative (primary) is elected by
 *   `selectPhashRepresentative` and placed first in the members array.
 * - `dedupedCandidates` is the flat list of one primary per cluster, with
 *   multi-member cluster primaries first (sorted by score), then singletons.
 *
 * @example
 * ```ts
 * const { dedupedCandidates, clusters, metrics } = await dedupeImagesByPhash(candidates);
 * console.log(`${metrics.clusterCount} clusters, ${metrics.totalDeduplicated} duplicates removed`);
 * ```
 */
export async function dedupeImagesByPhash(
  candidates: ImageCandidate[],
  opts: PhashDedupeOptions = {},
): Promise<PhashDedupeResult> {
  const threshold = Math.max(0, Math.min(64, opts.hammingThreshold ?? 8));
  const emptyMetrics: PhashDedupeMetrics = {
    clusterCount: 0,
    totalDeduplicated: 0,
    avgClusterSize: 0,
    avgIntraClusterHammingDistance: 0,
  };

  if (candidates.length === 0) {
    return { clusters: new Map(), dedupedCandidates: [], metrics: emptyMetrics };
  }

  // Step 1: URL-level pre-collapse. urlGroups: first-index → all indices sharing URL.
  const urlToFirst = new Map<string, number>();
  const urlGroups = new Map<number, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const norm = normalizeUrl(candidates[i]!.url);
    const first = urlToFirst.get(norm);
    if (first === undefined) {
      urlToFirst.set(norm, i);
      urlGroups.set(i, [i]);
    } else {
      urlGroups.get(first)!.push(i);
    }
  }

  const repIndices = [...urlGroups.keys()];
  let repCandidates: ImageCandidate[] = repIndices.map((i) => candidates[i]!);

  // Step 2: optionally compute missing hashes.
  if (opts.computeHashes) {
    repCandidates = await fillMissingHashes(repCandidates, {
      fetcher: opts.fetcher,
      userAgent: opts.userAgent,
      signal: opts.signal,
    });
  }

  // Step 3: Union-Find over pHash pairs within threshold.
  const n = repCandidates.length;
  const parent = repCandidates.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }
  for (const [i, j] of findDuplicates(repCandidates, threshold)) union(i, j);

  // Step 4: collect rep-index groups by root.
  const rootGroups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!rootGroups.has(root)) rootGroups.set(root, []);
    rootGroups.get(root)!.push(i);
  }

  // Step 5: expand to full original members + build clusters/singletons.
  const clusters = new Map<string, ImageCandidate[]>();
  const singletonPrimaries: ImageCandidate[] = [];
  const clusterPrimaries: ImageCandidate[] = [];
  let totalDeduplicated = 0;
  let intraClusterPairCount = 0;
  let intraClusterHammingSum = 0;

  for (const [, memberRepIndices] of rootGroups) {
    const allMembers: ImageCandidate[] = [];
    for (const ri of memberRepIndices) {
      const origIdx = repIndices[ri]!;
      for (const oi of urlGroups.get(origIdx)!) allMembers.push(candidates[oi]!);
    }

    if (allMembers.length === 1) {
      singletonPrimaries.push(allMembers[0]!);
      continue;
    }

    // Multi-member cluster: elect primary, place first.
    const primary = selectPhashRepresentative(allMembers);
    const ordered = [primary, ...allMembers.filter((m) => m !== primary)];
    clusters.set(primary.url, ordered);
    clusterPrimaries.push(primary);
    totalDeduplicated += allMembers.length - 1;

    // Accumulate intra-cluster Hamming distances for members that have hashes.
    const hashed = ordered.filter((m) => m.phash);
    for (let a = 0; a < hashed.length; a++) {
      for (let b = a + 1; b < hashed.length; b++) {
        intraClusterHammingSum += hammingDistance(hashed[a]!.phash!, hashed[b]!.phash!);
        intraClusterPairCount++;
      }
    }
  }

  // dedupedCandidates: cluster primaries (by score desc) then singletons (by score desc).
  clusterPrimaries.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  singletonPrimaries.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const dedupedCandidates = [...clusterPrimaries, ...singletonPrimaries];

  const clusterCount = clusters.size;
  const clusteredMemberCount = [...clusters.values()].reduce((s, m) => s + m.length, 0);
  const metrics: PhashDedupeMetrics = {
    clusterCount,
    totalDeduplicated,
    avgClusterSize: clusterCount > 0 ? clusteredMemberCount / clusterCount : 0,
    avgIntraClusterHammingDistance:
      intraClusterPairCount > 0 ? intraClusterHammingSum / intraClusterPairCount : 0,
  };

  return { clusters, dedupedCandidates, metrics };
}
