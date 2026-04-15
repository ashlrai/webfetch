/**
 * SSRF guard — reject URLs that target private, link-local, or loopback hosts,
 * or use non-http(s) schemes. Added per SECURITY-AUDIT-REPORT.md § SA-001.
 *
 * This is a best-effort hostname-literal filter. It does NOT defend against
 * DNS rebinding (where a public hostname resolves to a private IP at fetch
 * time); the Cloudflare egress network already isolates worker fetches from
 * the platform's internal control plane, and we additionally rely on the
 * upstream fetcher returning only http(s) responses. Further hardening (e.g.
 * post-resolution IP checks) would require a custom resolver Workers does
 * not expose today.
 */

export interface SsrfCheck {
  ok: boolean;
  error: string;
}

// IPv4 literal helpers.
function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some((n) => n < 0 || n > 255 || Number.isNaN(n))) return null;
  return parts;
}

function isPrivateIPv4(parts: number[]): boolean {
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this network"
  if (a === 169 && b === 254) return true; // link-local / cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "metadata.google.internal") return true;
  if (h.endsWith(".internal")) return true;
  if (h === "0.0.0.0") return true;
  // IPv6 loopback + link-local + unique-local.
  if (h === "::1" || h === "[::1]") return true;
  if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
  const v4 = parseIPv4(h);
  if (v4 && isPrivateIPv4(v4)) return true;
  return false;
}

/**
 * Validate that a URL is an http(s) URL pointing at a public hostname. Returns
 * `{ ok: true }` on pass; `{ ok: false, error }` otherwise.
 */
export function assertPublicHttpUrl(raw: string): SsrfCheck {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "invalid url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: `disallowed url scheme: ${u.protocol}` };
  }
  if (!u.hostname) return { ok: false, error: "missing host" };
  if (isBlockedHostname(u.hostname)) {
    return { ok: false, error: `host blocked by policy` };
  }
  return { ok: true, error: "" };
}
