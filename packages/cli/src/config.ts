/**
 * `~/.webfetchrc` loader + profile resolver.
 *
 * Resolution precedence (highest wins):
 *   CLI flag  >  env var  >  active profile  >  top-level defaults  >  built-in default
 *
 * JSON format (zero-dep). Comments (`//` and `/* *\/`) are stripped before parse
 * so the file can contain the jsonc-style starter we ship.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { ProviderId } from "@webfetch/core";

export interface ResolvedDefaults {
  providers?: ProviderId[];
  license?: "safe-only" | "prefer-safe" | "any" | "safe" | "prefer";
  limit?: number;
  minWidth?: number;
  minHeight?: number;
  maxPerProvider?: number;
  outDir?: string;
  sidecar?: boolean;
}

export interface ConfigFile {
  defaults?: ResolvedDefaults;
  profiles?: Record<string, ResolvedDefaults>;
}

export interface ResolvedConfig extends ResolvedDefaults {
  /** Profile name if active. */
  profile?: string;
  /** Source path if loaded from disk. */
  path?: string;
}

export const BUILTIN_DEFAULTS: ResolvedDefaults = {
  license: "safe-only",
  limit: 20,
  sidecar: true,
};

export const STARTER_CONFIG = `{
  // ~/.webfetchrc — webfetch CLI user config.
  // Resolution order: CLI flag > env var > active profile > defaults > built-in.
  // Activate a profile with: webfetch <cmd> --profile editorial
  "defaults": {
    "providers": ["wikimedia", "openverse", "itunes"],
    "license": "safe-only",
    "limit": 10,
    "minWidth": 800,
    "outDir": "~/Pictures/webfetch"
  },
  "profiles": {
    "editorial": {
      "providers": ["unsplash", "pexels"],
      "minWidth": 1600
    },
    "musicians": {
      "providers": ["wikimedia", "openverse", "itunes", "spotify"],
      "license": "safe-only"
    }
  }
}
`;

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.WEBFETCH_CONFIG) return env.WEBFETCH_CONFIG;
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  return resolve(home, ".webfetchrc");
}

export function expandHome(p: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (!p) return p;
  if (p.startsWith("~/") || p === "~") {
    const home = env.HOME ?? env.USERPROFILE ?? homedir();
    return resolve(home, p.slice(2));
  }
  return p;
}

/** Strip `//line` and `/* block *\/` comments. Preserves strings. */
export function stripJsonComments(src: string): string {
  let out = "";
  let i = 0;
  let inStr = false;
  let strCh = "";
  while (i < src.length) {
    const ch = src[i]!;
    const nx = src[i + 1];
    if (inStr) {
      out += ch;
      if (ch === "\\" && i + 1 < src.length) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === strCh) inStr = false;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      strCh = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && nx === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && nx === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export async function loadConfigFile(path?: string, env: NodeJS.ProcessEnv = process.env): Promise<ConfigFile | undefined> {
  const p = path ?? defaultConfigPath(env);
  if (!existsSync(p)) return undefined;
  const raw = await readFile(p, "utf8");
  const stripped = stripJsonComments(raw);
  try {
    return JSON.parse(stripped) as ConfigFile;
  } catch (e) {
    throw new Error(`failed to parse config at ${p}: ${(e as Error).message}`);
  }
}

/** Merge built-in < top-level defaults < profile. CLI/env overlay is applied elsewhere. */
export function resolveConfig(file: ConfigFile | undefined, profile?: string): ResolvedConfig {
  const base = { ...BUILTIN_DEFAULTS };
  if (!file) return base;
  const merged: ResolvedConfig = { ...base, ...(file.defaults ?? {}) };
  if (profile) {
    const p = file.profiles?.[profile];
    if (!p) throw new Error(`unknown profile: ${profile}`);
    Object.assign(merged, p);
    merged.profile = profile;
  }
  return merged;
}

export async function loadResolved(opts: { profile?: string; path?: string; env?: NodeJS.ProcessEnv } = {}): Promise<ResolvedConfig> {
  const env = opts.env ?? process.env;
  const p = opts.path ?? defaultConfigPath(env);
  const file = await loadConfigFile(p, env);
  const r = resolveConfig(file, opts.profile);
  if (file) r.path = p;
  return r;
}

export async function writeStarterConfig(path: string, force: boolean): Promise<void> {
  if (existsSync(path) && !force) {
    throw new Error(`config already exists at ${path} (use --force to overwrite)`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, STARTER_CONFIG, "utf8");
}
