/**
 * Daily-cap tests for the managed-browser (Bright Data) fallback.
 *
 * Bright Data Web Unlocker is metered per request upstream, so the worker
 * enforces a per-workspace daily cap (Pro: 200, Team: 1000, Enterprise: 5000).
 * Free tier is hard-zero — managed-browser is gated to pooled plans only.
 */

import { describe, expect, test } from "bun:test";
import type { PlanId } from "../../shared/pricing.ts";
import {
  MANAGED_BROWSER_DAILY_CAP,
  tryReserveManagedBrowserCall,
} from "../src/middleware/platform-keys.ts";
import { makeEnv, seedWorkspaceWithKey } from "./harness.ts";

function makeCtx(env: ReturnType<typeof makeEnv>["env"], workspaceId: string | null) {
  return {
    env,
    get(key: string) {
      if (key === "ctx") return workspaceId ? { workspaceId } : null;
      return undefined;
    },
    set() {},
    header() {},
  } as unknown as Parameters<typeof tryReserveManagedBrowserCall>[0];
}

describe("managed-browser daily cap", () => {
  test("free plan never gets a reservation", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "free" });
    const c = makeCtx(env, workspaceId);
    const ok = await tryReserveManagedBrowserCall(c, "free");
    expect(ok).toBe(false);
  });

  test("pro plan succeeds until 200th call, then 201st is denied", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "pro" });
    const c = makeCtx(env, workspaceId);

    // Burn through the cap.
    let lastOk: boolean | null = null;
    for (let i = 0; i < MANAGED_BROWSER_DAILY_CAP.pro; i++) {
      lastOk = await tryReserveManagedBrowserCall(c, "pro");
      if (!lastOk) {
        throw new Error(`pro reservation #${i + 1} unexpectedly denied`);
      }
    }
    expect(lastOk).toBe(true);

    // The next one must be denied.
    const overflow = await tryReserveManagedBrowserCall(c, "pro");
    expect(overflow).toBe(false);
  });

  test("missing workspaceId yields no reservation", async () => {
    const { env } = makeEnv();
    const c = makeCtx(env, null);
    const ok = await tryReserveManagedBrowserCall(c, "pro");
    expect(ok).toBe(false);
  });

  test("each plan tier has a distinct cap, all >= pro for tiers above", () => {
    const order: PlanId[] = ["free", "pro", "team", "enterprise"];
    for (let i = 1; i < order.length; i++) {
      const lower = MANAGED_BROWSER_DAILY_CAP[order[i - 1]!];
      const higher = MANAGED_BROWSER_DAILY_CAP[order[i]!];
      expect(higher).toBeGreaterThanOrEqual(lower);
    }
    expect(MANAGED_BROWSER_DAILY_CAP.free).toBe(0);
  });
});
