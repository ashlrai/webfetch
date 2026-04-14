/**
 * Local copies of the shapes we care about from @webfetch/core.
 *
 * VS Code extensions can't reliably resolve workspace packages once published,
 * and @webfetch/core is not yet on npm, so we duplicate the public types here.
 * Keep in lockstep with `packages/core/src/types.ts`.
 */

export type License =
  | "CC0"
  | "PUBLIC_DOMAIN"
  | "CC_BY"
  | "CC_BY_SA"
  | "EDITORIAL_LICENSED"
  | "PRESS_KIT_ALLOWLIST"
  | "UNKNOWN";

export type LicensePolicy = "safe-only" | "prefer-safe" | "any";

export type ProviderId =
  | "wikimedia"
  | "openverse"
  | "unsplash"
  | "pexels"
  | "pixabay"
  | "itunes"
  | "musicbrainz-caa"
  | "spotify"
  | "youtube-thumb"
  | "brave"
  | "bing"
  | "serpapi"
  | "browser"
  | "flickr"
  | "internet-archive"
  | "smithsonian"
  | "nasa"
  | "met-museum"
  | "europeana";

export interface ImageCandidate {
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  mime?: string;
  byteSize?: number;
  source: string;
  sourcePageUrl?: string;
  title?: string;
  author?: string;
  license: License;
  licenseUrl?: string;
  attributionLine?: string;
  score?: number;
  confidence?: number;
  phash?: string;
  viaBrowserFallback?: boolean;
}

export interface ProviderReport {
  provider: ProviderId;
  ok: boolean;
  count: number;
  timeMs: number;
  error?: string;
  skipped?: "missing-auth" | "disabled" | "rate-limited" | "not-enabled";
}

export interface SearchResponse {
  candidates: ImageCandidate[];
  providerReports: ProviderReport[];
  warnings: string[];
}

export interface ProvidersResponse {
  all: string[];
  defaults: string[];
  endpoints: string[];
}

/** Messages exchanged between the webview and the host extension. */
export type WebviewOutbound =
  | { type: "ready" }
  | { type: "search"; query: string; policy: LicensePolicy; providers: ProviderId[] }
  | { type: "insert"; candidate: ImageCandidate; alt?: string }
  | { type: "download"; candidate: ImageCandidate; alt?: string }
  | { type: "dragStart"; candidate: ImageCandidate }
  | { type: "openExternal"; url: string }
  | { type: "setApiKey" }
  | { type: "openDashboard" }
  | { type: "refreshProviders" };

export type WebviewInbound =
  | { type: "hello"; config: InitialConfig }
  | { type: "searchResult"; result: SearchResponse }
  | { type: "searchError"; error: string }
  | { type: "providers"; providers: ProvidersResponse }
  | { type: "inserted"; relativePath: string; license: License }
  | { type: "focusSearch"; query?: string }
  | { type: "status"; connected: boolean; message?: string };

export interface InitialConfig {
  baseUrl: string;
  hasApiKey: boolean;
  defaultLicense: LicensePolicy;
  defaultProviders: ProviderId[];
  allProviders: string[];
}
