/**
 * Tests for evidence chain tracking, authority-weighted consensus scoring,
 * upgrade path recommendations, and batch reconciliation.
 *
 * Covers:
 *  (1)  buildEvidenceChain — license field always present
 *  (2)  buildEvidenceChain — licenseUrl CC URL pattern extraction
 *  (3)  buildEvidenceChain — licenseUrl unrecognised URL noted
 *  (4)  buildEvidenceChain — licenseAuditTrail source + flags surfaced
 *  (5)  buildEvidenceChain — sourcePageUrl Commons host match
 *  (6)  buildEvidenceChain — low confidence flagged
 *  (7)  conflictLog entries include evidence chains via reconcileLicenses
 *  (8)  scoreLicenseConsensus — Wikimedia beats Brave (authority weighting)
 *  (9)  scoreLicenseConsensus — unanimous → authorityScore near 1
 *  (10) scoreLicenseConsensus — empty candidates → UNKNOWN + score 0
 *  (11) scoreLicenseConsensus — api-metadata boost reflected
 *  (12) recommendLicenseUpgrade — UNKNOWN + Commons host → CC_BY_SA path
 *  (13) recommendLicenseUpgrade — mixed open licenses → most-open consolidation
 *  (14) recommendLicenseUpgrade — mixed open+platform → UNSPLASH_LICENSE consolidation
 *  (15) recommendLicenseUpgrade — already optimal → upgradeApplicable false
 *  (16) reconcileLicensesBatch — groups preserved with metadata
 *  (17) reconcileLicensesBatch — legalReviewNeeded when conflictCount >= 2
 *  (18) reconcileLicensesBatch — empty input → zero totals
 *  (19) reconcileLicensesBatch — group keys derived from pHash prefix
 *  (20) conflict log narrative includes legal-review language for max-conflict case
 */

import { describe, expect, test } from "bun:test";
import {
  buildEvidenceChain,
  scoreLicenseConsensus,
  recommendLicenseUpgrade,
  reconcileLicensesBatch,
  reconcileLicenses,
} from "../packages/core/src/index.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  overrides: Partial<ImageCandidate> & {
    url: string;
    source: string;
    license: ImageCandidate["license"];
  },
): ImageCandidate {
  return {
    title: "Test image",
    confidence: 0.8,
    ...overrides,
  };
}

function samePHashCandidates(
  licenses: ImageCandidate["license"][],
  sources?: string[],
  confidences?: number[],
): ImageCandidate[] {
  const defaultSources = ["wikimedia", "openverse", "unsplash", "pexels", "brave", "bing"];
  return licenses.map((lic, i) =>
    makeCandidate({
      url: `https://example.com/img${i}.jpg`,
      source: sources?.[i] ?? defaultSources[i] ?? `provider${i}`,
      license: lic,
      phash: "aabbccdd11223344",
      confidence: confidences?.[i] ?? 0.8,
    }),
  );
}

// ---------------------------------------------------------------------------
// (1) buildEvidenceChain — license field always present
// ---------------------------------------------------------------------------

describe("(1) buildEvidenceChain — license field always present", () => {
  test("evidence array contains a 'license' field entry", () => {
    const c = makeCandidate({ url: "https://example.com/img.jpg", source: "wikimedia", license: "CC_BY_SA" });
    const chain = buildEvidenceChain(c);
    const licenseEntry = chain.find((e) => e.field === "license");
    expect(licenseEntry).toBeDefined();
    expect(licenseEntry!.rawValue).toBe("CC_BY_SA");
    expect(licenseEntry!.interpretation).toContain("CC_BY_SA");
  });
});

// ---------------------------------------------------------------------------
// (2) buildEvidenceChain — licenseUrl CC URL pattern extraction
// ---------------------------------------------------------------------------

describe("(2) buildEvidenceChain — licenseUrl CC URL pattern", () => {
  test("CC BY-SA URL matched and labelled correctly", () => {
    const c = makeCandidate({
      url: "https://commons.wikimedia.org/img.jpg",
      source: "wikimedia",
      license: "CC_BY_SA",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    });
    const chain = buildEvidenceChain(c);
    const urlEntry = chain.find((e) => e.field === "licenseUrl");
    expect(urlEntry).toBeDefined();
    expect(urlEntry!.rawValue).toBe("https://creativecommons.org/licenses/by-sa/4.0/");
    expect(urlEntry!.interpretation).toMatch(/CC BY-SA/i);
  });

  test("CC0 URL matched and labelled correctly", () => {
    const c = makeCandidate({
      url: "https://example.com/img.jpg",
      source: "openverse",
      license: "CC0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    });
    const chain = buildEvidenceChain(c);
    const urlEntry = chain.find((e) => e.field === "licenseUrl");
    expect(urlEntry!.interpretation).toMatch(/CC0/i);
  });
});

// ---------------------------------------------------------------------------
// (3) buildEvidenceChain — licenseUrl unrecognised URL noted
// ---------------------------------------------------------------------------

describe("(3) buildEvidenceChain — licenseUrl unrecognised URL noted", () => {
  test("unrecognised licenseUrl produces a 'supporting evidence only' note", () => {
    const c = makeCandidate({
      url: "https://example.com/img.jpg",
      source: "brave",
      license: "UNKNOWN",
      licenseUrl: "https://some-custom-site.com/terms",
    });
    const chain = buildEvidenceChain(c);
    const urlEntry = chain.find((e) => e.field === "licenseUrl");
    expect(urlEntry).toBeDefined();
    expect(urlEntry!.interpretation).toMatch(/supporting evidence only/i);
  });
});

// ---------------------------------------------------------------------------
// (4) buildEvidenceChain — licenseAuditTrail surfaced
// ---------------------------------------------------------------------------

describe("(4) buildEvidenceChain — licenseAuditTrail source + flags", () => {
  test("licenseAuditTrail entry appears with source and confidence", () => {
    const c = makeCandidate({
      url: "https://wikimedia.org/img.jpg",
      source: "wikimedia",
      license: "CC_BY_SA",
      licenseAuditTrail: {
        source: "api-metadata",
        provenance: 'License string "CC BY-SA 4.0" matched CC BY-SA.',
        confidence: 0.9,
        flags: [],
      },
    });
    const chain = buildEvidenceChain(c);
    const trailEntry = chain.find((e) => e.field === "licenseAuditTrail.source");
    expect(trailEntry).toBeDefined();
    expect(trailEntry!.rawValue).toBe("api-metadata");
    expect(trailEntry!.interpretation).toContain("0.90");
    expect(trailEntry!.interpretation).toContain("CC BY-SA 4.0");
  });

  test("deprecated-cc-url flag appears in interpretation", () => {
    const c = makeCandidate({
      url: "https://flickr.com/img.jpg",
      source: "flickr",
      license: "CC_BY_SA",
      licenseAuditTrail: {
        source: "heuristic-url",
        provenance: "Inferred from URL.",
        confidence: 0.4,
        flags: ["deprecated-cc-url"],
      },
    });
    const chain = buildEvidenceChain(c);
    const trailEntry = chain.find((e) => e.field === "licenseAuditTrail.source");
    expect(trailEntry!.interpretation).toContain("deprecated-cc-url");
  });
});

// ---------------------------------------------------------------------------
// (5) buildEvidenceChain — sourcePageUrl Commons host match
// ---------------------------------------------------------------------------

describe("(5) buildEvidenceChain — sourcePageUrl Commons host", () => {
  test("Commons sourcePageUrl corroborates open license", () => {
    const c = makeCandidate({
      url: "https://upload.wikimedia.org/img.jpg",
      source: "wikimedia",
      license: "CC_BY_SA",
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:example.jpg",
    });
    const chain = buildEvidenceChain(c);
    const pageEntry = chain.find((e) => e.field === "sourcePageUrl");
    expect(pageEntry).toBeDefined();
    expect(pageEntry!.interpretation).toMatch(/corroborates an open license/i);
  });

  test("non-Commons sourcePageUrl noted without corroboration claim", () => {
    const c = makeCandidate({
      url: "https://example.com/img.jpg",
      source: "brave",
      license: "UNKNOWN",
      sourcePageUrl: "https://some-random-blog.com/post/123",
    });
    const chain = buildEvidenceChain(c);
    const pageEntry = chain.find((e) => e.field === "sourcePageUrl");
    expect(pageEntry).toBeDefined();
    expect(pageEntry!.interpretation).not.toMatch(/corroborates/i);
  });
});

// ---------------------------------------------------------------------------
// (6) buildEvidenceChain — low confidence flagged
// ---------------------------------------------------------------------------

describe("(6) buildEvidenceChain — low confidence flagged", () => {
  test("confidence < 0.4 produces 'heuristic guess' warning", () => {
    const c = makeCandidate({
      url: "https://example.com/img.jpg",
      source: "bing",
      license: "UNKNOWN",
      confidence: 0.2,
    });
    const chain = buildEvidenceChain(c);
    const confEntry = chain.find((e) => e.field === "confidence");
    expect(confEntry).toBeDefined();
    expect(confEntry!.interpretation).toMatch(/heuristic guess/i);
  });

  test("confidence >= 0.4 does not trigger the warning", () => {
    const c = makeCandidate({
      url: "https://example.com/img.jpg",
      source: "unsplash",
      license: "UNSPLASH_LICENSE",
      confidence: 0.85,
    });
    const chain = buildEvidenceChain(c);
    const confEntry = chain.find((e) => e.field === "confidence");
    expect(confEntry!.interpretation).not.toMatch(/heuristic guess/i);
  });
});

// ---------------------------------------------------------------------------
// (7) conflictLog entries include evidence chains via reconcileLicenses
// ---------------------------------------------------------------------------

describe("(7) conflictLog evidence chains via reconcileLicenses", () => {
  test("every conflictLog entry has a non-empty evidence array", () => {
    const candidates = samePHashCandidates(["CC_BY_SA", "CC_BY_SA", "UNKNOWN"]);
    const { conflictLog } = reconcileLicenses(candidates);
    for (const entry of conflictLog) {
      expect(Array.isArray(entry.evidence)).toBe(true);
      expect(entry.evidence.length).toBeGreaterThan(0);
    }
  });

  test("evidence items have field, rawValue, and interpretation strings", () => {
    const candidates = samePHashCandidates(["CC0", "CC_BY"]);
    const { conflictLog } = reconcileLicenses(candidates);
    for (const entry of conflictLog) {
      for (const item of entry.evidence) {
        expect(typeof item.field).toBe("string");
        expect(typeof item.rawValue).toBe("string");
        expect(typeof item.interpretation).toBe("string");
        expect(item.field.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (8) scoreLicenseConsensus — Wikimedia beats Brave
// ---------------------------------------------------------------------------

describe("(8) scoreLicenseConsensus — authority weighting", () => {
  test("Wikimedia CC_BY_SA wins over Brave UNKNOWN", () => {
    const candidates: ImageCandidate[] = [
      makeCandidate({ url: "https://wikimedia.org/img.jpg", source: "wikimedia", license: "CC_BY_SA", confidence: 0.9 }),
      makeCandidate({ url: "https://example.com/img.jpg", source: "brave", license: "UNKNOWN", confidence: 0.3 }),
    ];
    const result = scoreLicenseConsensus(candidates);
    expect(result.consensusLicense).toBe("CC_BY_SA");
    expect(result.authorityScore).toBeGreaterThan(0.5);
  });

  test("conflictJustification mentions the dominant provider", () => {
    const candidates: ImageCandidate[] = [
      makeCandidate({ url: "https://wikimedia.org/img.jpg", source: "wikimedia", license: "CC_BY_SA", confidence: 0.9 }),
      makeCandidate({ url: "https://example.com/img.jpg", source: "bing", license: "UNKNOWN", confidence: 0.2 }),
    ];
    const { conflictJustification } = scoreLicenseConsensus(candidates);
    expect(conflictJustification).toMatch(/wikimedia/i);
  });
});

// ---------------------------------------------------------------------------
// (9) scoreLicenseConsensus — unanimous → authorityScore near 1
// ---------------------------------------------------------------------------

describe("(9) scoreLicenseConsensus — unanimous agreement", () => {
  test("all providers agree → authorityScore = 1.0", () => {
    const candidates = samePHashCandidates(
      ["CC_BY_SA", "CC_BY_SA", "CC_BY_SA"],
      ["wikimedia", "openverse", "met-museum"],
      [0.9, 0.85, 0.9],
    );
    const result = scoreLicenseConsensus(candidates);
    expect(result.consensusLicense).toBe("CC_BY_SA");
    expect(result.authorityScore).toBeCloseTo(1.0, 5);
  });
});

// ---------------------------------------------------------------------------
// (10) scoreLicenseConsensus — empty candidates → UNKNOWN + score 0
// ---------------------------------------------------------------------------

describe("(10) scoreLicenseConsensus — empty input", () => {
  test("returns UNKNOWN with authorityScore 0", () => {
    const result = scoreLicenseConsensus([]);
    expect(result.consensusLicense).toBe("UNKNOWN");
    expect(result.authorityScore).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// (11) scoreLicenseConsensus — api-metadata boost reflected
// ---------------------------------------------------------------------------

describe("(11) scoreLicenseConsensus — api-metadata boost", () => {
  test("api-metadata trail boosts authority over bare assertion", () => {
    const withTrail = makeCandidate({
      url: "https://wikimedia.org/img.jpg",
      source: "wikimedia",
      license: "CC_BY_SA",
      confidence: 0.8,
      licenseAuditTrail: {
        source: "api-metadata",
        provenance: "Structured API metadata.",
        confidence: 0.95,
        flags: [],
      },
    });
    const withoutTrail = makeCandidate({
      url: "https://example.com/img.jpg",
      source: "wikimedia",
      license: "CC_BY_SA",
      confidence: 0.8,
    });

    // The trail-boosted candidate should produce higher authorityScore in a
    // two-candidate same-license pool vs. pool with no trails.
    const boosted = scoreLicenseConsensus([withTrail]);
    const plain = scoreLicenseConsensus([withoutTrail]);
    // Both are unanimous (single candidate) so authorityScore = 1 in both;
    // but when pitted against a rival UNKNOWN, the boosted version should
    // keep its license more strongly.
    const rival = makeCandidate({
      url: "https://brave.com/img.jpg",
      source: "brave",
      license: "UNKNOWN",
      confidence: 0.8,
    });
    const boostedVsRival = scoreLicenseConsensus([withTrail, rival]);
    const plainVsRival = scoreLicenseConsensus([withoutTrail, rival]);
    expect(boostedVsRival.authorityScore).toBeGreaterThan(plainVsRival.authorityScore);
  });
});

// ---------------------------------------------------------------------------
// (12) recommendLicenseUpgrade — UNKNOWN + Commons host → CC_BY_SA
// ---------------------------------------------------------------------------

describe("(12) recommendLicenseUpgrade — UNKNOWN + Commons host signal", () => {
  test("recommends CC_BY_SA when Brave detects Commons host", () => {
    const candidates: ImageCandidate[] = [
      makeCandidate({
        url: "https://upload.wikimedia.org/img.jpg",
        source: "brave",
        license: "UNKNOWN",
        sourcePageUrl: "https://commons.wikimedia.org/wiki/File:example.jpg",
        confidence: 0.3,
      }),
    ];
    const reconciled = reconcileLicenses(candidates);
    const upgrade = recommendLicenseUpgrade(candidates, reconciled);
    expect(upgrade.upgradeApplicable).toBe(true);
    expect(upgrade.recommendedLicense).toBe("CC_BY_SA");
    expect(upgrade.confidence).toBeGreaterThan(0);
    expect(upgrade.confidence).toBeLessThan(0.6); // confidence threshold respected
    expect(upgrade.rationale).toMatch(/commons/i);
  });

  test("no upgrade when UNKNOWN and no Commons host", () => {
    const candidates: ImageCandidate[] = [
      makeCandidate({
        url: "https://some-random-site.com/img.jpg",
        source: "brave",
        license: "UNKNOWN",
        confidence: 0.2,
      }),
    ];
    const reconciled = reconcileLicenses(candidates);
    const upgrade = recommendLicenseUpgrade(candidates, reconciled);
    expect(upgrade.upgradeApplicable).toBe(false);
    expect(upgrade.recommendedLicense).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// (13) recommendLicenseUpgrade — mixed fully-open → most-open consolidation
// ---------------------------------------------------------------------------

describe("(13) recommendLicenseUpgrade — mixed fully-open licenses", () => {
  test("CC0 + CC_BY conflict → consolidate to CC0 (most open)", () => {
    const candidates = samePHashCandidates(
      ["CC0", "CC_BY", "CC0"],
      ["wikimedia", "openverse", "nasa"],
    );
    const reconciled = reconcileLicenses(candidates);
    const upgrade = recommendLicenseUpgrade(candidates, reconciled);
    expect(upgrade.upgradeApplicable).toBe(true);
    expect(upgrade.recommendedLicense).toBe("CC0");
    expect(upgrade.confidence).toBeGreaterThan(0.5);
    expect(upgrade.rationale).toMatch(/fully open/i);
  });

  test("CC0 + CC_BY_SA — still suggests most-open (CC0)", () => {
    const candidates = samePHashCandidates(["CC0", "CC_BY_SA"], ["wikimedia", "openverse"]);
    const reconciled = reconcileLicenses(candidates);
    const upgrade = recommendLicenseUpgrade(candidates, reconciled);
    expect(upgrade.upgradeApplicable).toBe(true);
    expect(upgrade.recommendedLicense).toBe("CC0");
  });
});

// ---------------------------------------------------------------------------
// (14) recommendLicenseUpgrade — mixed open+platform → UNSPLASH_LICENSE
// ---------------------------------------------------------------------------

describe("(14) recommendLicenseUpgrade — mixed open+platform licenses", () => {
  test("CC_BY + UNSPLASH_LICENSE conflict → consolidate to UNSPLASH_LICENSE", () => {
    const candidates = samePHashCandidates(
      ["CC_BY", "UNSPLASH_LICENSE"],
      ["openverse", "unsplash"],
    );
    const reconciled = reconcileLicenses(candidates);
    const upgrade = recommendLicenseUpgrade(candidates, reconciled);
    expect(upgrade.upgradeApplicable).toBe(true);
    expect(upgrade.recommendedLicense).toBe("UNSPLASH_LICENSE");
    expect(upgrade.rationale).toMatch(/commercial/i);
  });
});

// ---------------------------------------------------------------------------
// (15) recommendLicenseUpgrade — already optimal → upgradeApplicable false
// ---------------------------------------------------------------------------

describe("(15) recommendLicenseUpgrade — already optimal", () => {
  test("unanimous CC0 → no upgrade needed", () => {
    const candidates = samePHashCandidates(["CC0", "CC0", "CC0"]);
    const reconciled = reconcileLicenses(candidates);
    const upgrade = recommendLicenseUpgrade(candidates, reconciled);
    expect(upgrade.upgradeApplicable).toBe(false);
    expect(upgrade.recommendedLicense).toBe("CC0");
  });
});

// ---------------------------------------------------------------------------
// (16) reconcileLicensesBatch — groups preserved with metadata
// ---------------------------------------------------------------------------

describe("(16) reconcileLicensesBatch — group metadata preservation", () => {
  test("each entry has groupKey, candidateUrls, providers, and result", () => {
    const candidates: ImageCandidate[] = [
      makeCandidate({ url: "https://a.com/1.jpg", source: "wikimedia", license: "CC_BY_SA", phash: "aaaa0000bbbb1111" }),
      makeCandidate({ url: "https://b.com/2.jpg", source: "openverse", license: "CC_BY_SA", phash: "aaaa0000bbbb1111" }),
      makeCandidate({ url: "https://c.com/3.jpg", source: "unsplash", license: "UNSPLASH_LICENSE", phash: "ffff0000eeee1111" }),
    ];
    const batch = reconcileLicensesBatch(candidates);
    expect(batch.totalGroups).toBe(2);
    expect(batch.totalCandidates).toBe(3);

    for (const entry of batch.entries) {
      expect(typeof entry.groupKey).toBe("string");
      expect(entry.groupKey.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.candidateUrls)).toBe(true);
      expect(entry.candidateUrls.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.providers)).toBe(true);
      expect(entry.providers.length).toBeGreaterThan(0);
      expect(entry.result).toBeDefined();
      expect(typeof entry.result.consensusLicense).toBe("string");
    }
  });

  test("largest group comes first (ordered largest-first)", () => {
    const candidates: ImageCandidate[] = [
      makeCandidate({ url: "https://a.com/1.jpg", source: "wikimedia", license: "CC_BY_SA", phash: "aaaa0000bbbb1111" }),
      makeCandidate({ url: "https://a.com/2.jpg", source: "openverse", license: "CC_BY_SA", phash: "aaaa0000bbbb1111" }),
      makeCandidate({ url: "https://a.com/3.jpg", source: "pexels", license: "CC_BY_SA", phash: "aaaa0000bbbb1111" }),
      makeCandidate({ url: "https://b.com/1.jpg", source: "unsplash", license: "UNSPLASH_LICENSE", phash: "ffff0000eeee1111" }),
    ];
    const batch = reconcileLicensesBatch(candidates);
    expect(batch.entries[0]!.candidateUrls.length).toBeGreaterThanOrEqual(
      batch.entries[1]!.candidateUrls.length,
    );
  });
});

// ---------------------------------------------------------------------------
// (17) reconcileLicensesBatch — legalReviewNeeded when conflictCount >= 2
// ---------------------------------------------------------------------------

describe("(17) reconcileLicensesBatch — legalReviewNeeded flag", () => {
  test("legalReviewNeeded true when a group has 3+ distinct licenses", () => {
    const candidates = samePHashCandidates(["CC0", "CC_BY", "UNKNOWN"]);
    const batch = reconcileLicensesBatch(candidates);
    expect(batch.legalReviewNeeded).toBe(true);
    expect(batch.highConflictCount).toBeGreaterThan(0);
  });

  test("legalReviewNeeded false when all groups have consensus", () => {
    const candidates = samePHashCandidates(["CC_BY_SA", "CC_BY_SA", "CC_BY_SA"]);
    const batch = reconcileLicensesBatch(candidates);
    expect(batch.legalReviewNeeded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (18) reconcileLicensesBatch — empty input → zero totals
// ---------------------------------------------------------------------------

describe("(18) reconcileLicensesBatch — empty input", () => {
  test("all counts are zero, entries is empty", () => {
    const batch = reconcileLicensesBatch([]);
    expect(batch.entries).toHaveLength(0);
    expect(batch.totalGroups).toBe(0);
    expect(batch.totalCandidates).toBe(0);
    expect(batch.highConflictCount).toBe(0);
    expect(batch.legalReviewNeeded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (19) reconcileLicensesBatch — group keys derived from pHash prefix
// ---------------------------------------------------------------------------

describe("(19) reconcileLicensesBatch — pHash-keyed groups", () => {
  test("groupKey starts with 'phash:' when candidates have pHash", () => {
    const candidates: ImageCandidate[] = [
      makeCandidate({ url: "https://a.com/img.jpg", source: "wikimedia", license: "CC_BY_SA", phash: "aabbccdd11223344" }),
      makeCandidate({ url: "https://b.com/img.jpg", source: "openverse", license: "CC_BY_SA", phash: "aabbccdd11223344" }),
    ];
    const batch = reconcileLicensesBatch(candidates);
    expect(batch.entries[0]!.groupKey).toMatch(/^phash:/);
    expect(batch.entries[0]!.groupKey).toContain("aabbccdd");
  });

  test("groupKey starts with 'url:' when no pHash is present", () => {
    const candidates: ImageCandidate[] = [
      makeCandidate({ url: "https://a.com/img.jpg", source: "brave", license: "UNKNOWN" }),
    ];
    const batch = reconcileLicensesBatch(candidates);
    expect(batch.entries[0]!.groupKey).toMatch(/^url:/);
  });
});

// ---------------------------------------------------------------------------
// (20) conflict log narrative includes legal-review language (max conflict)
// ---------------------------------------------------------------------------

describe("(20) conflict log — legal-review narrative in max-conflict case", () => {
  test("recommendation mentions legal review when 4 different licenses present", () => {
    const candidates = samePHashCandidates(
      ["CC0", "CC_BY", "UNSPLASH_LICENSE", "UNKNOWN"],
      ["wikimedia", "openverse", "unsplash", "brave"],
    );
    const { recommendation, conflictLog } = reconcileLicenses(candidates);
    expect(recommendation).toMatch(/legal/i);
    // All four providers should appear in the conflict log with evidence chains.
    expect(conflictLog).toHaveLength(4);
    for (const entry of conflictLog) {
      expect(entry.evidence.length).toBeGreaterThan(0);
      const licenseItem = entry.evidence.find((e) => e.field === "license");
      expect(licenseItem).toBeDefined();
    }
  });
});
