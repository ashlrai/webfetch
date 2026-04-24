/**
 * webfetch Cloud — Hono app + Worker entry.
 *
 * Route groups:
 *   /health                     unauthenticated liveness probe
 *   /auth/*                     Better Auth (session cookies, OAuth, magic link)
 *   /v1/search, /v1/artist, …   metered image endpoints (bearer auth)
 *   /v1/keys, /v1/usage         dashboard endpoints (session cookie auth)
 *   /v1/workspaces/*            workspace CRUD + invites (session cookie auth)
 *   /stripe/webhook             signed Stripe webhook, no user auth
 *
 * Additionally exports a Queue consumer (see `export default` below) that
 * drains UsageMessage batches into D1.
 */

import { Hono } from "hono";
import type { PlanId } from "../../shared/pricing.ts";
import { getSessionUser, handleAuth } from "./auth.ts";
import { billingRouter, emitMeterEventForUsage } from "./billing.ts";
import { runAuditRetention } from "./cron/audit-retention.ts";
import type { Env, RequestCtx, UsageMessage } from "./env.ts";
import { persistUsageRow } from "./metering.ts";
import {
  RateLimiterDO,
  bearerAuth,
  cors,
  csrfGuard,
  quotaGate,
  rateLimit,
  requestIdMiddleware,
} from "./middleware.ts";
import { platformProvidersConfigured } from "./middleware/platform-keys.ts";
import { albumRouter } from "./routes/album.ts";
import { artistRouter } from "./routes/artist.ts";
import { downloadRouter } from "./routes/download.ts";
import { keysRouter } from "./routes/keys.ts";
import { licenseRouter } from "./routes/license.ts";
import { probeRouter } from "./routes/probe.ts";
import { searchRouter } from "./routes/search.ts";
import { similarRouter } from "./routes/similar.ts";
import { teamsRouter } from "./teams.ts";

type HonoEnv = { Bindings: Env; Variables: { ctx: RequestCtx } };

export const app = new Hono<HonoEnv>();

app.use("*", requestIdMiddleware);
app.use("*", cors);

// Unauthenticated.
app.get("/health", (c) => c.json({ ok: true, service: "webfetch-api", env: c.env.ENVIRONMENT }));
app.get("/providers", async (c) => {
  // Avoid hot-path deps on @webfetch/core provider registry.
  const { ALL_PROVIDERS, DEFAULT_PROVIDERS } = await import("@webfetch/core");
  const platformProvidersAvailable = platformProvidersConfigured(c.env);

  // Best-effort user plan resolution — only populated when the caller has a
  // valid session cookie. Public callers still see `userPlan: null`.
  let userPlan: PlanId | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await getSessionUser(c as any);
    if (user) {
      const row = await c.env.DB.prepare(
        `SELECT w.plan AS plan FROM workspaces w
           JOIN members m ON m.workspace_id = w.id
          WHERE m.user_id = ?1
          ORDER BY m.invited_at ASC LIMIT 1`,
      )
        .bind(user.userId)
        .first<{ plan: PlanId }>();
      userPlan = row?.plan ?? "free";
    }
  } catch {
    // ignore — /providers is unauthenticated and should never fail on this.
  }

  return c.json({
    ok: true,
    data: {
      all: Object.keys(ALL_PROVIDERS),
      defaults: DEFAULT_PROVIDERS,
      platformProvidersAvailable,
      userPlan,
      endpoints: [
        "/v1/search",
        "/v1/artist",
        "/v1/album",
        "/v1/download",
        "/v1/probe",
        "/v1/license",
        "/v1/similar",
      ],
    },
  });
});

// Auth subroute — delegates to Better Auth. All paths starting with /auth/...
app.all("/auth/*", handleAuth);

// Stripe webhook (signed, no session/bearer). CSRF guard does not apply —
// Stripe posts from its own origin with a signature we verify in billing.ts.
app.route("/", billingRouter);

// Dashboard cookie-auth routes (no bearer chain).
// SECURITY (SA-007): CSRF guard on all mutation methods. See report.
app.use("/v1/keys/*", csrfGuard);
app.use("/v1/workspaces/*", csrfGuard);
app.route("/v1", keysRouter);
app.route("/v1", teamsRouter);

// API-key (bearer) chain — metered endpoints.
const v1 = new Hono<HonoEnv>();
v1.use("*", bearerAuth);
v1.use("*", rateLimit);
v1.use("*", quotaGate);
v1.route("/search", searchRouter);
v1.route("/artist", artistRouter);
v1.route("/album", albumRouter);
v1.route("/download", downloadRouter);
v1.route("/probe", probeRouter);
v1.route("/license", licenseRouter);
v1.route("/similar", similarRouter);
app.route("/v1", v1);

app.notFound((c) => c.json({ ok: false, error: "not found" }, 404));
app.onError((e, c) => c.json({ ok: false, error: e.message ?? "internal error" }, 500));

export { RateLimiterDO };

// -----------------------------------------------------------------------------
// Worker entry — routes HTTP + queue.
// -----------------------------------------------------------------------------

export default {
  fetch: app.fetch,
  /**
   * Cron entry — currently a single trigger at 03:00 UTC for audit retention.
   * Cloudflare invokes `scheduled` for every cron pattern declared in
   * wrangler.toml; we dispatch by `controller.cron`.
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === "0 3 * * *") {
      ctx.waitUntil(runAuditRetention(env).then(() => undefined));
      return;
    }
    // Unknown cron — run retention as a safe default rather than no-op.
    ctx.waitUntil(runAuditRetention(env).then(() => undefined));
  },
  async queue(batch: MessageBatch<UsageMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        if (msg.body.kind === "usage") {
          await persistUsageRow(env, msg.body);
          // Emit Stripe Billing Meter event for Pro/Team. Fire-and-forget —
          // failures are logged via return value but don't block ack, since
          // duplicate identifier protects the next retry from double-billing.
          await emitMeterEventForUsage(env, msg.body);
        }
        msg.ack();
      } catch (e) {
        // Retryable — Cloudflare will deliver again per wrangler.toml max_retries.
        msg.retry();
      }
    }
  },
};
