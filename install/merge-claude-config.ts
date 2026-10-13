#!/usr/bin/env bun
/**
 * Register the webfetch MCP server with Claude Code (user scope).
 *
 * Claude Code reads user-scoped MCP servers from the top-level `mcpServers`
 * key of ~/.claude.json (or $CLAUDE_CONFIG_DIR/.claude.json). It silently
 * ignores `mcpServers` in ~/.claude/settings.json, which is where earlier
 * versions of install.sh wrote the entry.
 *
 * Usage: bun install/merge-claude-config.ts <command> [args...]
 *   e.g. bun install/merge-claude-config.ts /usr/local/bin/bun run ~/.webfetch/repo/packages/mcp/src/index.ts
 *
 * Idempotent, keeps every other key in the file, keeps a user-set `env`
 * block on an existing webfetch entry, and writes a timestamped .bak first.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function claudeConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const dir = env.CLAUDE_CONFIG_DIR || env.HOME || homedir();
  return join(dir, ".claude.json");
}

export function legacySettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.HOME || homedir(), ".claude", "settings.json");
}

export type MergeResult = { status: "created" | "updated" | "unchanged"; path: string };

export function mergeWebfetchEntry(path: string, entry: McpEntry): MergeResult {
  let json: Record<string, any> = {};
  const existed = existsSync(path);
  if (existed) {
    const raw = readFileSync(path, "utf8");
    try {
      json = raw.trim() ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`${path} is not valid JSON; refusing to overwrite it.`);
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      throw new Error(`${path} is not a JSON object; refusing to overwrite it.`);
    }
  }
  const servers: Record<string, any> = json.mcpServers ?? {};
  const prev = servers.webfetch;
  const next: McpEntry = {
    command: entry.command,
    args: entry.args,
    ...(prev?.env ? { env: prev.env } : entry.env ? { env: entry.env } : {}),
  };
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return { status: "unchanged", path };
  if (existed) copyFileSync(path, `${path}.bak.${Date.now()}`);
  json.mcpServers = { ...servers, webfetch: next };
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  return { status: existed ? "updated" : "created", path };
}

/** True when the legacy (ignored) ~/.claude/settings.json still has a webfetch entry. */
export function hasLegacyEntry(path: string): boolean {
  try {
    return !!JSON.parse(readFileSync(path, "utf8"))?.mcpServers?.webfetch;
  } catch {
    return false;
  }
}

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error("usage: merge-claude-config.ts <command> [args...]");
    process.exit(2);
  }
  try {
    const res = mergeWebfetchEntry(claudeConfigPath(), { command, args });
    console.log(`${res.status} webfetch MCP entry in ${res.path}`);
    const legacy = legacySettingsPath();
    if (hasLegacyEntry(legacy)) {
      console.log(
        `note: ${legacy} also has mcpServers.webfetch from an older installer. Claude Code ignores it; you can delete that key.`,
      );
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
