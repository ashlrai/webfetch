import { describe, expect, test } from "bun:test";
import { STRIPE_EVENTS_HANDLED, flushMeteredBilling, handleStripeEvent } from "../src/billing.ts";
import { app } from "../src/index.ts";
import { makeEnv, makeExecCtx, seedWorkspaceWithKey } from "./harness.ts";

describe("stripe webhook — event handlers", () => {
  test("checkout.session.completed attaches customer id to workspace", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "free" });
    await handleStripeEvent(env, {
      id: "evt_1",
      type: "checkout.session.completed",
      data: { object: { client_reference_id: workspaceId, customer: "cus_abc" } },
    });
    const row = await env.DB.prepare("SELECT stripe_customer_id FROM workspaces WHERE id = ?1")
      .bind(workspaceId)
      .first<{ stripe_customer_id: string }>();
    expect(row?.stripe_customer_id).toBe("cus_abc");
  });

  test("customer.subscription.updated upgrades plan to pro", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "free" });
    await handleStripeEvent(env, {
      id: "evt_2",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          metadata: { workspace_id: workspaceId, plan: "pro" },
          current_period_start: 1700000000,
          current_period_end: 1702592000,
          cancel_at_period_end: false,
          items: { data: [{ price: { id: "price_pro_test" }, quantity: 1 }] },
        },
      },
    });
    const ws = await env.DB.prepare(
      "SELECT plan, subscription_status FROM workspaces WHERE id = ?1",
    )
      .bind(workspaceId)
      .first<{ plan: string; subscription_status: string }>();
    expect(ws?.plan).toBe("pro");
    expect(ws?.subscription_status).toBe("active");
    const sub = await env.DB.prepare("SELECT plan FROM subscriptions WHERE workspace_id = ?1")
      .bind(workspaceId)
      .first<{ plan: string }>();
    expect(sub?.plan).toBe("pro");
  });

  test("customer.subscription.deleted downgrades to free", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "pro" });
    await handleStripeEvent(env, {
      id: "evt_3",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_z",
          metadata: { workspace_id: workspaceId },
        },
      },
    });
    const ws = await env.DB.prepare(
      "SELECT plan, subscription_status FROM workspaces WHERE id = ?1",
    )
      .bind(workspaceId)
      .first<{ plan: string; subscription_status: string }>();
    expect(ws?.plan).toBe("free");
    expect(ws?.subscription_status).toBe("canceled");
  });

  test("invoice.payment_failed marks workspace past_due", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "pro" });
    await env.DB.prepare(`UPDATE workspaces SET stripe_customer_id = 'cus_pd' WHERE id = ?1`)
      .bind(workspaceId)
      .run();
    await handleStripeEvent(env, {
      id: "evt_4",
      type: "invoice.payment_failed",
      data: { object: { customer: "cus_pd" } },
    });
    const ws = await env.DB.prepare("SELECT subscription_status FROM workspaces WHERE id = ?1")
      .bind(workspaceId)
      .first<{ subscription_status: string }>();
    expect(ws?.subscription_status).toBe("past_due");
  });

  test("STRIPE_EVENTS_HANDLED includes all core subscription events", () => {
    expect(STRIPE_EVENTS_HANDLED).toContain("checkout.session.completed");
    expect(STRIPE_EVENTS_HANDLED).toContain("customer.subscription.created");
    expect(STRIPE_EVENTS_HANDLED).toContain("customer.subscription.updated");
    expect(STRIPE_EVENTS_HANDLED).toContain("customer.subscription.deleted");
    expect(STRIPE_EVENTS_HANDLED).toContain("invoice.payment_failed");
  });

  test("webhook with invalid signature returns 400", async () => {
    const { env } = makeEnv();
    const res = await app.fetch(
      new Request("http://x/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "bogus", "content-type": "application/json" },
        body: JSON.stringify({ type: "noop" }),
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(400);
  });

  test("flushMeteredBilling pushes a usage record via Stripe stub", async () => {
    const { env } = makeEnv();
    const result = await flushMeteredBilling(env, "si_test_meter", 42, 1700000000);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recordId).toContain("si_test_meter");
  });

  test("flushMeteredBilling is a noop for zero units", async () => {
    const { env } = makeEnv();
    const result = await flushMeteredBilling(env, "si_test_meter", 0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recordId).toBe("noop");
  });

  test("webhook with valid stubbed signature returns 200", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "free" });
    const payload = JSON.stringify({
      id: "evt_ok",
      type: "checkout.session.completed",
      data: { object: { client_reference_id: workspaceId, customer: "cus_ok" } },
    });
    const res = await app.fetch(
      new Request("http://x/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": "t=test,v1=stub", "content-type": "application/json" },
        body: payload,
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(200);
  });
});
