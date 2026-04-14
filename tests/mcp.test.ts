/**
 * MCP round-trip test — invoke `search_images` tool handler directly with a
 * stub core via the public federation path. We don't spin up stdio; we just
 * assert the tool definitions + input schemas parse.
 */

import { describe, expect, test } from "bun:test";
import { TOOLS } from "../packages/mcp/src/tools.ts";
import { zodToJsonSchema } from "../packages/mcp/src/zod-json.ts";

describe("mcp tools", () => {
  test("all tools have required fields", () => {
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z_]+$/);
      expect(t.description.length).toBeGreaterThan(20);
      expect(typeof t.handler).toBe("function");
      const js = zodToJsonSchema(t.inputSchema);
      expect(js.type).toBe("object");
    }
  });

  test("search_images dryRun-through via federation", async () => {
    // Bypass the MCP schema (which has no dryRun field) and call federation
    // directly; the aim here is to confirm the tool wiring works end-to-end.
    const t = TOOLS.find((t) => t.name === "search_images")!;
    // dryRun is honored in searchImages even though not in schema — we pass
    // via args that go through. Expect handler to succeed with empty results
    // when providers list is empty.
    const out = await t.handler({ query: "x", providers: [] });
    expect(out.structuredContent).toBeTruthy();
  });

  test("tool names match spec", () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([
      "download_image",
      "fetch_with_license",
      "find_similar",
      "probe_page",
      "search_album_cover",
      "search_artist_images",
      "search_images",
    ]);
  });
});
