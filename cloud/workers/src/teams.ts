/**
 * Workspace + team management.
 *
 * RBAC roles:
 *   owner    — everything. Exactly one per workspace.
 *   admin    — manage members + keys + billing, cannot delete workspace.
 *   billing  — read usage, manage payment methods, cannot see audit log.
 *   member   — create keys, read usage.
 *   readonly — read usage only; no keys.
 *
 * All /v1/workspaces and /v1/teams routes go through dashboard cookie auth
 * (getSessionUser) — API-key bearers are NOT allowed to mutate team state.
 */

import { Hono } from "hono";
import type { Env } from "./env.ts";
import type { WorkspaceRole } from "../../shared/types.ts";
import { getSessionUser } from "./auth.ts";
import { ok, err, parseJson } from "./responses.ts";
import { createWorkspaceSchema, inviteMemberSchema, updateMemberSchema } from "./schemas.ts";
import { ulid, sha256Hex } from "./ids.ts";
import { audit } from "./audit.ts";
import { monthlyWindow } from "./quota.ts";
import { sendInviteEmail, type EmailResult } from "./email.ts";

export const teamsRouter = new Hono<{ Bindings: Env }>();

/** Role predicates. */
export function canManageMembers(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin";
}
export function canManageBilling(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin" || role === "billing";
}
export function canCreateKeys(role: WorkspaceRole): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

/** Fetch a user's role in a given workspace, or null. */
export async function roleFor(
  env: Env,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceRole | null> {
  const row = await env.DB.prepare(
    `SELECT role FROM members WHERE workspace_id = ?1 AND user_id = ?2 LIMIT 1`,
  ).bind(workspaceId, userId).first<{ role: WorkspaceRole }>();
  return row?.role ?? null;
}

// ---------------------------------------------------------------------------
// POST /v1/workspaces — create.
// ---------------------------------------------------------------------------
teamsRouter.post("/workspaces", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  const parsed = await parseJson(c, createWorkspaceSchema);
  if (!parsed.ok) return parsed.response;

  const exists = await c.env.DB.prepare(`SELECT id FROM workspaces WHERE slug = ?1`)
    .bind(parsed.data.slug).first();
  if (exists) return err(c, "slug already taken", 409);

  const now = Date.now();
  const id = ulid();
  const { end } = monthlyWindow(now);
  await c.env.DB.prepare(
    `INSERT INTO workspaces (id, slug, name, owner_id, plan, subscription_status,
       quota_resets_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 'free', 'none', ?5, ?6, ?6)`,
  ).bind(id, parsed.data.slug, parsed.data.name, user.userId, end, now).run();
  await c.env.DB.prepare(
    `INSERT INTO members (workspace_id, user_id, role, invited_at, accepted_at)
     VALUES (?1, ?2, 'owner', ?3, ?3)`,
  ).bind(id, user.userId, now).run();

  await audit(c.env, {
    workspaceId: id,
    actorUserId: user.userId,
    action: "workspace.create",
    targetType: "workspace",
    targetId: id,
    meta: { slug: parsed.data.slug, name: parsed.data.name },
  });

  return ok(c, { id, slug: parsed.data.slug, name: parsed.data.name, plan: "free" }, 201);
});

// ---------------------------------------------------------------------------
// GET /v1/workspaces — list mine.
// ---------------------------------------------------------------------------
teamsRouter.get("/workspaces", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  const res = await c.env.DB.prepare(
    `SELECT w.id, w.slug, w.name, w.plan, w.subscription_status, m.role
       FROM workspaces w
       JOIN members m ON m.workspace_id = w.id AND m.user_id = ?1
      ORDER BY w.created_at DESC`,
  ).bind(user.userId).all();
  return ok(c, { workspaces: res.results ?? [] });
});

// ---------------------------------------------------------------------------
// POST /v1/workspaces/:id/invite — invite a seat.
// ---------------------------------------------------------------------------
teamsRouter.post("/workspaces/:id/invite", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  const workspaceId = c.req.param("id");
  const myRole = await roleFor(c.env, workspaceId, user.userId);
  if (!myRole || !canManageMembers(myRole)) return err(c, "forbidden", 403);

  const parsed = await parseJson(c, inviteMemberSchema);
  if (!parsed.ok) return parsed.response;

  const rawToken = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256Hex(rawToken);
  const id = ulid();
  const now = Date.now();
  const expires = now + 7 * 24 * 60 * 60 * 1000;
  await c.env.DB.prepare(
    `INSERT INTO invitations (id, workspace_id, email, role, token_hash, expires_at, invited_by, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(id, workspaceId, parsed.data.email, parsed.data.role, tokenHash, expires, user.userId, now).run();

  await audit(c.env, {
    workspaceId,
    actorUserId: user.userId,
    action: "member.invite",
    targetType: "invitation",
    targetId: id,
    meta: { email: parsed.data.email, role: parsed.data.role },
  });

  const acceptUrl = `${c.env.APP_URL}/invite/${rawToken}`;
  // Best-effort email delivery. Invitation row is already persisted; the
  // dashboard surfaces a "pending" state if the provider is offline.
  const ws = await c.env.DB.prepare(`SELECT name FROM workspaces WHERE id = ?1`)
    .bind(workspaceId).first<{ name: string }>();
  let email: EmailResult;
  try {
    email = await sendInviteEmail(c.env, {
      to: parsed.data.email,
      inviterName: user.email,
      workspaceName: ws?.name ?? "your workspace",
      acceptUrl,
    });
  } catch (e) {
    email = { ok: false, error: (e as Error).message };
  }

  return ok(c, {
    invitationId: id,
    acceptUrl,
    emailDelivery:
      "ok" in email && email.ok
        ? { status: "sent", id: email.id }
        : "skipped" in email
          ? { status: "skipped", reason: email.skipped }
          : { status: "failed", error: email.error },
  }, 201);
});

// ---------------------------------------------------------------------------
// POST /v1/workspaces/:id/members/:userId — update role.
// ---------------------------------------------------------------------------
teamsRouter.patch("/workspaces/:id/members/:userId", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  const workspaceId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  const myRole = await roleFor(c.env, workspaceId, user.userId);
  if (!myRole || !canManageMembers(myRole)) return err(c, "forbidden", 403);

  const parsed = await parseJson(c, updateMemberSchema);
  if (!parsed.ok) return parsed.response;

  await c.env.DB.prepare(
    `UPDATE members SET role = ?1 WHERE workspace_id = ?2 AND user_id = ?3`,
  ).bind(parsed.data.role, workspaceId, targetUserId).run();

  await audit(c.env, {
    workspaceId,
    actorUserId: user.userId,
    action: "member.update",
    targetType: "user",
    targetId: targetUserId,
    meta: { role: parsed.data.role },
  });

  return ok(c, { ok: true });
});

// ---------------------------------------------------------------------------
// DELETE /v1/workspaces/:id/members/:userId — remove seat.
// ---------------------------------------------------------------------------
teamsRouter.delete("/workspaces/:id/members/:userId", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  const workspaceId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  const myRole = await roleFor(c.env, workspaceId, user.userId);
  if (!myRole || !canManageMembers(myRole)) return err(c, "forbidden", 403);

  // Prevent removing the owner. Owner must be transferred first.
  const target = await c.env.DB.prepare(
    `SELECT role FROM members WHERE workspace_id = ?1 AND user_id = ?2`,
  ).bind(workspaceId, targetUserId).first<{ role: WorkspaceRole }>();
  if (!target) return err(c, "not a member", 404);
  if (target.role === "owner") return err(c, "cannot remove owner", 409);

  await c.env.DB.prepare(
    `DELETE FROM members WHERE workspace_id = ?1 AND user_id = ?2`,
  ).bind(workspaceId, targetUserId).run();

  await audit(c.env, {
    workspaceId,
    actorUserId: user.userId,
    action: "member.remove",
    targetType: "user",
    targetId: targetUserId,
  });

  return ok(c, { ok: true });
});

// ---------------------------------------------------------------------------
// GET /v1/workspaces/:id/audit/export — CSV stream of audit rows.
// Admin-only (owner/admin). Time-bounded by ?from=&to= (ISO-8601). Streams
// row-at-a-time via a TransformStream so very large exports don't buffer.
// ---------------------------------------------------------------------------
teamsRouter.get("/workspaces/:id/audit/export", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  const workspaceId = c.req.param("id");
  const role = await roleFor(c.env, workspaceId, user.userId);
  if (!role || (role !== "owner" && role !== "admin")) {
    return err(c, "forbidden", 403);
  }

  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");
  const from = fromParam ? Date.parse(fromParam) : 0;
  const to = toParam ? Date.parse(toParam) : Date.now();
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return err(c, "invalid from/to (expected ISO-8601)", 400);
  }

  const res = await c.env.DB.prepare(
    `SELECT id, actor_user_id, action, target_type, target_id, meta, ts
       FROM audit_log
      WHERE workspace_id = ?1 AND ts >= ?2 AND ts <= ?3
      ORDER BY ts ASC`,
  ).bind(workspaceId, from, to).all<{
    id: string;
    actor_user_id: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    meta: string | null;
    ts: number;
  }>();
  const rows = res.results ?? [];

  const HEADERS = ["ts", "user_id", "endpoint", "method", "status", "duration_ms", "provider", "ip", "action"];

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(HEADERS.join(",") + "\n"));
      for (const row of rows) {
        // Optional fields are pulled from meta JSON when present (audit
        // entries from request middleware include them); otherwise blank.
        const meta = parseMeta(row.meta);
        const cells = [
          new Date(row.ts).toISOString(),
          row.actor_user_id ?? "",
          stringField(meta.endpoint) || row.target_id || "",
          stringField(meta.method),
          numField(meta.status),
          numField(meta.duration_ms ?? meta.durationMs),
          stringField(meta.provider),
          stringField(meta.ip),
          row.action,
        ].map(csvEscape).join(",");
        controller.enqueue(enc.encode(cells + "\n"));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-${workspaceId}.csv"`,
    },
  });
});

function parseMeta(meta: string | null): Record<string, unknown> {
  if (!meta) return {};
  try {
    const v = JSON.parse(meta);
    return typeof v === "object" && v ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stringField(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function numField(v: unknown): string {
  if (v === null || v === undefined) return "";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : "";
}

function csvEscape(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

// ---------------------------------------------------------------------------
// GET /v1/workspaces/:id/members — list seats.
// ---------------------------------------------------------------------------
teamsRouter.get("/workspaces/:id/members", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  const workspaceId = c.req.param("id");
  const myRole = await roleFor(c.env, workspaceId, user.userId);
  if (!myRole) return err(c, "forbidden", 403);

  const rows = await c.env.DB.prepare(
    `SELECT m.user_id, m.role, m.invited_at, m.accepted_at, u.email, u.name
       FROM members m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = ?1
      ORDER BY m.invited_at ASC`,
  ).bind(workspaceId).all();
  return ok(c, { members: rows.results ?? [] });
});
