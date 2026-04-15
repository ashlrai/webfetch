/**
 * @webfetch/browser — "like a human" browser-fetch layer.
 *
 * Public API:
 *   - createBrowserProvider(opts) → BrowserProvider  (full hybrid router)
 *   - pickHeroImage(screenshot, candidates, opts)    (standalone vision helper)
 *   - extractFromPage(html, url, opts)               (pure HTML extractor, no browser)
 *
 * Design notes:
 *   - `userConsent:true` is hard-required (BrowserConsentError otherwise).
 *   - All stack imports are lazy — `createBrowserProvider` returns a provider
 *     object without launching a browser, so tests can instantiate without
 *     Playwright installed. The browser only boots on the first search call.
 *   - Every candidate is tagged viaBrowserFallback + license:"UNKNOWN" by default.
 */

import type { ImageCandidate } from "@webfetch/core";

import { tagCandidate } from "./attribution.ts";
import { detectCaptcha } from "./captcha/capsolver.ts";
import { assertConsent } from "./consent.ts";
import { extractGenericPage } from "./extractors/generic-page.ts";
import { extractGoogleImages } from "./extractors/google-images.ts";
import { extractPinterest } from "./extractors/pinterest.ts";
import { extractTwitter } from "./extractors/twitter.ts";
import { type BrowserBucket, createBrowserBucket } from "./rate-limit.ts";
import { getStack, pickStack } from "./router.ts";
import type { Stack, StackPage, StackSession } from "./stacks/contract.ts";
import {
  BrowserConsentError,
  BrowserDependencyError,
  type BrowserLogEvent,
  type BrowserOptions,
  type BrowserProvider,
  type ExtractPageOptions,
  type ExtractorId,
  type SearchImagesOptions,
  type StackId,
} from "./types.ts";
import { pickHeroImage } from "./vision-picker.ts";

export {
  BrowserConsentError,
  BrowserDependencyError,
} from "./types.ts";
export type {
  BrowserLogEvent,
  BrowserOptions,
  BrowserProvider,
  CaptchaConfig,
  ExtractPageOptions,
  ExtractorId,
  ProxyConfig,
  SearchImagesOptions,
  StackId,
  VisionConfig,
} from "./types.ts";
export {
  pickHeroImage,
  parseVisionReply,
  buildVisionPrompt,
  _setVisionClientFactory,
} from "./vision-picker.ts";
export { detectCaptcha, solveCaptcha } from "./captcha/capsolver.ts";
export { buildSidecar, tagCandidate } from "./attribution.ts";
export { buildBrightdataWsEndpoint } from "./stacks/brightdata.ts";
export { BrowserCache } from "./cache.ts";
export { pickStack } from "./router.ts";
export { extractGoogleImages } from "./extractors/google-images.ts";
export { extractPinterest } from "./extractors/pinterest.ts";
export { extractGenericPage } from "./extractors/generic-page.ts";
export { extractTwitter } from "./extractors/twitter.ts";
export type { ExtractResult, ExtractContext } from "./extractors/types.ts";
export { ExtractorError } from "./extractors/types.ts";

function log(opts: BrowserOptions, ev: Omit<BrowserLogEvent, "at">): void {
  if (!opts.logger) return;
  opts.logger({ ...ev, at: new Date().toISOString() });
}

async function withPage<T>(session: StackSession, fn: (page: StackPage) => Promise<T>): Promise<T> {
  const page = await session.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Full provider — lazily boots a browser on the first search call. Call
 * `.close()` when done (idempotent; safe if browser never booted).
 */
export function createBrowserProvider(opts: BrowserOptions): BrowserProvider {
  assertConsent(opts);

  const bucket: BrowserBucket = createBrowserBucket(opts.rateLimitPerMin ?? 10);
  let session: StackSession | null = null;
  let resolvedStack: StackId | null = null;

  async function ensureSession(): Promise<StackSession> {
    if (session) return session;
    const id = resolvedStack ?? (await pickStack(opts));
    resolvedStack = id;
    const stack: Stack = getStack(id);
    log(opts, { level: "info", stack: id, message: "booting browser stack" });
    session = await stack.open(opts);
    return session;
  }

  async function runExtractor(
    extractor: ExtractorId,
    url: string,
    parse: (html: string, url: string) => ImageCandidate[],
    searchOpts: SearchImagesOptions | ExtractPageOptions = {},
  ): Promise<ImageCandidate[]> {
    await bucket.take();
    const sess = await ensureSession();
    const limit = (searchOpts as SearchImagesOptions).limit;
    const candidates = await withPage(sess, async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs ?? 30_000 });
      const html = await page.content();
      // Captcha detection — best-effort, logged not thrown.
      const challenge = detectCaptcha(html, url);
      if (challenge) {
        log(opts, {
          level: "warn",
          extractor,
          stack: resolvedStack ?? undefined,
          message: `captcha detected (${challenge.type})`,
          data: { siteKey: challenge.siteKey },
        });
        if (!opts.captcha) {
          return [] as ImageCandidate[];
        }
      }
      return parse(html, url);
    });

    const limited = typeof limit === "number" ? candidates.slice(0, limit) : candidates;
    return limited.map((c) => tagCandidate(c, extractor, resolvedStack ?? "unknown"));
  }

  return {
    async searchGoogleImages(query, searchOpts = {}) {
      const safe = searchOpts.safeSearch === "off" ? "off" : "active";
      const url = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}&safe=${safe}`;
      return runExtractor(
        "google-images",
        url,
        (html) => extractGoogleImages({ html, sourcePageUrl: url }).candidates,
        searchOpts,
      );
    },
    async searchPinterest(query, searchOpts = {}) {
      const url = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
      return runExtractor(
        "pinterest",
        url,
        (html) => extractPinterest({ html, sourcePageUrl: url }).candidates,
        searchOpts,
      );
    },
    async extractFromPage(pageUrl, extractOpts = {}) {
      const host = safeHost(pageUrl);
      const picker = pickExtractor(host);
      const candidates = await runExtractor(
        picker.id,
        pageUrl,
        (html, url) => picker.parse(html, url),
        extractOpts,
      );
      if (!extractOpts.pickHero || candidates.length === 0) return candidates;
      if (!opts.vision) {
        log(opts, {
          level: "warn",
          message: "pickHero requested but vision config missing; returning unranked candidates",
        });
        return candidates;
      }
      // Take a screenshot for vision picker.
      const sess = await ensureSession();
      const shot = await withPage(sess, async (page) => {
        await page.goto(pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: opts.timeoutMs ?? 30_000,
        });
        return page.screenshot({ fullPage: false });
      });
      const hero = await pickHeroImage(shot, candidates, opts.vision);
      if (!hero) return candidates;
      // Hero floats to the front.
      return [hero, ...candidates.filter((c) => c.url !== hero.url)];
    },
    async close() {
      if (session) {
        await session.close().catch(() => undefined);
        session = null;
      }
    },
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function pickExtractor(host: string): {
  id: ExtractorId;
  parse: (html: string, url: string) => ImageCandidate[];
} {
  if (host.endsWith("pinterest.com") || host.endsWith("pin.it")) {
    return {
      id: "pinterest",
      parse: (html, url) => extractPinterest({ html, sourcePageUrl: url }).candidates,
    };
  }
  if (host.endsWith("google.com") && host.includes("google")) {
    return {
      id: "google-images",
      parse: (html, url) => extractGoogleImages({ html, sourcePageUrl: url }).candidates,
    };
  }
  if (host.endsWith("twitter.com") || host.endsWith("x.com")) {
    return {
      id: "twitter",
      parse: (html, url) => extractTwitter({ html, sourcePageUrl: url }).candidates,
    };
  }
  return {
    id: "generic-page",
    parse: (html, url) => extractGenericPage({ html, sourcePageUrl: url }).candidates,
  };
}

/**
 * Standalone HTML extractor — no browser boot. Useful when the caller
 * already has rendered HTML (e.g., from another scraper, a cached fixture,
 * or the generic `fetch()` path).
 */
export function extractFromHtml(
  html: string,
  url: string,
  opts: { extractor?: ExtractorId } = {},
): ImageCandidate[] {
  const host = safeHost(url);
  const id: ExtractorId = opts.extractor ?? inferExtractorId(host);
  switch (id) {
    case "google-images":
      return extractGoogleImages({ html, sourcePageUrl: url }).candidates;
    case "pinterest":
      return extractPinterest({ html, sourcePageUrl: url }).candidates;
    case "twitter":
      return extractTwitter({ html, sourcePageUrl: url }).candidates;
    default:
      return extractGenericPage({ html, sourcePageUrl: url }).candidates;
  }
}

function inferExtractorId(host: string): ExtractorId {
  if (host.endsWith("pinterest.com") || host.endsWith("pin.it")) return "pinterest";
  if (host.includes("google.")) return "google-images";
  if (host.endsWith("twitter.com") || host.endsWith("x.com")) return "twitter";
  return "generic-page";
}
