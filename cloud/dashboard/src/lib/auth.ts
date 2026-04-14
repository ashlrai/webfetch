/**
 * Better Auth client wrapper. Kept as a thin shim so the real Better Auth
 * package import is isolated from consumers — we can stub this during tests
 * and when `USE_FIXTURES` is on.
 *
 * NOTE: Better Auth's React hooks are imported lazily inside the hook so
 * server components that import types from this file don't pull in the
 * client bundle.
 */

import type { User } from "@shared/types";
import { USE_FIXTURES } from "@/env";
import { fixtureUser } from "@/lib/fixtures";

export interface Session {
  user: User;
  expiresAt: number;
}

export async function getServerSession(): Promise<Session | null> {
  if (USE_FIXTURES) {
    return { user: fixtureUser, expiresAt: Date.now() + 86_400_000 };
  }
  // Real impl: call Better Auth server helper. Stubbed here so the dashboard
  // builds without the cloud backend — the Worker will own the session table.
  return null;
}

export async function signOut(): Promise<void> {
  if (USE_FIXTURES) return;
  await fetch("/api/proxy/v1/auth/signout", { method: "POST", credentials: "include" });
}
