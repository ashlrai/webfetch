/**
 * Bun.serve wiring. Split out from index.ts so tests can spin it up without
 * running the CLI side-effects (arg parsing, console logging, browser open).
 */

import { renderAuthDisplay } from "./auth-display.ts";
import { checkBearer } from "./auth.ts";
import { evaluateCors, preflight } from "./cors.ts";
import { dispatchPost, getProviders } from "./routes.ts";

export interface ServerOptions {
  port: number;
  hostname?: string;
  token: string;
}

export function startServer(opts: ServerOptions) {
  const { port, token } = opts;
  const hostname = opts.hostname ?? "127.0.0.1";
  const server = Bun.serve({
    port,
    hostname,
    async fetch(req) {
      const url = new URL(req.url);
      const { allowed, headers: cors } = evaluateCors(req);

      if (req.method === "OPTIONS") return preflight(req);
      if (!allowed) return withHeaders(json({ ok: false, error: "forbidden origin" }, 403), cors);

      // Auth-display is public (same-origin 127.0.0.1 only, exposes only the
      // token value that was already written to disk).
      if (req.method === "GET" && url.pathname === "/auth/display") {
        if (!isLoopbackHost(hostname) || !isLoopbackHost(url.hostname)) {
          return withHeaders(json({ ok: false, error: "not found" }, 404), cors);
        }
        return withHeaders(
          new Response(renderAuthDisplay(token, port), {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
          cors,
        );
      }

      if (!checkBearer(req, token)) {
        return withHeaders(json({ ok: false, error: "unauthorized" }, 401), cors);
      }

      if (req.method === "GET" && url.pathname === "/health") {
        return withHeaders(json({ ok: true, data: { status: "ok" } }), cors);
      }
      if (
        req.method === "GET" &&
        (url.pathname === "/providers" || url.pathname === "/v1/providers")
      ) {
        return withHeaders(getProviders(), cors);
      }
      if (req.method === "POST") {
        return withHeaders(await dispatchPost(url.pathname, req), cors);
      }
      return withHeaders(json({ ok: false, error: "not found" }, 404), cors);
    },
  });
  return server;
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) && parts[0] === 127;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function withHeaders(res: Response, extra: Record<string, string>): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}
