/**
 * Embedded image metadata reader.
 *
 * Extracts rights / authorship hints from:
 *   - EXIF: Artist (0x013B), Copyright (0x8298), ImageDescription (0x010E)
 *   - IPTC IIM (embedded in JPEG APP13 Photoshop IRB, record 2):
 *       Creator (2:80), Copyright Notice (2:116), Rights Usage Terms (2:118)
 *   - XMP (XML in an APP1 marker starting with "http://ns.adobe.com/xap/1.0/\0"):
 *       dc:creator, dc:rights, xmpRights:UsageTerms, xmpRights:WebStatement,
 *       cc:license
 *
 * If `sharp` is available we use `sharp().metadata()` to get EXIF + XMP
 * buffers cheaply. When it's not available we do a light-touch JPEG marker
 * scan directly on the bytes.
 */

import { coerceLicense } from "./license.ts";
import type { License } from "./types.ts";

export interface EmbeddedMetadata {
  artist?: string;
  copyright?: string;
  description?: string;
  license: License;
  licenseUrl?: string;
  sourceWebStatement?: string;
  /** Confidence per field, 0..1. */
  confidence: {
    artist: number;
    copyright: number;
    license: number;
  };
}

const EMPTY: EmbeddedMetadata = {
  license: "UNKNOWN",
  confidence: { artist: 0, copyright: 0, license: 0 },
};

async function loadSharp(): Promise<any | null> {
  try {
    // @ts-ignore - optional peer dep
    const mod = await import("sharp");
    return (mod as any).default ?? mod;
  } catch {
    return null;
  }
}

export async function readImageMetadata(bytes: Uint8Array): Promise<EmbeddedMetadata> {
  if (!bytes || bytes.length === 0) return { ...EMPTY, confidence: { ...EMPTY.confidence } };

  const result: EmbeddedMetadata = {
    license: "UNKNOWN",
    confidence: { artist: 0, copyright: 0, license: 0 },
  };

  // 1. Try sharp for structured metadata (EXIF buffer + XMP buffer).
  const sharp = await loadSharp();
  if (sharp) {
    try {
      const m = await sharp(bytes).metadata();
      if (m?.exif instanceof Uint8Array || m?.exif?.buffer) {
        const exif = parseExifBuffer(
          m.exif instanceof Uint8Array ? m.exif : new Uint8Array(m.exif as any),
        );
        applyExif(result, exif);
      }
      if (m?.xmp instanceof Uint8Array || m?.xmp?.buffer) {
        const xmpStr = new TextDecoder("utf-8", { fatal: false }).decode(
          m.xmp instanceof Uint8Array ? m.xmp : new Uint8Array(m.xmp as any),
        );
        applyXmp(result, parseXmp(xmpStr));
      }
      if ((m as any)?.iptc instanceof Uint8Array) {
        applyIptc(result, parseIptc((m as any).iptc));
      }
    } catch {
      // fall through to raw scan
    }
  }

  // 2. Raw marker scan — reads XMP/IPTC out of JPEG even without sharp.
  try {
    const segs = scanJpegSegments(bytes);
    for (const s of segs) {
      if (s.kind === "xmp") {
        applyXmp(result, parseXmp(s.text));
      } else if (s.kind === "iptc") {
        applyIptc(result, parseIptc(s.bytes));
      } else if (s.kind === "exif") {
        applyExif(result, parseExifBuffer(s.bytes));
      }
    }
  } catch {
    // tolerate malformed
  }

  return result;
}

function applyExif(out: EmbeddedMetadata, e: { artist?: string; copyright?: string; description?: string }) {
  if (e.artist && !out.artist) {
    out.artist = e.artist;
    out.confidence.artist = Math.max(out.confidence.artist, 0.7);
  }
  if (e.copyright && !out.copyright) {
    out.copyright = e.copyright;
    out.confidence.copyright = Math.max(out.confidence.copyright, 0.7);
  }
  if (e.description && !out.description) out.description = e.description;
}

function applyIptc(out: EmbeddedMetadata, e: { creator?: string; copyright?: string; usageTerms?: string }) {
  if (e.creator && !out.artist) {
    out.artist = e.creator;
    out.confidence.artist = Math.max(out.confidence.artist, 0.8);
  }
  if (e.copyright && !out.copyright) {
    out.copyright = e.copyright;
    out.confidence.copyright = Math.max(out.confidence.copyright, 0.8);
  }
  if (e.usageTerms) {
    const lic = coerceLicense(e.usageTerms);
    if (lic !== "UNKNOWN") {
      out.license = lic;
      out.confidence.license = Math.max(out.confidence.license, 0.75);
    }
  }
}

interface XmpFields {
  creator?: string;
  rights?: string;
  usageTerms?: string;
  webStatement?: string;
  ccLicense?: string;
}

function applyXmp(out: EmbeddedMetadata, e: XmpFields) {
  if (e.creator && !out.artist) {
    out.artist = e.creator;
    out.confidence.artist = Math.max(out.confidence.artist, 0.9);
  }
  if (e.rights && !out.copyright) {
    out.copyright = e.rights;
    out.confidence.copyright = Math.max(out.confidence.copyright, 0.9);
  }
  if (e.webStatement) out.sourceWebStatement = e.webStatement;

  // License — cc:license wins, then xmpRights:UsageTerms, then rights string.
  const licCandidates = [e.ccLicense, e.usageTerms, e.webStatement, e.rights].filter(Boolean) as string[];
  for (const c of licCandidates) {
    const coerced = coerceLicense(c);
    if (coerced !== "UNKNOWN") {
      out.license = coerced;
      out.confidence.license = Math.max(
        out.confidence.license,
        c === e.ccLicense ? 0.95 : 0.8,
      );
      if (!out.licenseUrl && /^https?:\/\//.test(c)) out.licenseUrl = c;
      break;
    }
  }
  if (!out.licenseUrl && e.ccLicense && /^https?:\/\//.test(e.ccLicense)) {
    out.licenseUrl = e.ccLicense;
  }
}

// -----------------------------------------------------------------------------
// XMP parser — it's just XML.
// -----------------------------------------------------------------------------

export function parseXmp(xml: string): XmpFields {
  if (!xml || !xml.includes("<")) return {};
  const out: XmpFields = {};

  // dc:creator — often inside <rdf:Seq><rdf:li>...
  out.creator = firstInnerText(xml, /<dc:creator[\s>][\s\S]*?<\/dc:creator>/i);
  out.rights = firstInnerText(xml, /<dc:rights[\s>][\s\S]*?<\/dc:rights>/i);
  out.usageTerms = firstInnerText(xml, /<xmpRights:UsageTerms[\s>][\s\S]*?<\/xmpRights:UsageTerms>/i);
  out.webStatement = attrOrText(xml, /<xmpRights:WebStatement\b[^>]*>/i, "rdf:resource") ??
    firstInnerText(xml, /<xmpRights:WebStatement[\s>][\s\S]*?<\/xmpRights:WebStatement>/i);

  // cc:license - usually a rdf:resource attribute.
  out.ccLicense = attrOrText(xml, /<cc:license\b[^>]*>/i, "rdf:resource") ??
    firstInnerText(xml, /<cc:license[\s>][\s\S]*?<\/cc:license>/i);

  return out;
}

function firstInnerText(xml: string, re: RegExp): string | undefined {
  const m = xml.match(re);
  if (!m) return undefined;
  // Strip nested tags; collapse whitespace.
  const inner = m[0].replace(/^<[^>]+>/, "").replace(/<\/[^>]+>$/, "");
  const text = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text || undefined;
}

function attrOrText(xml: string, re: RegExp, attr: string): string | undefined {
  const m = xml.match(re);
  if (!m) return undefined;
  const a = new RegExp(`${attr}=["']([^"']+)["']`, "i").exec(m[0]);
  return a?.[1];
}

// -----------------------------------------------------------------------------
// JPEG segment scanner — walks APP markers and returns XMP / EXIF / IPTC payloads.
// -----------------------------------------------------------------------------

type Segment =
  | { kind: "xmp"; text: string }
  | { kind: "exif"; bytes: Uint8Array }
  | { kind: "iptc"; bytes: Uint8Array };

function scanJpegSegments(bytes: Uint8Array): Segment[] {
  const out: Segment[] = [];
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return out;
  let i = 2;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1]!;
    i += 2;
    // SOI/EOI/RSTn have no length.
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (i + 2 > bytes.length) break;
    const len = (bytes[i]! << 8) | bytes[i + 1]!;
    if (len < 2 || i + len > bytes.length) break;
    const payload = bytes.subarray(i + 2, i + len);
    // APP1 (0xe1) — could be EXIF or XMP.
    if (marker === 0xe1) {
      const exifSig = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
      if (hasPrefix(payload, exifSig)) {
        out.push({ kind: "exif", bytes: payload.subarray(6) });
      } else {
        const xmpSig = "http://ns.adobe.com/xap/1.0/\0";
        if (asciiMatches(payload, xmpSig)) {
          const text = new TextDecoder("utf-8", { fatal: false }).decode(
            payload.subarray(xmpSig.length),
          );
          out.push({ kind: "xmp", text });
        }
      }
    }
    // APP13 (0xed) — Photoshop IRB; IPTC IIM lives in resource 0x0404.
    if (marker === 0xed) {
      const psSig = "Photoshop 3.0\0";
      if (asciiMatches(payload, psSig)) {
        const iptc = extractIptcFromIrb(payload.subarray(psSig.length));
        if (iptc) out.push({ kind: "iptc", bytes: iptc });
      }
    }
    i += len;
    // SOS — after this is entropy-coded; nothing else we care about.
    if (marker === 0xda) break;
  }
  return out;
}

function hasPrefix(b: Uint8Array, p: number[]): boolean {
  if (b.length < p.length) return false;
  for (let i = 0; i < p.length; i++) if (b[i] !== p[i]) return false;
  return true;
}

function asciiMatches(b: Uint8Array, s: string): boolean {
  if (b.length < s.length) return false;
  for (let i = 0; i < s.length; i++) if (b[i] !== s.charCodeAt(i)) return false;
  return true;
}

function extractIptcFromIrb(irb: Uint8Array): Uint8Array | null {
  // IRB records: "8BIM" + 2-byte ID + Pascal name (padded even) + 4-byte size + data (padded even).
  let i = 0;
  while (i + 12 <= irb.length) {
    if (
      irb[i] !== 0x38 ||
      irb[i + 1] !== 0x42 ||
      irb[i + 2] !== 0x49 ||
      irb[i + 3] !== 0x4d
    )
      break;
    const id = (irb[i + 4]! << 8) | irb[i + 5]!;
    i += 6;
    const nameLen = irb[i]!;
    const nameTot = nameLen + 1;
    i += nameTot + (nameTot % 2);
    if (i + 4 > irb.length) break;
    const size =
      (irb[i]! << 24) | (irb[i + 1]! << 16) | (irb[i + 2]! << 8) | irb[i + 3]!;
    i += 4;
    const data = irb.subarray(i, i + size);
    i += size + (size % 2);
    if (id === 0x0404) return data;
  }
  return null;
}

// -----------------------------------------------------------------------------
// IPTC IIM parser — record 2 only; records have: 0x1C, 2, dataset, len(2), data
// -----------------------------------------------------------------------------

export function parseIptc(bytes: Uint8Array): {
  creator?: string;
  copyright?: string;
  usageTerms?: string;
} {
  const out: { creator?: string; copyright?: string; usageTerms?: string } = {};
  let i = 0;
  const td = new TextDecoder("utf-8", { fatal: false });
  while (i + 5 <= bytes.length) {
    if (bytes[i] !== 0x1c) {
      i += 1;
      continue;
    }
    const record = bytes[i + 1];
    const dataset = bytes[i + 2]!;
    const len = (bytes[i + 3]! << 8) | bytes[i + 4]!;
    i += 5;
    if (i + len > bytes.length) break;
    const value = td.decode(bytes.subarray(i, i + len));
    i += len;
    if (record !== 2) continue;
    if (dataset === 80 && !out.creator) out.creator = value.trim();
    else if (dataset === 116 && !out.copyright) out.copyright = value.trim();
    else if (dataset === 118 && !out.usageTerms) out.usageTerms = value.trim();
  }
  return out;
}

// -----------------------------------------------------------------------------
// Minimal EXIF TIFF parser — just pulls string-valued Artist / Copyright / Description tags.
// -----------------------------------------------------------------------------

export function parseExifBuffer(buf: Uint8Array): {
  artist?: string;
  copyright?: string;
  description?: string;
} {
  const out: { artist?: string; copyright?: string; description?: string } = {};
  if (buf.length < 8) return out;

  // Skip leading "Exif\0\0" if present (sharp sometimes includes it).
  let start = 0;
  if (
    buf.length >= 6 &&
    buf[0] === 0x45 &&
    buf[1] === 0x78 &&
    buf[2] === 0x69 &&
    buf[3] === 0x66 &&
    buf[4] === 0x00 &&
    buf[5] === 0x00
  ) {
    start = 6;
  }

  const b = buf.subarray(start);
  if (b.length < 8) return out;

  let little: boolean;
  if (b[0] === 0x49 && b[1] === 0x49) little = true;
  else if (b[0] === 0x4d && b[1] === 0x4d) little = false;
  else return out;

  const read16 = (o: number) =>
    little ? b[o]! | (b[o + 1]! << 8) : (b[o]! << 8) | b[o + 1]!;
  const read32 = (o: number) =>
    little
      ? b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)
      : (b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!;

  if (read16(2) !== 0x002a) return out;
  const ifd0 = read32(4);
  if (ifd0 + 2 > b.length) return out;
  const count = read16(ifd0);
  const td = new TextDecoder("utf-8", { fatal: false });

  for (let n = 0; n < count; n++) {
    const entry = ifd0 + 2 + n * 12;
    if (entry + 12 > b.length) break;
    const tag = read16(entry);
    const type = read16(entry + 2);
    const cnt = read32(entry + 4);
    if (type !== 2) continue; // ASCII only
    let valOff: number;
    let byteLen = cnt;
    if (byteLen <= 4) valOff = entry + 8;
    else valOff = read32(entry + 8);
    if (valOff + byteLen > b.length) continue;
    const raw = b.subarray(valOff, valOff + byteLen);
    // strip trailing NUL
    let end = raw.length;
    while (end > 0 && raw[end - 1] === 0) end--;
    const s = td.decode(raw.subarray(0, end)).trim();
    if (!s) continue;
    if (tag === 0x013b && !out.artist) out.artist = s;
    else if (tag === 0x8298 && !out.copyright) out.copyright = s;
    else if (tag === 0x010e && !out.description) out.description = s;
  }
  return out;
}
