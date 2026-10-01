import { afterEach, expect, test } from "bun:test";
import { _resetCircuitBreakers, _resetHealthCache } from "webfetch-core";
import { run } from "../src/commands.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  _resetHealthCache();
  _resetCircuitBreakers();
});

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      stdout: (s: string) => out.push(s),
      stderr: (s: string) => err.push(s),
      env: {
        PATH: "/usr/bin",
        WEBFETCH_CONFIG: "/tmp/webfetch-test-does-not-exist.json",
      } as NodeJS.ProcessEnv,
    },
  };
}

test("providers --check --json reports status, latency and key status", async () => {
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("openverse")) throw new Error("ECONNREFUSED");
    if (u.includes("unsplash")) return new Response("", { status: 401 });
    return new Response("{}", { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  const cap = io();
  const code = await run(
    ["providers", "--check", "--json", "--providers", "openverse,unsplash,nasa,smithsonian"],
    cap.io,
  );
  const rows = JSON.parse(cap.out.join("\n"));
  const by = Object.fromEntries(rows.map((r: any) => [r.provider, r]));
  expect(by.openverse.status).toBe("down");
  expect(by.openverse.reason).toContain("ECONNREFUSED");
  expect(by.unsplash).toMatchObject({
    status: "up",
    auth: "missing",
    missingEnv: ["UNSPLASH_ACCESS_KEY"],
  });
  expect(by.nasa).toMatchObject({ status: "up", auth: "none-required" });
  expect(by.smithsonian.auth).toBe("optional");
  expect(typeof by.nasa.latencyMs).toBe("number");
  // openverse is a keyless default provider and it is down -> non-zero exit.
  expect(code).toBe(1);
});

test("providers --check exits 0 when every checked default provider is reachable", async () => {
  globalThis.fetch = (async () =>
    new Response("{}", {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  const cap = io();
  const code = await run(["providers", "--check", "--providers", "nasa,openverse"], cap.io);
  expect(code).toBe(0);
  expect(cap.out.join("\n")).toContain("2/2 reachable");
});
