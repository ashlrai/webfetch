/**
 * Multi-format metadata export for cached images.
 *
 * Supports three output formats:
 *   - XMP sidecar (.xmp): IPTC keyword, copyright, attribution, license URL,
 *     provider ID, pHash confidence, download timestamp.
 *   - EXIF/IPTC embedded: modifies JPEG/PNG UserComment APP1 marker in-place
 *     with JSON-serialized license + attribution + pHash algorithm metadata.
 *   - JSON sidecar (.json): full structured metadata (ImageCandidate +
 *     download metadata + perceptual hash details).
 *
 * All functions are pure (no FS IO) except the top-level exportImageMetadata()
 * which writes sidecar files and returns the paths written.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ImageCandidate, License, PerceptualHashResult } from "./types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExportFormat = "xmp" | "exif" | "json" | "all";

export interface ExportMetadataOptions {
  /** Which format(s) to write. Default: "xmp". */
  format?: ExportFormat;
  /** ISO-8601 timestamp of when the image was downloaded. Defaults to now. */
  downloadedAt?: string;
  /** MIME type of the downloaded image (e.g. "image/jpeg"). */
  mime?: string;
  /** SHA-256 hex digest of the image bytes. */
  sha256?: string;
}

/** Metadata written alongside a downloaded image. */
export interface ImageExportMetadata {
  /** The ImageCandidate as supplied. */
  candidate: ImageCandidate;
  /** ISO-8601 timestamp of download. */
  downloadedAt: string;
  /** MIME type detected on download, if known. */
  mime?: string;
  /** SHA-256 of the image bytes, if known. */
  sha256?: string;
  /** Perceptual hash details (mirrors candidate.phashResult). */
  phash?: {
    hash: string;
    algorithm: "dct-phash" | "ahash-fallback";
    confidence: number;
  };
}

/** Paths of sidecar files written (undefined when not written). */
export interface ExportResult {
  xmpPath?: string;
  jsonPath?: string;
  /** True when EXIF UserComment was embedded into the image bytes. */
  exifEmbedded?: boolean;
}

// ---------------------------------------------------------------------------
// License URL mapping
// ---------------------------------------------------------------------------

const LICENSE_URL_MAP: Record<License, string | undefined> = {
  CC0: "https://creativecommons.org/publicdomain/zero/1.0/",
  PUBLIC_DOMAIN: "https://creativecommons.org/publicdomain/mark/1.0/",
  CC_BY: "https://creativecommons.org/licenses/by/4.0/",
  CC_BY_SA: "https://creativecommons.org/licenses/by-sa/4.0/",
  UNSPLASH_LICENSE: "https://unsplash.com/license",
  PEXELS_LICENSE: "https://www.pexels.com/license/",
  PIXABAY_LICENSE: "https://pixabay.com/service/license/",
  EDITORIAL_LICENSED: undefined,
  PRESS_KIT_ALLOWLIST: undefined,
  UNKNOWN: undefined,
};

/** Returns the canonical license URL for a given license tag. */
export function licenseUrl(license: License, override?: string): string | undefined {
  return override ?? LICENSE_URL_MAP[license];
}

// ---------------------------------------------------------------------------
// XMP builder
// ---------------------------------------------------------------------------

function xmpEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build an XMP sidecar XML string with IPTC / DC / CC / XMPRights fields.
 * Includes pHash confidence, provider ID, and download timestamp as custom
 * xmp:* properties.
 */
export function buildXmpSidecar(meta: ImageExportMetadata): string {
  const c = meta.candidate;
  const lUrl = licenseUrl(c.license, c.licenseUrl);

  const e = (v: string | undefined): string => (v ? xmpEscape(v) : "");
  const attr = (tag: string, v: string | undefined): string =>
    v ? `    <${tag}>${e(v)}</${tag}>\n` : "";
  const langAlt = (tag: string, v: string | undefined): string => {
    if (!v) return "";
    return `    <${tag}><rdf:Alt><rdf:li xml:lang="x-default">${e(v)}</rdf:li></rdf:Alt></${tag}>\n`;
  };
  const seq = (tag: string, v: string | undefined): string => {
    if (!v) return "";
    return `    <${tag}><rdf:Seq><rdf:li>${e(v)}</rdf:li></rdf:Seq></${tag}>\n`;
  };
  const bag = (tag: string, v: string | undefined): string => {
    if (!v) return "";
    return `    <${tag}><rdf:Bag><rdf:li>${e(v)}</rdf:li></rdf:Bag></${tag}>\n`;
  };

  // IPTC keyword = license tag
  const keyword = c.license !== "UNKNOWN" ? c.license : undefined;

  // pHash confidence as a string value
  const phashConf =
    meta.phash?.confidence !== undefined ? String(meta.phash.confidence) : undefined;
  const phashAlg = meta.phash?.algorithm;
  const phashHash = meta.phash?.hash;

  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="webfetch-core">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:cc="http://creativecommons.org/ns#"
        xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
        xmlns:xmp="http://ns.adobe.com/xap/1.0/"
        xmlns:Iptc4xmpCore="http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/">
${seq("dc:creator", c.author)}${langAlt("dc:rights", c.attributionLine ?? c.author ? `© ${c.author ?? "unknown"}` : undefined)}${langAlt("dc:title", c.title)}${bag("dc:source", c.sourcePageUrl ?? c.url)}${bag("Iptc4xmpCore:SubjectCode", keyword)}${attr("cc:license", lUrl ?? c.license)}${langAlt("xmpRights:UsageTerms", c.attributionLine)}${attr("xmpRights:WebStatement", c.sourcePageUrl ?? c.licenseUrl)}${attr("xmp:CreateDate", meta.downloadedAt)}${attr("xmp:MetadataDate", meta.downloadedAt)}${attr("xmp:Label", c.source)}${phashHash ? `    <xmp:pHashValue>${e(phashHash)}</xmp:pHashValue>\n` : ""}${phashAlg ? `    <xmp:pHashAlgorithm>${e(phashAlg)}</xmp:pHashAlgorithm>\n` : ""}${phashConf ? `    <xmp:pHashConfidence>${e(phashConf)}</xmp:pHashConfidence>\n` : ""}    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`;
}

// ---------------------------------------------------------------------------
// JSON sidecar builder
// ---------------------------------------------------------------------------

/** Build full structured metadata as a JSON-serialisable object. */
export function buildJsonSidecar(meta: ImageExportMetadata): Record<string, unknown> {
  const c = meta.candidate;
  return {
    schemaVersion: 1,
    downloadedAt: meta.downloadedAt,
    sha256: meta.sha256,
    mime: meta.mime,
    source: {
      providerId: c.source,
      url: c.url,
      thumbnailUrl: c.thumbnailUrl,
      sourcePageUrl: c.sourcePageUrl,
    },
    image: {
      width: c.width,
      height: c.height,
      byteSize: c.byteSize,
    },
    attribution: {
      author: c.author,
      title: c.title,
      license: c.license,
      licenseUrl: licenseUrl(c.license, c.licenseUrl),
      attributionLine: c.attributionLine,
    },
    perceptualHash: meta.phash
      ? {
          hash: meta.phash.hash,
          algorithm: meta.phash.algorithm,
          confidence: meta.phash.confidence,
        }
      : null,
    scores: {
      score: c.score,
      confidence: c.confidence,
    },
    raw: c.raw ?? null,
  };
}

// ---------------------------------------------------------------------------
// EXIF UserComment embedding (JPEG / PNG)
// ---------------------------------------------------------------------------

/**
 * Embed a UserComment EXIF field into JPEG bytes by appending an APP1 EXIF
 * marker that contains a minimal TIFF IFD0 with tag 0x9286 (UserComment).
 *
 * The UserComment value uses the ASCII charset prefix ("ASCII\0\0\0") followed
 * by a JSON string encoding the license + attribution + pHash metadata.
 *
 * Returns modified bytes. For non-JPEG inputs the bytes are returned unchanged.
 */
export function embedExifUserComment(bytes: Uint8Array, meta: ImageExportMetadata): Uint8Array {
  // Only JPEG is supported (SOI = 0xff 0xd8).
  const isJpeg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!isJpeg) {
    // For PNG / WebP return bytes unchanged — embedding EXIF into these
    // formats requires non-trivial chunk manipulation; we skip it safely.
    return bytes;
  }

  const c = meta.candidate;
  const commentPayload: Record<string, unknown> = {
    license: c.license,
    licenseUrl: licenseUrl(c.license, c.licenseUrl),
    attribution: c.attributionLine,
    author: c.author,
    providerId: c.source,
    downloadedAt: meta.downloadedAt,
    pHash: meta.phash
      ? {
          hash: meta.phash.hash,
          algorithm: meta.phash.algorithm,
          confidence: meta.phash.confidence,
        }
      : undefined,
  };

  const jsonStr = JSON.stringify(commentPayload);
  // UserComment encoding: 8-byte charset prefix "ASCII\0\0\0" + comment bytes
  const prefix = new Uint8Array([0x41, 0x53, 0x43, 0x49, 0x49, 0x00, 0x00, 0x00]); // "ASCII\0\0\0"
  const commentEnc = new TextEncoder().encode(jsonStr);
  const userCommentValue = new Uint8Array(prefix.length + commentEnc.length);
  userCommentValue.set(prefix, 0);
  userCommentValue.set(commentEnc, prefix.length);

  // Build minimal TIFF (little-endian) with IFD0 containing one entry: 0x9286 (UserComment).
  // TIFF layout:
  //   0–1:  "II" (little-endian)
  //   2–3:  0x002a (magic)
  //   4–7:  IFD offset = 8
  //   8–9:  entry count = 1
  //   10–21: IFD entry (12 bytes)
  //     tag=0x9286, type=7 (UNDEFINED), count=valueLen, offset/value (4 bytes)
  //   22–25: next IFD offset = 0
  //   26+:  value data (when count > 4)
  const valLen = userCommentValue.length;
  const valOffset = 26; // after IFD0 (8 + 2 + 12 + 4)
  const tiffLen = valOffset + valLen;
  const tiff = new Uint8Array(tiffLen);

  // Header
  tiff[0] = 0x49; tiff[1] = 0x49; // "II"
  tiff[2] = 0x2a; tiff[3] = 0x00; // magic
  tiff[4] = 0x08; tiff[5] = 0x00; tiff[6] = 0x00; tiff[7] = 0x00; // IFD offset

  // Entry count
  tiff[8] = 0x01; tiff[9] = 0x00;

  // IFD entry at offset 10: tag 0x9286 (UserComment)
  tiff[10] = 0x86; tiff[11] = 0x92; // tag LE
  tiff[12] = 0x07; tiff[13] = 0x00; // type = UNDEFINED (7)
  tiff[14] = valLen & 0xff; tiff[15] = (valLen >> 8) & 0xff; // count LE
  tiff[16] = (valLen >> 16) & 0xff; tiff[17] = (valLen >> 24) & 0xff;
  tiff[18] = valOffset & 0xff; tiff[19] = (valOffset >> 8) & 0xff; // value offset LE
  tiff[20] = (valOffset >> 16) & 0xff; tiff[21] = (valOffset >> 24) & 0xff;

  // Next IFD offset = 0
  tiff[22] = 0x00; tiff[23] = 0x00; tiff[24] = 0x00; tiff[25] = 0x00;

  // Value
  tiff.set(userCommentValue, valOffset);

  // Wrap TIFF in "Exif\0\0" + TIFF = APP1 payload
  const exifSig = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const app1Payload = new Uint8Array(exifSig.length + tiff.length);
  app1Payload.set(exifSig, 0);
  app1Payload.set(tiff, exifSig.length);

  const segLen = app1Payload.length + 2; // length field includes itself
  const app1Marker = new Uint8Array(2 + 2 + app1Payload.length);
  app1Marker[0] = 0xff; app1Marker[1] = 0xe1; // APP1 marker
  app1Marker[2] = (segLen >> 8) & 0xff; app1Marker[3] = segLen & 0xff;
  app1Marker.set(app1Payload, 4);

  // Insert APP1 right after SOI (first 2 bytes).
  const result = new Uint8Array(bytes.length + app1Marker.length);
  result.set(bytes.subarray(0, 2), 0);      // SOI
  result.set(app1Marker, 2);                // new APP1
  result.set(bytes.subarray(2), 2 + app1Marker.length); // rest of JPEG
  return result;
}

// ---------------------------------------------------------------------------
// Top-level export function
// ---------------------------------------------------------------------------

/**
 * Export metadata for a downloaded image in one or more formats.
 *
 * @param imagePath  Absolute path to the downloaded image file.
 * @param candidate  ImageCandidate describing the image.
 * @param bytes      The raw image bytes (used for EXIF embedding).
 * @param opts       Export options including format and download metadata.
 * @returns          Paths of any sidecar files written and whether EXIF was embedded.
 */
export async function exportImageMetadata(
  imagePath: string,
  candidate: ImageCandidate,
  bytes: Uint8Array,
  opts: ExportMetadataOptions = {},
): Promise<ExportResult> {
  const format = opts.format ?? "xmp";
  const downloadedAt = opts.downloadedAt ?? new Date().toISOString();

  const phash: ImageExportMetadata["phash"] = candidate.phashResult
    ? {
        hash: candidate.phashResult.hash,
        algorithm: candidate.phashResult.algorithm,
        confidence: candidate.phashResult.confidence,
      }
    : candidate.phash
      ? {
          hash: candidate.phash,
          algorithm: candidate.phashAlgorithm ?? "ahash-fallback",
          confidence: candidate.phashAlgorithm === "dct-phash" ? 1.0 : 0.5,
        }
      : undefined;

  const meta: ImageExportMetadata = {
    candidate,
    downloadedAt,
    mime: opts.mime,
    sha256: opts.sha256,
    phash,
  };

  const result: ExportResult = {};
  const wantsXmp = format === "xmp" || format === "all";
  const wantsExif = format === "exif" || format === "all";
  const wantsJson = format === "json" || format === "all";

  if (wantsXmp) {
    const xmpPath = `${imagePath}.xmp`;
    const xml = buildXmpSidecar(meta);
    await mkdir(dirname(xmpPath), { recursive: true });
    await writeFile(xmpPath, xml, "utf8");
    result.xmpPath = xmpPath;
  }

  if (wantsJson) {
    const jsonPath = `${imagePath}.meta.json`;
    const obj = buildJsonSidecar(meta);
    await mkdir(dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, JSON.stringify(obj, null, 2), "utf8");
    result.jsonPath = jsonPath;
  }

  if (wantsExif) {
    const modified = embedExifUserComment(bytes, meta);
    if (modified !== bytes) {
      // Write modified bytes back to the image file.
      await writeFile(imagePath, modified);
      result.exifEmbedded = true;
    }
  }

  return result;
}
