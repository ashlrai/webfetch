import { describe, expect, it } from "bun:test";

import { BrowserCache } from "../src/index.ts";

describe("BrowserCache", () => {
  it("round-trips values in memory", async () => {
    const cache = new BrowserCache();
    const key = cache.key({ q: "drake", stack: "vanilla" });
    expect(await cache.get(key)).toBeNull();
    await cache.set(key, { hello: "world" });
    expect(await cache.get<{ hello: string }>(key)).toEqual({ hello: "world" });
  });

  it("produces stable keys regardless of property order", () => {
    const cache = new BrowserCache();
    const a = cache.key({ q: "x", stack: "vanilla" });
    const b = cache.key({ stack: "vanilla", q: "x" });
    expect(a).toBe(b);
  });
});
