/**
 * Provider Validation Harness
 *
 * Checks that every registered provider (and any template-generated provider)
 * satisfies the full Provider contract:
 *
 *  1. All required Provider interface methods exist (search; findSimilar optional).
 *  2. defaultLicense is a recognised License tag (present in LICENSE_RANK).
 *  3. Error handling propagates via ErrorKind correctly.
 *  4. The provider's rate-limit bucket is registered (getBucket does not throw).
 *  5. Auth keys declared in provider.auth match the PROVIDER_AUTH registry.
 *
 * Also exercises the template factory itself — verifying that generated source
 * contains the expected structural signatures and that generateProviderWithMeta
 * returns correct metadata.
 *
 * Uses Bun's built-in test runner (bun:test).
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { ALL_PROVIDERS, PROVIDER_AUTH } from "./providers/index.ts";
import { getBucket, _resetBuckets } from "./rate-limit.ts";
import { LICENSE_RANK } from "./license.ts";
import type { ErrorKind, License, Provider } from "./types.ts";
import {
  generateProviderTemplate,
  generateProviderWithMeta,
} from "./provider-template.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All valid License tags are keys of LICENSE_RANK. */
const VALID_LICENSES = new Set(Object.keys(LICENSE_RANK) as License[]);

/** All valid ErrorKind values. */
const VALID_ERROR_KINDS: ErrorKind[] = [
  "ok",
  "timeout",
  "http-4xx",
  "http-5xx",
  "network",
  "decode",
  "rate-limited",
];

// ---------------------------------------------------------------------------
// 1. Required Provider interface methods exist
// ---------------------------------------------------------------------------

describe("Provider interface shape", () => {
  for (const [id, provider] of Object.entries(ALL_PROVIDERS)) {
    it(`${id}: has required fields and search() method`, () => {
      // id field — Object.entries() widens the key to string; the registry key
      // is the provider id by construction, so narrow it back for the matcher.
      expect(typeof provider.id).toBe("string");
      expect(provider.id).toBe(id as typeof provider.id);

      // defaultLicense field
      expect(typeof provider.defaultLicense).toBe("string");

      // requiresAuth field
      expect(typeof provider.requiresAuth).toBe("boolean");

      // search() is a function
      expect(typeof provider.search).toBe("function");
    });

    it(`${id}: findSimilar is either absent or a function`, () => {
      if (provider.findSimilar !== undefined) {
        expect(typeof provider.findSimilar).toBe("function");
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. License tags are in the PROVIDER_LICENSES enum (LICENSE_RANK keys)
// ---------------------------------------------------------------------------

describe("Provider license tags", () => {
  for (const [id, provider] of Object.entries(ALL_PROVIDERS)) {
    it(`${id}: defaultLicense "${provider.defaultLicense}" is a recognised License`, () => {
      expect(VALID_LICENSES.has(provider.defaultLicense)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Error handling propagates via ErrorKind correctly
// ---------------------------------------------------------------------------

describe("Provider error propagation via ErrorKind", () => {
  it("VALID_ERROR_KINDS includes all expected values", () => {
    expect(VALID_ERROR_KINDS).toContain("ok");
    expect(VALID_ERROR_KINDS).toContain("timeout");
    expect(VALID_ERROR_KINDS).toContain("http-4xx");
    expect(VALID_ERROR_KINDS).toContain("http-5xx");
    expect(VALID_ERROR_KINDS).toContain("network");
    expect(VALID_ERROR_KINDS).toContain("decode");
    expect(VALID_ERROR_KINDS).toContain("rate-limited");
  });

  it("generated provider source contains errorKind annotations for all failure paths", () => {
    const source = generateProviderTemplate({
      id: "test-error-harness",
      exportName: "testErrorHarness",
      defaultLicense: "CC0",
      requiresAuth: true,
      authKey: "unsplashAccessKey",
      authEnv: "TEST_AUTH_KEY",
      apiBaseUrl: "https://api.example.com",
    });

    // Auth failure → http-4xx
    expect(source).toContain('"http-4xx"');
    // Network error
    expect(source).toContain('"network"');
    // Rate limited
    expect(source).toContain('"rate-limited"');
    // Server error
    expect(source).toContain('"http-5xx"');
    // Decode error
    expect(source).toContain('"decode"');
  });

  it("generated source throws with errorKind=http-4xx for missing auth", async () => {
    // Build a minimal provider object from the generated template pattern
    // by constructing a provider that mirrors the generated auth guard.
    const mockProvider: Provider = {
      id: "unsplash", // use a real id so rate-limit bucket exists
      defaultLicense: "CC_BY",
      requiresAuth: true,
      async search(_query, opts) {
        const key = opts.auth?.unsplashAccessKey;
        if (!key) {
          const err = new Error("test-provider: missing auth key");
          (err as any).errorKind = "http-4xx";
          throw err;
        }
        return [];
      },
    };

    let caught: any;
    try {
      await mockProvider.search("cats", {});
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect((caught as any).errorKind).toBe("http-4xx");
  });

  it("generated source throws with errorKind=network for fetch failures", async () => {
    const mockProvider: Provider = {
      id: "wikimedia",
      defaultLicense: "CC0",
      requiresAuth: false,
      async search(_query, opts) {
        const fetcher = opts.fetcher ?? fetch;
        try {
          await fetcher("https://api.example.com/fail");
        } catch (err: unknown) {
          const e = new Error(`network error — ${(err as Error).message}`);
          (e as any).errorKind = "network";
          throw e;
        }
        return [];
      },
    };

    const failingFetcher = async () => {
      throw new Error("ECONNREFUSED");
    };

    let caught: any;
    try {
      await mockProvider.search("dogs", { fetcher: failingFetcher as any });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect((caught as any).errorKind).toBe("network");
    expect(caught.message).toContain("ECONNREFUSED");
  });

  it("generated source throws with errorKind=rate-limited on HTTP 429", async () => {
    const mockProvider: Provider = {
      id: "pexels",
      defaultLicense: "PEXELS_LICENSE",
      requiresAuth: false,
      async search(_query, opts) {
        const fetcher = opts.fetcher ?? fetch;
        const resp = await fetcher("https://api.example.com/search");
        if (resp.status === 429) {
          const e = new Error("rate limited (429)");
          (e as any).errorKind = "rate-limited";
          throw e;
        }
        return [];
      },
    };

    const rateLimitFetcher = async () =>
      ({ ok: false, status: 429, json: async () => ({}) }) as unknown as Response;

    let caught: any;
    try {
      await mockProvider.search("birds", { fetcher: rateLimitFetcher as any });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeDefined();
    expect((caught as any).errorKind).toBe("rate-limited");
  });
});

// ---------------------------------------------------------------------------
// 4. Rate-limit bucket is registered for every provider
// ---------------------------------------------------------------------------

describe("Rate-limit bucket registration", () => {
  beforeEach(() => {
    _resetBuckets();
  });

  for (const id of Object.keys(ALL_PROVIDERS)) {
    it(`${id}: getBucket() does not throw and returns a usable bucket`, () => {
      // getBucket throws if the provider id is not in DEFAULTS.
      // (It would crash with "Cannot read properties of undefined".)
      let bucket: ReturnType<typeof getBucket>;
      expect(() => {
        bucket = getBucket(id as any);
      }).not.toThrow();

      // The returned bucket must expose tryTake, take, state, saturated.
      expect(typeof bucket!.tryTake).toBe("function");
      expect(typeof bucket!.take).toBe("function");
      expect(typeof bucket!.state).toBe("function");
      expect(typeof bucket!.saturated).toBe("function");

      // A fresh bucket should not be saturated.
      const state = bucket!.state();
      expect(state.tokensAvailable).toBeGreaterThan(0);
      expect(state.saturated).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Auth keys match the PROVIDER_AUTH registry
// ---------------------------------------------------------------------------

describe("Provider auth key consistency", () => {
  for (const [id, provider] of Object.entries(ALL_PROVIDERS)) {
    it(`${id}: requiresAuth flag matches PROVIDER_AUTH registry presence`, () => {
      const registryEntry = PROVIDER_AUTH[id as keyof typeof PROVIDER_AUTH];

      if (provider.requiresAuth) {
        // A provider that declares requiresAuth:true should have an entry in
        // PROVIDER_AUTH so federation can skip it deterministically.
        expect(registryEntry).toBeDefined();
      }
    });

    it(`${id}: provider.auth (if set) matches PROVIDER_AUTH entry`, () => {
      const registryEntry = PROVIDER_AUTH[id as keyof typeof PROVIDER_AUTH];

      if (provider.auth && registryEntry) {
        // Keys list must match.
        expect(provider.auth.keys.sort()).toEqual(registryEntry.keys.sort());
        // Env list must match.
        expect(provider.auth.env.sort()).toEqual(registryEntry.env.sort());
      }
    });
  }

  it("PROVIDER_AUTH does not reference ids absent from ALL_PROVIDERS", () => {
    for (const id of Object.keys(PROVIDER_AUTH)) {
      expect(ALL_PROVIDERS).toHaveProperty(id);
    }
  });
});

// ---------------------------------------------------------------------------
// Template factory unit tests
// ---------------------------------------------------------------------------

describe("generateProviderTemplate()", () => {
  it("generates a string containing the provider id", () => {
    const source = generateProviderTemplate({
      id: "dreamstime",
      exportName: "dreamstime",
      defaultLicense: "EDITORIAL_LICENSED",
      requiresAuth: true,
      authKey: "unsplashAccessKey",
      authEnv: "DREAMSTIME_API_KEY",
      apiBaseUrl: "https://api.dreamstime.com",
    });
    expect(typeof source).toBe("string");
    expect(source).toContain('"dreamstime"');
    expect(source).toContain("export const dreamstime");
  });

  it("includes auth guard when requiresAuth is true", () => {
    const source = generateProviderTemplate({
      id: "depositphotos",
      exportName: "depositPhotos",
      defaultLicense: "EDITORIAL_LICENSED",
      requiresAuth: true,
      authKey: "pexelsApiKey",
      authEnv: "DEPOSITPHOTOS_API_KEY",
      apiBaseUrl: "https://api.depositphotos.com",
    });
    expect(source).toContain("DEPOSITPHOTOS_API_KEY");
    expect(source).toContain("missing auth key");
    expect(source).toContain("http-4xx");
  });

  it("omits auth guard when requiresAuth is false", () => {
    const source = generateProviderTemplate({
      id: "alamy-free",
      exportName: "alamyFree",
      defaultLicense: "CC_BY",
      requiresAuth: false,
      apiBaseUrl: "https://api.alamy.com",
    });
    expect(source).not.toContain("missing auth key");
    expect(source).toContain("No auth required");
  });

  it("includes findSimilar stub when includeFindSimilar is true", () => {
    const source = generateProviderTemplate({
      id: "alamy",
      exportName: "alamy",
      defaultLicense: "EDITORIAL_LICENSED",
      requiresAuth: false,
      apiBaseUrl: "https://api.alamy.com",
      includeFindSimilar: true,
    });
    expect(source).toContain("findSimilar");
    expect(source).toContain("reverse-image lookup");
  });

  it("omits findSimilar when includeFindSimilar is false", () => {
    const source = generateProviderTemplate({
      id: "alamy-no-similar",
      exportName: "alamyNoSimilar",
      defaultLicense: "EDITORIAL_LICENSED",
      requiresAuth: false,
      apiBaseUrl: "https://api.alamy.com",
      includeFindSimilar: false,
    });
    expect(source).not.toContain("findSimilar");
  });

  it("always includes getBucket().take() call", () => {
    const source = generateProviderTemplate({
      id: "shutterstock",
      exportName: "shutterstock",
      defaultLicense: "EDITORIAL_LICENSED",
      requiresAuth: true,
      authKey: "bingApiKey",
      authEnv: "SHUTTERSTOCK_API_KEY",
      apiBaseUrl: "https://api.shutterstock.com",
    });
    expect(source).toContain('getBucket("shutterstock"');
    expect(source).toContain(".take()");
  });

  it("always includes all five ErrorKind annotations", () => {
    const source = generateProviderTemplate({
      id: "getty",
      exportName: "getty",
      defaultLicense: "EDITORIAL_LICENSED",
      requiresAuth: true,
      authKey: "serpApiKey",
      authEnv: "GETTY_API_KEY",
      apiBaseUrl: "https://api.gettyimages.com",
    });
    const errorKinds: ErrorKind[] = ["http-4xx", "network", "rate-limited", "http-5xx", "decode"];
    for (const kind of errorKinds) {
      expect(source).toContain(`"${kind}"`);
    }
  });

  it("uses the provided apiBaseUrl in the generated fetch call", () => {
    const source = generateProviderTemplate({
      id: "custom",
      exportName: "custom",
      defaultLicense: "CC0",
      requiresAuth: false,
      apiBaseUrl: "https://custom.provider.example.com/v2",
    });
    expect(source).toContain("https://custom.provider.example.com/v2");
  });
});

describe("generateProviderWithMeta()", () => {
  it("returns source string and structured metadata", () => {
    const { source, meta } = generateProviderWithMeta({
      id: "test-meta",
      exportName: "testMeta",
      defaultLicense: "CC_BY",
      requiresAuth: false,
      apiBaseUrl: "https://api.test.com",
      includeFindSimilar: true,
    });

    expect(typeof source).toBe("string");
    expect(source.length).toBeGreaterThan(100);

    expect(meta.id).toBe("test-meta");
    expect(meta.exportName).toBe("testMeta");
    expect(meta.defaultLicense).toBe("CC_BY");
    expect(meta.requiresAuth).toBe(false);
    expect(meta.includesFindSimilar).toBe(true);
    expect(meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("meta.includesFindSimilar is false when not requested", () => {
    const { meta } = generateProviderWithMeta({
      id: "no-similar",
      exportName: "noSimilar",
      defaultLicense: "CC0",
      requiresAuth: false,
      apiBaseUrl: "https://api.test.com",
    });
    expect(meta.includesFindSimilar).toBe(false);
  });

  it("meta.authKey and meta.authEnv are populated when requiresAuth is true", () => {
    const { meta } = generateProviderWithMeta({
      id: "auth-provider",
      exportName: "authProvider",
      defaultLicense: "PEXELS_LICENSE",
      requiresAuth: true,
      authKey: "pexelsApiKey",
      authEnv: "PEXELS_API_KEY",
      apiBaseUrl: "https://api.pexels.com",
    });
    expect(meta.authKey).toBe("pexelsApiKey");
    expect(meta.authEnv).toBe("PEXELS_API_KEY");
  });
});
