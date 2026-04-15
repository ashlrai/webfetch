/**
 * Thin typed wrappers over vscode.workspace.getConfiguration("webfetch").
 * The API key is stored in SecretStorage (not settings) once the user runs
 * `webfetch: Set API Key` — legacy `webfetch.apiKey` setting is still honored
 * as a fallback for environments where secrets can't be used (devcontainers).
 */

import * as vscode from "vscode";
import type { LicensePolicy, ProviderId } from "../types";

export const CONFIG_SECTION = "webfetch";
export const SECRET_KEY = "webfetch.apiKey";

export interface WebfetchSettings {
  baseUrl: string;
  apiKey: string;
  defaultLicense: LicensePolicy;
  defaultProviders: ProviderId[];
  outputDir: string;
  writeXmpSidecar: boolean;
  attributionStyle: "html-comment" | "markdown-caption" | "none";
}

export async function loadSettings(context: vscode.ExtensionContext): Promise<WebfetchSettings> {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const secretKey = await context.secrets.get(SECRET_KEY);
  const inlineKey = cfg.get<string>("apiKey", "");
  return {
    baseUrl: (cfg.get<string>("baseUrl") ?? "https://api.getwebfetch.com").replace(/\/+$/, ""),
    apiKey: (secretKey && secretKey.length > 0 ? secretKey : inlineKey).trim(),
    defaultLicense: cfg.get<LicensePolicy>("defaultLicense", "safe-only"),
    defaultProviders: cfg.get<ProviderId[]>("defaultProviders", []),
    outputDir: cfg.get<string>("outputDir", "./assets"),
    writeXmpSidecar: cfg.get<boolean>("writeXmpSidecar", true),
    attributionStyle: cfg.get<"html-comment" | "markdown-caption" | "none">("attributionStyle", "html-comment"),
  };
}

export async function setApiKey(context: vscode.ExtensionContext, key: string): Promise<void> {
  if (key && key.length > 0) {
    await context.secrets.store(SECRET_KEY, key);
  } else {
    await context.secrets.delete(SECRET_KEY);
  }
}
