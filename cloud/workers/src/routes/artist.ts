/** /v1/artist — specialized artist image search. See search.ts for shape. */

import { searchArtistImages } from "@webfetch/core";
import { Hono } from "hono";
import { unitsFor } from "../../../shared/pricing.ts";
import type { Env, RequestCtx } from "../env.ts";
import { recordUsage } from "../metering.ts";
import { resolveProviderAuth } from "../middleware/platform-keys.ts";
import { err, ok, parseJson } from "../responses.ts";
import { searchArtistImagesSchema } from "../schemas.ts";

type HonoEnv = { Bindings: Env; Variables: { ctx: RequestCtx } };

export const artistRouter = new Hono<HonoEnv>();

artistRouter.post("/", async (c) => {
  const parsed = await parseJson(c, searchArtistImagesSchema);
  if (!parsed.ok) return parsed.response;
  const ctx = c.get("ctx");
  try {
    const auth = await resolveProviderAuth(c);
    const out = await searchArtistImages(parsed.data.artist, parsed.data.kind, {
      ...parsed.data,
      auth,
    });
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/artist", unitsFor("/v1/artist"), 200));
    return ok(c, {
      candidates: out.candidates,
      providerReports: out.providerReports,
      warnings: out.warnings,
    });
  } catch (e) {
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/artist", unitsFor("/v1/artist"), 500));
    return err(c, (e as Error).message ?? "artist search failed", 500);
  }
});
