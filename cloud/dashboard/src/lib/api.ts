/**
 * Typed client for the webfetch cloud API.
 *
 * Real requests go through the same-origin `/api/proxy/*` Next route so the
 * browser never sees raw cross-origin calls — the proxy adds session auth,
 * rate-limit headers, and workspace context.
 *
 * When `USE_FIXTURES` is on we short-circuit to the deterministic fixtures so
 * the dashboard renders end-to-end even before api.webfetch.dev exists.
 */

import type {
  ApiKey,
  AuditEntry,
  BillingSnapshot,
  UsageRow,
  UsageSummary,
  User,
  Workspace,
} from "@shared/types";
import { USE_FIXTURES } from "@/env";
import {
  fixtureAudit,
  fixtureBilling,
  fixtureDailySeries,
  fixtureKeys,
  fixtureMembers,
  fixturePerEndpoint,
  fixturePerProvider,
  fixtureProviders,
  fixtureUsageRows,
  fixtureUsageSummary,
  fixtureUser,
  fixtureWorkspace,
  fixtureWorkspaces,
  type ProviderStatus,
} from "@/lib/fixtures";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public hint?: string,
  ) {
    super(message);
  }
}

/**
 * UX hint for 401/402/429 responses. The dashboard uses this to route the
 * user to the right remediation page (login / upgrade / wait).
 */
export function hintForStatus(status: number): string | null {
  if (status === 401) return "Your session expired. Sign in again to continue.";
  if (status === 402) return "You've hit your plan quota. Upgrade to keep fetching.";
  if (status === 429) return "Rate limited. Slow down or upgrade for higher limits.";
  return null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/proxy${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || res.statusText, hintForStatus(res.status) ?? undefined);
  }
  return (await res.json()) as T;
}

export interface DashboardOverview {
  user: User;
  workspace: Workspace;
  workspaces: Workspace[];
  usage: UsageSummary;
  billing: BillingSnapshot;
  dailySeries: { day: number; fetches: number; costUsd: number }[];
  perEndpoint: { endpoint: string; fetches: number }[];
  perProvider: { provider: string; fetches: number }[];
}

export async function getOverview(): Promise<DashboardOverview> {
  if (USE_FIXTURES) {
    return {
      user: fixtureUser,
      workspace: fixtureWorkspace,
      workspaces: fixtureWorkspaces,
      usage: fixtureUsageSummary,
      billing: fixtureBilling,
      dailySeries: fixtureDailySeries(),
      perEndpoint: fixturePerEndpoint,
      perProvider: fixturePerProvider,
    };
  }
  return request<DashboardOverview>("/v1/dashboard/overview");
}

export async function listKeys(): Promise<ApiKey[]> {
  if (USE_FIXTURES) return fixtureKeys;
  return request<ApiKey[]>("/v1/keys");
}

export async function createKey(
  name: string,
  scope: string,
): Promise<{ key: ApiKey; raw: string }> {
  if (USE_FIXTURES) {
    const key: ApiKey = {
      id: `key_${Math.random().toString(36).slice(2, 10)}`,
      workspaceId: fixtureWorkspace.id,
      createdByUserId: fixtureUser.id,
      prefix: `wf_live_${Math.random().toString(36).slice(2, 5)}`,
      hash: "",
      name,
      revokedAt: null,
      lastUsedAt: null,
      createdAt: Date.now(),
    };
    const raw = `${key.prefix}${Math.random().toString(36).slice(2, 32)}`;
    return { key, raw };
  }
  return request("/v1/keys", {
    method: "POST",
    body: JSON.stringify({ name, scope }),
  });
}

export async function revokeKey(id: string): Promise<void> {
  if (USE_FIXTURES) return;
  await request(`/v1/keys/${id}`, { method: "DELETE" });
}

export async function listMembers() {
  if (USE_FIXTURES) return fixtureMembers;
  return request<typeof fixtureMembers>("/v1/team/members");
}

export async function inviteMember(email: string, role: string): Promise<void> {
  if (USE_FIXTURES) return;
  await request("/v1/team/invite", {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
}

export async function removeMember(userId: string): Promise<void> {
  if (USE_FIXTURES) return;
  await request(`/v1/team/members/${userId}`, { method: "DELETE" });
}

export async function getBilling(): Promise<BillingSnapshot> {
  if (USE_FIXTURES) return fixtureBilling;
  return request<BillingSnapshot>("/v1/billing/snapshot");
}

export async function getUsageRows(limit = 100): Promise<UsageRow[]> {
  if (USE_FIXTURES) return fixtureUsageRows(limit);
  return request<UsageRow[]>(`/v1/usage/rows?limit=${limit}`);
}

export async function getAudit(limit = 100): Promise<AuditEntry[]> {
  if (USE_FIXTURES) return fixtureAudit(limit);
  return request<AuditEntry[]>(`/v1/audit?limit=${limit}`);
}

export async function getProviders(): Promise<ProviderStatus[]> {
  if (USE_FIXTURES) return fixtureProviders;
  return request<ProviderStatus[]>("/v1/providers");
}

export async function saveProviderKey(name: string, apiKey: string): Promise<void> {
  if (USE_FIXTURES) return;
  await request(`/v1/providers/${name}`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export async function testProvider(name: string): Promise<{ ok: boolean; message: string }> {
  if (USE_FIXTURES) return { ok: true, message: "Fixture — key works." };
  return request(`/v1/providers/${name}/test`, { method: "POST" });
}
