import { describe, expect, test } from "bun:test";
import {
  europeana,
  flickr,
  internetArchive,
  metMuseum,
  nasa,
  smithsonian,
} from "../packages/core/src/providers/index.ts";
import { fixture, jsonResponse, stubFetcher } from "./stub-fetcher.ts";

describe("new public-domain / CC providers", () => {
  test("nasa → PUBLIC_DOMAIN candidate", async () => {
    const fetcher = stubFetcher([
      { match: (u) => u.includes("images-api.nasa.gov"), handler: async () => jsonResponse(fixture("nasa.json")) },
    ]);
    const out = await nasa.search("apollo 11", { fetcher, maxPerProvider: 5 });
    expect(out.length).toBe(1);
    expect(out[0]!.license).toBe("PUBLIC_DOMAIN");
    expect(out[0]!.url).toContain("nasa.gov");
    expect(out[0]!.source).toBe("nasa");
  });

  test("internet-archive → maps licenseurl to CC0", async () => {
    const fetcher = stubFetcher([
      { match: (u) => u.includes("archive.org/advancedsearch"), handler: async () => jsonResponse(fixture("internet-archive.json")) },
    ]);
    const out = await internetArchive.search("apollo", { fetcher });
    expect(out[0]!.license).toBe("CC0");
    expect(out[0]!.source).toBe("internet-archive");
  });

  test("smithsonian → CC0", async () => {
    const fetcher = stubFetcher([
      { match: (u) => u.includes("api.si.edu"), handler: async () => jsonResponse(fixture("smithsonian.json")) },
    ]);
    const out = await smithsonian.search("apollo", { fetcher });
    expect(out[0]!.license).toBe("CC0");
    expect(out[0]!.source).toBe("smithsonian");
  });

  test("met-museum → CC0, skips non-PD objects", async () => {
    const fetcher = stubFetcher([
      { match: (u) => u.includes("/search?"), handler: async () => jsonResponse(fixture("met-museum-search.json")) },
      { match: (u) => u.includes("/objects/"), handler: async () => jsonResponse(fixture("met-museum-object.json")) },
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
      { match: (u) => u.includes("api.flickr.com"), handler: async () => jsonResponse(fixture("flickr.json")) },
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
      { match: (u) => u.includes("api.europeana.eu"), handler: async () => jsonResponse(fixture("europeana.json")) },
    ]);
    const out = await europeana.search("portrait", {
      fetcher,
      auth: { europeanaApiKey: "test-key" },
    });
    expect(out.length).toBe(1);
    expect(out[0]!.license).toBe("CC_BY");
  });
});
