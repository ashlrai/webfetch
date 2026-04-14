import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  extractGenericPage,
  extractGoogleImages,
  extractPinterest,
  extractTwitter,
} from "../src/index.ts";

const FIX = join(import.meta.dir, "fixtures");
const read = (name: string) => readFileSync(join(FIX, name), "utf8");

describe("generic-page extractor", () => {
  const html = read("og-tagged-page.html");
  const result = extractGenericPage({
    html,
    sourcePageUrl: "https://example.com/band",
  });

  it("captures og:image + twitter:image + image_src", () => {
    const urls = result.candidates.map((c) => c.url);
    expect(urls).toContain("https://cdn.example.com/hero.jpg");
    expect(urls).toContain("https://cdn.example.com/twitter-card.png");
    expect(urls).toContain("https://example.com/static/linked-hero.webp");
  });

  it("captures <img> tags and resolves relative URLs", () => {
    const urls = result.candidates.map((c) => c.url);
    expect(urls).toContain("https://cdn.example.com/photo1.jpg");
    expect(urls).toContain("https://example.com/relative/photo2.png");
  });

  it("skips data: URIs", () => {
    for (const c of result.candidates) {
      expect(c.url.startsWith("data:")).toBe(false);
    }
  });

  it("captures linked high-res images", () => {
    const urls = result.candidates.map((c) => c.url);
    expect(urls).toContain(
      "https://cdn.example.com/downloads/press-kit-hires.jpg",
    );
  });

  it("tags every candidate as browser-fallback with UNKNOWN license", () => {
    for (const c of result.candidates) {
      expect(c.license).toBe("UNKNOWN");
      expect(c.viaBrowserFallback).toBe(true);
      expect(c.source).toBe("browser");
    }
  });
});

describe("google-images extractor", () => {
  const html = read("google-images-response.html");
  const result = extractGoogleImages({
    html,
    sourcePageUrl: "https://www.google.com/search?tbm=isch&q=drake",
  });

  it("parses at least 5 candidates from embedded JSON", () => {
    expect(result.candidates.length).toBeGreaterThanOrEqual(5);
  });

  it("attaches width + height", () => {
    const first = result.candidates[0];
    expect(first).toBeDefined();
    expect(first!.width).toBeGreaterThan(0);
    expect(first!.height).toBeGreaterThan(0);
  });

  it("decodes /imgres links into full + ref URLs", () => {
    const urls = result.candidates.map((c) => c.url);
    expect(urls).toContain("https://third.example.com/drake-extra.jpg");
    const third = result.candidates.find(
      (c) => c.url === "https://third.example.com/drake-extra.jpg",
    );
    expect(third?.sourcePageUrl).toBe("https://third.example.com/article");
  });

  it("skips gstatic branding URLs", () => {
    for (const c of result.candidates) {
      expect(c.url.includes("gstatic.com/images/branding")).toBe(false);
    }
  });
});

describe("pinterest extractor", () => {
  const html = read("pinterest-board.html");
  const result = extractPinterest({
    html,
    sourcePageUrl: "https://www.pinterest.com/search/pins/?q=editorial",
  });

  it("returns at least 3 pinimg candidates", () => {
    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
  });

  it("upgrades sized pinimg thumbnails to /originals/", () => {
    const urls = result.candidates.map((c) => c.url);
    // 564x pin-b.jpg was upgraded
    expect(urls.some((u) => u === "https://i.pinimg.com/originals/44/55/66/pin-b.jpg")).toBe(true);
    // 736x pin-c.jpg was upgraded
    expect(urls.some((u) => u === "https://i.pinimg.com/originals/77/88/99/pin-c.jpg")).toBe(true);
  });

  it("records the thumbnail URL when upgrading", () => {
    const upgraded = result.candidates.find(
      (c) => c.url === "https://i.pinimg.com/originals/44/55/66/pin-b.jpg",
    );
    expect(upgraded?.thumbnailUrl).toBe(
      "https://i.pinimg.com/564x/44/55/66/pin-b.jpg",
    );
  });
});

describe("twitter extractor", () => {
  const html = `
    <meta property="og:image" content="https://pbs.twimg.com/media/og.jpg" />
    <img src="https://pbs.twimg.com/media/abc123?format=jpg&amp;name=small" />
  `;
  const result = extractTwitter({
    html,
    sourcePageUrl: "https://x.com/user/status/1",
  });

  it("upgrades pbs.twimg.com name=small → name=orig", () => {
    const urls = result.candidates.map((c) => c.url);
    expect(urls.some((u) => /name=orig/.test(u))).toBe(true);
  });

  it("emits a stub warning", () => {
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
