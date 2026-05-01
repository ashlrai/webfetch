/**
 * Shared types between the Cloudflare Worker backend and the Next.js dashboard.
 *
 * IMPORTANT: keep this file dependency-free. The dashboard imports these types
 * at build time; any runtime import would pull Workers-only globals into the
 * Next.js server bundle.
 */

import type { PlanId } from "./pricing.ts";

export type { PlanId } from "./pricing.ts";

/** Stable identity issued by Better Auth. */
export interface User {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
  image: string | null;
  createdAt: number; // epoch ms
  updatedAt: number;
}

/** A workspace is the billing and quota boundary. */
export interface Workspace {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  plan: PlanId;
  /** Stripe IDs, null until first upgrade. */
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** Subscription state machine. */
  subscriptionStatus: SubscriptionStatus;
  /** ms since epoch. Next monthly reset boundary, or next daily reset for free. */
  quotaResetsAt: number;
  createdAt: number;
  updatedAt: number;
}

export type SubscriptionStatus =
  | "none" // free plan, no subscription record
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

export type WorkspaceRole = "owner" | "admin" | "member" | "billing" | "readonly";

export interface Member {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  invitedAt: number;
  acceptedAt: number | null;
}

/** An API key as stored in D1. The raw `wf_live_*` secret is never returned to
 *  the dashboard — only the prefix + id. */
export interface ApiKey {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  /** First 12 chars of `wf_live_xxxx` for UI display. */
  prefix: string;
  /** SHA-256 of the raw secret. Never log / transmit. */
  hash: string;
  name: string;
  revokedAt: number | null;
  lastUsedAt: number | null;
  createdAt: number;
}

/** Usage row recorded per request. The billing queue consumer aggregates these
 *  into Stripe usage records once per hour. */
export interface UsageRow {
  id: string;
  workspaceId: string;
  apiKeyId: string | null;
  userId: string | null;
  endpoint: string;
  units: number;
  /** Epoch ms of the request. */
  ts: number;
  /** HTTP status returned to the caller. */
  status: number;
  /** Opaque request id (ulid) — also appears in response headers for support. */
  requestId: string;
}

export interface AuditEntry {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  /** JSON-encoded, bounded to ~1KB at write time. */
  meta: string | null;
  ts: number;
}

/** Aggregated snapshot used by the dashboard overview cards. */
export interface UsageSummary {
  workspaceId: string;
  plan: PlanId;
  windowStart: number;
  windowEnd: number;
  included: number;
  used: number;
  overage: number;
  rateLimitPerMin: number;
  /** Projected monthly bill in USD cents (base + overage). */
  projectedMonthlyCostCents?: number;
  /** Projected overage charge in USD cents. */
  projectedOverageCents?: number;
}

/** Subscription plan state a dashboard would render. */
export interface BillingSnapshot {
  plan: PlanId;
  status: SubscriptionStatus;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
  stripeCustomerPortalUrl: string | null;
  cancelAtPeriodEnd: boolean;
}
