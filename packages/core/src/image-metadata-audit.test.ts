/**
 * Test suite for image-metadata-audit.ts
 *
 * Covers:
 *  1. levenshteinSimilarity — edge cases, known distances, tolerance.
 *  2. Conflict detection — artist, copyright, license disagreements.
 *  3. Reconciliation strategies — provider-first, embedded-first, conservative.
 *  4. Agreement path — similar strings (sim > 0.8) boost confidence to 0.95.
 *  5. EXIF/XMP/IPTC integration — real embedded metadata extraction.
 *  6. Audit trail completeness — timestamps, fields, confidence invariants.
 *  7. Edge cases — empty bytes, missing candidate fields, all-UNKNOWN licenses.
 */

import { describe, expect, test } from "bun:test";
import {
  auditImageMetadata,
  levenshteinSimilarity,
} from "./image-metadata-audit.ts";
import type {
  FieldConflict,
  ImageMetadataAuditInput,
  ImageMetadataAuditResult,
} from "./image-metadata-audit.ts";
import type { ImageCandidate } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    url: "https://example.com/image.jpg",
    source: "wikimedia",
    license: "CC_BY",
    ...overrides,
  };
}

/**
 * Build a minimal valid JPEG containing an XMP APP1 segment with the given
 * XMP payload string.  The JPEG has SOI + APP1 + EOI.
 */
function buildJpegWithXmp(xmpBody: string): Uint8Array {
  const xmpPayload =
    "http://ns.adobe.com/xap/1.0/\0" + xmpBody;
  const xmpBytes = new TextEncoder().encode(xmpPayload);
  // APP1 length field = 2 (length field itself) + payload length
  const segLen = 2 + xmpBytes.length;
  const jpeg = new Uint8Array(2 + 2 + 2 + xmpBytes.length + 2);
  jpeg[0] = 0xff; jpeg[1] = 0xd8; // SOI
  jpeg[2] = 0xff; jpeg[3] = 0xe1; // APP1
  jpeg[4] = (segLen >> 8) & 0xff;
  jpeg[5] = segLen & 0xff;
  jpeg.set(xmpBytes, 6);
  // EOI
  jpeg[6 + xmpBytes.length] = 0xff;
  jpeg[6 + xmpBytes.length + 1] = 0xd9;
  return jpeg;
}

function makeXmpBlock(opts: {
  creator?: string;
  ccLicense?: string;
  rights?: string;
}): string {
  return (
    `<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:cc="http://creativecommons.org/ns#" ` +
    `xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ` +
    `xmlns:dc="http://purl.org/dc/elements/1.1/">` +
    `<rdf:RDF><rdf:Description>` +
    (opts.creator
      ? `<dc:creator><rdf:Seq><rdf:li>${opts.creator}</rdf:li></rdf:Seq></dc:creator>`
      : "") +
    (opts.rights
      ? `<dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${opts.rights}</rdf:li></rdf:Alt></dc:rights>`
      : "") +
    (opts.ccLicense
      ? `<cc:license rdf:resource="${opts.ccLicense}"/>`
      : "") +
    `</rdf:Description></rdf:RDF></x:xmpmeta>`
  );
}

// ---------------------------------------------------------------------------
// 1. levenshteinSimilarity
// ---------------------------------------------------------------------------

describe("levenshteinSimilarity", () => {
  test("identical strings → 1.0", () => {
    expect(levenshteinSimilarity("hello", "hello")).toBe(1.0);
  });

  test("both empty strings → 1.0", () => {
    expect(levenshteinSimilarity("", "")).toBe(1.0);
  });

  test("one empty string → 0.0", () => {
    expect(levenshteinSimilarity("", "hello")).toBe(0.0);
    expect(levenshteinSimilarity("hello", "")).toBe(0.0);
  });

  test("completely different strings → low similarity", () => {
    const sim = levenshteinSimilarity("abc", "xyz");
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThan(0.5);
  });

  test("one character difference → high similarity", () => {
    const sim = levenshteinSimilarity("Ansel Adams", "Ansel Adam");
    expect(sim).toBeGreaterThan(0.8);
  });

  test("case difference reduces similarity", () => {
    const lower = levenshteinSimilarity("jane doe", "jane doe");
    const mixed = levenshteinSimilarity("Jane Doe", "jane doe");
    // identical case → 1.0; normalise() lowercases before comparing inside auditImageMetadata
    expect(lower).toBe(1.0);
    // case-sensitive comparison in levenshteinSimilarity directly — 'J' != 'j'
    expect(mixed).toBeLessThan(lower);
    expect(mixed).toBeGreaterThan(0.7);
  });

  test("similarity is in [0, 1] for all inputs", () => {
    const pairs = [
      ["", ""],
      ["a", "b"],
      ["short", "much longer string that is very different"],
      ["Photographer Name", "Photographer Name Jr."],
      ["© 2024 Studio", "© 2025 Studio"],
    ];
    for (const [a, b] of pairs) {
      const sim = levenshteinSimilarity(a!, b!);
      expect(sim).toBeGreaterThanOrEqual(0);
      expect(sim).toBeLessThanOrEqual(1);
    }
  });

  test("similarity is symmetric: sim(a,b) === sim(b,a)", () => {
    const a = "John Photographer";
    const b = "John Photogapher"; // typo
    expect(levenshteinSimilarity(a, b)).toBeCloseTo(
      levenshteinSimilarity(b, a),
      10,
    );
  });

  test("known distance: 'kitten' vs 'sitting' → 3 edits, len 7 → sim ≈ 0.571", () => {
    // distance(kitten, sitting) = 3; max(6,7) = 7; sim = 1 - 3/7 ≈ 0.571
    const sim = levenshteinSimilarity("kitten", "sitting");
    expect(sim).toBeCloseTo(1 - 3 / 7, 3);
  });

  test("above 0.8 threshold: near-identical author names", () => {
    // "Jane Smith" vs "Jane Smith " — one trailing space
    const sim = levenshteinSimilarity("Jane Smith", "Jane Smith ");
    expect(sim).toBeGreaterThan(0.8);
  });

  test("below 0.8 threshold: clearly different authors", () => {
    const sim = levenshteinSimilarity("Alice Wonder", "Bob Builder");
    expect(sim).toBeLessThan(0.8);
  });
});

// ---------------------------------------------------------------------------
// 2. Conflict detection
// ---------------------------------------------------------------------------

describe("auditImageMetadata — conflict detection", () => {
  test("no conflicts when both sources are empty", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: makeCandidate({ author: undefined, attributionLine: undefined }),
    });
    expect(result.conflicts).toHaveLength(0);
  });

  test("no conflict when only provider has artist", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: makeCandidate({ author: "Provider Artist" }),
    });
    const artistConflict = result.conflicts.find((c) => c.field === "artist");
    expect(artistConflict).toBeUndefined();
    expect(result.mergedResult.artist).toBe("Provider Artist");
  });

  test("no conflict when embedded and provider artist agree closely", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({ creator: "Jane Smith" }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Jane Smith" }),
    });
    const artistConflict = result.conflicts.find((c) => c.field === "artist");
    expect(artistConflict).toBeUndefined();
    // Merged confidence should be boosted.
    expect(result.mergedResult.confidence.artist).toBe(0.95);
  });

  test("conflict detected when embedded and provider artist differ significantly", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({ creator: "Alice Wonder" }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Bob Builder" }),
    });
    const artistConflict = result.conflicts.find((c) => c.field === "artist");
    expect(artistConflict).toBeDefined();
    expect(artistConflict!.embedded).toBe("Alice Wonder");
    expect(artistConflict!.provider).toBe("Bob Builder");
    expect(artistConflict!.similarity).toBeDefined();
    expect(artistConflict!.similarity!).toBeLessThan(0.8);
  });

  test("license conflict detected when embedded and provider licenses differ", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({
        ccLicense: "https://creativecommons.org/publicdomain/zero/1.0/",
      }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ license: "CC_BY", author: "Some Author" }),
    });
    const licenseConflict = result.conflicts.find((c) => c.field === "license");
    expect(licenseConflict).toBeDefined();
    expect(licenseConflict!.embedded).toBe("CC0");
    expect(licenseConflict!.provider).toBe("CC_BY");
  });

  test("no license conflict when embedded license is UNKNOWN", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: makeCandidate({ license: "CC_BY" }),
    });
    const licenseConflict = result.conflicts.find((c) => c.field === "license");
    expect(licenseConflict).toBeUndefined();
    expect(result.mergedResult.license).toBe("CC_BY");
  });

  test("no license conflict when both licenses are UNKNOWN", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: makeCandidate({ license: "UNKNOWN" }),
    });
    const licenseConflict = result.conflicts.find((c) => c.field === "license");
    expect(licenseConflict).toBeUndefined();
    expect(result.mergedResult.license).toBe("UNKNOWN");
  });

  test("FieldConflict shape is complete", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({ creator: "Embedded Author" }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Totally Different Author" }),
    });
    for (const conflict of result.conflicts) {
      expect(typeof conflict.field).toBe("string");
      expect(conflict.field.length).toBeGreaterThan(0);
      expect(["provider", "embedded", "merged"]).toContain(conflict.resolution);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Reconciliation strategies
// ---------------------------------------------------------------------------

describe("auditImageMetadata — reconciliation strategies", () => {
  async function getArtistWithStrategy(
    embeddedArtist: string,
    providerArtist: string,
    strategy: "provider-first" | "embedded-first" | "conservative",
  ): Promise<string | undefined> {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({ creator: embeddedArtist }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: providerArtist }),
      resolveConflicts: strategy,
    });
    return result.mergedResult.artist;
  }

  test("provider-first: provider artist wins on conflict", async () => {
    const artist = await getArtistWithStrategy(
      "Alice Wonder",
      "Bob Builder",
      "provider-first",
    );
    expect(artist).toBe("Bob Builder");
  });

  test("embedded-first: embedded artist wins on conflict", async () => {
    const artist = await getArtistWithStrategy(
      "Alice Wonder",
      "Bob Builder",
      "embedded-first",
    );
    expect(artist).toBe("Alice Wonder");
  });

  test("conservative: higher-confidence source wins (embedded XMP > provider base 0.7)", async () => {
    // XMP embedded artist confidence = 0.9 > provider base 0.7 → embedded wins.
    const artist = await getArtistWithStrategy(
      "Alice Wonder",
      "Bob Builder",
      "conservative",
    );
    expect(artist).toBe("Alice Wonder");
  });

  test("provider-first: license conflict → provider license wins", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({
        ccLicense: "https://creativecommons.org/publicdomain/zero/1.0/",
      }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ license: "CC_BY" }),
      resolveConflicts: "provider-first",
    });
    expect(result.mergedResult.license).toBe("CC_BY");
  });

  test("embedded-first: license conflict → embedded license wins", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({
        ccLicense: "https://creativecommons.org/publicdomain/zero/1.0/",
      }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ license: "CC_BY" }),
      resolveConflicts: "embedded-first",
    });
    expect(result.mergedResult.license).toBe("CC0");
  });

  test("conservative default: embedded CC0 (conf≥0.7) wins over provider CC_BY", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({
        ccLicense: "https://creativecommons.org/publicdomain/zero/1.0/",
      }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ license: "CC_BY" }),
      // resolveConflicts defaults to 'conservative'
    });
    expect(result.mergedResult.license).toBe("CC0");
  });

  test("FieldConflict resolution field matches strategy decision", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({ creator: "Embedded Person" }),
    );

    const providerResult = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Provider Person" }),
      resolveConflicts: "provider-first",
    });
    const providerConflict = providerResult.conflicts.find((c) => c.field === "artist");
    expect(providerConflict?.resolution).toBe("provider");

    const embeddedResult = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Provider Person" }),
      resolveConflicts: "embedded-first",
    });
    const embeddedConflict = embeddedResult.conflicts.find((c) => c.field === "artist");
    expect(embeddedConflict?.resolution).toBe("embedded");
  });
});

// ---------------------------------------------------------------------------
// 4. Agreement path — Levenshtein similarity > 0.8 → confidence boost
// ---------------------------------------------------------------------------

describe("auditImageMetadata — agreement and confidence boost", () => {
  test("identical artist: no conflict, confidence = 0.95", async () => {
    const jpeg = buildJpegWithXmp(makeXmpBlock({ creator: "Jane Smith" }));
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Jane Smith" }),
    });
    expect(result.conflicts.find((c) => c.field === "artist")).toBeUndefined();
    expect(result.mergedResult.confidence.artist).toBe(0.95);
  });

  test("near-identical artist (similarity > 0.8): merged, confidence = 0.95", async () => {
    // "Ansel Adams" vs "Ansel Adams " — one trailing space, similarity > 0.9
    const jpeg = buildJpegWithXmp(makeXmpBlock({ creator: "Ansel Adams" }));
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Ansel Adams " }),
    });
    expect(result.conflicts.find((c) => c.field === "artist")).toBeUndefined();
    expect(result.mergedResult.confidence.artist).toBe(0.95);
  });

  test("license agreement: embedded and provider match → confidence = 0.95", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({
        ccLicense: "https://creativecommons.org/licenses/by/4.0/",
      }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ license: "CC_BY" }),
    });
    expect(result.conflicts.find((c) => c.field === "license")).toBeUndefined();
    expect(result.mergedResult.confidence.license).toBe(0.95);
  });

  test("merged artist uses embedded value when they agree", async () => {
    const jpeg = buildJpegWithXmp(makeXmpBlock({ creator: "Ansel Adams" }));
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Ansel Adams" }),
    });
    expect(result.mergedResult.artist).toBe("Ansel Adams");
  });

  test("only provider has artist → uses provider, no conflict, lower confidence", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: makeCandidate({ author: "Provider Only" }),
    });
    expect(result.mergedResult.artist).toBe("Provider Only");
    expect(result.conflicts.find((c) => c.field === "artist")).toBeUndefined();
    expect(result.mergedResult.confidence.artist).toBe(0.7);
  });

  test("only embedded has artist → uses embedded, no conflict, embedded confidence", async () => {
    const jpeg = buildJpegWithXmp(makeXmpBlock({ creator: "Embedded Only" }));
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: undefined }),
    });
    expect(result.mergedResult.artist).toBe("Embedded Only");
    expect(result.conflicts.find((c) => c.field === "artist")).toBeUndefined();
    expect(result.mergedResult.confidence.artist).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. EXIF/XMP/IPTC integration
// ---------------------------------------------------------------------------

describe("auditImageMetadata — metadata source integration", () => {
  test("XMP creator is extracted and reflected in embedded metadata", async () => {
    const jpeg = buildJpegWithXmp(makeXmpBlock({ creator: "XMP Author" }));
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: undefined }),
    });
    expect(result.embeddedMetadata.artist).toBe("XMP Author");
    expect(result.mergedResult.artist).toBe("XMP Author");
  });

  test("XMP CC0 license sets embedded license correctly", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({
        ccLicense: "https://creativecommons.org/publicdomain/zero/1.0/",
      }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ license: "UNKNOWN" }),
    });
    expect(result.embeddedMetadata.license).toBe("CC0");
    expect(result.mergedResult.license).toBe("CC0");
  });

  test("XMP CC BY-SA license detected", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({
        ccLicense: "https://creativecommons.org/licenses/by-sa/4.0/",
      }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ license: "UNKNOWN" }),
    });
    expect(result.embeddedMetadata.license).toBe("CC_BY_SA");
    expect(result.mergedResult.license).toBe("CC_BY_SA");
  });

  test("providerMetadata reflects the candidate's values exactly", async () => {
    const candidate = makeCandidate({
      author: "Provider Author",
      license: "CC_BY",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      attributionLine: "Photo by Provider Author",
      title: "Test Image",
    });
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate,
    });
    expect(result.providerMetadata.author).toBe("Provider Author");
    expect(result.providerMetadata.license).toBe("CC_BY");
    expect(result.providerMetadata.licenseUrl).toBe(
      "https://creativecommons.org/licenses/by/4.0/",
    );
    expect(result.providerMetadata.attributionLine).toBe("Photo by Provider Author");
    expect(result.providerMetadata.title).toBe("Test Image");
  });

  test("empty bytes → embedded metadata has UNKNOWN license and zero confidence", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: makeCandidate({ license: "UNKNOWN" }),
    });
    expect(result.embeddedMetadata.license).toBe("UNKNOWN");
    expect(result.embeddedMetadata.confidence.artist).toBe(0);
    expect(result.embeddedMetadata.confidence.copyright).toBe(0);
    expect(result.embeddedMetadata.confidence.license).toBe(0);
  });

  test("result shape is complete for all code paths", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: makeCandidate(),
    });
    expect(result.embeddedMetadata).toBeDefined();
    expect(result.providerMetadata).toBeDefined();
    expect(result.mergedResult).toBeDefined();
    expect(Array.isArray(result.conflicts)).toBe(true);
    expect(Array.isArray(result.auditTrail)).toBe(true);
    expect(result.mergedResult.confidence).toHaveProperty("artist");
    expect(result.mergedResult.confidence).toHaveProperty("copyright");
    expect(result.mergedResult.confidence).toHaveProperty("license");
  });
});

// ---------------------------------------------------------------------------
// 6. Audit trail completeness
// ---------------------------------------------------------------------------

describe("auditImageMetadata — audit trail", () => {
  test("audit trail always has at least extraction + summary events", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: makeCandidate(),
    });
    const fields = result.auditTrail.map((e) => e.field);
    expect(fields).toContain("_extraction");
    expect(fields).toContain("_summary");
    expect(fields).toContain("artist");
    expect(fields).toContain("copyright");
    expect(fields).toContain("license");
  });

  test("every audit event has required fields", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: makeCandidate(),
    });
    for (const event of result.auditTrail) {
      expect(typeof event.timestamp).toBe("string");
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof event.field).toBe("string");
      expect(typeof event.decision).toBe("string");
      expect(event.decision.length).toBeGreaterThan(0);
      expect(["embedded", "provider", "merged", "none"]).toContain(event.source);
      expect(typeof event.confidence).toBe("number");
      expect(event.confidence).toBeGreaterThanOrEqual(0);
      expect(event.confidence).toBeLessThanOrEqual(1);
    }
  });

  test("audit trail confidence values are always in [0, 1]", async () => {
    const jpeg = buildJpegWithXmp(makeXmpBlock({ creator: "Some Artist" }));
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Different Artist", license: "CC_BY_SA" }),
    });
    for (const event of result.auditTrail) {
      expect(event.confidence).toBeGreaterThanOrEqual(0);
      expect(event.confidence).toBeLessThanOrEqual(1);
    }
  });

  test("audit trail mentions the conflict strategy in context", async () => {
    const jpeg = buildJpegWithXmp(makeXmpBlock({ creator: "Embedded Person" }));
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Provider Person" }),
      resolveConflicts: "provider-first",
    });
    const artistEvent = result.auditTrail.find((e) => e.field === "artist");
    expect(artistEvent?.context?.strategy).toBe("provider-first");
  });

  test("summary event mentions conflict count", async () => {
    const jpeg = buildJpegWithXmp(makeXmpBlock({ creator: "Embedded Only" }));
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Totally Different" }),
    });
    const summary = result.auditTrail.find((e) => e.field === "_summary");
    expect(summary).toBeDefined();
    expect(summary!.context?.conflictCount).toBeGreaterThanOrEqual(1);
  });

  test("extraction event includes byte length", async () => {
    const bytes = new Uint8Array(42);
    const result = await auditImageMetadata({
      downloadedBytes: bytes,
      candidate: makeCandidate(),
    });
    const extractionEvent = result.auditTrail.find((e) => e.field === "_extraction");
    expect(extractionEvent?.context?.byteLength).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// 7. Edge cases
// ---------------------------------------------------------------------------

describe("auditImageMetadata — edge cases", () => {
  test("does not throw for empty bytes", async () => {
    await expect(
      auditImageMetadata({
        downloadedBytes: new Uint8Array(0),
        candidate: makeCandidate(),
      }),
    ).resolves.toBeDefined();
  });

  test("does not throw for garbage bytes", async () => {
    const junk = new Uint8Array(256);
    for (let i = 0; i < 256; i++) junk[i] = (i * 127 + 31) % 256;
    await expect(
      auditImageMetadata({
        downloadedBytes: junk,
        candidate: makeCandidate(),
      }),
    ).resolves.toBeDefined();
  });

  test("candidate with no optional fields produces valid result", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: {
        url: "https://example.com/img.jpg",
        source: "wikimedia",
        license: "UNKNOWN",
      },
    });
    expect(result.mergedResult.license).toBe("UNKNOWN");
    expect(result.mergedResult.artist).toBeUndefined();
    expect(result.mergedResult.copyright).toBeUndefined();
  });

  test("both sources have UNKNOWN license → merged UNKNOWN with confidence 0", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: makeCandidate({ license: "UNKNOWN" }),
    });
    expect(result.mergedResult.license).toBe("UNKNOWN");
    expect(result.mergedResult.confidence.license).toBe(0);
  });

  test("mergedResult.confidence keys are always numbers", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: makeCandidate(),
    });
    expect(typeof result.mergedResult.confidence.artist).toBe("number");
    expect(typeof result.mergedResult.confidence.copyright).toBe("number");
    expect(typeof result.mergedResult.confidence.license).toBe("number");
  });

  test("mergedResult confidence values are in [0, 1]", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({
        creator: "Artist",
        ccLicense: "https://creativecommons.org/licenses/by/4.0/",
      }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Artist", license: "CC_BY" }),
    });
    for (const [, val] of Object.entries(result.mergedResult.confidence)) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
  });

  test("resolveConflicts defaults to 'conservative'", async () => {
    // Without specifying resolveConflicts, conservative strategy applies.
    // XMP author (confidence 0.9) > provider (0.7) → embedded wins.
    const jpeg = buildJpegWithXmp(makeXmpBlock({ creator: "Embedded Default" }));
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Provider Default" }),
    });
    // Conservative: embedded XMP confidence (0.9) > provider (0.7) → embedded wins.
    expect(result.mergedResult.artist).toBe("Embedded Default");
  });

  test("licenseUrl from candidate is preserved in merged result when not conflicting", async () => {
    const result = await auditImageMetadata({
      downloadedBytes: new Uint8Array(0),
      candidate: makeCandidate({
        license: "CC_BY",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      }),
    });
    expect(result.mergedResult.licenseUrl).toBe(
      "https://creativecommons.org/licenses/by/4.0/",
    );
  });

  test("multiple conflict fields accumulate independently", async () => {
    const jpeg = buildJpegWithXmp(
      makeXmpBlock({
        creator: "Alice Wonder",
        ccLicense: "https://creativecommons.org/publicdomain/zero/1.0/",
      }),
    );
    const result = await auditImageMetadata({
      downloadedBytes: jpeg,
      candidate: makeCandidate({ author: "Bob Builder", license: "CC_BY" }),
    });
    const conflictFields = result.conflicts.map((c) => c.field);
    // Both artist and license should conflict.
    expect(conflictFields).toContain("artist");
    expect(conflictFields).toContain("license");
    expect(result.conflicts.length).toBeGreaterThanOrEqual(2);
  });
});
