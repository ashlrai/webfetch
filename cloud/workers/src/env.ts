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
  STRIPE_PORTAL_CONFIG_ID?: string;

  // Secrets (set via `wrangler secret put`)
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;

  // Email provider (SendGrid). Optional — invites stay queued in D1 if absent.
  SENDGRID_API_KEY?: string;
  EMAIL_FROM?: string;
  // Optional reply-to address. Defaults to the EMAIL_FROM address. Useful when
  // the from-address is a no-reply alias but you want replies routed to a
  // monitored inbox (e.g. from=invites@..., reply-to=support@...).
  REPLY_TO?: string;

  // When SENDGRID_API_KEY is still a `test_*` placeholder, Better Auth's
  // email-verification gate is turned OFF automatically so self-signup works
  // for dogfooding. Set this to "1" to force-on in non-SendGrid environments
  // (e.g. magic-link fallback).
  REQUIRE_EMAIL_VERIFICATION?: string;

  // Contact email included in outbound User-Agent for polite providers
  // (Wikimedia, MusicBrainz, Europeana).
  INGEST_CONTACT_EMAIL?: string;

  // Optional pooled platform provider keys. When present, Pro/Team/Enterprise
  // users get these providers enabled without BYOK. All are optional; any
  // provider whose key is missing is silently skipped.
  PLATFORM_UNSPLASH_ACCESS_KEY?: string;
  PLATFORM_PEXELS_API_KEY?: string;
  PLATFORM_PIXABAY_API_KEY?: string;
  PLATFORM_BRAVE_API_KEY?: string;
  PLATFORM_SERPAPI_KEY?: string;
  PLATFORM_BING_API_KEY?: string;
  PLATFORM_SPOTIFY_CLIENT_ID?: string;
  PLATFORM_SPOTIFY_CLIENT_SECRET?: string;
  PLATFORM_FLICKR_API_KEY?: string;
  PLATFORM_SMITHSONIAN_API_KEY?: string;
  PLATFORM_EUROPEANA_API_KEY?: string;

  // Optional Bright Data managed-browser credentials (Pro+ gated).
  // Uses Web Unlocker REST API — Workers-friendly, billed per request.
  // Single account-level Bearer token from Bright Data → Account → API tokens.
  BRIGHTDATA_API_TOKEN?: string;
  BRIGHTDATA_ZONE?: string; // defaults to "web_unlocker" if unset
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
