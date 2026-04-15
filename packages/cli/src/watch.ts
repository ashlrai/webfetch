/**
 * `webfetch watch <query>` — poll a search on an interval, emit only NEW
 * candidates per tick. State is a JSON file keyed by sha256(query) so a
 * long-running watch (or a cron with `--once`) remembers what it has seen.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { ImageCandidate } from "@webfetch/core";

export interface WatchState {
  query: string;
  firstSeen: string; // ISO date
  lastSeen: string;
  urls: string[];
}

export function parseInterval(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s.trim());
  if (!m) throw new Error(`bad interval: ${s} (examples: 30s, 15m, 2h, 1d)`);
  const n = Number.parseInt(m[1]!, 10);
  const unit = m[2];
  switch (unit) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      throw new Error(`bad interval unit: ${unit}`);
  }
}

export function watchStatePath(query: string, env: NodeJS.ProcessEnv = process.env): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const hash = createHash("sha256").update(query).digest("hex").slice(0, 16);
  return resolve(home, ".webfetch", "watch", `${hash}.json`);
}

export async function readState(path: string): Promise<WatchState | undefined> {
  if (!existsSync(path)) return undefined;
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as WatchState;
}

export async function writeState(path: string, state: WatchState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");
}

export function diffNew(
  state: WatchState | undefined,
  candidates: ImageCandidate[],
): ImageCandidate[] {
  const seen = new Set(state?.urls ?? []);
  return candidates.filter((c) => !seen.has(c.url));
}

export function mergeState(
  prev: WatchState | undefined,
  query: string,
  candidates: ImageCandidate[],
): WatchState {
  const now = new Date().toISOString();
  const urls = Array.from(new Set([...(prev?.urls ?? []), ...candidates.map((c) => c.url)]));
  return {
    query,
    firstSeen: prev?.firstSeen ?? now,
    lastSeen: now,
    urls,
  };
}
