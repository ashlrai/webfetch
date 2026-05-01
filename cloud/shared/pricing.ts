/**
 * Pricing ladder — single source of truth for plan configuration.
 *
 * Consumed by:
 *   - cloud/workers/src/quota.ts   (enforces limits)
 *   - cloud/workers/src/billing.ts (builds Stripe Checkout sessions)
 *   - cloud/dashboard/*            (renders pricing cards, usage meters)
 *
 * Keep in sync with the marketing /pricing page copy.
 */

export type PlanId = "free" | "pro" | "team" | "enterprise";

export interface PlanConfig {
  id: PlanId;
  /** Human label used in the dashboard + pricing page. */
  label: string;
  /** Flat monthly USD base. 0 for free, -1 for "contact us" enterprise. */
  baseMonthlyUsd: number;
  /** Included fetches per billing period. */
  includedFetches: number;
  /** Billing window — free tier resets daily, paid resets monthly. */
  window: "daily" | "monthly";
  /** Overage price-per-fetch (USD). -1 means not metered (enterprise fair-use). */
  overageUsd: number;
  /** Per-API-key token-bucket cap, requests per minute. */
  rateLimitPerMin: number;
  /** Included seat count for workspaces. */
  seats: number;
  /** Additional seat cost (monthly USD). 0 if non-seated plan. */
  extraSeatUsd: number;
  /** Endpoint groups enabled. Free tier does NOT get browser fallback. */
  allowedEndpoints: ReadonlyArray<string>;
}

const ALL_ENDPOINTS = [
  "/v1/search",
  "/v1/artist",
  "/v1/album",
  "/v1/download",
  "/v1/probe",
  "/v1/license",
  "/v1/similar",
] as const;

const FREE_ENDPOINTS = [
  "/v1/search",
  "/v1/artist",
  "/v1/album",
  "/v1/download",
  "/v1/probe",
  "/v1/license",
] as const;

export const PLANS: Record<PlanId, PlanConfig> = {
  free: {
    id: "free",
    label: "Free",
    baseMonthlyUsd: 0,
    includedFetches: 100,
    window: "daily",
    overageUsd: -1, // hard cap, no overage
    rateLimitPerMin: 10,
    seats: 1,
    extraSeatUsd: 0,
    allowedEndpoints: FREE_ENDPOINTS,
  },
  pro: {
    id: "pro",
    label: "Pro",
    baseMonthlyUsd: 19,
    includedFetches: 10_000,
    window: "monthly",
    overageUsd: 0.015,
    rateLimitPerMin: 100,
    seats: 1,
    extraSeatUsd: 0,
    allowedEndpoints: ALL_ENDPOINTS,
  },
  team: {
    id: "team",
    label: "Team",
    baseMonthlyUsd: 79,
    includedFetches: 50_000,
    window: "monthly",
    overageUsd: 0.01,
    rateLimitPerMin: 300,
    seats: 5,
    extraSeatUsd: 12,
    allowedEndpoints: ALL_ENDPOINTS,
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    baseMonthlyUsd: -1,
    includedFetches: 1_000_000,
    window: "monthly",
    overageUsd: -1,
    rateLimitPerMin: 1000,
    seats: 100,
    extraSeatUsd: 0,
    allowedEndpoints: ALL_ENDPOINTS,
  },
};

export function planFor(id: string | null | undefined): PlanConfig {
  if (!id) return PLANS.free;
  const p = PLANS[id as PlanId];
  return p ?? PLANS.free;
}

/**
 * Endpoints that cost multiple units (e.g. download pulls bytes through R2).
 * Returns `1` for unknown endpoints — the metering middleware assumes 1 unit
 * by default.
 */
export function unitsFor(endpoint: string): number {
  switch (endpoint) {
    case "/v1/download":
      return 2;
    case "/v1/similar":
      return 3;
    default:
      return 1;
  }
}

export interface ProjectedCost {
  /** Plan base price in cents (0 for free, 0 for enterprise — "contact us"). */
  baseCents: number;
  /** Overage units beyond the included quota. */
  overageUnits: number;
  /** Overage charge in cents. 0 for free (hard cap) and enterprise (fair-use). */
  overageCents: number;
  /** Total projected charge in cents (base + overage). */
  totalCents: number;
}

/**
 * Project the monthly bill for a workspace, given the units consumed in the
 * current cycle. Used by the dashboard to surface a "you're on track to bill
 * $X.YY" warning so paid users aren't surprised by overage.
 *
 * Rounding: overage cents round half-up to the nearest whole cent — Stripe
 * meters bill the same way.
 */
export function projectMonthlyCost(plan: PlanId, unitsUsed: number): ProjectedCost {
  const cfg = planFor(plan);
  // Free hard-caps at quota — there is no overage to project.
  // Enterprise is fair-use — handled via contract, not projected here.
  if (cfg.window !== "monthly" || cfg.overageUsd < 0 || cfg.baseMonthlyUsd < 0) {
    return {
      baseCents: cfg.baseMonthlyUsd > 0 ? Math.round(cfg.baseMonthlyUsd * 100) : 0,
      overageUnits: 0,
      overageCents: 0,
      totalCents: cfg.baseMonthlyUsd > 0 ? Math.round(cfg.baseMonthlyUsd * 100) : 0,
    };
  }
  const baseCents = Math.round(cfg.baseMonthlyUsd * 100);
  const overageUnits = Math.max(0, unitsUsed - cfg.includedFetches);
  const overageCents = Math.round(overageUnits * cfg.overageUsd * 100);
  return {
    baseCents,
    overageUnits,
    overageCents,
    totalCents: baseCents + overageCents,
  };
}

/** Format cents as a USD currency string (e.g. 1995 → "$19.95"). */
export function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const remainder = Math.abs(cents % 100);
  return `$${dollars.toLocaleString("en-US")}.${remainder.toString().padStart(2, "0")}`;
}
