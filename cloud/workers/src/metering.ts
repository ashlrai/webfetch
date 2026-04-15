/**
 * Metering — per-request usage bookkeeping.
 *
 * Two-path write so the hot request path stays fast:
 *   1. Synchronously increment the KV quota counter (for quota enforcement on
 *      the NEXT request; current request was already admitted).
 *   2. Enqueue a UsageMessage on the USAGE queue. The queue consumer (see
 *      `src/index.ts::queue`) writes the authoritative row to D1 and, for
 *      paid tiers, pushes a Stripe usage record.
 *
 * Why a queue: D1 inserts from every request serialize through the row-level
 * write path of the region's replica. A queue amortises writes into batches
 * and keeps p95 response times flat.
 */

import { planFor } from "../../shared/pricing.ts";
import type { Env, RequestCtx, UsageMessage } from "./env.ts";
import { ulid } from "./ids.ts";
import { incrementUsage } from "./quota.ts";

export async function recordUsage(
  env: Env,
  ctx: RequestCtx,
  endpoint: string,
  units: number,
  status: number,
): Promise<void> {
  const plan = planFor(ctx.plan);
  const msg: UsageMessage = {
    kind: "usage",
    workspaceId: ctx.workspaceId,
    apiKeyId: ctx.apiKeyId,
    userId: ctx.userId,
    endpoint,
    units,
    ts: Date.now(),
    status,
    requestId: ctx.requestId,
  };
  // Increment KV counter synchronously. Non-fatal on failure.
  try {
    await incrementUsage(env, ctx.workspaceId, plan, units);
  } catch {
    /* quota fail-open */
  }
  try {
    await env.USAGE.send(msg);
  } catch {
    // If the queue is down, fall back to an inline D1 insert so we still bill.
    await persistUsageRow(env, msg);
  }
}

/** Queue-consumer helper: write a usage row to D1. */
export async function persistUsageRow(env: Env, msg: UsageMessage): Promise<void> {
  const id = ulid();
  await env.DB.prepare(
    `INSERT INTO usage_rows
       (id, workspace_id, api_key_id, user_id, endpoint, units, ts, status, request_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
  )
    .bind(
      id,
      msg.workspaceId,
      msg.apiKeyId,
      msg.userId,
      msg.endpoint,
      msg.units,
      msg.ts,
      msg.status,
      msg.requestId,
    )
    .run();
}
