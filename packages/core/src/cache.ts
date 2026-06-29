/**
 * Disk cache at ~/.webfetch/cache/<sha>.
 *
 * Keyed by content-hash (SHA-256 of bytes), not URL, because many providers
 * hand out the same image through different CDN URLs.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ImageCandidate } from "./types.ts";
import {
  type ExportFormat,
  exportImageMetadata,
} from "./metadata-export.ts";

export function defaultCacheDir(): string {
  return join(homedir(), ".webfetch", "cache");
}

export async function ensureCacheDir(dir: string = defaultCacheDir()): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

export function cachePath(sha256: string, dir: string = defaultCacheDir()): string {
  // 2-char shard prevents flat-dir pathologies at scale.
  return join(dir, sha256.slice(0, 2), sha256);
}

export async function readCache(sha256: string, dir?: string): Promise<Uint8Array | null> {
  const p = cachePath(sha256, dir ?? defaultCacheDir());
  try {
    await stat(p);
    return new Uint8Array(await readFile(p));
  } catch {
    return null;
  }
}

export interface WriteCacheOptions {
  /**
   * When provided, metadata sidecar files are written alongside the cached
   * image on first download. Accepts the same values as `--export-format` CLI
   * flag: "xmp" | "exif" | "json" | "all". Omit to skip metadata export.
   */
  exportFormat?: ExportFormat;
  /** ImageCandidate — required when exportFormat is set. */
  candidate?: ImageCandidate;
  /** MIME type of the image, forwarded to metadata export. */
  mime?: string;
}

export async function writeCache(
  sha256: string,
  bytes: Uint8Array,
  dir?: string,
  opts?: WriteCacheOptions,
): Promise<string> {
  const base = dir ?? defaultCacheDir();
  const p = cachePath(sha256, base);
  await mkdir(join(base, sha256.slice(0, 2)), { recursive: true });
  await writeFile(p, bytes);

  // Auto-write metadata sidecar(s) on first download when requested.
  if (opts?.exportFormat && opts.candidate) {
    try {
      await exportImageMetadata(p, opts.candidate, bytes, {
        format: opts.exportFormat,
        downloadedAt: new Date().toISOString(),
        mime: opts.mime,
        sha256,
      });
    } catch {
      // Metadata export is best-effort; never fail the cache write.
    }
  }

  return p;
}
