/**
 * B3 — Per-workspace pool rate limit.
 *
 * Verifies that the 301st request in a minute from a pooled-plan workspace
 * receives a 429 with the correct headers and error body.
 */

import { describe, expect, test } from "bun:test";
import type { PlanId } from "../../shared/pricing.ts";
import { POOL_RATE_LIMIT, enforcePoolRateLimit } from "../src/middleware/platform-keys.ts";
import { makeEnv, seedWorkspaceWithKey } from "./harness.ts";

/** Build a minimal Hono-like Context stub for enforcePoolRateLimit. */
function makeCtx(env: ReturnType<typeof makeEnv>["env"], workspaceId: string, plan: PlanId) {
  let _plan: PlanId | undefined;
  const headers = new Map<string, string>();
  let _status = 200;
  let _jsonBody: unknown;

  const c = {
    env,
    get(key: string) {
      if (key === "workspacePlan") return _plan;
      if (key === "ctx") return { workspaceId, plan };
      return undefined;
    },
    set(key: string, value: unknown) {
      if (key === "workspacePlan") _plan = value as PlanId;
    },
    header(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    json(body: unknown, status: number) {
      _jsonBody = body;
      _status = status;
      return new Response(JSON.stringify(body), { status });
    },
    // Expose for assertions.
    _headers: headers,
    _getStatus: () => _status,
    _getBody: () => _jsonBody,
  };
  return c as unknown as Parameters<typeof enforcePoolRateLimit>[0];
}

describe("pool rate limit (B3)", () => {
  test("free-plan requests always pass through (no limit)", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "free" });
    const c = makeCtx(env, workspaceId, "free");
    // Should never return a response regardless of counter.
    const res = await enforcePoolRateLimit(c, "free");
    expect(res).toBeNull();
  });

  test("pro plan: first 300 requests pass, 301st returns 429", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "pro" });

    // Seed the KV counter to exactly the limit.
    const minute = Math.floor(Date.now() / 60_000);
    const key = `pool:${workspaceId}:${minute}`;
    await env.RATELIMIT.put(key, String(POOL_RATE_LIMIT), { expirationTtl: 120 });

    // 301st call must be rejected.
    const c = makeCtx(env, workspaceId, "pro");
    const res = await enforcePoolRateLimit(c, "pro");

    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);

    const body = (await res!.json()) as { error: string };
    expect(body.error).toContain("pool rate limit exceeded");

    // Headers must be set on the context.
    const cAny = c as unknown as { _headers: Map<string, string> };
    expect(cAny._headers.get("retry-after")).toBe("60");
    expect(cAny._headers.get("x-ratelimit-reason")).toBe("pool-fairness");
  });

  test("team plan: 301st call returns 429", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "team" });

    const minute = Math.floor(Date.now() / 60_000);
    await env.RATELIMIT.put(`pool:${workspaceId}:${minute}`, String(POOL_RATE_LIMIT), {
      expirationTtl: 120,
    });

    const c = makeCtx(env, workspaceId, "team");
    const res = await enforcePoolRateLimit(c, "team");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
  });

  test("counter increments on each passing request", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "pro" });

    // Start from zero — make 3 calls.
    for (let i = 0; i < 3; i++) {
      const c = makeCtx(env, workspaceId, "pro");
      const res = await enforcePoolRateLimit(c, "pro");
      expect(res).toBeNull(); // all should pass
    }

    const minute = Math.floor(Date.now() / 60_000);
    const raw = await env.RATELIMIT.get(`pool:${workspaceId}:${minute}`);
    expect(Number(raw)).toBe(3);
  });

  test("fail-open: KV error does not block the request", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "pro" });

    // Replace RATELIMIT with a broken KV that always throws.
    const brokenKV = {
      async get() {
        throw new Error("kv unavailable");
      },
      async put() {
        throw new Error("kv unavailable");
      },
      async delete() {
        throw new Error("kv unavailable");
      },
    };
    const brokenEnv = { ...env, RATELIMIT: brokenKV as never };

    const c = makeCtx(brokenEnv, workspaceId, "pro");
    // Should not throw, and should return null (fail-open).
    const res = await enforcePoolRateLimit(c, "pro");
    expect(res).toBeNull();
  });
});
