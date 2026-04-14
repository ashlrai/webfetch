import { describe, expect, test } from "bun:test";
import { searchImages } from "../packages/core/src/federation.ts";
import { fixture, jsonResponse, stubFetcher } from "./stub-fetcher.ts";

describe("federation", () => {
  test("dryRun reports providers without network", async () => {
    const out = await searchImages("drake", {
      providers: ["wikimedia", "openverse"],
      dryRun: true,
    });
    expect(out.candidates.length).toBe(0);
    expect(out.providerReports.map((r) => r.provider).sort()).toEqual(["openverse", "wikimedia"]);
    expect(out.warnings.some((w) => w.includes("dryRun"))).toBe(true);
  });

  test("merges wikimedia + openverse + itunes + musicbrainz, dedupes, ranks", async () => {
    const mb = fixture("musicbrainz.json");
    const fetcher = stubFetcher([
      { match: (u) => u.includes("commons.wikimedia.org"), handler: async () => jsonResponse(fixture("wikimedia.json")) },
      { match: (u) => u.includes("api.openverse.org"), handler: async () => jsonResponse(fixture("openverse.json")) },
      { match: (u) => u.includes("itunes.apple.com"), handler: async () => jsonResponse(fixture("itunes.json")) },
      { match: (u) => u.includes("musicbrainz.org"), handler: async () => jsonResponse(mb) },
    ]);
    const out = await searchImages("Drake", {
      providers: ["wikimedia", "openverse", "itunes", "musicbrainz-caa"],
      fetcher,
      licensePolicy: "safe-only",
    });
    expect(out.candidates.length).toBeGreaterThan(0);
    // CC BY-SA 4.0 from wikimedia should rank above editorial iTunes
    const first = out.candidates[0]!;
    expect(["wikimedia", "openverse"]).toContain(first.source);
    expect(first.attributionLine).toBeTruthy();
    // All reports present
    expect(out.providerReports.filter((r) => r.ok).length).toBe(4);
  });

  test("failing provider does not fail federation", async () => {
    const fetcher = stubFetcher([
      { match: (u) => u.includes("commons.wikimedia.org"), handler: async () => jsonResponse(fixture("wikimedia.json")) },
      { match: (u) => u.includes("openverse"), handler: async () => new Response("boom", { status: 500 }) },
    ]);
    const out = await searchImages("x", { providers: ["wikimedia", "openverse"], fetcher });
    expect(out.candidates.length).toBeGreaterThan(0);
    const failed = out.providerReports.find((r) => r.provider === "openverse");
    expect(failed?.ok).toBe(false);
  });
});
