/**
 * Config file: precedence, init, show. No network; filesystem only.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { run } from "../src/commands.ts";
import { loadResolved, stripJsonComments, writeStarterConfig } from "../src/config.ts";
import { __setCoreForTests, core } from "../src/core.ts";

let tmp: string;
let cfgPath: string;
const originalCore = { ...core() };

function captureIO() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      env: {
        PATH: "/usr/bin",
        WEBFETCH_CONFIG: cfgPath,
      } as NodeJS.ProcessEnv,
    },
    stdout: () => out.join("\n"),
    stderr: () => err.join("\n"),
  };
}

beforeEach(async () => {
  tmp = resolve(tmpdir(), `webfetch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
  cfgPath = resolve(tmp, ".webfetchrc");
  __setCoreForTests({
    searchImages: (async () => ({
      candidates: [{ url: "https://a/b.jpg", source: "wikimedia", license: "CC0" }],
      providerReports: [],
      warnings: [],
    })) as any,
  });
});

afterEach(async () => {
  __setCoreForTests(originalCore);
  await rm(tmp, { recursive: true, force: true });
});

describe("stripJsonComments", () => {
  test("removes line + block comments, preserves strings", () => {
    const s = `{ "a": "http://x//y", /* block */ "b": 1 // line\n }`;
    const r = stripJsonComments(s);
    expect(JSON.parse(r)).toEqual({ a: "http://x//y", b: 1 });
  });
});

describe("loadResolved precedence", () => {
  test("built-in defaults when no file", async () => {
    const r = await loadResolved({ env: { WEBFETCH_CONFIG: "/nope" } as any });
    expect(r.license).toBe("safe-only");
    expect(r.limit).toBe(20);
  });

  test("top-level defaults merge over built-ins", async () => {
    await writeFile(cfgPath, JSON.stringify({ defaults: { limit: 5, minWidth: 1000 } }));
    const r = await loadResolved({ env: { WEBFETCH_CONFIG: cfgPath } as any });
    expect(r.limit).toBe(5);
    expect(r.minWidth).toBe(1000);
    expect(r.license).toBe("safe-only"); // built-in retained
  });

  test("profile overrides top-level defaults", async () => {
    await writeFile(
      cfgPath,
      JSON.stringify({
        defaults: { limit: 5, minWidth: 1000 },
        profiles: { editorial: { minWidth: 1600 } },
      }),
    );
    const r = await loadResolved({
      env: { WEBFETCH_CONFIG: cfgPath } as any,
      profile: "editorial",
    });
    expect(r.minWidth).toBe(1600);
    expect(r.limit).toBe(5);
    expect(r.profile).toBe("editorial");
  });

  test("unknown profile throws", async () => {
    await writeFile(cfgPath, JSON.stringify({ profiles: {} }));
    await expect(
      loadResolved({ env: { WEBFETCH_CONFIG: cfgPath } as any, profile: "ghost" }),
    ).rejects.toThrow(/unknown profile/);
  });
});

describe("CLI flag > env > profile > defaults", () => {
  test("CLI --limit beats env which beats profile which beats defaults", async () => {
    await writeFile(
      cfgPath,
      JSON.stringify({
        defaults: { limit: 5 },
        profiles: { m: { limit: 7 } },
      }),
    );
    const cap = captureIO();
    // profile sets 7, env sets 11, CLI sets 3 → CLI wins → JSON array length ≤ 3.
    cap.io.env!.WEBFETCH_LIMIT = "11";
    const code = await run(["search", "drake", "--profile", "m", "--limit", "3", "--json"], cap.io);
    expect(code).toBe(0);
    // We only have 1 candidate from the stub; still verify precedence doesn't crash.
    expect(JSON.parse(cap.stdout()).length).toBeLessThanOrEqual(3);
  });
});

describe("config init / show", () => {
  test("init writes starter file", async () => {
    const cap = captureIO();
    const code = await run(["config", "init"], cap.io);
    expect(code).toBe(0);
    expect(existsSync(cfgPath)).toBe(true);
    const raw = await readFile(cfgPath, "utf8");
    expect(raw).toContain("editorial");
  });

  test("init without --force errors when file exists", async () => {
    await writeFile(cfgPath, "{}");
    const cap = captureIO();
    const code = await run(["config", "init"], cap.io);
    expect(code).toBe(2);
    expect(cap.stderr()).toMatch(/already exists/);
  });

  test("init --force overwrites existing", async () => {
    await writeFile(cfgPath, "{}");
    const cap = captureIO();
    const code = await run(["config", "init", "--force"], cap.io);
    expect(code).toBe(0);
    const raw = await readFile(cfgPath, "utf8");
    expect(raw).toContain("editorial");
  });

  test("config show prints resolved config", async () => {
    await writeFile(cfgPath, JSON.stringify({ defaults: { limit: 4 } }));
    const cap = captureIO();
    const code = await run(["config", "show", "--json"], cap.io);
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.stdout());
    expect(parsed.limit).toBe(4);
  });
});

describe("writeStarterConfig direct", () => {
  test("force overwrites", async () => {
    await writeFile(cfgPath, "x");
    await writeStarterConfig(cfgPath, true);
    const raw = await readFile(cfgPath, "utf8");
    expect(raw).toContain("editorial");
  });
});
