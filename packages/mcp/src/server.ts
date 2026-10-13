/**
 * MCP server factory built directly on the official @modelcontextprotocol/sdk.
 *
 * Kept separate from the stdio entrypoint (index.ts) so tests can connect an
 * in-memory client and exercise tools/list + tools/call end to end.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { TOOLS, type ToolDef } from "./tools.ts";
import { zodToJsonSchema } from "./zod-json.ts";

export interface CreateServerOptions {
  name?: string;
  version?: string;
  tools?: ToolDef[];
}

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function formatZodError(tool: string, err: ZodError): string {
  const issues = err.issues
    .map((i) => `- ${i.path.length ? i.path.join(".") : "(input)"}: ${i.message}`)
    .join("\n");
  return `Invalid arguments for ${tool}:\n${issues}`;
}

/**
 * Stderr notices printed once at startup. stdout is the JSON-RPC channel, so
 * these never go there. Clients such as Claude Desktop and Cursor show stderr
 * in their MCP logs.
 */
export function startupNotices(env: Record<string, string | undefined> = process.env): string[] {
  const notes: string[] = [];
  if (env.WEBFETCH_API_KEY) {
    notes.push(
      "webfetch-mcp: WEBFETCH_API_KEY is set, but the MCP server runs providers locally and does not use it. " +
        "Set provider keys (UNSPLASH_ACCESS_KEY, PEXELS_API_KEY, BRAVE_API_KEY, ...) in this server's env instead, " +
        "or use the CLI with --cloud for hosted search.",
    );
  }
  return notes;
}

export function createServer(opts: CreateServerOptions = {}): Server {
  const tools = opts.tools ?? TOOLS;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const listed = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema),
  }));

  const server = new Server(
    { name: opts.name ?? "webfetch", version: opts.version ?? "0.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const tool = byName.get(req.params.name);
    if (!tool) return errorResult(`Unknown tool: ${req.params.name}`);
    const parsed = tool.inputSchema.safeParse(req.params.arguments ?? {});
    if (!parsed.success) return errorResult(formatZodError(tool.name, parsed.error));
    try {
      return (await tool.handler(parsed.data)) as CallToolResult;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult(`${tool.name} failed: ${msg}`);
    }
  });

  return server;
}
