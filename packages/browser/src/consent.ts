/**
 * Consent gate. `userConsent:true` is a hard-required flag on BrowserOptions.
 * We centralize the check here so every entry point funnels through one spot.
 */

import { BrowserConsentError, type BrowserOptions } from "./types.ts";

export function assertConsent(opts: BrowserOptions): void {
  if (opts.userConsent !== true) {
    throw new BrowserConsentError();
  }
}

/**
 * Legal boilerplate string to log / attach to sidecars when browser-source
 * downloads are produced. Kept verbatim so the cloud gate has a single source.
 */
export const CONSENT_NOTICE =
  "Browser-sourced results are extracted from public web pages. Caller has " +
  "asserted userConsent:true and accepts responsibility for copyright and " +
  "Terms-of-Service compliance per-URL. Default license is UNKNOWN.";
