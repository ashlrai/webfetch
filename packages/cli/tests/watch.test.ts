/**
 * Watch mode: state file persistence, new-candidate diffing.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { run } from "../src/commands.ts";
import { __setCoreForTests, core } from "../src/core.ts";
import { diffNew, mergeState, parseInterval, watchStatePath } from "../src/watch.ts";

const originalCore = { ...core() };
let home: string;
let searchResults: any[] = [];

function ioOf() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      env: { PATH: "/bin", HOME: home, WEBFETCH_CONFIG: "/nope" } as NodeJS.ProcessEnv,
    },
    stdout: () => out.join("\n"),
  };
}

beforeEach(async () => {
  home = resolve(tmpdir(), `webfetch-watch-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(home, { recursive: true });
  __setCoreForTests({
    searchImages: (async () => ({
      candidates: searchResults,
      providerReports: [],
      warnings: [],
    })) as any,
  });
});

afterEach(async () => {
  __setCoreForTests(originalCore);
  await rm(home, { recursive: true, force: true });
});

describe("parseInterval", () => {
  test("s/m/h/d units", () => {
    expect(parseInterval("30s")).toBe(30_000);
    expect(parseInterval("15m")).toBe(900_000);
    expect(parseInterval("2h")).toBe(7_200_000);
    expect(parseInterval("1d")).toBe(86_400_000);
  });
  test("bad input throws", () => {
    expect(() => parseInterval("never")).toThrow();
  });
});

describe("diffNew + mergeState", () => {
  test("no prev state → all new", () => {
    const cands = [{ url: "a" }, { url: "b" }] as any;
    expect(diffNew(undefined, cands).length).toBe(2);
  });
  test("prev state filters seen", () => {
    const cands = [{ url: "a" }, { url: "b" }] as any;
    const prev = { query: "q", firstSeen: "x", lastSeen: "y", urls: ["a"] };
    expect(diffNew(prev, cands).map((c) => c.url)).toEqual(["b"]);
  });
});

describe("watch --once", () => {
  test("first tick writes state", async () => {
    searchResults = [{ url: "u1", source: "wikimedia", license: "CC0" }];
    const o = ioOf();
    const code = await run(["watch", "alpha", "--once", "--interval", "1h"], o.io);
    expect(code).toBe(0);
    const path = watchStatePath("alpha", o.io.env!);
    expect(existsSync(path)).toBe(true);
  });

  test("second tick: same results → 0 new; new candidate → 1 new", async () => {
    searchResults = [{ url: "u1", source: "wikimedia", license: "CC0" }];
    const o1 = ioOf();
    // Seed state at this home.
    await run(["watch", "bravo", "--once", "--interval", "1h", "--json"], o1.io);

    // Second tick, same results.
    const o2 = {
      io: {
        stdout: (s: string) => void 0,
        stderr: (s: string) => void 0,
        env: o1.io.env,
      } as any,
      captured: [] as string[],
    };
    o2.io.stdout = (s: string) => o2.captured.push(s);
    await run(["watch", "bravo", "--once", "--interval", "1h", "--json"], o2.io);
    const second = JSON.parse(o2.captured.join("\n"));
    expect(second.new.length).toBe(0);

    // Third tick — new url appears.
    searchResults = [
      { url: "u1", source: "wikimedia", license: "CC0" },
      { url: "u2", source: "wikimedia", license: "CC0" },
    ];
    const o3 = { captured: [] as string[], io: { ...o2.io, stdout: (s: string) => {} } };
    o3.io.stdout = (s: string) => o3.captured.push(s);
    await run(["watch", "bravo", "--once", "--interval", "1h", "--json"], o3.io);
    const third = JSON.parse(o3.captured.join("\n"));
    expect(third.new.length).toBe(1);
    expect(third.new[0].url).toBe("u2");
  });
});
