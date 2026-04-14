/** /v1/license — license heuristics for an arbitrary URL. */

import { Hono } from "hono";
import { fetchWithLicense } from "@webfetch/core";
import type { Env, RequestCtx } from "../env.ts";
import { fetchWithLicenseSchema } from "../schemas.ts";
import { ok, err, parseJson } from "../responses.ts";
import { recordUsage } from "../metering.ts";
import { unitsFor } from "../../../shared/pricing.ts";

type HonoEnv = { Bindings: Env; Variables: { ctx: RequestCtx } };

export const licenseRouter = new Hono<HonoEnv>();

licenseRouter.post("/", async (c) => {
  const parsed = await parseJson(c, fetchWithLicenseSchema);
  if (!parsed.ok) return parsed.response;
  const ctx = c.get("ctx");
  try {
    const r = await fetchWithLicense(parsed.data.url, { probe: parsed.data.probe });
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/license", unitsFor("/v1/license"), 200));
    return ok(c, {
      license: r.license,
      confidence: r.confidence,
      author: r.author,
      attributionLine: r.attributionLine,
      sourcePageUrl: r.sourcePageUrl,
      mime: r.mime,
      sha256: r.sha256,
      byteSize: r.bytes?.byteLength,
    });
  } catch (e) {
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/license", unitsFor("/v1/license"), 500));
    return err(c, (e as Error).message ?? "license fetch failed", 500);
  }
});
