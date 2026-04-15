/**
 * Interactive picker: stub core + simulated keystroke.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { run } from "../src/commands.ts";
import { __setCoreForTests, core } from "../src/core.ts";
import { promptChoice } from "../src/picker.ts";

const originalCore = { ...core() };

const CANDS = [
  {
    url: "https://a/1.jpg",
    source: "wikimedia",
    license: "CC0",
    width: 800,
    height: 600,
    title: "one",
  },
  {
    url: "https://a/2.jpg",
    source: "openverse",
    license: "CC_BY",
    width: 1200,
    height: 900,
    title: "two",
  },
];

let downloadCalls: any[] = [];

beforeEach(() => {
  downloadCalls = [];
  __setCoreForTests({
    searchImages: (async () => ({
      candidates: CANDS,
      providerReports: [],
      warnings: [],
    })) as any,
    downloadImage: (async (url: string) => {
      downloadCalls.push(url);
      return {
        bytes: new Uint8Array([1]),
        mime: "image/jpeg",
        sha256: "f".repeat(64),
        cachedPath: "/tmp/webfetch-picker-test/cached",
      };
    }) as any,
  });
});

afterEach(() => {
  __setCoreForTests(originalCore);
});

function io(keys: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  let i = 0;
  return {
    io: {
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      env: { PATH: "/bin", WEBFETCH_CONFIG: "/nope" } as NodeJS.ProcessEnv,
      readKey: async () => keys[Math.min(i++, keys.length - 1)]!,
      isTTY: true,
    },
    out,
    err,
  };
}

describe("promptChoice", () => {
  test("parses digit into pick", async () => {
    const o = io(["1"]);
    const c = await promptChoice(5, o.io);
    expect(c).toEqual({ kind: "pick", index: 0 });
  });
  test("q quits", async () => {
    const c = await promptChoice(3, io(["q"]).io);
    expect(c.kind).toBe("quit");
  });
  test("d downloads all", async () => {
    const c = await promptChoice(3, io(["d"]).io);
    expect(c.kind).toBe("download-all");
  });
  test("invalid then valid", async () => {
    const o = io(["z", "2"]);
    const c = await promptChoice(3, o.io);
    expect(c).toEqual({ kind: "pick", index: 1 });
    expect(o.err.some((e) => e.includes("invalid"))).toBe(true);
  });
});

describe("--pick integration", () => {
  test("selecting 1 triggers download for candidate 1", async () => {
    const o = io(["1"]);
    const code = await run(["search", "drake", "--pick"], o.io);
    expect(code).toBe(0);
    expect(downloadCalls).toEqual([CANDS[0]!.url]);
  });

  test("d downloads all candidates", async () => {
    const o = io(["d"]);
    const code = await run(["search", "drake", "--pick"], o.io);
    expect(code).toBe(0);
    expect(downloadCalls).toEqual([CANDS[0]!.url, CANDS[1]!.url]);
  });

  test("q exits silently", async () => {
    const o = io(["q"]);
    const code = await run(["search", "drake", "--pick"], o.io);
    expect(code).toBe(0);
    expect(downloadCalls).toEqual([]);
  });

  test("--json disables picker", async () => {
    const o = io(["1"]);
    const code = await run(["search", "drake", "--pick", "--json"], o.io);
    expect(code).toBe(0);
    expect(downloadCalls).toEqual([]);
  });
});
