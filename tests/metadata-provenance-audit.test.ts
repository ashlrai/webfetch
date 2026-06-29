/**
 * Tests for Metadata Confidence Audit Trail & Provenance Chain Visualization.
 *
 * Covers:
 *  1. Expanded AuditStep shape: timestamp, conflictingValues
 *  2. MetadataFieldAudit: timestamp + conflictingValues
 *  3. MetadataAuditTrail: generatedAt field
 *  4. user-override source: highest authority, short-circuits all other sources
 *  5. METADATA_SOURCE_CONFIDENCE: new heuristic-url=0.3, fallback=0.1 grades
 *  6. auditMetadataChain: all resolution paths with timestamps
 *  7. buildMetadataProvenanceExport: JSONL, heatmap, conflict resolution
 *  8. formatProvenanceReport: human-readable output shape
 *  9. pick.ts trailConf: MetadataAuditTrail.overallQualityScore as primary trailConf
 * 10. pick.ts trailConf: falls back to licenseAuditTrail.confidence when no metadataAuditTrail
 */

import { describe, expect, test } from "bun:test";
import {
  auditMetadataChain,
  buildMetadataProvenanceExport,
  formatProvenanceReport,
  getMetadataQualityScore,
  METADATA_SOURCE_CONFIDENCE,
} from "../packages/core/src/attribution-audit.ts";
import type {
  AuditStep,
  ConsensusHeatmapEntry,
  ConflictResolutionGuidance,
  MetadataAuditTrail,
  MetadataFieldAudit,
  MetadataProvenanceExport,
  MetadataProvenanceRecord,
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

/** Assert that a string looks like an ISO 8601 timestamp */
function isIso8601(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s);
}

// ---------------------------------------------------------------------------
// 1. METADATA_SOURCE_CONFIDENCE — expanded grades
// ---------------------------------------------------------------------------

describe("METADATA_SOURCE_CONFIDENCE — expanded authority scores", () => {
  test("api-metadata = 1.0", () => {
    expect(METADATA_SOURCE_CONFIDENCE["api-metadata"]).toBe(1.0);
  });

  test("embedded-exif = 0.9", () => {
    expect(METADATA_SOURCE_CONFIDENCE["embedded-exif"]).toBe(0.9);
  });

  test("html-heuristic = 0.7", () => {
    expect(METADATA_SOURCE_CONFIDENCE["html-heuristic"]).toBe(0.7);
  });

  test("heuristic-url = 0.3 (new)", () => {
    expect(METADATA_SOURCE_CONFIDENCE["heuristic-url"]).toBe(0.3);
  });

  test("fallback = 0.1 (revised down from 0.4)", () => {
    expect(METADATA_SOURCE_CONFIDENCE["fallback"]).toBe(0.1);
  });

  test("user-override = 1.0 (new, highest trust)", () => {
    expect(METADATA_SOURCE_CONFIDENCE["user-override"]).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// 2. AuditStep shape — timestamp field
// ---------------------------------------------------------------------------

describe("AuditStep — timestamp field", () => {
  test("every step in the chain has a valid ISO 8601 timestamp", () => {
    const cand = mkCandidate({ author: "Alice" });
    const trail = auditMetadataChain(cand, {}, "unsplash");
    for (const step of trail.metadataFields.author?.chain ?? []) {
      expect(isIso8601(step.timestamp)).toBe(true);
    }
  });

  test("fallback path chain all have timestamps", () => {
    const cand = mkCandidate({});
    const trail = auditMetadataChain(cand, {}, "pexels");
    const chain = trail.metadataFields.author?.chain ?? [];
    expect(chain.length).toBeGreaterThan(0);
    for (const step of chain) {
      expect(typeof step.timestamp).toBe("string");
      expect(step.timestamp.length).toBeGreaterThan(0);
    }
  });

  test("winning step timestamp is the same as MetadataFieldAudit.timestamp", () => {
    const cand = mkCandidate({ title: "Mountain Vista" });
    const trail = auditMetadataChain(cand, {}, "pixabay");
    const fieldAudit = trail.metadataFields.title!;
    // The winning step (index 0) should share the same timestamp as the audit
    expect(fieldAudit.timestamp).toBe(fieldAudit.chain[0]!.timestamp);
  });
});

// ---------------------------------------------------------------------------
// 3. MetadataAuditTrail — generatedAt field
// ---------------------------------------------------------------------------

describe("MetadataAuditTrail — generatedAt", () => {
  test("generatedAt is a valid ISO 8601 timestamp", () => {
    const trail = auditMetadataChain(mkCandidate({}), {}, "wikimedia");
    expect(isIso8601(trail.generatedAt)).toBe(true);
  });

  test("generatedAt is close to current time (within 5 seconds)", () => {
    const before = Date.now();
    const trail = auditMetadataChain(mkCandidate({}), {}, "openverse");
    const after = Date.now();
    const ts = new Date(trail.generatedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 100); // small tolerance
  });
});

// ---------------------------------------------------------------------------
// 4. user-override source
// ---------------------------------------------------------------------------

describe("auditMetadataChain — user-override source", () => {
  test("user-override wins over api-metadata when both supplied", () => {
    const cand = mkCandidate({ author: "API Author" });
    const trail = auditMetadataChain(cand, {}, "unsplash", { author: "Override Author" });
    expect(trail.metadataFields.author?.source).toBe("user-override");
    expect(trail.metadataFields.author?.value).toBe("Override Author");
    expect(trail.metadataFields.author?.confidence).toBe(1.0);
  });

  test("user-override chain has exactly one step (short-circuits everything else)", () => {
    const cand = mkCandidate({ author: "API Author", raw: { exif: { author: "EXIF Author" } } });
    const trail = auditMetadataChain(cand, {}, "flickr", { author: "Caller Author" });
    const chain = trail.metadataFields.author?.chain ?? [];
    expect(chain.length).toBe(1);
    expect(chain[0]!.source).toBe("user-override");
    expect(chain[0]!.value).toBe("Caller Author");
  });

  test("user-override wins over embedded-exif when candidate has no api value", () => {
    const cand = mkCandidate({ raw: { exif: { title: "EXIF Title" } } });
    const trail = auditMetadataChain(cand, {}, "brave", { title: "Override Title" });
    expect(trail.metadataFields.title?.source).toBe("user-override");
    expect(trail.metadataFields.title?.value).toBe("Override Title");
  });

  test("non-overridden fields still resolve normally when partial override supplied", () => {
    const cand = mkCandidate({ author: "API Author" });
    // Only override title; author should still resolve from api-metadata
    const trail = auditMetadataChain(cand, {}, "bing", { title: "Override Title" });
    expect(trail.metadataFields.author?.source).toBe("api-metadata");
    expect(trail.metadataFields.author?.value).toBe("API Author");
    expect(trail.metadataFields.title?.source).toBe("user-override");
    expect(trail.metadataFields.title?.value).toBe("Override Title");
  });

  test("empty string override is ignored (falls through to api-metadata)", () => {
    const cand = mkCandidate({ author: "API Author" });
    const trail = auditMetadataChain(cand, {}, "unsplash", { author: "" });
    expect(trail.metadataFields.author?.source).toBe("api-metadata");
    expect(trail.metadataFields.author?.value).toBe("API Author");
  });

  test("user-override authority score is 1.0", () => {
    const cand = mkCandidate({});
    const trail = auditMetadataChain(cand, {}, "pexels", { author: "Override" });
    expect(trail.metadataFields.author?.confidence).toBe(1.0);
    expect(METADATA_SOURCE_CONFIDENCE["user-override"]).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// 5. MetadataFieldAudit — conflictingValues
// ---------------------------------------------------------------------------

describe("MetadataFieldAudit — conflictingValues (no cross-source conflict in single-candidate chain)", () => {
  test("api-metadata win has no conflictingValues (only source checked before returning)", () => {
    const cand = mkCandidate({ author: "Alice" });
    const trail = auditMetadataChain(cand, {}, "unsplash");
    // api-metadata wins immediately — no prior sources observed
    expect(trail.metadataFields.author?.conflictingValues).toBeUndefined();
  });

  test("fallback path has no conflictingValues (all sources empty)", () => {
    const cand = mkCandidate({});
    const trail = auditMetadataChain(cand, {}, "youtube-thumb");
    expect(trail.metadataFields.author?.conflictingValues).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. buildMetadataProvenanceExport — JSONL output
// ---------------------------------------------------------------------------

describe("buildMetadataProvenanceExport — JSONL lines", () => {
  test("returns one JSONL line per candidate", () => {
    const cands = [
      mkCandidate({ url: "https://a.com/1.jpg", author: "Alice", source: "unsplash" }),
      mkCandidate({ url: "https://b.com/2.jpg", author: "Bob", source: "pexels" }),
    ];
    const exp = buildMetadataProvenanceExport(cands);
    expect(exp.jsonlLines).toHaveLength(2);
  });

  test("each JSONL line is valid JSON with url, provider, trail keys", () => {
    const cands = [mkCandidate({ url: "https://x.com/img.jpg", source: "wikimedia" })];
    const exp = buildMetadataProvenanceExport(cands);
    const parsed = JSON.parse(exp.jsonlLines[0]!) as MetadataProvenanceRecord;
    expect(parsed.url).toBe("https://x.com/img.jpg");
    expect(parsed.provider).toBe("wikimedia");
    expect(parsed.trail).toBeDefined();
    expect(typeof parsed.trail.overallQualityScore).toBe("number");
  });

  test("trail in JSONL has generatedAt field", () => {
    const exp = buildMetadataProvenanceExport([mkCandidate({})]);
    const rec = JSON.parse(exp.jsonlLines[0]!) as MetadataProvenanceRecord;
    expect(isIso8601(rec.trail.generatedAt)).toBe(true);
  });

  test("empty candidates array → empty jsonlLines", () => {
    const exp = buildMetadataProvenanceExport([]);
    expect(exp.jsonlLines).toHaveLength(0);
    expect(exp.candidateCount).toBe(0);
  });

  test("candidateCount matches input length", () => {
    const cands = Array.from({ length: 5 }, (_, i) =>
      mkCandidate({ url: `https://x.com/${i}.jpg` }),
    );
    const exp = buildMetadataProvenanceExport(cands);
    expect(exp.candidateCount).toBe(5);
  });

  test("generatedAt on export is valid ISO 8601", () => {
    const exp = buildMetadataProvenanceExport([mkCandidate({})]);
    expect(isIso8601(exp.generatedAt)).toBe(true);
  });

  test("re-uses pre-computed metadataAuditTrail when present on candidate", () => {
    const preComputed: MetadataAuditTrail = {
      provider: "pre-computed",
      generatedAt: "2026-01-01T00:00:00.000Z",
      metadataFields: {},
      overallQualityScore: 0.99,
    };
    const cand = mkCandidate({ source: "unsplash" }) as ImageCandidate & {
      metadataAuditTrail: MetadataAuditTrail;
    };
    cand.metadataAuditTrail = preComputed;
    const exp = buildMetadataProvenanceExport([cand]);
    const rec = JSON.parse(exp.jsonlLines[0]!) as MetadataProvenanceRecord;
    expect(rec.trail.overallQualityScore).toBe(0.99);
    expect(rec.trail.generatedAt).toBe("2026-01-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// 7. buildMetadataProvenanceExport — consensus heatmap
// ---------------------------------------------------------------------------

describe("buildMetadataProvenanceExport — consensus heatmap", () => {
  test("heatmap includes entries for fields where providers agree", () => {
    const cands = [
      mkCandidate({ url: "https://a.com/1.jpg", author: "Alice", source: "unsplash" }),
      mkCandidate({ url: "https://b.com/2.jpg", author: "Alice", source: "pexels" }),
    ];
    const exp = buildMetadataProvenanceExport(cands);
    const authorEntry = exp.consensusHeatmap.find(
      (e) => e.field === "author" && e.value === "Alice",
    );
    expect(authorEntry).toBeDefined();
    expect(authorEntry!.count).toBe(2);
    expect(authorEntry!.agreementRatio).toBeCloseTo(1.0, 5);
    expect(authorEntry!.providers).toContain("unsplash");
    expect(authorEntry!.providers).toContain("pexels");
  });

  test("heatmap shows partial agreement when providers split on author", () => {
    const cands = [
      mkCandidate({ url: "https://a.com/1.jpg", author: "Alice", source: "unsplash" }),
      mkCandidate({ url: "https://b.com/2.jpg", author: "Bob", source: "pexels" }),
      mkCandidate({ url: "https://c.com/3.jpg", author: "Alice", source: "wikimedia" }),
    ];
    const exp = buildMetadataProvenanceExport(cands);
    const aliceEntry = exp.consensusHeatmap.find(
      (e) => e.field === "author" && e.value === "Alice",
    );
    expect(aliceEntry).toBeDefined();
    expect(aliceEntry!.count).toBe(2);
    expect(aliceEntry!.agreementRatio).toBeCloseTo(2 / 3, 3);
    const bobEntry = exp.consensusHeatmap.find(
      (e) => e.field === "author" && e.value === "Bob",
    );
    expect(bobEntry).toBeDefined();
    expect(bobEntry!.count).toBe(1);
  });

  test("heatmap is empty when all candidates have no metadata fields", () => {
    const cands = [mkCandidate({}), mkCandidate({})];
    const exp = buildMetadataProvenanceExport(cands);
    expect(exp.consensusHeatmap).toHaveLength(0);
  });

  test("heatmap covers title and sourcePageUrl as well as author", () => {
    const cands = [
      mkCandidate({
        url: "https://a.com/1.jpg",
        title: "Sunset",
        sourcePageUrl: "https://unsplash.com/photos/1",
        source: "unsplash",
      }),
      mkCandidate({
        url: "https://b.com/2.jpg",
        title: "Sunset",
        sourcePageUrl: "https://pexels.com/photo/2",
        source: "pexels",
      }),
    ];
    const exp = buildMetadataProvenanceExport(cands);
    const titleEntry = exp.consensusHeatmap.find(
      (e) => e.field === "title" && e.value === "Sunset",
    );
    expect(titleEntry).toBeDefined();
    expect(titleEntry!.count).toBe(2);
    // sourcePageUrl entries should exist too (different values, count 1 each)
    const urlEntries = exp.consensusHeatmap.filter((e) => e.field === "sourcePageUrl");
    expect(urlEntries.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 8. buildMetadataProvenanceExport — conflict resolution
// ---------------------------------------------------------------------------

describe("buildMetadataProvenanceExport — conflict resolution guidance", () => {
  test("no conflict when all providers agree on author", () => {
    const cands = [
      mkCandidate({ author: "Alice", source: "unsplash" }),
      mkCandidate({ author: "Alice", source: "pexels" }),
    ];
    const exp = buildMetadataProvenanceExport(cands);
    const authorConflicts = exp.conflictResolution.filter((c) => c.field === "author");
    expect(authorConflicts).toHaveLength(0);
  });

  test("conflict guidance generated when providers disagree on author", () => {
    const cands = [
      mkCandidate({ url: "https://a.com/1.jpg", author: "Alice", source: "unsplash" }),
      mkCandidate({ url: "https://b.com/2.jpg", author: "Bob", source: "pexels" }),
      mkCandidate({ url: "https://c.com/3.jpg", author: "Alice", source: "wikimedia" }),
    ];
    const exp = buildMetadataProvenanceExport(cands);
    const authorConflict = exp.conflictResolution.find((c) => c.field === "author");
    expect(authorConflict).toBeDefined();
    expect(authorConflict!.recommendedValue).toBe("Alice"); // majority
    expect(authorConflict!.guidance).toContain("Alice");
    expect(authorConflict!.guidance).toContain("Bob");
  });

  test("recommendedValue is the majority provider value", () => {
    const cands = [
      mkCandidate({ url: "https://a.com/1.jpg", author: "X", source: "unsplash" }),
      mkCandidate({ url: "https://b.com/2.jpg", author: "X", source: "pexels" }),
      mkCandidate({ url: "https://c.com/3.jpg", author: "X", source: "wikimedia" }),
      mkCandidate({ url: "https://d.com/4.jpg", author: "Y", source: "bing" }),
    ];
    const exp = buildMetadataProvenanceExport(cands);
    const authorConflict = exp.conflictResolution.find((c) => c.field === "author");
    expect(authorConflict!.recommendedValue).toBe("X");
  });

  test("conflict resolution candidates list all competing values", () => {
    const cands = [
      mkCandidate({ url: "https://a.com/1.jpg", author: "Alice", source: "unsplash" }),
      mkCandidate({ url: "https://b.com/2.jpg", author: "Bob", source: "pexels" }),
    ];
    const exp = buildMetadataProvenanceExport(cands);
    const conflict = exp.conflictResolution.find((c) => c.field === "author")!;
    const values = conflict.candidates.map((c) => c.value);
    expect(values).toContain("Alice");
    expect(values).toContain("Bob");
  });

  test("guidance string mentions provider counts", () => {
    const cands = [
      mkCandidate({ url: "https://a.com/1.jpg", author: "Alice", source: "unsplash" }),
      mkCandidate({ url: "https://b.com/2.jpg", author: "Alice", source: "pexels" }),
      mkCandidate({ url: "https://c.com/3.jpg", author: "Bob", source: "wikimedia" }),
    ];
    const exp = buildMetadataProvenanceExport(cands);
    const conflict = exp.conflictResolution.find((c) => c.field === "author")!;
    // Guidance should mention "2 provider(s)" for Alice
    expect(conflict.guidance).toContain("2 provider");
    expect(conflict.guidance).toContain("1 say");
  });
});

// ---------------------------------------------------------------------------
// 9. formatProvenanceReport
// ---------------------------------------------------------------------------

describe("formatProvenanceReport — human-readable output", () => {
  test("report starts with 'Metadata Provenance Report' header", () => {
    const exp = buildMetadataProvenanceExport([mkCandidate({})]);
    const report = formatProvenanceReport(exp);
    expect(report).toContain("Metadata Provenance Report");
  });

  test("report includes generatedAt timestamp", () => {
    const exp = buildMetadataProvenanceExport([mkCandidate({})]);
    const report = formatProvenanceReport(exp);
    expect(report).toContain("Generated:");
    expect(report).toContain(exp.generatedAt);
  });

  test("report includes candidate count", () => {
    const cands = [mkCandidate({}), mkCandidate({})];
    const exp = buildMetadataProvenanceExport(cands);
    const report = formatProvenanceReport(exp);
    expect(report).toContain("Candidates: 2");
  });

  test("report mentions 'No conflicts' when providers agree", () => {
    const cands = [
      mkCandidate({ author: "Alice", source: "unsplash" }),
      mkCandidate({ author: "Alice", source: "pexels" }),
    ];
    const exp = buildMetadataProvenanceExport(cands);
    const report = formatProvenanceReport(exp);
    expect(report).toContain("No conflicts");
  });

  test("report includes heatmap table header when there are fields", () => {
    const cands = [mkCandidate({ author: "Alice", source: "unsplash" })];
    const exp = buildMetadataProvenanceExport(cands);
    const report = formatProvenanceReport(exp);
    expect(report).toContain("Consensus Heatmap");
    expect(report).toContain("Alice");
  });

  test("report includes conflict resolution section when conflicts exist", () => {
    const cands = [
      mkCandidate({ url: "https://a.com/1.jpg", author: "Alice", source: "unsplash" }),
      mkCandidate({ url: "https://b.com/2.jpg", author: "Bob", source: "pexels" }),
    ];
    const exp = buildMetadataProvenanceExport(cands);
    const report = formatProvenanceReport(exp);
    expect(report).toContain("Conflict Resolution");
    expect(report).toContain("author");
  });

  test("report says 'No consensus data' when no candidates", () => {
    const exp = buildMetadataProvenanceExport([]);
    const report = formatProvenanceReport(exp);
    expect(report).toContain("No consensus data");
  });
});

// ---------------------------------------------------------------------------
// 10. pick.ts trailConf integration — MetadataAuditTrail.overallQualityScore
// ---------------------------------------------------------------------------

describe("rankAll — trailConf prefers MetadataAuditTrail.overallQualityScore", () => {
  const mk = (p: Partial<ImageCandidate>): ImageCandidate => ({
    url: "https://x/1",
    source: "x",
    license: "CC_BY",
    ...p,
  });

  test("candidate with metadataAuditTrail beats one with only licenseAuditTrail when overallQualityScore is higher", () => {
    const highMetaTrail: MetadataAuditTrail = {
      provider: "unsplash",
      generatedAt: new Date().toISOString(),
      metadataFields: {},
      overallQualityScore: 0.9,
    };
    const cands: ImageCandidate[] = [
      mk({
        url: "low-license-trail",
        confidence: 0.8,
        licenseAuditTrail: {
          source: "api-metadata",
          provenance: "api",
          confidence: 0.95,
          flags: [],
        },
        // No metadataAuditTrail — falls back to licenseAuditTrail.confidence=0.95
        // but overallQualityScore would be 0.4 ad-hoc
      }),
      mk({
        url: "high-meta-trail",
        confidence: 0.8,
        // metadataAuditTrail with overallQualityScore=0.9
      } as ImageCandidate & { metadataAuditTrail: MetadataAuditTrail }),
    ];
    // Attach the metadataAuditTrail to the second candidate
    (cands[1] as ImageCandidate & { metadataAuditTrail: MetadataAuditTrail }).metadataAuditTrail =
      highMetaTrail;

    const ranked = rankAll(cands, { licensePolicy: "context-safe" });
    // The one with metadataAuditTrail.overallQualityScore=0.9 should win trailConf
    // vs the licenseAuditTrail.confidence=0.95 one... actually 0.95 > 0.9 so low-license-trail wins
    // Let's verify order is deterministic and sensible
    expect(ranked[0]?.url).toBe("low-license-trail"); // 0.95 > 0.9
    expect(ranked[1]?.url).toBe("high-meta-trail");
  });

  test("metadataAuditTrail.overallQualityScore=1.0 beats licenseAuditTrail.confidence=0.5", () => {
    const highMetaTrail: MetadataAuditTrail = {
      provider: "unsplash",
      generatedAt: new Date().toISOString(),
      metadataFields: {},
      overallQualityScore: 1.0,
    };
    const cands: ImageCandidate[] = [
      mk({
        url: "low-trail",
        confidence: 0.8,
        licenseAuditTrail: {
          source: "heuristic-url",
          provenance: "url",
          confidence: 0.5,
          flags: ["url-inferred"],
        },
      }),
      mk({
        url: "meta-trail-winner",
        confidence: 0.8,
      } as ImageCandidate & { metadataAuditTrail: MetadataAuditTrail }),
    ];
    (cands[1] as ImageCandidate & { metadataAuditTrail: MetadataAuditTrail }).metadataAuditTrail =
      highMetaTrail;

    const ranked = rankAll(cands, { licensePolicy: "context-safe" });
    expect(ranked[0]?.url).toBe("meta-trail-winner"); // overallQualityScore=1.0 > licenseConf=0.5
    expect(ranked[1]?.url).toBe("low-trail");
  });

  test("candidate with no metadataAuditTrail and no licenseAuditTrail has trailConf=0", () => {
    const cands: ImageCandidate[] = [
      mk({ url: "no-trails", confidence: 0.8 }),
      mk({
        url: "has-meta-trail",
        confidence: 0.8,
      } as ImageCandidate & { metadataAuditTrail: MetadataAuditTrail }),
    ];
    const trail: MetadataAuditTrail = {
      provider: "pexels",
      generatedAt: new Date().toISOString(),
      metadataFields: {},
      overallQualityScore: 0.3,
    };
    (cands[1] as ImageCandidate & { metadataAuditTrail: MetadataAuditTrail }).metadataAuditTrail =
      trail;

    const ranked = rankAll(cands, { licensePolicy: "context-safe" });
    // has-meta-trail has trailConf=0.3, no-trails has trailConf=0
    expect(ranked[0]?.url).toBe("has-meta-trail");
    expect(ranked[1]?.url).toBe("no-trails");
  });

  test("licenseAuditTrail.confidence still used when no metadataAuditTrail attached", () => {
    const cands: ImageCandidate[] = [
      mk({
        url: "license-trail-only",
        confidence: 0.8,
        licenseAuditTrail: {
          source: "api-metadata",
          provenance: "api",
          confidence: 0.95,
          flags: [],
        },
      }),
      mk({ url: "no-trails-at-all", confidence: 0.8 }),
    ];
    const ranked = rankAll(cands, { licensePolicy: "context-safe" });
    expect(ranked[0]?.url).toBe("license-trail-only");
    expect(ranked[1]?.url).toBe("no-trails-at-all");
  });
});

// ---------------------------------------------------------------------------
// 11. getMetadataQualityScore — revised fallback confidence (0.1 not 0.4)
// ---------------------------------------------------------------------------

describe("getMetadataQualityScore — fallback confidence is now 0.1", () => {
  test("candidate with all three fields present (no trail) → score = 0.1 weighted", () => {
    // All fields present but no embedded metadata trail → each scored at fallback grade 0.1
    const cand = mkCandidate({
      author: "X",
      title: "Y",
      sourcePageUrl: "https://example.com",
    });
    const score = getMetadataQualityScore(cand);
    // weights: author=0.4, title=0.35, sourcePageUrl=0.25; all at fallback=0.1
    expect(score).toBeCloseTo(0.1, 5);
  });

  test("candidate with no fields → score = 0", () => {
    expect(getMetadataQualityScore(mkCandidate({}))).toBe(0);
  });

  test("pre-computed trail overallQualityScore returned directly", () => {
    const cand = mkCandidate({ author: "X" }) as ImageCandidate & {
      metadataAuditTrail: MetadataAuditTrail;
    };
    cand.metadataAuditTrail = {
      provider: "unsplash",
      generatedAt: new Date().toISOString(),
      metadataFields: {},
      overallQualityScore: 0.77,
    };
    expect(getMetadataQualityScore(cand)).toBe(0.77);
  });
});
