/** /v1/probe — page probe, wraps @webfetch/core's probePage. */

import { Hono } from "hono";
import { probePage } from "@webfetch/core";
import type { Env, RequestCtx } from "../env.ts";
import { probePageSchema } from "../schemas.ts";
import { ok, err, parseJson } from "../responses.ts";
import { recordUsage } from "../metering.ts";
import { unitsFor } from "../../../shared/pricing.ts";

type HonoEnv = { Bindings: Env; Variables: { ctx: RequestCtx } };

export const probeRouter = new Hono<HonoEnv>();

probeRouter.post("/", async (c) => {
  const parsed = await parseJson(c, probePageSchema);
  if (!parsed.ok) return parsed.response;
  const ctx = c.get("ctx");
  try {
    const out = await probePage(parsed.data.url, { respectRobots: parsed.data.respectRobots });
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/probe", unitsFor("/v1/probe"), 200));
    return ok(c, out);
  } catch (e) {
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/probe", unitsFor("/v1/probe"), 500));
    return err(c, (e as Error).message ?? "probe failed", 500);
  }
});
