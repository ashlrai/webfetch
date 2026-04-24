/**
 * Typed client for the webfetch cloud API.
 *
 * Real requests go through the same-origin `/api/proxy/*` Next route so the
 * browser never sees raw cross-origin calls — the proxy adds session auth,
 * rate-limit headers, and workspace context.
 *
 * When fixture mode is on we short-circuit to deterministic fixtures so the
 * dashboard renders end-to-end during local development.
 */

import { isFixtureMode } from "@/env";
import {
  type ProviderStatus,
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
} from "@/lib/fixtures";
import type {
  ApiKey,
  AuditEntry,
  BillingSnapshot,
  UsageRow,
  UsageSummary,
  User,
  Workspace,
} from "@shared/types";

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

/**
 * Base URL for API calls. In the browser we always go through the same-origin
 * `/api/proxy/*` Next route (cookies attach automatically). During SSR we
 * cannot hit the same-origin proxy (no request context from a server component
 * context here), so we hit the upstream API directly and forward the caller's
 * cookie via `next/headers`.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isServer = typeof window === "undefined";
  let url: string;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(Object.fromEntries(new Headers(init.headers).entries()) as Record<string, string>),
  };

  if (isServer) {
    const { API_URL } = await import("@/env");
    url = `${API_URL}${path}`;
    try {
      const { headers: nextHeaders } = await import("next/headers");
      const h = await nextHeaders();
      const cookie = h.get("cookie");
      if (cookie) headers.cookie = cookie;
    } catch {
      /* not in a request scope — best-effort */
    }
    headers["x-webfetch-origin"] = "dashboard-ssr";
  } else {
    url = `/api/proxy${path}`;
  }

  const res = await fetch(url, {
    ...init,
    headers,
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

function fixtureOverview(): DashboardOverview {
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

export async function getOverview(): Promise<DashboardOverview> {
  if (isFixtureMode()) return fixtureOverview();
  return request<DashboardOverview>("/v1/dashboard/overview");
}

export async function listKeys(): Promise<ApiKey[]> {
  if (isFixtureMode()) return fixtureKeys;
  return request<ApiKey[]>("/v1/keys");
}

export async function createKey(
  name: string,
  scope: string,
): Promise<{ key: ApiKey; raw: string }> {
  if (isFixtureMode()) {
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
  if (isFixtureMode()) return;
  await request(`/v1/keys/${id}`, { method: "DELETE" });
}

export async function listMembers() {
  if (isFixtureMode()) return fixtureMembers;
  // Worker exposes `/v1/workspaces/:id/members`. We pass a synthetic "current"
  // segment — the worker resolves "current" to the session user's workspace.
  return request<typeof fixtureMembers>("/v1/workspaces/current/members");
}

export async function inviteMember(email: string, role: string): Promise<void> {
  if (isFixtureMode()) return;
  await request("/v1/workspaces/current/invite", {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
}

export async function removeMember(userId: string): Promise<void> {
  if (isFixtureMode()) return;
  await request(`/v1/workspaces/current/members/${userId}`, { method: "DELETE" });
}

export async function getBilling(): Promise<BillingSnapshot> {
  if (isFixtureMode()) return fixtureBilling;
  return request<BillingSnapshot>("/v1/billing/snapshot");
}

export async function getUsageRows(limit = 100): Promise<UsageRow[]> {
  if (isFixtureMode()) return fixtureUsageRows(limit);
  return request<UsageRow[]>(`/v1/usage?limit=${limit}`);
}

export async function getAudit(limit = 100): Promise<AuditEntry[]> {
  if (isFixtureMode()) return fixtureAudit(limit);
  return request<AuditEntry[]>(`/v1/audit?limit=${limit}`);
}

export async function getProviders(): Promise<ProviderStatus[]> {
  if (isFixtureMode()) return fixtureProviders;
  return request<ProviderStatus[]>("/providers");
}

export async function saveProviderKey(name: string, apiKey: string): Promise<void> {
  if (isFixtureMode()) return;
  await request(`/v1/keys/providers/${name}`, {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
}

export async function testProvider(name: string): Promise<{ ok: boolean; message: string }> {
  if (isFixtureMode()) return { ok: true, message: "Fixture - key works." };
  return request(`/v1/keys/providers/${name}/test`, { method: "POST" });
}
