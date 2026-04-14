/**
 * CORS policy for the local HTTP server.
 *
 * Allows:
 *   - chrome-extension://*   (our extension)
 *   - moz-extension://*      (future Firefox parity)
 *   - http://127.0.0.1[:*]   (local tooling / curl with Origin)
 *   - http://localhost[:*]
 *   - null / missing Origin  (curl, server-to-server)
 *
 * Returns { allowed, headers } — headers are always safe to merge into the
 * response (they're "access-control-*" only).
 */

export interface CorsResult {
  allowed: boolean;
  headers: Record<string, string>;
}

export function evaluateCors(req: Request): CorsResult {
  const origin = req.headers.get("origin");
  const allowed = isOriginAllowed(origin);
  const headers: Record<string, string> = {
    "access-control-allow-origin": origin ?? "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
    "vary": "origin",
  };
  return { allowed, headers };
}

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin || origin === "null") return true;
  try {
    const u = new URL(origin);
    if (u.protocol === "chrome-extension:" || u.protocol === "moz-extension:") return true;
    if (u.protocol === "http:" || u.protocol === "https:") {
      if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function preflight(req: Request): Response {
  const { allowed, headers } = evaluateCors(req);
  if (!allowed) return new Response("forbidden origin", { status: 403 });
  return new Response(null, { status: 204, headers });
}
