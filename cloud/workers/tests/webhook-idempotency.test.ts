/**
 * B1 — Stripe webhook event-level idempotency.
 *
 * Verifies that calling handleStripeEvent twice with the same event.id is a
 * no-op on the second call: D1 state is identical after both calls and no
 * extra work is performed.
 */

import { describe, expect, test } from "bun:test";
import { handleStripeEvent } from "../src/billing.ts";
import { makeEnv, seedWorkspaceWithKey } from "./harness.ts";

describe("webhook idempotency (B1)", () => {
  test("second call with same event.id is a no-op — D1 state identical", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "free" });

    const event = {
      id: "evt_dedup_001",
      type: "checkout.session.completed",
      data: { object: { client_reference_id: workspaceId, customer: "cus_dedup" } },
    };

    // First call — should process normally.
    await handleStripeEvent(env, event);

    // Verify processed state.
    const evtRow1 = await env.DB.prepare("SELECT status FROM webhook_events WHERE event_id = ?1")
      .bind(event.id)
      .first<{ status: string }>();
    expect(evtRow1?.status).toBe("processed");

    const ws1 = await env.DB.prepare("SELECT stripe_customer_id FROM workspaces WHERE id = ?1")
      .bind(workspaceId)
      .first<{ stripe_customer_id: string }>();
    expect(ws1?.stripe_customer_id).toBe("cus_dedup");

    // Mutate the event payload — second call must NOT apply this change.
    const eventDuplicate = {
      id: "evt_dedup_001", // same id
      type: "checkout.session.completed",
      data: { object: { client_reference_id: workspaceId, customer: "cus_SHOULD_NOT_APPLY" } },
    };

    // Second call — must be a silent no-op.
    await handleStripeEvent(env, eventDuplicate);

    // D1 state must be unchanged.
    const ws2 = await env.DB.prepare("SELECT stripe_customer_id FROM workspaces WHERE id = ?1")
      .bind(workspaceId)
      .first<{ stripe_customer_id: string }>();
    expect(ws2?.stripe_customer_id).toBe("cus_dedup");

    // webhook_events row still processed — not downgraded.
    const evtRow2 = await env.DB.prepare("SELECT status FROM webhook_events WHERE event_id = ?1")
      .bind(event.id)
      .first<{ status: string }>();
    expect(evtRow2?.status).toBe("processed");
  });

  test("failed event is retryable — second call re-processes and seals", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "free" });

    const eventId = "evt_fail_retry_001";

    // Manually insert a 'failed' row (simulates a previous failed attempt).
    await env.DB.prepare(
      `INSERT INTO webhook_events (event_id, type, received_at, status) VALUES (?1, ?2, ?3, 'failed')`,
    )
      .bind(eventId, "checkout.session.completed", Date.now())
      .run();

    // Now call with the same id — should re-process since status='failed'.
    await handleStripeEvent(env, {
      id: eventId,
      type: "checkout.session.completed",
      data: { object: { client_reference_id: workspaceId, customer: "cus_retry" } },
    });

    // Should now be sealed as processed.
    const row = await env.DB.prepare("SELECT status FROM webhook_events WHERE event_id = ?1")
      .bind(eventId)
      .first<{ status: string }>();
    expect(row?.status).toBe("processed");

    // And the workspace should have the customer id applied.
    const ws = await env.DB.prepare("SELECT stripe_customer_id FROM workspaces WHERE id = ?1")
      .bind(workspaceId)
      .first<{ stripe_customer_id: string }>();
    expect(ws?.stripe_customer_id).toBe("cus_retry");
  });

  test("unknown event type is still recorded as processed (ignored, not failed)", async () => {
    const { env } = makeEnv();

    await handleStripeEvent(env, {
      id: "evt_unknown_001",
      type: "something.random",
      data: { object: {} },
    });

    const row = await env.DB.prepare("SELECT status FROM webhook_events WHERE event_id = ?1")
      .bind("evt_unknown_001")
      .first<{ status: string }>();
    expect(row?.status).toBe("processed");
  });
});
