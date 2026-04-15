/**
 * Redirect unauthenticated visitors to /login for every route except a small
 * set of public ones (landing, login, signup, password reset, auth proxy,
 * static assets, the synthetic fixture SSE stream).
 *
 * We detect "authenticated" by presence of the `wf_session` cookie — the
 * definitive check happens server-side in `getServerSession()` when each
 * page actually renders. This middleware just short-circuits the trip so
 * signed-out users don't flash protected UI.
 */

import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  // Entire proxy surface is public at the edge — upstream worker enforces auth.
  // This keeps `/api/proxy/health` reachable and lets Better Auth redirects
  // (sign-in/sign-up callbacks, OAuth) land on the dashboard before the
  // session cookie has been committed to the browser.
  "/api/proxy",
  "/usage/stream", // dev-only synthetic SSE
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  // Honor fixtures mode: always allow through during local dev.
  if (process.env.NEXT_PUBLIC_USE_FIXTURES === "1") return NextResponse.next();

  const hasSession = req.cookies.has("wf_session");
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match everything except Next internals, favicon, and static files.
    "/((?!_next/|favicon|robots\\.txt|sitemap\\.xml|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
