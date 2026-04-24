/**
 * Runtime env accessors. Keep these narrow so a typo surfaces as a compile
 * error rather than `undefined` sprinkling through the app.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.getwebfetch.com";

export const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_KEY ?? "";

export function isFixtureMode(): boolean {
  return (
    process.env.NEXT_PUBLIC_USE_FIXTURES === "1" ||
    process.env.NEXT_PUBLIC_USE_FIXTURES === "true"
  );
}

export const USE_FIXTURES = isFixtureMode();

export const AUTH_COOKIE_DOMAIN = process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN ?? ".getwebfetch.com";
