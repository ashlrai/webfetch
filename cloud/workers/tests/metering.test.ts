import { describe, test, expect } from "bun:test";
import { makeEnv } from "./harness.ts";
import { recordUsage, persistUsageRow } from "../src/metering.ts";
import { readUsage } from "../src/quota.ts";
import { planFor } from "../../shared/pricing.ts";

describe("metering", () => {
  test("recordUsage enqueues a message and increments KV counter", async () => {
    const { env, queueSpy } = makeEnv();
    const ctx = {
      workspaceId: "ws1",
      userId: "u1",
      apiKeyId: "k1",
      plan: "pro" as const,
      requestId: "r1",
    };
    await recordUsage(env, ctx, "/v1/search", 1, 200);
    expect(queueSpy.messages).toHaveLength(1);
    expect(queueSpy.messages[0]!.workspaceId).toBe("ws1");
    expect(queueSpy.messages[0]!.units).toBe(1);
    const used = await readUsage(env, "ws1", planFor("pro"));
    expect(used).toBe(1);
  });

  test("persistUsageRow writes to D1", async () => {
    const { env } = makeEnv();
    // Schema requires an existing workspace is NOT constrained (no FK on usage_rows).
    await persistUsageRow(env, {
      kind: "usage",
      workspaceId: "ws-x",
      apiKeyId: "k-x",
      userId: "u-x",
      endpoint: "/v1/search",
      units: 2,
      ts: Date.now(),
      status: 200,
      requestId: "rid-1",
    });
    const row = await env.DB.prepare(
      `SELECT endpoint, units FROM usage_rows WHERE workspace_id = ?1`,
    ).bind("ws-x").first<{ endpoint: string; units: number }>();
    expect(row?.endpoint).toBe("/v1/search");
    expect(row?.units).toBe(2);
  });
});
