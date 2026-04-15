/**
 * Attribution sidecar builder — every browser-sourced candidate gets an
 * auditable JSON record describing provenance (source URL, extractor,
 * screenshot ref, timestamps). Cloud tier uses this as the evidence trail
 * for enterprise legal-indemnification.
 */

import type { ImageCandidate } from "@webfetch/core";
import type { ExtractorId } from "./types.ts";

export interface AttributionSidecar {
  schema: "webfetch.browser.attribution/1";
  imageUrl: string;
  sourcePageUrl?: string;
  extractor: ExtractorId;
  fetchedVia: string; // "browser:<extractor>"
  fetchedAt: string; // ISO
  screenshotRef?: string; // path in cache to a .png thumbnail
  license: ImageCandidate["license"];
  licenseConfidence: number;
  stack: string;
  consentAcknowledged: true;
  notes?: string[];
}

export function buildSidecar(input: {
  candidate: ImageCandidate;
  extractor: ExtractorId;
  stack: string;
  screenshotRef?: string;
  notes?: string[];
}): AttributionSidecar {
  const { candidate, extractor, stack, screenshotRef, notes } = input;
  return {
    schema: "webfetch.browser.attribution/1",
    imageUrl: candidate.url,
    sourcePageUrl: candidate.sourcePageUrl,
    extractor,
    fetchedVia: `browser:${extractor}`,
    fetchedAt: new Date().toISOString(),
    screenshotRef,
    license: candidate.license,
    licenseConfidence: candidate.confidence ?? 0,
    stack,
    consentAcknowledged: true,
    notes,
  };
}

/** Tag a candidate with its `fetchedVia` signature on the opaque `raw` slot. */
export function tagCandidate(
  c: ImageCandidate,
  extractor: ExtractorId,
  stack: string,
): ImageCandidate {
  const prior = c.raw && typeof c.raw === "object" ? (c.raw as Record<string, unknown>) : {};
  return {
    ...c,
    viaBrowserFallback: true,
    raw: {
      ...prior,
      fetchedVia: `browser:${extractor}`,
      stack,
    },
  };
}
