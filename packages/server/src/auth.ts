/**
 * Token bootstrap + Bearer verification.
 *
 * Generates a random 32-byte hex token on first boot, writes it to
 * ~/.webfetch/server.token (0600), and requires callers to present
 * `Authorization: Bearer <token>` on every request.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AuthState {
  token: string;
  tokenPath: string;
}

export function ensureToken(opts: { regenerate?: boolean } = {}): AuthState {
  const dir = join(homedir(), ".webfetch");
  const tokenPath = join(dir, "server.token");
  mkdirSync(dir, { recursive: true });
  let token: string;
  if (!opts.regenerate && existsSync(tokenPath)) {
    token = readFileSync(tokenPath, "utf8").trim();
    if (!token) token = generate();
  } else {
    token = generate();
  }
  writeFileSync(tokenPath, token, { encoding: "utf8" });
  try { chmodSync(tokenPath, 0o600); } catch {}
  return { token, tokenPath };
}

function generate(): string {
  return randomBytes(32).toString("hex");
}

export function checkBearer(req: Request, expected: string): boolean {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!h) return false;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (!m) return false;
  return constantTimeEq(m[1]!.trim(), expected);
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
