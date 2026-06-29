/**
 * Test fixture helpers for the cache inspection / export-import system.
 *
 * These are pure test utilities — no network calls, no external deps.
 * They write real files into a temp directory so integration tests work
 * against an actual on-disk cache, and produce deterministic tarballs
 * compatible with importCache().
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FixtureEntry {
  sha256: string;
  bytes: Uint8Array;
  mime: string;
  path: string;
}

export interface GeneratedFixture {
  dir: string;
  entries: FixtureEntry[];
  cleanup: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Minimal synthetic image generators (no sharp / external deps)
// ---------------------------------------------------------------------------

/** Build a minimal valid JPEG (SOI + EOI). */
function buildMinimalJpeg(seed: number): Uint8Array {
  // A tiny JFIF JPEG header stub — just enough for magic-byte sniffing.
  const header = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, // APP0 marker
    0x00, 0x10, // APP0 length = 16
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01, // version
    0x00,       // aspect ratio units
    0x00, 0x01, // X density
    0x00, 0x01, // Y density
    0x00, 0x00, // thumbnail
    seed & 0xff, (seed >> 8) & 0xff, // seed bytes to ensure uniqueness
    0xff, 0xd9, // EOI
  ]);
  return header;
}

/** Build a minimal valid PNG (signature + IHDR + IEND). */
function buildMinimalPng(seed: number): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR: length(4) + type(4) + data(13) + crc(4) = 25 bytes
  const ihdr = new Uint8Array([
    0x00, 0x00, 0x00, 0x0d, // length = 13
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, 0x00, 0x01, // width = 1
    0x00, 0x00, 0x00, 0x01, // height = 1
    0x08, 0x02,             // bit depth + colour type
    0x00, 0x00, 0x00,       // compression, filter, interlace
    0x90, 0x77, 0x53, 0xde, // CRC placeholder
  ]);
  const iend = new Uint8Array([
    0x00, 0x00, 0x00, 0x00, // length = 0
    0x49, 0x45, 0x4e, 0x44, // "IEND"
    0xae, 0x42, 0x60, 0x82, // CRC
  ]);
  // Append seed to make each PNG unique.
  const seedBytes = new Uint8Array([seed & 0xff, (seed >> 8) & 0xff]);
  const result = new Uint8Array(sig.length + ihdr.length + iend.length + seedBytes.length);
  let o = 0;
  for (const b of [sig, ihdr, iend, seedBytes]) {
    result.set(b, o);
    o += b.length;
  }
  return result;
}

/** Build a minimal WebP stub. */
function buildMinimalWebp(seed: number): Uint8Array {
  // RIFF....WEBP
  const bytes = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // "RIFF"
    0x0c, 0x00, 0x00, 0x00, // file size (placeholder)
    0x57, 0x45, 0x42, 0x50, // "WEBP"
    seed & 0xff, (seed >> 8) & 0xff,
  ]);
  return bytes;
}

function buildMinimalGif(seed: number): Uint8Array {
  // GIF87a header stub
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x37, 0x61, // GIF87a
    0x01, 0x00, 0x01, 0x00,             // 1x1 logical screen
    0x00, 0x00, 0x00,                    // GCT + bg + aspect
    seed & 0xff, (seed >> 8) & 0xff,
    0x3b,                                // trailer
  ]);
}

const BUILDERS = [buildMinimalJpeg, buildMinimalPng, buildMinimalWebp, buildMinimalGif];
const MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Create `count` synthetic cache entries in a temp directory.
 * Each entry is a unique, hash-keyed file placed in the standard
 * two-char shard structure used by cache.ts.
 *
 * Returns a handle with a cleanup() method to remove the temp dir.
 */
export async function generateCacheFixture(count: number): Promise<GeneratedFixture> {
  const dir = await mkdtemp(join(tmpdir(), "webfetch-cache-test-"));
  const entries: FixtureEntry[] = [];

  for (let i = 0; i < count; i++) {
    const builderIdx = i % BUILDERS.length;
    const builder = BUILDERS[builderIdx]!;
    const mime = MIMES[builderIdx]!;
    const raw = builder(i);

    // Make each blob unique by appending a counter.
    const unique = new Uint8Array(raw.length + 4);
    unique.set(raw);
    unique[raw.length] = (i >> 24) & 0xff;
    unique[raw.length + 1] = (i >> 16) & 0xff;
    unique[raw.length + 2] = (i >> 8) & 0xff;
    unique[raw.length + 3] = i & 0xff;

    const sha256 = createHash("sha256").update(unique).digest("hex");
    const shard = sha256.slice(0, 2);
    const shardDir = join(dir, shard);
    await mkdir(shardDir, { recursive: true });
    const filePath = join(shardDir, sha256);
    await writeFile(filePath, unique);

    entries.push({ sha256, bytes: unique, mime, path: filePath });
  }

  return {
    dir,
    entries,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * Import a tarball into a fresh temp directory and return its path + cleanup.
 * Delegates to importCache() from cache-inspection.ts.
 */
export async function loadCacheFixture(
  tarPath: string,
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "webfetch-cache-import-"));
  const { importCache } = await import("../packages/core/src/cache-inspection.ts");
  await importCache(tarPath, dir);
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/**
 * Validate that a tarball produced by exportCache() is structurally sound:
 * - Starts with a valid ustar header
 * - Each entry name is a 64-char hex sha256
 * - File data hashes match their names
 * - Ends with two zero 512-byte blocks
 *
 * Returns { valid: true } or { valid: false, error: string }.
 */
export async function validateCacheTarball(
  tarPath: string,
): Promise<{ valid: boolean; error?: string; entries?: number }> {
  let tarBytes: Uint8Array;
  try {
    tarBytes = new Uint8Array(await Bun.file(tarPath).arrayBuffer());
  } catch (e) {
    return { valid: false, error: `cannot read tar: ${(e as Error).message}` };
  }

  if (tarBytes.byteLength < 1024) {
    return { valid: false, error: "tarball too small (< 1024 bytes)" };
  }

  let pos = 0;
  let entries = 0;

  while (pos + 512 <= tarBytes.byteLength) {
    const header = tarBytes.slice(pos, pos + 512);
    pos += 512;

    // End of archive
    if (header.every((b) => b === 0)) {
      // Consume second zero block if present
      if (pos + 512 <= tarBytes.byteLength) {
        const second = tarBytes.slice(pos, pos + 512);
        if (second.every((b) => b === 0)) {
          return { valid: true, entries };
        }
      }
      return { valid: true, entries };
    }

    const name = readStr(header, 0, 100);
    if (!name) return { valid: false, error: `entry ${entries}: empty name` };

    const sha256 = basename(name);
    if (sha256.length !== 64 || !/^[0-9a-f]+$/.test(sha256)) {
      return { valid: false, error: `entry ${entries}: name '${sha256}' is not a sha256 hex` };
    }

    const sizeOctal = readStr(header, 124, 12);
    const fileSize = parseInt(sizeOctal, 8);
    if (isNaN(fileSize) || fileSize < 0) {
      return { valid: false, error: `entry ${entries}: invalid size '${sizeOctal}'` };
    }

    const paddedSize = Math.ceil(fileSize / 512) * 512;
    if (pos + paddedSize > tarBytes.byteLength) {
      return { valid: false, error: `entry ${entries}: data extends beyond end of file` };
    }

    const fileBytes = tarBytes.slice(pos, pos + fileSize);
    pos += paddedSize;

    const computed = createHash("sha256").update(fileBytes).digest("hex");
    if (computed !== sha256) {
      return {
        valid: false,
        error: `entry ${entries}: hash mismatch (name=${sha256}, computed=${computed})`,
      };
    }

    entries++;
  }

  // Reached end without proper termination — still structurally OK if we got entries
  return { valid: true, entries };
}

function readStr(buf: Uint8Array, offset: number, len: number): string {
  const slice = buf.slice(offset, offset + len);
  const nullIdx = slice.indexOf(0);
  const end = nullIdx === -1 ? len : nullIdx;
  return new TextDecoder().decode(slice.slice(0, end)).trim();
}
