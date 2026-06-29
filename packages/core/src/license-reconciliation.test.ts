/**
 * Comprehensive test suite for license-reconciliation.ts
 *
 * 60+ test cases covering:
 *  (1)  Unanimous agreement        — 5 tests
 *  (2)  Two-provider conflicts      — 10 tests
 *  (3)  N-way conflicts             — 8 tests
 *  (4)  Confidence decay scenarios  — 6 tests
 *  (5)  Edge cases                  — 4 tests
 *  (6)  Integration with pick.ts    — 5 tests
 *  (7)  Evidence chain audits       — 10 tests
 *  (8)  auditLicenseConflict        — 12 tests (covers all severity levels + edge cases)
 *
 * Mock ImageCandidate shapes mirror real provider outputs:
 *  - Wikimedia: structured api-metadata trail, Commons sourcePageUrl
 *  - Brave:     heuristic-url trail, low confidence
 *  - Spotify:   EDITORIAL_LICENSED, no licenseUrl
 *  - Unsplash:  platform licenseUrl, high confidence
 */

import { describe, expect, test } from "bun:test";
import {
  reconcileLicenses,
  reconcileLicensesAll,
  scoreLicenseConsensus,
  recommendLicenseUpgrade,
  auditLicenseConflict,
  buildEvidenceChain,
  reconcileLicensesBatch,
  levenshteinSimilarityReconcile,
  rankAll,
} from "./index.ts";
import type {
  LicenseConflictAudit,
  LicenseReconciliationResult,
} from "./license-reconciliation.ts";
import type { ImageCandidate } from "./types.ts";

// ---------------------------------------------------------------------------
// Shared mock factories
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

/** Wikimedia-style candidate: structured api-metadata, Commons host. */
function wikimediaCandidate(license: ImageCandidate["license"], confidence = 0.9): ImageCandidate {
  return makeCandidate({
    url: `https://upload.wikimedia.org/wikipedia/commons/${license.toLowerCase()}.jpg`,
    source: "wikimedia",
    license,
    confidence,
    licenseUrl: license === "CC_BY_SA"
      ? "https://creativecommons.org/licenses/by-sa/4.0/"
      : license === "CC0"
        ? "https://creativecommons.org/publicdomain/zero/1.0/"
        : undefined,
    sourcePageUrl: "https://commons.wikimedia.org/wiki/File:example.jpg",
    licenseAuditTrail: {
      source: "api-metadata",
      provenance: `Wikimedia structured API metadata: license "${license}" via MediaInfo.`,
      confidence,
      flags: [],
    },
  });
}

/** Brave-style candidate: heuristic, low confidence, no licenseUrl. */
function braveCandidate(license: ImageCandidate["license"], url = "https://example.com/img.jpg"): ImageCandidate {
  return makeCandidate({
    url,
    source: "brave",
    license,
    confidence: 0.25,
    licenseAuditTrail: {
      source: "heuristic-url",
      provenance: "Brave heuristic: no structured license metadata found.",
      confidence: 0.25,
      flags: ["heuristic-only"],
    },
  });
}

/** Spotify-style candidate: editorial licensed, no licenseUrl. */
function spotifyCandidate(): ImageCandidate {
  return makeCandidate({
    url: "https://i.scdn.co/image/spotify-editorial.jpg",
    source: "spotify",
    license: "EDITORIAL_LICENSED",
    confidence: 0.7,
    licenseAuditTrail: {
      source: "api-metadata",
      provenance: "Spotify editorial license: platform imagery, not redistributable.",
      confidence: 0.7,
      flags: [],
    },
  });
}

/** Unsplash-style candidate: platform license, high confidence. */
function unsplashCandidate(license: ImageCandidate["license"] = "UNSPLASH_LICENSE"): ImageCandidate {
  return makeCandidate({
    url: "https://images.unsplash.com/photo-12345.jpg",
    source: "unsplash",
    license,
    confidence: 0.95,
    licenseUrl: "https://unsplash.com/license",
    sourcePageUrl: "https://unsplash.com/photos/12345",
    licenseAuditTrail: {
      source: "api-metadata",
      provenance: "Unsplash API: license field = 'unsplash'.",
      confidence: 0.95,
      flags: [],
    },
  });
}

/** Group all candidates under the same pHash so they reconcile as one image. */
function withSharedPHash(candidates: ImageCandidate[], phash = "aabbccdd11223344"): ImageCandidate[] {
  return candidates.map((c) => ({ ...c, phash }));
}

// ---------------------------------------------------------------------------
// (1) Unanimous agreement — 5 tests
// ---------------------------------------------------------------------------

describe("(1a) single provider — unanimous by definition", () => {
  test("single Wikimedia CC_BY_SA → consensusLicense CC_BY_SA, conflictCount 0", () => {
    const result = reconcileLicenses([wikimediaCandidate("CC_BY_SA")]);
    expect(result.consensusLicense).toBe("CC_BY_SA");
    expect(result.conflictCount).toBe(0);
  });
});

describe("(1b) all-same-license — three providers unanimous", () => {
  const candidates = withSharedPHash([
    wikimediaCandidate("CC0"),
    makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC0", confidence: 0.85 }),
    makeCandidate({ url: "https://nasa.gov/img.jpg", source: "nasa", license: "CC0", confidence: 0.9 }),
  ]);

  test("consensusLicense is CC0", () => {
    expect(reconcileLicenses(candidates).consensusLicense).toBe("CC0");
  });

  test("conflictCount is 0", () => {
    expect(reconcileLicenses(candidates).conflictCount).toBe(0);
  });

  test("recommendation mentions unanimous", () => {
    expect(reconcileLicenses(candidates).recommendation).toMatch(/unanimous/i);
  });
});

describe("(1c) unanimous with high confidence variance across providers", () => {
  const candidates = withSharedPHash([
    wikimediaCandidate("CC_BY_SA", 0.99),
    makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC_BY_SA", confidence: 0.45 }),
    makeCandidate({ url: "https://flickr.com/img.jpg", source: "flickr", license: "CC_BY_SA", confidence: 0.55 }),
  ]);

  test("consensusLicense is CC_BY_SA despite confidence spread", () => {
    expect(reconcileLicenses(candidates).consensusLicense).toBe("CC_BY_SA");
  });

  test("confidence reflects average — lower than pure high-conf trio", () => {
    const pureHigh = withSharedPHash([
      wikimediaCandidate("CC_BY_SA", 0.95),
      makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC_BY_SA", confidence: 0.95 }),
      makeCandidate({ url: "https://flickr.com/img.jpg", source: "flickr", license: "CC_BY_SA", confidence: 0.95 }),
    ]);
    expect(reconcileLicenses(candidates).confidence).toBeLessThan(reconcileLicenses(pureHigh).confidence);
  });
});

describe("(1d) unanimous low-confidence sources", () => {
  const candidates = withSharedPHash([
    braveCandidate("CC_BY_SA"),
    makeCandidate({ url: "https://bing.com/img.jpg", source: "bing", license: "CC_BY_SA", confidence: 0.2 }),
  ]);

  test("consensusLicense is CC_BY_SA but confidence is low", () => {
    const result = reconcileLicenses(candidates);
    expect(result.consensusLicense).toBe("CC_BY_SA");
    expect(result.confidence).toBeLessThan(0.4);
  });
});

// ---------------------------------------------------------------------------
// (2) Two-provider conflicts — 10 tests
// ---------------------------------------------------------------------------

describe("(2a) CC0 vs UNKNOWN — Wikimedia vs Brave", () => {
  const candidates = withSharedPHash([
    wikimediaCandidate("CC0"),
    braveCandidate("UNKNOWN"),
  ]);

  test("consensus is CC0 (majority by rank over UNKNOWN)", () => {
    expect(reconcileLicenses(candidates).consensusLicense).toBe("CC0");
  });

  test("conflictCount is 1", () => {
    expect(reconcileLicenses(candidates).conflictCount).toBe(1);
  });

  test("conflictLog has 2 entries with correct providers", () => {
    const { conflictLog } = reconcileLicenses(candidates);
    expect(conflictLog).toHaveLength(2);
    const providers = conflictLog.map((e) => e.provider);
    expect(providers).toContain("wikimedia");
    expect(providers).toContain("brave");
  });

  test("recommendation mentions outlier", () => {
    expect(reconcileLicenses(candidates).recommendation).toMatch(/outlier/i);
  });
});

describe("(2b) CC_BY vs CC_BY_SA — two valid open licenses", () => {
  const candidates = withSharedPHash([
    makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC_BY", confidence: 0.8 }),
    wikimediaCandidate("CC_BY_SA"),
  ]);

  test("consensusLicense is one of the two licenses", () => {
    const { consensusLicense } = reconcileLicenses(candidates);
    expect(["CC_BY", "CC_BY_SA"]).toContain(consensusLicense);
  });

  test("conflictCount is 1", () => {
    expect(reconcileLicenses(candidates).conflictCount).toBe(1);
  });

  test("confidence is below 1.0 due to conflict", () => {
    expect(reconcileLicenses(candidates).confidence).toBeLessThan(1.0);
  });
});

describe("(2c) heuristic provider vs metadata provider — same license, different source quality", () => {
  const candidates = withSharedPHash([
    wikimediaCandidate("CC_BY_SA"),
    braveCandidate("CC_BY_SA"),
  ]);

  test("consensusLicense is CC_BY_SA (both agree)", () => {
    expect(reconcileLicenses(candidates).consensusLicense).toBe("CC_BY_SA");
  });

  test("conflictCount is 0 when both assert same license", () => {
    expect(reconcileLicenses(candidates).conflictCount).toBe(0);
  });

  test("scoreLicenseConsensus gives Wikimedia higher authority weight", () => {
    const score = scoreLicenseConsensus(candidates);
    expect(score.consensusLicense).toBe("CC_BY_SA");
    // Wikimedia (0.95 authority) >> Brave (0.40 authority)
    expect(score.authorityScore).toBeGreaterThan(0.6);
  });
});

describe("(2d) UNSPLASH_LICENSE vs UNKNOWN — platform vs heuristic", () => {
  const candidates = withSharedPHash([
    unsplashCandidate(),
    braveCandidate("UNKNOWN"),
  ]);

  test("consensus is UNSPLASH_LICENSE", () => {
    expect(reconcileLicenses(candidates).consensusLicense).toBe("UNSPLASH_LICENSE");
  });

  test("conflictLog identifies brave as the outlier", () => {
    const { conflictLog } = reconcileLicenses(candidates);
    const outlier = conflictLog.find((e) => e.assertedLicense === "UNKNOWN");
    expect(outlier?.provider).toBe("brave");
  });
});

describe("(2e) PEXELS_LICENSE vs PIXABAY_LICENSE — platform tie", () => {
  const candidates = withSharedPHash([
    makeCandidate({ url: "https://images.pexels.com/img.jpg", source: "pexels", license: "PEXELS_LICENSE", confidence: 0.9 }),
    makeCandidate({ url: "https://cdn.pixabay.com/img.jpg", source: "pixabay", license: "PIXABAY_LICENSE", confidence: 0.9 }),
  ]);

  test("conflictCount is 1 (each asserts different platform license)", () => {
    expect(reconcileLicenses(candidates).conflictCount).toBe(1);
  });

  test("PEXELS_LICENSE wins tie (lower LICENSE_RANK = rank 6 < 7)", () => {
    expect(reconcileLicenses(candidates).consensusLicense).toBe("PEXELS_LICENSE");
  });
});

// ---------------------------------------------------------------------------
// (3) N-way conflicts — 8 tests
// ---------------------------------------------------------------------------

describe("(3a) 3 providers with 2 factions — CC_BY_SA majority", () => {
  const candidates = withSharedPHash([
    wikimediaCandidate("CC_BY_SA"),
    makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC_BY_SA", confidence: 0.85 }),
    braveCandidate("UNKNOWN"),
  ]);

  test("consensusLicense is CC_BY_SA (2 vs 1)", () => {
    expect(reconcileLicenses(candidates).consensusLicense).toBe("CC_BY_SA");
  });

  test("conflictCount is 1", () => {
    expect(reconcileLicenses(candidates).conflictCount).toBe(1);
  });

  test("confidence is lower than pure 3-way unanimous consensus", () => {
    // CC_BY_SA vs UNKNOWN has Levenshtein sim = 0, so confidence = 0 per formula.
    // Pure unanimous consensus yields confidence > 0.
    const unanimous = withSharedPHash([
      wikimediaCandidate("CC_BY_SA"),
      makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC_BY_SA", confidence: 0.85 }),
      makeCandidate({ url: "https://flickr.com/img.jpg", source: "flickr", license: "CC_BY_SA", confidence: 0.8 }),
    ]);
    expect(reconcileLicenses(candidates).confidence).toBeLessThan(reconcileLicenses(unanimous).confidence);
  });
});

describe("(3b) 4 providers with 3-way split — license rank tie-breaking", () => {
  // CC0 × 2, CC_BY × 1, UNKNOWN × 1 → CC0 wins by majority (2 votes)
  const candidates = withSharedPHash([
    wikimediaCandidate("CC0"),
    makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC0", confidence: 0.8 }),
    makeCandidate({ url: "https://nasa.gov/img.jpg", source: "nasa", license: "CC_BY", confidence: 0.85 }),
    braveCandidate("UNKNOWN"),
  ]);

  test("CC0 wins with 2 votes", () => {
    expect(reconcileLicenses(candidates).consensusLicense).toBe("CC0");
  });

  test("conflictCount is 2 (CC_BY + UNKNOWN disagree)", () => {
    expect(reconcileLicenses(candidates).conflictCount).toBe(2);
  });

  test("recommendation mentions split or legal review", () => {
    expect(reconcileLicenses(candidates).recommendation).toMatch(/split|legal/i);
  });
});

describe("(3c) 4-way all-different — maximum conflict", () => {
  const candidates = withSharedPHash([
    wikimediaCandidate("CC0"),
    makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC_BY", confidence: 0.8 }),
    unsplashCandidate(),
    braveCandidate("UNKNOWN"),
  ]);

  test("conflictCount is 3 (totalProviders - 1 when all differ)", () => {
    expect(reconcileLicenses(candidates).conflictCount).toBe(3);
  });

  test("confidence is low (< 0.4)", () => {
    expect(reconcileLicenses(candidates).confidence).toBeLessThan(0.4);
  });

  test("recommendation mentions legal review", () => {
    expect(reconcileLicenses(candidates).recommendation).toMatch(/legal/i);
  });
});

describe("(3d) 5 providers with majority — 3×CC_BY_SA vs 2×UNKNOWN", () => {
  const candidates = withSharedPHash([
    wikimediaCandidate("CC_BY_SA"),
    makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC_BY_SA", confidence: 0.85 }),
    makeCandidate({ url: "https://flickr.com/img.jpg", source: "flickr", license: "CC_BY_SA", confidence: 0.65 }),
    braveCandidate("UNKNOWN"),
    makeCandidate({ url: "https://bing.com/img.jpg", source: "bing", license: "UNKNOWN", confidence: 0.2 }),
  ]);

  test("CC_BY_SA wins with 3 votes", () => {
    expect(reconcileLicenses(candidates).consensusLicense).toBe("CC_BY_SA");
  });

  test("conflictCount is 2", () => {
    expect(reconcileLicenses(candidates).conflictCount).toBe(2);
  });

  test("conflictLog has 5 entries", () => {
    expect(reconcileLicenses(candidates).conflictLog).toHaveLength(5);
  });

  test("recommendation mentions 3/5 agreement or majority", () => {
    expect(reconcileLicenses(candidates).recommendation).toMatch(/3\/5|outlier|split/i);
  });
});

// ---------------------------------------------------------------------------
// (4) Confidence decay scenarios — 6 tests
// ---------------------------------------------------------------------------

describe("(4a) low-confidence metadata — UNKNOWN mixed with safe licenses", () => {
  test("three heuristic UNKNOWN providers → confidence near 0", () => {
    const candidates = withSharedPHash([
      braveCandidate("UNKNOWN"),
      makeCandidate({ url: "https://bing.com/img.jpg", source: "bing", license: "UNKNOWN", confidence: 0.15 }),
      makeCandidate({ url: "https://serpapi.com/img.jpg", source: "serpapi", license: "UNKNOWN", confidence: 0.1 }),
    ]);
    const result = reconcileLicenses(candidates);
    expect(result.consensusLicense).toBe("UNKNOWN");
    expect(result.confidence).toBeLessThan(0.3);
  });

  test("high-confidence providers increase composite confidence vs low-confidence peers", () => {
    const low = withSharedPHash([
      makeCandidate({ url: "https://a.com/img.jpg", source: "wikimedia", license: "CC_BY_SA", confidence: 0.1 }),
      makeCandidate({ url: "https://b.com/img.jpg", source: "openverse", license: "CC_BY_SA", confidence: 0.1 }),
    ]);
    const high = withSharedPHash([
      wikimediaCandidate("CC_BY_SA", 0.95),
      makeCandidate({ url: "https://b.com/img.jpg", source: "openverse", license: "CC_BY_SA", confidence: 0.95 }),
    ]);
    expect(reconcileLicenses(high).confidence).toBeGreaterThan(reconcileLicenses(low).confidence);
  });
});

describe("(4b) UNKNOWN mixed with safe — audit trail shows low evidence quality", () => {
  test("conflictLog entries reflect per-candidate confidence", () => {
    const candidates = withSharedPHash([
      wikimediaCandidate("CC_BY_SA", 0.9),
      braveCandidate("UNKNOWN"),
    ]);
    const { conflictLog } = reconcileLicenses(candidates);
    const wikiEntry = conflictLog.find((e) => e.provider === "wikimedia");
    const braveEntry = conflictLog.find((e) => e.provider === "brave");
    expect(wikiEntry!.licenseConfidence).toBeGreaterThan(braveEntry!.licenseConfidence);
  });

  test("audit trail evidence on low-conf candidate flags heuristic guess", () => {
    const c = braveCandidate("UNKNOWN");
    c.confidence = 0.2;
    const chain = buildEvidenceChain(c);
    const confEntry = chain.find((e) => e.field === "confidence");
    expect(confEntry!.interpretation).toMatch(/heuristic guess/i);
  });
});

describe("(4c) confidence decay — single low-confidence provider", () => {
  test("single provider confidence is reflected in result.confidence", () => {
    const c = makeCandidate({ url: "https://bing.com/img.jpg", source: "bing", license: "UNKNOWN", confidence: 0.1 });
    const result = reconcileLicenses([c]);
    expect(result.confidence).toBeCloseTo(0.1, 5);
  });

  test("conflictLog licenseConfidence defaults to 0.5 when confidence is undefined", () => {
    const c: ImageCandidate = {
      url: "https://example.com/img.jpg",
      source: "flickr",
      license: "CC_BY",
      title: "No confidence",
      // confidence intentionally omitted
    };
    const { conflictLog } = reconcileLicenses([c]);
    expect(conflictLog[0]!.licenseConfidence).toBeCloseTo(0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// (5) Edge cases — 4 tests
// ---------------------------------------------------------------------------

describe("(5a) empty input", () => {
  test("reconcileLicenses([]) returns UNKNOWN, confidence 0, empty log", () => {
    const result = reconcileLicenses([]);
    expect(result.consensusLicense).toBe("UNKNOWN");
    expect(result.confidence).toBe(0);
    expect(result.conflictCount).toBe(0);
    expect(result.conflictLog).toHaveLength(0);
    expect(result.recommendation).toMatch(/no candidates/i);
  });
});

describe("(5b) all-UNKNOWN pool", () => {
  test("all UNKNOWN → consensusLicense UNKNOWN, conflictCount 0", () => {
    const candidates = withSharedPHash([
      braveCandidate("UNKNOWN"),
      makeCandidate({ url: "https://bing.com/img.jpg", source: "bing", license: "UNKNOWN", confidence: 0.15 }),
      makeCandidate({ url: "https://serpapi.com/img.jpg", source: "serpapi", license: "UNKNOWN", confidence: 0.2 }),
    ]);
    const result = reconcileLicenses(candidates);
    expect(result.consensusLicense).toBe("UNKNOWN");
    expect(result.conflictCount).toBe(0);
  });
});

describe("(5c) editorial vs press-kit", () => {
  test("EDITORIAL_LICENSED vs PRESS_KIT_ALLOWLIST — editorial wins (lower rank 8 < 9)", () => {
    const candidates = withSharedPHash([
      spotifyCandidate(),
      makeCandidate({ url: "https://artist.com/press.jpg", source: "browser", license: "PRESS_KIT_ALLOWLIST", confidence: 0.6 }),
    ]);
    expect(reconcileLicenses(candidates).consensusLicense).toBe("EDITORIAL_LICENSED");
  });
});

describe("(5d) single candidate — recommendation mentions cross-validation", () => {
  test("single Unsplash result includes cross-validation advice", () => {
    const result = reconcileLicenses([unsplashCandidate()]);
    expect(result.recommendation).toMatch(/cross.validation|additional provider/i);
  });
});

// ---------------------------------------------------------------------------
// (6) Integration with pick.ts — 5 tests
// ---------------------------------------------------------------------------

describe("(6a) reconciliation + rankAll — open licenses ranked above platform", () => {
  test("reconciled CC0 candidate ranked above UNSPLASH_LICENSE in rankAll", () => {
    const cc0 = wikimediaCandidate("CC0");
    const unsplash = unsplashCandidate();
    const ranked = rankAll([unsplash, cc0], { licensePolicy: "any" });
    expect(ranked[0]!.license).toBe("CC0");
  });
});

describe("(6b) reconciliation + rankAll — UNKNOWN rejected under open-only policy", () => {
  test("UNKNOWN candidates are filtered out under open-only policy", () => {
    const candidates = [
      wikimediaCandidate("CC_BY_SA"),
      braveCandidate("UNKNOWN"),
      unsplashCandidate(),
    ];
    const ranked = rankAll(candidates, { licensePolicy: "open-only" });
    const licenses = ranked.map((c) => c.license);
    expect(licenses).not.toContain("UNKNOWN");
    expect(licenses).not.toContain("UNSPLASH_LICENSE");
    expect(licenses).toContain("CC_BY_SA");
  });
});

describe("(6c) reconciled license feeds into pick pipeline — context-safe passes editorial", () => {
  test("EDITORIAL_LICENSED kept under context-safe policy", () => {
    const candidates = [spotifyCandidate()];
    const ranked = rankAll(candidates, { licensePolicy: "context-safe" });
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.license).toBe("EDITORIAL_LICENSED");
  });
});

describe("(6d) reconciliation with audit trail boosts trailConf in rankAll", () => {
  test("candidate with api-metadata trail ranks above same-license candidate without trail", () => {
    const withTrail = wikimediaCandidate("CC_BY_SA", 0.8);
    const withoutTrail = makeCandidate({
      url: "https://openverse.org/img.jpg",
      source: "openverse",
      license: "CC_BY_SA",
      confidence: 0.8,
    });
    const ranked = rankAll([withoutTrail, withTrail], { licensePolicy: "any" });
    // withTrail has licenseAuditTrail.confidence = 0.8 → higher trailConf tie-break
    expect(ranked[0]!.source).toBe("wikimedia");
  });
});

describe("(6e) reconcileLicensesAll + pick — primary group result feeds pick correctly", () => {
  test("largest pHash group's consensus license is a valid License tag", () => {
    const groupA = withSharedPHash([
      wikimediaCandidate("CC0"),
      makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC0", confidence: 0.85 }),
    ], "aaaa1111bbbb2222");
    const groupB = [
      makeCandidate({ url: "https://unsplash.com/img.jpg", source: "unsplash", license: "UNSPLASH_LICENSE", confidence: 0.9 }),
    ];
    const all = reconcileLicensesAll([...groupA, ...groupB]);
    expect(all).toHaveLength(2);
    // Largest group first
    expect(all[0]!.consensusLicense).toBe("CC0");
    expect(all[1]!.consensusLicense).toBe("UNSPLASH_LICENSE");
  });
});

// ---------------------------------------------------------------------------
// (7) Evidence chain audits — 10 tests
// ---------------------------------------------------------------------------

describe("(7a) Wikimedia structured evidence chain", () => {
  const c = wikimediaCandidate("CC_BY_SA");
  const chain = buildEvidenceChain(c);

  test("chain contains 'license' entry with correct rawValue", () => {
    const entry = chain.find((e) => e.field === "license");
    expect(entry).toBeDefined();
    expect(entry!.rawValue).toBe("CC_BY_SA");
  });

  test("chain contains 'licenseUrl' entry matching CC BY-SA URL pattern", () => {
    const entry = chain.find((e) => e.field === "licenseUrl");
    expect(entry).toBeDefined();
    expect(entry!.interpretation).toMatch(/CC BY-SA/i);
  });

  test("chain contains 'licenseAuditTrail.source' with api-metadata", () => {
    const entry = chain.find((e) => e.field === "licenseAuditTrail.source");
    expect(entry).toBeDefined();
    expect(entry!.rawValue).toBe("api-metadata");
  });

  test("chain contains 'sourcePageUrl' entry with Commons corroboration", () => {
    const entry = chain.find((e) => e.field === "sourcePageUrl");
    expect(entry).toBeDefined();
    expect(entry!.interpretation).toMatch(/corroborates/i);
  });
});

describe("(7b) Brave heuristic evidence chain", () => {
  const c = braveCandidate("UNKNOWN");
  c.confidence = 0.25;
  const chain = buildEvidenceChain(c);

  test("chain's 'license' field rawValue is UNKNOWN", () => {
    const entry = chain.find((e) => e.field === "license");
    expect(entry!.rawValue).toBe("UNKNOWN");
  });

  test("chain's 'confidence' field interpretation flags heuristic guess", () => {
    const entry = chain.find((e) => e.field === "confidence");
    expect(entry!.interpretation).toMatch(/heuristic guess/i);
  });

  test("chain's 'licenseAuditTrail.source' interpretation contains heuristic-only flag", () => {
    const entry = chain.find((e) => e.field === "licenseAuditTrail.source");
    expect(entry!.interpretation).toContain("heuristic-only");
  });
});

describe("(7c) per-provider provenance in conflictLog", () => {
  test("Wikimedia conflictLog entry reasoning contains structured provenance text", () => {
    const candidates = withSharedPHash([wikimediaCandidate("CC_BY_SA"), braveCandidate("UNKNOWN")]);
    const { conflictLog } = reconcileLicenses(candidates);
    const wikiEntry = conflictLog.find((e) => e.provider === "wikimedia");
    expect(wikiEntry!.reasoning).toContain("Wikimedia structured API metadata");
  });

  test("all conflictLog entries have non-empty evidence arrays", () => {
    const candidates = withSharedPHash([
      wikimediaCandidate("CC0"),
      unsplashCandidate(),
      braveCandidate("UNKNOWN"),
    ]);
    const { conflictLog } = reconcileLicenses(candidates);
    for (const entry of conflictLog) {
      expect(entry.evidence.length).toBeGreaterThan(0);
    }
  });

  test("each evidence item has field, rawValue, and interpretation strings", () => {
    const candidates = withSharedPHash([wikimediaCandidate("CC_BY_SA"), unsplashCandidate()]);
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

describe("(7d) CC0 URL pattern extraction in evidence chain", () => {
  test("CC0 licenseUrl matched with CC0 Public Domain Dedication label", () => {
    const c = makeCandidate({
      url: "https://openverse.org/img.jpg",
      source: "openverse",
      license: "CC0",
      licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    });
    const chain = buildEvidenceChain(c);
    const entry = chain.find((e) => e.field === "licenseUrl");
    expect(entry!.interpretation).toMatch(/CC0/i);
  });
});

// ---------------------------------------------------------------------------
// (8) auditLicenseConflict — 12 tests
// ---------------------------------------------------------------------------

describe("(8a) auditLicenseConflict — no conflict (unanimous)", () => {
  test("all CC_BY_SA → severity 'none', legalReviewRequired false", () => {
    const candidates = withSharedPHash([
      wikimediaCandidate("CC_BY_SA"),
      makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC_BY_SA", confidence: 0.85 }),
    ]);
    const audit = auditLicenseConflict(candidates);
    expect(audit.conflictSeverity).toBe("none");
    expect(audit.legalReviewRequired).toBe(false);
    expect(audit.conflictingProviders).toHaveLength(0);
  });

  test("auditNarrative mentions unanimous", () => {
    const candidates = withSharedPHash([wikimediaCandidate("CC0"), wikimediaCandidate("CC0")]);
    const audit = auditLicenseConflict(candidates);
    expect(audit.auditNarrative).toMatch(/unanimous/i);
  });
});

describe("(8b) auditLicenseConflict — minor conflict (UNKNOWN vs known license)", () => {
  test("Wikimedia CC_BY_SA vs Brave UNKNOWN → severity 'minor'", () => {
    const candidates = withSharedPHash([
      wikimediaCandidate("CC_BY_SA"),
      braveCandidate("UNKNOWN"),
    ]);
    const audit = auditLicenseConflict(candidates);
    expect(audit.conflictSeverity).toBe("minor");
    expect(audit.legalReviewRequired).toBe(false);
    expect(audit.conflictingProviders).toContain("brave");
  });

  test("auditNarrative recommends re-querying conflicting provider", () => {
    const candidates = withSharedPHash([
      wikimediaCandidate("CC0"),
      braveCandidate("UNKNOWN"),
    ]);
    const audit = auditLicenseConflict(candidates);
    expect(audit.auditNarrative).toMatch(/re.query/i);
  });
});

describe("(8c) auditLicenseConflict — major conflict (two known licenses)", () => {
  test("CC0 vs CC_BY_SA → severity 'major', legalReviewRequired true", () => {
    const candidates = withSharedPHash([
      wikimediaCandidate("CC0"),
      makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC_BY_SA", confidence: 0.85 }),
    ]);
    const audit = auditLicenseConflict(candidates);
    expect(audit.conflictSeverity).toBe("major");
    expect(audit.legalReviewRequired).toBe(true);
  });

  test("CC_BY vs UNSPLASH_LICENSE → severity 'major'", () => {
    const candidates = withSharedPHash([
      makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC_BY", confidence: 0.8 }),
      unsplashCandidate(),
    ]);
    const audit = auditLicenseConflict(candidates);
    expect(audit.conflictSeverity).toBe("major");
    expect(audit.legalReviewRequired).toBe(true);
    expect(audit.auditNarrative).toMatch(/legal review/i);
  });

  test("conflictingProviders list is non-empty in major conflict", () => {
    const candidates = withSharedPHash([
      wikimediaCandidate("CC0"),
      unsplashCandidate(),
      braveCandidate("UNKNOWN"),
    ]);
    const audit = auditLicenseConflict(candidates);
    // UNSPLASH_LICENSE and UNKNOWN both conflict with CC0 majority
    expect(audit.conflictingProviders.length).toBeGreaterThan(0);
  });
});

describe("(8d) auditLicenseConflict — critical conflict (open + restrictive)", () => {
  test("CC0 vs EDITORIAL_LICENSED → severity 'critical'", () => {
    const candidates = withSharedPHash([
      wikimediaCandidate("CC0"),
      spotifyCandidate(),
    ]);
    const audit = auditLicenseConflict(candidates);
    expect(audit.conflictSeverity).toBe("critical");
    expect(audit.legalReviewRequired).toBe(true);
  });

  test("CC_BY vs PRESS_KIT_ALLOWLIST → severity 'critical'", () => {
    const candidates = withSharedPHash([
      makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC_BY", confidence: 0.8 }),
      makeCandidate({ url: "https://artist.com/press.jpg", source: "browser", license: "PRESS_KIT_ALLOWLIST", confidence: 0.6 }),
    ]);
    const audit = auditLicenseConflict(candidates);
    expect(audit.conflictSeverity).toBe("critical");
    expect(audit.legalReviewRequired).toBe(true);
  });

  test("critical auditNarrative warns against publishing without legal clearance", () => {
    const candidates = withSharedPHash([
      wikimediaCandidate("CC_BY_SA"),
      spotifyCandidate(),
    ]);
    const audit = auditLicenseConflict(candidates);
    expect(audit.auditNarrative).toMatch(/do not publish|legal clearance/i);
  });

  test("critical auditNarrative lists all license types involved", () => {
    const candidates = withSharedPHash([
      wikimediaCandidate("CC0"),
      spotifyCandidate(),
    ]);
    const audit = auditLicenseConflict(candidates);
    expect(audit.auditNarrative).toContain("CC0");
    expect(audit.auditNarrative).toContain("EDITORIAL_LICENSED");
  });
});

describe("(8e) auditLicenseConflict — empty input edge case", () => {
  test("empty array → severity 'none', no legal review required", () => {
    const audit = auditLicenseConflict([]);
    expect(audit.conflictSeverity).toBe("none");
    expect(audit.legalReviewRequired).toBe(false);
    expect(audit.conflictingProviders).toHaveLength(0);
    expect(audit.consensusLicense).toBe("UNKNOWN");
  });
});

describe("(8f) auditLicenseConflict — consensusLicense matches reconcileLicenses output", () => {
  test("auditLicenseConflict.consensusLicense equals reconcileLicenses.consensusLicense", () => {
    const candidates = withSharedPHash([
      wikimediaCandidate("CC_BY_SA"),
      makeCandidate({ url: "https://openverse.org/img.jpg", source: "openverse", license: "CC_BY_SA", confidence: 0.85 }),
      braveCandidate("UNKNOWN"),
    ]);
    const reconciled = reconcileLicenses(candidates);
    const audit = auditLicenseConflict(candidates);
    expect(audit.consensusLicense).toBe(reconciled.consensusLicense);
  });
});

// ---------------------------------------------------------------------------
// Additional: scoreLicenseConsensus authority-weighting — 3 tests
// ---------------------------------------------------------------------------

describe("scoreLicenseConsensus — unknown provider defaults to 0.5 authority", () => {
  test("unknown provider id uses 0.5 default authority weight", () => {
    const c = makeCandidate({
      url: "https://custom-provider.com/img.jpg",
      source: "custom-unknown-provider",
      license: "CC_BY",
      confidence: 0.8,
    });
    const score = scoreLicenseConsensus([c]);
    expect(score.consensusLicense).toBe("CC_BY");
    expect(score.authorityScore).toBeGreaterThan(0);
  });

  test("Wikimedia authority (0.95) defeats Bing authority (0.35) on conflicting licenses", () => {
    const candidates = [
      wikimediaCandidate("CC_BY_SA", 0.9),
      makeCandidate({ url: "https://bing.com/img.jpg", source: "bing", license: "UNKNOWN", confidence: 0.9 }),
    ];
    const score = scoreLicenseConsensus(candidates);
    expect(score.consensusLicense).toBe("CC_BY_SA");
  });

  test("empty input returns UNKNOWN with score 0 and explanatory justification", () => {
    const score = scoreLicenseConsensus([]);
    expect(score.consensusLicense).toBe("UNKNOWN");
    expect(score.authorityScore).toBe(0);
    expect(score.conflictJustification).toMatch(/no candidates/i);
  });
});

// ---------------------------------------------------------------------------
// Additional: recommendLicenseUpgrade — 4 tests
// ---------------------------------------------------------------------------

describe("recommendLicenseUpgrade — UNKNOWN + no Commons host", () => {
  test("upgradeApplicable is false when no Commons host present", () => {
    const candidates = [
      makeCandidate({
        url: "https://random-blog.com/img.jpg",
        source: "brave",
        license: "UNKNOWN",
        confidence: 0.2,
      }),
    ];
    const reconciled = reconcileLicenses(candidates);
    const upgrade = recommendLicenseUpgrade(candidates, reconciled);
    expect(upgrade.upgradeApplicable).toBe(false);
    expect(upgrade.recommendedLicense).toBe("UNKNOWN");
    expect(upgrade.confidence).toBe(0);
  });

  test("upgradeApplicable true when Brave detects Europeana Commons host", () => {
    const candidates = [
      makeCandidate({
        url: "https://europeana.eu/item/123",
        source: "brave",
        license: "UNKNOWN",
        confidence: 0.3,
        sourcePageUrl: "https://europeana.eu/record/123",
      }),
    ];
    const reconciled = reconcileLicenses(candidates);
    const upgrade = recommendLicenseUpgrade(candidates, reconciled);
    expect(upgrade.upgradeApplicable).toBe(true);
    expect(upgrade.recommendedLicense).toBe("CC_BY_SA");
  });
});

describe("recommendLicenseUpgrade — fully open license consolidation", () => {
  test("CC0 + PUBLIC_DOMAIN conflict → recommends CC0 (most open, rank 1 < 2)", () => {
    const candidates = withSharedPHash([
      wikimediaCandidate("CC0"),
      makeCandidate({ url: "https://loc.gov/img.jpg", source: "library-of-congress", license: "PUBLIC_DOMAIN", confidence: 0.9 }),
    ]);
    const reconciled = reconcileLicenses(candidates);
    const upgrade = recommendLicenseUpgrade(candidates, reconciled);
    expect(upgrade.upgradeApplicable).toBe(true);
    expect(upgrade.recommendedLicense).toBe("CC0");
    expect(upgrade.confidence).toBeGreaterThan(0.5);
  });

  test("unanimous EDITORIAL_LICENSED → no upgrade applicable", () => {
    const candidates = withSharedPHash([
      spotifyCandidate(),
      makeCandidate({ url: "https://itunes.apple.com/img.jpg", source: "itunes", license: "EDITORIAL_LICENSED", confidence: 0.7 }),
    ]);
    const reconciled = reconcileLicenses(candidates);
    const upgrade = recommendLicenseUpgrade(candidates, reconciled);
    expect(upgrade.upgradeApplicable).toBe(false);
  });
});
