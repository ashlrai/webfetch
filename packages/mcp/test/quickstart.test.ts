/**
 * Keeps the quickstart honest:
 *  - every MCP config snippet in integrations/ and the install docs parses,
 *    launches a bin this package actually ships, and only sets env vars some
 *    provider really reads (catches typos like UNSPLASH_API_KEY);
 *  - the server starts over real stdio exactly the way a client spawns it and
 *    answers initialize / tools/list / tools/call.
 *
 * Set WEBFETCH_NPX_SMOKE=1 to also spawn the *published* `npx -y getwebfetch-mcp`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = join(import.meta.dir, "..", "..", "..");
const MCP_PKG = JSON.parse(readFileSync(join(ROOT, "packages/mcp/package.json"), "utf8"));
const BINS = Object.keys(MCP_PKG.bin as Record<string, string>);

/** Every env var any code path reads for provider auth. */
const KNOWN_ENV = new Set(
  [
    ...readFileSync(join(ROOT, "packages/core/src/providers/index.ts"), "utf8").matchAll(
      /"([A-Z][A-Z0-9_]+)"/g,
    ),
  ].map((m) => m[1]!),
);
for (const extra of ["RAWPIXEL_API_KEY", "BRIGHTDATA_ZONE", "WEBFETCH_USER_AGENT"])
  KNOWN_ENV.add(extra);

type Entry = { command: string; args: string[]; env?: Record<string, string> };

function findEntries(json: any): Entry[] {
  const out: Entry[] = [];
  if (json?.mcpServers?.webfetch) out.push(json.mcpServers.webfetch);
  for (const s of json?.experimental?.modelContextProtocolServers ?? []) out.push(s.transport);
  return out;
}

function jsonBlocks(md: string): string[] {
  return [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);
}

const snippetFiles = readdirSync(join(ROOT, "integrations"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) =>
    readdirSync(join(ROOT, "integrations", d.name))
      .filter((f) => f.endsWith(".json"))
      .map((f) => join("integrations", d.name, f)),
  );

const docFiles = [
  "docs/QUICKSTART.md",
  "docs/INSTALL_CLAUDE_CODE.md",
  "docs/INSTALL_CURSOR.md",
  "docs/INSTALL_CLINE.md",
  "packages/mcp/README.md",
];

function assertLaunchable(where: string, e: Entry) {
  const cmd = e.command;
  if (cmd === "npx") {
    expect(e.args[0], `${where}: npx needs -y so it never prompts`).toBe("-y");
    expect(BINS, `${where}: npx target`).toContain(e.args[1]!);
  } else if (cmd === "bunx") {
    expect(BINS, `${where}: bunx target`).toContain(e.args[0]!);
  } else {
    throw new Error(`${where}: unexpected command ${cmd}`);
  }
  for (const k of Object.keys(e.env ?? {})) {
    expect(KNOWN_ENV.has(k), `${where}: env ${k} is not read by any provider`).toBe(true);
  }
}

describe("quickstart snippets", () => {
  test("package publishes the bin the docs use", () => {
    expect(MCP_PKG.name).toBe("getwebfetch-mcp");
    expect(BINS).toContain("getwebfetch-mcp");
  });

  test("found the snippet files", () => {
    expect(snippetFiles).toContain("integrations/claude-desktop/claude_desktop_config.json");
    expect(snippetFiles).toContain("integrations/cursor/mcp.json");
    expect(snippetFiles.length).toBeGreaterThanOrEqual(6);
  });

  for (const f of snippetFiles) {
    test(`${f} is a launchable config`, () => {
      const entries = findEntries(JSON.parse(readFileSync(join(ROOT, f), "utf8")));
      expect(entries.length, `${f}: no webfetch entry`).toBe(1);
      assertLaunchable(f, entries[0]!);
    });
  }

  for (const f of docFiles) {
    test(`${f} JSON blocks parse and launch a real bin`, () => {
      const blocks = jsonBlocks(readFileSync(join(ROOT, f), "utf8"));
      const entries = blocks.flatMap((b, i) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(b);
        } catch (err) {
          throw new Error(`${f} json block #${i + 1} does not parse: ${(err as Error).message}`);
        }
        return findEntries(parsed);
      });
      expect(entries.length, `${f}: no mcpServers.webfetch examples`).toBeGreaterThan(0);
      for (const e of entries) assertLaunchable(f, e);
    });
  }

  test("no doc points MCP config at ~/.claude/settings.json", () => {
    for (const f of [
      ...docFiles,
      "README.md",
      "integrations/README.md",
      "integrations/claude-code/README.md",
    ]) {
      const md = readFileSync(join(ROOT, f), "utf8");
      for (const para of md.split(/\n\s*\n/)) {
        if (para.includes(".claude/settings.json")) {
          expect(para, `${f}: ${para}`).toMatch(/ignore|not\*\*? read|isn't read|older/i);
        }
      }
    }
  });
});

async function smoke(command: string, args: string[], cwd: string) {
  const transport = new StdioClientTransport({
    command,
    args,
    cwd,
    env: { ...(process.env as Record<string, string>), UNSPLASH_ACCESS_KEY: "" },
    stderr: "pipe",
  });
  const client = new Client({ name: "quickstart-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    expect(client.getServerVersion()?.name).toBe("webfetch");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("search_images");
    const res = await client.callTool({
      name: "search_images",
      arguments: { query: "x", providers: [] },
    });
    expect(res.isError).toBeFalsy();
  } finally {
    await client.close();
  }
}

describe("quickstart stdio launch", () => {
  test("from source: bun run packages/mcp/src/index.ts", async () => {
    await smoke(process.execPath, ["run", join(ROOT, "packages/mcp/src/index.ts")], ROOT);
  }, 30_000);

  test.skipIf(process.env.WEBFETCH_NPX_SMOKE !== "1")(
    "published: npx -y getwebfetch-mcp",
    async () => {
      await smoke("npx", ["-y", "getwebfetch-mcp"], "/tmp");
    },
    120_000,
  );
});
