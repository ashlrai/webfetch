/**
 * Image Metadata Extraction + Confidence Audit Trail.
 *
 * After downloading an image, extract all embedded metadata (EXIF artist/copyright,
 * EXIF ImageDescription, XMP dc:creator/dc:rights/xmpRights:UsageTerms, IPTC record 2),
 * merge with provider-supplied metadata, and emit a detailed `ImageMetadataAuditResult`
 * with per-field confidence and conflict resolution.
 *
 * Reconciliation rules:
 *  - If embedded and provider agree on artist/copyright (Levenshtein similarity > 0.8),
 *    merge and boost confidence to 0.95.
 *  - Otherwise keep both values; resolution is governed by `resolveConflicts` strategy.
 *  - `provider-first`  — provider value wins on any conflict.
 *  - `embedded-first`  — embedded value wins on any conflict.
 *  - `conservative`    — (default) keep both in the merged result; prefer the higher-
 *                        confidence source; flag the conflict for caller inspection.
 */

import { readImageMetadata } from "./metadata-reader.ts";
import type { EmbeddedMetadata } from "./metadata-reader.ts";
import type { ImageCandidate } from "./types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A subset of `ImageCandidate` fields that carry provenance-relevant metadata.
 */
export interface ProviderMetadataSubset {
  author?: string;
  license: ImageCandidate["license"];
  licenseUrl?: string;
  attributionLine?: string;
  title?: string;
  sourcePageUrl?: string;
}

/**
 * Merged metadata — the reconciled view after combining embedded and provider sources.
 */
export interface MergedMetadata {
  artist?: string;
  copyright?: string;
  description?: string;
  license: ImageCandidate["license"];
  licenseUrl?: string;
  attributionLine?: string;
  /** 0..1 overall confidence in the merged result for this field. */
  confidence: {
    artist: number;
    copyright: number;
    license: number;
  };
}

/**
 * Records where two sources disagreed on a field and how it was resolved.
 */
export interface FieldConflict {
  /** Name of the conflicting field (e.g. "artist", "copyright", "license"). */
  field: string;
  /** Value extracted from the image file's embedded metadata. */
  embedded: unknown;
  /** Value from the provider-supplied candidate metadata. */
  provider: unknown;
  /** How the conflict was resolved. */
  resolution: "provider" | "embedded" | "merged";
  /** Levenshtein similarity (0..1) when both values are strings, undefined otherwise. */
  similarity?: number;
}

/**
 * A structured audit log entry for a single metadata decision.
 */
export interface MetadataAuditEvent {
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Which field this event concerns. */
  field: string;
  /** One-line description of the decision. */
  decision: string;
  /** Source that produced the winning value. */
  source: "embedded" | "provider" | "merged" | "none";
  /** Confidence in this decision (0..1). */
  confidence: number;
  /** Optional extra context (e.g. similarity score, conflict strategy used). */
  context?: Record<string, unknown>;
}

/**
 * Input to `auditImageMetadata`.
 */
export interface ImageMetadataAuditInput {
  /** Raw bytes of the downloaded image. */
  downloadedBytes: Uint8Array;
  /** Provider-supplied candidate metadata. */
  candidate: ImageCandidate;
  /**
   * Strategy for resolving field-level conflicts between embedded and provider metadata.
   *  - `'provider-first'`  — provider value wins on conflict.
   *  - `'embedded-first'`  — embedded value wins on conflict.
   *  - `'conservative'`    — (default) prefer higher-confidence source; keep both noted.
   */
  resolveConflicts?: "provider-first" | "embedded-first" | "conservative";
}

/**
 * Full audit result returned by `auditImageMetadata`.
 */
export interface ImageMetadataAuditResult {
  /** Raw metadata extracted from the image file bytes. */
  embeddedMetadata: EmbeddedMetadata;
  /** Provider-supplied metadata (subset of ImageCandidate). */
  providerMetadata: ProviderMetadataSubset;
  /** Reconciled merged view combining both sources. */
  mergedResult: MergedMetadata;
  /** Per-field conflicts detected during reconciliation. */
  conflicts: FieldConflict[];
  /** Ordered log of every metadata decision with confidence scores. */
  auditTrail: MetadataAuditEvent[];
}

// ---------------------------------------------------------------------------
// Levenshtein similarity
// ---------------------------------------------------------------------------

/**
 * Compute normalised Levenshtein similarity between two strings.
 * Returns 1.0 for equal strings (or both empty), 0.0 when maximally different.
 */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0 && lenB === 0) return 1.0;
  if (lenA === 0 || lenB === 0) return 0.0;

  // Classic O(n*m) DP with two-row optimisation.
  let prev = new Uint16Array(lenB + 1);
  let curr = new Uint16Array(lenB + 1);
  for (let j = 0; j <= lenB; j++) prev[j] = j;
  for (let i = 1; i <= lenA; i++) {
    curr[0] = i;
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,           // insertion
        prev[j]! + 1,               // deletion
        prev[j - 1]! + cost,        // substitution
      );
    }
    // swap
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  const distance = prev[lenB]!;
  return 1 - distance / Math.max(lenA, lenB);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const AGREEMENT_THRESHOLD = 0.8;
const MERGED_BOOSTED_CONFIDENCE = 0.95;

function now(): string {
  return new Date().toISOString();
}

/**
 * Normalise a string for comparison — lowercase, collapse whitespace.
 */
function normalise(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Resolve a single text field conflict given the strategy and similarity.
 *
 * Returns:
 *  - `value`      — the winning string value
 *  - `confidence` — confidence for that value
 *  - `resolution` — which source won
 */
function resolveTextField(
  embedded: string | undefined,
  embeddedConf: number,
  provider: string | undefined,
  strategy: "provider-first" | "embedded-first" | "conservative",
): {
  value: string | undefined;
  confidence: number;
  resolution: "provider" | "embedded" | "merged" | "none";
  similarity?: number;
  conflict: boolean;
} {
  // Both absent.
  if (!embedded && !provider) {
    return { value: undefined, confidence: 0, resolution: "none", conflict: false };
  }
  // One absent — no conflict, just use what we have.
  if (!embedded && provider) {
    return { value: provider, confidence: 0.7, resolution: "provider", conflict: false };
  }
  if (embedded && !provider) {
    return { value: embedded, confidence: embeddedConf, resolution: "embedded", conflict: false };
  }

  // Both present — check similarity.
  const sim = levenshteinSimilarity(normalise(embedded!), normalise(provider!));

  if (sim > AGREEMENT_THRESHOLD) {
    // They agree — merge, boost confidence.
    return {
      value: embedded!, // prefer embedded (richer source) when agreeing
      confidence: MERGED_BOOSTED_CONFIDENCE,
      resolution: "merged",
      similarity: sim,
      conflict: false,
    };
  }

  // They disagree — apply strategy.
  if (strategy === "provider-first") {
    return {
      value: provider!,
      confidence: 0.7,
      resolution: "provider",
      similarity: sim,
      conflict: true,
    };
  }
  if (strategy === "embedded-first") {
    return {
      value: embedded!,
      confidence: embeddedConf,
      resolution: "embedded",
      similarity: sim,
      conflict: true,
    };
  }
  // conservative — prefer higher-confidence source.
  const providerBaseConf = 0.7;
  if (embeddedConf >= providerBaseConf) {
    return {
      value: embedded!,
      confidence: embeddedConf,
      resolution: "embedded",
      similarity: sim,
      conflict: true,
    };
  }
  return {
    value: provider!,
    confidence: providerBaseConf,
    resolution: "provider",
    similarity: sim,
    conflict: true,
  };
}

// ---------------------------------------------------------------------------
// Core audit function
// ---------------------------------------------------------------------------

/**
 * Download a set of image bytes, extract all embedded metadata, reconcile with
 * provider-supplied metadata, and return a full `ImageMetadataAuditResult`.
 *
 * @example
 * ```ts
 * const result = await auditImageMetadata({
 *   downloadedBytes: bytes,
 *   candidate,
 *   resolveConflicts: 'conservative',
 * });
 * console.log(result.conflicts);     // fields that disagreed
 * console.log(result.mergedResult);  // best combined view
 * console.log(result.auditTrail);    // full decision log
 * ```
 */
export async function auditImageMetadata(
  input: ImageMetadataAuditInput,
): Promise<ImageMetadataAuditResult> {
  const { downloadedBytes, candidate, resolveConflicts = "conservative" } = input;

  const auditTrail: MetadataAuditEvent[] = [];
  const conflicts: FieldConflict[] = [];

  // 1. Extract embedded metadata from the raw bytes.
  const embedded = await readImageMetadata(downloadedBytes);

  auditTrail.push({
    timestamp: now(),
    field: "_extraction",
    decision: `Extracted embedded metadata from ${downloadedBytes.length} bytes.`,
    source: "embedded",
    confidence: 1.0,
    context: {
      byteLength: downloadedBytes.length,
      embeddedLicense: embedded.license,
      embeddedArtist: embedded.artist ?? null,
      embeddedCopyright: embedded.copyright ?? null,
    },
  });

  // 2. Build provider metadata subset.
  const providerMetadata: ProviderMetadataSubset = {
    author: candidate.author,
    license: candidate.license,
    licenseUrl: candidate.licenseUrl,
    attributionLine: candidate.attributionLine,
    title: candidate.title,
    sourcePageUrl: candidate.sourcePageUrl,
  };

  // 3. Reconcile artist field.
  const artistResolution = resolveTextField(
    embedded.artist,
    embedded.confidence.artist,
    candidate.author,
    resolveConflicts,
  );

  if (artistResolution.conflict) {
    conflicts.push({
      field: "artist",
      embedded: embedded.artist,
      provider: candidate.author,
      resolution: artistResolution.resolution as "provider" | "embedded" | "merged",
      similarity: artistResolution.similarity,
    });
  }

  auditTrail.push({
    timestamp: now(),
    field: "artist",
    decision: artistResolution.conflict
      ? `Conflict: embedded="${embedded.artist}" vs provider="${candidate.author}" (similarity=${artistResolution.similarity?.toFixed(3)}). Resolved via ${artistResolution.resolution}.`
      : artistResolution.resolution === "merged"
        ? `Agreement: embedded "${embedded.artist}" ≈ provider "${candidate.author}" (similarity=${artistResolution.similarity?.toFixed(3)}). Merged with boosted confidence.`
        : `Single source: ${artistResolution.resolution} value="${artistResolution.value ?? "(none)"}".`,
    source: artistResolution.resolution === "none" ? "none" : artistResolution.resolution,
    confidence: artistResolution.confidence,
    context: {
      embeddedValue: embedded.artist ?? null,
      providerValue: candidate.author ?? null,
      similarity: artistResolution.similarity ?? null,
      strategy: resolveConflicts,
    },
  });

  // 4. Reconcile copyright field.
  const copyrightResolution = resolveTextField(
    embedded.copyright,
    embedded.confidence.copyright,
    candidate.attributionLine,
    resolveConflicts,
  );

  if (copyrightResolution.conflict) {
    conflicts.push({
      field: "copyright",
      embedded: embedded.copyright,
      provider: candidate.attributionLine,
      resolution: copyrightResolution.resolution as "provider" | "embedded" | "merged",
      similarity: copyrightResolution.similarity,
    });
  }

  auditTrail.push({
    timestamp: now(),
    field: "copyright",
    decision: copyrightResolution.conflict
      ? `Conflict: embedded="${embedded.copyright}" vs provider attributionLine="${candidate.attributionLine}" (similarity=${copyrightResolution.similarity?.toFixed(3)}). Resolved via ${copyrightResolution.resolution}.`
      : copyrightResolution.resolution === "merged"
        ? `Agreement on copyright/attribution (similarity=${copyrightResolution.similarity?.toFixed(3)}). Merged with boosted confidence.`
        : `Single source: ${copyrightResolution.resolution} value="${copyrightResolution.value ?? "(none)"}".`,
    source: copyrightResolution.resolution === "none" ? "none" : copyrightResolution.resolution,
    confidence: copyrightResolution.confidence,
    context: {
      embeddedValue: embedded.copyright ?? null,
      providerValue: candidate.attributionLine ?? null,
      similarity: copyrightResolution.similarity ?? null,
      strategy: resolveConflicts,
    },
  });

  // 5. Reconcile license field.
  const embeddedLicenseKnown = embedded.license !== "UNKNOWN";
  const providerLicenseKnown = candidate.license !== "UNKNOWN";
  let mergedLicense = candidate.license;
  let mergedLicenseUrl = candidate.licenseUrl ?? embedded.licenseUrl;
  let mergedLicenseConfidence = embedded.confidence.license;
  let licenseResolution: "provider" | "embedded" | "merged" = "provider";
  let licenseConflict = false;

  if (embeddedLicenseKnown && providerLicenseKnown) {
    if (embedded.license === candidate.license) {
      // Agreement — boost confidence.
      mergedLicense = embedded.license;
      mergedLicenseConfidence = MERGED_BOOSTED_CONFIDENCE;
      licenseResolution = "merged";
    } else {
      // Conflict.
      licenseConflict = true;
      conflicts.push({
        field: "license",
        embedded: embedded.license,
        provider: candidate.license,
        resolution:
          resolveConflicts === "embedded-first"
            ? "embedded"
            : resolveConflicts === "provider-first"
              ? "provider"
              : embedded.confidence.license >= 0.7
                ? "embedded"
                : "provider",
      });

      if (
        resolveConflicts === "embedded-first" ||
        (resolveConflicts === "conservative" && embedded.confidence.license >= 0.7)
      ) {
        mergedLicense = embedded.license;
        mergedLicenseConfidence = embedded.confidence.license;
        licenseResolution = "embedded";
        mergedLicenseUrl = embedded.licenseUrl ?? candidate.licenseUrl;
      } else {
        mergedLicense = candidate.license;
        mergedLicenseConfidence = 0.7;
        licenseResolution = "provider";
        mergedLicenseUrl = candidate.licenseUrl ?? embedded.licenseUrl;
      }
    }
  } else if (embeddedLicenseKnown && !providerLicenseKnown) {
    mergedLicense = embedded.license;
    mergedLicenseConfidence = embedded.confidence.license;
    licenseResolution = "embedded";
    mergedLicenseUrl = embedded.licenseUrl ?? candidate.licenseUrl;
  } else if (!embeddedLicenseKnown && providerLicenseKnown) {
    mergedLicense = candidate.license;
    mergedLicenseConfidence = candidate.confidence ?? 0.7;
    licenseResolution = "provider";
    mergedLicenseUrl = candidate.licenseUrl;
  } else {
    // Both unknown.
    mergedLicense = "UNKNOWN";
    mergedLicenseConfidence = 0;
    licenseResolution = "provider";
  }

  auditTrail.push({
    timestamp: now(),
    field: "license",
    decision: licenseConflict
      ? `Conflict: embedded="${embedded.license}" vs provider="${candidate.license}". Resolved via ${licenseResolution} (embedded confidence=${embedded.confidence.license.toFixed(2)}).`
      : licenseResolution === "merged"
        ? `Agreement: both sources report "${mergedLicense}". Merged confidence boosted to ${MERGED_BOOSTED_CONFIDENCE}.`
        : `Single known source: ${licenseResolution} "${mergedLicense}".`,
    source: licenseResolution,
    confidence: mergedLicenseConfidence,
    context: {
      embeddedLicense: embedded.license,
      providerLicense: candidate.license,
      embeddedLicenseConfidence: embedded.confidence.license,
      providerLicenseConfidence: candidate.confidence ?? null,
      resolvedLicense: mergedLicense,
      strategy: resolveConflicts,
    },
  });

  // 6. Build merged result.
  const mergedResult: MergedMetadata = {
    artist: artistResolution.value,
    copyright: copyrightResolution.value,
    description: embedded.description,
    license: mergedLicense,
    licenseUrl: mergedLicenseUrl,
    attributionLine: candidate.attributionLine,
    confidence: {
      artist: artistResolution.confidence,
      copyright: copyrightResolution.confidence,
      license: mergedLicenseConfidence,
    },
  };

  // 7. Final summary audit event.
  auditTrail.push({
    timestamp: now(),
    field: "_summary",
    decision: `Reconciliation complete. ${conflicts.length} conflict(s) found. Strategy: "${resolveConflicts}". Overall artist confidence: ${mergedResult.confidence.artist.toFixed(2)}, copyright: ${mergedResult.confidence.copyright.toFixed(2)}, license: ${mergedResult.confidence.license.toFixed(2)}.`,
    source: conflicts.length === 0 ? "merged" : licenseResolution,
    confidence:
      (mergedResult.confidence.artist +
        mergedResult.confidence.copyright +
        mergedResult.confidence.license) /
      3,
    context: {
      conflictCount: conflicts.length,
      conflictFields: conflicts.map((c) => c.field),
      strategy: resolveConflicts,
    },
  });

  return {
    embeddedMetadata: embedded,
    providerMetadata,
    mergedResult,
    conflicts,
    auditTrail,
  };
}
