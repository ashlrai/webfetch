import { describe, expect, test } from "bun:test";
import {
  parseExifBuffer,
  parseIptc,
  parseXmp,
  readImageMetadata,
} from "../packages/core/src/metadata-reader.ts";

// Build a minimal JPEG with SOI + APP1 XMP segment + EOI.
function jpegWithXmp(xmpXml: string): Uint8Array {
  const sig = "http://ns.adobe.com/xap/1.0/\0";
  const payload = new TextEncoder().encode(sig + xmpXml);
  const segLen = payload.length + 2;
  const out = new Uint8Array(4 + 2 + payload.length + 2);
  let i = 0;
  out[i++] = 0xff;
  out[i++] = 0xd8; // SOI
  out[i++] = 0xff;
  out[i++] = 0xe1; // APP1
  out[i++] = (segLen >> 8) & 0xff;
  out[i++] = segLen & 0xff;
  out.set(payload, i);
  i += payload.length;
  out[i++] = 0xff;
  out[i++] = 0xd9; // EOI
  return out;
}

// Build a minimal JPEG with an EXIF APP1 segment (TIFF header little-endian, IFD0 with Copyright tag).
function jpegWithExifCopyright(copyright: string): Uint8Array {
  const str = new TextEncoder().encode(copyright + "\0");
  // TIFF: "II*\0" + IFD offset=8
  // IFD0: 1 entry: tag=0x8298 (Copyright) type=2 count=str.length valueOffset=(str inline if <=4 else points after IFD)
  // Next IFD offset = 0.
  // IFD size = 2 + 12 + 4 = 18 bytes. Start of entry = offset 8. Value stored after IFD at offset 8+18 = 26.
  const entryCount = 1;
  const ifdStart = 8;
  const valOff = ifdStart + 2 + entryCount * 12 + 4;
  const tiffLen = valOff + str.length;
  const tiff = new Uint8Array(tiffLen);
  tiff[0] = 0x49;
  tiff[1] = 0x49; // "II"
  tiff[2] = 0x2a;
  tiff[3] = 0x00; // magic 42
  // IFD offset
  tiff[4] = 8;
  tiff[5] = 0;
  tiff[6] = 0;
  tiff[7] = 0;
  // entry count
  tiff[8] = 1;
  tiff[9] = 0;
  // entry: tag 0x8298
  tiff[10] = 0x98;
  tiff[11] = 0x82;
  // type 2 (ASCII)
  tiff[12] = 2;
  tiff[13] = 0;
  // count (4 bytes LE)
  tiff[14] = str.length & 0xff;
  tiff[15] = (str.length >> 8) & 0xff;
  tiff[16] = 0;
  tiff[17] = 0;
  // valueOffset (4 bytes LE)
  tiff[18] = valOff & 0xff;
  tiff[19] = (valOff >> 8) & 0xff;
  tiff[20] = 0;
  tiff[21] = 0;
  // next IFD offset = 0
  tiff[22] = 0;
  tiff[23] = 0;
  tiff[24] = 0;
  tiff[25] = 0;
  // value
  tiff.set(str, valOff);

  // Wrap as APP1 with "Exif\0\0" prefix.
  const sig = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  const payload = new Uint8Array(sig.length + tiff.length);
  payload.set(sig, 0);
  payload.set(tiff, sig.length);
  const segLen = payload.length + 2;
  const out = new Uint8Array(4 + 2 + payload.length + 2);
  let i = 0;
  out[i++] = 0xff;
  out[i++] = 0xd8;
  out[i++] = 0xff;
  out[i++] = 0xe1;
  out[i++] = (segLen >> 8) & 0xff;
  out[i++] = segLen & 0xff;
  out.set(payload, i);
  i += payload.length;
  out[i++] = 0xff;
  out[i++] = 0xd9;
  return out;
}

describe("parseXmp", () => {
  test("extracts dc:rights / dc:creator", () => {
    const xml = `<x:xmpmeta xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:RDF><rdf:Description>
        <dc:creator><rdf:Seq><rdf:li>Jane Photographer</rdf:li></rdf:Seq></dc:creator>
        <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© 2024 Photographer Name</rdf:li></rdf:Alt></dc:rights>
        <cc:license rdf:resource="https://creativecommons.org/licenses/by/4.0/"/>
      </rdf:Description></rdf:RDF></x:xmpmeta>`;
    const out = parseXmp(xml);
    expect(out.creator).toContain("Jane Photographer");
    expect(out.rights).toContain("Photographer Name");
    expect(out.ccLicense).toBe("https://creativecommons.org/licenses/by/4.0/");
  });
});

describe("parseIptc", () => {
  test("extracts Creator / Copyright / UsageTerms records", () => {
    // Build IIM: 0x1c, 2, dataset, len(2), bytes
    const entries: Array<[number, string]> = [
      [80, "Jane Photographer"],
      [116, "© 2024 Jane"],
      [118, "CC BY 4.0"],
    ];
    const chunks: number[] = [];
    const enc = new TextEncoder();
    for (const [ds, val] of entries) {
      const b = enc.encode(val);
      chunks.push(0x1c, 2, ds, (b.length >> 8) & 0xff, b.length & 0xff, ...b);
    }
    const out = parseIptc(new Uint8Array(chunks));
    expect(out.creator).toBe("Jane Photographer");
    expect(out.copyright).toContain("Jane");
    expect(out.usageTerms).toContain("CC BY");
  });
});

describe("parseExifBuffer", () => {
  test("extracts Copyright tag from synthetic TIFF", () => {
    const jpeg = jpegWithExifCopyright("© 2024 Some Photographer");
    // Extract the TIFF bytes (skip SOI+APP1 header+sig).
    const tiff = jpeg.subarray(2 + 4 + 6, jpeg.length - 2);
    const out = parseExifBuffer(tiff);
    expect(out.copyright).toContain("Some Photographer");
  });
});

describe("readImageMetadata", () => {
  test("empty input → empty result, no crash", async () => {
    const out = await readImageMetadata(new Uint8Array(0));
    expect(out.license).toBe("UNKNOWN");
    expect(out.confidence.license).toBe(0);
  });

  test("JPEG with XMP cc:license → license recognized as CC_BY", async () => {
    const xml = `<x:xmpmeta xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:RDF><rdf:Description>
        <dc:creator><rdf:Seq><rdf:li>Test Artist</rdf:li></rdf:Seq></dc:creator>
        <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© 2024 Test Artist</rdf:li></rdf:Alt></dc:rights>
        <cc:license rdf:resource="https://creativecommons.org/licenses/by/4.0/"/>
      </rdf:Description></rdf:RDF></x:xmpmeta>`;
    const jpeg = jpegWithXmp(xml);
    const out = await readImageMetadata(jpeg);
    expect(out.license).toBe("CC_BY");
    expect(out.artist).toContain("Test Artist");
    expect(out.confidence.license).toBeGreaterThan(0.5);
  });

  test("JPEG with EXIF Copyright → copyright populated, no license inferred", async () => {
    const jpeg = jpegWithExifCopyright("© 2024 Photographer X");
    const out = await readImageMetadata(jpeg);
    expect(out.copyright).toContain("Photographer X");
    // No license clue in pure-copyright EXIF.
    expect(out.license).toBe("UNKNOWN");
  });
});
