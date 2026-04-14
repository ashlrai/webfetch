import { describe, expect, test } from "bun:test";
import { dedupeByHash, dedupeByUrl, perceptualHash } from "../packages/core/src/dedupe.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";

const mk = (url: string, phash?: string): ImageCandidate => ({
  url,
  source: "x",
  license: "CC0",
  phash,
});

test("dedupeByUrl collapses query-param variants", () => {
  const cands = [
    mk("https://ex.com/a.jpg?w=200"),
    mk("https://ex.com/a.jpg?w=1600&q=80"),
    mk("https://ex.com/b.jpg"),
  ];
  const out = dedupeByUrl(cands);
  expect(out.length).toBe(2);
});

test("dedupeByHash collapses near-identical phashes", () => {
  const a = mk("a", "abcdef1234567890");
  const b = mk("b", "abcdef1234567890"); // identical
  const c = mk("c", "ffffffff00000000"); // very different
  const out = dedupeByHash([a, b, c], 6);
  expect(out.length).toBe(2);
});

test("perceptualHash returns stable hex for identical bytes", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const h1 = await perceptualHash(bytes);
  const h2 = await perceptualHash(bytes);
  expect(h1).toBe(h2);
  expect(h1).toMatch(/^[0-9a-f]{16}$/);
});
