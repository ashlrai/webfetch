/**
 * Typed client for the webfetch cloud API.
 *
 * Real requests go through the same-origin `/api/proxy/*` Next route so the
 * browser never sees raw cross-origin calls — the proxy adds session auth,
 * rate-limit headers, and workspace context.
 *
 * When `USE_FIXTURES` is on we short-circuit to the deterministic fixtures so
 * the dashboard renders end-to-end even before api.getwebfetch.com exists.
 */

import { USE_FIXTURES } from "@/env";
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

/**
 * Wrap a live-API call so a transient backend failure falls back to a
 * deterministic fixture instead of crashing the render. We log the error so
 * prod observability can surface it, but return a usable shape to the UI.
 */
async function liveOrFallback<T>(path: string, fallback: () => T | Promise<T>): Promise<T> {
  try {
    return await request<T>(path);
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn(`[webfetch] live API ${path} failed — falling back to fixture`, err);
    }
    return fallback();
  }
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
  if (USE_FIXTURES) return fixtureOverview();
  return liveOrFallback<DashboardOverview>("/v1/dashboard/overview", fixtureOverview);
}

export async function listKeys(): Promise<ApiKey[]> {
  if (USE_FIXTURES) return fixtureKeys;
  // Worker returns `{ ok, data: [...] }` style in some routes — we're tolerant.
  return liveOrFallback<ApiKey[]>("/v1/keys", () => []);
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
  // Worker exposes `/v1/workspaces/:id/members`. We pass a synthetic "current"
  // segment — the worker resolves "current" to the session user's workspace.
  // Fallback to an empty list so the page still renders for first-run users.
  return liveOrFallback<typeof fixtureMembers>(
    "/v1/workspaces/current/members",
    () => [] as typeof fixtureMembers,
  );
}

export async function inviteMember(email: string, role: string): Promise<void> {
  if (USE_FIXTURES) return;
  await request("/v1/workspaces/current/invite", {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });
}

export async function removeMember(userId: string): Promise<void> {
  if (USE_FIXTURES) return;
  await request(`/v1/workspaces/current/members/${userId}`, { method: "DELETE" });
}

export async function getBilling(): Promise<BillingSnapshot> {
  if (USE_FIXTURES) return fixtureBilling;
  return liveOrFallback<BillingSnapshot>("/v1/billing/snapshot", () => fixtureBilling);
}

export async function getUsageRows(limit = 100): Promise<UsageRow[]> {
  if (USE_FIXTURES) return fixtureUsageRows(limit);
  return liveOrFallback<UsageRow[]>(`/v1/usage?limit=${limit}`, () => []);
}

export async function getAudit(limit = 100): Promise<AuditEntry[]> {
  if (USE_FIXTURES) return fixtureAudit(limit);
  return liveOrFallback<AuditEntry[]>(`/v1/audit?limit=${limit}`, () => []);
}

export async function getProviders(): Promise<ProviderStatus[]> {
  if (USE_FIXTURES) return fixtureProviders;
  return liveOrFallback<ProviderStatus[]>("/providers", () => fixtureProviders);
}

export async function saveProviderKey(name: string, apiKey: string): Promise<void> {
  if (USE_FIXTURES) return;
  await request(`/v1/keys/providers/${name}`, {
    method: "POST",
    body: JSON.stringify({ apiKey }),
  });
}

export async function testProvider(name: string): Promise<{ ok: boolean; message: string }> {
  if (USE_FIXTURES) return { ok: true, message: "Fixture — key works." };
  return request(`/v1/keys/providers/${name}/test`, { method: "POST" });
}
