import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadImage, DownloadError } from "../packages/core/src/download.ts";
import { bytesResponse, stubFetcher } from "./stub-fetcher.ts";

const cacheDir = mkdtempSync(join(tmpdir(), "wf-"));

test("downloads + hashes + caches", async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const fetcher = stubFetcher([{ match: () => true, handler: async () => bytesResponse(bytes) }]);
  const r = await downloadImage("https://example.com/x.jpg", { fetcher, cacheDir });
  expect(r.bytes.byteLength).toBe(bytes.byteLength);
  expect(r.mime).toBe("image/jpeg");
  expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(r.cachedPath).toContain(cacheDir);
});

test("rejects non-image content-type", async () => {
  const fetcher = stubFetcher([
    {
      match: () => true,
      handler: async () =>
        new Response("nope", { status: 200, headers: { "content-type": "text/html" } }),
    },
  ]);
  await expect(downloadImage("https://x/y", { fetcher, cacheDir })).rejects.toBeInstanceOf(DownloadError);
});

test("enforces byte cap", async () => {
  const big = new Uint8Array(1024);
  const fetcher = stubFetcher([{ match: () => true, handler: async () => bytesResponse(big) }]);
  await expect(
    downloadImage("https://x/y", { fetcher, cacheDir, maxBytes: 100 }),
  ).rejects.toBeInstanceOf(DownloadError);
});
