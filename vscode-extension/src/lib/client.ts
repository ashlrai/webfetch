/**
 * REST client for the webfetch HTTP API (packages/server/src/routes.ts).
 *
 * Same bearer-token + `{ ok, data }` envelope used by the Chrome extension.
 * Accepts either api.getwebfetch.com or a self-hosted http://127.0.0.1:7600.
 */

import type * as vscode from "vscode";
import type {
  ImageCandidate,
  LicensePolicy,
  ProviderId,
  ProvidersResponse,
  SearchResponse,
} from "../types";

export interface CallResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  status: number;
}

const VERSIONED_PATHS = new Set([
  "/search",
  "/artist",
  "/album",
  "/download",
  "/probe",
  "/license",
  "/similar",
]);

export function apiPathForBase(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedPath.startsWith("/v1/")) return normalizedPath;
  if (!VERSIONED_PATHS.has(normalizedPath)) return normalizedPath;

  try {
    const base = new URL(baseUrl);
    if (base.pathname.replace(/\/+$/, "").endsWith("/v1")) return normalizedPath;
    if (base.hostname.toLowerCase() === "api.getwebfetch.com") return `/v1${normalizedPath}`;
  } catch {
    // Invalid base URLs will fail in fetch; keep path handling conservative.
  }
  return normalizedPath;
}

export function buildApiUrl(baseUrl: string, path: string): string {
  return baseUrl.replace(/\/+$/, "") + apiPathForBase(baseUrl, path);
}

async function call<T = unknown>(
  context: vscode.ExtensionContext,
  path: string,
  body?: unknown,
  method: "GET" | "POST" = "POST",
): Promise<CallResult<T>> {
  const { loadSettings } = await import("./settings");
  const s = await loadSettings(context);
  if (!s.apiKey) {
    return { ok: false, error: "no API key configured — run 'webfetch: Set API Key'", status: 0 };
  }
  const url = buildApiUrl(s.baseUrl, path);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${s.apiKey}`,
        accept: "application/json",
        ...(body != null ? { "content-type": "application/json" } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const text = await res.text();
    let parsed: any = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { ok: false, error: text };
    }
    if (!res.ok) {
      return { ok: false, error: parsed.error ?? `HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, data: parsed.data as T, status: res.status };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "network error", status: 0 };
  }
}

export async function ping(context: vscode.ExtensionContext): Promise<CallResult<unknown>> {
  return call(context, "/health", undefined, "GET");
}

export async function getProviders(
  context: vscode.ExtensionContext,
): Promise<CallResult<ProvidersResponse>> {
  return call<ProvidersResponse>(context, "/providers", undefined, "GET");
}

export interface SearchArgs {
  query: string;
  licensePolicy?: LicensePolicy;
  providers?: ProviderId[];
  maxPerProvider?: number;
}

export async function search(
  context: vscode.ExtensionContext,
  args: SearchArgs,
): Promise<CallResult<SearchResponse>> {
  return call<SearchResponse>(context, "/search", args, "POST");
}

/**
 * Download bytes from an image URL directly (we stream client-side so the
 * user's editor workspace owns the file). We don't use /download because that
 * caches on the server; the extension wants the bytes locally.
 */
export async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const mime =
      res.headers.get("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream";
    return { bytes: buf, mime };
  } finally {
    clearTimeout(timer);
  }
}

export function licenseBadgeColor(license: ImageCandidate["license"]): string {
  switch (license) {
    case "CC0":
    case "PUBLIC_DOMAIN":
      return "#16a34a";
    case "CC_BY":
    case "CC_BY_SA":
      return "#2563eb";
    case "PRESS_KIT_ALLOWLIST":
      return "#7c3aed";
    case "EDITORIAL_LICENSED":
      return "#d97706";
    default:
      return "#6b7280";
  }
}
