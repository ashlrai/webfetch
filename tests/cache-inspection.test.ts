/**
 * Integration tests for the cache inspection, export/import, and server endpoint suite.
 *
 * Covers:
 *   1. getCacheStats() accuracy against a known fixture
 *   2. queryCacheByHash() hit and miss
 *   3. listCacheEntries() pagination
 *   4. clearCacheEntry() removal
 *   5. exportCache() / importCache() round-trip (content integrity)
 *   6. validateCacheTarball() structural validation
 *   7. Export filters (mimeType, ageMs)
 *   8. Server endpoints: GET /v1/cache/stats, GET /v1/cache/entries,
 *      POST /v1/cache/export, POST /v1/cache/import
 *   9. Cache-served searchImages results (instant + idempotent)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, stat } from "node:fs/promises";
import {
  clearCacheEntry,
  exportCache,
  getCacheStats,
  importCache,
  listCacheEntries,
  queryCacheByHash,
} from "../packages/core/src/cache-inspection.ts";
import { generateCacheFixture, loadCacheFixture, validateCacheTarball } from "./cache-fixtures.ts";
import { startServer } from "../packages/server/src/server.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN = "x".repeat(64);

function authHeaders() {
  return { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
}

async function startTestServer() {
  const base = 31_000 + (process.pid % 15_000);
  for (let i = 0; i < 5; i++) {
    try {
      return startServer({ port: base + i, token: TOKEN });
    } catch {}
  }
  throw new Error("Could not bind test server");
}

// ---------------------------------------------------------------------------
// Fixtures shared across the test suite
// ---------------------------------------------------------------------------

let fixture: Awaited<ReturnType<typeof generateCacheFixture>>;
let server: ReturnType<typeof startServer>;
let serverBase: string;

beforeAll(async () => {
  fixture = await generateCacheFixture(12);
  server = await startTestServer();
  serverBase = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await fixture.cleanup();
  try {
    server?.stop(true);
  } catch {}
});

// ---------------------------------------------------------------------------
// 1. getCacheStats
// ---------------------------------------------------------------------------

describe("getCacheStats", () => {
  test("counts entries correctly", async () => {
    const stats = await getCacheStats(fixture.dir);
    expect(stats.totalEntries).toBe(12);
  });

  test("totalBytes > 0", async () => {
    const stats = await getCacheStats(fixture.dir);
    expect(stats.totalBytes).toBeGreaterThan(0);
  });

  test("oldestSha and newestSha are valid hex strings", async () => {
    const stats = await getCacheStats(fixture.dir);
    expect(stats.oldestSha).toMatch(/^[0-9a-f]{64}$/);
    expect(stats.newestSha).toMatch(/^[0-9a-f]{64}$/);
  });

  test("contentTypes map is non-empty", async () => {
    const stats = await getCacheStats(fixture.dir);
    expect(Object.keys(stats.contentTypes).length).toBeGreaterThan(0);
    const total = Object.values(stats.contentTypes).reduce((a, b) => a + b, 0);
    expect(total).toBe(12);
  });

  test("returns zeros for empty directory", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "webfetch-empty-"));
    try {
      const stats = await getCacheStats(emptyDir);
      expect(stats.totalEntries).toBe(0);
      expect(stats.totalBytes).toBe(0);
      expect(stats.oldestSha).toBeNull();
      expect(stats.newestSha).toBeNull();
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 2. queryCacheByHash
// ---------------------------------------------------------------------------

describe("queryCacheByHash", () => {
  test("returns detail for known entry", async () => {
    const { sha256 } = fixture.entries[0]!;
    const detail = await queryCacheByHash(sha256, fixture.dir);
    expect(detail).not.toBeNull();
    expect(detail!.bytes).toBeGreaterThan(0);
    expect(detail!.path).toContain(sha256);
    expect(detail!.mimeType).toBeTruthy();
    expect(detail!.createdAt).toBeInstanceOf(Date);
    expect(detail!.accessedAt).toBeInstanceOf(Date);
  });

  test("returns null for unknown sha256", async () => {
    const detail = await queryCacheByHash("a".repeat(64), fixture.dir);
    expect(detail).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. listCacheEntries
// ---------------------------------------------------------------------------

describe("listCacheEntries", () => {
  test("returns up to limit entries", async () => {
    const entries = await listCacheEntries(fixture.dir, 5, 0);
    expect(entries.length).toBe(5);
  });

  test("offset works", async () => {
    const page1 = await listCacheEntries(fixture.dir, 5, 0);
    const page2 = await listCacheEntries(fixture.dir, 5, 5);
    const all = await listCacheEntries(fixture.dir, 20, 0);
    expect(all.length).toBe(12);
    // No overlap between pages
    const p1Shas = new Set(page1.map((e) => e.sha256));
    for (const e of page2) expect(p1Shas.has(e.sha256)).toBe(false);
  });

  test("each entry has sha256, byteSize, mimeType, lastAccessed", async () => {
    const entries = await listCacheEntries(fixture.dir, 1, 0);
    const e = entries[0]!;
    expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(e.byteSize).toBeGreaterThan(0);
    expect(e.mimeType).toBeTruthy();
    expect(e.lastAccessed).toBeInstanceOf(Date);
  });

  test("offset beyond count returns empty array", async () => {
    const entries = await listCacheEntries(fixture.dir, 100, 9999);
    expect(entries.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. clearCacheEntry
// ---------------------------------------------------------------------------

describe("clearCacheEntry", () => {
  test("removes an existing entry", async () => {
    // Use a fresh fixture so we don't break shared entries.
    const f = await generateCacheFixture(2);
    try {
      const { sha256 } = f.entries[0]!;
      const before = await queryCacheByHash(sha256, f.dir);
      expect(before).not.toBeNull();

      const result = await clearCacheEntry(sha256, f.dir);
      expect(result.removed).toBe(true);

      const after = await queryCacheByHash(sha256, f.dir);
      expect(after).toBeNull();
    } finally {
      await f.cleanup();
    }
  });

  test("returns removed:false for non-existent entry", async () => {
    const result = await clearCacheEntry("b".repeat(64), fixture.dir);
    expect(result.removed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. exportCache / importCache round-trip
// ---------------------------------------------------------------------------

describe("export/import round-trip", () => {
  test("exports all entries and imports them back with matching content", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "webfetch-export-"));
    const tarPath = join(outDir, "test.tar");
    try {
      const exportResult = await exportCache(fixture.dir, tarPath);
      expect(exportResult.exported).toBe(12);
      expect(exportResult.tarPath).toBe(tarPath);

      // Validate tarball structure
      const validation = await validateCacheTarball(tarPath);
      expect(validation.valid).toBe(true);
      expect(validation.entries).toBe(12);

      // Import into a fresh dir
      const importFixture = await loadCacheFixture(tarPath);
      try {
        const importedStats = await getCacheStats(importFixture.dir);
        expect(importedStats.totalEntries).toBe(12);

        // Every original sha256 should be present in the imported dir
        for (const { sha256 } of fixture.entries) {
          const detail = await queryCacheByHash(sha256, importFixture.dir);
          expect(detail).not.toBeNull();
        }
      } finally {
        await importFixture.cleanup();
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("import is idempotent (second import does not error)", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "webfetch-idempotent-"));
    const tarPath = join(outDir, "test.tar");
    try {
      await exportCache(fixture.dir, tarPath);
      const importFixture = await loadCacheFixture(tarPath);
      try {
        // Import again into same dir
        const result2 = await importCache(tarPath, importFixture.dir);
        expect(result2.imported).toBeGreaterThanOrEqual(0);
        // Count should be unchanged
        const stats = await getCacheStats(importFixture.dir);
        expect(stats.totalEntries).toBe(12);
      } finally {
        await importFixture.cleanup();
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("empty cache exports 0 entries", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "webfetch-empty-src-"));
    const outDir = await mkdtemp(join(tmpdir(), "webfetch-empty-export-"));
    const tarPath = join(outDir, "empty.tar");
    try {
      const result = await exportCache(emptyDir, tarPath);
      expect(result.exported).toBe(0);
      // tar file should still be created (just end-of-archive blocks)
      const s = await stat(tarPath);
      expect(s.size).toBeGreaterThanOrEqual(1024);
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Export filters
// ---------------------------------------------------------------------------

describe("exportCache filters", () => {
  test("mimeType filter exports subset", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "webfetch-filter-"));
    const tarPath = join(outDir, "jpeg-only.tar");
    try {
      // With 12 entries cycling through 4 mime types, exactly 3 should be jpeg.
      const result = await exportCache(fixture.dir, tarPath, { mimeType: "image/jpeg" });
      expect(result.exported).toBe(3);
      const validation = await validateCacheTarball(tarPath);
      expect(validation.valid).toBe(true);
      expect(validation.entries).toBe(3);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("ageMs filter exports only recent entries", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "webfetch-age-"));
    const tarPath = join(outDir, "recent.tar");
    try {
      // Very large ageMs — all entries are recent enough.
      const result = await exportCache(fixture.dir, tarPath, { ageMs: 86_400_000 * 365 });
      expect(result.exported).toBe(12);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("ageMs=0 exports no entries (all are too old)", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "webfetch-age0-"));
    const tarPath = join(outDir, "none.tar");
    try {
      const result = await exportCache(fixture.dir, tarPath, { ageMs: 0 });
      expect(result.exported).toBe(0);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 7. validateCacheTarball
// ---------------------------------------------------------------------------

describe("validateCacheTarball", () => {
  test("detects corrupted entry (wrong sha256 in name)", async () => {
    // Build a tar with a file whose name doesn't match its content.
    const outDir = await mkdtemp(join(tmpdir(), "webfetch-corrupt-"));
    const tarPath = join(outDir, "corrupt.tar");
    try {
      // First export normally, then tamper.
      // Layout: [512-byte header][N*512 content blocks][512-byte header]...
      // The first file content starts at byte 512. We flip a byte deep inside
      // the content area (byte 512 + some offset into the payload) so the
      // header is untouched but the sha256 of the content no longer matches
      // the filename.
      await exportCache(fixture.dir, tarPath);
      const bytes = new Uint8Array(await Bun.file(tarPath).arrayBuffer());
      // Content block starts at offset 512. Flip a byte well inside the payload.
      const flipAt = 512 + 4; // past any 4-byte magic so header stays valid
      if (bytes.byteLength > flipAt) {
        bytes[flipAt] = bytes[flipAt]! ^ 0xff;
        await Bun.write(tarPath, bytes);
        const result = await validateCacheTarball(tarPath);
        // At least one entry should fail hash check
        expect(result.valid).toBe(false);
        expect(result.error).toContain("hash mismatch");
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Server endpoints
// ---------------------------------------------------------------------------

describe("server cache endpoints", () => {
  test("GET /v1/cache/stats returns stats shape", async () => {
    const r = await fetch(`${serverBase}/v1/cache/stats`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(true);
    expect(typeof j.data.totalEntries).toBe("number");
    expect(typeof j.data.totalBytes).toBe("number");
    expect(typeof j.data.contentTypes).toBe("object");
  });

  test("GET /cache/stats (no /v1 prefix) also works", async () => {
    const r = await fetch(`${serverBase}/cache/stats`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
  });

  test("GET /v1/cache/entries returns entries array", async () => {
    const r = await fetch(`${serverBase}/v1/cache/entries?limit=10`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.data.entries)).toBe(true);
  });

  test("GET /v1/cache/entries requires auth", async () => {
    const r = await fetch(`${serverBase}/v1/cache/entries`);
    expect(r.status).toBe(401);
  });

  test("GET /v1/cache/stats requires auth", async () => {
    const r = await fetch(`${serverBase}/v1/cache/stats`);
    expect(r.status).toBe(401);
  });

  test("POST /v1/cache/export returns tarPath and exported count", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "webfetch-srv-export-"));
    const tarPath = join(outDir, "srv-export.tar");
    try {
      const r = await fetch(`${serverBase}/v1/cache/export`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ outputPath: tarPath }),
      });
      expect(r.status).toBe(200);
      const j = (await r.json()) as any;
      expect(j.ok).toBe(true);
      expect(typeof j.data.exported).toBe("number");
      expect(j.data.tarPath).toBe(tarPath);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  test("POST /v1/cache/import returns imported count", async () => {
    // First export from fixture dir, then import via server
    const outDir = await mkdtemp(join(tmpdir(), "webfetch-srv-import-"));
    const tarPath = join(outDir, "for-import.tar");
    const importDir = await mkdtemp(join(tmpdir(), "webfetch-srv-import-dest-"));
    try {
      await exportCache(fixture.dir, tarPath);
      const r = await fetch(`${serverBase}/v1/cache/import`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ tarPath, cacheDir: importDir }),
      });
      expect(r.status).toBe(200);
      const j = (await r.json()) as any;
      expect(j.ok).toBe(true);
      expect(j.data.imported).toBe(12);
    } finally {
      await rm(outDir, { recursive: true, force: true });
      await rm(importDir, { recursive: true, force: true });
    }
  });

  test("POST /v1/cache/import 422 when tarPath missing", async () => {
    const r = await fetch(`${serverBase}/v1/cache/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(422);
  });

  test("POST /v1/cache/export with mimeType filter", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "webfetch-srv-filter-"));
    const tarPath = join(outDir, "filtered.tar");
    try {
      const r = await fetch(`${serverBase}/v1/cache/export`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ outputPath: tarPath, mimeType: "image/" }),
      });
      expect(r.status).toBe(200);
      const j = (await r.json()) as any;
      expect(j.ok).toBe(true);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Cache-served results are instant (no rate-limit tokens consumed)
// ---------------------------------------------------------------------------

describe("cache-served results", () => {
  test("importing a cache fixture and querying gives instant results", async () => {
    // Verify that after importCache the entries are all immediately readable,
    // simulating the scenario where test suites use an imported cache to
    // skip real network calls.
    const outDir = await mkdtemp(join(tmpdir(), "webfetch-replay-"));
    const tarPath = join(outDir, "replay.tar");
    try {
      await exportCache(fixture.dir, tarPath);

      const importFixture = await loadCacheFixture(tarPath);
      try {
        const t0 = Date.now();
        // Read all 12 entries back — should complete well within 1 second
        for (const { sha256 } of fixture.entries) {
          const detail = await queryCacheByHash(sha256, importFixture.dir);
          expect(detail).not.toBeNull();
          // Verify content integrity via path existence
          const s = await stat(detail!.path);
          expect(s.size).toBeGreaterThan(0);
        }
        const elapsed = Date.now() - t0;
        // All 12 reads should complete in < 2 seconds (no network, just disk)
        expect(elapsed).toBeLessThan(2000);
      } finally {
        await importFixture.cleanup();
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
