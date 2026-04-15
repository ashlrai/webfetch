/**
 * Plan-aware provider-auth resolver.
 *
 * Free tier: returns only the user's BYOK (none, in bearer context) — the 10
 * no-key providers in @webfetch/core work fine without any entries here.
 *
 * Pro / Team / Enterprise: starts from all PLATFORM_* keys present in env, then
 * overlays any BYOK the user has stored. User-supplied keys always win per
 * provider (so a Pro user who BYOs a paid SerpAPI tier uses theirs, not ours).
 *
 * Every platform key is optional: a missing key simply means that provider is
 * not enabled for this request. Graceful degradation — fewer results, no error.
 *
 * This resolver is cheap (one D1 lookup) and caches the workspace plan on the
 * Hono context so repeated calls inside a single request are free.
 */

import type { Context } from "hono";
import type { ProviderAuth } from "@webfetch/core";
import type { PlanId } from "../../../shared/pricing.ts";
import type { Env, RequestCtx } from "../env.ts";

type HonoEnv = { Bindings: Env; Variables: { ctx: RequestCtx; workspacePlan?: PlanId } };

/** Provider slugs used in `platformProvidersAvailable` in `GET /providers`. */
export const PLATFORM_PROVIDER_SLUGS = [
  "unsplash",
  "pexels",
  "pixabay",
  "brave",
  "serpapi",
  "bing",
  "spotify",
  "flickr",
  "smithsonian",
  "europeana",
] as const;
export type PlatformProviderSlug = (typeof PLATFORM_PROVIDER_SLUGS)[number];

/** Return the list of platform provider slugs whose env secret is set. */
export function platformProvidersConfigured(env: Env): PlatformProviderSlug[] {
  const out: PlatformProviderSlug[] = [];
  if (env.PLATFORM_UNSPLASH_ACCESS_KEY) out.push("unsplash");
  if (env.PLATFORM_PEXELS_API_KEY) out.push("pexels");
  if (env.PLATFORM_PIXABAY_API_KEY) out.push("pixabay");
  if (env.PLATFORM_BRAVE_API_KEY) out.push("brave");
  if (env.PLATFORM_SERPAPI_KEY) out.push("serpapi");
  if (env.PLATFORM_BING_API_KEY) out.push("bing");
  if (env.PLATFORM_SPOTIFY_CLIENT_ID && env.PLATFORM_SPOTIFY_CLIENT_SECRET) out.push("spotify");
  if (env.PLATFORM_FLICKR_API_KEY) out.push("flickr");
  if (env.PLATFORM_SMITHSONIAN_API_KEY) out.push("smithsonian");
  if (env.PLATFORM_EUROPEANA_API_KEY) out.push("europeana");
  return out;
}

/** Plans that get the pooled platform keys. */
function isPooledPlan(plan: PlanId): boolean {
  return plan === "pro" || plan === "team" || plan === "enterprise";
}

/** Build the universal UA + contact email every plan gets. */
function baseAuth(env: Env): ProviderAuth {
  const contact = env.INGEST_CONTACT_EMAIL || "hello@ashlr.ai";
  return {
    userAgent: `webfetch-cloud/0.1 (+https://getwebfetch.com; ${contact})`,
  } satisfies ProviderAuth;
}

/** Overlay `src` onto `dst`; only copies defined string values. */
function overlay(dst: ProviderAuth, src: Partial<ProviderAuth> | undefined | null): ProviderAuth {
  if (!src) return dst;
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === "string" && v.length > 0) {
      (dst as Record<string, string>)[k] = v;
    }
  }
  return dst;
}

/**
 * Resolve the ProviderAuth for this request, plan-aware.
 *
 * @param c         Hono context (reads env + workspace plan).
 * @param userBYOK  Optional user-supplied keys (from stored BYOK blob); wins
 *                  per-provider over platform pool.
 */
export async function resolveProviderAuth(
  c: Context<HonoEnv>,
  userBYOK?: Partial<ProviderAuth>,
): Promise<ProviderAuth> {
  const plan = await resolveWorkspacePlan(c);
  const auth = baseAuth(c.env);

  if (isPooledPlan(plan)) {
    const env = c.env;
    overlay(auth, {
      unsplashAccessKey: env.PLATFORM_UNSPLASH_ACCESS_KEY,
      pexelsApiKey: env.PLATFORM_PEXELS_API_KEY,
      pixabayApiKey: env.PLATFORM_PIXABAY_API_KEY,
      braveApiKey: env.PLATFORM_BRAVE_API_KEY,
      bingApiKey: env.PLATFORM_BING_API_KEY,
      serpApiKey: env.PLATFORM_SERPAPI_KEY,
      spotifyClientId: env.PLATFORM_SPOTIFY_CLIENT_ID,
      spotifyClientSecret: env.PLATFORM_SPOTIFY_CLIENT_SECRET,
      flickrApiKey: env.PLATFORM_FLICKR_API_KEY,
      smithsonianApiKey: env.PLATFORM_SMITHSONIAN_API_KEY,
      europeanaApiKey: env.PLATFORM_EUROPEANA_API_KEY,
    });
  }

  // BYOK overlay — user's key always wins for a provider they've configured.
  overlay(auth, userBYOK);
  return auth;
}

/**
 * Resolve the workspace plan for the current request, caching on the Hono
 * context so repeat callers in one request don't re-query D1.
 *
 * Falls back to `ctx.plan` (already populated by bearerAuth from the API key)
 * and ultimately to "free".
 */
export async function resolveWorkspacePlan(c: Context<HonoEnv>): Promise<PlanId> {
  const cached = c.get("workspacePlan");
  if (cached) return cached;

  const ctx = c.get("ctx");
  // bearerAuth already hydrated ctx.plan from the API key row. Use that as our
  // source of truth (it's derived from `workspaces.plan` at key-resolve time).
  // Re-verify against D1 only when no workspaceId is attached (defensive).
  let plan: PlanId = ctx?.plan ?? "free";
  if (ctx?.workspaceId) {
    try {
      const row = await c.env.DB.prepare("SELECT plan FROM workspaces WHERE id = ?1")
        .bind(ctx.workspaceId)
        .first<{ plan: PlanId }>();
      if (row?.plan) plan = row.plan;
    } catch {
      // D1 hiccup — keep ctx.plan fallback.
    }
  }
  c.set("workspacePlan", plan);
  return plan;
}
