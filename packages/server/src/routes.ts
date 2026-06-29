/**
 * HTTP route map. Each endpoint mirrors an MCP tool from packages/mcp/src/tools.ts
 * to keep the agent-facing and extension-facing surfaces identical.
 *
 * Request: POST JSON body matching the tool's input schema.
 * Response: 200 JSON `{ ok: true, data: <structuredContent> }` on success,
 *           4xx JSON `{ ok: false, error }` on validation/domain errors.
 *
 * GET /providers        — list known provider ids + defaults (no auth-sensitive data).
 * GET /health           — liveness probe (still requires auth).
 *
 * All handlers are pure wrappers — domain logic stays in webfetch-core.
 */

import {
  ALL_PROVIDERS,
  DEFAULT_PROVIDERS,
  batchFindSimilar,
  clearCacheEntry,
  downloadImage,
  exportCache,
  fetchWithLicense,
  findSimilar,
  getCacheStats,
  getFederationDiagnostics,
  getProviderRanking,
  hammingDistance,
  importCache,
  listCacheEntries,
  perceptualHashStructured,
  probePage,
  searchAlbumCover,
  searchArtistImages,
  searchImages,
} from "webfetch-core";
import { z } from "zod";
import { assertPublicHttpUrl } from "../../core/src/download.ts";
import {
  batchFindSimilarSchema,
  comparePhashesSchema,
  downloadImageSchema,
  fetchWithLicenseSchema,
  findSimilarSchema,
  probePageSchema,
  searchAlbumCoverSchema,
  searchArtistImagesSchema,
  searchImagesSchema,
} from "./schema.ts";

// ---------------------------------------------------------------------------
// Cache endpoint schemas
// ---------------------------------------------------------------------------
const cacheStatsSchema = z.object({
  cacheDir: z.string().optional(),
});

const cacheEntriesSchema = z.object({
  cacheDir: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0),
});

const cacheExportSchema = z.object({
  cacheDir: z.string().optional(),
  outputPath: z.string().optional(),
  mimeType: z.string().optional(),
  ageMs: z.number().int().min(0).optional(),
});

const cacheImportSchema = z.object({
  tarPath: z.string().min(1),
  cacheDir: z.string().optional(),
});

type Handler = (body: unknown) => Promise<unknown>;

export interface RouteDef {
  method: "GET" | "POST";
  path: string;
  auth: boolean;
  handler: (req: Request) => Promise<Response>;
}

function jsonOk(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function jsonErr(error: string, status = 400, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: false, error, ...(extra ?? {}) }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readJson(req: Request): Promise<unknown> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("json") && req.method !== "GET") {
    const text = await req.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("invalid JSON body");
    }
  }
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function wrap<S extends z.ZodTypeAny>(
  schema: S,
  fn: (args: z.infer<S>) => Promise<unknown>,
): Handler {
  return async (body) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ValidationError(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    return fn(parsed.data);
  };
}

class ValidationError extends Error {}

const handlers: Record<string, Handler> = {
  "/search": wrap(searchImagesSchema, async (a) => {
    const out = await searchImages(a.query, a);
    return {
      candidates: out.candidates,
      providerReports: out.providerReports,
      warnings: out.warnings,
    };
  }),
  "/artist": wrap(searchArtistImagesSchema, async (a) => {
    const out = await searchArtistImages(a.artist, a.kind, a);
    return {
      candidates: out.candidates,
      providerReports: out.providerReports,
      warnings: out.warnings,
    };
  }),
  "/album": wrap(searchAlbumCoverSchema, async (a) => {
    const out = await searchAlbumCover(a.artist, a.album, a);
    return {
      candidates: out.candidates,
      providerReports: out.providerReports,
      warnings: out.warnings,
    };
  }),
  "/download": wrap(downloadImageSchema, async (a) => {
    assertPublicUrl(a.url);
    const r = await downloadImage(a.url, { maxBytes: a.maxBytes, cacheDir: a.cacheDir });
    return {
      url: a.url,
      sha256: r.sha256,
      mime: r.mime,
      byteSize: r.bytes.byteLength,
      cachedPath: r.cachedPath,
    };
  }),
  "/probe": wrap(probePageSchema, async (a) => {
    assertPublicUrl(a.url);
    return probePage(a.url, { respectRobots: a.respectRobots });
  }),
  "/license": wrap(fetchWithLicenseSchema, async (a) => {
    assertPublicUrl(a.url);
    const r = await fetchWithLicense(a.url, { probe: a.probe });
    return {
      license: r.license,
      confidence: r.confidence,
      author: r.author,
      attributionLine: r.attributionLine,
      sourcePageUrl: r.sourcePageUrl,
      mime: r.mime,
      sha256: r.sha256,
      cachedPath: r.cachedPath,
      byteSize: r.bytes?.byteLength,
    };
  }),
  "/similar": wrap(findSimilarSchema, async (a) =>
    findSimilar({ url: a.url }, { providers: a.providers }),
  ),
  "/batch-find-similar": wrap(batchFindSimilarSchema, async (a) =>
    batchFindSimilar(
      { urls: a.urls, providers: a.providers, limit: a.limit },
      {},
    ),
  ),
  "/cache/export": wrap(cacheExportSchema, async (a) => {
    const filter =
      a.mimeType !== undefined || a.ageMs !== undefined
        ? { mimeType: a.mimeType, ageMs: a.ageMs }
        : undefined;
    return exportCache(a.cacheDir, a.outputPath, filter);
  }),
  "/cache/import": wrap(cacheImportSchema, async (a) => importCache(a.tarPath, a.cacheDir)),
  "/compare-phashes": wrap(comparePhashesSchema, async (a) => {
    assertPublicUrl(a.urlA);
    assertPublicUrl(a.urlB);
    const [dlA, dlB] = await Promise.all([
      downloadImage(a.urlA),
      downloadImage(a.urlB),
    ]);
    const [hashA, hashB] = await Promise.all([
      perceptualHashStructured(dlA.bytes),
      perceptualHashStructured(dlB.bytes),
    ]);
    const hamming = hammingDistance(hashA.hash, hashB.hash);
    return {
      candidates: [
        { url: a.urlA, phash: hashA.hash, algorithm: hashA.algorithm, confidence: hashA.confidence },
        { url: a.urlB, phash: hashB.hash, algorithm: hashB.algorithm, confidence: hashB.confidence },
      ],
      hamming,
      isMatch: hamming <= 6,
    };
  }),
};

function assertPublicUrl(url: string): void {
  const check = assertPublicHttpUrl(url);
  if (!check.ok) throw new ValidationError(check.error);
}

export async function dispatchPost(path: string, req: Request): Promise<Response> {
  const h = handlers[unversionPath(path)];
  if (!h) return jsonErr("not found", 404);
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (e) {
    return jsonErr((e as Error).message, 400);
  }
  try {
    const data = await h(body);
    return jsonOk(data);
  } catch (e: any) {
    if (e instanceof ValidationError) return jsonErr(e.message, 422);
    return jsonErr(e?.message ?? "internal error", 500);
  }
}

function unversionPath(path: string): string {
  return path.startsWith("/v1/") ? path.slice(3) : path;
}

export function getProviders(): Response {
  const all = Object.keys(ALL_PROVIDERS);
  return new Response(
    JSON.stringify({
      ok: true,
      data: {
        all,
        defaults: DEFAULT_PROVIDERS,
        endpoints: [
          "/search",
          "/artist",
          "/album",
          "/download",
          "/probe",
          "/license",
          "/similar",
          "/batch-find-similar",
          "/federation-diagnostics",
          "/federation-strategy",
          "/compare-phashes",
          "/cache/stats",
          "/cache/entries",
          "/cache/export",
          "/cache/import",
        ],
      },
    }),
    { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}

export async function getCacheStatsResponse(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const cacheDir = url.searchParams.get("cacheDir") ?? undefined;
  try {
    const stats = await getCacheStats(cacheDir);
    return jsonOk(stats);
  } catch (e: any) {
    return jsonErr(e?.message ?? "internal error", 500);
  }
}

export async function getCacheEntriesResponse(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const cacheDir = url.searchParams.get("cacheDir") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const offsetParam = url.searchParams.get("offset");
  const limit = limitParam ? Math.min(500, Math.max(1, parseInt(limitParam, 10))) : 100;
  const offset = offsetParam ? Math.max(0, parseInt(offsetParam, 10)) : 0;
  if (isNaN(limit) || isNaN(offset)) {
    return jsonErr("limit and offset must be integers", 422);
  }
  try {
    const entries = await listCacheEntries(cacheDir, limit, offset);
    return jsonOk({ entries, limit, offset });
  } catch (e: any) {
    return jsonErr(e?.message ?? "internal error", 500);
  }
}

export function getFederationDiagnosticsResponse(req: Request): Response {
  const url = new URL(req.url);
  const windowMsParam = url.searchParams.get("windowMs");
  const windowMs = windowMsParam ? Number(windowMsParam) : undefined;
  if (windowMs !== undefined && (isNaN(windowMs) || windowMs < 1000 || windowMs > 3_600_000)) {
    return jsonErr("windowMs must be between 1000 and 3600000", 422);
  }
  const diag = getFederationDiagnostics(windowMs);
  return jsonOk(diag);
}

export function getFederationStrategyResponse(req: Request): Response {
  const url = new URL(req.url);
  const windowMsParam = url.searchParams.get("windowMs");
  const windowMs = windowMsParam ? Number(windowMsParam) : undefined;
  if (windowMs !== undefined && (isNaN(windowMs) || windowMs < 1000 || windowMs > 3_600_000)) {
    return jsonErr("windowMs must be between 1000 and 3600000", 422);
  }

  // Accept an optional comma-separated providers param; default to all known providers
  const providersParam = url.searchParams.get("providers");
  const providerIds = providersParam
    ? (providersParam.split(",").map((p) => p.trim()).filter(Boolean) as Parameters<typeof getProviderRanking>[0])
    : (Object.keys(ALL_PROVIDERS) as Parameters<typeof getProviderRanking>[0]);

  const ranking = getProviderRanking(providerIds, windowMs);
  return jsonOk(ranking);
}
