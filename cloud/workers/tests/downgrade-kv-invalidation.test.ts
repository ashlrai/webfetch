/**
 * B4 — Workspace downgrade invalidates cached KV entries.
 *
 * Verifies that when a customer.subscription.deleted event is processed, all
 * KV cache entries for the workspace's active API keys are deleted so the next
 * request re-reads plan='free' instead of serving stale pool access.
 */

import { describe, expect, test } from "bun:test";
import { handleStripeEvent } from "../src/billing.ts";
import { createKey } from "../src/keys.ts";
import { makeEnv, seedWorkspaceWithKey } from "./harness.ts";

describe("downgrade KV cache invalidation (B4)", () => {
  test("subscription.deleted purges KV entries for all active keys", async () => {
    const { env } = makeEnv();

    // Seed workspace with pro plan and two API keys.
    const {
      workspaceId,
      apiKey: _key1Secret,
      apiKeyId: _key1Id,
    } = await seedWorkspaceWithKey(env, { plan: "pro" });

    // Create a second key in the same workspace.
    const { userId } = (await env.DB.prepare(
      "SELECT owner_id AS userId FROM workspaces WHERE id = ?1",
    )
      .bind(workspaceId)
      .first<{ userId: string }>()) ?? { userId: "" };

    const key2 = await createKey(env, {
      workspaceId,
      userId,
      name: "second-key",
      plan: "pro",
    });

    // Fetch both key hashes from D1.
    const keyRows = await env.DB.prepare(
      "SELECT id, hash FROM api_keys WHERE workspace_id = ?1 AND revoked_at IS NULL",
    )
      .bind(workspaceId)
      .all<{ id: string; hash: string }>();

    expect(keyRows.results?.length).toBe(2);

    // Verify both KV entries exist (createKey + seedWorkspaceWithKey both put
    // them there as part of normal key creation).
    for (const k of keyRows.results ?? []) {
      const kv = await env.KEYS.get(k.hash, "json");
      expect(kv).not.toBeNull();
    }

    // Fire the downgrade event.
    await handleStripeEvent(env, {
      id: "evt_sub_deleted_b4",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_gone",
          metadata: { workspace_id: workspaceId },
        },
      },
    });

    // Plan must be flipped to free in D1.
    const ws = await env.DB.prepare("SELECT plan FROM workspaces WHERE id = ?1")
      .bind(workspaceId)
      .first<{ plan: string }>();
    expect(ws?.plan).toBe("free");

    // Both KV entries must have been deleted.
    for (const k of keyRows.results ?? []) {
      const kv = await env.KEYS.get(k.hash, "json");
      expect(kv).toBeNull();
    }
  });

  test("downgrade with no active keys does not throw", async () => {
    const { env } = makeEnv();
    const { workspaceId, apiKeyId } = await seedWorkspaceWithKey(env, { plan: "pro" });

    // Revoke the seeded key so no active keys remain.
    await env.DB.prepare("UPDATE api_keys SET revoked_at = ?1 WHERE id = ?2")
      .bind(Date.now(), apiKeyId)
      .run();

    // Should not throw.
    await expect(
      handleStripeEvent(env, {
        id: "evt_sub_deleted_nokeys",
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_nk", metadata: { workspace_id: workspaceId } } },
      }),
    ).resolves.toBeUndefined();

    const ws = await env.DB.prepare("SELECT plan FROM workspaces WHERE id = ?1")
      .bind(workspaceId)
      .first<{ plan: string }>();
    expect(ws?.plan).toBe("free");
  });
});
