/**
 * Cache inspection, query, export, and import utilities.
 *
 * Provides tooling for debugging cache state, building deterministic test
 * suites via exported cache tarballs, and enabling local-first development
 * without network calls.
 */

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";
import { defaultCacheDir, cachePath } from "./cache.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheStats {
  totalEntries: number;
  totalBytes: number;
  oldestSha: string | null;
  newestSha: string | null;
  contentTypes: Record<string, number>;
}

export interface CacheEntryDetail {
  path: string;
  bytes: number;
  mimeType: string;
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
}

export interface CacheEntryListing {
  sha256: string;
  byteSize: number;
  mimeType: string;
  lastAccessed: Date;
}

export interface ClearCacheResult {
  removed: boolean;
}

export interface ExportCacheResult {
  exported: number;
  tarPath: string;
}

export interface ImportCacheResult {
  imported: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Walk all sharded shard dirs and collect sha256 filenames. */
async function collectEntries(dir: string): Promise<{ sha256: string; filePath: string }[]> {
  const results: { sha256: string; filePath: string }[] = [];
  let shards: string[];
  try {
    shards = await readdir(dir);
  } catch {
    return results;
  }
  for (const shard of shards) {
    if (shard.length !== 2) continue;
    const shardPath = join(dir, shard);
    let files: string[];
    try {
      const s = await stat(shardPath);
      if (!s.isDirectory()) continue;
      files = await readdir(shardPath);
    } catch {
      continue;
    }
    for (const file of files) {
      // Cache file names are the sha256 hex (64 chars).
      if (file.length === 64 && /^[0-9a-f]+$/.test(file)) {
        results.push({ sha256: file, filePath: join(shardPath, file) });
      }
    }
  }
  return results;
}

/** Sniff mime type from first bytes. */
function sniffMime(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46)
    return "image/webp";
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x00) return "image/mp4"; // ftyp
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
    return "application/pdf";
  return "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute aggregate statistics over all entries in the cache directory.
 */
export async function getCacheStats(dir?: string): Promise<CacheStats> {
  const cacheDir = dir ?? defaultCacheDir();
  const entries = await collectEntries(cacheDir);

  let totalBytes = 0;
  let oldestMtime = Infinity;
  let newestMtime = -Infinity;
  let oldestSha: string | null = null;
  let newestSha: string | null = null;
  const contentTypes: Record<string, number> = {};

  for (const { sha256, filePath } of entries) {
    let s: Awaited<ReturnType<typeof stat>>;
    try {
      s = await stat(filePath);
    } catch {
      continue;
    }
    totalBytes += s.size;
    const mtime = s.mtimeMs;
    if (mtime < oldestMtime) {
      oldestMtime = mtime;
      oldestSha = sha256;
    }
    if (mtime > newestMtime) {
      newestMtime = mtime;
      newestSha = sha256;
    }

    // Sniff mime from header bytes only (4 bytes is enough).
    try {
      const buf = Buffer.alloc(4);
      const fh = await Bun.file(filePath).arrayBuffer();
      const header = new Uint8Array(fh.slice(0, 4));
      const mime = sniffMime(header);
      contentTypes[mime] = (contentTypes[mime] ?? 0) + 1;
    } catch {
      const mime = "application/octet-stream";
      contentTypes[mime] = (contentTypes[mime] ?? 0) + 1;
    }
  }

  return {
    totalEntries: entries.length,
    totalBytes,
    oldestSha,
    newestSha,
    contentTypes,
  };
}

/**
 * Look up a single cache entry by its SHA-256 hash.
 * Returns null if the entry does not exist.
 */
export async function queryCacheByHash(
  sha256: string,
  dir?: string,
): Promise<CacheEntryDetail | null> {
  const cacheDir = dir ?? defaultCacheDir();
  const p = cachePath(sha256, cacheDir);
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(p);
  } catch {
    return null;
  }
  let mime = "application/octet-stream";
  try {
    const ab = await Bun.file(p).arrayBuffer();
    mime = sniffMime(new Uint8Array(ab.slice(0, 4)));
  } catch {}

  return {
    path: p,
    bytes: s.size,
    mimeType: mime,
    createdAt: s.birthtime,
    accessedAt: s.atime,
    // Node/Bun doesn't expose access count natively; default to 1 per file existence.
    accessCount: 1,
  };
}

/**
 * List cache entries with pagination support.
 */
export async function listCacheEntries(
  dir?: string,
  limit = 100,
  offset = 0,
): Promise<CacheEntryListing[]> {
  const cacheDir = dir ?? defaultCacheDir();
  const all = await collectEntries(cacheDir);

  // Sort by most-recently-modified first.
  const withStats = await Promise.all(
    all.map(async ({ sha256, filePath }) => {
      try {
        const s = await stat(filePath);
        return { sha256, filePath, mtime: s.mtimeMs, size: s.size, atime: s.atime };
      } catch {
        return null;
      }
    }),
  );

  const valid = withStats
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.mtime - a.mtime);

  const page = valid.slice(offset, offset + limit);

  return Promise.all(
    page.map(async ({ sha256, filePath, size, atime }) => {
      let mimeType = "application/octet-stream";
      try {
        const ab = await Bun.file(filePath).arrayBuffer();
        mimeType = sniffMime(new Uint8Array(ab.slice(0, 4)));
      } catch {}
      return { sha256, byteSize: size, mimeType, lastAccessed: atime };
    }),
  );
}

/**
 * Remove a single cache entry by SHA-256.
 */
export async function clearCacheEntry(sha256: string, dir?: string): Promise<ClearCacheResult> {
  const cacheDir = dir ?? defaultCacheDir();
  const p = cachePath(sha256, cacheDir);
  try {
    await rm(p, { force: false });
    return { removed: true };
  } catch {
    return { removed: false };
  }
}

// ---------------------------------------------------------------------------
// Export / Import (tar-based)
// ---------------------------------------------------------------------------

/**
 * Write a very minimal ustar tarball to outputPath containing every cache
 * entry that matches the optional filter.
 *
 * Filter options:
 *   mimeType  — only include entries whose sniffed mime starts with this string
 *   ageMs     — only include entries younger than ageMs milliseconds
 */
export interface ExportFilter {
  mimeType?: string;
  ageMs?: number;
}

export async function exportCache(
  dir?: string,
  outputPath?: string,
  filter?: ExportFilter,
): Promise<ExportCacheResult> {
  const cacheDir = dir ?? defaultCacheDir();
  const tarPath = outputPath ?? join(cacheDir, `cache-export-${Date.now()}.tar`);
  const entries = await collectEntries(cacheDir);
  const now = Date.now();

  const blocks: Uint8Array[] = [];
  let exported = 0;

  for (const { sha256, filePath } of entries) {
    let s: Awaited<ReturnType<typeof stat>>;
    try {
      s = await stat(filePath);
    } catch {
      continue;
    }

    // Age filter
    if (filter?.ageMs !== undefined && now - s.mtimeMs > filter.ageMs) continue;

    let fileBytes: Uint8Array;
    try {
      fileBytes = new Uint8Array(await Bun.file(filePath).arrayBuffer());
    } catch {
      continue;
    }

    // Mime filter (sniff)
    if (filter?.mimeType !== undefined) {
      const mime = sniffMime(fileBytes.slice(0, 4));
      if (!mime.startsWith(filter.mimeType)) continue;
    }

    // ustar header (512 bytes)
    const header = buildTarHeader(sha256, fileBytes.byteLength, s.mtimeMs / 1000);
    blocks.push(header);

    // File content padded to 512-byte boundary
    const padded = padTo512(fileBytes);
    blocks.push(padded);

    exported++;
  }

  // End-of-archive: two 512-byte zero blocks
  blocks.push(new Uint8Array(1024));

  const total = blocks.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.byteLength;
  }

  await mkdir(join(tarPath, ".."), { recursive: true }).catch(() => {});
  await writeFile(tarPath, out);

  return { exported, tarPath };
}

/**
 * Import a tarball previously created by exportCache into the target cache dir.
 */
export async function importCache(tarPath: string, dir?: string): Promise<ImportCacheResult> {
  const cacheDir = dir ?? defaultCacheDir();
  await mkdir(cacheDir, { recursive: true });

  let tarBytes: Uint8Array;
  try {
    tarBytes = new Uint8Array(await Bun.file(tarPath).arrayBuffer());
  } catch (e) {
    throw new Error(`importCache: cannot read tarball at ${tarPath}: ${(e as Error).message}`);
  }

  let imported = 0;
  let pos = 0;

  while (pos + 512 <= tarBytes.byteLength) {
    const header = tarBytes.slice(pos, pos + 512);
    pos += 512;

    // Two consecutive zero blocks = end of archive
    if (header.every((b) => b === 0)) break;

    const name = readTarString(header, 0, 100);
    if (!name) break;

    const sizeStr = readTarString(header, 124, 12);
    const fileSize = parseInt(sizeStr, 8);
    if (isNaN(fileSize) || fileSize < 0) {
      pos += padToMultiple(0, 512); // skip
      continue;
    }

    const paddedSize = Math.ceil(fileSize / 512) * 512;
    if (pos + paddedSize > tarBytes.byteLength) break;

    const fileBytes = tarBytes.slice(pos, pos + fileSize);
    pos += paddedSize;

    // The tar entry name is the sha256 (64 hex chars) — validate.
    const sha256 = basename(name);
    if (sha256.length !== 64 || !/^[0-9a-f]+$/.test(sha256)) continue;

    // Verify content hash matches the filename.
    const computed = computeSha256Sync(fileBytes);
    if (computed !== sha256) continue; // tampered / corrupt entry — skip silently

    const entryPath = cachePath(sha256, cacheDir);
    await mkdir(join(cacheDir, sha256.slice(0, 2)), { recursive: true });
    try {
      await stat(entryPath);
      // Already exists — skip, still count as imported for idempotency.
    } catch {
      await writeFile(entryPath, fileBytes);
    }
    imported++;
  }

  return { imported };
}

// ---------------------------------------------------------------------------
// ustar helpers (no external deps)
// ---------------------------------------------------------------------------

function buildTarHeader(name: string, size: number, mtime: number): Uint8Array {
  const h = new Uint8Array(512);
  const enc = new TextEncoder();

  function writeField(offset: number, len: number, value: string): void {
    const b = enc.encode(value);
    h.set(b.slice(0, len), offset);
  }

  writeField(0, 100, name);
  writeField(100, 8, "0000644\0"); // mode
  writeField(108, 8, "0000000\0"); // uid
  writeField(116, 8, "0000000\0"); // gid
  // size in octal, 11 digits + null
  writeField(124, 12, size.toString(8).padStart(11, "0") + "\0");
  // mtime in octal
  writeField(136, 12, Math.floor(mtime).toString(8).padStart(11, "0") + "\0");
  writeField(156, 1, "0"); // typeflag: regular file
  writeField(257, 6, "ustar"); // magic
  writeField(263, 2, "00"); // version

  // Compute checksum — sum of all header bytes with checksum field as spaces.
  h.fill(0x20, 148, 156); // checksum field = spaces
  let sum = 0;
  for (const b of h) sum += b;
  writeField(148, 8, sum.toString(8).padStart(6, "0") + "\0 ");

  return h;
}

function padTo512(bytes: Uint8Array): Uint8Array {
  const rem = bytes.byteLength % 512;
  if (rem === 0) return bytes;
  const padded = new Uint8Array(bytes.byteLength + (512 - rem));
  padded.set(bytes);
  return padded;
}

function padToMultiple(size: number, multiple: number): number {
  const rem = size % multiple;
  return rem === 0 ? size : size + (multiple - rem);
}

function readTarString(buf: Uint8Array, offset: number, len: number): string {
  const slice = buf.slice(offset, offset + len);
  const nullIdx = slice.indexOf(0);
  const end = nullIdx === -1 ? len : nullIdx;
  return new TextDecoder().decode(slice.slice(0, end)).trim();
}

function computeSha256Sync(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
