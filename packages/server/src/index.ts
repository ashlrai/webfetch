#!/usr/bin/env bun
/**
 * webfetch HTTP server entry point.
 *
 * Usage:
 *   webfetch-server [--port 7600] [--host 127.0.0.1] [--no-open] [--regenerate-token]
 *
 * On boot:
 *   1. Generates (or loads) ~/.webfetch/server.token
 *   2. Prints the token to stdout (one-time bootstrap UX)
 *   3. Unless --no-open, opens http://127.0.0.1:<port>/auth/display in the
 *      user's default browser so they can click "Copy token".
 */

import { ensureToken } from "./auth.ts";
import { startServer } from "./server.ts";
import { tryOpenBrowser } from "./auth-display.ts";

interface Args {
  port: number;
  host: string;
  open: boolean;
  regenerate: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { port: 7600, host: "127.0.0.1", open: true, regenerate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--host") out.host = String(argv[++i]);
    else if (a === "--no-open") out.open = false;
    else if (a === "--regenerate-token") out.regenerate = true;
    else if (a === "--help" || a === "-h") {
      console.log("webfetch-server [--port 7600] [--host 127.0.0.1] [--no-open] [--regenerate-token]");
      process.exit(0);
    }
  }
  if (!Number.isFinite(out.port) || out.port <= 0 || out.port > 65535) {
    console.error("invalid --port");
    process.exit(2);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const { token, tokenPath } = ensureToken({ regenerate: args.regenerate });
const server = startServer({ port: args.port, hostname: args.host, token });

const base = `http://${args.host}:${server.port}`;
console.log(`webfetch-server listening on ${base}`);
console.log(`token: ${token}`);
console.log(`token file: ${tokenPath}`);
console.log(`auth display: ${base}/auth/display`);

if (args.open) tryOpenBrowser(`${base}/auth/display`);

function shutdown() {
  try { server.stop(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
