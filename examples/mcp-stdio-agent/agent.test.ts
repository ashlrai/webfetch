/**
 * Runs the zero-dependency MCP client against this checkout's real stdio
 * server. `providers: []` keeps it offline: the handshake, tool discovery and
 * tools/call round-trip are real, only the provider fan-out is empty.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
// @ts-expect-error: plain .mjs example without type declarations
import { connect, findImages, parseArgs } from "./agent.mjs";

const server = `${process.execPath} ${resolve(import.meta.dir, "../../packages/mcp/src/index.ts")}`;

describe("mcp-stdio-agent recipe", () => {
  test("parseArgs picks up query and flags", () => {
    const a = parseArgs(["red panda", "--providers", "wikimedia,nasa", "--license", "safe-only"]);
    expect(a.query).toBe("red panda");
    expect(a.providers).toEqual(["wikimedia", "nasa"]);
    expect(a.licensePolicy).toBe("safe-only");
  });

  test("handshake, tool discovery and search_images round-trip over stdio", async () => {
    const out = await findImages({
      query: "red panda",
      server,
      providers: [],
      licensePolicy: "open-only",
    });
    expect(out.server.name).toBe("webfetch");
    expect(out.toolCount).toBeGreaterThan(5);
    expect(Array.isArray(out.images)).toBe(true);
    expect(out.providers).toEqual([]);
  }, 30_000);

  test("invalid arguments surface as a tool error, not a crash", async () => {
    const mcp = connect(server);
    try {
      await mcp.request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t", version: "0" },
      });
      mcp.notify("notifications/initialized");
      const res = await mcp.request("tools/call", { name: "search_images", arguments: {} });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("query");
    } finally {
      mcp.close();
    }
  }, 30_000);
});
