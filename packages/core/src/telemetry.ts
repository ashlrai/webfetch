/**
 * Opt-in, privacy-first telemetry for @webfetch/core.
 *
 * Defaults: OFF. Nothing is sent unless the user explicitly opts in via:
 *   1. Environment variable:  WEBFETCH_TELEMETRY=1
 *   2. Config file:           ~/.webfetch/config.json  ->  { "telemetry": true }
 *
 * Respects:
 *   - DNT (env DO_NOT_TRACK=1)
 *   - GPC (env GLOBAL_PRIVACY_CONTROL=1)
 *   - WEBFETCH_TELEMETRY=0 (hard off, overrides config)
 *
 * Payload fields are constrained to:
 *   - event name (allow-list)
 *   - anonymized install hash (sha256 of hostname + salt, truncated)
 *   - CLI/lib version (from caller)
 *   - OS platform family ("darwin" | "linux" | "win32" | "other")
 *   - arbitrary low-cardinality props (strings/numbers/bools; no PII)
 *
 * No IPs, user agents, file paths, URLs, queries, tokens, or emails are
 * ever included. The transport injects a fetcher at the seam so tests
 * can stub without touching the network.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir, hostname, platform } from "node:os";
import { join } from "node:path";

export const TELEMETRY_SALT = "webfetch.telemetry.v1";
export const DEFAULT_ENDPOINT = "https://plausible.io/api/event";
export const FALLBACK_ENDPOINT = "https://telemetry.webfetch.workers.dev/event";

export const ALLOWED_EVENTS = [
  "cli_invoked",
  "search_completed",
  "fetch_completed",
  "provider_error",
  "telemetry_enabled",
  "telemetry_disabled",
] as const;
export type TelemetryEvent = (typeof ALLOWED_EVENTS)[number];

export type TelemetryProps = Record<string, string | number | boolean>;

export type Fetcher = (url: string, init: RequestInit) => Promise<unknown>;

export interface TelemetryConfig {
  /** If true, telemetry is on. */
  telemetry?: boolean;
}

export interface TelemetryOptions {
  /** Product version string, e.g. package.json version. */
  version?: string;
  /** Override endpoint (tests, self-hosted Plausible). */
  endpoint?: string;
  /** Injected fetch implementation (defaults to globalThis.fetch). */
  fetcher?: Fetcher;
  /** Override config-file path (tests). */
  configPath?: string;
  /** Override env snapshot (tests). */
  env?: NodeJS.ProcessEnv;
  /** Override hostname (tests, determinism). */
  hostnameOverride?: string;
  /** Override platform (tests). */
  platformOverride?: NodeJS.Platform;
}

function defaultConfigPath(env: NodeJS.ProcessEnv): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  return join(home, ".webfetch", "config.json");
}

function readConfig(path: string): TelemetryConfig {
  try {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as TelemetryConfig;
  } catch {
    return {};
  }
}

export function isTelemetryEnabled(opts: TelemetryOptions = {}): boolean {
  const env = opts.env ?? process.env;
  // Honor explicit opt-outs first.
  if (env.WEBFETCH_TELEMETRY === "0") return false;
  if (env.DO_NOT_TRACK === "1") return false;
  if (env.GLOBAL_PRIVACY_CONTROL === "1") return false;

  if (env.WEBFETCH_TELEMETRY === "1") return true;

  const cfgPath = opts.configPath ?? defaultConfigPath(env);
  const cfg = readConfig(cfgPath);
  return cfg.telemetry === true;
}

export function installHash(opts: TelemetryOptions = {}): string {
  const host = opts.hostnameOverride ?? hostname();
  const hash = createHash("sha256").update(`${TELEMETRY_SALT}:${host}`).digest("hex");
  return hash.slice(0, 16);
}

function normalizePlatform(p: NodeJS.Platform): string {
  if (p === "darwin" || p === "linux" || p === "win32") return p;
  return "other";
}

function scrubProps(props: TelemetryProps): TelemetryProps {
  const out: TelemetryProps = {};
  for (const [k, v] of Object.entries(props)) {
    // Reject non-primitives and suspiciously long values that might be PII.
    if (typeof v === "string") {
      if (v.length > 128) continue;
      if (/@|https?:\/\/|[/\\]/.test(v)) continue;
      out[k] = v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    }
  }
  return out;
}

export interface TelemetryPayload {
  name: string;
  domain: string;
  url: string;
  props: TelemetryProps & {
    install: string;
    version: string;
    os: string;
  };
}

export function buildPayload(
  name: TelemetryEvent,
  props: TelemetryProps,
  opts: TelemetryOptions = {},
): TelemetryPayload {
  return {
    name,
    domain: "webfetch.cli",
    url: "app://webfetch/" + name,
    props: {
      ...scrubProps(props),
      install: installHash(opts),
      version: opts.version ?? "0.0.0",
      os: normalizePlatform(opts.platformOverride ?? platform()),
    },
  };
}

/**
 * Fire-and-forget event. Returns a promise resolving to `true` if dispatched,
 * `false` if suppressed (opted out, unknown event, transport missing).
 * Never throws.
 */
export async function trackEvent(
  name: TelemetryEvent,
  props: TelemetryProps = {},
  opts: TelemetryOptions = {},
): Promise<boolean> {
  if (!(ALLOWED_EVENTS as readonly string[]).includes(name)) return false;
  if (!isTelemetryEnabled(opts)) return false;

  const fetcher: Fetcher | undefined =
    opts.fetcher ?? (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : undefined);
  if (!fetcher) return false;

  const endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
  const payload = buildPayload(name, props, opts);

  try {
    await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return true;
  } catch {
    // Best-effort. Try fallback once.
    if (endpoint !== FALLBACK_ENDPOINT) {
      try {
        await fetcher(FALLBACK_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

/** Test-only helper: exported for unit tests. */
export const __internal = { readConfig, normalizePlatform, scrubProps, defaultConfigPath };
