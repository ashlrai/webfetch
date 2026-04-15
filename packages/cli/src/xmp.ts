/**
 * XMP sidecar writer. Emits a standard XMP XML packet next to a downloaded
 * image with Dublin Core + Creative Commons + XMP Rights fields.
 *
 * Intentionally zero-dep: we build the XML by hand. Fields are escaped.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ImageCandidate } from "@webfetch/core";

export function xmpEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface XmpFields {
  creator?: string;
  rights?: string;
  license?: string;
  licenseUrl?: string;
  usageTerms?: string;
  webStatement?: string;
  title?: string;
  source?: string;
}

export function candidateToXmpFields(cand: Partial<ImageCandidate>): XmpFields {
  return {
    creator: cand.author,
    rights: cand.attributionLine,
    license: cand.license,
    licenseUrl: cand.licenseUrl,
    usageTerms: cand.attributionLine,
    webStatement: cand.sourcePageUrl ?? cand.licenseUrl,
    title: cand.title,
    source: cand.sourcePageUrl,
  };
}

export function hasAttribution(f: XmpFields): boolean {
  return !!(f.creator || f.rights || f.license || f.usageTerms || f.webStatement);
}

export function buildXmp(f: XmpFields): string {
  const line = (v: string | undefined, fn: (s: string) => string): string =>
    v ? `    ${fn(xmpEscape(v))}\n` : "";

  const langAlt = (tag: string, v: string | undefined): string => {
    if (!v) return "";
    const esc = xmpEscape(v);
    return `    <${tag}><rdf:Alt><rdf:li xml:lang="x-default">${esc}</rdf:li></rdf:Alt></${tag}>\n`;
  };
  const bag = (tag: string, v: string | undefined): string => {
    if (!v) return "";
    const esc = xmpEscape(v);
    return `    <${tag}><rdf:Bag><rdf:li>${esc}</rdf:li></rdf:Bag></${tag}>\n`;
  };
  const seq = (tag: string, v: string | undefined): string => {
    if (!v) return "";
    const esc = xmpEscape(v);
    return `    <${tag}><rdf:Seq><rdf:li>${esc}</rdf:li></rdf:Seq></${tag}>\n`;
  };
  const attr = (tag: string, v: string | undefined): string => {
    if (!v) return "";
    return `    <${tag}>${xmpEscape(v)}</${tag}>\n`;
  };

  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="webfetch-cli">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:cc="http://creativecommons.org/ns#"
        xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/">
${seq("dc:creator", f.creator)}${langAlt("dc:rights", f.rights)}${langAlt("dc:title", f.title)}${bag("dc:source", f.source)}${attr("cc:license", f.licenseUrl ?? f.license)}${langAlt("xmpRights:UsageTerms", f.usageTerms)}${attr("xmpRights:WebStatement", f.webStatement)}    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>
`;
}

export async function writeSidecar(
  imagePath: string,
  cand: Partial<ImageCandidate>,
): Promise<string | undefined> {
  const fields = candidateToXmpFields(cand);
  if (!hasAttribution(fields)) return undefined;
  const sidecarPath = `${imagePath}.xmp`;
  const xml = buildXmp(fields);
  await mkdir(dirname(sidecarPath), { recursive: true });
  await writeFile(sidecarPath, xml, "utf8");
  return sidecarPath;
}
