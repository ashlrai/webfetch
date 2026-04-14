/**
 * Attribution helpers: build the markdown snippet, the HTML comment, and the
 * XMP sidecar written next to a downloaded image.
 */

import type { ImageCandidate } from "../types";

export interface InsertionSnippet {
  markdown: string;
  xmp?: string;
}

export interface InsertionOptions {
  relativePath: string;
  alt: string;
  attributionStyle: "html-comment" | "markdown-caption" | "none";
}

export function buildMarkdownInsertion(
  candidate: ImageCandidate,
  opts: InsertionOptions,
): string {
  const safeAlt = escapeMarkdown(opts.alt || candidate.title || "image");
  const safePath = encodeSpaces(opts.relativePath);
  const img = `![${safeAlt}](${safePath})`;
  const attribution = buildAttributionLine(candidate);
  if (!attribution || opts.attributionStyle === "none") return img;
  if (opts.attributionStyle === "markdown-caption") {
    return `${img}\n\n*${attribution}*`;
  }
  return `${img}\n<!-- ${attribution} -->`;
}

export function buildAttributionLine(candidate: ImageCandidate): string {
  if (candidate.attributionLine) return candidate.attributionLine;
  const parts: string[] = [];
  if (candidate.title) parts.push(`"${candidate.title}"`);
  if (candidate.author) parts.push(`by ${candidate.author}`);
  parts.push(`(${candidate.license})`);
  if (candidate.sourcePageUrl) parts.push(`— ${candidate.sourcePageUrl}`);
  else if (candidate.source) parts.push(`via ${candidate.source}`);
  return parts.join(" ");
}

/**
 * Minimal XMP sidecar containing license + attribution. Matches the schema
 * written by @webfetch/core's metadata writer for round-trip compatibility.
 */
export function buildXmpSidecar(candidate: ImageCandidate): string {
  const escape = (s: string | undefined) =>
    (s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  return `<?xpacket begin="\u{FEFF}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="webfetch 0.1.0">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
           xmlns:dc="http://purl.org/dc/elements/1.1/"
           xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
           xmlns:cc="http://creativecommons.org/ns#"
           xmlns:plus="http://ns.useplus.org/ldf/xmp/1.0/">
    <rdf:Description rdf:about="">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escape(candidate.title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${escape(candidate.author)}</rdf:li></rdf:Seq></dc:creator>
      <dc:source>${escape(candidate.sourcePageUrl ?? candidate.url)}</dc:source>
      <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${escape(buildAttributionLine(candidate))}</rdf:li></rdf:Alt></dc:rights>
      <xmpRights:WebStatement>${escape(candidate.licenseUrl ?? "")}</xmpRights:WebStatement>
      <xmpRights:Marked>${candidate.license === "CC0" || candidate.license === "PUBLIC_DOMAIN" ? "False" : "True"}</xmpRights:Marked>
      <cc:license rdf:resource="${escape(candidate.licenseUrl ?? "")}"/>
      <plus:ImageSupplierImageID>${escape(candidate.source)}</plus:ImageSupplierImageID>
      <webfetch:License xmlns:webfetch="https://webfetch.dev/ns/1.0/">${candidate.license}</webfetch:License>
      <webfetch:Confidence xmlns:webfetch="https://webfetch.dev/ns/1.0/">${candidate.confidence ?? ""}</webfetch:Confidence>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export function mimeToExt(mime: string | undefined, fallbackUrl: string): string {
  if (mime) {
    const m = mime.toLowerCase();
    if (m.includes("jpeg") || m.includes("jpg")) return ".jpg";
    if (m.includes("png")) return ".png";
    if (m.includes("webp")) return ".webp";
    if (m.includes("gif")) return ".gif";
    if (m.includes("avif")) return ".avif";
    if (m.includes("svg")) return ".svg";
  }
  try {
    const u = new URL(fallbackUrl);
    const ext = u.pathname.match(/\.(jpg|jpeg|png|webp|gif|avif|svg)$/i);
    if (ext) return `.${ext[1].toLowerCase().replace("jpeg", "jpg")}`;
  } catch {}
  return ".img";
}

export function slugForFilename(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || "image";
}

function escapeMarkdown(s: string): string {
  return s.replace(/[\[\]\\]/g, (c) => `\\${c}`);
}

function encodeSpaces(p: string): string {
  return p.split("/").map((seg) => seg.replace(/ /g, "%20")).join("/");
}
