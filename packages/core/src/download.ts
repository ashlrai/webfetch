/**
 * Streaming download with size cap, content-type guard, and SHA-256.
 *
 * Safety guardrails:
 *   - hard byte cap (default 20 MB) — aborts mid-stream on overflow
 *   - content-type must be image/* unless explicitly overridden
 *   - host blocklist for known-problematic targets
 *   - respects abort signal
 */

import { writeCache, readCache, defaultCacheDir } from "./cache.ts";
import type { Fetcher } from "./types.ts";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

const HOST_BLOCKLIST = new Set<string>([
  // Add hosts we know deliver malware-flagged or legally-risky content.
  // Kept small; users can extend via env WEBFETCH_BLOCKLIST.
]);

export class DownloadError extends Error {
  constructor(
    message: string,
    public readonly kind: "too-large" | "bad-type" | "blocked-host" | "network" | "aborted",
  ) {
    super(message);
    this.name = "DownloadError";
  }
}

export interface DownloadOptions {
  maxBytes?: number;
  cacheDir?: string;
  fetcher?: Fetcher;
  signal?: AbortSignal;
  allowNonImage?: boolean;
  userAgent?: string;
}

export interface DownloadResult {
  bytes: Uint8Array;
  mime: string;
  sha256: string;
  cachedPath: string;
  width?: number;
  height?: number;
}

export async function downloadImage(url: string, opts: DownloadOptions = {}): Promise<DownloadResult> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const fetcher = opts.fetcher ?? fetch;
  const cacheDir = opts.cacheDir ?? defaultCacheDir();

  const host = safeHost(url);
  if (!host) throw new DownloadError(`invalid url: ${url}`, "network");
  // SECURITY (SA-010 / CWE-918): Reject non-http(s) schemes and private /
  // link-local hosts to prevent SSRF against internal services + cloud
  // metadata endpoints (e.g. 169.254.169.254). See SECURITY-AUDIT-REPORT.md.
  if (!isPublicHttpUrl(url)) throw new DownloadError(`blocked url: ${url}`, "blocked-host");
  if (HOST_BLOCKLIST.has(host)) throw new DownloadError(`host blocked: ${host}`, "blocked-host");
  for (const extra of (process.env.WEBFETCH_BLOCKLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (host === extra || host.endsWith(`.${extra}`)) {
      throw new DownloadError(`host blocked by env: ${host}`, "blocked-host");
    }
  }

  const headers: Record<string, string> = {
    "User-Agent": opts.userAgent ?? "webfetch-mcp/0.1 (+https://github.com/)",
    Accept: "image/*,*/*;q=0.8",
  };

  let resp: Response;
  try {
    resp = await fetcher(url, { headers, signal: opts.signal, redirect: "follow" });
  } catch (e) {
    if ((e as any)?.name === "AbortError") throw new DownloadError("aborted", "aborted");
    throw new DownloadError(`fetch failed: ${(e as Error).message}`, "network");
  }
  if (!resp.ok) throw new DownloadError(`http ${resp.status}`, "network");

  const mime = (resp.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim();
  if (!opts.allowNonImage && !mime.startsWith("image/")) {
    throw new DownloadError(`not an image: ${mime}`, "bad-type");
  }
  const declared = Number.parseInt(resp.headers.get("content-length") ?? "0", 10);
  if (declared && declared > maxBytes) {
    throw new DownloadError(`declared size ${declared} > max ${maxBytes}`, "too-large");
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new DownloadError("no body", "network");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DownloadError(`body exceeded ${maxBytes} bytes`, "too-large");
    }
    chunks.push(value);
  }
  const bytes = concat(chunks, total);

  const sha256 = await sha(bytes);
  // Cache-key by hash to coalesce same-image-different-CDN duplicates.
  const existed = await readCache(sha256, cacheDir);
  const cachedPath = existed ? (await import("./cache.ts")).cachePath(sha256, cacheDir) : await writeCache(sha256, bytes, cacheDir);

  return { bytes, mime, sha256, cachedPath };
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

async function sha(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * SA-010: best-effort private-IP / internal-host blocklist. Mirrors the cloud
 * worker guard in cloud/workers/src/ssrf.ts; kept inline here so the core
 * package has no cross-package dependency.
 */
function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".localhost")) return false;
  if (h === "metadata.google.internal" || h.endsWith(".internal")) return false;
  if (h === "0.0.0.0" || h === "::1" || h === "[::1]") return false;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = m.slice(1, 5).map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b! >= 16 && b! <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b! >= 64 && b! <= 127) return false;
    if (a! >= 224) return false;
  }
  return true;
}
