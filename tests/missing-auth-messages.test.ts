/**
 * Missing provider keys must produce an actionable message (which env var,
 * where to get one) instead of a silent skip / bare "No results.".
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  PROVIDER_AUTH,
  missingAuthMessage,
  missingProviderEnv,
  searchImages,
} from "../packages/core/src/index.ts";
import { missingKeyLine } from "../packages/mcp/src/render.ts";
import { startupNotices } from "../packages/mcp/src/server.ts";
import { TOOLS } from "../packages/mcp/src/tools.ts";

const VARS = [
  "UNSPLASH_ACCESS_KEY",
  "PEXELS_API_KEY",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
];
let saved: Record<string, string | undefined> = {};
const noNetwork = (async () => {
  throw new Error("network not allowed in this test");
}) as unknown as typeof fetch;

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  for (const v of VARS) delete process.env[v];
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("missing provider keys", () => {
  test("every keyed provider has a signup URL except retired bing", () => {
    for (const [id, req] of Object.entries(PROVIDER_AUTH)) {
      if (id === "bing") continue;
      expect(req?.signupUrl, id).toMatch(/^https:\/\//);
    }
  });

  test("missingProviderEnv names only what is still missing", () => {
    expect(missingProviderEnv("wikimedia", undefined, {})).toEqual([]);
    expect(missingProviderEnv("unsplash", undefined, {})).toEqual(["UNSPLASH_ACCESS_KEY"]);
    expect(missingProviderEnv("unsplash", { unsplashAccessKey: "k" }, {})).toEqual([]);
    expect(missingProviderEnv("unsplash", undefined, { UNSPLASH_ACCESS_KEY: "k" })).toEqual([]);
    expect(missingProviderEnv("spotify", { spotifyClientId: "id" }, {})).toEqual([
      "SPOTIFY_CLIENT_SECRET",
    ]);
  });

  test("message names the env var and signup URL", () => {
    const msg = missingAuthMessage("unsplash", ["UNSPLASH_ACCESS_KEY"]);
    expect(msg).toContain("set UNSPLASH_ACCESS_KEY");
    expect(msg).toContain("https://unsplash.com/developers");
  });

  test("searchImages: explicit keyed providers report why and warn", async () => {
    const out = await searchImages("bridge", {
      providers: ["unsplash", "spotify"],
      auth: { spotifyClientId: "id-only" },
      fetcher: noNetwork,
    });
    expect(out.candidates).toEqual([]);
    const u = out.providerReports.find((r) => r.provider === "unsplash")!;
    expect(u.skipped).toBe("missing-auth");
    expect(u.error).toContain("UNSPLASH_ACCESS_KEY");
    expect(u.errorContext).toMatchObject({
      missingEnv: ["UNSPLASH_ACCESS_KEY"],
      signupUrl: "https://unsplash.com/developers",
    });
    const s = out.providerReports.find((r) => r.provider === "spotify")!;
    expect(s.errorContext?.missingEnv).toEqual(["SPOTIFY_CLIENT_SECRET"]);
    expect(out.warnings.some((w) => w.includes("set UNSPLASH_ACCESS_KEY"))).toBe(true);
    expect(out.warnings.some((w) => w.includes("set SPOTIFY_CLIENT_SECRET"))).toBe(true);
  });

  test("MCP search_images text explains an all-skipped search", async () => {
    const t = TOOLS.find((x) => x.name === "search_images")!;
    const res = await t.handler({ query: "bridge", providers: ["unsplash", "pexels"] });
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain("none of the 2 requested provider(s) ran");
    expect(text).toContain("set UNSPLASH_ACCESS_KEY");
    expect(text).toContain("set PEXELS_API_KEY");
    const reports = (res.structuredContent as any).providerReports;
    expect(reports[0].error).toContain("needs an API key");
    expect(reports[0].errorContext.missingEnv).toBeTruthy();
  });

  test("missingKeyLine summarizes default-set skips without repeating warnings", () => {
    const reports = [
      { provider: "wikimedia", ok: true, count: 3, timeMs: 5 },
      {
        provider: "unsplash",
        ok: false,
        count: 0,
        timeMs: 0,
        skipped: "missing-auth",
        error: "unsplash needs an API key: set UNSPLASH_ACCESS_KEY",
        errorContext: { missingEnv: ["UNSPLASH_ACCESS_KEY"] },
      },
      {
        provider: "spotify",
        ok: false,
        count: 0,
        timeMs: 0,
        skipped: "missing-auth",
        error: "spotify …",
        errorContext: { missingEnv: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"] },
      },
    ] as any;
    const line = missingKeyLine(reports);
    expect(line).toContain("unsplash (UNSPLASH_ACCESS_KEY)");
    expect(line).toContain("spotify (SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET)");
    expect(
      missingKeyLine(reports, ["spotify …", "unsplash needs an API key: set UNSPLASH_ACCESS_KEY"]),
    ).toBe("");
    expect(missingKeyLine([reports[0]])).toBe("");
  });

  test("MCP startup warns when WEBFETCH_API_KEY is set (it is not used locally)", () => {
    expect(startupNotices({})).toEqual([]);
    const [note] = startupNotices({ WEBFETCH_API_KEY: "wf_live_x" });
    expect(note).toContain("does not use it");
  });
});
