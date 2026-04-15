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
 * All handlers are pure wrappers — domain logic stays in @webfetch/core.
 */

import {
  ALL_PROVIDERS,
  DEFAULT_PROVIDERS,
  downloadImage,
  fetchWithLicense,
  findSimilar,
  probePage,
  searchAlbumCover,
  searchArtistImages,
  searchImages,
} from "@webfetch/core";
import { z } from "zod";
import {
  downloadImageSchema,
  fetchWithLicenseSchema,
  findSimilarSchema,
  probePageSchema,
  searchAlbumCoverSchema,
  searchArtistImagesSchema,
  searchImagesSchema,
} from "./schema.ts";

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
    const r = await downloadImage(a.url, { maxBytes: a.maxBytes, cacheDir: a.cacheDir });
    return {
      url: a.url,
      sha256: r.sha256,
      mime: r.mime,
      byteSize: r.bytes.byteLength,
      cachedPath: r.cachedPath,
    };
  }),
  "/probe": wrap(probePageSchema, async (a) =>
    probePage(a.url, { respectRobots: a.respectRobots }),
  ),
  "/license": wrap(fetchWithLicenseSchema, async (a) => {
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
};

export async function dispatchPost(path: string, req: Request): Promise<Response> {
  const h = handlers[path];
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

export function getProviders(): Response {
  const all = Object.keys(ALL_PROVIDERS);
  return new Response(
    JSON.stringify({
      ok: true,
      data: {
        all,
        defaults: DEFAULT_PROVIDERS,
        endpoints: ["/search", "/artist", "/album", "/download", "/probe", "/license", "/similar"],
      },
    }),
    { status: 200, headers: { "content-type": "application/json; charset=utf-8" } },
  );
}
