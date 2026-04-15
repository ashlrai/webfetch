/**
 * CLI-side telemetry glue:
 *   - `webfetch telemetry enable|disable|status` subcommand
 *   - First-run opt-in prompt (defaults to NO)
 *   - `--telemetry` / `--no-telemetry` flag plumbing
 *
 * State is persisted at `~/.webfetch/config.json` with a single key
 * `"telemetry": boolean`. The file is loaded/merged rather than
 * overwritten so non-telemetry config is preserved.
 *
 * Nothing in this module performs a network call. All transport is
 * delegated to `@webfetch/core`'s `trackEvent`.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type TelemetryEvent,
  type TelemetryOptions,
  type TelemetryProps,
  isTelemetryEnabled as coreIsEnabled,
  trackEvent,
} from "@webfetch/core";

export type TelemetryState = "enabled" | "disabled" | "unset";

export interface CliTelemetryOptions extends TelemetryOptions {
  /** Override HOME for tests. */
  homeDir?: string;
  /** Injected stdin reader for the first-run prompt. */
  prompt?: (question: string) => Promise<string>;
  /** Injected writer for status output. */
  writer?: (line: string) => void;
}

function configPath(opts: CliTelemetryOptions): string {
  const home = opts.homeDir ?? opts.env?.HOME ?? opts.env?.USERPROFILE ?? homedir();
  return opts.configPath ?? join(home, ".webfetch", "config.json");
}

async function readConfigFile(path: string): Promise<Record<string, unknown>> {
  try {
    if (!existsSync(path)) return {};
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function writeConfigFile(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function getTelemetryState(opts: CliTelemetryOptions = {}): Promise<TelemetryState> {
  const cfg = await readConfigFile(configPath(opts));
  if (cfg.telemetry === true) return "enabled";
  if (cfg.telemetry === false) return "disabled";
  return "unset";
}

export async function setTelemetry(
  enabled: boolean,
  opts: CliTelemetryOptions = {},
): Promise<void> {
  const path = configPath(opts);
  const cfg = await readConfigFile(path);
  cfg.telemetry = enabled;
  await writeConfigFile(path, cfg);
}

/**
 * Implements `webfetch telemetry <subcommand>`. Returns process exit code.
 */
export async function runTelemetryCommand(
  subcommand: string | undefined,
  opts: CliTelemetryOptions = {},
): Promise<number> {
  const write = opts.writer ?? ((line: string) => process.stdout.write(`${line}\n`));
  switch (subcommand) {
    case "enable": {
      await setTelemetry(true, opts);
      write("Telemetry enabled. See docs/TELEMETRY.md for what is collected.");
      await trackEvent("telemetry_enabled", {}, opts);
      return 0;
    }
    case "disable": {
      await setTelemetry(false, opts);
      // Fire a best-effort final event if it was previously enabled.
      await trackEvent("telemetry_disabled", {}, opts);
      write("Telemetry disabled.");
      return 0;
    }
    case "status": {
      const state = await getTelemetryState(opts);
      const active = coreIsEnabled(opts);
      write(`telemetry: ${state}`);
      write(`active:    ${active ? "yes" : "no"}`);
      return 0;
    }
    default: {
      write("usage: webfetch telemetry <enable|disable|status>");
      return 2;
    }
  }
}

/**
 * Invoke on first run. Skipped when:
 *   - WEBFETCH_NO_FIRST_RUN_PROMPT=1
 *   - config already has a telemetry preference
 *   - stdin is not a TTY (non-interactive)
 */
export async function maybeFirstRunPrompt(opts: CliTelemetryOptions = {}): Promise<void> {
  const env = opts.env ?? process.env;
  if (env.WEBFETCH_NO_FIRST_RUN_PROMPT === "1") return;
  if (env.CI === "true" || env.CI === "1") return;
  const state = await getTelemetryState(opts);
  if (state !== "unset") return;

  const prompt = opts.prompt;
  if (!prompt) {
    // Non-interactive environments: default to disabled and persist.
    await setTelemetry(false, opts);
    return;
  }

  const answer = (
    await prompt("Optional: share anonymous usage to help prioritize providers? [y/N] ")
  )
    .trim()
    .toLowerCase();
  const yes = answer === "y" || answer === "yes";
  await setTelemetry(yes, opts);
}

/** Apply `--telemetry` / `--no-telemetry` CLI flags to the runtime env. */
export function applyTelemetryFlag(
  flag: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (flag === true) env.WEBFETCH_TELEMETRY = "1";
  else if (flag === false) env.WEBFETCH_TELEMETRY = "0";
}

/** Thin pass-through so callers don't both need to import from core. */
export async function track(
  name: TelemetryEvent,
  props: TelemetryProps = {},
  opts: TelemetryOptions = {},
): Promise<boolean> {
  return trackEvent(name, props, opts);
}
