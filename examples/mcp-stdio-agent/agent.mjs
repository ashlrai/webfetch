#!/usr/bin/env node
/**
 * Minimal agent-side MCP client for webfetch, with zero dependencies.
 *
 * It does what an agent framework does under the hood: spawn the webfetch MCP
 * server over stdio, run the MCP handshake, discover tools, call
 * `search_images` with an open-only license policy, and hand the ranked,
 * attributed results to the next pipeline step (here: stdout as JSON).
 *
 *   node examples/mcp-stdio-agent/agent.mjs "red panda"
 *   node examples/mcp-stdio-agent/agent.mjs "red panda" --server "npx -y getwebfetch-mcp"
 *
 * The default server is this checkout's source (`bun packages/mcp/src/index.ts`).
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function parseArgs(argv) {
  const out = {
    query: null,
    server: `bun ${resolve(repoRoot, "packages/mcp/src/index.ts")}`,
    providers: ["wikimedia", "openverse", "nasa"],
    licensePolicy: "open-only",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server") out.server = argv[++i];
    else if (a === "--providers") out.providers = argv[++i].split(",").filter(Boolean);
    else if (a === "--license") out.licensePolicy = argv[++i];
    else if (out.query === null) out.query = a;
  }
  return out;
}

/** Start an MCP stdio server and return a tiny JSON-RPC client for it. */
export function connect(serverCommand, { timeoutMs = 30_000 } = {}) {
  const [cmd, ...args] = serverCommand.split(" ").filter(Boolean);
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });
  const pending = new Map();
  let nextId = 1;
  createInterface({ input: child.stdout }).on("line", (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // servers must only write JSON-RPC to stdout; ignore anything else
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
    else p.resolve(msg.result);
  });
  child.on("exit", (code) => {
    for (const p of pending.values()) p.reject(new Error(`server exited (${code})`));
    pending.clear();
  });
  const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`);
  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolvePromise, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, { resolve: resolvePromise, reject, timer });
        send({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method, params = {}) {
      send({ jsonrpc: "2.0", method, params });
    },
    close() {
      child.stdin.end();
      child.kill();
    },
  };
}

export async function findImages({ query, server, providers, licensePolicy }) {
  const mcp = connect(server);
  try {
    const init = await mcp.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "webfetch-example-agent", version: "0.0.0" },
    });
    mcp.notify("notifications/initialized");
    const { tools } = await mcp.request("tools/list");
    if (!tools.some((t) => t.name === "search_images"))
      throw new Error("server has no search_images tool");
    const res = await mcp.request("tools/call", {
      name: "search_images",
      arguments: { query, providers, licensePolicy, maxPerProvider: 5 },
    });
    if (res.isError) throw new Error(res.content?.[0]?.text ?? "search_images failed");
    const { results = [], providerReports = [] } = res.structuredContent ?? {};
    return {
      server: init.serverInfo,
      toolCount: tools.length,
      providers: providerReports.map((r) => ({ provider: r.provider, ok: r.ok, count: r.count })),
      images: results.map((c) => ({
        url: c.url,
        license: c.license,
        attribution: c.attributionLine ?? null,
        sourcePageUrl: c.sourcePageUrl ?? null,
      })),
    };
  } finally {
    mcp.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.query) {
    console.error(
      'usage: node examples/mcp-stdio-agent/agent.mjs "<query>" [--server "<cmd>"] [--providers a,b] [--license open-only]',
    );
    process.exit(2);
  }
  const out = await findImages(opts);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.images.length > 0 ? 0 : 1);
}
