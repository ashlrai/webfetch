/** /v1/similar — reverse image search. */

import { findSimilar } from "@webfetch/core";
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
import { findSimilarSchema } from "../schemas.ts";
import { assertPublicHttpUrl } from "../ssrf.ts";

type HonoEnv = { Bindings: Env; Variables: { ctx: RequestCtx } };

export const similarRouter = new Hono<HonoEnv>();

similarRouter.post("/", async (c) => {
  const parsed = await parseJson(c, findSimilarSchema);
  if (!parsed.ok) return parsed.response;
  const ctx = c.get("ctx");
  // SECURITY (SA-004 / CWE-918): Block SSRF via private/internal hostnames.
  const ssrfCheck = assertPublicHttpUrl(parsed.data.url);
  if (!ssrfCheck.ok) return err(c, ssrfCheck.error, 400);
  try {
    const plan = await resolveWorkspacePlan(c);
    const poolLimit = await enforcePoolRateLimit(c, plan);
    if (poolLimit) return poolLimit;
    const auth = await resolveProviderAuth(c);
    const out = await findSimilar(
      { url: parsed.data.url },
      { providers: parsed.data.providers, auth },
    );
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/similar", unitsFor("/v1/similar"), 200));
    return ok(c, out);
  } catch (e) {
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/similar", unitsFor("/v1/similar"), 500));
    return err(c, (e as Error).message ?? "similar search failed", 500);
  }
});
