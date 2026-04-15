import { describe, expect, test } from "bun:test";
import { audit } from "../src/audit.ts";
import { SESSION_COOKIE } from "../src/auth.ts";
import {
  RETENTION_BY_PLAN,
  retentionDaysFor,
  runAuditRetention,
} from "../src/cron/audit-retention.ts";
import { app } from "../src/index.ts";
import { makeEnv, makeExecCtx, seedWorkspaceWithKey } from "./harness.ts";

const cookie = (t: string) => `${SESSION_COOKIE}=${encodeURIComponent(t)}`;
const DAY = 24 * 60 * 60 * 1000;

describe("audit retention — plan-based selection", () => {
  test("free=90, pro=180, team=365, enterprise default 365", () => {
    expect(retentionDaysFor("free", null)).toBe(90);
    expect(retentionDaysFor("pro", null)).toBe(180);
    expect(retentionDaysFor("team", null)).toBe(365);
    expect(retentionDaysFor("enterprise", null)).toBe(365);
  });

  test("enterprise honors per-workspace override", () => {
    expect(retentionDaysFor("enterprise", 730)).toBe(730);
  });

  test("non-enterprise ignores override (stays on plan default)", () => {
    expect(retentionDaysFor("pro", 999)).toBe(RETENTION_BY_PLAN.pro);
  });
});

describe("audit retention — cron sweep", () => {
  test("archives + deletes pre-cutoff rows; keeps in-window rows", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "free" });
    const now = Date.now();
    // free retention = 90d. Insert 2 old rows, 1 fresh.
    await env.DB.prepare(
      "INSERT INTO audit_log (id, workspace_id, action, ts) VALUES (?1, ?2, ?3, ?4)",
    )
      .bind("a-old-1", workspaceId, "test.old", now - 200 * DAY)
      .run();
    await env.DB.prepare(
      "INSERT INTO audit_log (id, workspace_id, action, ts) VALUES (?1, ?2, ?3, ?4)",
    )
      .bind("a-old-2", workspaceId, "test.old", now - 100 * DAY)
      .run();
    await env.DB.prepare(
      "INSERT INTO audit_log (id, workspace_id, action, ts) VALUES (?1, ?2, ?3, ?4)",
    )
      .bind("a-fresh", workspaceId, "test.fresh", now - 1 * DAY)
      .run();

    const results = await runAuditRetention(env, now);
    const r = results.find((x) => x.workspaceId === workspaceId);
    expect(r).toBeDefined();
    expect(r!.archived).toBe(2);
    expect(r!.deleted).toBe(2);
    expect(r!.archiveKey).toContain("audit-archive/");
    expect(r!.archiveKey).toContain(workspaceId);

    const remaining = await env.DB.prepare(
      "SELECT COUNT(*) as n FROM audit_log WHERE workspace_id = ?1",
    )
      .bind(workspaceId)
      .first<{ n: number }>();
    expect(remaining?.n).toBe(1);
  });

  test("noop when no rows to archive", async () => {
    const { env } = makeEnv();
    const { workspaceId } = await seedWorkspaceWithKey(env, { plan: "team" });
    await audit(env, { workspaceId, actorUserId: null, action: "freshly.now" });
    const results = await runAuditRetention(env);
    const r = results.find((x) => x.workspaceId === workspaceId);
    expect(r?.archived).toBe(0);
    expect(r?.archiveKey).toBeNull();
  });
});

describe("audit CSV export endpoint", () => {
  test("admin can stream CSV", async () => {
    const { env } = makeEnv();
    const { sessionToken, workspaceId, userId } = await seedWorkspaceWithKey(env);
    await audit(env, {
      workspaceId,
      actorUserId: userId,
      action: "key.create",
      meta: {
        endpoint: "/v1/keys",
        method: "POST",
        status: 201,
        duration_ms: 12,
        provider: "dashboard",
        ip: "1.2.3.4",
      },
    });
    const res = await app.fetch(
      new Request(`http://x/v1/workspaces/${workspaceId}/audit/export`, {
        headers: { cookie: cookie(sessionToken) },
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const body = await res.text();
    const lines = body.trim().split("\n");
    expect(lines[0]).toBe("ts,user_id,endpoint,method,status,duration_ms,provider,ip,action");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // Find the row we wrote (workspace.create from seed is also present).
    const row = lines.find((l) => l.endsWith(",key.create"));
    expect(row).toBeDefined();
    expect(row!).toContain("/v1/keys");
    expect(row!).toContain(",POST,");
    expect(row!).toContain(",201,");
    expect(row!).toContain(",12,");
    expect(row!).toContain(",1.2.3.4,");
  });

  test("non-admin (member) is rejected with 403", async () => {
    const { env } = makeEnv();
    const { sessionToken, workspaceId, userId } = await seedWorkspaceWithKey(env);
    // Demote the seed owner to member (single-user workspace, just for RBAC test).
    await env.DB.prepare(
      `UPDATE members SET role = 'member' WHERE workspace_id = ?1 AND user_id = ?2`,
    )
      .bind(workspaceId, userId)
      .run();
    const res = await app.fetch(
      new Request(`http://x/v1/workspaces/${workspaceId}/audit/export`, {
        headers: { cookie: cookie(sessionToken) },
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(403);
  });

  test("readonly is rejected with 403", async () => {
    const { env } = makeEnv();
    const { sessionToken, workspaceId, userId } = await seedWorkspaceWithKey(env);
    await env.DB.prepare(
      `UPDATE members SET role = 'readonly' WHERE workspace_id = ?1 AND user_id = ?2`,
    )
      .bind(workspaceId, userId)
      .run();
    const res = await app.fetch(
      new Request(`http://x/v1/workspaces/${workspaceId}/audit/export`, {
        headers: { cookie: cookie(sessionToken) },
      }),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(403);
  });

  test("respects from/to bounds", async () => {
    const { env } = makeEnv();
    const { sessionToken, workspaceId, userId } = await seedWorkspaceWithKey(env);
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO audit_log (id, workspace_id, actor_user_id, action, ts)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind("old-row", workspaceId, userId, "ancient.event", now - 365 * DAY)
      .run();
    const from = new Date(now - DAY).toISOString();
    const to = new Date(now + DAY).toISOString();
    const res = await app.fetch(
      new Request(
        `http://x/v1/workspaces/${workspaceId}/audit/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: { cookie: cookie(sessionToken) } },
      ),
      env,
      makeExecCtx(),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("ancient.event");
  });
});
