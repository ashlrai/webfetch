import { describe, expect, test } from "bun:test";
import {
  buildAttribution,
  coerceLicense,
  heuristicLicenseFromUrl,
  isContextSafeLicense,
  isOpenLicense,
  isSafeLicense,
} from "../packages/core/src/license.ts";

describe("license coercion", () => {
  test("CC0 / public domain", () => {
    expect(coerceLicense("CC0")).toBe("CC0");
    expect(coerceLicense("publicdomain/zero/1.0")).toBe("CC0");
    expect(coerceLicense("public domain")).toBe("PUBLIC_DOMAIN");
  });
  test("CC-BY vs CC-BY-SA", () => {
    expect(coerceLicense("CC BY-SA 4.0")).toBe("CC_BY_SA");
    expect(coerceLicense("CC BY 4.0")).toBe("CC_BY");
    expect(coerceLicense("cc-by-sa-3.0")).toBe("CC_BY_SA");
  });
  test("editorial/press", () => {
    expect(coerceLicense("iTunes")).toBe("EDITORIAL_LICENSED");
    expect(coerceLicense("Official press photo")).toBe("PRESS_KIT_ALLOWLIST");
  });
  test("unknown fallback", () => {
    expect(coerceLicense("all rights reserved")).toBe("UNKNOWN");
    expect(coerceLicense(undefined)).toBe("UNKNOWN");
  });
});

describe("safety", () => {
  test("UNKNOWN is unsafe; safe-only compatibility treats editorial as context-safe", () => {
    expect(isSafeLicense("UNKNOWN")).toBe(false);
    expect(isSafeLicense("CC0")).toBe(true);
    expect(isSafeLicense("EDITORIAL_LICENSED")).toBe(true);
  });

  test("open licenses exclude editorial/press aliases", () => {
    expect(isOpenLicense("CC_BY")).toBe(true);
    expect(isOpenLicense("EDITORIAL_LICENSED")).toBe(false);
    expect(isOpenLicense("PRESS_KIT_ALLOWLIST")).toBe(false);
    expect(isContextSafeLicense("EDITORIAL_LICENSED")).toBe(true);
  });
});

describe("attribution", () => {
  test("builds a readable line", () => {
    const out = buildAttribution({
      license: "CC_BY_SA",
      author: "Jane",
      sourceName: "Wikimedia Commons",
      sourceUrl: "https://x",
      title: "Drake",
    });
    expect(out).toContain("Jane");
    expect(out).toContain("CC BY-SA");
    expect(out).toContain("https://x");
  });
});

describe("host heuristics", () => {
  test("unsplash -> CC0 with high confidence", () => {
    const r = heuristicLicenseFromUrl("https://images.unsplash.com/abc.jpg");
    expect(r.license).toBe("CC0");
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });
  test("random host -> UNKNOWN", () => {
    expect(heuristicLicenseFromUrl("https://example.com/x.jpg").license).toBe("UNKNOWN");
  });
});
