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
import {
  enforcePoolRateLimit,
  resolveProviderAuth,
  resolveWorkspacePlan,
  tryReserveManagedBrowserCall,
} from "../middleware/platform-keys.ts";
import { err, ok, parseJson } from "../responses.ts";
import { searchImagesSchema } from "../schemas.ts";

type HonoEnv = { Bindings: Env; Variables: { ctx: RequestCtx } };

export const searchRouter = new Hono<HonoEnv>();

searchRouter.post("/", async (c) => {
  const parsed = await parseJson(c, searchImagesSchema);
  if (!parsed.ok) return parsed.response;
  const ctx = c.get("ctx");
  try {
    const plan = await resolveWorkspacePlan(c);
    const poolLimit = await enforcePoolRateLimit(c, plan);
    if (poolLimit) return poolLimit;
    const auth = await resolveProviderAuth(c);

    // Honor explicit `providers` request (including caller asking for managed-browser
    // directly). Otherwise let the licensed providers run, then fall back to managed-browser
    // if and only if they all came back empty AND the workspace is on a pooled plan with
    // Bright Data configured AND under its daily cap. Mirrors the pricing-page promise:
    // "managed browser fallback for when APIs miss".
    const explicitProviders = parsed.data.providers;
    const out = await searchImages(parsed.data.query, { ...parsed.data, auth });
    const warnings = [...out.warnings];
    let candidates = out.candidates;
    let providerReports = out.providerReports;

    const managedBrowserAvailable = Boolean(auth.brightDataApiToken);
    const wantsAutoFallback =
      !explicitProviders &&
      candidates.length === 0 &&
      managedBrowserAvailable;

    if (wantsAutoFallback) {
      const reserved = await tryReserveManagedBrowserCall(c, plan);
      if (reserved) {
        const fallback = await searchImages(parsed.data.query, {
          ...parsed.data,
          auth,
          providers: ["managed-browser"],
        });
        candidates = fallback.candidates;
        providerReports = [...providerReports, ...fallback.providerReports];
        warnings.push(...fallback.warnings);
        if (candidates.length > 0) {
          warnings.push(
            "managed-browser fallback used: results are license: UNKNOWN; not safe to ship without review",
          );
        }
      } else {
        warnings.push("managed-browser fallback skipped: daily cap reached for this workspace");
      }
    }

    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/search", unitsFor("/v1/search"), 200));
    return ok(c, { candidates, providerReports, warnings });
  } catch (e) {
    c.executionCtx.waitUntil(recordUsage(c.env, ctx, "/v1/search", unitsFor("/v1/search"), 500));
    return err(c, (e as Error).message ?? "search failed", 500);
  }
});
