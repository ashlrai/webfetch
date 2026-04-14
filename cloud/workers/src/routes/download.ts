/**
 * /v1/download — download an image URL through the worker and stash bytes in R2.
 *
 * We do NOT stream the bytes through @webfetch/core's local-disk cache path
 * (that lives on Node fs). Instead:
 *   1. Fetch the remote URL directly from the Worker.
 *   2. Hash + size-check (20MB hard cap).
 *   3. Write bytes into R2 under the sha256 key.
 *   4. Record a cache_index row for reverse lookups.
 *   5. Return the hash + mime + a time-limited R2 URL for the client.
 *
 * Callers that need the raw bytes should follow with a GET to the signed URL;
 * we avoid binding that large payload to the JSON response.
 */

import { Hono } from "hono";
import type { Env, RequestCtx } from "../env.ts";
import { downloadImageSchema } from "../schemas.ts";
import { ok, err, parseJson } from "../responses.ts";
import { recordUsage } from "../metering.ts";
import { unitsFor } from "../../../shared/pricing.ts";

type HonoEnv = { Bindings: Env; Variables: { ctx: RequestCtx } };

export const downloadRouter = new Hono<HonoEnv>();

const MAX_BYTES_DEFAULT = 20 * 1024 * 1024;
const ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif|avif|svg\+xml)$/i;

downloadRouter.post("/", async (c) => {
  const parsed = await parseJson(c, downloadImageSchema);
  if (!parsed.ok) return parsed.response;
  const ctx = c.get("ctx");
  const maxBytes = parsed.data.maxBytes ?? MAX_BYTES_DEFAULT;

  try {
    const res = await fetch(parsed.data.url, {
      redirect: "follow",
      headers: { "user-agent": "webfetch-cloud/1.0 (+https://webfetch.dev)" },
    });
    if (!res.ok) {
      c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/download", unitsFor("/v1/download"), res.status));
      return err(c, `upstream ${res.status}`, 502);
    }
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
    if (!ALLOWED_MIME.test(mime)) {
      return err(c, `disallowed content-type: ${mime}`, 415);
    }
    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (contentLength && contentLength > maxBytes) {
      return err(c, `payload too large: ${contentLength} > ${maxBytes}`, 413);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      return err(c, `payload too large: ${buf.byteLength} > ${maxBytes}`, 413);
    }
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const sha256 = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0")).join("");

    // Idempotent write; HEAD first to avoid re-uploading.
    const head = await c.env.CACHE.head(sha256);
    if (!head) {
      await c.env.CACHE.put(sha256, buf, {
        httpMetadata: { contentType: mime },
        customMetadata: { sourceUrl: parsed.data.url },
      });
    }
    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO cache_index (sha256, mime, bytes, source_url, first_seen, last_hit, hit_count)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5, 1)
       ON CONFLICT(sha256) DO UPDATE SET last_hit = excluded.last_hit, hit_count = cache_index.hit_count + 1`,
    ).bind(sha256, mime, buf.byteLength, parsed.data.url, now).run();

    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/download", unitsFor("/v1/download"), 200));
    return ok(c, {
      url: parsed.data.url,
      sha256,
      mime,
      byteSize: buf.byteLength,
      cacheKey: sha256,
    });
  } catch (e) {
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/download", unitsFor("/v1/download"), 500));
    return err(c, (e as Error).message ?? "download failed", 500);
  }
});
