/**
 * End-to-end MCP protocol test: connect an SDK client to createServer() over
 * an in-memory transport and exercise tools/list + tools/call.
 */

import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";
import { TOOLS } from "../src/tools.ts";

async function connect() {
  const server = createServer({ name: "webfetch-test", version: "9.9.9" });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return { client, server };
}

describe("mcp server (sdk)", () => {
  test("reports server info and lists every tool with a JSON schema", async () => {
    const { client } = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: "webfetch-test", version: "9.9.9" });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const t of tools) expect(t.inputSchema.type).toBe("object");
    await client.close();
  });

  test("tools/call runs the handler", async () => {
    const { client } = await connect();
    const res = await client.callTool({
      name: "search_images",
      arguments: { query: "x", providers: [] },
    });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toBeTruthy();
    await client.close();
  });

  test("invalid arguments return isError with the offending field", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "search_images", arguments: {} });
    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[])[0]!.text;
    expect(text).toContain("Invalid arguments for search_images");
    expect(text).toContain("query");
    await client.close();
  });

  test("unknown tool returns isError", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "nope", arguments: {} });
    expect(res.isError).toBe(true);
    await client.close();
  });
});
