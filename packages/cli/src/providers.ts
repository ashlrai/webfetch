/**
 * Provider auth discovery. Maps env vars to the `ProviderAuth` bag the core
 * federation layer expects, and exposes per-provider auth/default metadata
 * used by `webfetch providers`.
 */

import type { ProviderAuth, ProviderId } from "@webfetch/core";
import { core } from "./core.ts";

export interface ProviderEnvRow {
  id: ProviderId;
  envVars: string[];
  requiresAuth: boolean;
  optIn: boolean;
  defaultOn: boolean;
  authed: boolean;
}

const PROVIDER_ENV: Record<ProviderId, string[]> = {
  wikimedia: [],
  openverse: [],
  unsplash: ["UNSPLASH_ACCESS_KEY"],
  pexels: ["PEXELS_API_KEY"],
  pixabay: ["PIXABAY_API_KEY"],
  itunes: [],
  "musicbrainz-caa": [],
  spotify: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
  "youtube-thumb": [],
  brave: ["BRAVE_API_KEY"],
  bing: ["BING_API_KEY"],
  serpapi: ["SERPAPI_KEY"],
  browser: [],
  flickr: ["FLICKR_API_KEY"],
  "internet-archive": [],
  smithsonian: ["SMITHSONIAN_API_KEY"],
  nasa: [],
  "met-museum": [],
  europeana: ["EUROPEANA_API_KEY"],
};

export function authFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderAuth {
  return {
    unsplashAccessKey: env.UNSPLASH_ACCESS_KEY,
    pexelsApiKey: env.PEXELS_API_KEY,
    pixabayApiKey: env.PIXABAY_API_KEY,
    braveApiKey: env.BRAVE_API_KEY,
    bingApiKey: env.BING_API_KEY,
    serpApiKey: env.SERPAPI_KEY,
    spotifyClientId: env.SPOTIFY_CLIENT_ID,
    spotifyClientSecret: env.SPOTIFY_CLIENT_SECRET,
    userAgent: env.WEBFETCH_USER_AGENT ?? "webfetch-cli/0.1 (+https://github.com/)",
  };
}

export function listProviders(env: NodeJS.ProcessEnv = process.env): ProviderEnvRow[] {
  const { ALL_PROVIDERS, DEFAULT_PROVIDERS } = core();
  const defaultSet = new Set(DEFAULT_PROVIDERS);
  const rows: ProviderEnvRow[] = [];
  for (const id of Object.keys(ALL_PROVIDERS) as ProviderId[]) {
    const p = ALL_PROVIDERS[id];
    const envVars = PROVIDER_ENV[id] ?? [];
    const authed = envVars.length === 0 ? true : envVars.every((v) => !!env[v]);
    rows.push({
      id,
      envVars,
      requiresAuth: p.requiresAuth,
      optIn: !!p.optIn,
      defaultOn: defaultSet.has(id),
      authed,
    });
  }
  return rows;
}

export function missingAuthWarnings(
  requested: ProviderId[],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const warnings: string[] = [];
  for (const id of requested) {
    const vars = PROVIDER_ENV[id] ?? [];
    const missing = vars.filter((v) => !env[v]);
    if (missing.length > 0) {
      warnings.push(`provider ${id}: missing env ${missing.join(", ")} — will be skipped`);
    }
  }
  return warnings;
}
