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

import type { KVNamespace } from "@cloudflare/workers-types";
import type { ProviderAuth } from "@webfetch/core";
import type { Context } from "hono";
import type { PlanId } from "../../../shared/pricing.ts";
import type { Env, RequestCtx } from "../env.ts";
import { err } from "../responses.ts";

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
  "managed-browser",
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
  if (env.BRIGHTDATA_API_TOKEN) out.push("managed-browser");
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
      brightDataApiToken: env.BRIGHTDATA_API_TOKEN,
      brightDataZone: env.BRIGHTDATA_ZONE,
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

/**
 * Per-workspace pool rate limit — protects the shared provider key pool from
 * one subscriber fanning out across many API keys.
 *
 * Only fires for pooled plans (Pro / Team / Enterprise). Free tier users have
 * no pool access so this gate is irrelevant for them.
 *
 * Limit: 300 requests/minute per workspace across all API keys.
 * KV key: `pool:<workspaceId>:<minute>` on the RATELIMIT namespace.
 * TTL: 120 s (same as the per-key rate-limit — slightly longer than the 60 s
 * window to avoid thundering expirations, matching middleware.ts:141).
 *
 * Fail-open on KV errors so a KV outage never blocks legitimate traffic.
 *
 * Call this right after `resolveProviderAuth` in every route that uses the
 * platform pool. Returns a Response on 429, null when the request may proceed.
 */
export const POOL_RATE_LIMIT = 300; // requests per minute per workspace

/**
 * Read-then-write KV counter with a cap and TTL. Fails OPEN on KV errors —
 * a transient KV outage shouldn't block legitimate paid traffic.
 *
 * Note on the race: KV has no compare-and-swap, so two concurrent requests
 * can both observe `current = cap-1` and both pass. Burst overflow is
 * bounded by edge concurrency; for managed-browser the upstream Bright Data
 * billing is the real backstop.
 */
async function bumpKvCounter(
  kv: KVNamespace,
  key: string,
  cap: number,
  ttlSeconds: number,
): Promise<{ allowed: boolean; current: number }> {
  try {
    const raw = await kv.get(key);
    const current = raw ? Number(raw) : 0;
    if (current >= cap) return { allowed: false, current };
    await kv.put(key, String(current + 1), { expirationTtl: ttlSeconds });
    return { allowed: true, current: current + 1 };
  } catch {
    return { allowed: true, current: 0 };
  }
}

export async function enforcePoolRateLimit(
  c: Context<HonoEnv>,
  plan: PlanId,
): Promise<Response | null> {
  if (!isPooledPlan(plan)) return null;

  const ctx = c.get("ctx");
  if (!ctx?.workspaceId) return null;

  const minute = Math.floor(Date.now() / 60_000);
  const key = `pool:${ctx.workspaceId}:${minute}`;
  const { allowed } = await bumpKvCounter(c.env.RATELIMIT, key, POOL_RATE_LIMIT, 120);
  if (!allowed) {
    c.header("retry-after", "60");
    c.header("x-ratelimit-reason", "pool-fairness");
    return err(c, "pool rate limit exceeded; this protects the shared provider pool", 429);
  }
  return null;
}

/**
 * Per-workspace daily cap on managed-browser (Bright Data) calls. Bright Data
 * Web Unlocker is metered separately by the upstream — this cap protects the
 * platform from a single subscriber blowing the per-day budget.
 *
 * Caps:
 *  - Pro:  200 managed-browser fetches / day
 *  - Team: 1000 managed-browser fetches / day
 *  - Enterprise: 5000 / day
 *  - Free / unknown: 0 (managed-browser is gated to pooled plans anyway)
 *
 * Returns true if the request may proceed (and increments the counter),
 * false if the cap is exhausted. Fails OPEN on KV errors.
 */
export const MANAGED_BROWSER_DAILY_CAP: Record<PlanId, number> = {
  free: 0,
  pro: 200,
  team: 1000,
  enterprise: 5000,
};

export async function tryReserveManagedBrowserCall(
  c: Context<HonoEnv>,
  plan: PlanId,
): Promise<boolean> {
  if (!isPooledPlan(plan)) return false;
  const ctx = c.get("ctx");
  if (!ctx?.workspaceId) return false;
  const cap = MANAGED_BROWSER_DAILY_CAP[plan] ?? 0;
  if (cap <= 0) return false;

  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `bd:${ctx.workspaceId}:${day}`;
  const { allowed } = await bumpKvCounter(c.env.RATELIMIT, key, cap, 90_000);
  return allowed;
}
