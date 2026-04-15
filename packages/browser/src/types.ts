/**
 * Public types for @webfetch/browser.
 */

import type { ImageCandidate } from "@webfetch/core";

export type StackId = "vanilla" | "rebrowser" | "camoufox" | "brightdata";

export type ExtractorId = "google-images" | "pinterest" | "twitter" | "generic-page";

export interface ProxyConfig {
  kind: "smartproxy" | "brightdata" | "custom";
  /** Hostname:port or full URL (no credentials). */
  endpoint: string;
  user?: string;
  pass?: string;
}

export interface CaptchaConfig {
  kind: "capsolver";
  apiKey: string;
  /** Base URL override (for tests / self-hosted). */
  baseUrl?: string;
}

export interface VisionConfig {
  anthropicKey: string;
  /** Defaults to claude-opus-4-6 per plan. */
  model?: string;
}

export interface BrowserLogEvent {
  level: "debug" | "info" | "warn" | "error";
  at: string; // ISO
  stack?: StackId;
  extractor?: ExtractorId;
  message: string;
  data?: Record<string, unknown>;
}

export interface BrowserOptions {
  /**
   * Which underlying stack to use. If omitted, router picks:
   *   brightdata (when BRIGHTDATA_CUSTOMER & BRIGHTDATA_PASSWORD are set)
   *   → rebrowser (when rebrowser-playwright is installed)
   *   → vanilla (plain playwright)
   */
  stack?: StackId;
  proxy?: ProxyConfig;
  captcha?: CaptchaConfig;
  vision?: VisionConfig;
  /**
   * HARD-REQUIRED: caller must affirm that they have consent / legal basis
   * to scrape public web pages under the target platform's ToS + copyright.
   * Constructor throws when false.
   */
  userConsent: boolean;
  headless?: boolean;
  timeoutMs?: number;
  cacheDir?: string;
  /** Token-bucket ceiling in calls per minute. Default 10. */
  rateLimitPerMin?: number;
  logger?: (e: BrowserLogEvent) => void;
}

export interface SearchImagesOptions {
  limit?: number;
  safeSearch?: "strict" | "moderate" | "off";
  /** When true, attach a rendered-page screenshot thumbnail ref to each result. */
  attachScreenshot?: boolean;
  signal?: AbortSignal;
}

export interface ExtractPageOptions {
  /** When true, run vision-picker to select the hero image. */
  pickHero?: boolean;
  signal?: AbortSignal;
}

export interface BrowserProvider {
  searchGoogleImages(query: string, opts?: SearchImagesOptions): Promise<ImageCandidate[]>;
  searchPinterest(query: string, opts?: SearchImagesOptions): Promise<ImageCandidate[]>;
  extractFromPage(url: string, opts?: ExtractPageOptions): Promise<ImageCandidate[]>;
  close(): Promise<void>;
}

export class BrowserConsentError extends Error {
  constructor() {
    super(
      "Browser-source fetching requires userConsent:true. " +
        "Browser fallback pulls images from public web pages (Google Images, Pinterest, arbitrary URLs) " +
        "which carries copyright + Terms-of-Service risk. Pass userConsent:true only if you have a legitimate " +
        "basis for each fetch. All browser-sourced candidates are tagged license:'UNKNOWN' by default.",
    );
    this.name = "BrowserConsentError";
  }
}

export class BrowserDependencyError extends Error {
  constructor(pkg: string, stack: StackId) {
    super(
      `Stack "${stack}" requires optional peer dependency "${pkg}". ` +
        `Install with: bun add ${pkg}   (or: npm i ${pkg})`,
    );
    this.name = "BrowserDependencyError";
  }
}
