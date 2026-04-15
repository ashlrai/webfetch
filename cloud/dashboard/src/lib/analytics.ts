/**
 * Dashboard analytics adapter (PostHog).
 *
 * Principles:
 *   - Opt-in ONLY. Default is disabled. User must toggle in Settings.
 *   - Honors DNT (`navigator.doNotTrack`) and GPC (`navigator.globalPrivacyControl`).
 *   - Consent persisted in localStorage AND mirrored server-side on the user
 *     profile via a supplied `syncConsent` callback.
 *   - Event allow-list. Unknown events are silently dropped.
 *   - No raw URLs/querystrings. Events carry structured properties only.
 *
 * This module never imports `posthog-js` eagerly. It is dynamically
 * imported on first `init()` call AFTER consent is confirmed. In tests
 * inject a `PostHogLike` via `init({ client })`.
 */

export const ANALYTICS_EVENTS = [
  "sign_up",
  "create_api_key",
  "first_fetch",
  "upgrade_initiated",
  "upgrade_completed",
  "team_invite_sent",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export type AnalyticsProps = Record<string, string | number | boolean>;

export interface PostHogLike {
  init(apiKey: string, options?: Record<string, unknown>): void;
  capture(event: string, props?: AnalyticsProps): void;
  identify(distinctId: string, props?: AnalyticsProps): void;
  reset(): void;
  opt_in_capturing?(): void;
  opt_out_capturing?(): void;
}

export interface NavigatorLike {
  doNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}

export interface AnalyticsEnv {
  /** Reads a localStorage-like store. */
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** DNT/GPC source. */
  nav?: NavigatorLike;
  /** Test-injected PostHog client. */
  client?: PostHogLike;
  /** PostHog project API key. */
  apiKey?: string;
  /** PostHog host, e.g. self-hosted. */
  host?: string;
  /** Called when consent changes, to mirror to the server profile. */
  syncConsent?: (enabled: boolean) => Promise<void> | void;
}

const STORAGE_KEY = "webfetch.analytics.consent";

function privacyHintsRespected(nav?: NavigatorLike): boolean {
  if (!nav) return false;
  if (nav.doNotTrack === "1") return true;
  if (nav.globalPrivacyControl === true) return true;
  return false;
}

function readConsent(env: AnalyticsEnv): boolean {
  if (privacyHintsRespected(env.nav)) return false;
  const v = env.storage?.getItem(STORAGE_KEY);
  return v === "true";
}

export function hasConsent(env: AnalyticsEnv = {}): boolean {
  return readConsent(env);
}

export async function setConsent(enabled: boolean, env: AnalyticsEnv = {}): Promise<void> {
  if (enabled && privacyHintsRespected(env.nav)) {
    // Refuse to enable while DNT/GPC is active.
    enabled = false;
  }
  env.storage?.setItem(STORAGE_KEY, enabled ? "true" : "false");
  if (env.syncConsent) await env.syncConsent(enabled);
  if (client) {
    if (enabled) client.opt_in_capturing?.();
    else client.opt_out_capturing?.();
  }
}

let client: PostHogLike | null = null;
let initialized = false;

async function loadPostHog(): Promise<PostHogLike | null> {
  try {
    const mod = (await import(/* @vite-ignore */ "posthog-js" as string)) as unknown as {
      default?: PostHogLike;
    } & PostHogLike;
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export async function initAnalytics(env: AnalyticsEnv = {}): Promise<PostHogLike | null> {
  if (!readConsent(env)) return null;
  if (initialized && client) return client;

  const ph = env.client ?? (await loadPostHog());
  if (!ph) return null;

  ph.init(env.apiKey ?? "", {
    api_host: env.host ?? "https://us.i.posthog.com",
    autocapture: false,
    capture_pageview: false,
    disable_session_recording: true,
    mask_all_text: true,
    mask_all_element_attributes: true,
    respect_dnt: true,
    persistence: "localStorage",
    ip: false,
  });

  client = ph;
  initialized = true;
  return ph;
}

function isAllowed(name: string): name is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(name);
}

export function track(
  event: AnalyticsEvent,
  props: AnalyticsProps = {},
  env: AnalyticsEnv = {},
): void {
  if (!readConsent(env)) return;
  if (!isAllowed(event)) return;
  const c = env.client ?? client;
  if (!c) return;
  c.capture(event, props);
}

export function identify(
  distinctId: string,
  props: AnalyticsProps = {},
  env: AnalyticsEnv = {},
): void {
  if (!readConsent(env)) return;
  const c = env.client ?? client;
  if (!c) return;
  c.identify(distinctId, props);
}

export function resetAnalytics(env: AnalyticsEnv = {}): void {
  const c = env.client ?? client;
  c?.reset();
  env.storage?.removeItem(STORAGE_KEY);
  client = null;
  initialized = false;
}

export const __internal = { STORAGE_KEY, privacyHintsRespected };
