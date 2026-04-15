/**
 * Thin client for the @webfetch/server HTTP API.
 *
 * Reads {serverUrl, token} from chrome.storage.local on every call so the
 * options page can update either without reloading anything.
 */

export interface Settings {
  serverUrl: string;
  token: string;
  defaultPolicy: "safe-only" | "prefer-safe" | "any";
  defaultProviders: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: "https://api.getwebfetch.com",
  token: "",
  defaultPolicy: "safe-only",
  defaultProviders: [],
};

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get([
    "serverUrl",
    "token",
    "defaultPolicy",
    "defaultProviders",
  ]);
  return {
    serverUrl: (got.serverUrl as string) || DEFAULT_SETTINGS.serverUrl,
    token: (got.token as string) || "",
    defaultPolicy:
      (got.defaultPolicy as Settings["defaultPolicy"]) || DEFAULT_SETTINGS.defaultPolicy,
    defaultProviders: (got.defaultProviders as string[]) || [],
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

export interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status: number;
}

export async function call<T = unknown>(
  path: string,
  body?: unknown,
  method: "GET" | "POST" = "POST",
): Promise<ApiResult<T>> {
  const s = await loadSettings();
  if (!s.token) return { ok: false, error: "no token configured — open options", status: 0 };
  const url = s.serverUrl.replace(/\/+$/, "") + path;
  try {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${s.token}`,
        ...(body != null ? { "content-type": "application/json" } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: any = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { ok: false, error: text };
    }
    if (!res.ok)
      return { ok: false, error: parsed.error ?? `HTTP ${res.status}`, status: res.status };
    return { ok: true, data: parsed.data as T, status: res.status };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "network error", status: 0 };
  }
}

export async function ping(): Promise<boolean> {
  const r = await call("/health", undefined, "GET");
  return r.ok;
}
