import { afterEach, beforeEach, expect, test } from "bun:test";
import { run } from "../src/commands.ts";

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.UNSPLASH_ACCESS_KEY;
  delete process.env.UNSPLASH_ACCESS_KEY;
});
afterEach(() => {
  if (saved !== undefined) process.env.UNSPLASH_ACCESS_KEY = saved;
});

test("search with only keyed providers says which env var is missing (no --verbose)", async () => {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(["search", "bridge", "--providers", "unsplash"], {
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s),
    env: { PATH: "/usr/bin", WEBFETCH_CONFIG: "/tmp/webfetch-test-does-not-exist.json" },
  });
  expect(code).toBe(0);
  expect(out.join("\n")).toContain("No results.");
  expect(err.join("\n")).toContain("set UNSPLASH_ACCESS_KEY");
  expect(err.join("\n")).toContain("https://unsplash.com/developers");
});
