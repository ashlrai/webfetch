import { describe, expect, test } from "bun:test";
import { extractImages } from "../packages/core/src/probe-page.ts";
import { parseHtmlLicense } from "../packages/core/src/fetch-with-license.ts";
import { fixtureText } from "./stub-fetcher.ts";

test("extractImages pulls imgs + og:image, resolves relative urls", () => {
  const html = fixtureText("og-page.html");
  const imgs = extractImages(html, "https://example.org/a/b");
  const urls = imgs.map((i) => i.url);
  expect(urls).toContain("https://example.org/p/a.jpg");
  expect(urls).toContain("https://cdn.example.com/b.jpg");
  expect(urls).toContain("https://example.com/hero.jpg");
});

test("parseHtmlLicense honors <link rel=license>", () => {
  const html = fixtureText("og-page.html");
  const out = parseHtmlLicense(html, "https://example.org/a/b");
  expect(out.license).toBe("CC_BY");
  expect(out.author).toBe("Jane Photog");
});
