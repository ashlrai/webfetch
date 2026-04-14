/**
 * /v1/keys — API key CRUD (dashboard cookie auth required).
 * /v1/usage — current window usage + recent rows.
 */

import { Hono } from "hono";
import type { Env } from "../env.ts";
import { getSessionUser } from "../auth.ts";
import { roleFor, canCreateKeys } from "../teams.ts";
import { createKey, listKeys, revokeKey } from "../keys.ts";
import { ok, err, parseJson } from "../responses.ts";
import { createKeySchema } from "../schemas.ts";
import { audit } from "../audit.ts";
import { usageSnapshot } from "../quota.ts";
import type { PlanId } from "../../../shared/pricing.ts";

export const keysRouter = new Hono<{ Bindings: Env }>();

// Note: all routes below require `?workspaceId=...` so the caller explicitly
// selects which workspace they're acting on. Avoids accidental cross-workspace
// ops when a user belongs to many.

keysRouter.post("/keys", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) return err(c, "workspaceId query required", 400);
  const role = await roleFor(c.env, workspaceId, user.userId);
  if (!role || !canCreateKeys(role)) return err(c, "forbidden", 403);
  const parsed = await parseJson(c, createKeySchema);
  if (!parsed.ok) return parsed.response;

  const ws = await c.env.DB.prepare(`SELECT plan FROM workspaces WHERE id = ?1`)
    .bind(workspaceId).first<{ plan: PlanId }>();
  if (!ws) return err(c, "workspace not found", 404);

  const created = await createKey(c.env, {
    workspaceId,
    userId: user.userId,
    name: parsed.data.name,
    plan: ws.plan,
  });
  await audit(c.env, {
    workspaceId,
    actorUserId: user.userId,
    action: "key.create",
    targetType: "api_key",
    targetId: created.id,
    meta: { name: parsed.data.name, prefix: created.prefix },
  });
  // IMPORTANT: the raw `secret` is returned ONCE here and never again.
  return ok(c, created, 201);
});

keysRouter.get("/keys", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) return err(c, "workspaceId query required", 400);
  const role = await roleFor(c.env, workspaceId, user.userId);
  if (!role) return err(c, "forbidden", 403);
  const keys = await listKeys(c.env, workspaceId);
  return ok(c, { keys });
});

keysRouter.delete("/keys/:id", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) return err(c, "workspaceId query required", 400);
  const role = await roleFor(c.env, workspaceId, user.userId);
  if (!role || !canCreateKeys(role)) return err(c, "forbidden", 403);
  const ok_ = await revokeKey(c.env, workspaceId, c.req.param("id"));
  if (!ok_) return err(c, "key not found", 404);
  await audit(c.env, {
    workspaceId,
    actorUserId: user.userId,
    action: "key.revoke",
    targetType: "api_key",
    targetId: c.req.param("id"),
  });
  return ok(c, { revoked: true });
});

keysRouter.get("/usage", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return err(c, "unauthenticated", 401);
  const workspaceId = c.req.query("workspaceId");
  if (!workspaceId) return err(c, "workspaceId query required", 400);
  const role = await roleFor(c.env, workspaceId, user.userId);
  if (!role) return err(c, "forbidden", 403);

  const ws = await c.env.DB.prepare(`SELECT plan FROM workspaces WHERE id = ?1`)
    .bind(workspaceId).first<{ plan: PlanId }>();
  if (!ws) return err(c, "workspace not found", 404);

  const snapshot = await usageSnapshot(c.env, workspaceId, ws.plan);
  // Recent rows for the in-dashboard activity feed.
  const recent = await c.env.DB.prepare(
    `SELECT endpoint, units, ts, status, request_id
       FROM usage_rows
      WHERE workspace_id = ?1 AND ts >= ?2
      ORDER BY ts DESC LIMIT 100`,
  ).bind(workspaceId, snapshot.windowStart).all();

  return ok(c, { snapshot, recent: recent.results ?? [] });
});
