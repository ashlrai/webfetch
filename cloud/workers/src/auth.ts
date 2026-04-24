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
import { sendWelcomeEmail } from "./email.ts";
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
      return `.${parts.slice(-2).join(".")}`;
    } catch {
      return undefined;
    }
  })();

  const auth = betterAuth({
    // Better Auth detects D1 natively via the `batch`/`exec`/`prepare` surface
    // and wraps it in its built-in Kysely D1 dialect. Previously we passed a
    // hand-rolled adapter POJO which Better Auth could not coerce into a
    // Kysely dialect → "Failed to initialize database adapter" at signup time.
    database: c.env.DB as unknown as never,
    baseURL: c.env.API_URL,
    // Our Hono router mounts Better Auth at `/auth/*`, not the default
    // `/api/auth`. Tell Better Auth so route matching aligns.
    basePath: "/auth",
    secret: c.env.BETTER_AUTH_SECRET,
    trustedOrigins: [c.env.APP_URL, c.env.API_URL],
    // Remap Better Auth's default model + field names onto our snake_case D1
    // schema. Without this, Better Auth would try `SELECT * FROM "user"` and
    // 500 with "Failed to initialize database adapter".
    user: {
      modelName: "users",
      fields: {
        email: "email",
        name: "name",
        emailVerified: "email_verified",
        image: "image",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
      modelName: "sessions",
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        token: "token",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
      },
    },
    account: {
      modelName: "oauth_accounts",
      fields: {
        // Legacy `provider` / `provider_account_id` columns are reused; keeps
        // the existing UNIQUE(provider, provider_account_id) index in play.
        userId: "user_id",
        providerId: "provider",
        accountId: "provider_account_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        scope: "scope",
        password: "password",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      modelName: "verification_tokens",
      fields: {
        identifier: "identifier",
        // Better Auth's `value` lands in our legacy `token_hash` column.
        value: "token_hash",
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string; email: string; name?: string }) => {
            // Auto-provision a default workspace + owner membership so the
            // newly-signed-up user immediately has somewhere to mint API keys,
            // track usage, and be upgraded to Pro. Without this, downstream
            // dashboard pages would 404 on `/v1/workspaces/current`.
            try {
              const workspaceId = ulid();
              const now = Date.now();
              const slug = (user.email.split("@")[0] || "workspace")
                .replace(/[^a-z0-9-]/gi, "-")
                .toLowerCase()
                .slice(0, 24);
              const name = user.name ? `${user.name}'s workspace` : `${slug}'s workspace`;
              // Quota resets on the 1st of the next month (UTC)
              const quotaResetsAt = (() => {
                const d = new Date();
                return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
              })();
              await c.env.DB.batch([
                c.env.DB.prepare(
                  `INSERT INTO workspaces (id, slug, name, owner_id, plan, subscription_status, quota_resets_at, created_at, updated_at)
                   VALUES (?1, ?2, ?3, ?4, 'free', 'active', ?5, ?6, ?6)`,
                ).bind(
                  workspaceId,
                  `${slug}-${workspaceId.slice(-6).toLowerCase()}`,
                  name,
                  user.id,
                  quotaResetsAt,
                  now,
                ),
                c.env.DB.prepare(
                  `INSERT INTO members (workspace_id, user_id, role, invited_at, accepted_at)
                   VALUES (?1, ?2, 'owner', ?3, ?3)`,
                ).bind(workspaceId, user.id, now),
              ]);
            } catch (err) {
              // Do not block signup on provisioning failure; log for debug.
              console.error("[auth.hooks.user.create.after] provisioning error", err);
            }
            // Best-effort welcome email — never blocks signup.
            const welcomeP = sendWelcomeEmail(c.env, { to: user.email, name: user.name });
            if (c.executionCtx?.waitUntil) {
              c.executionCtx.waitUntil(
                welcomeP.catch((err) => {
                  console.error("[auth.hooks.user.create.after] welcome email error", err);
                }),
              );
            } else {
              await welcomeP.catch((err) => {
                console.error("[auth.hooks.user.create.after] welcome email error", err);
              });
            }
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Email verification is ON when SENDGRID_API_KEY is a real key; we
      // default to OFF when the placeholder `test_*` is in place so self-signup
      // works for dogfooding. Set REQUIRE_EMAIL_VERIFICATION=1 to force-on in
      // non-SendGrid environments (magic-link fallback, etc.).
      requireEmailVerification:
        (!!c.env.SENDGRID_API_KEY && !c.env.SENDGRID_API_KEY.startsWith("test_")) ||
        c.env.REQUIRE_EMAIL_VERIFICATION === "1",
      // Better Auth's default is scrypt (N=16384) via a pure-JS fallback in
      // the Workers runtime → blows past the 10 ms CPU budget and returns
      // Cloudflare error 1102. Swap in Web Crypto PBKDF2-SHA-256 (100k
      // iterations) which runs in native code and finishes in ~2-3 ms on a
      // Workers isolate.
      password: { hash: hashPassword, verify: verifyPassword },
    },
    advanced: {
      // Force the session cookie name to `wf_session` (shared with the
      // dashboard + our hand-rolled getSessionUser below).
      cookies: {
        session_token: { name: SESSION_COOKIE },
      },
      ...(cookieDomain
        ? {
            crossSubDomainCookies: { enabled: true, domain: cookieDomain },
            defaultCookieAttributes: {
              sameSite: "lax" as const,
              secure: true,
              httpOnly: true,
              domain: cookieDomain,
            },
          }
        : {}),
    },
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
  // Better Auth issues the session cookie with the `__Secure-` prefix when the
  // request is HTTPS (per RFC 6265 §3.2), but our hand-rolled verifier was
  // only looking for the unprefixed name. Match both so dashboard endpoints
  // work in production. SA-058.
  const m =
    new RegExp(`(?:^|; )__Secure-${SESSION_COOKIE}=([^;]+)`).exec(cookie) ??
    new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`).exec(cookie);
  if (!m) return null;
  const raw = decodeURIComponent(m[1]!);
  // Better Auth signs session cookies as `<token>.<signature>`; split off the
  // signature so our lookup matches the stored token. Our own
  // `issueSessionForTest` writes an unsigned hex token, which still works
  // because it contains no `.` separator.
  const token = raw.includes(".") ? raw.slice(0, raw.indexOf(".")) : raw;
  const tokenHash = await sha256Hex(token);
  // Look up the row by either the plaintext token (Better Auth path) or its
  // sha256 hash (legacy `issueSessionForTest` path). We select both and do a
  // constant-time compare to avoid timing oracles.
  const row = await c.env.DB.prepare(
    `SELECT s.id, s.token, s.user_id, s.expires_at, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?1 OR s.id = ?2
      LIMIT 1`,
  )
    .bind(token, tokenHash)
    .first<{
      id: string;
      token: string | null;
      user_id: string;
      expires_at: number;
      email: string;
    }>();
  if (!row) return null;
  if (row.expires_at < Date.now()) return null;
  // Accept either shape: Better Auth writes the plaintext token into
  // `sessions.token`; `issueSessionForTest` writes the sha256 hash into both
  // `id` and `token`. Match if either comparison succeeds (constant-time).
  const tokenMatch =
    !!row.token && row.token.length === token.length && constantTimeEq(row.token, token);
  const hashMatch =
    (row.token ?? row.id).length === tokenHash.length &&
    constantTimeEq(row.token ?? row.id, tokenHash);
  if (!tokenMatch && !hashMatch) return null;
  return { userId: row.user_id, email: row.email, sessionId: row.id };
}

// ---------------------------------------------------------------------------
// Password hashing — Web Crypto PBKDF2-SHA-256.
//
// Format: `pbkdf2-sha256$<iterations>$<base64-salt>$<base64-hash>`
// Chosen over scrypt because the Workers runtime lacks native scrypt
// acceleration; Better Auth's default falls back to a pure-JS implementation
// that exceeds the CPU budget on free/paid Workers alike.
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 32; // bytes → 256-bit key

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    PBKDF2_KEYLEN * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${b64encode(salt)}$${b64encode(hash)}`;
}

export async function verifyPassword(opts: {
  password: string;
  hash: string;
}): Promise<boolean> {
  const parts = opts.hash.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const salt = b64decode(parts[2]!);
  const expected = b64decode(parts[3]!);
  const actual = await pbkdf2(opts.password, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

/** Used by the test suite to mint a session row directly (bypassing Better Auth). */
export async function issueSessionForTest(
  env: Env,
  userId: string,
  now = Date.now(),
): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  // Write the hash to BOTH `id` (legacy bearer-equals-pk shape) and `token`
  // (Better Auth shape) so `getSessionUser` resolves either way.
  await env.DB.prepare(
    `INSERT INTO sessions (id, token, user_id, expires_at, created_at, updated_at)
     VALUES (?1, ?1, ?2, ?3, ?4, ?4)`,
  )
    .bind(tokenHash, userId, now + SESSION_TTL_MS, now)
    .run();
  return token;
}

export { SESSION_TTL_MS };
