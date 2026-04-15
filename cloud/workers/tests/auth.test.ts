import { describe, expect, test } from "bun:test";
import type { Context } from "hono";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  getSessionUser,
  issueSessionForTest,
} from "../src/auth.ts";
import { sha256Hex, ulid } from "../src/ids.ts";
import { makeEnv } from "./harness.ts";

// Build a minimal Hono-ish Context shim: getSessionUser only reads
// `req.header("cookie")` and `env.DB`.
function ctxWith(env: ReturnType<typeof makeEnv>["env"], cookie: string) {
  return {
    env,
    req: {
      header(name: string) {
        return name.toLowerCase() === "cookie" ? cookie : undefined;
      },
    },
  } as unknown as Context;
}

async function seedUser(env: ReturnType<typeof makeEnv>["env"]) {
  const userId = ulid();
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, email_verified, created_at, updated_at)
     VALUES (?1, ?2, 1, ?3, ?3)`,
  )
    .bind(userId, `${userId}@test.dev`, now)
    .run();
  return userId;
}

describe("auth — schema alignment (migration 0004)", () => {
  test("sessions table exposes token + updated_at columns", async () => {
    const { env } = makeEnv();
    const info = await env.DB.prepare("PRAGMA table_info(sessions)").all<{
      name: string;
    }>();
    const cols = new Set((info.results ?? []).map((r) => r.name));
    expect(cols.has("token")).toBe(true);
    expect(cols.has("updated_at")).toBe(true);
    expect(cols.has("ip_address")).toBe(true);
    expect(cols.has("user_agent")).toBe(true);
  });

  test("oauth_accounts table exposes Better Auth columns", async () => {
    const { env } = makeEnv();
    const info = await env.DB.prepare("PRAGMA table_info(oauth_accounts)").all<{
      name: string;
    }>();
    const cols = new Set((info.results ?? []).map((r) => r.name));
    for (const c of [
      "id_token",
      "access_token_expires_at",
      "refresh_token_expires_at",
      "scope",
      "password",
      "updated_at",
    ]) {
      expect(cols.has(c)).toBe(true);
    }
  });

  test("verification_tokens.purpose is nullable and updated_at exists", async () => {
    const { env } = makeEnv();
    const info = await env.DB.prepare("PRAGMA table_info(verification_tokens)").all<{
      name: string;
      notnull: number;
    }>();
    const byName = new Map((info.results ?? []).map((r) => [r.name, r] as const));
    expect(byName.has("updated_at")).toBe(true);
    expect(byName.get("purpose")?.notnull).toBe(0);
    // token_hash remains NOT NULL — Better Auth maps `value` → token_hash.
    expect(byName.get("token_hash")?.notnull).toBe(1);
  });
});

describe("auth — session roundtrip", () => {
  test("issueSessionForTest + getSessionUser recover the user", async () => {
    const { env } = makeEnv();
    const userId = await seedUser(env);
    const token = await issueSessionForTest(env, userId);
    const session = await getSessionUser(
      ctxWith(env, `${SESSION_COOKIE}=${encodeURIComponent(token)}`),
    );
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(userId);
    expect(session!.email).toBe(`${userId}@test.dev`);
  });

  test("session row has token column populated (Better Auth shape)", async () => {
    const { env } = makeEnv();
    const userId = await seedUser(env);
    const token = await issueSessionForTest(env, userId);
    const hash = await sha256Hex(token);
    const row = await env.DB.prepare(
      "SELECT id, token, user_id, expires_at FROM sessions WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ id: string; token: string; user_id: string; expires_at: number }>();
    expect(row).not.toBeNull();
    expect(row!.token).toBe(hash);
    expect(row!.id).toBe(hash);
    expect(row!.expires_at).toBeGreaterThan(Date.now() + SESSION_TTL_MS - 60_000);
  });

  test("expired session is rejected", async () => {
    const { env } = makeEnv();
    const userId = await seedUser(env);
    const token = await issueSessionForTest(env, userId, Date.now() - SESSION_TTL_MS - 1);
    const session = await getSessionUser(
      ctxWith(env, `${SESSION_COOKIE}=${encodeURIComponent(token)}`),
    );
    expect(session).toBeNull();
  });

  test("missing cookie returns null", async () => {
    const { env } = makeEnv();
    const session = await getSessionUser(ctxWith(env, ""));
    expect(session).toBeNull();
  });

  test("tampered token returns null", async () => {
    const { env } = makeEnv();
    const userId = await seedUser(env);
    const token = await issueSessionForTest(env, userId);
    const bad = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    const session = await getSessionUser(ctxWith(env, `${SESSION_COOKIE}=${bad}`));
    expect(session).toBeNull();
  });

  test("Better Auth-style signed cookie (<token>.<sig>) is accepted", async () => {
    // Better Auth appends `.<hmac>` to the cookie value. `getSessionUser`
    // strips it before lookup; it should still resolve the user.
    const { env } = makeEnv();
    const userId = await seedUser(env);
    const token = await issueSessionForTest(env, userId);
    const signed = `${token}.bogus-signature-we-do-not-verify-here`;
    const session = await getSessionUser(
      ctxWith(env, `${SESSION_COOKIE}=${encodeURIComponent(signed)}`),
    );
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(userId);
  });
});
