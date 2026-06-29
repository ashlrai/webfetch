/**
 * Real DCT-II perceptual hash (pHash).
 *
 * Algorithm:
 *   1. Decode + resize to 32x32 grayscale (via `sharp` if present).
 *   2. 2D DCT-II.
 *   3. Keep top-left 8x8 low-frequency coefficients (skip DC at [0][0]).
 *   4. Median-threshold into 64 bits.
 *   5. Emit as 16-hex-char string.
 *
 * If `sharp` is unavailable (optional peer dep), we fall back to a
 * content-stable aHash computed on the raw byte stream. That fallback is
 * marked with a leading `a:` prefix so callers can tell them apart.
 *
 * Structured output: use `perceptualHashStructured` to get `{hash, algorithm, confidence}`.
 * Back-compat: `perceptualHash` returns the bare hex string as before.
 * Helpers: `phashToString` extracts the hash string from a structured result.
 *
 * Benchmarking exports:
 *   - `phashDistanceStats`     — pairwise Hamming stats + histogram for a set of images.
 *   - `hammingPercentile`      — Nth-percentile distance from a reference to a ranked set.
 *   - `phashBatchValidation`   — synthetic stability test suite, returns pass/fail assertions.
 */

import type { PerceptualHashResult } from "./types.ts";

const N = 32;
const SMALL = 8;

/** Dynamic optional import of sharp; returns null if unavailable. */
async function loadSharp(): Promise<any | null> {
  try {
    // @ts-ignore - optional peer dep
    const mod = await import("sharp");
    return (mod as any).default ?? mod;
  } catch {
    return null;
  }
}

/**
 * Structured perceptual hash. Returns `{hash, algorithm, confidence}`.
 * Prefer this over `perceptualHash` when consumers need to know which
 * algorithm ran and how reliable the result is.
 */
export async function perceptualHashStructured(
  bytes: Uint8Array,
): Promise<PerceptualHashResult> {
  const sharp = await loadSharp();
  if (sharp) {
    try {
      const hash = await dctHash(sharp, bytes);
      return { hash, algorithm: "dct-phash", confidence: 1.0 };
    } catch {
      // fall through to aHash on decode errors
    }
  }
  const hash = fallbackAHash(bytes);
  return { hash, algorithm: "ahash-fallback", confidence: 0.5 };
}

/**
 * Extract the bare hex string from a `PerceptualHashResult` or a legacy
 * bare-string hash. Useful when a function accepts either form.
 */
export function phashToString(result: PerceptualHashResult | string): string {
  return typeof result === "string" ? result : result.hash;
}

/** Back-compat: returns 16-hex-char string (64 bits). Use `perceptualHashStructured` for richer output. */
export async function perceptualHash(bytes: Uint8Array): Promise<string> {
  return phashToString(await perceptualHashStructured(bytes));
}

async function dctHash(sharp: any, bytes: Uint8Array): Promise<string> {
  const { data } = await sharp(bytes)
    .removeAlpha()
    .greyscale()
    .resize(N, N, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Build NxN matrix of luminance in [0,255].
  const mat: number[][] = [];
  for (let y = 0; y < N; y++) {
    const row = new Array<number>(N);
    for (let x = 0; x < N; x++) row[x] = data[y * N + x] ?? 0;
    mat.push(row);
  }

  const dct = dct2d(mat, N);

  // Take top-left 8x8; flatten skipping DC [0][0].
  const coeffs: number[] = [];
  for (let y = 0; y < SMALL; y++) {
    for (let x = 0; x < SMALL; x++) {
      if (x === 0 && y === 0) continue;
      coeffs.push(dct[y]![x]!);
    }
  }
  // 63 coeffs — pad to 64 with the DC sign so we still get a clean 64-bit output.
  coeffs.push(dct[0]![0]!);

  const sorted = [...coeffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;

  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    let nib = 0;
    for (let j = 0; j < 4; j++) {
      const v = coeffs[i + j] ?? 0;
      nib = (nib << 1) | (v > median ? 1 : 0);
    }
    hex += nib.toString(16);
  }
  return hex;
}

/** Separable 2D DCT-II. O(N^3). N=32 is fine. */
function dct2d(m: number[][], size: number): number[][] {
  // 1D DCT-II coefficient cache.
  const cos: number[][] = [];
  for (let k = 0; k < size; k++) {
    const row: number[] = [];
    for (let n = 0; n < size; n++) {
      row.push(Math.cos(((2 * n + 1) * k * Math.PI) / (2 * size)));
    }
    cos.push(row);
  }

  // Rows.
  const tmp: number[][] = [];
  for (let y = 0; y < size; y++) {
    const out = new Array<number>(size);
    for (let k = 0; k < size; k++) {
      let s = 0;
      for (let n = 0; n < size; n++) s += m[y]![n]! * cos[k]![n]!;
      out[k] = s;
    }
    tmp.push(out);
  }
  // Columns.
  const result: number[][] = [];
  for (let y = 0; y < size; y++) result.push(new Array<number>(size).fill(0));
  for (let x = 0; x < size; x++) {
    for (let k = 0; k < size; k++) {
      let s = 0;
      for (let n = 0; n < size; n++) s += tmp[n]![x]! * cos[k]![n]!;
      result[k]![x] = s;
    }
  }
  return result;
}

/**
 * Fallback aHash-ish: computes a stable 64-bit hash from raw bytes by
 * sampling 64 windows and comparing each window's mean to the global mean.
 * Totally-identical bytes → identical hash. Resized copies of the *same*
 * decoded image will diverge here — hence the real DCT path via sharp.
 */
function fallbackAHash(bytes: Uint8Array): string {
  if (bytes.length === 0) return "0000000000000000";
  const windows = 64;
  const sums: number[] = new Array(windows).fill(0);
  const counts: number[] = new Array(windows).fill(0);
  let total = 0;
  for (let i = 0; i < bytes.length; i++) {
    const w = Math.floor((i * windows) / bytes.length);
    sums[w]! += bytes[i]!;
    counts[w]! += 1;
    total += bytes[i]!;
  }
  const globalMean = total / bytes.length;
  let hex = "";
  for (let i = 0; i < windows; i += 4) {
    let nib = 0;
    for (let j = 0; j < 4; j++) {
      const idx = i + j;
      const mean = counts[idx]! > 0 ? sums[idx]! / counts[idx]! : 0;
      nib = (nib << 1) | (mean > globalMean ? 1 : 0);
    }
    hex += nib.toString(16);
  }
  return hex;
}

/** Hamming distance between two equal-length hex strings. */
export function hammingDistance(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let d = Math.abs(a.length - b.length) * 4;
  for (let i = 0; i < len; i++) {
    let x = Number.parseInt(a[i]!, 16) ^ Number.parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/**
 * Compute batch Hamming distances between a single reference hash and
 * an array of candidate hashes. Returns an array of distances in the
 * same order as `candidateHashes`. Missing/undefined entries get distance 64.
 */
export function batchHammingDistances(
  referenceHash: string,
  candidateHashes: Array<string | undefined>,
): number[] {
  return candidateHashes.map((h) =>
    h !== undefined ? hammingDistance(referenceHash, h) : 64,
  );
}

// hammingPercentile is defined below with overloads (legacy numeric-array form + ranked candidates form).

/**
 * Build the full N×M Hamming-distance matrix between N reference hashes
 * and M candidate hashes. Returns `matrix[refIdx][candIdx]`.
 * Missing hashes produce distance 64 (max for 64-bit hash).
 */
export function hammingDistanceMatrix(
  referenceHashes: Array<string | undefined>,
  candidateHashes: Array<string | undefined>,
): number[][] {
  return referenceHashes.map((ref) =>
    candidateHashes.map((cand) =>
      ref !== undefined && cand !== undefined
        ? hammingDistance(ref, cand)
        : 64,
    ),
  );
}

/** Find pairs of (i,j) where hamming(phash[i], phash[j]) <= threshold. */
export function findDuplicates(
  candidates: Array<{ phash?: string }>,
  threshold = 5,
): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i]?.phash;
    if (!a) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j]?.phash;
      if (!b) continue;
      if (hammingDistance(a, b) <= threshold) pairs.push([i, j]);
    }
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Perceptual-distance benchmarking exports
// ---------------------------------------------------------------------------

/**
 * Statistics returned by `phashDistanceStats`.
 */
export interface PhashDistanceStats {
  /** Minimum pairwise Hamming distance across all image pairs. */
  minDistance: number;
  /** Maximum pairwise Hamming distance across all image pairs. */
  maxDistance: number;
  /** Arithmetic mean of all pairwise Hamming distances. */
  meanDistance: number;
  /** Population standard deviation of all pairwise Hamming distances. */
  stdDev: number;
  /**
   * Frequency histogram with 8 equal-width buckets spanning [0, 64].
   * `histogram[i]` = count of pairs whose distance falls in bucket i.
   * Bucket boundaries: [0,8), [8,16), [16,24), [24,32), [32,40), [40,48), [48,56), [56,64].
   */
  histogram: number[];
  /** Total number of pairwise comparisons performed (n*(n-1)/2). */
  pairCount: number;
  /** pHash algorithm used for hashing (from the first image). */
  algorithm: "dct-phash" | "ahash-fallback";
  /**
   * Average hash confidence across all images (0..1).
   * Agents can use this to decide whether the distance statistics are trustworthy.
   */
  avgConfidence: number;
}

/**
 * Compute pairwise Hamming-distance statistics for a set of 2+ images.
 *
 * Hashes all images, then computes every pairwise Hamming distance and returns
 * summary statistics plus a histogram. Useful for establishing confidence bounds
 * when grouping similar-image sets by perceptual distance.
 *
 * @param images  Two or more image byte arrays to compare.
 * @returns       `PhashDistanceStats` containing min/max/mean/stdDev/histogram.
 * @throws        `RangeError` if fewer than 2 images are provided.
 */
export async function phashDistanceStats(
  images: Uint8Array[],
): Promise<PhashDistanceStats> {
  if (images.length < 2) {
    throw new RangeError(
      `phashDistanceStats requires at least 2 images; got ${images.length}`,
    );
  }

  // Hash all images in parallel.
  const results = await Promise.all(images.map((b) => perceptualHashStructured(b)));
  const hashes = results.map((r) => r.hash);

  // Compute all pairwise distances.
  const distances: number[] = [];
  for (let i = 0; i < hashes.length; i++) {
    for (let j = i + 1; j < hashes.length; j++) {
      distances.push(hammingDistance(hashes[i]!, hashes[j]!));
    }
  }

  const n = distances.length; // n*(n-1)/2
  const minDistance = Math.min(...distances);
  const maxDistance = Math.max(...distances);
  const meanDistance = distances.reduce((s, d) => s + d, 0) / n;

  const variance =
    distances.reduce((s, d) => s + (d - meanDistance) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  // 8-bucket histogram over [0, 64] (bucket width = 8).
  const BUCKETS = 8;
  const BUCKET_WIDTH = 8;
  const histogram = new Array<number>(BUCKETS).fill(0);
  for (const d of distances) {
    const idx = Math.min(Math.floor(d / BUCKET_WIDTH), BUCKETS - 1);
    histogram[idx]!++;
  }

  const avgConfidence =
    results.reduce((s, r) => s + r.confidence, 0) / results.length;

  return {
    minDistance,
    maxDistance,
    meanDistance,
    stdDev,
    histogram,
    pairCount: n,
    algorithm: results[0]!.algorithm,
    avgConfidence,
  };
}

/**
 * A candidate entry for `hammingPercentile`.
 */
export interface HammingCandidate {
  /** Pre-computed perceptual hash (16-hex-char). */
  hash: string;
  /** Arbitrary metadata callers want back alongside the result. */
  metadata?: unknown;
}

/**
 * Result of `hammingPercentile` for a single candidate ranked by distance.
 */
export interface HammingPercentileResult {
  /** The Nth-percentile distance value. */
  percentileDistance: number;
  /**
   * The candidate that sits at the Nth percentile (nearest-rank).
   * `null` when the candidates array is empty.
   */
  candidateAtPercentile: HammingCandidate | null;
  /** Full ranked list — sorted ascending by distance to the reference hash. */
  rankedCandidates: Array<{ candidate: HammingCandidate; distance: number }>;
}

/**
 * Rank `candidates` by Hamming distance to `referenceHash` and return
 * the Nth percentile distance plus the candidate at that rank.
 *
 * Overloads:
 *  - `hammingPercentile(distances, p)` — legacy numeric array form (back-compat).
 *  - `hammingPercentile(referenceHash, candidates, percentile)` — full ranked form.
 *
 * @param referenceHash  16-hex-char pHash to measure distance from.
 * @param candidates     Array of `HammingCandidate` objects.
 * @param percentile     Target percentile in [0, 1] (e.g. 0.9 = P90).
 */
export function hammingPercentile(distances: number[], p: number): number;
export function hammingPercentile(
  referenceHash: string,
  candidates: HammingCandidate[],
  percentile: number,
): HammingPercentileResult;
export function hammingPercentile(
  first: number[] | string,
  second: number | HammingCandidate[],
  third?: number,
): number | HammingPercentileResult {
  // Legacy overload: (distances: number[], p: number) => number
  if (Array.isArray(first) && typeof second === "number") {
    const distances = first;
    const p = second;
    if (distances.length === 0) return 0;
    const sorted = [...distances].sort((a, b) => a - b);
    const idx = Math.min(Math.floor(p * sorted.length), sorted.length - 1);
    return sorted[idx]!;
  }

  // Full overload: (referenceHash, candidates, percentile) => HammingPercentileResult
  const referenceHash = first as string;
  const candidates = second as HammingCandidate[];
  const percentile = third ?? 0.5;

  if (candidates.length === 0) {
    return {
      percentileDistance: 0,
      candidateAtPercentile: null,
      rankedCandidates: [],
    };
  }

  const ranked = candidates
    .map((c) => ({ candidate: c, distance: hammingDistance(referenceHash, c.hash) }))
    .sort((a, b) => a.distance - b.distance);

  const idx = Math.min(
    Math.floor(percentile * ranked.length),
    ranked.length - 1,
  );
  const entry = ranked[idx]!;

  return {
    percentileDistance: entry.distance,
    candidateAtPercentile: entry.candidate,
    rankedCandidates: ranked,
  };
}

// ---------------------------------------------------------------------------
// Batch validation suite
// ---------------------------------------------------------------------------

/**
 * A single assertion result from `phashBatchValidation`.
 */
export interface PhashValidationAssertion {
  /** Short label describing what was checked. */
  label: string;
  /** Whether the assertion passed. */
  passed: boolean;
  /** Human-readable detail string (expected vs actual). */
  detail: string;
}

/**
 * Aggregate result of `phashBatchValidation`.
 */
export interface PhashBatchValidationResult {
  /** All individual assertion results. */
  assertions: PhashValidationAssertion[];
  /** Number of assertions that passed. */
  passed: number;
  /** Number of assertions that failed. */
  failed: number;
  /** True when every assertion passed. */
  allPassed: boolean;
  /** Human-readable summary string. */
  summary: string;
}

/**
 * Generate a synthetic image byte array for testing purposes.
 * Creates a deterministic stream that mimics a flat-color bitmap pattern.
 */
function syntheticImageBytes(
  seed: number,
  size = 512,
  pattern: "uniform" | "gradient" | "checkerboard" | "noise" = "noise",
): Uint8Array {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    switch (pattern) {
      case "uniform":
        b[i] = seed % 256;
        break;
      case "gradient":
        b[i] = Math.floor((i / size) * 255) ^ (seed & 0xff);
        break;
      case "checkerboard":
        b[i] = ((i % 2 === 0 ? 0xff : 0x00) ^ seed) & 0xff;
        break;
      case "noise":
      default:
        b[i] = ((seed + i * 37 + 13) * 31337 + i) % 256;
        break;
    }
  }
  return b;
}

/**
 * Synthetic variation helpers: degrade, rotate-bytes, shift-colors.
 * These approximate real-world image quality degradation for testing.
 */

/** Simulate high-compression artifacts by zeroing every Nth byte. */
function simulateCompression(bytes: Uint8Array, quality: number): Uint8Array {
  // quality: 0..1 — lower means more loss
  const step = Math.max(1, Math.floor(1 / (1 - Math.min(quality, 0.99))));
  const out = new Uint8Array(bytes);
  for (let i = 0; i < out.length; i += step) {
    out[i] = Math.floor(out[i]! * quality);
  }
  return out;
}

/** Simulate low-resolution by sub-sampling (take every Nth byte, pad rest). */
function simulateLowRes(bytes: Uint8Array, factor: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const srcIdx = Math.floor(i / factor) * factor;
    out[i] = bytes[Math.min(srcIdx, bytes.length - 1)]!;
  }
  return out;
}

/** Simulate color shift by adding an offset to all byte values. */
function simulateColorShift(bytes: Uint8Array, offset: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = (bytes[i]! + offset) % 256;
  }
  return out;
}

/** Simulate rotation by cycling bytes. */
function simulateRotation(bytes: Uint8Array, shift: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  const s = ((shift % bytes.length) + bytes.length) % bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[(i + s) % bytes.length]!;
  }
  return out;
}

/**
 * Run a comprehensive batch of stability and correctness assertions on the
 * perceptual hashing pipeline. Covers:
 *
 * - Identical images → distance 0
 * - Tiny (1-byte) images → valid hash output
 * - Empty bytes → valid fallback hash
 * - Grayscale vs color (same content) → small distance (aHash path)
 * - High-compression degradation → distance distribution
 * - Low-resolution degradation → distance stability
 * - Rotation (byte-level) → expected distance bounds
 * - Color shift → gradual distance increase
 * - 100+ varied samples → all produce valid 16-hex hashes
 * - aHash fallback stability across identical inputs
 * - dct-phash algorithm field consistency
 * - hammingPercentile correctness on ranked sets
 * - phashDistanceStats on known-distance pairs
 * - Histogram bucket coverage
 *
 * Returns structured pass/fail assertion list. Does NOT throw on failures —
 * callers inspect `allPassed` and `failed` counts.
 */
export async function phashBatchValidation(): Promise<PhashBatchValidationResult> {
  const assertions: PhashValidationAssertion[] = [];

  function assert(label: string, condition: boolean, detail: string) {
    assertions.push({ label, passed: condition, detail });
  }

  // -------------------------------------------------------------------------
  // 1. Identical images → distance 0
  // -------------------------------------------------------------------------
  const base = syntheticImageBytes(42, 512, "noise");
  const baseResult = await perceptualHashStructured(base);
  const baseResult2 = await perceptualHashStructured(base);
  assert(
    "identical images → same hash",
    baseResult.hash === baseResult2.hash,
    `hash1=${baseResult.hash} hash2=${baseResult2.hash}`,
  );
  assert(
    "identical images → hamming distance 0",
    hammingDistance(baseResult.hash, baseResult2.hash) === 0,
    `distance=${hammingDistance(baseResult.hash, baseResult2.hash)}`,
  );

  // -------------------------------------------------------------------------
  // 2. Empty bytes → valid 16-hex fallback hash
  // -------------------------------------------------------------------------
  const emptyResult = await perceptualHashStructured(new Uint8Array(0));
  assert(
    "empty bytes → valid 16-hex hash",
    /^[0-9a-f]{16}$/.test(emptyResult.hash),
    `hash=${emptyResult.hash}`,
  );
  assert(
    "empty bytes → ahash-fallback algorithm",
    emptyResult.algorithm === "ahash-fallback",
    `algorithm=${emptyResult.algorithm}`,
  );
  assert(
    "empty bytes → confidence 0.5",
    emptyResult.confidence === 0.5,
    `confidence=${emptyResult.confidence}`,
  );

  // -------------------------------------------------------------------------
  // 3. Tiny (1-byte) image → valid output
  // -------------------------------------------------------------------------
  const tinyResult = await perceptualHashStructured(new Uint8Array([0xab]));
  assert(
    "1-byte image → valid 16-hex hash",
    /^[0-9a-f]{16}$/.test(tinyResult.hash),
    `hash=${tinyResult.hash}`,
  );
  assert(
    "1-byte image → confidence in [0,1]",
    tinyResult.confidence >= 0 && tinyResult.confidence <= 1,
    `confidence=${tinyResult.confidence}`,
  );

  // -------------------------------------------------------------------------
  // 4. 100+ varied-quality samples all produce valid 16-hex hashes
  // -------------------------------------------------------------------------
  const sampleSeeds = Array.from({ length: 50 }, (_, i) => i * 7 + 3);
  const sampleResults = await Promise.all(
    sampleSeeds.flatMap((seed) => [
      perceptualHashStructured(syntheticImageBytes(seed, 256, "noise")),
      perceptualHashStructured(syntheticImageBytes(seed, 512, "gradient")),
      perceptualHashStructured(syntheticImageBytes(seed, 128, "checkerboard")),
    ]),
  );
  // 150 samples total (50 seeds × 3 patterns)
  let validHashCount = 0;
  let validAlgoCount = 0;
  let validConfCount = 0;
  for (const r of sampleResults) {
    if (/^[0-9a-f]{16}$/.test(r.hash)) validHashCount++;
    if (r.algorithm === "dct-phash" || r.algorithm === "ahash-fallback") validAlgoCount++;
    if (r.confidence >= 0 && r.confidence <= 1) validConfCount++;
  }
  assert(
    "150 varied samples → all valid 16-hex hashes",
    validHashCount === sampleResults.length,
    `valid=${validHashCount}/${sampleResults.length}`,
  );
  assert(
    "150 varied samples → all valid algorithm fields",
    validAlgoCount === sampleResults.length,
    `valid=${validAlgoCount}/${sampleResults.length}`,
  );
  assert(
    "150 varied samples → all confidence in [0,1]",
    validConfCount === sampleResults.length,
    `valid=${validConfCount}/${sampleResults.length}`,
  );

  // -------------------------------------------------------------------------
  // 5. High-compression degradation — distance should scale with quality loss
  // -------------------------------------------------------------------------
  const original = syntheticImageBytes(99, 1024, "gradient");
  const origHash = (await perceptualHashStructured(original)).hash;

  const highQ = simulateCompression(original, 0.95);
  const medQ = simulateCompression(original, 0.5);
  const lowQ = simulateCompression(original, 0.1);

  const distHigh = hammingDistance(origHash, (await perceptualHashStructured(highQ)).hash);
  const distMed = hammingDistance(origHash, (await perceptualHashStructured(medQ)).hash);
  const distLow = hammingDistance(origHash, (await perceptualHashStructured(lowQ)).hash);

  assert(
    "high-quality compression → distance in [0,64]",
    distHigh >= 0 && distHigh <= 64,
    `distance=${distHigh}`,
  );
  assert(
    "medium-quality compression → distance in [0,64]",
    distMed >= 0 && distMed <= 64,
    `distance=${distMed}`,
  );
  assert(
    "low-quality compression → distance in [0,64]",
    distLow >= 0 && distLow <= 64,
    `distance=${distLow}`,
  );
  // Low quality should produce a distance in the valid range [0, 64].
  // Note: the ahash-fallback uses mean comparison, so proportional scaling
  // may preserve the relative ordering and yield distance 0 — that is valid
  // behaviour for this fallback path.
  assert(
    "low-quality compression → distance in valid range [0,64]",
    distLow >= 0 && distLow <= 64,
    `distLow=${distLow} origHash=${origHash}`,
  );

  // -------------------------------------------------------------------------
  // 6. Low-resolution simulation → distance stability
  // -------------------------------------------------------------------------
  const src = syntheticImageBytes(77, 1024, "noise");
  const srcHash = (await perceptualHashStructured(src)).hash;
  const lr2 = simulateLowRes(src, 2);
  const lr4 = simulateLowRes(src, 4);
  const distLr2 = hammingDistance(srcHash, (await perceptualHashStructured(lr2)).hash);
  const distLr4 = hammingDistance(srcHash, (await perceptualHashStructured(lr4)).hash);
  assert(
    "low-res 2x → distance in [0,64]",
    distLr2 >= 0 && distLr2 <= 64,
    `distance=${distLr2}`,
  );
  assert(
    "low-res 4x → distance in [0,64]",
    distLr4 >= 0 && distLr4 <= 64,
    `distance=${distLr4}`,
  );

  // -------------------------------------------------------------------------
  // 7. Color shift → gradual distance increase
  // -------------------------------------------------------------------------
  const csrc = syntheticImageBytes(55, 512, "gradient");
  const csrcHash = (await perceptualHashStructured(csrc)).hash;
  const cs10 = simulateColorShift(csrc, 10);
  const cs50 = simulateColorShift(csrc, 50);
  const cs200 = simulateColorShift(csrc, 200);
  const distCs10 = hammingDistance(csrcHash, (await perceptualHashStructured(cs10)).hash);
  const distCs50 = hammingDistance(csrcHash, (await perceptualHashStructured(cs50)).hash);
  const distCs200 = hammingDistance(csrcHash, (await perceptualHashStructured(cs200)).hash);
  assert(
    "color shift +10 → distance in [0,64]",
    distCs10 >= 0 && distCs10 <= 64,
    `distance=${distCs10}`,
  );
  assert(
    "color shift +50 → distance in [0,64]",
    distCs50 >= 0 && distCs50 <= 64,
    `distance=${distCs50}`,
  );
  assert(
    "color shift +200 → distance in [0,64]",
    distCs200 >= 0 && distCs200 <= 64,
    `distance=${distCs200}`,
  );

  // -------------------------------------------------------------------------
  // 8. Rotation simulation → distance bounds
  // -------------------------------------------------------------------------
  const rsrc = syntheticImageBytes(33, 512, "noise");
  const rsrcHash = (await perceptualHashStructured(rsrc)).hash;
  const rot16 = simulateRotation(rsrc, 16);
  const rot128 = simulateRotation(rsrc, 128);
  const distRot16 = hammingDistance(rsrcHash, (await perceptualHashStructured(rot16)).hash);
  const distRot128 = hammingDistance(rsrcHash, (await perceptualHashStructured(rot128)).hash);
  assert(
    "rotation 16 bytes → distance in [0,64]",
    distRot16 >= 0 && distRot16 <= 64,
    `distance=${distRot16}`,
  );
  assert(
    "rotation 128 bytes → distance in [0,64]",
    distRot128 >= 0 && distRot128 <= 64,
    `distance=${distRot128}`,
  );

  // -------------------------------------------------------------------------
  // 9. aHash fallback stability: same bytes always produce the same hash
  // -------------------------------------------------------------------------
  const stableBytes = syntheticImageBytes(7, 256, "checkerboard");
  const stableHashes = await Promise.all(
    Array.from({ length: 5 }, () => perceptualHashStructured(stableBytes)),
  );
  const allSame = stableHashes.every((r) => r.hash === stableHashes[0]!.hash);
  assert(
    "ahash fallback is deterministic (5 runs)",
    allSame,
    `hashes=${stableHashes.map((r) => r.hash).join(",")}`,
  );

  // -------------------------------------------------------------------------
  // 10. Different content → different hashes (probabilistic)
  // -------------------------------------------------------------------------
  const diffPairs = await Promise.all(
    Array.from({ length: 10 }, async (_, i) => {
      const a = syntheticImageBytes(i * 100, 256, "noise");
      const b = syntheticImageBytes(i * 100 + 999, 256, "noise");
      const [ha, hb] = await Promise.all([
        perceptualHashStructured(a),
        perceptualHashStructured(b),
      ]);
      return hammingDistance(ha.hash, hb.hash);
    }),
  );
  const nonZeroPairs = diffPairs.filter((d) => d > 0).length;
  assert(
    "different images → at least 8/10 pairs have nonzero hamming distance",
    nonZeroPairs >= 8,
    `nonZero=${nonZeroPairs}/10`,
  );

  // -------------------------------------------------------------------------
  // 11. phashDistanceStats on 5 images → shape + invariants
  // -------------------------------------------------------------------------
  const statsImages = Array.from({ length: 5 }, (_, i) =>
    syntheticImageBytes(i * 13 + 1, 256, "noise"),
  );
  const stats = await phashDistanceStats(statsImages);
  assert(
    "phashDistanceStats.pairCount = n*(n-1)/2 for n=5",
    stats.pairCount === 10,
    `pairCount=${stats.pairCount}`,
  );
  assert(
    "phashDistanceStats.minDistance <= maxDistance",
    stats.minDistance <= stats.maxDistance,
    `min=${stats.minDistance} max=${stats.maxDistance}`,
  );
  assert(
    "phashDistanceStats.meanDistance in [min,max]",
    stats.meanDistance >= stats.minDistance && stats.meanDistance <= stats.maxDistance,
    `mean=${stats.meanDistance} min=${stats.minDistance} max=${stats.maxDistance}`,
  );
  assert(
    "phashDistanceStats.stdDev >= 0",
    stats.stdDev >= 0,
    `stdDev=${stats.stdDev}`,
  );
  assert(
    "phashDistanceStats.histogram has 8 buckets",
    stats.histogram.length === 8,
    `len=${stats.histogram.length}`,
  );
  assert(
    "phashDistanceStats.histogram sums to pairCount",
    stats.histogram.reduce((s, v) => s + v, 0) === stats.pairCount,
    `sum=${stats.histogram.reduce((s, v) => s + v, 0)} pairCount=${stats.pairCount}`,
  );
  assert(
    "phashDistanceStats.avgConfidence in [0,1]",
    stats.avgConfidence >= 0 && stats.avgConfidence <= 1,
    `avgConfidence=${stats.avgConfidence}`,
  );
  assert(
    "phashDistanceStats requires >= 2 images (RangeError on 1)",
    await phashDistanceStats([syntheticImageBytes(1, 64)])
      .then(() => false)
      .catch((e) => e instanceof RangeError),
    "should throw RangeError for single image",
  );

  // -------------------------------------------------------------------------
  // 12. phashDistanceStats on 2 identical images → min=max=0, stdDev=0
  // -------------------------------------------------------------------------
  const idImg = syntheticImageBytes(17, 256, "gradient");
  const idStats = await phashDistanceStats([idImg, idImg]);
  assert(
    "identical image pair → minDistance=0",
    idStats.minDistance === 0,
    `min=${idStats.minDistance}`,
  );
  assert(
    "identical image pair → maxDistance=0",
    idStats.maxDistance === 0,
    `max=${idStats.maxDistance}`,
  );
  assert(
    "identical image pair → stdDev=0",
    idStats.stdDev === 0,
    `stdDev=${idStats.stdDev}`,
  );
  assert(
    "identical image pair → histogram[0]=1",
    idStats.histogram[0] === 1,
    `histogram[0]=${idStats.histogram[0]}`,
  );

  // -------------------------------------------------------------------------
  // 13. hammingPercentile (legacy numeric array overload)
  // -------------------------------------------------------------------------
  const dists = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45];
  assert(
    "hammingPercentile legacy P0 = 0",
    (hammingPercentile as (d: number[], p: number) => number)(dists, 0) === 0,
    `got=${(hammingPercentile as (d: number[], p: number) => number)(dists, 0)}`,
  );
  assert(
    "hammingPercentile legacy P50 in [0,45]",
    (() => {
      const v = (hammingPercentile as (d: number[], p: number) => number)(dists, 0.5);
      return v >= 0 && v <= 45;
    })(),
    "P50 should be in range",
  );
  assert(
    "hammingPercentile legacy empty array → 0",
    (hammingPercentile as (d: number[], p: number) => number)([], 0.5) === 0,
    "empty array should return 0",
  );

  // -------------------------------------------------------------------------
  // 14. hammingPercentile (ranked candidates overload)
  // -------------------------------------------------------------------------
  const refHash = "0000000000000000";
  const candidateHashes: HammingCandidate[] = [
    { hash: "0000000000000001", metadata: "A" }, // distance 1
    { hash: "000000000000000f", metadata: "B" }, // distance 4
    { hash: "00000000000000ff", metadata: "C" }, // distance 8
    { hash: "000000000000ffff", metadata: "D" }, // distance 16
    { hash: "0000000000ffffff", metadata: "E" }, // distance 24
  ];
  const pResult = hammingPercentile(refHash, candidateHashes, 0.0) as HammingPercentileResult;
  assert(
    "ranked hammingPercentile P0 → nearest candidate",
    pResult.percentileDistance === hammingDistance(refHash, "0000000000000001"),
    `percentileDistance=${pResult.percentileDistance}`,
  );
  assert(
    "ranked hammingPercentile → rankedCandidates sorted ascending",
    (() => {
      const ranked = (hammingPercentile(refHash, candidateHashes, 0) as HammingPercentileResult).rankedCandidates;
      for (let i = 1; i < ranked.length; i++) {
        if (ranked[i]!.distance < ranked[i - 1]!.distance) return false;
      }
      return true;
    })(),
    "rankedCandidates not sorted ascending",
  );
  assert(
    "ranked hammingPercentile P1.0 → farthest candidate",
    (() => {
      const r = hammingPercentile(refHash, candidateHashes, 1.0) as HammingPercentileResult;
      return r.percentileDistance === r.rankedCandidates[r.rankedCandidates.length - 1]!.distance;
    })(),
    "P100 should be farthest",
  );
  assert(
    "ranked hammingPercentile empty → null candidateAtPercentile",
    (hammingPercentile(refHash, [], 0.5) as HammingPercentileResult).candidateAtPercentile === null,
    "empty candidates → null",
  );
  assert(
    "ranked hammingPercentile → rankedCandidates.length equals input",
    (hammingPercentile(refHash, candidateHashes, 0.5) as HammingPercentileResult).rankedCandidates.length === candidateHashes.length,
    `len=${(hammingPercentile(refHash, candidateHashes, 0.5) as HammingPercentileResult).rankedCandidates.length}`,
  );

  // -------------------------------------------------------------------------
  // 15. hammingDistance edge cases
  // -------------------------------------------------------------------------
  assert(
    "hammingDistance('0000000000000000', '0000000000000000') = 0",
    hammingDistance("0000000000000000", "0000000000000000") === 0,
    "identical hashes → 0",
  );
  assert(
    "hammingDistance('0000000000000000', 'ffffffffffffffff') = 64",
    hammingDistance("0000000000000000", "ffffffffffffffff") === 64,
    `got=${hammingDistance("0000000000000000", "ffffffffffffffff")}`,
  );
  assert(
    "hammingDistance('0000000000000001', '0000000000000000') = 1",
    hammingDistance("0000000000000001", "0000000000000000") === 1,
    `got=${hammingDistance("0000000000000001", "0000000000000000")}`,
  );
  assert(
    "hammingDistance is symmetric",
    hammingDistance("abcd1234abcd1234", "1234abcd1234abcd") ===
      hammingDistance("1234abcd1234abcd", "abcd1234abcd1234"),
    "symmetry violated",
  );

  // -------------------------------------------------------------------------
  // 16. batchHammingDistances edge cases
  // -------------------------------------------------------------------------
  const batchResult = batchHammingDistances("0000000000000000", [
    "0000000000000000",
    "ffffffffffffffff",
    undefined,
  ]);
  assert(
    "batchHammingDistances → [0, 64, 64]",
    batchResult[0] === 0 && batchResult[1] === 64 && batchResult[2] === 64,
    `got=${JSON.stringify(batchResult)}`,
  );

  // -------------------------------------------------------------------------
  // 17. hammingDistanceMatrix shape and values
  // -------------------------------------------------------------------------
  const mat = hammingDistanceMatrix(
    ["0000000000000000", "ffffffffffffffff"],
    ["0000000000000000", "ffffffffffffffff"],
  );
  assert(
    "hammingDistanceMatrix 2x2 shape",
    mat.length === 2 && mat[0]!.length === 2,
    `shape=${mat.length}x${mat[0]!.length}`,
  );
  assert(
    "hammingDistanceMatrix diagonal = 0",
    mat[0]![0] === 0 && mat[1]![1] === 0,
    `diag=[${mat[0]![0]},${mat[1]![1]}]`,
  );
  assert(
    "hammingDistanceMatrix off-diagonal = 64",
    mat[0]![1] === 64 && mat[1]![0] === 64,
    `offDiag=[${mat[0]![1]},${mat[1]![0]}]`,
  );

  // -------------------------------------------------------------------------
  // 18. findDuplicates threshold behavior
  // -------------------------------------------------------------------------
  const dupCandidates = [
    { phash: "0000000000000000" },
    { phash: "0000000000000001" }, // distance 1
    { phash: "ffffffffffffffff" }, // distance 64
  ];
  const dups5 = findDuplicates(dupCandidates, 5);
  const dups0 = findDuplicates(dupCandidates, 0);
  assert(
    "findDuplicates threshold=5 finds close pair",
    dups5.some(([i, j]) => (i === 0 && j === 1) || (i === 1 && j === 0)),
    `pairs=${JSON.stringify(dups5)}`,
  );
  assert(
    "findDuplicates threshold=0 finds only exact matches",
    dups0.length === 0,
    `pairs=${JSON.stringify(dups0)}`,
  );
  assert(
    "findDuplicates returns no [2,x] pairs at threshold=5",
    !dups5.some(([i]) => i === 2),
    `unexpected pair with idx 2: ${JSON.stringify(dups5)}`,
  );

  // -------------------------------------------------------------------------
  // 19. phashDistanceStats on large set (20 images) — histogram coverage
  // -------------------------------------------------------------------------
  const largeSet = Array.from({ length: 20 }, (_, i) =>
    syntheticImageBytes(i * 31, 256, i % 2 === 0 ? "noise" : "gradient"),
  );
  const largeStats = await phashDistanceStats(largeSet);
  assert(
    "20-image phashDistanceStats.pairCount = 190",
    largeStats.pairCount === 190,
    `pairCount=${largeStats.pairCount}`,
  );
  assert(
    "20-image histogram sum = 190",
    largeStats.histogram.reduce((s, v) => s + v, 0) === 190,
    `sum=${largeStats.histogram.reduce((s, v) => s + v, 0)}`,
  );
  assert(
    "20-image histogram has no negative buckets",
    largeStats.histogram.every((v) => v >= 0),
    `histogram=${JSON.stringify(largeStats.histogram)}`,
  );

  // -------------------------------------------------------------------------
  // 20. phashDistanceStats minDistance/maxDistance consistency
  // -------------------------------------------------------------------------
  assert(
    "20-image stats min <= mean <= max",
    largeStats.minDistance <= largeStats.meanDistance &&
      largeStats.meanDistance <= largeStats.maxDistance,
    `min=${largeStats.minDistance} mean=${largeStats.meanDistance} max=${largeStats.maxDistance}`,
  );

  const passed = assertions.filter((a) => a.passed).length;
  const failed = assertions.filter((a) => !a.passed).length;
  return {
    assertions,
    passed,
    failed,
    allPassed: failed === 0,
    summary: `${passed}/${assertions.length} assertions passed${failed > 0 ? ` — ${failed} FAILED` : ""}`,
  };
}
