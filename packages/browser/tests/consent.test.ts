import { describe, expect, it } from "bun:test";

import {
  BrowserConsentError,
  createBrowserProvider,
} from "../src/index.ts";

describe("consent gate", () => {
  it("throws BrowserConsentError when userConsent is false", () => {
    expect(() =>
      createBrowserProvider({ userConsent: false }),
    ).toThrow(BrowserConsentError);
  });

  it("throws when userConsent is omitted (undefined)", () => {
    expect(() =>
      createBrowserProvider({} as unknown as Parameters<typeof createBrowserProvider>[0]),
    ).toThrow(BrowserConsentError);
  });

  it("instantiates (lazy — no browser boot) when userConsent is true", async () => {
    const provider = createBrowserProvider({
      userConsent: true,
      stack: "vanilla",
    });
    expect(typeof provider.searchGoogleImages).toBe("function");
    expect(typeof provider.extractFromPage).toBe("function");
    expect(typeof provider.close).toBe("function");
    // close() is a no-op if the browser never booted.
    await provider.close();
  });
});
