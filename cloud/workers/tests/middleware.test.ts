import { describe, expect, test } from "bun:test";
import { planFor } from "../../shared/pricing.ts";
import { app } from "../src/index.ts";
import { incrementUsage } from "../src/quota.ts";
import { makeEnv, makeExecCtx, seedWorkspaceWithKey } from "./harness.ts";

const hdrs = (auth?: string) => ({
  "content-type": "application/json",
  ...(auth ? { authorization: `Bearer ${auth}` } : {}),
});

describe("middleware chain (via /v1/search)", () => {
  test("missing bearer → 401", async () => {
    const { env } = makeEnv();
    const res = await app.fetch(
      new Request("http://x/v1/search", { method: "POST", headers: hdrs() }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(401);
  });

  test("bogus bearer → 401", async () => {
    const { env } = makeEnv();
    const res = await app.fetch(
      new Request("http://x/v1/search", {
        method: "POST",
        headers: hdrs(`wf_live_${"x".repeat(32)}`),
        body: JSON.stringify({ query: "hi" }),
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(401);
  });

  test("free tier exhausted → 402 with Link header", async () => {
    const { env } = makeEnv();
    const { apiKey, workspaceId } = await seedWorkspaceWithKey(env, { plan: "free" });
    await incrementUsage(env, workspaceId, planFor("free"), 100);
    const res = await app.fetch(
      new Request("http://x/v1/search", {
        method: "POST",
        headers: hdrs(apiKey),
        body: JSON.stringify({ query: "hi" }),
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(402);
    expect(res.headers.get("link") ?? "").toContain("pricing");
  });

  test("rate limit exceeded → 429 with retry-after", async () => {
    const { env } = makeEnv();
    const { apiKey, apiKeyId } = await seedWorkspaceWithKey(env, { plan: "free" });
    // Simulate 10 rpm already consumed for this minute.
    const minute = Math.floor(Date.now() / 60_000);
    await env.RATELIMIT.put(`rl:${apiKeyId}:${minute}`, "10", { expirationTtl: 120 });
    const res = await app.fetch(
      new Request("http://x/v1/search", {
        method: "POST",
        headers: hdrs(apiKey),
        body: JSON.stringify({ query: "hi" }),
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  test("CORS preflight returns 204 with allow-origin", async () => {
    const { env } = makeEnv();
    const res = await app.fetch(
      new Request("http://x/v1/search", {
        method: "OPTIONS",
        headers: { origin: "https://app.getwebfetch.com" },
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.getwebfetch.com");
  });

  test("x-request-id propagated from client", async () => {
    const { env } = makeEnv();
    const res = await app.fetch(
      new Request("http://x/health", { headers: { "x-request-id": "rid-abc" } }),
      env,
      makeExecCtx(),
    );
    expect(res.headers.get("x-request-id")).toBe("rid-abc");
  });

  test("/health is unauthenticated and cheap", async () => {
    const { env } = makeEnv();
    const res = await app.fetch(new Request("http://x/health"), env, makeExecCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("endpoint forbidden on free plan → 403", async () => {
    const { env } = makeEnv();
    const { apiKey } = await seedWorkspaceWithKey(env, { plan: "free" });
    const res = await app.fetch(
      new Request("http://x/v1/similar", {
        method: "POST",
        headers: hdrs(apiKey),
        body: JSON.stringify({ url: "https://example.com/x.jpg" }),
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(403);
  });
});
