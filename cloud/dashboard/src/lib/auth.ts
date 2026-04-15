/**
 * Better Auth client wrapper. Kept as a thin shim so the real Better Auth
 * package import is isolated from consumers — we can stub this during tests
 * and when `USE_FIXTURES` is on.
 *
 * NOTE: Better Auth's React hooks are imported lazily inside the hook so
 * server components that import types from this file don't pull in the
 * client bundle.
 */

import { API_URL, USE_FIXTURES } from "@/env";
import { fixtureUser } from "@/lib/fixtures";
import type { User } from "@shared/types";

export interface Session {
  user: User;
  expiresAt: number;
}

/**
 * Resolve the current session by forwarding the incoming request's cookies
 * to Better Auth's `/auth/get-session` endpoint on api.getwebfetch.com.
 *
 * The session cookie (`wf_session`) is issued with domain=.getwebfetch.com by
 * the worker so it's visible to both app.getwebfetch.com (this dashboard) and
 * api.getwebfetch.com (the worker). We can therefore hand-roll a session
 * lookup here without a Better Auth React/server package.
 */
export async function getServerSession(): Promise<Session | null> {
  if (USE_FIXTURES) {
    return { user: fixtureUser, expiresAt: Date.now() + 86_400_000 };
  }
  const { headers: nextHeaders } = await import("next/headers");
  const h = await nextHeaders();
  const cookie = h.get("cookie");
  if (!cookie) return null;
  try {
    const res = await fetch(`${API_URL}/auth/get-session`, {
      headers: { cookie, "x-webfetch-origin": "dashboard-ssr" },
      cache: "no-store",
      // Never follow Set-Cookie redirects; we only want the session JSON.
      redirect: "manual",
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => null)) as {
      user?: Partial<User> & { id?: string; email?: string };
      session?: { expiresAt?: number | string };
    } | null;
    if (!data?.user?.id || !data.user.email) return null;
    const expiresAt =
      typeof data.session?.expiresAt === "number"
        ? data.session.expiresAt
        : data.session?.expiresAt
          ? Date.parse(String(data.session.expiresAt))
          : Date.now() + 86_400_000;
    const u = data.user;
    if (!u.id || !u.email) return null;
    const user: User = {
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      emailVerified: u.emailVerified ?? false,
      image: u.image ?? null,
      createdAt: u.createdAt ?? Date.now(),
      updatedAt: u.updatedAt ?? Date.now(),
    };
    return { user, expiresAt };
  } catch {
    return null;
  }
}

export async function signOut(): Promise<void> {
  if (USE_FIXTURES) return;
  // Better Auth's sign-out endpoint.
  await fetch("/api/proxy/auth/sign-out", { method: "POST", credentials: "include" });
}
