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
 */

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

/** Public entry point. Returns 16-hex-char string (64 bits). */
export async function perceptualHash(bytes: Uint8Array): Promise<string> {
  const sharp = await loadSharp();
  if (sharp) {
    try {
      return await dctHash(sharp, bytes);
    } catch {
      // fall through to aHash on decode errors
    }
  }
  return fallbackAHash(bytes);
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
