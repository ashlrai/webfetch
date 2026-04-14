import { describe, test, expect } from "bun:test";
import { app } from "../src/index.ts";
import { makeEnv, makeExecCtx, seedWorkspaceWithKey } from "./harness.ts";
import { SESSION_COOKIE } from "../src/auth.ts";
import { canManageBilling, canManageMembers, canCreateKeys } from "../src/teams.ts";

const cookie = (t: string) => `${SESSION_COOKIE}=${encodeURIComponent(t)}`;

describe("workspaces + teams", () => {
  test("RBAC predicates", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("admin")).toBe(true);
    expect(canManageMembers("member")).toBe(false);
    expect(canManageBilling("billing")).toBe(true);
    expect(canCreateKeys("readonly")).toBe(false);
    expect(canCreateKeys("member")).toBe(true);
  });

  test("GET /v1/workspaces unauthenticated → 401", async () => {
    const { env } = makeEnv();
    const res = await app.fetch(new Request("http://x/v1/workspaces"), env, makeExecCtx());
    expect(res.status).toBe(401);
  });

  test("POST /v1/workspaces creates a workspace and makes caller the owner", async () => {
    const { env } = makeEnv();
    const { sessionToken } = await seedWorkspaceWithKey(env); // logs a user in
    const res = await app.fetch(
      new Request("http://x/v1/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie(sessionToken) },
        body: JSON.stringify({ name: "New Corp", slug: "new-corp" }),
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { ok: boolean; data: { slug: string } };
    expect(body.data.slug).toBe("new-corp");
  });

  test("duplicate slug → 409", async () => {
    const { env } = makeEnv();
    const { sessionToken } = await seedWorkspaceWithKey(env);
    const mk = () => app.fetch(
      new Request("http://x/v1/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie(sessionToken) },
        body: JSON.stringify({ name: "Dup", slug: "dup-slug" }),
      }),
      env,
      makeExecCtx(),
    );
    const a = await mk();
    expect(a.status).toBe(201);
    const b = await mk();
    expect(b.status).toBe(409);
  });

  test("invite creates an invitation row and returns accept URL", async () => {
    const { env } = makeEnv();
    const { sessionToken, workspaceId } = await seedWorkspaceWithKey(env);
    const res = await app.fetch(
      new Request(`http://x/v1/workspaces/${workspaceId}/invite`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: cookie(sessionToken) },
        body: JSON.stringify({ email: "pal@test.dev", role: "member" }),
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { data: { acceptUrl: string } };
    expect(body.data.acceptUrl).toContain("/invite/");
    const row = await env.DB.prepare(
      `SELECT email, role FROM invitations WHERE workspace_id = ?1`,
    ).bind(workspaceId).first<{ email: string; role: string }>();
    expect(row?.email).toBe("pal@test.dev");
  });

  test("cannot remove the owner", async () => {
    const { env } = makeEnv();
    const { sessionToken, workspaceId, userId } = await seedWorkspaceWithKey(env);
    const res = await app.fetch(
      new Request(`http://x/v1/workspaces/${workspaceId}/members/${userId}`, {
        method: "DELETE",
        headers: { cookie: cookie(sessionToken) },
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(409);
  });
});
