/**
 * Batch mode: feed stdin, honor concurrency, emit per-query summary.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { run } from "../src/commands.ts";
import { parseBatchLine } from "../src/commands.ts";
import { __setCoreForTests, core } from "../src/core.ts";

const originalCore = { ...core() };
let searched: string[] = [];
let concurrentPeak = 0;
let active = 0;

beforeEach(() => {
  searched = [];
  concurrentPeak = 0;
  active = 0;
  __setCoreForTests({
    searchImages: (async (q: string) => {
      active++;
      concurrentPeak = Math.max(concurrentPeak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      searched.push(q);
      return {
        candidates: [{ url: `https://a/${q}.jpg`, source: "wikimedia", license: "CC0" as const }],
        providerReports: [],
        warnings: [],
      };
    }) as any,
    downloadImage: (async (url: string) => ({
      bytes: new Uint8Array([1]),
      mime: "image/jpeg",
      sha256: "a".repeat(64),
      cachedPath: `/tmp/webfetch-batch/${encodeURIComponent(url)}`,
    })) as any,
  });
});

afterEach(() => {
  __setCoreForTests(originalCore);
});

function io(lines: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      env: { PATH: "/bin", WEBFETCH_CONFIG: "/nope" } as NodeJS.ProcessEnv,
      readStdin: async function* () {
        for (const l of lines) yield l;
      },
    },
    stdout: () => out.join("\n"),
    stderr: () => err.join("\n"),
  };
}

describe("parseBatchLine", () => {
  test("plain query", () => {
    expect(parseBatchLine("drake portrait")).toEqual({ query: "drake portrait" });
  });
  test("tab-separated providers", () => {
    expect(parseBatchLine("drake\twikimedia,openverse")).toEqual({
      query: "drake",
      providers: ["wikimedia", "openverse"] as any,
    });
  });
  test("skips comments and blanks", () => {
    expect(parseBatchLine("")).toBeUndefined();
    expect(parseBatchLine("# comment")).toBeUndefined();
  });
});

describe("batch dispatch", () => {
  test("3 lines → 3 queries, json output", async () => {
    const o = io(["one", "two", "three"]);
    const code = await run(["batch", "--json"], o.io);
    expect(code).toBe(0);
    const parsed = JSON.parse(o.stdout());
    expect(parsed.length).toBe(3);
    expect(parsed.map((r: any) => r.query).sort()).toEqual(["one", "three", "two"]);
    expect(searched.sort()).toEqual(["one", "three", "two"]);
  });

  test("concurrency cap is honored", async () => {
    const o = io(["a", "b", "c", "d", "e"]);
    const code = await run(["batch", "--concurrency", "2", "--json"], o.io);
    expect(code).toBe(0);
    expect(concurrentPeak).toBeLessThanOrEqual(2);
  });

  test("--download-best fetches top per query", async () => {
    const o = io(["x", "y"]);
    const downloads: string[] = [];
    __setCoreForTests({
      downloadImage: (async (url: string) => {
        downloads.push(url);
        return {
          bytes: new Uint8Array([1]),
          mime: "image/jpeg",
          sha256: "b".repeat(64),
          cachedPath: "/tmp/webfetch-batch-dl/cached",
        };
      }) as any,
    });
    const code = await run(["batch", "--download-best", "--json"], o.io);
    expect(code).toBe(0);
    expect(downloads.length).toBe(2);
  });

  test("--jsonl emits one stable status record per query", async () => {
    const o = io(["x", "y"]);
    const code = await run(["batch", "--jsonl", "--candidates", "1"], o.io);
    expect(code).toBe(0);
    const lines = o.stdout().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]!);
    expect(first.status).toBe("ok");
    expect(first.index).toBe(0);
    expect(first.candidates.length).toBe(1);
  });

  test("--continue-on-error keeps later records", async () => {
    __setCoreForTests({
      searchImages: (async (q: string) => {
        if (q === "bad") throw new Error("boom");
        return {
          candidates: [{ url: `https://a/${q}.jpg`, source: "wikimedia", license: "CC0" as const }],
          providerReports: [],
          warnings: [],
        };
      }) as any,
    });
    const o = io(["bad", "good"]);
    const code = await run(["batch", "--jsonl", "--continue-on-error"], o.io);
    expect(code).toBe(1);
    const lines = o.stdout().split("\n").map((line) => JSON.parse(line));
    expect(lines[0].status).toBe("error");
    expect(lines[1].status).toBe("ok");
  });

  test("empty stdin returns exit 2", async () => {
    const o = io([]);
    const code = await run(["batch", "--json"], o.io);
    expect(code).toBe(2);
  });
});
