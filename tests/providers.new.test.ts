import { describe, expect, test } from "bun:test";
import {
  ALL_PROVIDERS,
  europeana,
  flickr,
  internetArchive,
  metMuseum,
  nasa,
  PROVIDER_AUTH,
  smithsonian,
} from "../packages/core/src/providers/index.ts";
import { searchImages } from "../packages/core/src/federation.ts";
import type { ProviderAuth, ProviderId } from "../packages/core/src/types.ts";
import { fixture, jsonResponse, stubFetcher } from "./stub-fetcher.ts";

const AUTH_KEYS = [
  "unsplashAccessKey",
  "pexelsApiKey",
  "pixabayApiKey",
  "braveApiKey",
  "bingApiKey",
  "serpApiKey",
  "spotifyClientId",
  "spotifyClientSecret",
  "userAgent",
  "flickrApiKey",
  "smithsonianApiKey",
  "europeanaApiKey",
  "rawpixelApiKey",
  "brightDataApiToken",
  "brightDataZone",
] as const satisfies readonly (keyof ProviderAuth)[];

function withUnsetEnv<T>(envNames: readonly string[], run: () => Promise<T>): Promise<T> {
  const original = new Map<string, string | undefined>();
  for (const envName of envNames) {
    original.set(envName, process.env[envName]);
    delete process.env[envName];
  }

  return run().finally(() => {
    for (const [envName, value] of original) {
      if (value === undefined) {
        delete process.env[envName];
      } else {
        process.env[envName] = value;
      }
    }
  });
}

describe("provider auth contracts", () => {
  test("every auth-required core provider has declarative auth metadata", () => {
    const missing = Object.values(ALL_PROVIDERS)
      .filter((provider) => provider.requiresAuth)
      .filter((provider) => !provider.auth || provider.auth.keys.length === 0)
      .map((provider) => provider.id);

    expect(missing).toEqual([]);
  });

  test("auth keys and env vars are internally consistent", () => {
    for (const [providerId, auth] of Object.entries(PROVIDER_AUTH) as [
      ProviderId,
      NonNullable<(typeof PROVIDER_AUTH)[ProviderId]>,
    ][]) {
      expect(ALL_PROVIDERS[providerId]).toBeDefined();
      expect(auth.keys.length).toBeGreaterThan(0);
      expect(auth.env.length).toBe(auth.keys.length);

      for (const [index, key] of auth.keys.entries()) {
        expect(AUTH_KEYS).toContain(key);
        expect(auth.env[index]).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  test("missing auth skips every auth-required provider without invoking fetcher", async () => {
    const authRequired = Object.values(ALL_PROVIDERS).filter((provider) => provider.requiresAuth);
    const envNames = authRequired.flatMap((provider) => provider.auth?.env ?? []);
    const called: ProviderId[] = [];
    const fetcher = (async () => {
      throw new Error("auth-required provider fetcher should not be called");
    }) as typeof fetch;

    await withUnsetEnv(envNames, async () => {
      for (const provider of authRequired) {
        const out = await searchImages("portrait", {
          providers: [provider.id],
          fetcher: ((...args) => {
            called.push(provider.id);
            return fetcher(...args);
          }) as typeof fetch,
          auth: {},
        });

        expect(out.candidates).toEqual([]);
        expect(out.providerReports).toEqual([
          {
            provider: provider.id,
            ok: false,
            count: 0,
            timeMs: 0,
            skipped: "missing-auth",
            errorKind: "network",
          },
        ]);
      }
    });

    expect(called).toEqual([]);
  });
});

describe("new public-domain / CC providers", () => {
  test("missing provider auth is skipped without invoking provider", async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      throw new Error("should not be called");
    }) as typeof fetch;
    const out = await searchImages("portrait", {
      providers: ["unsplash"],
      fetcher,
      auth: {},
    });
    expect(called).toBe(false);
    expect(out.providerReports[0]!.skipped).toBe("missing-auth");
  });

  test("nasa → PUBLIC_DOMAIN candidate", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("images-api.nasa.gov"),
        handler: async () => jsonResponse(fixture("nasa.json")),
      },
    ]);
    const out = await nasa.search("apollo 11", { fetcher, maxPerProvider: 5 });
    expect(out.length).toBe(1);
    expect(out[0]!.license).toBe("PUBLIC_DOMAIN");
    expect(out[0]!.url).toContain("nasa.gov");
    expect(out[0]!.source).toBe("nasa");
  });

  test("internet-archive → maps licenseurl to CC0", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("archive.org/advancedsearch"),
        handler: async () => jsonResponse(fixture("internet-archive.json")),
      },
    ]);
    const out = await internetArchive.search("apollo", { fetcher });
    expect(out[0]!.license).toBe("CC0");
    expect(out[0]!.source).toBe("internet-archive");
  });

  test("smithsonian → CC0", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("api.si.edu"),
        handler: async () => jsonResponse(fixture("smithsonian.json")),
      },
    ]);
    const out = await smithsonian.search("apollo", { fetcher });
    expect(out[0]!.license).toBe("CC0");
    expect(out[0]!.source).toBe("smithsonian");
  });

  test("met-museum → CC0, skips non-PD objects", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("/search?"),
        handler: async () => jsonResponse(fixture("met-museum-search.json")),
      },
      {
        match: (u) => u.includes("/objects/"),
        handler: async () => jsonResponse(fixture("met-museum-object.json")),
      },
    ]);
    const out = await metMuseum.search("van gogh", { fetcher });
    expect(out.length).toBe(1);
    expect(out[0]!.license).toBe("CC0");
    expect(out[0]!.author).toBe("Vincent van Gogh");
  });

  test("flickr → requires key; gracefully errors when missing", async () => {
    await expect(flickr.search("apollo", {})).rejects.toThrow(/FLICKR/);
  });

  test("flickr → with key returns CC_BY", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("api.flickr.com"),
        handler: async () => jsonResponse(fixture("flickr.json")),
      },
    ]);
    const out = await flickr.search("apollo", {
      fetcher,
      auth: { flickrApiKey: "test-key" },
    });
    expect(out.length).toBe(1);
    expect(out[0]!.license).toBe("CC_BY");
    expect(out[0]!.author).toBe("Jane Photographer");
  });

  test("europeana → requires key; gracefully errors when missing", async () => {
    await expect(europeana.search("portrait", {})).rejects.toThrow(/EUROPEANA/);
  });

  test("europeana → with key returns CC_BY", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("api.europeana.eu"),
        handler: async () => jsonResponse(fixture("europeana.json")),
      },
    ]);
    const out = await europeana.search("portrait", {
      fetcher,
      auth: { europeanaApiKey: "test-key" },
    });
    expect(out.length).toBe(1);
    expect(out[0]!.license).toBe("CC_BY");
  });
});
