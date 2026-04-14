/**
 * Audit log retention cron.
 *
 * Runs daily at 03:00 UTC (see wrangler.toml `[triggers] crons`).
 *
 * For each workspace:
 *   1. Resolve retention window:
 *        - free        =  90d
 *        - pro         = 180d
 *        - team        = 365d
 *        - enterprise  = `workspaces.audit_retention_days` (default 365)
 *   2. Stream pre-cutoff `audit_log` rows to R2 as NDJSON at
 *      `audit-archive/<yyyy-mm-dd>/<workspaceId>.ndjson`.
 *   3. Delete archived rows from D1.
 *
 * The archive object key uses the *cutoff* date so re-runs are idempotent —
 * a second invocation in the same UTC day overwrites the same key with the
 * same set of rows (or appends if more rows have aged out, since we take a
 * fresh snapshot each run).
 */

import type { Env } from "../env.ts";
import type { PlanId } from "../../../shared/pricing.ts";

export const RETENTION_BY_PLAN: Record<PlanId, number> = {
  free: 90,
  pro: 180,
  team: 365,
  enterprise: 365,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RetentionResult {
  workspaceId: string;
  archived: number;
  deleted: number;
  cutoff: number;
  archiveKey: string | null;
}

/** Resolve retention days for a workspace. */
export function retentionDaysFor(plan: PlanId, override: number | null | undefined): number {
  if (plan === "enterprise" && override && override > 0) return override;
  if (override && override > 0 && plan !== "enterprise") {
    // Non-enterprise workspaces ignore overrides — keep plan default.
    return RETENTION_BY_PLAN[plan];
  }
  return RETENTION_BY_PLAN[plan] ?? RETENTION_BY_PLAN.team;
}

interface WorkspaceRow {
  id: string;
  plan: PlanId;
  audit_retention_days: number | null;
}

interface AuditRow {
  id: string;
  workspace_id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  meta: string | null;
  ts: number;
}

/**
 * Run retention for every workspace. Exported for unit tests and for the
 * Cloudflare cron entry in `index.ts::scheduled`.
 */
export async function runAuditRetention(env: Env, now: number = Date.now()): Promise<RetentionResult[]> {
  const wsRes = await env.DB.prepare(
    `SELECT id, plan, audit_retention_days FROM workspaces`,
  ).all<WorkspaceRow>();
  const workspaces = wsRes.results ?? [];

  const out: RetentionResult[] = [];
  const dateStr = isoDate(now);

  for (const ws of workspaces) {
    const days = retentionDaysFor(ws.plan, ws.audit_retention_days);
    const cutoff = now - days * MS_PER_DAY;

    const rowsRes = await env.DB.prepare(
      `SELECT id, workspace_id, actor_user_id, action, target_type, target_id, meta, ts
         FROM audit_log
        WHERE workspace_id = ?1 AND ts < ?2
        ORDER BY ts ASC`,
    ).bind(ws.id, cutoff).all<AuditRow>();
    const rows = rowsRes.results ?? [];
    if (rows.length === 0) {
      out.push({ workspaceId: ws.id, archived: 0, deleted: 0, cutoff, archiveKey: null });
      continue;
    }

    const archiveKey = `audit-archive/${dateStr}/${ws.id}.ndjson`;
    const ndjson = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await env.CACHE.put(archiveKey, new TextEncoder().encode(ndjson));

    await env.DB.prepare(
      `DELETE FROM audit_log WHERE workspace_id = ?1 AND ts < ?2`,
    ).bind(ws.id, cutoff).run();

    out.push({ workspaceId: ws.id, archived: rows.length, deleted: rows.length, cutoff, archiveKey });
  }
  return out;
}

function isoDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
