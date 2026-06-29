/**
 * Comprehensive tests for packages/core/src/metadata-export.ts
 *
 * Covers:
 *   - XMP sidecar generation (field mapping, XML escaping, pHash fields)
 *   - JSON sidecar generation (schema shape, all fields)
 *   - EXIF UserComment embedding for JPEG (round-trip fidelity)
 *   - Non-JPEG passthrough (PNG, WebP bytes unchanged)
 *   - licenseUrl() mapping for all License values
 *   - exportImageMetadata() integration with temp filesystem
 *   - Edge cases: missing author, no pHash, UNKNOWN license, minimal candidate
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildJsonSidecar,
  buildXmpSidecar,
  embedExifUserComment,
  exportImageMetadata,
  licenseUrl,
} from "../packages/core/src/metadata-export.ts";
import { parseExifBuffer } from "../packages/core/src/metadata-reader.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";
import type { ImageExportMetadata } from "../packages/core/src/metadata-export.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(overrides: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    url: "https://example.com/photo.jpg",
    source: "unsplash",
    license: "CC_BY",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    author: "Jane Photographer",
    title: "Sunset over mountains",
    attributionLine: "Photo by Jane Photographer (Unsplash)",
    sourcePageUrl: "https://unsplash.com/photos/abc123",
    width: 1920,
    height: 1080,
    byteSize: 204800,
    score: 0.92,
    confidence: 0.95,
    phash: "abcdef1234567890",
    phashAlgorithm: "dct-phash",
    phashResult: {
      hash: "abcdef1234567890",
      algorithm: "dct-phash",
      confidence: 1.0,
    },
    ...overrides,
  };
}

function makeMeta(
  overrides: Partial<ImageExportMetadata> = {},
  candOverrides: Partial<ImageCandidate> = {},
): ImageExportMetadata {
  const candidate = makeCandidate(candOverrides);
  return {
    candidate,
    downloadedAt: "2026-01-15T10:30:00.000Z",
    mime: "image/jpeg",
    sha256: "deadbeef".repeat(8),
    phash: candidate.phashResult
      ? {
          hash: candidate.phashResult.hash,
          algorithm: candidate.phashResult.algorithm,
          confidence: candidate.phashResult.confidence,
        }
      : undefined,
    ...overrides,
  };
}

/** Minimal JPEG bytes (SOI + EOI). */
function minimalJpeg(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
}

/** Fake PNG header bytes (does not embed EXIF — passthrough expected). */
function fakePng(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

/** Fake WebP bytes (RIFF header). */
function fakeWebP(): Uint8Array {
  const b = new Uint8Array(12);
  b.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  b.set([0x00, 0x00, 0x00, 0x00], 4); // size
  b.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  return b;
}

// ---------------------------------------------------------------------------
// licenseUrl()
// ---------------------------------------------------------------------------

describe("licenseUrl", () => {
  test("CC0 → creativecommons publicdomain/zero URL", () => {
    expect(licenseUrl("CC0")).toContain("creativecommons.org/publicdomain/zero");
  });

  test("PUBLIC_DOMAIN → publicdomain/mark URL", () => {
    expect(licenseUrl("PUBLIC_DOMAIN")).toContain("publicdomain/mark");
  });

  test("CC_BY → creativecommons by/4.0 URL", () => {
    expect(licenseUrl("CC_BY")).toContain("licenses/by/4.0");
  });

  test("CC_BY_SA → creativecommons by-sa/4.0 URL", () => {
    expect(licenseUrl("CC_BY_SA")).toContain("licenses/by-sa/4.0");
  });

  test("UNSPLASH_LICENSE → unsplash.com/license", () => {
    expect(licenseUrl("UNSPLASH_LICENSE")).toContain("unsplash.com/license");
  });

  test("PEXELS_LICENSE → pexels.com/license", () => {
    expect(licenseUrl("PEXELS_LICENSE")).toContain("pexels.com");
  });

  test("PIXABAY_LICENSE → pixabay.com/service/license", () => {
    expect(licenseUrl("PIXABAY_LICENSE")).toContain("pixabay.com");
  });

  test("EDITORIAL_LICENSED → undefined (no canonical URL)", () => {
    expect(licenseUrl("EDITORIAL_LICENSED")).toBeUndefined();
  });

  test("UNKNOWN → undefined", () => {
    expect(licenseUrl("UNKNOWN")).toBeUndefined();
  });

  test("override wins over default mapping", () => {
    expect(licenseUrl("CC_BY", "https://custom.example/license")).toBe(
      "https://custom.example/license",
    );
  });
});

// ---------------------------------------------------------------------------
// buildXmpSidecar()
// ---------------------------------------------------------------------------

describe("buildXmpSidecar", () => {
  test("produces valid XMP envelope with xpacket wrappers", () => {
    const xml = buildXmpSidecar(makeMeta());
    expect(xml).toContain("<?xpacket begin=");
    expect(xml).toContain("x:xmpmeta");
    expect(xml).toContain("rdf:RDF");
    expect(xml).toContain("<?xpacket end=");
  });

  test("includes dc:creator from author", () => {
    const xml = buildXmpSidecar(makeMeta());
    expect(xml).toContain("dc:creator");
    expect(xml).toContain("Jane Photographer");
  });

  test("includes cc:license with URL", () => {
    const xml = buildXmpSidecar(makeMeta());
    expect(xml).toContain("cc:license");
    expect(xml).toContain("creativecommons.org/licenses/by/4.0");
  });

  test("includes xmpRights:UsageTerms from attributionLine", () => {
    const xml = buildXmpSidecar(makeMeta());
    expect(xml).toContain("xmpRights:UsageTerms");
    expect(xml).toContain("Photo by Jane Photographer");
  });

  test("includes dc:title", () => {
    const xml = buildXmpSidecar(makeMeta());
    expect(xml).toContain("Sunset over mountains");
  });

  test("includes Iptc4xmpCore:SubjectCode with license tag as keyword", () => {
    const xml = buildXmpSidecar(makeMeta());
    expect(xml).toContain("Iptc4xmpCore:SubjectCode");
    expect(xml).toContain("CC_BY");
  });

  test("includes download timestamp in xmp:CreateDate", () => {
    const xml = buildXmpSidecar(makeMeta());
    expect(xml).toContain("xmp:CreateDate");
    expect(xml).toContain("2026-01-15T10:30:00.000Z");
  });

  test("includes provider ID in xmp:Label", () => {
    const xml = buildXmpSidecar(makeMeta());
    expect(xml).toContain("xmp:Label");
    expect(xml).toContain("unsplash");
  });

  test("includes pHash fields when present", () => {
    const xml = buildXmpSidecar(makeMeta());
    expect(xml).toContain("xmp:pHashValue");
    expect(xml).toContain("abcdef1234567890");
    expect(xml).toContain("xmp:pHashAlgorithm");
    expect(xml).toContain("dct-phash");
    expect(xml).toContain("xmp:pHashConfidence");
    expect(xml).toContain("1");
  });

  test("omits pHash fields when phash is absent", () => {
    const meta = makeMeta({ phash: undefined });
    const xml = buildXmpSidecar(meta);
    expect(xml).not.toContain("xmp:pHashValue");
    expect(xml).not.toContain("xmp:pHashAlgorithm");
  });

  test("XML-escapes special characters in author name", () => {
    const meta = makeMeta({}, { author: 'Jane <"Ampersand"> & O\'Malley' });
    const xml = buildXmpSidecar(meta);
    expect(xml).not.toContain("<\"");
    expect(xml).toContain("&lt;");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&quot;");
    expect(xml).toContain("&apos;");
  });

  test("XML-escapes < > in title", () => {
    const meta = makeMeta({}, { title: "Photo <test> & more" });
    const xml = buildXmpSidecar(meta);
    expect(xml).toContain("&lt;test&gt;");
    expect(xml).toContain("&amp; more");
  });

  test("handles missing author gracefully (no dc:creator element)", () => {
    const meta = makeMeta({}, { author: undefined });
    const xml = buildXmpSidecar(meta);
    // Should not crash and should not produce empty creator elements
    expect(xml).toContain("x:xmpmeta");
    expect(xml).not.toContain("<dc:creator><rdf:Seq><rdf:li></rdf:li>");
  });

  test("UNKNOWN license → cc:license has 'UNKNOWN' when no URL mapping", () => {
    const meta = makeMeta({}, { license: "UNKNOWN", licenseUrl: undefined });
    const xml = buildXmpSidecar(meta);
    // licenseUrl returns undefined for UNKNOWN, so raw license tag used
    expect(xml).toContain("UNKNOWN");
  });

  test("CC0 license → uses publicdomain/zero URL", () => {
    const meta = makeMeta({}, { license: "CC0", licenseUrl: undefined });
    const xml = buildXmpSidecar(meta);
    expect(xml).toContain("publicdomain/zero");
  });

  test("no pHash in candidate → no pHash XML fields", () => {
    const meta = makeMeta(
      { phash: undefined },
      { phash: undefined, phashResult: undefined, phashAlgorithm: undefined },
    );
    const xml = buildXmpSidecar(meta);
    expect(xml).not.toContain("pHash");
  });

  test("ahash-fallback algorithm written to xmp:pHashAlgorithm", () => {
    const meta = makeMeta({
      phash: { hash: "0000111122223333", algorithm: "ahash-fallback", confidence: 0.5 },
    });
    const xml = buildXmpSidecar(meta);
    expect(xml).toContain("ahash-fallback");
    expect(xml).toContain("0.5");
  });
});

// ---------------------------------------------------------------------------
// buildJsonSidecar()
// ---------------------------------------------------------------------------

describe("buildJsonSidecar", () => {
  test("schemaVersion is 1", () => {
    const obj = buildJsonSidecar(makeMeta());
    expect(obj.schemaVersion).toBe(1);
  });

  test("downloadedAt forwarded", () => {
    const obj = buildJsonSidecar(makeMeta());
    expect(obj.downloadedAt).toBe("2026-01-15T10:30:00.000Z");
  });

  test("sha256 forwarded", () => {
    const obj = buildJsonSidecar(makeMeta());
    expect(obj.sha256).toBe("deadbeef".repeat(8));
  });

  test("mime forwarded", () => {
    const obj = buildJsonSidecar(makeMeta());
    expect((obj as any).mime).toBe("image/jpeg");
  });

  test("source block contains providerId, url, sourcePageUrl", () => {
    const obj = buildJsonSidecar(makeMeta()) as any;
    expect(obj.source.providerId).toBe("unsplash");
    expect(obj.source.url).toBe("https://example.com/photo.jpg");
    expect(obj.source.sourcePageUrl).toBe("https://unsplash.com/photos/abc123");
  });

  test("attribution block contains all license fields", () => {
    const obj = buildJsonSidecar(makeMeta()) as any;
    expect(obj.attribution.license).toBe("CC_BY");
    expect(obj.attribution.licenseUrl).toContain("licenses/by/4.0");
    expect(obj.attribution.author).toBe("Jane Photographer");
    expect(obj.attribution.attributionLine).toBe("Photo by Jane Photographer (Unsplash)");
  });

  test("image block contains dimensions", () => {
    const obj = buildJsonSidecar(makeMeta()) as any;
    expect(obj.image.width).toBe(1920);
    expect(obj.image.height).toBe(1080);
  });

  test("perceptualHash block contains hash, algorithm, confidence", () => {
    const obj = buildJsonSidecar(makeMeta()) as any;
    expect(obj.perceptualHash.hash).toBe("abcdef1234567890");
    expect(obj.perceptualHash.algorithm).toBe("dct-phash");
    expect(obj.perceptualHash.confidence).toBe(1.0);
  });

  test("perceptualHash is null when no phash", () => {
    const meta = makeMeta({ phash: undefined });
    const obj = buildJsonSidecar(meta) as any;
    expect(obj.perceptualHash).toBeNull();
  });

  test("scores block has score and confidence", () => {
    const obj = buildJsonSidecar(makeMeta()) as any;
    expect(obj.scores.score).toBe(0.92);
    expect(obj.scores.confidence).toBe(0.95);
  });

  test("round-trip: JSON.parse(JSON.stringify(obj)) === obj", () => {
    const obj = buildJsonSidecar(makeMeta());
    expect(JSON.parse(JSON.stringify(obj))).toEqual(obj);
  });

  test("missing author → attribution.author is undefined", () => {
    const meta = makeMeta({}, { author: undefined });
    const obj = buildJsonSidecar(meta) as any;
    expect(obj.attribution.author).toBeUndefined();
  });

  test("UNKNOWN license → attribution.licenseUrl is undefined", () => {
    const meta = makeMeta({}, { license: "UNKNOWN", licenseUrl: undefined });
    const obj = buildJsonSidecar(meta) as any;
    expect(obj.attribution.licenseUrl).toBeUndefined();
  });

  test("all License types produce expected licenseUrl or undefined", () => {
    const cases: Array<[string, boolean]> = [
      ["CC0", true],
      ["PUBLIC_DOMAIN", true],
      ["CC_BY", true],
      ["CC_BY_SA", true],
      ["UNSPLASH_LICENSE", true],
      ["PEXELS_LICENSE", true],
      ["PIXABAY_LICENSE", true],
      ["EDITORIAL_LICENSED", false],
      ["PRESS_KIT_ALLOWLIST", false],
      ["UNKNOWN", false],
    ];
    for (const [lic, expectUrl] of cases) {
      const meta = makeMeta({}, { license: lic as any, licenseUrl: undefined });
      const obj = buildJsonSidecar(meta) as any;
      if (expectUrl) {
        expect(obj.attribution.licenseUrl).toBeDefined();
      } else {
        expect(obj.attribution.licenseUrl).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// embedExifUserComment()
// ---------------------------------------------------------------------------

describe("embedExifUserComment", () => {
  test("JPEG: returns larger buffer (APP1 inserted)", () => {
    const jpeg = minimalJpeg();
    const meta = makeMeta();
    const result = embedExifUserComment(jpeg, meta);
    expect(result.length).toBeGreaterThan(jpeg.length);
  });

  test("JPEG: SOI preserved at offset 0", () => {
    const jpeg = minimalJpeg();
    const result = embedExifUserComment(jpeg, makeMeta());
    expect(result[0]).toBe(0xff);
    expect(result[1]).toBe(0xd8);
  });

  test("JPEG: APP1 marker appears right after SOI", () => {
    const jpeg = minimalJpeg();
    const result = embedExifUserComment(jpeg, makeMeta());
    expect(result[2]).toBe(0xff);
    expect(result[3]).toBe(0xe1); // APP1
  });

  test("JPEG: embedded bytes contain license JSON", () => {
    const jpeg = minimalJpeg();
    const result = embedExifUserComment(jpeg, makeMeta());
    const text = new TextDecoder().decode(result);
    expect(text).toContain("CC_BY");
    expect(text).toContain("Jane Photographer");
  });

  test("JPEG: embedded bytes contain pHash when present", () => {
    const jpeg = minimalJpeg();
    const result = embedExifUserComment(jpeg, makeMeta());
    const text = new TextDecoder().decode(result);
    expect(text).toContain("abcdef1234567890");
    expect(text).toContain("dct-phash");
  });

  test("JPEG: no pHash in meta → pHash field absent from JSON payload", () => {
    const jpeg = minimalJpeg();
    const meta = makeMeta({ phash: undefined });
    const result = embedExifUserComment(jpeg, meta);
    const text = new TextDecoder().decode(result);
    // Should not contain the hash string
    expect(text).not.toContain("abcdef1234567890");
  });

  test("PNG: bytes returned unchanged (no EXIF injection)", () => {
    const png = fakePng();
    const result = embedExifUserComment(png, makeMeta());
    expect(result).toBe(png); // same reference — no copy
    expect(result.length).toBe(png.length);
  });

  test("WebP: bytes returned unchanged", () => {
    const webp = fakeWebP();
    const result = embedExifUserComment(webp, makeMeta());
    expect(result).toBe(webp);
  });

  test("empty bytes: returned unchanged", () => {
    const empty = new Uint8Array(0);
    const result = embedExifUserComment(empty, makeMeta());
    expect(result).toBe(empty);
  });

  test("round-trip: embedded JSON parses back to same license/attribution", () => {
    const jpeg = minimalJpeg();
    const meta = makeMeta();
    const modified = embedExifUserComment(jpeg, meta);

    // The TIFF IFD is embedded; let's find the UserComment JSON by scanning the bytes.
    // The ASCII charset prefix is "ASCII\0\0\0" (8 bytes) followed by JSON.
    const asciiPrefix = "ASCII\x00\x00\x00";
    const prefixBytes = new TextEncoder().encode(asciiPrefix);

    let jsonStart = -1;
    for (let i = 0; i < modified.length - prefixBytes.length; i++) {
      let match = true;
      for (let j = 0; j < prefixBytes.length; j++) {
        if (modified[i + j] !== prefixBytes[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        jsonStart = i + prefixBytes.length;
        break;
      }
    }

    expect(jsonStart).toBeGreaterThan(0);

    // Find JSON end by scanning for the closing brace
    let jsonEnd = modified.length;
    for (let i = jsonStart; i < modified.length; i++) {
      if (modified[i] === 0xff && i > jsonStart + 2) {
        jsonEnd = i;
        break;
      }
    }

    const jsonStr = new TextDecoder().decode(modified.subarray(jsonStart, jsonEnd));
    // Parse just the JSON portion
    const closeBrace = jsonStr.lastIndexOf("}");
    const parsed = JSON.parse(jsonStr.slice(0, closeBrace + 1));
    expect(parsed.license).toBe("CC_BY");
    expect(parsed.author).toBe("Jane Photographer");
    expect(parsed.providerId).toBe("unsplash");
    expect(parsed.pHash.algorithm).toBe("dct-phash");
  });

  test("JPEG with existing content preserved after inserted APP1", () => {
    // Build a 10-byte fake JPEG body after SOI to confirm it's not truncated.
    const orig = new Uint8Array(12);
    orig[0] = 0xff; orig[1] = 0xd8; // SOI
    for (let i = 2; i < 10; i++) orig[i] = i; // fake body bytes
    orig[10] = 0xff; orig[11] = 0xd9; // EOI

    const result = embedExifUserComment(orig, makeMeta());
    // Last two bytes should still be EOI
    expect(result[result.length - 2]).toBe(0xff);
    expect(result[result.length - 1]).toBe(0xd9);
    // Original body bytes (offset 2-9) should appear shifted but intact
    const app1Len = result.length - orig.length;
    expect(app1Len).toBeGreaterThan(0);
    for (let i = 2; i < 10; i++) {
      expect(result[2 + app1Len + (i - 2)]).toBe(orig[i]);
    }
  });
});

// ---------------------------------------------------------------------------
// exportImageMetadata() — integration with temp filesystem
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `webfetch-meta-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("exportImageMetadata", () => {
  test("format=xmp writes .xmp sidecar and returns xmpPath", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const bytes = minimalJpeg();
    const result = await exportImageMetadata(imgPath, makeCandidate(), bytes, {
      format: "xmp",
      downloadedAt: "2026-01-15T10:30:00.000Z",
      mime: "image/jpeg",
    });
    expect(result.xmpPath).toBe(`${imgPath}.xmp`);
    expect(result.jsonPath).toBeUndefined();
    const xml = await readFile(result.xmpPath!, "utf8");
    expect(xml).toContain("Jane Photographer");
    expect(xml).toContain("CC_BY");
  });

  test("format=json writes .meta.json sidecar and returns jsonPath", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const bytes = minimalJpeg();
    const result = await exportImageMetadata(imgPath, makeCandidate(), bytes, {
      format: "json",
      downloadedAt: "2026-01-15T10:30:00.000Z",
    });
    expect(result.jsonPath).toBe(`${imgPath}.meta.json`);
    expect(result.xmpPath).toBeUndefined();
    const raw = await readFile(result.jsonPath!, "utf8");
    const obj = JSON.parse(raw);
    expect(obj.schemaVersion).toBe(1);
    expect(obj.attribution.license).toBe("CC_BY");
    expect(obj.source.providerId).toBe("unsplash");
  });

  test("format=exif embeds EXIF into JPEG and sets exifEmbedded=true", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const bytes = minimalJpeg();
    // Write the original file first (exportImageMetadata writes to imagePath for exif)
    const { writeFile: wf } = await import("node:fs/promises");
    await wf(imgPath, bytes);

    const result = await exportImageMetadata(imgPath, makeCandidate(), bytes, {
      format: "exif",
      downloadedAt: "2026-01-15T10:30:00.000Z",
    });
    expect(result.exifEmbedded).toBe(true);
    expect(result.xmpPath).toBeUndefined();
    expect(result.jsonPath).toBeUndefined();
    // File should now be larger
    const modified = await readFile(imgPath);
    expect(modified.length).toBeGreaterThan(bytes.length);
  });

  test("format=all writes xmp + json and embeds exif", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const bytes = minimalJpeg();
    const result = await exportImageMetadata(imgPath, makeCandidate(), bytes, {
      format: "all",
      downloadedAt: "2026-01-15T10:30:00.000Z",
    });
    expect(result.xmpPath).toBeDefined();
    expect(result.jsonPath).toBeDefined();
    expect(result.exifEmbedded).toBe(true);
  });

  test("default format (omitted) writes XMP sidecar", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const result = await exportImageMetadata(imgPath, makeCandidate(), minimalJpeg());
    expect(result.xmpPath).toBeDefined();
    expect(result.jsonPath).toBeUndefined();
  });

  test("candidate with phashResult → phash fields in XMP", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const cand = makeCandidate({
      phashResult: { hash: "aaaa1111bbbb2222", algorithm: "dct-phash", confidence: 1.0 },
    });
    const result = await exportImageMetadata(imgPath, cand, minimalJpeg(), { format: "xmp" });
    const xml = await readFile(result.xmpPath!, "utf8");
    expect(xml).toContain("aaaa1111bbbb2222");
    expect(xml).toContain("dct-phash");
  });

  test("candidate with bare phash string (no phashResult) → ahash-fallback defaults", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const cand = makeCandidate({
      phash: "1234abcd5678ef01",
      phashResult: undefined,
      phashAlgorithm: undefined,
    });
    const result = await exportImageMetadata(imgPath, cand, minimalJpeg(), { format: "json" });
    const obj = JSON.parse(await readFile(result.jsonPath!, "utf8")) as any;
    expect(obj.perceptualHash.hash).toBe("1234abcd5678ef01");
    expect(obj.perceptualHash.algorithm).toBe("ahash-fallback");
    expect(obj.perceptualHash.confidence).toBe(0.5);
  });

  test("candidate with phashAlgorithm=dct-phash but no phashResult → confidence 1.0", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const cand = makeCandidate({
      phash: "aabbccdd11223344",
      phashResult: undefined,
      phashAlgorithm: "dct-phash",
    });
    const result = await exportImageMetadata(imgPath, cand, minimalJpeg(), { format: "json" });
    const obj = JSON.parse(await readFile(result.jsonPath!, "utf8")) as any;
    expect(obj.perceptualHash.confidence).toBe(1.0);
  });

  test("missing author → xmp still valid, no crash", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const cand = makeCandidate({ author: undefined, attributionLine: undefined });
    const result = await exportImageMetadata(imgPath, cand, minimalJpeg(), { format: "xmp" });
    const xml = await readFile(result.xmpPath!, "utf8");
    expect(xml).toContain("x:xmpmeta");
  });

  test("UNKNOWN license → json sidecar has null licenseUrl", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const cand = makeCandidate({ license: "UNKNOWN", licenseUrl: undefined });
    const result = await exportImageMetadata(imgPath, cand, minimalJpeg(), { format: "json" });
    const obj = JSON.parse(await readFile(result.jsonPath!, "utf8")) as any;
    expect(obj.attribution.licenseUrl).toBeUndefined();
    expect(obj.attribution.license).toBe("UNKNOWN");
  });

  test("PNG bytes: exif format → exifEmbedded false (passthrough, no write)", async () => {
    const imgPath = join(tmpDir, "photo.png");
    const bytes = fakePng();
    const result = await exportImageMetadata(imgPath, makeCandidate(), bytes, { format: "exif" });
    // PNG is not modified; exifEmbedded should be falsy
    expect(result.exifEmbedded).toBeFalsy();
  });

  test("WebP bytes: exif format → exifEmbedded false (passthrough)", async () => {
    const imgPath = join(tmpDir, "photo.webp");
    const bytes = fakeWebP();
    const result = await exportImageMetadata(imgPath, makeCandidate(), bytes, { format: "exif" });
    expect(result.exifEmbedded).toBeFalsy();
  });

  test("sha256 forwarded into JSON sidecar", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const result = await exportImageMetadata(imgPath, makeCandidate(), minimalJpeg(), {
      format: "json",
      sha256: "cafebabe".repeat(8),
    });
    const obj = JSON.parse(await readFile(result.jsonPath!, "utf8")) as any;
    expect(obj.sha256).toBe("cafebabe".repeat(8));
  });

  test("downloadedAt defaults to a valid ISO string when not provided", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const before = Date.now();
    const result = await exportImageMetadata(imgPath, makeCandidate(), minimalJpeg(), {
      format: "json",
    });
    const after = Date.now();
    const obj = JSON.parse(await readFile(result.jsonPath!, "utf8")) as any;
    const ts = new Date(obj.downloadedAt).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("XMP round-trip: author survives write → read", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const cand = makeCandidate({ author: "Alice & Bob <test>" });
    const result = await exportImageMetadata(imgPath, cand, minimalJpeg(), { format: "xmp" });
    const xml = await readFile(result.xmpPath!, "utf8");
    // The encoded form should be present; unescaped form should NOT appear raw
    expect(xml).toContain("Alice &amp; Bob &lt;test&gt;");
  });

  test("JSON round-trip fidelity: candidate fields preserved", async () => {
    const imgPath = join(tmpDir, "photo.jpg");
    const cand = makeCandidate();
    const result = await exportImageMetadata(imgPath, cand, minimalJpeg(), {
      format: "json",
      sha256: "abc123",
      mime: "image/jpeg",
      downloadedAt: "2026-06-01T00:00:00.000Z",
    });
    const obj = JSON.parse(await readFile(result.jsonPath!, "utf8")) as any;
    expect(obj.source.url).toBe(cand.url);
    expect(obj.source.providerId).toBe(cand.source);
    expect(obj.attribution.author).toBe(cand.author);
    expect(obj.image.width).toBe(1920);
    expect(obj.image.height).toBe(1080);
    expect(obj.downloadedAt).toBe("2026-06-01T00:00:00.000Z");
  });
});
