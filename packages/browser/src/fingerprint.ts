/**
 * Vanilla-stack fingerprint tweaks. Useful for the plain-Playwright path;
 * Rebrowser + Camoufox handle this internally. For "real" stealth use one
 * of those stacks instead.
 */

const USER_AGENTS = [
  // Chrome 129 mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  // Chrome 129 windows
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  // Firefox 131 mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0",
  // Safari 17 mac
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
];

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1536, height: 960 },
  { width: 1680, height: 1050 },
  { width: 1920, height: 1080 },
];

const LOCALES = ["en-US", "en-GB", "en-CA", "en-AU"];
const TIMEZONES = [
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Berlin",
];

function pick<T>(arr: readonly T[], rand: () => number = Math.random): T {
  const idx = Math.floor(rand() * arr.length);
  return arr[idx] ?? arr[0] as T;
}

export interface Fingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  locale: string;
  timezoneId: string;
}

export function randomFingerprint(rand: () => number = Math.random): Fingerprint {
  return {
    userAgent: pick(USER_AGENTS, rand),
    viewport: pick(VIEWPORTS, rand),
    locale: pick(LOCALES, rand),
    timezoneId: pick(TIMEZONES, rand),
  };
}
