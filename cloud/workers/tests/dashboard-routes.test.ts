import { describe, expect, test } from "bun:test";
import { SESSION_COOKIE } from "../src/auth.ts";
import { app } from "../src/index.ts";
import { makeEnv, makeExecCtx, seedWorkspaceWithKey } from "./harness.ts";

const cookie = (t: string) => `${SESSION_COOKIE}=${encodeURIComponent(t)}`;

describe("dashboard (cookie auth) routes", () => {
  test("GET /v1/keys requires workspaceId query", async () => {
    const { env } = makeEnv();
    const { sessionToken } = await seedWorkspaceWithKey(env);
    const res = await app.fetch(
      new Request("http://x/v1/keys", { headers: { cookie: cookie(sessionToken) } }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(400);
  });

  test("POST /v1/keys returns a raw secret once, then listKeys hides it", async () => {
    const { env } = makeEnv();
    const { sessionToken, workspaceId } = await seedWorkspaceWithKey(env);
    const r1 = await app.fetch(
      new Request(`http://x/v1/keys?workspaceId=${workspaceId}`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie(sessionToken) },
        body: JSON.stringify({ name: "deploy" }),
      }),
      env,
      makeExecCtx(),
    );
    expect(r1.status).toBe(201);
    const body = (await r1.json()) as { data: { secret: string; prefix: string } };
    expect(body.data.secret.startsWith("wf_live_")).toBe(true);

    const r2 = await app.fetch(
      new Request(`http://x/v1/keys?workspaceId=${workspaceId}`, {
        headers: { cookie: cookie(sessionToken) },
      }),
      env,
      makeExecCtx(),
    );
    const list = (await r2.json()) as { data: { keys: Array<{ prefix: string }> } };
    expect(list.data.keys.length).toBeGreaterThanOrEqual(1);
    // No raw secret in list responses.
    expect(JSON.stringify(list)).not.toContain(body.data.secret);
  });

  test("GET /v1/usage returns a snapshot", async () => {
    const { env } = makeEnv();
    const { sessionToken, workspaceId } = await seedWorkspaceWithKey(env, { plan: "pro" });
    const res = await app.fetch(
      new Request(`http://x/v1/usage?workspaceId=${workspaceId}`, {
        headers: { cookie: cookie(sessionToken) },
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { snapshot: { plan: string; included: number } } };
    expect(body.data.snapshot.plan).toBe("pro");
    expect(body.data.snapshot.included).toBe(10_000);
  });

  test("unauthorized dashboard access → 401", async () => {
    const { env } = makeEnv();
    const res = await app.fetch(
      new Request("http://x/v1/keys?workspaceId=bogus"),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(401);
  });

  test("GET /providers unauthenticated returns provider list", async () => {
    const { env } = makeEnv();
    const res = await app.fetch(new Request("http://x/providers"), env, makeExecCtx());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { endpoints: string[] } };
    expect(body.data.endpoints).toContain("/v1/search");
  });
});
