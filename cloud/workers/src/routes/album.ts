/** /v1/album — album cover search. */

import { searchAlbumCover } from "@webfetch/core";
import { Hono } from "hono";
import { unitsFor } from "../../../shared/pricing.ts";
import type { Env, RequestCtx } from "../env.ts";
import { recordUsage } from "../metering.ts";
import {
  enforcePoolRateLimit,
  resolveProviderAuth,
  resolveWorkspacePlan,
} from "../middleware/platform-keys.ts";
import { err, ok, parseJson } from "../responses.ts";
import { searchAlbumCoverSchema } from "../schemas.ts";

type HonoEnv = { Bindings: Env; Variables: { ctx: RequestCtx } };

export const albumRouter = new Hono<HonoEnv>();

albumRouter.post("/", async (c) => {
  const parsed = await parseJson(c, searchAlbumCoverSchema);
  if (!parsed.ok) return parsed.response;
  const ctx = c.get("ctx");
  try {
    const plan = await resolveWorkspacePlan(c);
    const poolLimit = await enforcePoolRateLimit(c, plan);
    if (poolLimit) return poolLimit;
    const auth = await resolveProviderAuth(c);
    const out = await searchAlbumCover(parsed.data.artist, parsed.data.album, {
      ...parsed.data,
      auth,
    });
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
