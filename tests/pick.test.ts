import { describe, expect, test } from "bun:test";
import { pickBest, rankAll } from "../packages/core/src/pick.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";

const mk = (p: Partial<ImageCandidate>): ImageCandidate => ({
  url: "https://x/1",
  source: "x",
  license: "UNKNOWN",
  ...p,
});

describe("pick", () => {
  test("safe-only rejects UNKNOWN", () => {
    const out = pickBest([mk({ license: "UNKNOWN", width: 3000, height: 3000 })]);
    expect(out).toBeNull();
  });

  test("CC0 > CC_BY > editorial tie-break", () => {
    const cands = [
      mk({ url: "a", license: "EDITORIAL_LICENSED", width: 2000, height: 2000 }),
      mk({ url: "b", license: "CC0", width: 800, height: 800 }),
      mk({ url: "c", license: "CC_BY", width: 1600, height: 1600 }),
    ];
    const best = pickBest(cands);
    expect(best?.url).toBe("b");
  });

  test("safe-only is a compatibility alias for context-safe editorial results", () => {
    const cands = [mk({ url: "a", license: "EDITORIAL_LICENSED", width: 2000, height: 2000 })];
    expect(pickBest(cands, { licensePolicy: "safe-only" })?.url).toBe("a");
    expect(pickBest(cands, { licensePolicy: "context-safe" })?.url).toBe("a");
  });

  test("open-only rejects editorial and press results", () => {
    const cands = [
      mk({ url: "a", license: "EDITORIAL_LICENSED", width: 3000, height: 3000 }),
      mk({ url: "b", license: "PRESS_KIT_ALLOWLIST", width: 3000, height: 3000 }),
    ];
    expect(rankAll(cands, { licensePolicy: "open-only" })).toEqual([]);
  });

  test("higher pixels wins within same license", () => {
    const cands = [
      mk({ url: "a", license: "CC_BY", width: 800, height: 800 }),
      mk({ url: "b", license: "CC_BY", width: 3000, height: 3000 }),
    ];
    expect(pickBest(cands)?.url).toBe("b");
  });

  test("prefer-safe keeps unsafe but sorts behind", () => {
    const cands = [
      mk({ url: "a", license: "UNKNOWN", width: 4000, height: 4000 }),
      mk({ url: "b", license: "CC_BY_SA", width: 1000, height: 1000 }),
    ];
    const r = rankAll(cands, { licensePolicy: "prefer-safe" });
    expect(r[0]?.url).toBe("b");
    expect(r.length).toBe(2);
  });

  test("minWidth filter", () => {
    const cands = [mk({ url: "a", license: "CC0", width: 300, height: 300 })];
    expect(pickBest(cands, { minWidth: 1000 })).toBeNull();
  });
});
