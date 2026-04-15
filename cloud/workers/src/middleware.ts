/**
 * Hono middleware layer: CORS, bearer auth, rate limiting, metering.
 *
 * Order matters. The chain applied by `src/index.ts` for `/v1/*`:
 *
 *   cors  →  requestId  →  bearerAuth  →  rateLimit  →  quotaGate  →  handler
 *                                                                        ↓
 *                                                                 recordUsage
 */

import type { MiddlewareHandler, Context } from "hono";
import type { Env, RequestCtx } from "./env.ts";
import { parseBearer, resolveKey, touchLastUsed } from "./keys.ts";
import { checkQuota } from "./quota.ts";
import { planFor, unitsFor } from "../../shared/pricing.ts";
import { requestId } from "./ids.ts";

type HonoEnv = { Bindings: Env; Variables: { ctx: RequestCtx } };

/** Permissive CORS for `*.getwebfetch.com` + localhost dev. */
export const cors: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const origin = c.req.header("origin") ?? "*";
  const allow = isAllowedOrigin(origin) ? origin : "https://app.getwebfetch.com";
  c.header("access-control-allow-origin", allow);
  c.header("access-control-allow-credentials", "true");
  c.header("access-control-allow-methods", "GET,POST,DELETE,PATCH,OPTIONS");
  c.header(
    "access-control-allow-headers",
    "authorization, content-type, x-request-id, stripe-signature",
  );
  c.header("access-control-max-age", "86400");
  c.header("vary", "origin");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  return next();
};

export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  // SECURITY (SA-005): Previously returned `true` for `origin === "*"`. Combined
  // with `access-control-allow-credentials: true`, that would have been a
  // cross-origin credentialed-read bug. See SECURITY-AUDIT-REPORT.md § HIGH.
  try {
    const { hostname } = new URL(origin);
    // Only bare `localhost` (+ explicit dev ports) — NOT arbitrary
    // `*.localhost` which an attacker can claim via /etc/hosts or a rebinding
    // DNS setup. SA-006.
    if (hostname === "localhost" || hostname === "127.0.0.1") return true;
    if (hostname === "getwebfetch.com") return true;
    if (hostname.endsWith(".getwebfetch.com")) return true;
  } catch {
    /* fallthrough */
  }
  return false;
}

/**
 * CSRF guard for cookie-authenticated mutation routes (dashboard/team/billing/
 * keys). Requires the request Origin (or, for older clients, Referer) to match
 * an allow-listed origin for any non-safe method. Bearer-auth routes are NOT
 * subject to this because attackers cannot forge an Authorization header
 * cross-origin. See SECURITY-AUDIT-REPORT.md § SA-007.
 */
export const csrfGuard: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  const origin = c.req.header("origin");
  const referer = c.req.header("referer");
  // If neither Origin nor Referer is present, the request is not cross-origin
  // from a browser (CSRF vector requires a browser to attach the cookie AND
  // send one of these headers on any fetch). Non-browser clients like curl or
  // server-side tests are permitted — session cookies aren't available there
  // without explicit attacker-controlled session hijack, which is out of scope
  // of CSRF. SA-007.
  if (!origin && !referer) return next();
  const check = origin ?? referer!;
  if (!isAllowedOrigin(check)) {
    return c.json({ ok: false, error: "csrf: origin not allowed" }, 403);
  }
  return next();
};

/** Attach a per-request id; mirrors it into the response header. */
export const requestIdMiddleware: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const rid = c.req.header("x-request-id") ?? requestId();
  c.header("x-request-id", rid);
  // Seed a partial ctx so downstream can read the rid even before auth.
  c.set("ctx", {
    workspaceId: "",
    userId: null,
    apiKeyId: null,
    plan: "free",
    requestId: rid,
  });
  return next();
};

/** Bearer auth. Populates `c.var.ctx`. Rejects with 401 on any failure. */
export const bearerAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const raw = parseBearer(c.req.header("authorization"));
  if (!raw) {
    return c.json({ ok: false, error: "missing bearer token" }, 401);
  }
  const lookup = await resolveKey(c.env, raw);
  if (!lookup) {
    return c.json({ ok: false, error: "invalid or revoked api key" }, 401);
  }
  const prev = c.get("ctx");
  c.set("ctx", {
    ...prev,
    workspaceId: lookup.workspaceId,
    apiKeyId: lookup.apiKeyId,
    plan: lookup.plan,
  });
  // Best-effort last-used update. Do not await — fire and forget.
  c.executionCtx.waitUntil(touchLastUsed(c.env, lookup.apiKeyId));
  return next();
};

/**
 * Rate limit. Simple KV-backed sliding-ish counter per API key per minute.
 * Trades perfect accuracy for Worker-global cheapness. Durable Object upgrade
 * path is outlined in RateLimiterDO below, but the KV path covers all plans
 * for the forseeable launch volume.
 */
export const rateLimit: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const ctx = c.get("ctx");
  if (!ctx.apiKeyId) return next();
  const plan = planFor(ctx.plan);
  const minute = Math.floor(Date.now() / 60_000);
  const key = `rl:${ctx.apiKeyId}:${minute}`;
  const raw = await c.env.RATELIMIT.get(key);
  const current = raw ? Number(raw) : 0;
  if (current >= plan.rateLimitPerMin) {
    c.header("retry-after", "60");
    c.header("x-ratelimit-limit", String(plan.rateLimitPerMin));
    c.header("x-ratelimit-remaining", "0");
    return c.json({ ok: false, error: "rate limit exceeded" }, 429);
  }
  const next_ = current + 1;
  // TTL slightly longer than the window to avoid thundering expirations.
  await c.env.RATELIMIT.put(key, String(next_), { expirationTtl: 120 });
  c.header("x-ratelimit-limit", String(plan.rateLimitPerMin));
  c.header("x-ratelimit-remaining", String(plan.rateLimitPerMin - next_));
  return next();
};

/** Quota gate — 402 on free tier exhaustion, 403 on endpoint-not-in-plan. */
export const quotaGate: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const ctx = c.get("ctx");
  const endpoint = routeTemplate(c);
  const units = unitsFor(endpoint);
  const decision = await checkQuota(c.env, ctx.workspaceId, ctx.plan, endpoint, units);
  c.header("x-quota-included", String(decision.included));
  c.header("x-quota-used", String(decision.used));
  c.header("x-quota-window-end", String(decision.windowEnd));
  if (!decision.allow) {
    if (decision.upgradeUrl) {
      c.header("link", `<${decision.upgradeUrl}>; rel="alternate"`);
    }
    if (decision.reason === "plan_endpoint_forbidden") {
      return c.json({
        ok: false,
        error: "endpoint not available on your plan",
        upgrade: decision.upgradeUrl,
      }, 403);
    }
    return c.json({
      ok: false,
      error: "out of daily allowance — upgrade to continue",
      upgrade: decision.upgradeUrl,
      plan: decision.plan,
      used: decision.used,
      included: decision.included,
    }, 402);
  }
  return next();
};

/** The endpoint string used for metering + quota. Strips query + version. */
export function routeTemplate(c: Context<HonoEnv>): string {
  const path = new URL(c.req.url).pathname;
  return path;
}

// ---------------------------------------------------------------------------
// Durable Object (scaffolded; KV path handles launch volume). Kept exported so
// wrangler.toml's [[migrations]] can bind to the class.
// ---------------------------------------------------------------------------

/**
 * Token-bucket rate limiter, one instance per API key (id hashed into a DO id).
 * A Durable Object gives single-threaded consistency at ~1ms latency — use
 * this when KV-based limits become contentious (hot keys at >1000 rpm).
 */
export class RateLimiterDO {
  private tokens = 0;
  private lastRefill = 0;
  private capacity = 100;
  private refillPerSec = 100 / 60;

  constructor(_state: DurableObjectState, _env: Env) {
    this.lastRefill = Date.now();
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const capacity = Number(url.searchParams.get("capacity") ?? this.capacity);
    if (capacity > 0 && capacity !== this.capacity) {
      this.capacity = capacity;
      this.refillPerSec = capacity / 60;
      if (this.tokens > capacity) this.tokens = capacity;
    }
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
    this.lastRefill = now;
    if (this.tokens < 1) {
      return new Response(JSON.stringify({ allow: false, retryAfter: 60 }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }
    this.tokens -= 1;
    return new Response(JSON.stringify({ allow: true, remaining: Math.floor(this.tokens) }), {
      headers: { "content-type": "application/json" },
    });
  }
}
