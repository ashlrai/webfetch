import { describe, expect, it } from "bun:test";

import { createBrowserBucket } from "../src/rate-limit.ts";

describe("createBrowserBucket", () => {
  it("allows up to capacity synchronously then blocks", () => {
    const b = createBrowserBucket(3);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
  });

  it("refills over time", async () => {
    // 6000/min = 100/sec = 0.1/ms. Drain then wait 25ms → ~2.5 tokens.
    const b = createBrowserBucket(6000);
    for (let i = 0; i < 6000; i++) b.tryTake();
    expect(b.tryTake()).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(b.tryTake()).toBe(true);
  });
});
