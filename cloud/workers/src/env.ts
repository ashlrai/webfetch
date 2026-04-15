/**
 * Typed bindings handed to the Hono app through `c.env`. Mirrors wrangler.toml
 * exactly — add a binding here whenever you add one there.
 */

import type {
  D1Database,
  DurableObjectNamespace,
  KVNamespace,
  Queue,
  R2Bucket,
} from "@cloudflare/workers-types";

export interface Env {
  // D1
  DB: D1Database;

  // KV
  KEYS: KVNamespace;
  RATELIMIT: KVNamespace;
  QUOTA: KVNamespace;

  // R2
  CACHE: R2Bucket;

  // Queue producer (also the consumer entry lives in src/index.ts `queue()`).
  USAGE: Queue<UsageMessage>;

  // Durable Object for per-key rate limiting.
  RL_DO: DurableObjectNamespace;

  // Public config
  APP_URL: string;
  API_URL: string;
  ENVIRONMENT: "production" | "development" | "staging";

  // Stripe price ids
  STRIPE_PRICE_PRO: string;
  STRIPE_PRICE_TEAM: string;
  STRIPE_PRICE_TEAM_SEAT: string;
  STRIPE_PRICE_OVERAGE_PRO: string;
  STRIPE_PRICE_OVERAGE_TEAM: string;

  // Secrets (set via `wrangler secret put`)
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;

  // Email provider (Resend). Optional — invites stay queued in D1 if absent.
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

/** Async usage-metering payload queued from request handlers. */
export interface UsageMessage {
  kind: "usage";
  workspaceId: string;
  apiKeyId: string | null;
  userId: string | null;
  endpoint: string;
  units: number;
  ts: number;
  status: number;
  requestId: string;
}

/** Per-request context attached via Hono's `c.set("ctx", ...)`. */
export interface RequestCtx {
  workspaceId: string;
  userId: string | null;
  apiKeyId: string | null;
  plan: import("../../shared/pricing.ts").PlanId;
  requestId: string;
}
