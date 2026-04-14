import { describe, test, expect } from "bun:test";
import { makeEnv, seedWorkspaceWithKey } from "./harness.ts";
import {
  checkQuota,
  incrementUsage,
  readUsage,
  usageSnapshot,
  dailyWindow,
  monthlyWindow,
} from "../src/quota.ts";
import { planFor } from "../../shared/pricing.ts";

describe("quota", () => {
  test("dailyWindow and monthlyWindow cross midnight/month boundaries", () => {
    const d = dailyWindow(Date.UTC(2026, 3, 13, 12, 0, 0));
    expect(d.end - d.start).toBe(86_400_000);
    const m = monthlyWindow(Date.UTC(2026, 3, 13, 12, 0, 0));
    expect(m.start).toBe(Date.UTC(2026, 3, 1));
    expect(m.end).toBe(Date.UTC(2026, 4, 1));
  });

  test("free plan hard-caps at 100 fetches per day", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "free" });
    const free = planFor("free");
    // Pretend 100 already used.
    await incrementUsage(env, workspaceId, free, 100);
    const decision = await checkQuota(env, workspaceId, "free", "/v1/search", 1);
    expect(decision.allow).toBe(false);
    expect(decision.reason).toBe("quota_exceeded_free");
    expect(decision.upgradeUrl).toContain("pricing");
  });

  test("free plan allows fetches below cap", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "free" });
    const free = planFor("free");
    await incrementUsage(env, workspaceId, free, 50);
    const d = await checkQuota(env, workspaceId, "free", "/v1/search", 1);
    expect(d.allow).toBe(true);
    expect(d.used).toBe(50);
  });

  test("free plan blocks /v1/similar (endpoint not in plan)", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "free" });
    const d = await checkQuota(env, workspaceId, "free", "/v1/similar", 1);
    expect(d.allow).toBe(false);
    expect(d.reason).toBe("plan_endpoint_forbidden");
  });

  test("pro plan allows overage (tracked, not blocked)", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "pro" });
    const pro = planFor("pro");
    await incrementUsage(env, workspaceId, pro, 10_500);
    const d = await checkQuota(env, workspaceId, "pro", "/v1/search", 1);
    expect(d.allow).toBe(true);
    expect(d.overage).toBeGreaterThan(500);
  });

  test("incrementUsage increments the counter monotonically", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "pro" });
    const pro = planFor("pro");
    await incrementUsage(env, workspaceId, pro, 3);
    await incrementUsage(env, workspaceId, pro, 2);
    const total = await readUsage(env, workspaceId, pro);
    expect(total).toBe(5);
  });

  test("usageSnapshot reports window bounds and usage totals", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "pro" });
    const pro = planFor("pro");
    await incrementUsage(env, workspaceId, pro, 42);
    const snap = await usageSnapshot(env, workspaceId, "pro");
    expect(snap.used).toBe(42);
    expect(snap.included).toBe(pro.includedFetches);
    expect(snap.windowEnd).toBeGreaterThan(snap.windowStart);
  });
});
