import { describe, expect, it } from "bun:test";

import type { ImageCandidate } from "@webfetch/core";
import { buildSidecar, tagCandidate } from "../src/index.ts";

const base: ImageCandidate = {
  url: "https://example.com/a.jpg",
  source: "browser",
  sourcePageUrl: "https://example.com/page",
  license: "UNKNOWN",
  confidence: 0,
};

describe("attribution", () => {
  it("builds a sidecar with a schema version", () => {
    const side = buildSidecar({
      candidate: base,
      extractor: "generic-page",
      stack: "vanilla",
    });
    expect(side.schema).toBe("webfetch.browser.attribution/1");
    expect(side.fetchedVia).toBe("browser:generic-page");
    expect(side.consentAcknowledged).toBe(true);
    expect(side.imageUrl).toBe(base.url);
  });

  it("tags candidates with extractor + stack on raw", () => {
    const tagged = tagCandidate(base, "pinterest", "brightdata");
    expect(tagged.viaBrowserFallback).toBe(true);
    const raw = tagged.raw as Record<string, unknown>;
    expect(raw.fetchedVia).toBe("browser:pinterest");
    expect(raw.stack).toBe("brightdata");
  });
});
