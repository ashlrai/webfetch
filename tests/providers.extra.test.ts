/**
 * Tests for the five additional providers added in the 24-provider federation
 * expansion: library-of-congress, wellcome-collection, rawpixel, burst,
 * europeana-archival.
 */

import { describe, expect, test } from "bun:test";
import { searchImages } from "../packages/core/src/federation.ts";
import {
  burst,
  europeanaArchival,
  libraryOfCongress,
  rawpixel,
  wellcomeCollection,
} from "../packages/core/src/providers/index.ts";
import { fixture, jsonResponse, stubFetcher } from "./stub-fetcher.ts";

describe("library-of-congress", () => {
  test("parses results, maps 'no known restrictions' to PUBLIC_DOMAIN", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("loc.gov/search"),
        handler: async () => jsonResponse(fixture("library-of-congress.json")),
      },
    ]);
    const out = await libraryOfCongress.search("frederick douglass", { fetcher });
    expect(out.length).toBe(2);
    expect(out[0]!.license).toBe("PUBLIC_DOMAIN");
    expect(out[0]!.source).toBe("library-of-congress");
    expect(out[0]!.title).toContain("Frederick Douglass");
    // Restricted item should be UNKNOWN (coerced conservatively).
    expect(out[1]!.license).toBe("UNKNOWN");
  });
});

describe("wellcome-collection", () => {
  test("maps pdm→PUBLIC_DOMAIN, cc-by→CC_BY, drops cc-by-nc-nd", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("api.wellcomecollection.org"),
        handler: async () => jsonResponse(fixture("wellcome-collection.json")),
      },
    ]);
    const out = await wellcomeCollection.search("anatomy", { fetcher });
    expect(out.length).toBe(2); // nc-nd dropped
    const licenses = out.map((c) => c.license).sort();
    expect(licenses).toEqual(["CC_BY", "PUBLIC_DOMAIN"]);
    const pdm = out.find((c) => c.license === "PUBLIC_DOMAIN")!;
    expect(pdm.author).toBe("Henry Gray");
    expect(pdm.source).toBe("wellcome-collection");
  });
});

describe("rawpixel", () => {
  test("CC0 enforced via freecc0 query param", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("rawpixel.com/api/v1/search") && u.includes("freecc0=1"),
        handler: async () => jsonResponse(fixture("rawpixel.json")),
      },
    ]);
    const out = await rawpixel.search("botanical", { fetcher });
    expect(out.length).toBe(1);
    expect(out[0]!.license).toBe("CC0");
    expect(out[0]!.source).toBe("rawpixel");
    expect(out[0]!.url).toContain("image_1300");
  });
});

describe("burst", () => {
  test("all images are CC0", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("burst.shopify.com/photos/search.json"),
        handler: async () => jsonResponse(fixture("burst.json")),
      },
    ]);
    const out = await burst.search("desk", { fetcher });
    expect(out.length).toBe(1);
    expect(out[0]!.license).toBe("CC0");
    expect(out[0]!.author).toBe("Matthew Henry");
    expect(out[0]!.source).toBe("burst");
  });
});

describe("europeana-archival", () => {
  test("requires EUROPEANA_API_KEY", async () => {
    await expect(europeanaArchival.search("manuscript", {})).rejects.toThrow(/EUROPEANA/);
  });

  test("with key, parses TEXT records via edmPreview", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("api.europeana.eu") && u.includes("TYPE%3ATEXT"),
        handler: async () => jsonResponse(fixture("europeana-archival.json")),
      },
    ]);
    const out = await europeanaArchival.search("newspaper", {
      fetcher,
      auth: { europeanaApiKey: "test-key" },
    });
    expect(out.length).toBe(1);
    expect(out[0]!.license).toBe("CC_BY");
    expect(out[0]!.source).toBe("europeana-archival");
  });
});

describe("federation integration — 5 new providers", () => {
  test("fetchAll across all 5 new providers returns results", async () => {
    const fetcher = stubFetcher([
      {
        match: (u) => u.includes("loc.gov/search"),
        handler: async () => jsonResponse(fixture("library-of-congress.json")),
      },
      {
        match: (u) => u.includes("api.wellcomecollection.org"),
        handler: async () => jsonResponse(fixture("wellcome-collection.json")),
      },
      {
        match: (u) => u.includes("rawpixel.com/api/v1/search"),
        handler: async () => jsonResponse(fixture("rawpixel.json")),
      },
      {
        match: (u) => u.includes("burst.shopify.com"),
        handler: async () => jsonResponse(fixture("burst.json")),
      },
      {
        match: (u) => u.includes("api.europeana.eu"),
        handler: async () => jsonResponse(fixture("europeana-archival.json")),
      },
    ]);
    const out = await searchImages("test query", {
      providers: [
        "library-of-congress",
        "wellcome-collection",
        "rawpixel",
        "burst",
        "europeana-archival",
      ],
      fetcher,
      auth: { europeanaApiKey: "test-key" },
    });
    const sources = new Set(out.candidates.map((c) => c.source));
    // All five providers should contribute at least one candidate.
    expect(sources.has("library-of-congress")).toBe(true);
    expect(sources.has("wellcome-collection")).toBe(true);
    expect(sources.has("rawpixel")).toBe(true);
    expect(sources.has("burst")).toBe(true);
    expect(sources.has("europeana-archival")).toBe(true);
    expect(out.providerReports.filter((r) => r.ok).length).toBe(5);
  });
});
