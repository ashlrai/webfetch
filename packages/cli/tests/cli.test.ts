/**
 * CLI surface tests. The core seam (`src/core.ts`) is stubbed — no network.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { parseArgs } from "../src/args.ts";
import { run } from "../src/commands.ts";
import { __setCoreForTests, core } from "../src/core.ts";

function captureIO() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      env: {
        PATH: "/usr/bin",
        WEBFETCH_CONFIG: "/tmp/webfetch-test-does-not-exist.json",
      } as NodeJS.ProcessEnv,
    },
    out,
    err,
    stdout: () => out.join("\n"),
    stderr: () => err.join("\n"),
  };
}

const FAKE_CANDIDATE = {
  url: "https://example.com/pic.jpg",
  source: "wikimedia",
  license: "CC_BY_SA" as const,
  width: 1200,
  height: 800,
  title: "Example",
  attributionLine: "attrib",
  confidence: 0.9,
};

const FAKE_BUNDLE = {
  candidates: [FAKE_CANDIDATE],
  providerReports: [{ provider: "wikimedia" as const, ok: true, count: 1, timeMs: 5 }],
  warnings: [],
};

let calls: Record<string, any[]> = {};
const originalCore = { ...core() };

beforeEach(() => {
  calls = {
    searchImages: [],
    searchArtistImages: [],
    searchAlbumCover: [],
    downloadImage: [],
    probePage: [],
    fetchWithLicense: [],
  };
  __setCoreForTests({
    searchImages: (async (q: string, o?: any) => {
      calls.searchImages!.push({ q, o });
      return FAKE_BUNDLE;
    }) as any,
    searchArtistImages: (async (a: string, k: string, o?: any) => {
      calls.searchArtistImages!.push({ a, k, o });
      return FAKE_BUNDLE;
    }) as any,
    searchAlbumCover: (async (a: string, al: string, o?: any) => {
      calls.searchAlbumCover!.push({ a, al, o });
      return FAKE_BUNDLE;
    }) as any,
    downloadImage: (async (u: string, o?: any) => {
      calls.downloadImage!.push({ u, o });
      return {
        bytes: new Uint8Array([1, 2, 3]),
        mime: "image/jpeg",
        sha256: "abc123def456abc123def456abc123def456abc123def456abc123def4567890",
        cachedPath: "/tmp/webfetch-test/cached",
      };
    }) as any,
    probePage: (async (u: string) => {
      calls.probePage!.push({ u });
      return { images: [{ url: "https://x/y.png", license: "CC0", width: 100, height: 50 }] };
    }) as any,
    fetchWithLicense: (async (u: string, o?: any) => {
      calls.fetchWithLicense!.push({ u, o });
      return { license: "CC0", confidence: 0.8, sourcePageUrl: u, attributionLine: "line" };
    }) as any,
  });
});

afterEach(() => {
  __setCoreForTests(originalCore);
});

describe("parseArgs", () => {
  test("handles positional + long flags", () => {
    const r = parseArgs(["drake", "portrait", "--json", "--limit", "5"]);
    expect(r.positional).toEqual(["drake", "portrait"]);
    expect(r.flags.json).toBe(true);
    expect(r.flags.limit).toBe("5");
  });
  test("handles --flag=value form", () => {
    const r = parseArgs(["--providers=wikimedia,openverse", "q"]);
    expect(r.flags.providers).toBe("wikimedia,openverse");
    expect(r.positional).toEqual(["q"]);
  });
  test("handles short flags", () => {
    const r = parseArgs(["-n", "3", "foo"]);
    expect(r.flags.n).toBe("3");
    expect(r.positional).toEqual(["foo"]);
  });
  test("boolean --json does not consume next positional", () => {
    const r = parseArgs(["search", "--json", "query"]);
    expect(r.flags.json).toBe(true);
    expect(r.positional).toEqual(["search", "query"]);
  });
  test("-- sentinel turns remaining tokens into positionals", () => {
    const r = parseArgs(["--", "--weird", "token"]);
    expect(r.positional).toEqual(["--weird", "token"]);
  });
});

describe("search dispatch", () => {
  test("search exits 0 with JSON output when --json is set", async () => {
    const cap = captureIO();
    const code = await run(["search", "drake", "portrait", "--json"], cap.io);
    expect(code).toBe(0);
    expect(calls.searchImages!.length).toBe(1);
    expect(calls.searchImages![0].q).toBe("drake portrait");
    const parsed = JSON.parse(cap.stdout());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].url).toBe(FAKE_CANDIDATE.url);
  });

  test("search missing query returns usage error (exit 2)", async () => {
    const cap = captureIO();
    const code = await run(["search"], cap.io);
    expect(code).toBe(2);
    expect(cap.stderr()).toContain("usage");
  });

  test("search renders a table by default", async () => {
    const cap = captureIO();
    const code = await run(["search", "drake"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout()).toContain("wikimedia");
    expect(cap.stdout()).toContain("CC_BY_SA");
  });

  test("search honors --providers and --license flags", async () => {
    const cap = captureIO();
    const code = await run(
      ["search", "x", "--providers", "wikimedia,openverse", "--license", "any"],
      cap.io,
    );
    expect(code).toBe(0);
    expect(calls.searchImages![0].o.providers).toEqual(["wikimedia", "openverse"]);
    expect(calls.searchImages![0].o.licensePolicy).toBe("any");
  });

  test("artist dispatches with kind", async () => {
    const cap = captureIO();
    const code = await run(["artist", "Taylor", "Swift", "--kind", "album", "--json"], cap.io);
    expect(code).toBe(0);
    expect(calls.searchArtistImages![0].a).toBe("Taylor Swift");
    expect(calls.searchArtistImages![0].k).toBe("album");
  });

  test("album dispatches with artist + album positionals", async () => {
    const cap = captureIO();
    const code = await run(["album", "Radiohead", "In", "Rainbows", "--json"], cap.io);
    expect(code).toBe(0);
    expect(calls.searchAlbumCover![0].a).toBe("Radiohead");
    expect(calls.searchAlbumCover![0].al).toBe("In Rainbows");
  });

  test("no-results emits message and exits 0", async () => {
    __setCoreForTests({
      searchImages: (async () => ({ candidates: [], providerReports: [], warnings: [] })) as any,
    });
    const cap = captureIO();
    const code = await run(["search", "nothing"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout()).toContain("No results");
  });
});

describe("download", () => {
  test("renders Saved line + calls downloadImage", async () => {
    const cap = captureIO();
    const code = await run(["download", "https://example.com/a.jpg"], cap.io);
    expect(code).toBe(0);
    expect(calls.downloadImage![0].u).toBe("https://example.com/a.jpg");
    expect(cap.stdout()).toContain("Saved");
  });

  test("--json emits structured record", async () => {
    const cap = captureIO();
    const code = await run(["download", "https://example.com/a.jpg", "--json"], cap.io);
    expect(code).toBe(0);
    const obj = JSON.parse(cap.stdout());
    expect(obj.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(obj.mime).toBe("image/jpeg");
  });

  test("missing url returns exit 2", async () => {
    const cap = captureIO();
    const code = await run(["download"], cap.io);
    expect(code).toBe(2);
  });
});

describe("providers / probe / license / help / version", () => {
  test("providers lists without network", async () => {
    const cap = captureIO();
    const code = await run(["providers"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout()).toContain("wikimedia");
    expect(cap.stdout()).toContain("serpapi");
  });

  test("providers --json is valid JSON", async () => {
    const cap = captureIO();
    const code = await run(["providers", "--json"], cap.io);
    expect(code).toBe(0);
    const arr = JSON.parse(cap.stdout());
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.find((r: any) => r.id === "wikimedia")).toBeTruthy();
  });

  test("probe calls probePage + renders table", async () => {
    const cap = captureIO();
    const code = await run(["probe", "https://example.com/"], cap.io);
    expect(code).toBe(0);
    expect(calls.probePage![0].u).toBe("https://example.com/");
    expect(cap.stdout()).toContain("https://x/y.png");
  });

  test("license --json emits structured output", async () => {
    const cap = captureIO();
    const code = await run(["license", "https://example.com/x", "--json"], cap.io);
    expect(code).toBe(0);
    const obj = JSON.parse(cap.stdout());
    expect(obj.license).toBe("CC0");
  });

  test("help prints usage and exits 0", async () => {
    const cap = captureIO();
    const code = await run(["help"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout()).toContain("USAGE");
  });

  test("version prints version string", async () => {
    const cap = captureIO();
    const code = await run(["version"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout()).toContain("0.1.0");
  });

  test("unknown command exits 2", async () => {
    const cap = captureIO();
    const code = await run(["bogus"], cap.io);
    expect(code).toBe(2);
    expect(cap.stderr()).toContain("unknown");
  });
});
