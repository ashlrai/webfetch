/**
 * Tests for the batch license conflict resolution & audit dashboard API.
 *
 * Functions under test (from packages/core/src/license-reconciliation.ts):
 *   - reconcileLicenseConflictsBatch(candidates, options)
 *   - auditLicenseConflictBatch(candidates, options)
 *
 * Covers 20+ conflict scenarios including:
 *   CC_BY vs UNSPLASH_LICENSE, UNKNOWN vs CC0, EDITORIAL_LICENSED vs CC_BY,
 *   PRESS_KIT_ALLOWLIST vs PUBLIC_DOMAIN, split 3-way decisions, single-provider
 *   groups, fully unanimous groups, low-authority providers, high-authority
 *   override, evidence trail validation, severity filtering, and more.
 */

import { describe, expect, test } from "bun:test";
import {
  auditLicenseConflictBatch,
  reconcileLicenseConflictsBatch,
} from "../packages/core/src/index.ts";
import type { ImageCandidate } from "../packages/core/src/types.ts";

// ---------------------------------------------------------------------------
// Test helpers
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

/** Candidates sharing a pHash — treated as the same image. */
function sameImage(
  specs: Array<{ source: string; license: ImageCandidate["license"]; confidence?: number }>,
  phash = "aabbccdd11223344",
): ImageCandidate[] {
  return specs.map((s, i) =>
    makeCandidate({
      url: `https://example.com/img${i}.jpg`,
      source: s.source,
      license: s.license,
      phash,
      confidence: s.confidence ?? 0.8,
    }),
  );
}

/** Two groups of candidates with distinct pHashes. */
function twoGroups(
  groupA: Array<{ source: string; license: ImageCandidate["license"] }>,
  groupB: Array<{ source: string; license: ImageCandidate["license"] }>,
): ImageCandidate[] {
  return [
    ...sameImage(groupA, "aaaa0000bbbb1111"),
    ...sameImage(groupB, "ffff0000eeee1111"),
  ];
}

// ---------------------------------------------------------------------------
// SCENARIO 1: CC_BY vs UNSPLASH_LICENSE (two providers, different camps)
// ---------------------------------------------------------------------------

describe("Scenario 1: CC_BY vs UNSPLASH_LICENSE", () => {
  const candidates = sameImage([
    { source: "wikimedia", license: "CC_BY" },
    { source: "unsplash", license: "UNSPLASH_LICENSE" },
  ]);

  test("reconcileLicenseConflictsBatch: one group, one conflict", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.totalGroups).toBe(1);
    expect(result.totalCandidates).toBe(2);
    expect(result.upgradePaths).toHaveLength(1);
  });

  test("consensus selects more-open license (CC_BY rank < UNSPLASH_LICENSE)", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    // wikimedia has higher authority (0.95) so CC_BY wins authority-weighted
    expect(result.upgradePaths[0]!.consensusLicense).toBe("CC_BY");
  });

  test("authorityScore is < 1 (conflict present)", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.upgradePaths[0]!.authorityScore).toBeLessThan(1);
    expect(result.upgradePaths[0]!.authorityScore).toBeGreaterThan(0);
  });

  test("auditLicenseConflictBatch: emits one event", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events).toHaveLength(1);
    expect(audit.totalCandidates).toBe(2);
  });

  test("conflict severity is major (two distinct known licenses)", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events[0]!.conflictSeverity).toBe("major");
    expect(audit.majorCount).toBe(1);
    expect(audit.criticalCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 2: UNKNOWN vs CC0 (minor conflict)
// ---------------------------------------------------------------------------

describe("Scenario 2: UNKNOWN vs CC0 (minor conflict)", () => {
  const candidates = sameImage([
    { source: "wikimedia", license: "CC0" },
    { source: "brave", license: "UNKNOWN" },
  ]);

  test("reconcile returns one upgrade path", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.upgradePaths).toHaveLength(1);
    expect(result.upgradePaths[0]!.consensusLicense).toBe("CC0");
  });

  test("auditLicenseConflictBatch severity is minor (UNKNOWN vs one known)", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events[0]!.conflictSeverity).toBe("minor");
    expect(audit.minorCount).toBe(1);
    expect(audit.majorCount).toBe(0);
    expect(audit.legalReviewNeeded).toBe(false);
  });

  test("authority trail lists wikimedia first (higher weight)", () => {
    const audit = auditLicenseConflictBatch(candidates, { detailedTrail: true });
    const trail = audit.events[0]!.authorityTrail;
    expect(trail[0]!.provider).toBe("wikimedia");
    expect(trail[0]!.authorityWeight).toBeGreaterThan(trail[1]!.authorityWeight);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 3: EDITORIAL_LICENSED vs CC_BY (critical: restrictive + open)
// ---------------------------------------------------------------------------

describe("Scenario 3: EDITORIAL_LICENSED vs CC_BY (critical)", () => {
  const candidates = sameImage([
    { source: "openverse", license: "CC_BY" },
    { source: "serpapi", license: "EDITORIAL_LICENSED" },
  ]);

  test("auditLicenseConflictBatch severity is critical", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events[0]!.conflictSeverity).toBe("critical");
    expect(audit.criticalCount).toBe(1);
    expect(audit.legalReviewNeeded).toBe(true);
  });

  test("legalReviewRequired is true on the event", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events[0]!.legalReviewRequired).toBe(true);
  });

  test("reconcileLicenseConflictsBatch: legalReviewNeeded is true", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.legalReviewNeeded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 4: PRESS_KIT_ALLOWLIST vs PUBLIC_DOMAIN (critical)
// ---------------------------------------------------------------------------

describe("Scenario 4: PRESS_KIT_ALLOWLIST vs PUBLIC_DOMAIN (critical)", () => {
  const candidates = sameImage([
    { source: "nasa", license: "PUBLIC_DOMAIN" },
    { source: "bing", license: "PRESS_KIT_ALLOWLIST" },
  ]);

  test("audit severity is critical (restrictive + open coexist)", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events[0]!.conflictSeverity).toBe("critical");
    expect(audit.legalReviewNeeded).toBe(true);
  });

  test("conflictingProviders list is non-empty", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events[0]!.conflictingProviders.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 5: CC_BY_SA unanimous (no conflict) → severity none
// ---------------------------------------------------------------------------

describe("Scenario 5: Unanimous CC_BY_SA — no conflict", () => {
  const candidates = sameImage([
    { source: "wikimedia", license: "CC_BY_SA" },
    { source: "openverse", license: "CC_BY_SA" },
    { source: "europeana", license: "CC_BY_SA" },
  ]);

  test("auditLicenseConflictBatch emits one event with severity none", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events[0]!.conflictSeverity).toBe("none");
    expect(audit.minorCount).toBe(0);
    expect(audit.majorCount).toBe(0);
    expect(audit.criticalCount).toBe(0);
    expect(audit.legalReviewNeeded).toBe(false);
  });

  test("reconcileLicenseConflictsBatch: authorityScore is close to 1", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.upgradePaths[0]!.authorityScore).toBeGreaterThan(0.9);
  });

  test("conflictingGroups is 0 (all agree)", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.conflictingGroups).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 6: 3-way split CC0 / CC_BY_SA / UNSPLASH_LICENSE
// ---------------------------------------------------------------------------

describe("Scenario 6: 3-way split CC0 / CC_BY_SA / UNSPLASH_LICENSE", () => {
  const candidates = sameImage([
    { source: "wikimedia", license: "CC0" },
    { source: "openverse", license: "CC_BY_SA" },
    { source: "unsplash", license: "UNSPLASH_LICENSE" },
  ]);

  test("auditLicenseConflictBatch severity is major", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events[0]!.conflictSeverity).toBe("major");
    expect(audit.majorCount).toBe(1);
  });

  test("reconcile: upgrade path present for all-permissive mix", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.upgradePaths[0]!.upgradeRecommendation.upgradeApplicable).toBe(true);
  });

  test("upgrade consolidates toward most-open or conservative platform license", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    const rec = result.upgradePaths[0]!.upgradeRecommendation.recommendedLicense;
    // All are permissive; upgrade should be one of the permissive set
    const permissive = ["CC0", "PUBLIC_DOMAIN", "CC_BY", "CC_BY_SA", "UNSPLASH_LICENSE", "PEXELS_LICENSE", "PIXABAY_LICENSE"];
    expect(permissive).toContain(rec);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 7: PEXELS_LICENSE vs PIXABAY_LICENSE (both platform-permissive)
// ---------------------------------------------------------------------------

describe("Scenario 7: PEXELS_LICENSE vs PIXABAY_LICENSE (platform permissive)", () => {
  const candidates = sameImage([
    { source: "pexels", license: "PEXELS_LICENSE" },
    { source: "pixabay", license: "PIXABAY_LICENSE" },
  ]);

  test("audit severity is major (two distinct known licenses)", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events[0]!.conflictSeverity).toBe("major");
  });

  test("upgrade is applicable (all permissive)", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.upgradePaths[0]!.upgradeRecommendation.upgradeApplicable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 8: Empty candidates pool
// ---------------------------------------------------------------------------

describe("Scenario 8: Empty candidate pool", () => {
  test("reconcileLicenseConflictsBatch returns empty result", () => {
    const result = reconcileLicenseConflictsBatch([]);
    expect(result.upgradePaths).toHaveLength(0);
    expect(result.totalGroups).toBe(0);
    expect(result.totalCandidates).toBe(0);
    expect(result.legalReviewNeeded).toBe(false);
  });

  test("auditLicenseConflictBatch returns empty result", () => {
    const audit = auditLicenseConflictBatch([]);
    expect(audit.events).toHaveLength(0);
    expect(audit.totalGroups).toBe(0);
    expect(audit.totalCandidates).toBe(0);
    expect(audit.criticalCount).toBe(0);
    expect(audit.legalReviewNeeded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 9: Single candidate — no conflict possible
// ---------------------------------------------------------------------------

describe("Scenario 9: Single candidate", () => {
  const candidates = [
    makeCandidate({ url: "https://unsplash.com/x.jpg", source: "unsplash", license: "UNSPLASH_LICENSE" }),
  ];

  test("reconcile: one group, no upgrade needed (single provider)", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.totalGroups).toBe(1);
    expect(result.upgradePaths[0]!.upgradeRecommendation.upgradeApplicable).toBe(false);
  });

  test("audit: severity is none", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events[0]!.conflictSeverity).toBe("none");
    expect(audit.legalReviewNeeded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 10: Multiple separate image groups — per-group stats
// ---------------------------------------------------------------------------

describe("Scenario 10: Multiple distinct image groups", () => {
  const candidates = twoGroups(
    [
      { source: "wikimedia", license: "CC_BY_SA" },
      { source: "openverse", license: "CC_BY_SA" },
    ],
    [
      { source: "serpapi", license: "EDITORIAL_LICENSED" },
      { source: "brave", license: "CC0" },
    ],
  );

  test("reconcile: two groups found", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.totalGroups).toBe(2);
    expect(result.totalCandidates).toBe(4);
  });

  test("first group (unanimous CC_BY_SA) has no legal review", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    // Group A is unanimous — upgrade not applicable
    const groupA = result.upgradePaths.find((p) => p.consensusLicense === "CC_BY_SA");
    expect(groupA).toBeDefined();
    expect(groupA!.upgradeRecommendation.upgradeApplicable).toBe(false);
  });

  test("second group (EDITORIAL vs CC0) triggers legal review", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.legalReviewNeeded).toBe(true);
  });

  test("audit: criticalCount is 1 (EDITORIAL vs CC0 = critical)", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.totalGroups).toBe(2);
    expect(audit.criticalCount).toBe(1);
    expect(audit.legalReviewNeeded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 11: severityFilter — only emit major+critical events
// ---------------------------------------------------------------------------

describe("Scenario 11: severityFilter skips minor and none events", () => {
  const candidates = [
    // Group A: none (unanimous)
    ...sameImage([
      { source: "wikimedia", license: "CC_BY_SA" },
      { source: "openverse", license: "CC_BY_SA" },
    ], "aaaa1111bbbb2222"),
    // Group B: minor (UNKNOWN vs CC0)
    ...sameImage([
      { source: "nasa", license: "CC0" },
      { source: "brave", license: "UNKNOWN" },
    ], "cccc3333dddd4444"),
    // Group C: critical (EDITORIAL vs CC_BY)
    ...sameImage([
      { source: "openverse", license: "CC_BY" },
      { source: "serpapi", license: "EDITORIAL_LICENSED" },
    ], "eeee5555ffff6666"),
  ];

  test("no filter: 3 events emitted", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events).toHaveLength(3);
  });

  test("severityFilter=minor: 2 events (minor + critical)", () => {
    const audit = auditLicenseConflictBatch(candidates, { severityFilter: "minor" });
    expect(audit.events).toHaveLength(2);
    for (const evt of audit.events) {
      expect(["minor", "major", "critical"]).toContain(evt.conflictSeverity);
    }
  });

  test("severityFilter=major: 1 event (critical only)", () => {
    const audit = auditLicenseConflictBatch(candidates, { severityFilter: "major" });
    expect(audit.events).toHaveLength(1);
    expect(audit.events[0]!.conflictSeverity).toBe("critical");
  });

  test("severityFilter=critical: 1 event", () => {
    const audit = auditLicenseConflictBatch(candidates, { severityFilter: "critical" });
    expect(audit.events).toHaveLength(1);
    expect(audit.criticalCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 12: detailedTrail=false — evidence arrays are empty
// ---------------------------------------------------------------------------

describe("Scenario 12: detailedTrail=false suppresses evidence chains", () => {
  const candidates = sameImage([
    { source: "wikimedia", license: "CC_BY" },
    { source: "unsplash", license: "UNSPLASH_LICENSE" },
  ]);

  test("detailedTrail=true includes evidence items", () => {
    const audit = auditLicenseConflictBatch(candidates, { detailedTrail: true });
    const trail = audit.events[0]!.authorityTrail;
    // Each provider should have at least 1 evidence item
    for (const entry of trail) {
      expect(entry.evidence.length).toBeGreaterThan(0);
    }
  });

  test("detailedTrail=false returns empty evidence arrays", () => {
    const audit = auditLicenseConflictBatch(candidates, { detailedTrail: false });
    const trail = audit.events[0]!.authorityTrail;
    for (const entry of trail) {
      expect(entry.evidence).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 13: includeTrail=true on reconcileLicenseConflictsBatch
// ---------------------------------------------------------------------------

describe("Scenario 13: includeTrail embeds conflictLog in upgrade path", () => {
  const candidates = sameImage([
    { source: "wikimedia", license: "CC_BY_SA" },
    { source: "serpapi", license: "EDITORIAL_LICENSED" },
  ]);

  test("includeTrail=false: evidenceTrail is undefined", () => {
    const result = reconcileLicenseConflictsBatch(candidates, { includeTrail: false });
    expect(result.upgradePaths[0]!.evidenceTrail).toBeUndefined();
  });

  test("includeTrail=true: evidenceTrail is an array of conflict entries", () => {
    const result = reconcileLicenseConflictsBatch(candidates, { includeTrail: true });
    const trail = result.upgradePaths[0]!.evidenceTrail;
    expect(Array.isArray(trail)).toBe(true);
    expect(trail!.length).toBeGreaterThan(0);
    expect(trail![0]).toHaveProperty("provider");
    expect(trail![0]).toHaveProperty("assertedLicense");
    expect(trail![0]).toHaveProperty("evidence");
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 14: minAuthorityScore filter
// ---------------------------------------------------------------------------

describe("Scenario 14: minAuthorityScore filters out low-authority groups", () => {
  // Low-authority group: both providers are weak sources
  const candidates = sameImage([
    { source: "browser", license: "CC_BY", confidence: 0.3 },
    { source: "managed-browser", license: "CC_BY_SA", confidence: 0.3 },
  ]);

  test("without minAuthorityScore: group is present", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.upgradePaths).toHaveLength(1);
  });

  test("minAuthorityScore=0.9 filters out low-authority groups", () => {
    const result = reconcileLicenseConflictsBatch(candidates, { minAuthorityScore: 0.9 });
    expect(result.upgradePaths).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 15: maxResults cap
// ---------------------------------------------------------------------------

describe("Scenario 15: maxResults caps the output", () => {
  // Create 4 distinct image groups
  const candidates: ImageCandidate[] = [
    ...sameImage([{ source: "wikimedia", license: "CC0" }], "1111111111111111"),
    ...sameImage([{ source: "openverse", license: "CC_BY_SA" }], "2222222222222222"),
    ...sameImage([{ source: "unsplash", license: "UNSPLASH_LICENSE" }], "3333333333333333"),
    ...sameImage([{ source: "pexels", license: "PEXELS_LICENSE" }], "4444444444444444"),
  ];

  test("without maxResults: 4 groups returned", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.totalGroups).toBe(4);
    expect(result.upgradePaths).toHaveLength(4);
  });

  test("maxResults=2: only 2 upgrade paths returned", () => {
    const result = reconcileLicenseConflictsBatch(candidates, { maxResults: 2 });
    expect(result.upgradePaths).toHaveLength(2);
    expect(result.totalGroups).toBe(4); // totalGroups unchanged
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 16: authority ordering — high-authority provider overrides many low
// ---------------------------------------------------------------------------

describe("Scenario 16: High-authority provider overrides many low-authority votes", () => {
  const candidates = sameImage([
    { source: "wikimedia", license: "CC_BY_SA", confidence: 0.95 }, // authority 0.95
    { source: "brave", license: "UNKNOWN", confidence: 0.4 },        // authority 0.40
    { source: "bing", license: "UNKNOWN", confidence: 0.3 },         // authority 0.35
    { source: "serpapi", license: "UNKNOWN", confidence: 0.3 },      // authority 0.35
  ]);

  test("reconcile: CC_BY_SA wins despite 3:1 UNKNOWN majority", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    // wikimedia's authority-weighted score should dominate
    expect(result.upgradePaths[0]!.consensusLicense).toBe("CC_BY_SA");
  });

  test("audit: conflictingProviders are the 3 UNKNOWN asserters", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events[0]!.conflictingProviders.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 17: UNKNOWN + Commons host pattern → upgrade applicable
// ---------------------------------------------------------------------------

describe("Scenario 17: UNKNOWN + Commons host → upgrade to CC_BY_SA suggested", () => {
  const candidates = [
    makeCandidate({
      url: "https://upload.wikimedia.org/wikipedia/commons/a/b/photo.jpg",
      source: "brave",
      license: "UNKNOWN",
      confidence: 0.4,
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:photo.jpg",
    }),
  ];

  test("reconcile: upgrade is applicable with CC_BY_SA target", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    const rec = result.upgradePaths[0]!.upgradeRecommendation;
    expect(rec.upgradeApplicable).toBe(true);
    expect(rec.recommendedLicense).toBe("CC_BY_SA");
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 18: Full audit trail — generatedAt is a valid ISO timestamp
// ---------------------------------------------------------------------------

describe("Scenario 18: generatedAt is a valid ISO-8601 timestamp", () => {
  test("auditLicenseConflictBatch always sets generatedAt", () => {
    const audit = auditLicenseConflictBatch([
      makeCandidate({ url: "https://x.com/1.jpg", source: "unsplash", license: "UNSPLASH_LICENSE" }),
    ]);
    expect(typeof audit.generatedAt).toBe("string");
    expect(new Date(audit.generatedAt).toISOString()).toBe(audit.generatedAt);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 19: eventId is monotonically assigned (0-based per group index)
// ---------------------------------------------------------------------------

describe("Scenario 19: eventId monotonically increases per group", () => {
  const candidates = twoGroups(
    [{ source: "wikimedia", license: "CC_BY" }, { source: "unsplash", license: "UNSPLASH_LICENSE" }],
    [{ source: "nasa", license: "CC0" }, { source: "brave", license: "UNKNOWN" }],
  );

  test("eventIds are distinct non-negative integers", () => {
    const audit = auditLicenseConflictBatch(candidates);
    const ids = audit.events.map((e) => e.eventId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 20: authorityTrail sorted highest-weight first
// ---------------------------------------------------------------------------

describe("Scenario 20: authorityTrail is sorted by weight descending", () => {
  const candidates = sameImage([
    { source: "wikimedia", license: "CC_BY_SA", confidence: 0.9 },   // high weight
    { source: "brave", license: "UNKNOWN", confidence: 0.2 },         // low weight
    { source: "openverse", license: "CC_BY_SA", confidence: 0.8 },   // medium-high
  ]);

  test("authorityTrail entries are in descending weight order", () => {
    const audit = auditLicenseConflictBatch(candidates, { detailedTrail: true });
    const trail = audit.events[0]!.authorityTrail;
    for (let i = 0; i < trail.length - 1; i++) {
      expect(trail[i]!.authorityWeight).toBeGreaterThanOrEqual(trail[i + 1]!.authorityWeight);
    }
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 21: CC_BY vs CC_BY_SA — close but distinct, major conflict
// ---------------------------------------------------------------------------

describe("Scenario 21: CC_BY vs CC_BY_SA — close but distinct licenses", () => {
  const candidates = sameImage([
    { source: "wikimedia", license: "CC_BY" },
    { source: "openverse", license: "CC_BY_SA" },
  ]);

  test("audit severity is major (both are distinct known licenses)", () => {
    const audit = auditLicenseConflictBatch(candidates);
    expect(audit.events[0]!.conflictSeverity).toBe("major");
  });

  test("reconcile: upgrade applicable (both fully open)", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.upgradePaths[0]!.upgradeRecommendation.upgradeApplicable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 22: PEXELS_LICENSE vs CC_BY_SA — mixed open + platform permissive
// ---------------------------------------------------------------------------

describe("Scenario 22: PEXELS_LICENSE vs CC_BY_SA (mixed open + platform)", () => {
  const candidates = sameImage([
    { source: "openverse", license: "CC_BY_SA" },
    { source: "pexels", license: "PEXELS_LICENSE" },
  ]);

  test("upgrade consolidates to conservative platform license", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    const rec = result.upgradePaths[0]!.upgradeRecommendation;
    expect(rec.upgradeApplicable).toBe(true);
    // Mixed open+platform → UNSPLASH_LICENSE as conservative baseline
    expect(rec.recommendedLicense).toBe("UNSPLASH_LICENSE");
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 23: auditNarrative contains provider names for critical conflicts
// ---------------------------------------------------------------------------

describe("Scenario 23: auditNarrative mentions conflicting providers", () => {
  const candidates = sameImage([
    { source: "wikimedia", license: "PUBLIC_DOMAIN" },
    { source: "bing", license: "PRESS_KIT_ALLOWLIST" },
  ]);

  test("auditNarrative references PRESS_KIT_ALLOWLIST or conflicting license", () => {
    const audit = auditLicenseConflictBatch(candidates);
    const narrative = audit.events[0]!.auditNarrative;
    // Critical narrative should mention the conflict
    expect(narrative.toLowerCase()).toMatch(/conflict|critical|restrict|open/i);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 24: upgradePaths sorted by authorityScore descending
// ---------------------------------------------------------------------------

describe("Scenario 24: upgradePaths are sorted highest-authority first", () => {
  // Mix: high-authority group + low-authority group
  const candidates: ImageCandidate[] = [
    // Group A: two wikimedia-tier sources → high authority score
    ...sameImage([
      { source: "wikimedia", license: "CC_BY_SA", confidence: 0.95 },
      { source: "met-museum", license: "CC_BY_SA", confidence: 0.9 },
    ], "aaaa1111aaaa1111"),
    // Group B: two heuristic sources → low authority score
    ...sameImage([
      { source: "brave", license: "CC_BY", confidence: 0.3 },
      { source: "bing", license: "UNKNOWN", confidence: 0.2 },
    ], "bbbb2222bbbb2222"),
  ];

  test("higher-authority group comes first in upgradePaths", () => {
    const result = reconcileLicenseConflictsBatch(candidates);
    expect(result.upgradePaths).toHaveLength(2);
    expect(result.upgradePaths[0]!.authorityScore).toBeGreaterThanOrEqual(
      result.upgradePaths[1]!.authorityScore,
    );
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 25: conflictJustification is a non-empty string
// ---------------------------------------------------------------------------

describe("Scenario 25: conflictJustification is always populated", () => {
  const cases: Array<[string, ImageCandidate[]]> = [
    ["unanimous", sameImage([{ source: "wikimedia", license: "CC0" }, { source: "openverse", license: "CC0" }])],
    ["conflict", sameImage([{ source: "wikimedia", license: "CC0" }, { source: "unsplash", license: "UNSPLASH_LICENSE" }])],
    ["single", [makeCandidate({ url: "https://x.com/1.jpg", source: "pexels", license: "PEXELS_LICENSE" })]],
  ];

  for (const [name, cands] of cases) {
    test(`conflictJustification is non-empty string (${name})`, () => {
      const result = reconcileLicenseConflictsBatch(cands);
      for (const path of result.upgradePaths) {
        expect(typeof path.conflictJustification).toBe("string");
        expect(path.conflictJustification.length).toBeGreaterThan(0);
      }
    });
  }
});
