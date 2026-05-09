import { describe, expect, test } from "bun:test";
import {
  buildAttribution,
  coerceLicense,
  heuristicLicenseFromUrl,
  isContextSafeLicense,
  isOpenLicense,
  isSafeLicense,
  CONTEXT_SAFE_LICENSES,
  LICENSE_RANK,
  OPEN_LICENSES,
  PLATFORM_LICENSES,
} from "../packages/core/src/license.ts";
import { rankAll } from "../packages/core/src/pick.ts";
import type { ImageCandidate, License } from "../packages/core/src/types.ts";

const PLATFORM_LICENSE_TAGS = [
  "UNSPLASH_LICENSE",
  "PEXELS_LICENSE",
  "PIXABAY_LICENSE",
] as const satisfies readonly License[];

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
  test("platform licenses are explicit, not CC0", () => {
    expect(coerceLicense("Unsplash License")).toBe("UNSPLASH_LICENSE");
    expect(coerceLicense("Pexels License")).toBe("PEXELS_LICENSE");
    expect(coerceLicense("Pixabay Content License")).toBe("PIXABAY_LICENSE");
  });
  test("unknown fallback", () => {
    expect(coerceLicense("all rights reserved")).toBe("UNKNOWN");
    expect(coerceLicense(undefined)).toBe("UNKNOWN");
  });
});

describe("safety", () => {
  test("license taxonomy includes platform tags", () => {
    const canonical = Object.keys(LICENSE_RANK) as License[];

    expect(PLATFORM_LICENSES).toEqual(PLATFORM_LICENSE_TAGS);
    expect(canonical).toEqual([
      "CC0",
      "PUBLIC_DOMAIN",
      "CC_BY",
      "CC_BY_SA",
      "UNSPLASH_LICENSE",
      "PEXELS_LICENSE",
      "PIXABAY_LICENSE",
      "EDITORIAL_LICENSED",
      "PRESS_KIT_ALLOWLIST",
      "UNKNOWN",
    ]);
    expect(PLATFORM_LICENSES.every((license) => canonical.includes(license))).toBe(true);
    expect(OPEN_LICENSES.some((license) => PLATFORM_LICENSES.includes(license))).toBe(false);
    expect(PLATFORM_LICENSES.every((license) => CONTEXT_SAFE_LICENSES.includes(license))).toBe(true);
  });

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
    expect(isOpenLicense("UNSPLASH_LICENSE")).toBe(false);
    expect(isContextSafeLicense("UNSPLASH_LICENSE")).toBe(true);
    expect(PLATFORM_LICENSES).toContain("PEXELS_LICENSE");
  });

  test("license policies classify platform licenses consistently", () => {
    const candidates: ImageCandidate[] = PLATFORM_LICENSE_TAGS.map((license) => ({
      url: `https://example.test/${license}.jpg`,
      source: "test",
      license,
      confidence: 0.95,
    }));

    expect(rankAll(candidates, { licensePolicy: "open-only" })).toEqual([]);
    expect(rankAll(candidates, { licensePolicy: "safe-only" }).map((c) => c.license)).toEqual(
      PLATFORM_LICENSE_TAGS,
    );
    expect(rankAll(candidates, { licensePolicy: "context-safe" }).map((c) => c.license)).toEqual(
      PLATFORM_LICENSE_TAGS,
    );
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
  test("unsplash -> platform license with high confidence", () => {
    const r = heuristicLicenseFromUrl("https://images.unsplash.com/abc.jpg");
    expect(r.license).toBe("UNSPLASH_LICENSE");
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });
  test("random host -> UNKNOWN", () => {
    expect(heuristicLicenseFromUrl("https://example.com/x.jpg").license).toBe("UNKNOWN");
  });
});
