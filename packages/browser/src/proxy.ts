/**
 * Proxy formatting helpers. Each vendor has its own URL/auth shape; we
 * normalize to a single { server, username, password } Playwright
 * ProxySettings-ish object.
 */

import type { ProxyConfig } from "./types.ts";

export interface FormattedProxy {
  /** Playwright-style proxy.server, e.g. "http://brd.superproxy.io:22225" */
  server: string;
  username?: string;
  password?: string;
}

export function formatProxy(cfg: ProxyConfig): FormattedProxy {
  const ep = cfg.endpoint.trim();
  // Accept bare host:port or full URL with scheme.
  const server = /^https?:\/\//i.test(ep)
    ? ep
    : ep.startsWith("socks")
      ? ep
      : `http://${ep}`;
  switch (cfg.kind) {
    case "brightdata": {
      // Bright Data encodes session + country in the username.
      // Format: brd-customer-<id>-zone-<zone>[-session-rand<N>]
      return {
        server,
        username: cfg.user,
        password: cfg.pass,
      };
    }
    case "smartproxy":
    case "custom":
    default:
      return {
        server,
        username: cfg.user,
        password: cfg.pass,
      };
  }
}

/** Rotate a Bright Data session id — simple counter per-process. */
let sessionCounter = Math.floor(Math.random() * 1_000_000);
export function brightdataRotatedUser(baseUser: string): string {
  sessionCounter = (sessionCounter + 1) % 1_000_000_000;
  // Append -session-rand<N> if not already present.
  if (/-session-/.test(baseUser)) {
    return baseUser.replace(/-session-[^-]+/, `-session-rand${sessionCounter}`);
  }
  return `${baseUser}-session-rand${sessionCounter}`;
}
