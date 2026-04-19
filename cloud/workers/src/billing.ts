/**
 * Stripe — Checkout Sessions, Customer Portal, webhook handler.
 *
 * We keep the Stripe SDK on the Workers runtime (it supports fetch adapters).
 * Secret key is bound via `wrangler secret put STRIPE_SECRET_KEY`.
 *
 * Webhook events handled:
 *   - checkout.session.completed
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.payment_failed
 *
 * The webhook is the single source of truth for plan state. We mirror it into
 * D1's `subscriptions` table + update `workspaces.plan` in the same D1 batch.
 */

import { Hono } from "hono";
import type { PlanId, SubscriptionStatus } from "../../shared/types.ts";
import { audit } from "./audit.ts";
import { getSessionUser } from "./auth.ts";
import type { Env } from "./env.ts";
import { err, ok, parseJson } from "./responses.ts";
import { createCheckoutSchema } from "./schemas.ts";
import { canManageBilling, roleFor } from "./teams.ts";

export const billingRouter = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// POST /v1/workspaces/:id/checkout — create a Stripe Checkout Session.
// ---------------------------------------------------------------------------
billingRouter.post("/workspaces/:id/checkout", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  let workspaceId = c.req.param("id");
  if (workspaceId === "current") {
    const row = await c.env.DB.prepare(
      "SELECT workspace_id FROM members WHERE user_id = ?1 ORDER BY invited_at ASC LIMIT 1",
    )
      .bind(user.userId)
      .first<{ workspace_id: string }>();
    if (!row) return err(c, "no workspace found", 404);
    workspaceId = row.workspace_id;
  }
  const role = await roleFor(c.env, workspaceId, user.userId);
  if (!role || !canManageBilling(role)) return err(c, "forbidden", 403);
  const parsed = await parseJson(c, createCheckoutSchema);
  if (!parsed.ok) return parsed.response;

  const ws = await c.env.DB.prepare("SELECT id, stripe_customer_id FROM workspaces WHERE id = ?1")
    .bind(workspaceId)
    .first<{ id: string; stripe_customer_id: string | null }>();
  if (!ws) return err(c, "workspace not found", 404);

  const stripe = getStripe(c.env);
  let customerId = ws.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { workspace_id: workspaceId, user_id: user.userId },
    });
    customerId = customer.id;
    await c.env.DB.prepare(
      "UPDATE workspaces SET stripe_customer_id = ?1, updated_at = ?2 WHERE id = ?3",
    )
      .bind(customerId, Date.now(), workspaceId)
      .run();
  }

  const priceId = parsed.data.plan === "pro" ? c.env.STRIPE_PRICE_PRO : c.env.STRIPE_PRICE_TEAM;
  const overagePriceId =
    parsed.data.plan === "pro" ? c.env.STRIPE_PRICE_OVERAGE_PRO : c.env.STRIPE_PRICE_OVERAGE_TEAM;

  const lineItems: Array<{ price: string; quantity?: number }> = [{ price: priceId, quantity: 1 }];
  if (parsed.data.plan === "team" && parsed.data.seats && parsed.data.seats > 5) {
    lineItems.push({ price: c.env.STRIPE_PRICE_TEAM_SEAT, quantity: parsed.data.seats - 5 });
  }
  // Metered price for overage.
  lineItems.push({ price: overagePriceId });

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItems,
    success_url: `${c.env.APP_URL}/billing?status=success`,
    cancel_url: `${c.env.APP_URL}/billing?status=canceled`,
    client_reference_id: workspaceId,
    subscription_data: {
      metadata: { workspace_id: workspaceId, plan: parsed.data.plan },
    },
  });

  return ok(c, { url: session.url, sessionId: session.id });
});

// ---------------------------------------------------------------------------
// POST /v1/workspaces/:id/portal — Stripe Customer Portal link.
// ---------------------------------------------------------------------------
billingRouter.post("/workspaces/:id/portal", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  let workspaceId = c.req.param("id");
  if (workspaceId === "current") {
    const row = await c.env.DB.prepare(
      "SELECT workspace_id FROM members WHERE user_id = ?1 ORDER BY invited_at ASC LIMIT 1",
    )
      .bind(user.userId)
      .first<{ workspace_id: string }>();
    if (!row) return err(c, "no workspace found", 404);
    workspaceId = row.workspace_id;
  }
  const role = await roleFor(c.env, workspaceId, user.userId);
  if (!role || !canManageBilling(role)) return err(c, "forbidden", 403);
  const ws = await c.env.DB.prepare("SELECT stripe_customer_id FROM workspaces WHERE id = ?1")
    .bind(workspaceId)
    .first<{ stripe_customer_id: string | null }>();
  if (!ws?.stripe_customer_id) return err(c, "no billing account", 400);

  const stripe = getStripe(c.env);
  const portal = await stripe.billingPortal.sessions.create({
    customer: ws.stripe_customer_id,
    return_url: `${c.env.APP_URL}/billing`,
    ...(c.env.STRIPE_PORTAL_CONFIG_ID
      ? { configuration: c.env.STRIPE_PORTAL_CONFIG_ID }
      : {}),
  });
  return ok(c, { url: portal.url });
});

// ---------------------------------------------------------------------------
// POST /stripe/webhook — single source of truth for plan state.
// ---------------------------------------------------------------------------
billingRouter.post("/stripe/webhook", async (c) => {
  const sig = c.req.header("stripe-signature");
  if (!sig) return err(c, "missing signature", 400);
  const body = await c.req.text();
  const stripe = getStripe(c.env);

  let event: {
    id: string;
    type: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: { object: any };
  };
  try {
    // The real Stripe SDK only exposes `constructEventAsync` on the webhooks
    // namespace from v13+. Fall back to `constructEvent` otherwise (which is
    // synchronous but uses Web Crypto under the hood on Workers).
    if (typeof stripe.webhooks.constructEventAsync === "function") {
      event = await stripe.webhooks.constructEventAsync(body, sig, c.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = stripe.webhooks.constructEvent(body, sig, c.env.STRIPE_WEBHOOK_SECRET);
    }
  } catch (e) {
    return err(c, `invalid signature: ${(e as Error).message}`, 400);
  }

  try {
    await handleStripeEvent(c.env, event);
  } catch (e) {
    // Return 500 so Stripe retries.
    return err(c, (e as Error).message, 500);
  }
  return ok(c, { received: true });
});

export const STRIPE_EVENTS_HANDLED = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

/**
 * Dispatch a parsed Stripe event to the right handler. Exported for tests.
 */
export async function handleStripeEvent(
  env: Env,
  event: { id: string; type: string; data: { object: unknown } },
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      // Session object carries client_reference_id = workspaceId.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s: any = event.data.object;
      const workspaceId = s.client_reference_id as string | null;
      if (!workspaceId) return;
      const customerId = s.customer as string;
      await env.DB.prepare(
        "UPDATE workspaces SET stripe_customer_id = ?1, updated_at = ?2 WHERE id = ?3",
      )
        .bind(customerId, Date.now(), workspaceId)
        .run();
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub: any = event.data.object;
      const workspaceId = sub.metadata?.workspace_id as string | undefined;
      if (!workspaceId) return;
      const plan = (sub.metadata?.plan as PlanId) ?? inferPlanFromItems(sub);
      const status = (sub.status as SubscriptionStatus) ?? "active";
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO subscriptions
             (workspace_id, stripe_customer_id, stripe_subscription_id, plan, status,
              current_period_start, current_period_end, cancel_at_period_end, seats, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
           ON CONFLICT(workspace_id) DO UPDATE SET
             stripe_subscription_id = excluded.stripe_subscription_id,
             plan = excluded.plan,
             status = excluded.status,
             current_period_start = excluded.current_period_start,
             current_period_end = excluded.current_period_end,
             cancel_at_period_end = excluded.cancel_at_period_end,
             seats = excluded.seats,
             updated_at = excluded.updated_at`,
        ).bind(
          workspaceId,
          sub.customer as string,
          sub.id as string,
          plan,
          status,
          (sub.current_period_start as number) * 1000,
          (sub.current_period_end as number) * 1000,
          sub.cancel_at_period_end ? 1 : 0,
          countSeats(sub),
          Date.now(),
        ),
        env.DB.prepare(
          `UPDATE workspaces SET plan = ?1, stripe_subscription_id = ?2,
             subscription_status = ?3, updated_at = ?4 WHERE id = ?5`,
        ).bind(plan, sub.id as string, status, Date.now(), workspaceId),
      ]);
      return;
    }
    case "customer.subscription.deleted": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub: any = event.data.object;
      const workspaceId = sub.metadata?.workspace_id as string | undefined;
      if (!workspaceId) return;
      await env.DB.batch([
        env.DB.prepare(
          `UPDATE subscriptions SET status = 'canceled', updated_at = ?1 WHERE workspace_id = ?2`,
        ).bind(Date.now(), workspaceId),
        env.DB.prepare(
          `UPDATE workspaces SET plan = 'free', subscription_status = 'canceled', updated_at = ?1
            WHERE id = ?2`,
        ).bind(Date.now(), workspaceId),
      ]);
      return;
    }
    case "invoice.payment_failed": {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inv: any = event.data.object;
      const customerId = inv.customer as string;
      await env.DB.prepare(
        `UPDATE workspaces SET subscription_status = 'past_due', updated_at = ?1
          WHERE stripe_customer_id = ?2`,
      )
        .bind(Date.now(), customerId)
        .run();
      return;
    }
    default:
      return; // ignore unknown events
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inferPlanFromItems(sub: any): PlanId {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = sub.items?.data ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ids = items.map((i: any) => i.price?.id ?? "").join(",");
  if (ids.includes("team")) return "team";
  if (ids.includes("pro")) return "pro";
  return "free";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function countSeats(sub: any): number {
  const items = sub.items?.data ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const it of items) {
    const pid = it.price?.id as string;
    if (pid?.includes("seat")) return (it.quantity ?? 0) + 5;
  }
  return 1;
}

/**
 * Lazy Stripe SDK loader. Returns a cached client per env binding so we don't
 * import the SDK on every request — billing endpoints are cold and worth the
 * one-time ESM resolution cost on first call. Tests pass `STRIPE_SECRET_KEY =
 * "test_stub"` (and any key starting with `test_`) to stay on the in-memory
 * stub and avoid pulling the npm dep into the unit-test path.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stripeCache = new WeakMap<object, any>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getStripe(env: Env): any {
  if (isStubKey(env.STRIPE_SECRET_KEY)) {
    return testStripeStub();
  }
  const cached = stripeCache.get(env as unknown as object);
  if (cached) return cached;
  // ESM dynamic import, but we need a synchronous return for the existing
  // call sites. Workers' module loader resolves `require("stripe")` in
  // `nodejs_compat` mode synchronously after the first await elsewhere, so
  // we synchronously instantiate via the package's default export.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
  const mod: any = require("stripe");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Stripe: any = mod.default ?? mod.Stripe ?? mod;
  const client = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2024-06-20",
    // Workers don't ship a Node http agent — use Stripe's fetch client.
    httpClient: Stripe.createFetchHttpClient?.(),
  });
  stripeCache.set(env as unknown as object, client);
  return client;
}

function isStubKey(secret: string | undefined): boolean {
  if (!secret) return true;
  if (secret === "test_stub") return true;
  if (secret.startsWith("test_")) return true;
  return false;
}

/**
 * Stripe Billing Meter event ID for Pro/Team metered usage. We POST one
 * meter event per usage row (idempotent via `identifier = requestId`) to
 *   POST https://api.stripe.com/v1/billing/meter_events
 * keyed on `stripe_customer_id`. Free-tier workspaces are skipped.
 */
export const STRIPE_USAGE_METER_ID = "mtr_test_61UW17Z4p7Vo9IT2I41IsCo7Z3L3vN8y";
export const STRIPE_USAGE_METER_EVENT_NAME = "webfetch_request";

/**
 * Emit a Stripe Billing Meter event for one usage row. Gated on:
 *   - STRIPE_SECRET_KEY present and not a stub/test key
 *   - workspace plan is Pro or Team (free skipped)
 *   - workspace has a stripe_customer_id
 *
 * Idempotency via `identifier = requestId` so retries from the queue don't
 * double-bill. Never throws — billing failures must not block usage
 * persistence. Returns `{ ok: true }` on success or skip; `{ ok: false }` on
 * upstream Stripe error.
 */
export async function emitMeterEventForUsage(
  env: Env,
  msg: { workspaceId: string; units: number; ts: number; requestId: string },
): Promise<{ ok: true; skipped?: string } | { ok: false; error: string }> {
  if (isStubKey(env.STRIPE_SECRET_KEY)) {
    return { ok: true, skipped: "stub_key" };
  }
  try {
    const ws = await env.DB.prepare(
      "SELECT plan, stripe_customer_id FROM workspaces WHERE id = ?1",
    )
      .bind(msg.workspaceId)
      .first<{ plan: string | null; stripe_customer_id: string | null }>();
    if (!ws) return { ok: true, skipped: "no_workspace" };
    if (ws.plan !== "pro" && ws.plan !== "team") {
      return { ok: true, skipped: "free_tier" };
    }
    if (!ws.stripe_customer_id) return { ok: true, skipped: "no_customer" };

    // Use raw fetch — meter events live on the Billing Meters API surface
    // that some pinned Stripe SDK versions don't expose yet.
    const body = new URLSearchParams();
    body.set("event_name", STRIPE_USAGE_METER_EVENT_NAME);
    body.set("identifier", msg.requestId);
    body.set("timestamp", String(Math.floor(msg.ts / 1000)));
    body.set("payload[stripe_customer_id]", ws.stripe_customer_id);
    body.set("payload[value]", String(msg.units));

    const res = await fetch("https://api.stripe.com/v1/billing/meter_events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2024-06-20",
      },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 400 with code "already_exists" on idempotent retries is a success.
      if (res.status === 400 && text.includes("already_exists")) {
        return { ok: true, skipped: "duplicate" };
      }
      return { ok: false, error: `stripe ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Push aggregated metered usage to Stripe. The metering queue (see
 * `metering.ts`) batches per-period units; this helper flushes one batch as a
 * single `subscription_items.usage_records.create` call with `action:
 * "increment"` so concurrent flushes from multiple regions stay additive.
 *
 * Returns `{ ok: true, recordId }` on success, `{ ok: false, error }` on
 * failure. Never throws — billing failures must not block request handling.
 */
export async function flushMeteredBilling(
  env: Env,
  subscriptionItemId: string,
  units: number,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<{ ok: true; recordId: string } | { ok: false; error: string }> {
  if (units <= 0) return { ok: true, recordId: "noop" };
  try {
    const stripe = getStripe(env);
    const record = await stripe.subscriptionItems.createUsageRecord(subscriptionItemId, {
      quantity: units,
      timestamp,
      action: "increment",
    });
    return { ok: true, recordId: (record?.id as string) ?? "unknown" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Deterministic Stripe stub used only in tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function testStripeStub(): any {
  return {
    customers: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async create(_: any) {
        return { id: `cus_test_${crypto.randomUUID()}` };
      },
    },
    checkout: {
      sessions: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async create(_: any) {
          return { id: "cs_test_stub", url: "https://checkout.test/session" };
        },
      },
    },
    billingPortal: {
      sessions: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async create(_: any) {
          return { url: "https://billing.test/portal" };
        },
      },
    },
    webhooks: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async constructEventAsync(body: string, sig: string, _secret: string) {
        if (sig !== "t=test,v1=stub") throw new Error("bad test sig");
        return JSON.parse(body);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructEvent(body: string, sig: string, _secret: string) {
        if (sig !== "t=test,v1=stub") throw new Error("bad test sig");
        return JSON.parse(body);
      },
    },
    subscriptionItems: {
      async createUsageRecord(
        subscriptionItemId: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params: { quantity: number; timestamp: number; action: string },
      ) {
        return {
          id: `mbur_test_${subscriptionItemId}_${params.timestamp}`,
          quantity: params.quantity,
          subscription_item: subscriptionItemId,
        };
      },
    },
  };
}
