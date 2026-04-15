/**
 * Persistent cache for browser-source results. SHA-256 keyed by
 * (stack, extractor, query/url, options-hash). Writes to `cacheDir` if set,
 * otherwise uses an in-memory Map so tests stay hermetic.
 *
 * We deliberately keep this simple — no TTL eviction beyond what the OS
 * does on the cacheDir. Callers set TTLs with wrap-invalidate patterns.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface CacheEntry<T> {
  key: string;
  value: T;
  storedAt: number; // epoch ms
}

export class BrowserCache {
  private mem = new Map<string, CacheEntry<unknown>>();
  constructor(private readonly dir?: string) {}

  key(parts: Record<string, unknown>): string {
    return createHash("sha256")
      .update(JSON.stringify(parts, Object.keys(parts).sort()))
      .digest("hex");
  }

  async get<T>(key: string): Promise<T | null> {
    const hit = this.mem.get(key);
    if (hit) return hit.value as T;
    if (!this.dir) return null;
    try {
      const raw = await readFile(join(this.dir, `${key}.json`), "utf8");
      const parsed = JSON.parse(raw) as CacheEntry<T>;
      this.mem.set(key, parsed as CacheEntry<unknown>);
      return parsed.value;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const entry: CacheEntry<T> = { key, value, storedAt: Date.now() };
    this.mem.set(key, entry as CacheEntry<unknown>);
    if (!this.dir) return;
    await mkdir(this.dir, { recursive: true }).catch(() => undefined);
    await writeFile(join(this.dir, `${key}.json`), JSON.stringify(entry, null, 2), "utf8").catch(
      () => undefined,
    );
  }

  /** Test helper. */
  _clear(): void {
    this.mem.clear();
  }
}
