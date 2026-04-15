/**
 * Per-workspace quota accounting.
 *
 * Free tier: 100 fetches/day, KV counter keyed by `quota:<workspaceId>:<yyyy-mm-dd>`
 * with a TTL of ~36h so it auto-cleans.
 *
 * Paid tier: monthly included quota + overage billed through Stripe. The KV
 * counter tracks usage inside the current billing period (`quota:<ws>:<period-start>`).
 * Overage is *not* rejected — instead we accumulate `overage` units and the
 * billing queue flushes them to a Stripe usage record on an interval.
 *
 * Free tier hard-rejects with HTTP 402 + Link header to the upgrade page.
 */

import type { Env } from "./env.ts";
import { planFor, PLANS, type PlanConfig, type PlanId } from "../../shared/pricing.ts";

export interface QuotaDecision {
  allow: boolean;
  plan: PlanId;
  used: number;
  included: number;
  overage: number;
  windowStart: number;
  windowEnd: number;
  /** When `allow === false`, a short human reason the middleware can surface. */
  reason?: "quota_exceeded_free" | "plan_endpoint_forbidden";
  /** Upgrade URL for the Link header on 402. */
  upgradeUrl?: string;
}

/** UTC midnight boundary for daily windows. Returns `{start,end}` ms epoch. */
export function dailyWindow(now = Date.now()): { start: number; end: number } {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

/** Monthly window anchored at UTC-1st. */
export function monthlyWindow(now = Date.now()): { start: number; end: number } {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { start, end };
}

function counterKey(workspaceId: string, plan: PlanConfig, now: number): string {
  const w = plan.window === "daily" ? dailyWindow(now) : monthlyWindow(now);
  return `quota:${workspaceId}:${w.start}`;
}

/**
 * Read the current window's counter. Returns `0` on miss. Never blocks on KV
 * errors — treats errors as `used=0` so we fail-open on infrastructure blips
 * (legitimate traffic keeps flowing; billing is still authoritative via D1).
 */
export async function readUsage(env: Env, workspaceId: string, plan: PlanConfig, now = Date.now()): Promise<number> {
  const raw = await env.QUOTA.get(counterKey(workspaceId, plan, now));
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Increment the counter by `units`. Returns the new total. Uses get+put; KV
 * is eventually consistent but errors favor undercounting, which is fine for
 * a rate-style guard (Stripe usage records are the billing truth).
 */
export async function incrementUsage(
  env: Env,
  workspaceId: string,
  plan: PlanConfig,
  units: number,
  now = Date.now(),
): Promise<number> {
  const key = counterKey(workspaceId, plan, now);
  const raw = await env.QUOTA.get(key);
  const current = raw ? Number(raw) : 0;
  const next = current + units;
  const windowEnd = plan.window === "daily" ? dailyWindow(now).end : monthlyWindow(now).end;
  // TTL: live until the window closes + 1 hour buffer.
  const ttlSeconds = Math.max(60, Math.ceil((windowEnd - now) / 1000) + 3600);
  await env.QUOTA.put(key, String(next), { expirationTtl: ttlSeconds });
  return next;
}

/**
 * Decide if a request is allowed given the workspace plan + projected units.
 * This does NOT mutate counters — call `incrementUsage` after the request
 * succeeds to avoid double-counting aborts.
 */
export async function checkQuota(
  env: Env,
  workspaceId: string,
  planId: PlanId,
  endpoint: string,
  units: number,
  now = Date.now(),
): Promise<QuotaDecision> {
  const plan = planFor(planId);
  const { start, end } = plan.window === "daily" ? dailyWindow(now) : monthlyWindow(now);

  if (!plan.allowedEndpoints.includes(endpoint)) {
    return {
      allow: false,
      plan: plan.id,
      used: 0,
      included: plan.includedFetches,
      overage: 0,
      windowStart: start,
      windowEnd: end,
      reason: "plan_endpoint_forbidden",
      upgradeUrl: "https://getwebfetch.com/pricing",
    };
  }

  const used = await readUsage(env, workspaceId, plan);
  const projected = used + units;

  // Free tier: hard cap.
  if (plan.id === "free" && projected > plan.includedFetches) {
    return {
      allow: false,
      plan: plan.id,
      used,
      included: plan.includedFetches,
      overage: 0,
      windowStart: start,
      windowEnd: end,
      reason: "quota_exceeded_free",
      upgradeUrl: "https://getwebfetch.com/pricing",
    };
  }

  const overage = Math.max(0, projected - plan.includedFetches);
  return {
    allow: true,
    plan: plan.id,
    used,
    included: plan.includedFetches,
    overage,
    windowStart: start,
    windowEnd: end,
  };
}

/** Diagnostic summary used by `/v1/usage`. */
export async function usageSnapshot(env: Env, workspaceId: string, planId: PlanId, now = Date.now()) {
  const plan = planFor(planId);
  const { start, end } = plan.window === "daily" ? dailyWindow(now) : monthlyWindow(now);
  const used = await readUsage(env, workspaceId, plan, now);
  return {
    workspaceId,
    plan: plan.id,
    windowStart: start,
    windowEnd: end,
    included: plan.includedFetches,
    used,
    overage: Math.max(0, used - plan.includedFetches),
    rateLimitPerMin: plan.rateLimitPerMin,
  };
}

export { PLANS };
