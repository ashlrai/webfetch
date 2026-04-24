/**
 * Lightweight in-memory stand-ins for D1 / KV / R2 / Queue / ExecutionContext
 * so the Hono app can be unit-tested without Miniflare's full VM overhead.
 *
 * These mocks model only the surface we actually use — any additions in the
 * source code that touch new APIs will make tests fail explicitly rather than
 * silently pass.
 */

import { Database } from "bun:sqlite";
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  DurableObjectNamespace,
  KVNamespace,
  Queue,
  R2Bucket,
} from "@cloudflare/workers-types";
import type { Env, UsageMessage } from "../src/env.ts";

// ---------------------------------------------------------------------------
// D1 mock — bun:sqlite wrapped to match the D1 prepared-statement interface.
// ---------------------------------------------------------------------------

export function makeD1(): D1Database {
  const db = new Database(":memory:");
  // Apply the real migration SQL so tests exercise the actual schema.
  // Read synchronously via Bun's file API.
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const root = path.resolve(__dirname, "../../schema");
  const files = [
    "0001_init.sql",
    "0002_indexes.sql",
    "0003_audit_retention.sql",
    "0004_better_auth_alignment.sql",
    "0005_webhook_events.sql",
  ];
  for (const f of files) {
    const sql = fs.readFileSync(path.join(root, f), "utf8");
    db.exec(sql);
  }

  const bound = (sql: string, args: unknown[] = []): D1PreparedStatement => {
    // D1 supports numbered placeholders (?1, ?2) where the same number may
    // appear twice to reuse a binding (e.g. ?3 for both created_at and
    // updated_at). bun:sqlite's positional "?" counts each occurrence as a
    // distinct bind slot, so we expand inline args to match.
    let expanded = sql;
    const expandedArgs: unknown[] = [];
    expanded = sql.replace(/\?(\d+)/g, (_m, n) => {
      const idx = Number(n) - 1;
      expandedArgs.push(args[idx]);
      return "?";
    });
    // If no numbered placeholders were used, fall through to the raw args.
    const finalArgs = /\?\d+/.test(sql) ? expandedArgs : args;
    const stmt = db.prepare(expanded);
    const api: D1PreparedStatement = {
      bind(...newArgs: unknown[]) {
        return bound(sql, newArgs);
      },
      async first<T = Record<string, unknown>>() {
        const r = stmt.get(...(finalArgs as never));
        return (r ?? null) as T | null;
      },
      async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
        const rows = stmt.all(...(finalArgs as never)) as T[];
        return { success: true, meta: {} as never, results: rows } as D1Result<T>;
      },
      async run() {
        stmt.run(...(finalArgs as never));
        return { success: true, meta: {}, results: [] } as unknown as D1Result;
      },
      async raw() {
        return [] as never;
      },
    } as unknown as D1PreparedStatement;
    return api;
  };

  return {
    prepare(sql: string) {
      return bound(sql);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const out: D1Result<T>[] = [];
      for (const s of statements) {
        out.push((await s.run()) as D1Result<T>);
      }
      return out;
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 } as never;
    },
    async dump() {
      throw new Error("not implemented");
    },
  } as unknown as D1Database;
}

// ---------------------------------------------------------------------------
// KV mock — in-memory map with expirationTtl support (best effort).
// ---------------------------------------------------------------------------

export function makeKV(): KVNamespace {
  const store = new Map<string, { value: string; expiresAt: number }>();
  return {
    async get(key: string, type?: "text" | "json") {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && entry.expiresAt < Date.now()) {
        store.delete(key);
        return null;
      }
      if (type === "json") return JSON.parse(entry.value);
      return entry.value;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      const expiresAt = opts?.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0;
      store.set(key, { value, expiresAt });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return {
        keys: [...store.keys()].map((name) => ({ name })),
        list_complete: true,
        cursor: "",
      } as never;
    },
  } as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// R2 mock.
// ---------------------------------------------------------------------------

export function makeR2(): R2Bucket {
  const store = new Map<string, { body: Uint8Array; meta: Record<string, unknown> }>();
  return {
    async put(key: string, value: ArrayBuffer | Uint8Array, opts?: Record<string, unknown>) {
      const body = value instanceof Uint8Array ? value : new Uint8Array(value);
      store.set(key, { body, meta: opts ?? {} });
      return { key } as never;
    },
    async get(key: string) {
      const v = store.get(key);
      if (!v) return null;
      return { body: v.body } as never;
    },
    async head(key: string) {
      return store.has(key) ? ({ key } as never) : null;
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { objects: [...store.keys()].map((k) => ({ key: k })) } as never;
    },
  } as unknown as R2Bucket;
}

// ---------------------------------------------------------------------------
// Queue mock — captures enqueued messages; tests can assert on them.
// ---------------------------------------------------------------------------

export interface QueueSpy {
  queue: Queue<UsageMessage>;
  messages: UsageMessage[];
  drain: () => UsageMessage[];
}

export function makeQueue(): QueueSpy {
  const messages: UsageMessage[] = [];
  const queue = {
    async send(m: UsageMessage) {
      messages.push(m);
    },
    async sendBatch(batch: Array<{ body: UsageMessage }>) {
      for (const m of batch) messages.push(m.body);
    },
  } as unknown as Queue<UsageMessage>;
  return {
    queue,
    messages,
    drain() {
      const out = [...messages];
      messages.length = 0;
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// DO namespace mock — not exercised by unit tests; returns a shim.
// ---------------------------------------------------------------------------

export function makeDO(): DurableObjectNamespace {
  return {
    idFromName: (n: string) => ({ toString: () => `do_${n}` }) as never,
    newUniqueId: () => ({ toString: () => `do_${Math.random()}` }) as never,
    get: (_id: never) => ({ fetch: async () => new Response("{}") }) as never,
  } as unknown as DurableObjectNamespace;
}

// ---------------------------------------------------------------------------
// Env factory.
// ---------------------------------------------------------------------------

export interface Harness {
  env: Env;
  queueSpy: QueueSpy;
}

export function makeEnv(overrides?: Partial<Env>): Harness {
  const queueSpy = makeQueue();
  const env: Env = {
    DB: makeD1(),
    KEYS: makeKV(),
    RATELIMIT: makeKV(),
    QUOTA: makeKV(),
    CACHE: makeR2(),
    USAGE: queueSpy.queue,
    RL_DO: makeDO(),
    APP_URL: "http://localhost:3000",
    API_URL: "http://localhost:8787",
    ENVIRONMENT: "development",
    STRIPE_PRICE_PRO: "price_pro_test",
    STRIPE_PRICE_TEAM: "price_team_test",
    STRIPE_PRICE_TEAM_SEAT: "price_team_seat_test",
    STRIPE_PRICE_OVERAGE_PRO: "price_overage_pro_test",
    STRIPE_PRICE_OVERAGE_TEAM: "price_overage_team_test",
    STRIPE_SECRET_KEY: "test_stub",
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    BETTER_AUTH_SECRET: "test_auth_secret",
    ...overrides,
  };
  return { env, queueSpy };
}

/** ExecutionContext shim that runs waitUntil synchronously (sort of). */
export function makeExecCtx(): ExecutionContext & { pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  return {
    waitUntil(p: Promise<unknown>) {
      pending.push(p);
    },
    passThroughOnException() {},
    pending,
  } as unknown as ExecutionContext & { pending: Promise<unknown>[] };
}

/** Seed: insert a user, workspace, membership, and return an api key + session. */
export async function seedWorkspaceWithKey(
  env: Env,
  opts: { plan?: import("../../shared/pricing.ts").PlanId } = {},
) {
  const { createKey } = await import("../src/keys.ts");
  const { monthlyWindow } = await import("../src/quota.ts");
  const { ulid, sha256Hex } = await import("../src/ids.ts");
  const { issueSessionForTest } = await import("../src/auth.ts");
  const now = Date.now();
  const userId = ulid();
  const workspaceId = ulid();
  const plan = opts.plan ?? "free";
  await env.DB.prepare(
    `INSERT INTO users (id, email, email_verified, created_at, updated_at)
     VALUES (?1, ?2, 1, ?3, ?3)`,
  )
    .bind(userId, `${userId}@test.dev`, now)
    .run();
  const { end } = monthlyWindow(now);
  await env.DB.prepare(
    `INSERT INTO workspaces (id, slug, name, owner_id, plan, subscription_status,
       quota_resets_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'none', ?6, ?7, ?7)`,
  )
    .bind(
      workspaceId,
      `ws-${workspaceId.slice(0, 8).toLowerCase()}`,
      "Test",
      userId,
      plan,
      end,
      now,
    )
    .run();
  await env.DB.prepare(
    `INSERT INTO members (workspace_id, user_id, role, invited_at, accepted_at)
     VALUES (?1, ?2, 'owner', ?3, ?3)`,
  )
    .bind(workspaceId, userId, now)
    .run();
  const key = await createKey(env, { workspaceId, userId, name: "seed", plan });
  const sessionToken = await issueSessionForTest(env, userId);
  return { userId, workspaceId, apiKey: key.secret, apiKeyId: key.id, sessionToken };
}
