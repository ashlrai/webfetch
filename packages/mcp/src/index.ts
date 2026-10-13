#!/usr/bin/env bun
/**
 * MCP stdio server entrypoint.
 *
 * Wires the tool set from tools.ts to the official @modelcontextprotocol/sdk
 * (see server.ts). Run via:
 *   bun run packages/mcp/src/index.ts
 * or as a bin after install:
 *   webfetch-mcp
 */

import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.ts";

function packageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const server = createServer({ name: "webfetch", version: packageVersion() });
await server.connect(new StdioServerTransport());
