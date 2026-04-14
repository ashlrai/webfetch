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
import {
  findDuplicates,
  hammingDistance,
  perceptualHash,
} from "./perceptual-hash.ts";
import type { Fetcher, ImageCandidate } from "./types.ts";

export { perceptualHash, hammingDistance, findDuplicates };

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Drop common cache-buster params.
    for (const k of ["w", "h", "fit", "auto", "q", "fm", "dpr", "crop", "s", "t"]) u.searchParams.delete(k);
    u.hash = "";
    return u.origin + u.pathname + (u.searchParams.toString() ? `?${u.searchParams.toString()}` : "");
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
export function dedupeByHash(
  candidates: ImageCandidate[],
  opts?: number,
): ImageCandidate[];
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
      const phash = await perceptualHash(dl.bytes);
      withHashes.push({ ...c, phash });
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
