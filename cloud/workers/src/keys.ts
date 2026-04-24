/**
 * API-key CRUD + verification.
 *
 * Key format: `wf_live_<32 hex>` (44 chars total). Stripe-ish. The prefix
 * (first 12 chars, e.g. `wf_live_ab12`) is safe to show in UIs; the raw
 * secret is only returned once, on creation.
 *
 * Storage layout:
 *   - `api_keys` table  — row per key (hashed secret + metadata).
 *   - `KEYS` KV         — hash -> `{workspaceId,apiKeyId,plan}` JSON blob for
 *     sub-millisecond bearer auth on the hot path.
 *
 * Rotation: revoke the row (sets `revoked_at`), delete the KV entry. A small
 * tombstone TTL on the KV side handles edge-of-cache reads.
 */

import type { PlanId } from "../../shared/pricing.ts";
import type { Env } from "./env.ts";
import { sha256Hex, ulid } from "./ids.ts";

export const KEY_PREFIX = "wf_live_";
export const KEY_LEN = 32; // hex chars after prefix

export interface KeyLookup {
  workspaceId: string;
  apiKeyId: string;
  plan: PlanId;
}

/** Generate a fresh `wf_live_*` secret. Only returned once; never persisted. */
export async function generateKey(): Promise<{ secret: string; prefix: string; hash: string }> {
  const bytes = new Uint8Array(KEY_LEN / 2);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const secret = `${KEY_PREFIX}${hex}`;
  const hash = await sha256Hex(secret);
  return { secret, prefix: secret.slice(0, 12), hash };
}

/**
 * Return the KV cache key for a given token hash. The KV namespace uses the
 * raw sha256 hex as the key (see `resolveKey`). Exported so the billing layer
 * can delete entries on plan downgrade without re-deriving the format.
 */
export function cacheKeyFor(tokenHash: string): string {
  return tokenHash;
}

/** Parse a bearer header value; returns null on any malformed input. */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  const tok = m[1]!.trim();
  if (!tok.startsWith(KEY_PREFIX)) return null;
  if (tok.length !== KEY_PREFIX.length + KEY_LEN) return null;
  return tok;
}

/**
 * Resolve a bearer token to a workspace. Reads KV first (hot path), falls back
 * to D1 on miss and repairs the KV entry.
 */
export async function resolveKey(env: Env, bearer: string): Promise<KeyLookup | null> {
  const hash = await sha256Hex(bearer);
  const cached = await env.KEYS.get(hash, "json");
  if (cached) return cached as KeyLookup;

  const row = await env.DB.prepare(
    `SELECT k.id, k.workspace_id, k.revoked_at, w.plan
       FROM api_keys k
       JOIN workspaces w ON w.id = k.workspace_id
      WHERE k.hash = ?1
      LIMIT 1`,
  )
    .bind(hash)
    .first<{ id: string; workspace_id: string; revoked_at: number | null; plan: PlanId }>();
  if (!row || row.revoked_at) return null;

  const lookup: KeyLookup = {
    workspaceId: row.workspace_id,
    apiKeyId: row.id,
    plan: row.plan,
  };
  await env.KEYS.put(hash, JSON.stringify(lookup), { expirationTtl: 3600 });
  return lookup;
}

export async function touchLastUsed(env: Env, apiKeyId: string, now = Date.now()): Promise<void> {
  // Fire and forget. Best-effort; failure doesn't break the request.
  await env.DB.prepare("UPDATE api_keys SET last_used_at = ?1 WHERE id = ?2")
    .bind(now, apiKeyId)
    .run();
}

export interface CreateKeyInput {
  workspaceId: string;
  userId: string;
  name: string;
  plan: PlanId;
}

export async function createKey(env: Env, input: CreateKeyInput) {
  const { secret, prefix, hash } = await generateKey();
  const id = ulid();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO api_keys (id, workspace_id, created_by_user_id, prefix, hash, name, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(id, input.workspaceId, input.userId, prefix, hash, input.name, now)
    .run();
  await env.KEYS.put(
    hash,
    JSON.stringify({ workspaceId: input.workspaceId, apiKeyId: id, plan: input.plan }),
    { expirationTtl: 3600 },
  );
  return { id, prefix, secret, name: input.name, createdAt: now };
}

export async function listKeys(env: Env, workspaceId: string) {
  const res = await env.DB.prepare(
    `SELECT id, prefix, name, revoked_at, last_used_at, created_at
       FROM api_keys
      WHERE workspace_id = ?1
      ORDER BY created_at DESC`,
  )
    .bind(workspaceId)
    .all();
  return res.results ?? [];
}

export async function revokeKey(env: Env, workspaceId: string, apiKeyId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT hash FROM api_keys WHERE id = ?1 AND workspace_id = ?2 AND revoked_at IS NULL",
  )
    .bind(apiKeyId, workspaceId)
    .first<{ hash: string }>();
  if (!row) return false;
  const now = Date.now();
  await env.DB.prepare("UPDATE api_keys SET revoked_at = ?1 WHERE id = ?2")
    .bind(now, apiKeyId)
    .run();
  await env.KEYS.delete(row.hash);
  return true;
}
