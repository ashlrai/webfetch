import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeConfigPath,
  hasLegacyEntry,
  mergeWebfetchEntry,
} from "../install/merge-claude-config.ts";

let dir: string;
let file: string;
const entry = { command: "/usr/local/bin/bun", args: ["run", "/r/packages/mcp/src/index.ts"] };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wf-claude-"));
  file = join(dir, ".claude.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("install/merge-claude-config", () => {
  test("targets ~/.claude.json, honoring CLAUDE_CONFIG_DIR", () => {
    expect(claudeConfigPath({ HOME: "/h" })).toBe("/h/.claude.json");
    expect(claudeConfigPath({ HOME: "/h", CLAUDE_CONFIG_DIR: "/c" })).toBe("/c/.claude.json");
  });

  test("creates the file when missing", () => {
    expect(mergeWebfetchEntry(file, entry).status).toBe("created");
    expect(JSON.parse(readFileSync(file, "utf8")).mcpServers.webfetch).toEqual(entry);
  });

  test("preserves unrelated keys and servers, keeps user env, backs up", () => {
    writeFileSync(
      file,
      JSON.stringify({
        numStartups: 3,
        oauthAccount: { id: "x" },
        mcpServers: {
          other: { command: "o", args: [] },
          webfetch: { command: "old", args: [], env: { PEXELS_API_KEY: "k" } },
        },
      }),
    );
    expect(mergeWebfetchEntry(file, entry).status).toBe("updated");
    const json = JSON.parse(readFileSync(file, "utf8"));
    expect(json.numStartups).toBe(3);
    expect(json.oauthAccount).toEqual({ id: "x" });
    expect(json.mcpServers.other).toEqual({ command: "o", args: [] });
    expect(json.mcpServers.webfetch).toEqual({ ...entry, env: { PEXELS_API_KEY: "k" } });
    expect(readdirSync(dir).some((f) => f.startsWith(".claude.json.bak."))).toBe(true);
  });

  test("is idempotent (second run is a no-op without a new backup)", () => {
    mergeWebfetchEntry(file, entry);
    expect(mergeWebfetchEntry(file, entry).status).toBe("unchanged");
    expect(readdirSync(dir).filter((f) => f.includes(".bak.")).length).toBe(0);
  });

  test("refuses to overwrite invalid JSON", () => {
    writeFileSync(file, "{ not json");
    expect(() => mergeWebfetchEntry(file, entry)).toThrow(/not valid JSON/);
    expect(readFileSync(file, "utf8")).toBe("{ not json");
  });

  test("detects a legacy entry in ~/.claude/settings.json", () => {
    const legacy = join(dir, "settings.json");
    expect(hasLegacyEntry(legacy)).toBe(false);
    writeFileSync(legacy, JSON.stringify({ mcpServers: { webfetch: entry } }));
    expect(hasLegacyEntry(legacy)).toBe(true);
    expect(existsSync(file)).toBe(false);
  });
});
