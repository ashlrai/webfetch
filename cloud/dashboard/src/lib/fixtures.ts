/**
 * Deterministic fixture data used when `NEXT_PUBLIC_USE_FIXTURES=1`. Lets the
 * dashboard render end-to-end during development before api.getwebfetch.com
 * exists.
 */

import type {
  ApiKey,
  AuditEntry,
  BillingSnapshot,
  Member,
  UsageRow,
  UsageSummary,
  User,
  Workspace,
} from "@shared/types";

const DAY = 86_400_000;
const NOW = 1_760_000_000_000; // stable pseudo-"now" for deterministic builds

export const fixtureUser: User = {
  id: "usr_01H9ZXMEQG",
  email: "mason@ashlr.ai",
  name: "Mason Wyatt",
  emailVerified: true,
  image: null,
  createdAt: NOW - 60 * DAY,
  updatedAt: NOW - DAY,
};

export const fixtureWorkspace: Workspace = {
  id: "ws_01H9ZXN0AA",
  slug: "ashlr",
  name: "Ashlr",
  ownerId: fixtureUser.id,
  plan: "pro",
  stripeCustomerId: "cus_Test",
  stripeSubscriptionId: "sub_Test",
  subscriptionStatus: "active",
  quotaResetsAt: NOW + 7 * DAY,
  createdAt: NOW - 60 * DAY,
  updatedAt: NOW - DAY,
};

export const fixtureWorkspaces: Workspace[] = [
  fixtureWorkspace,
  {
    ...fixtureWorkspace,
    id: "ws_01H9ZXN0BB",
    slug: "personal",
    name: "Personal",
    plan: "free",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: "none",
  },
];

export const fixtureKeys: ApiKey[] = [
  {
    id: "key_01",
    workspaceId: fixtureWorkspace.id,
    createdByUserId: fixtureUser.id,
    prefix: "wf_live_8Kq",
    hash: "",
    name: "Production",
    revokedAt: null,
    lastUsedAt: NOW - 60_000,
    createdAt: NOW - 30 * DAY,
  },
  {
    id: "key_02",
    workspaceId: fixtureWorkspace.id,
    createdByUserId: fixtureUser.id,
    prefix: "wf_live_2Fa",
    hash: "",
    name: "Local dev",
    revokedAt: null,
    lastUsedAt: NOW - 3 * DAY,
    createdAt: NOW - 14 * DAY,
  },
  {
    id: "key_03",
    workspaceId: fixtureWorkspace.id,
    createdByUserId: fixtureUser.id,
    prefix: "wf_live_xZ7",
    hash: "",
    name: "Old CI key",
    revokedAt: NOW - 7 * DAY,
    lastUsedAt: NOW - 10 * DAY,
    createdAt: NOW - 45 * DAY,
  },
];

export const fixtureMembers: (Member & { user: User; role: Member["role"] })[] = [
  {
    workspaceId: fixtureWorkspace.id,
    userId: fixtureUser.id,
    role: "owner",
    invitedAt: NOW - 60 * DAY,
    acceptedAt: NOW - 60 * DAY,
    user: fixtureUser,
  },
  {
    workspaceId: fixtureWorkspace.id,
    userId: "usr_02",
    role: "admin",
    invitedAt: NOW - 20 * DAY,
    acceptedAt: NOW - 20 * DAY,
    user: {
      id: "usr_02",
      email: "producer@ashlr.ai",
      name: "Jess R.",
      emailVerified: true,
      image: null,
      createdAt: NOW - 20 * DAY,
      updatedAt: NOW - DAY,
    },
  },
  {
    workspaceId: fixtureWorkspace.id,
    userId: "usr_03",
    role: "member",
    invitedAt: NOW - 3 * DAY,
    acceptedAt: null,
    user: {
      id: "usr_03",
      email: "editor@ashlr.ai",
      name: null,
      emailVerified: false,
      image: null,
      createdAt: NOW - 3 * DAY,
      updatedAt: NOW - 3 * DAY,
    },
  },
];

export const fixtureUsageSummary: UsageSummary = {
  workspaceId: fixtureWorkspace.id,
  plan: "pro",
  windowStart: NOW - 23 * DAY,
  windowEnd: NOW + 7 * DAY,
  included: 10_000,
  used: 6_482,
  overage: 0,
  rateLimitPerMin: 100,
};

export const fixtureBilling: BillingSnapshot = {
  plan: "pro",
  status: "active",
  currentPeriodStart: NOW - 23 * DAY,
  currentPeriodEnd: NOW + 7 * DAY,
  stripeCustomerPortalUrl: "https://billing.stripe.com/p/session/test_xxx",
  cancelAtPeriodEnd: false,
};

/** 30 days of synthetic daily totals; smooth curve with small weekly dip. */
export function fixtureDailySeries(days = 30): { day: number; fetches: number; costUsd: number }[] {
  const out: { day: number; fetches: number; costUsd: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = NOW - i * DAY;
    const base = 180 + Math.round(60 * Math.sin(i / 3.2)) + (i % 7 === 0 ? -40 : 0);
    const fetches = Math.max(0, base + ((i * 13) % 40));
    out.push({ day, fetches, costUsd: fetches * 0.012 });
  }
  return out;
}

export const fixturePerEndpoint: { endpoint: string; fetches: number }[] = [
  { endpoint: "/v1/search", fetches: 3_812 },
  { endpoint: "/v1/download", fetches: 1_944 },
  { endpoint: "/v1/artist", fetches: 402 },
  { endpoint: "/v1/probe", fetches: 221 },
  { endpoint: "/v1/license", fetches: 103 },
];

export const fixturePerProvider: { provider: string; fetches: number }[] = [
  { provider: "unsplash", fetches: 1_802 },
  { provider: "serpapi", fetches: 1_411 },
  { provider: "brave", fetches: 988 },
  { provider: "pexels", fetches: 742 },
  { provider: "brightdata", fetches: 611 },
  { provider: "wikimedia", fetches: 540 },
  { provider: "pixabay", fetches: 388 },
];

export const PROVIDERS = [
  "unsplash",
  "pexels",
  "pixabay",
  "serpapi",
  "brave",
  "bing",
  "google-cse",
  "wikimedia",
  "openverse",
  "flickr",
  "giphy",
  "tenor",
  "smithsonian",
  "metmuseum",
  "europeana",
  "nasa",
  "brightdata",
  "serper",
  "duckduckgo",
] as const;

export type ProviderStatus = {
  name: string;
  mode: "pool" | "byok" | "missing";
  hasKey: boolean;
  lastTestOk: boolean | null;
  lastTestAt: number | null;
  docsUrl: string;
};

export const fixtureProviders: ProviderStatus[] = PROVIDERS.map((name, i) => ({
  name,
  mode: i % 4 === 0 ? "byok" : i % 4 === 1 ? "pool" : i % 4 === 2 ? "pool" : "missing",
  hasKey: i % 4 === 0,
  lastTestOk: i % 4 === 0 ? true : null,
  lastTestAt: i % 4 === 0 ? NOW - i * 60_000 : null,
  docsUrl: `https://getwebfetch.com/docs/providers/${name}`,
}));

export function fixtureAudit(count = 60): AuditEntry[] {
  const actions = ["key.create", "key.revoke", "member.invite", "plan.upgrade", "provider.update"];
  const out: AuditEntry[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      id: `aud_${String(i).padStart(4, "0")}`,
      workspaceId: fixtureWorkspace.id,
      actorUserId: fixtureUser.id,
      action: actions[i % actions.length],
      targetType: "api_key",
      targetId: `key_${(i % 3) + 1}`,
      meta: null,
      ts: NOW - i * 3600_000,
    });
  }
  return out;
}

export function fixtureUsageRows(count = 50): UsageRow[] {
  const endpoints = ["/v1/search", "/v1/download", "/v1/probe", "/v1/artist"];
  const out: UsageRow[] = [];
  for (let i = 0; i < count; i++) {
    const status = i % 13 === 0 ? 402 : i % 17 === 0 ? 429 : 200;
    out.push({
      id: `usg_${String(i).padStart(5, "0")}`,
      workspaceId: fixtureWorkspace.id,
      apiKeyId: "key_01",
      userId: fixtureUser.id,
      endpoint: endpoints[i % endpoints.length],
      units: 1,
      ts: NOW - i * 55_000,
      status,
      requestId: `req_${i.toString(36)}`,
    });
  }
  return out;
}
