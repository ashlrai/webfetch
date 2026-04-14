#!/usr/bin/env bun
/**
 * MCP stdio server entrypoint.
 *
 * Wires the tool set from tools.ts to `@modelcontextprotocol/sdk`. Run via:
 *   bun run packages/mcp/src/index.ts
 * or as a bin after install:
 *   webfetch-mcp
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "./zod-json.ts";
import { TOOLS } from "./tools.ts";

const server = new Server(
  { name: "webfetch", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = TOOLS.find((t) => t.name === req.params.name);
  if (!tool) {
    return { content: [{ type: "text", text: `unknown tool: ${req.params.name}` }], isError: true };
  }
  try {
    const parsed = tool.inputSchema.parse(req.params.arguments ?? {});
    const out = await tool.handler(parsed);
    return out as any;
  } catch (e) {
    const msg = (e as Error).message ?? "unknown error";
    return { content: [{ type: "text", text: `error: ${msg}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
