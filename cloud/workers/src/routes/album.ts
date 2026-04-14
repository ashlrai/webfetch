/** /v1/album — album cover search. */

import { Hono } from "hono";
import { searchAlbumCover } from "@webfetch/core";
import type { Env, RequestCtx } from "../env.ts";
import { searchAlbumCoverSchema } from "../schemas.ts";
import { ok, err, parseJson } from "../responses.ts";
import { recordUsage } from "../metering.ts";
import { unitsFor } from "../../../shared/pricing.ts";

type HonoEnv = { Bindings: Env; Variables: { ctx: RequestCtx } };

export const albumRouter = new Hono<HonoEnv>();

albumRouter.post("/", async (c) => {
  const parsed = await parseJson(c, searchAlbumCoverSchema);
  if (!parsed.ok) return parsed.response;
  const ctx = c.get("ctx");
  try {
    const out = await searchAlbumCover(parsed.data.artist, parsed.data.album, parsed.data);
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/album", unitsFor("/v1/album"), 200));
    return ok(c, {
      candidates: out.candidates,
      providerReports: out.providerReports,
      warnings: out.warnings,
    });
  } catch (e) {
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/album", unitsFor("/v1/album"), 500));
    return err(c, (e as Error).message ?? "album search failed", 500);
  }
});
