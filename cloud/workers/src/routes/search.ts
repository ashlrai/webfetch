/**
 * /v1/search — federated image search. Thin wrapper over @webfetch/core's
 * `searchImages`. The moat (provider federation, license ranking, dedupe)
 * lives in core; this file only handles HTTP framing + metering hooks.
 */

import { searchImages } from "@webfetch/core";
import { Hono } from "hono";
import { unitsFor } from "../../../shared/pricing.ts";
import type { Env, RequestCtx } from "../env.ts";
import { recordUsage } from "../metering.ts";
import { err, ok, parseJson } from "../responses.ts";
import { searchImagesSchema } from "../schemas.ts";

type HonoEnv = { Bindings: Env; Variables: { ctx: RequestCtx } };

export const searchRouter = new Hono<HonoEnv>();

searchRouter.post("/", async (c) => {
  const parsed = await parseJson(c, searchImagesSchema);
  if (!parsed.ok) return parsed.response;
  const ctx = c.get("ctx");
  try {
    const out = await searchImages(parsed.data.query, parsed.data);
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/search", unitsFor("/v1/search"), 200));
    return ok(c, {
      candidates: out.candidates,
      providerReports: out.providerReports,
      warnings: out.warnings,
    });
  } catch (e) {
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/search", unitsFor("/v1/search"), 500));
    return err(c, (e as Error).message ?? "search failed", 500);
  }
});
