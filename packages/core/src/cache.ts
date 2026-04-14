/**
 * Disk cache at ~/.webfetch/cache/<sha>.
 *
 * Keyed by content-hash (SHA-256 of bytes), not URL, because many providers
 * hand out the same image through different CDN URLs.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

export async function writeCache(sha256: string, bytes: Uint8Array, dir?: string): Promise<string> {
  const base = dir ?? defaultCacheDir();
  const p = cachePath(sha256, base);
  await mkdir(join(base, sha256.slice(0, 2)), { recursive: true });
  await writeFile(p, bytes);
  return p;
}
