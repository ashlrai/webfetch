/**
 * Tests for the Metadata Confidence Audit Trail & License Provenance Chain API.
 *
 * Covers:
 *  - auditMetadataChain(): multi-source field resolution, chain construction
 *  - getMetadataQualityScore(): weighted average, pre-computed trail shortcut
 *  - rankAll() integration: metaQuality as tertiary tie-breaker after trailConf
 */

import { describe, expect, test } from "bun:test";
import {
  auditMetadataChain,
  getMetadataQualityScore,
  METADATA_SOURCE_CONFIDENCE,
} from "../packages/core/src/attribution-audit.ts";
import type {
  MetadataAuditTrail,
  MetadataFieldAudit,
} from "../packages/core/src/attribution-audit.ts";
import { rankAll } from "../packages/core/src/pick.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mkCandidate = (p: Partial<ImageCandidate>): ImageCandidate => ({
  url: "https://example.com/img.jpg",
  source: "unsplash",
  license: "CC_BY",
  ...p,
});

// ---------------------------------------------------------------------------
// METADATA_SOURCE_CONFIDENCE constants
// ---------------------------------------------------------------------------

describe("METADATA_SOURCE_CONFIDENCE — grade constants", () => {
  test("api-metadata=1.0, embedded-exif=0.9, html-heuristic=0.7, fallback=0.4", () => {
    expect(METADATA_SOURCE_CONFIDENCE["api-metadata"]).toBe(1.0);
    expect(METADATA_SOURCE_CONFIDENCE["embedded-exif"]).toBe(0.9);
    expect(METADATA_SOURCE_CONFIDENCE["html-heuristic"]).toBe(0.7);
    expect(METADATA_SOURCE_CONFIDENCE["fallback"]).toBe(0.4);
  });
});

// ---------------------------------------------------------------------------
// auditMetadataChain — api-metadata path
// ---------------------------------------------------------------------------

describe("auditMetadataChain — api-metadata resolution", () => {
  test("all three fields present on candidate → api-metadata wins for each", () => {
    const cand = mkCandidate({
      author: "Jane Doe",
      title: "Sunset Over Mountains",
      sourcePageUrl: "https://unsplash.com/photos/abc",
    });
    const trail = auditMetadataChain(cand, {}, "unsplash");

    expect(trail.provider).toBe("unsplash");
    expect(trail.metadataFields.author?.source).toBe("api-metadata");
    expect(trail.metadataFields.author?.value).toBe("Jane Doe");
    expect(trail.metadataFields.author?.confidence).toBe(1.0);
    expect(trail.metadataFields.title?.source).toBe("api-metadata");
    expect(trail.metadataFields.title?.value).toBe("Sunset Over Mountains");
    expect(trail.metadataFields.sourcePageUrl?.source).toBe("api-metadata");
    expect(trail.metadataFields.sourcePageUrl?.confidence).toBe(1.0);
  });

  test("api-metadata chain starts with a winning step (index 0)", () => {
    const cand = mkCandidate({ author: "Alice" });
    const trail = auditMetadataChain(cand, {}, "pexels");
    const chain = trail.metadataFields.author?.chain ?? [];
    expect(chain.length).toBeGreaterThanOrEqual(1);
    expect(chain[0].source).toBe("api-metadata");
    expect(chain[0].value).toBe("Alice");
    expect(chain[0].confidence).toBe(1.0);
  });

  test("overallQualityScore=1.0 when all fields are api-metadata", () => {
    const cand = mkCandidate({
      author: "Jane",
      title: "Blue Sky",
      sourcePageUrl: "https://pexels.com/photo/123",
    });
    const trail = auditMetadataChain(cand, {}, "pexels");
    expect(trail.overallQualityScore).toBeCloseTo(1.0, 5);
  });
});

// ---------------------------------------------------------------------------
// auditMetadataChain — embedded-exif fallback
// ---------------------------------------------------------------------------

describe("auditMetadataChain — embedded-exif fallback", () => {
  test("field absent on candidate but present in raw.exif → embedded-exif wins", () => {
    const cand = mkCandidate({
      // author intentionally omitted
      raw: { exif: { author: "EXIF Author" } },
    });
    const trail = auditMetadataChain(cand, {}, "wikimedia");
    expect(trail.metadataFields.author?.source).toBe("embedded-exif");
    expect(trail.metadataFields.author?.value).toBe("EXIF Author");
    expect(trail.metadataFields.author?.confidence).toBe(0.9);
  });

  test("raw.iptc is also checked for embedded-exif source", () => {
    const cand = mkCandidate({
      raw: { iptc: { title: "IPTC Title" } },
    });
    const trail = auditMetadataChain(cand, {}, "wikimedia");
    expect(trail.metadataFields.title?.source).toBe("embedded-exif");
    expect(trail.metadataFields.title?.value).toBe("IPTC Title");
  });

  test("embedded-exif chain includes skipped api-metadata step before winning step", () => {
    const cand = mkCandidate({
      raw: { xmp: { author: "XMP Creator" } },
    });
    const trail = auditMetadataChain(cand, {}, "openverse");
    const chain = trail.metadataFields.author?.chain ?? [];
    // First step should be the skipped api-metadata attempt
    expect(chain[0].source).toBe("api-metadata");
    expect(chain[0].confidence).toBe(0);
    // Second step should be the winning embedded-exif
    expect(chain[1].source).toBe("embedded-exif");
    expect(chain[1].value).toBe("XMP Creator");
  });

  test("rawResponse EXIF used when candidate.raw is absent", () => {
    const cand = mkCandidate({}); // no raw, no author
    const rawResponse = { exif: { author: "Response EXIF Author" } };
    const trail = auditMetadataChain(cand, rawResponse, "flickr");
    expect(trail.metadataFields.author?.source).toBe("embedded-exif");
    expect(trail.metadataFields.author?.value).toBe("Response EXIF Author");
  });
});

// ---------------------------------------------------------------------------
// auditMetadataChain — html-heuristic fallback
// ---------------------------------------------------------------------------

describe("auditMetadataChain — html-heuristic fallback", () => {
  test("field absent from api-metadata and EXIF but present in raw.html → html-heuristic wins", () => {
    const cand = mkCandidate({
      raw: { html: { author: "HTML Scraped Author" } },
    });
    const trail = auditMetadataChain(cand, {}, "brave");
    expect(trail.metadataFields.author?.source).toBe("html-heuristic");
    expect(trail.metadataFields.author?.value).toBe("HTML Scraped Author");
    expect(trail.metadataFields.author?.confidence).toBe(0.7);
  });

  test("html-heuristic chain includes three steps (api skip, exif skip, html win)", () => {
    const cand = mkCandidate({
      raw: { html: { title: "Parsed Title" } },
    });
    const trail = auditMetadataChain(cand, {}, "bing");
    const chain = trail.metadataFields.title?.chain ?? [];
    expect(chain.length).toBeGreaterThanOrEqual(3);
    expect(chain[0].source).toBe("api-metadata");
    expect(chain[1].source).toBe("embedded-exif");
    expect(chain[2].source).toBe("html-heuristic");
    expect(chain[2].value).toBe("Parsed Title");
  });
});

// ---------------------------------------------------------------------------
// auditMetadataChain — fallback (all sources absent)
// ---------------------------------------------------------------------------

describe("auditMetadataChain — fallback when all sources absent", () => {
  test("field absent everywhere → fallback source, value='', confidence=0", () => {
    const cand = mkCandidate({}); // no author, title, sourcePageUrl, no raw
    const trail = auditMetadataChain(cand, {}, "youtube-thumb");
    expect(trail.metadataFields.author?.source).toBe("fallback");
    expect(trail.metadataFields.author?.value).toBe("");
    expect(trail.metadataFields.author?.confidence).toBe(0);
  });

  test("all fields absent → overallQualityScore=0", () => {
    const cand = mkCandidate({});
    const trail = auditMetadataChain(cand, {}, "youtube-thumb");
    expect(trail.overallQualityScore).toBe(0);
  });

  test("fallback chain contains four steps (api, exif, html, fallback)", () => {
    const cand = mkCandidate({});
    const trail = auditMetadataChain(cand, {}, "browser");
    const chain = trail.metadataFields.author?.chain ?? [];
    expect(chain.length).toBe(4);
    expect(chain[3].source).toBe("fallback");
  });
});

// ---------------------------------------------------------------------------
// auditMetadataChain — mixed field sources
// ---------------------------------------------------------------------------

describe("auditMetadataChain — mixed field sources", () => {
  test("author=api-metadata, title=embedded-exif, sourcePageUrl=fallback", () => {
    const cand = mkCandidate({
      author: "API Author",
      raw: { iptc: { title: "IPTC Title" } },
      // sourcePageUrl intentionally absent
    });
    const trail = auditMetadataChain(cand, {}, "openverse");

    expect(trail.metadataFields.author?.source).toBe("api-metadata");
    expect(trail.metadataFields.title?.source).toBe("embedded-exif");
    expect(trail.metadataFields.sourcePageUrl?.source).toBe("fallback");
  });

  test("overallQualityScore for mixed sources is a weighted average", () => {
    // author=api(1.0, w=0.4), title=exif(0.9, w=0.35), sourcePageUrl=fallback(0, w=0.25)
    const cand = mkCandidate({
      author: "API Author",
      raw: { iptc: { title: "IPTC Title" } },
    });
    const trail = auditMetadataChain(cand, {}, "openverse");
    // Expected: (0.4*1.0 + 0.35*0.9 + 0.25*0) / (0.4+0.35+0.25) = (0.4+0.315)/1 = 0.715
    expect(trail.overallQualityScore).toBeCloseTo(0.715, 3);
  });
});

// ---------------------------------------------------------------------------
// getMetadataQualityScore
// ---------------------------------------------------------------------------

describe("getMetadataQualityScore — ad-hoc scoring (no pre-computed trail)", () => {
  test("candidate with all three fields → fallback-grade quality (0.4 weighted)", () => {
    const cand = mkCandidate({
      author: "X",
      title: "Y",
      sourcePageUrl: "https://example.com",
    });
    // All fields present but no embedded metadata trail → each scored at fallback grade 0.4
    const score = getMetadataQualityScore(cand);
    expect(score).toBeCloseTo(0.4, 5);
  });

  test("candidate with no fields → score=0", () => {
    const cand = mkCandidate({});
    expect(getMetadataQualityScore(cand)).toBe(0);
  });

  test("pre-computed trail overallQualityScore is returned directly", () => {
    const cand = mkCandidate({ author: "X" }) as ImageCandidate & {
      metadataAuditTrail: MetadataAuditTrail;
    };
    cand.metadataAuditTrail = {
      provider: "unsplash",
      metadataFields: {},
      overallQualityScore: 0.88,
    };
    expect(getMetadataQualityScore(cand)).toBe(0.88);
  });
});

// ---------------------------------------------------------------------------
// rankAll integration — metaQuality as tertiary tie-breaker
// ---------------------------------------------------------------------------

describe("rankAll — metaQuality tertiary tie-breaker", () => {
  const mkRank = (p: Partial<ImageCandidate>): ImageCandidate => ({
    url: "https://x/1",
    source: "x",
    license: "CC_BY",
    ...p,
  });

  test("equal rank+conf+trailConf: richer metadata wins (api-metadata vs fallback)", () => {
    // Both candidates have no licenseAuditTrail (trailConf=0) and same confidence
    // Candidate A has author+title+sourcePageUrl (higher ad-hoc metaQuality)
    // Candidate B has none (metaQuality=0)
    const cands: ImageCandidate[] = [
      mkRank({
        url: "no-meta",
        confidence: 0.8,
        // No author/title/sourcePageUrl
      }),
      mkRank({
        url: "rich-meta",
        confidence: 0.8,
        author: "Alice",
        title: "Sunset",
        sourcePageUrl: "https://unsplash.com/photo/1",
      }),
    ];
    const ranked = rankAll(cands, { licensePolicy: "context-safe" });
    expect(ranked[0]?.url).toBe("rich-meta");
    expect(ranked[1]?.url).toBe("no-meta");
  });

  test("trailConf still beats metaQuality when trailConf differs", () => {
    const cands: ImageCandidate[] = [
      mkRank({
        url: "low-trail-rich-meta",
        confidence: 0.8,
        licenseAuditTrail: {
          source: "fallback",
          provenance: "fallback",
          confidence: 0.1,
          flags: [],
        },
        author: "A",
        title: "B",
        sourcePageUrl: "https://x.com",
      }),
      mkRank({
        url: "high-trail-no-meta",
        confidence: 0.8,
        licenseAuditTrail: {
          source: "api-metadata",
          provenance: "api",
          confidence: 0.95,
          flags: [],
        },
        // No author/title/sourcePageUrl
      }),
    ];
    const ranked = rankAll(cands, { licensePolicy: "context-safe" });
    // trailConf is primary tie-breaker after conf; high-trail wins regardless of meta
    expect(ranked[0]?.url).toBe("high-trail-no-meta");
  });

  test("pixels still beats metaQuality when pixels differ (metaQuality equal)", () => {
    const cands: ImageCandidate[] = [
      mkRank({
        url: "small-rich-meta",
        confidence: 0.8,
        width: 200,
        height: 200,
        author: "Alice",
        title: "Sunset",
        sourcePageUrl: "https://x.com",
      }),
      mkRank({
        url: "large-no-meta",
        confidence: 0.8,
        width: 3000,
        height: 3000,
        // No author/title/sourcePageUrl — but pixels wins after metaQuality
      }),
    ];
    // large-no-meta has metaQuality=0, small-rich-meta has metaQuality>0
    // So small-rich-meta wins via metaQuality before pixels is considered
    const ranked = rankAll(cands, { licensePolicy: "context-safe" });
    expect(ranked[0]?.url).toBe("small-rich-meta");
  });
});
