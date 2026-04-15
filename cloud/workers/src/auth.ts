/**
 * Better Auth integration — dashboard cookie auth (`/auth/*`).
 *
 * We wire Better Auth up against the D1 database via a thin adapter. Email +
 * password, magic-link, Google, and GitHub OAuth are enabled if the
 * corresponding secrets are bound in the env.
 *
 * Better Auth's full API is far wider than we need on the Worker side; this
 * file exposes two things:
 *
 *   - `handleAuth(c)` — forward a request to Better Auth's router.
 *   - `getSessionUser(c)` — resolve the current user from the session cookie
 *     (used by the dashboard-facing routes in teams.ts / billing.ts / keys.ts).
 *
 * We keep the import lazy so the worker cold-starts fast on anonymous `/health`
 * hits that don't touch auth.
 */

import type { Context } from "hono";
import type { Env } from "./env.ts";
import { constantTimeEq, sha256Hex, ulid } from "./ids.ts";

// Better Auth is imported lazily inside the handlers below to avoid pulling its
// cold-start cost into the hot path. The types import is fine though.
// We deliberately do NOT re-export Better Auth's types — we keep our own
// narrow User interface in cloud/shared/types.ts.

/** Session cookie name; shared with the dashboard. */
export const SESSION_COOKIE = "wf_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface SessionUser {
  userId: string;
  email: string;
  sessionId: string;
}

/**
 * Dispatch a request to Better Auth. In production this delegates to
 * `betterAuth({...}).handler(req)`. The lazy import keeps cold starts lean.
 */
export async function handleAuth(c: Context<{ Bindings: Env }>): Promise<Response> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import("better-auth").catch(() => null as any);
  if (!mod) {
    return c.json({ ok: false, error: "auth backend not configured" }, 503);
  }
  const { betterAuth } = mod;
  // Cross-subdomain cookie domain. In prod, the API lives on api.getwebfetch.com
  // and the dashboard on app.getwebfetch.com — both need to share the session
  // cookie. Derive the parent domain from APP_URL so staging/local-dev still work.
  const cookieDomain = (() => {
    try {
      const appHost = new URL(c.env.APP_URL).hostname;
      // localhost / *.vercel.app → no cross-subdomain (host-only cookies)
      if (appHost === "localhost" || appHost.endsWith(".vercel.app")) return undefined;
      const parts = appHost.split(".");
      if (parts.length < 2) return undefined;
      // e.g. app.getwebfetch.com → .getwebfetch.com
      return "." + parts.slice(-2).join(".");
    } catch {
      return undefined;
    }
  })();

  const auth = betterAuth({
    database: d1Adapter(c.env),
    baseURL: c.env.API_URL,
    secret: c.env.BETTER_AUTH_SECRET,
    trustedOrigins: [c.env.APP_URL, c.env.API_URL],
    emailAndPassword: { enabled: true, requireEmailVerification: true },
    advanced: cookieDomain
      ? {
          crossSubDomainCookies: { enabled: true, domain: cookieDomain },
          defaultCookieAttributes: {
            sameSite: "lax" as const,
            secure: true,
            httpOnly: true,
            domain: cookieDomain,
          },
        }
      : undefined,
    socialProviders: {
      ...(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: c.env.GOOGLE_CLIENT_ID,
              clientSecret: c.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
      ...(c.env.GITHUB_CLIENT_ID && c.env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: c.env.GITHUB_CLIENT_ID,
              clientSecret: c.env.GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
    },
  });
  return auth.handler(c.req.raw);
}

/**
 * Resolve the session user from the cookie. Does a D1 lookup; cookies in prod
 * will live up to 30 days.
 *
 * Implementation note: this is a hand-rolled session verifier (rather than
 * delegating to Better Auth's handler) so that dashboard-endpoint handlers can
 * call it cheaply inside `c.executionCtx` without round-tripping to the auth
 * router. Better Auth stores session rows in the same `sessions` table.
 */
export async function getSessionUser(c: Context<{ Bindings: Env }>): Promise<SessionUser | null> {
  const cookie = c.req.header("cookie") ?? "";
  const m = new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`).exec(cookie);
  if (!m) return null;
  const token = decodeURIComponent(m[1]!);
  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, s.expires_at, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?1
      LIMIT 1`,
  )
    .bind(tokenHash)
    .first<{ id: string; user_id: string; expires_at: number; email: string }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  // SECURITY (SA-008): The previous `constantTimeEq(row.id, tokenHash)` was a
  // no-op because `row.id` was selected WHERE s.id = tokenHash. The real
  // constant-time check is moot since lookup happens on the hashed token
  // (attacker cannot time-attack a sha256 prefix), but we keep an explicit
  // length-equality check to fail fast on any malformed row.
  if (row.id.length !== tokenHash.length) return null;
  if (!constantTimeEq(row.id, tokenHash)) return null;
  return { userId: row.user_id, email: row.email, sessionId: row.id };
}

/**
 * Minimal D1 adapter surface that Better Auth will call. This is intentionally
 * a thin shim — Better Auth's built-in SQLite adapter is pluggable, but D1's
 * Workers-native driver doesn't match the `better-sqlite3` interface. We
 * expose the methods Better Auth's core adapter contract needs.
 */
function d1Adapter(env: Env) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async create({ model, data }: { model: string; data: Record<string, any> }) {
      const id = data.id ?? ulid();
      const now = Date.now();
      const row: Record<string, unknown> = {
        id,
        ...data,
        createdAt: data.createdAt ?? now,
        updatedAt: now,
      };
      const cols = Object.keys(row);
      const placeholders = cols.map((_, i) => `?${i + 1}`).join(",");
      await env.DB.prepare(
        `INSERT INTO ${escapeIdent(model)} (${cols.map(escapeIdent).join(",")})
         VALUES (${placeholders})`,
      )
        .bind(...cols.map((c) => row[c]))
        .run();
      return row;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async findOne({
      model,
      where,
    }: { model: string; where: Array<{ field: string; value: any }> }) {
      const clause = where.map((w, i) => `${escapeIdent(w.field)} = ?${i + 1}`).join(" AND ");
      const res = await env.DB.prepare(
        `SELECT * FROM ${escapeIdent(model)} WHERE ${clause} LIMIT 1`,
      )
        .bind(...where.map((w) => w.value))
        .first();
      return res ?? null;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async findMany({
      model,
      where,
    }: { model: string; where?: Array<{ field: string; value: any }> }) {
      if (!where?.length) {
        const res = await env.DB.prepare(`SELECT * FROM ${escapeIdent(model)}`).all();
        return res.results ?? [];
      }
      const clause = where.map((w, i) => `${escapeIdent(w.field)} = ?${i + 1}`).join(" AND ");
      const res = await env.DB.prepare(`SELECT * FROM ${escapeIdent(model)} WHERE ${clause}`)
        .bind(...where.map((w) => w.value))
        .all();
      return res.results ?? [];
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async update({
      model,
      where,
      update,
    }: {
      model: string;
      where: Array<{ field: string; value: any }>;
      update: Record<string, any>;
    }) {
      const sets = Object.keys(update)
        .map((k, i) => `${escapeIdent(k)} = ?${i + 1}`)
        .join(", ");
      const whereClause = where
        .map((w, i) => `${escapeIdent(w.field)} = ?${Object.keys(update).length + i + 1}`)
        .join(" AND ");
      await env.DB.prepare(`UPDATE ${escapeIdent(model)} SET ${sets} WHERE ${whereClause}`)
        .bind(...Object.values(update), ...where.map((w) => w.value))
        .run();
      return { ...update };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async delete({ model, where }: { model: string; where: Array<{ field: string; value: any }> }) {
      const clause = where.map((w, i) => `${escapeIdent(w.field)} = ?${i + 1}`).join(" AND ");
      await env.DB.prepare(`DELETE FROM ${escapeIdent(model)} WHERE ${clause}`)
        .bind(...where.map((w) => w.value))
        .run();
    },
  };
}

function escapeIdent(s: string): string {
  // D1 accepts double-quoted identifiers; restrict to safe chars as a belt+suspenders defense.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`unsafe identifier: ${s}`);
  return `"${s}"`;
}

/** Used by the test suite to mint a session row directly (bypassing Better Auth). */
export async function issueSessionForTest(
  env: Env,
  userId: string,
  now = Date.now(),
): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)",
  )
    .bind(tokenHash, userId, now + SESSION_TTL_MS, now)
    .run();
  return token;
}

export { SESSION_TTL_MS };
