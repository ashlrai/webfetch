/**
 * Audit log — security/billing-relevant events. Appended-only; the dashboard
 * renders filtered views. Retention policy is a follow-up (see README).
 */

import type { Env } from "./env.ts";
import { ulid } from "./ids.ts";

export interface AuditInput {
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown> | null;
}

/** Write an audit row. Never throws — audit failures must not block the
 *  originating action. */
export async function audit(env: Env, input: AuditInput): Promise<void> {
  try {
    const metaStr = input.meta ? JSON.stringify(input.meta).slice(0, 1024) : null;
    await env.DB.prepare(
      `INSERT INTO audit_log
         (id, workspace_id, actor_user_id, action, target_type, target_id, meta, ts)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    ).bind(
      ulid(),
      input.workspaceId,
      input.actorUserId,
      input.action,
      input.targetType ?? null,
      input.targetId ?? null,
      metaStr,
      Date.now(),
    ).run();
  } catch {
    /* swallow */
  }
}

export async function listAudit(env: Env, workspaceId: string, limit = 100) {
  const res = await env.DB.prepare(
    `SELECT id, actor_user_id, action, target_type, target_id, meta, ts
       FROM audit_log
      WHERE workspace_id = ?1
      ORDER BY ts DESC
      LIMIT ?2`,
  ).bind(workspaceId, Math.min(1000, Math.max(1, limit))).all();
  return res.results ?? [];
}
