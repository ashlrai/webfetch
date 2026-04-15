/**
 * Session-authenticated proxy to api.getwebfetch.com.
 *
 * The browser never talks to the API directly from the dashboard — instead it
 * hits `/api/proxy/<path>` on the dashboard origin. This route:
 *
 *   1. Verifies the Better Auth session cookie (attached to `.getwebfetch.com`).
 *   2. Forwards the request to `${API_URL}/<path>` with the session ID as a
 *      bearer token — the Worker's auth middleware recognizes session tokens
 *      and resolves them to the user + workspace in a single lookup.
 *   3. Passes through status, headers (minus sensitive ones), and body.
 *
 * When `USE_FIXTURES=1` the whole route short-circuits with a 501 so callers
 * don't accidentally hit a real API during dev. (The typed client in
 * `lib/api.ts` already branches to fixtures before calling here, so this path
 * is only reached when fixtures are off.)
 */

import { API_URL, USE_FIXTURES } from "@/env";
import { getServerSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (USE_FIXTURES) {
    return new Response(
      JSON.stringify({
        error: "fixtures_mode",
        hint: "Set NEXT_PUBLIC_USE_FIXTURES=0 to proxy to api.getwebfetch.com.",
      }),
      { status: 501, headers: { "Content-Type": "application/json" } },
    );
  }

  const session = await getServerSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "unauthenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { path } = await ctx.params;
  const joined = (path ?? []).join("/");
  const url = new URL(req.url);
  const target = `${API_URL}/${joined}${url.search}`;

  const headers = new Headers();
  for (const [k, v] of req.headers) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  }
  headers.set("Authorization", `Bearer session:${session.user.id}`);
  headers.set("x-webfetch-origin", "dashboard");

  let body: BodyInit | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer();
  }

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body,
    redirect: "manual",
  });

  const outHeaders = new Headers();
  for (const [k, v] of upstream.headers) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders.set(k, v);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
  proxy as OPTIONS,
};
