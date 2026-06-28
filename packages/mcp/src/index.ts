#!/usr/bin/env bun
/**
 * MCP stdio server entrypoint.
 *
 * Wires the tool set from tools.ts to @ashlr/mcp-kit. Run via:
 *   bun run packages/mcp/src/index.ts
 * or as a bin after install:
 *   webfetch-mcp
 */

import { registerToolBatch, runStdioServer } from "@ashlr/mcp-kit";
import { readFileSync } from "node:fs";
import { TOOLS } from "./tools.ts";
import { zodToJsonSchema } from "./zod-json.ts";

function packageVersion(): string {
  try {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

registerToolBatch(
  TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
    handler: async (args) => {
      const parsed = t.inputSchema.parse(args);
      return t.handler(parsed) as any;
    },
  })),
);

await runStdioServer({ name: "webfetch", version: packageVersion() });
