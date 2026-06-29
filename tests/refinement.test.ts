/**
 * Tests for License Metadata Confidence Decay + Progressive Result Refinement.
 *
 * Covers:
 *  - refineSearchResults() from packages/core/src/pick.ts
 *  - RefinementPlan shape from packages/core/src/types.ts
 *  - refine_search_results MCP tool handler (via TOOLS array)
 */

import { describe, expect, test } from "bun:test";
import { refineSearchResults } from "../packages/core/src/pick.ts";
import type { ImageCandidate, SearchResultBundle } from "../packages/core/src/types.ts";
import { TOOLS } from "../packages/mcp/src/tools.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mk = (p: Partial<ImageCandidate>): ImageCandidate => ({
  url: "https://example.com/img.jpg",
  source: "wikimedia",
  license: "CC0",
  ...p,
});

function makeBundle(candidates: ImageCandidate[]): SearchResultBundle {
  return { candidates, providerReports: [], warnings: [] };
}

// ---------------------------------------------------------------------------
// Unit: refineSearchResults()
// ---------------------------------------------------------------------------

describe("refineSearchResults", () => {
  test("returns empty plan for fully high-confidence bundle", () => {
    const bundle = makeBundle([
      mk({ license: "CC0", confidence: 0.9 }),
      mk({ license: "CC_BY", confidence: 0.8 }),
    ]);
    const plan = refineSearchResults(bundle);

    expect(plan.summary.totalCandidates).toBe(2);
    expect(plan.summary.lowConfidenceCount).toBe(0);
    expect(plan.summary.unknownLicenseCount).toBe(0);
    expect(plan.summary.gapRatio).toBe(0);
    expect(plan.confidenceGaps).toHaveLength(0);
  });

  test("flags UNKNOWN license candidates with fallback-to-open-only", () => {
    const bundle = makeBundle([
      mk({ license: "UNKNOWN", confidence: 0 }),
      mk({ license: "CC0", confidence: 0.9 }),
    ]);
    const plan = refineSearchResults(bundle);

    expect(plan.summary.unknownLicenseCount).toBe(1);
    expect(plan.confidenceGaps).toHaveLength(1);

    const gap = plan.confidenceGaps[0];
    expect(gap.candidateIndex).toBe(0);
    expect(gap.suggestedAction).toBe("fallback-to-open-only");
    expect(gap.currentConfidence).toBe(0);
    expect(typeof gap.reason).toBe("string");
    expect(gap.reason.length).toBeGreaterThan(0);
  });

  test("flags low-confidence candidate with sourcePageUrl as probe-page", () => {
    const bundle = makeBundle([
      mk({
        license: "CC_BY_SA",
        confidence: 0.3,
        sourcePageUrl: "https://commons.wikimedia.org/wiki/File:test.jpg",
      }),
    ]);
    const plan = refineSearchResults(bundle);

    expect(plan.confidenceGaps).toHaveLength(1);
    const gap = plan.confidenceGaps[0];
    expect(gap.suggestedAction).toBe("probe-page");
    expect(gap.currentConfidence).toBeCloseTo(0.3);
  });

  test("flags low-confidence candidate without sourcePageUrl as upgrade-provider", () => {
    const bundle = makeBundle([
      mk({ license: "CC_BY", confidence: 0.2 }),
    ]);
    const plan = refineSearchResults(bundle);

    expect(plan.confidenceGaps).toHaveLength(1);
    expect(plan.confidenceGaps[0].suggestedAction).toBe("upgrade-provider");
  });

  test("confidence threshold is respected", () => {
    const bundle = makeBundle([
      mk({ license: "CC_BY", confidence: 0.6 }),
      mk({ license: "CC_BY", confidence: 0.3 }),
    ]);

    const strict = refineSearchResults(bundle, { confidenceThreshold: 0.7 });
    expect(strict.confidenceGaps).toHaveLength(2);

    const lenient = refineSearchResults(bundle, { confidenceThreshold: 0.2 });
    expect(lenient.confidenceGaps).toHaveLength(0);
  });

  test("upgrade path includes open-only when gap ratio > 50%", () => {
    const bundle = makeBundle([
      mk({ license: "UNKNOWN", confidence: 0 }),
      mk({ license: "UNKNOWN", confidence: 0 }),
      mk({ license: "CC0", confidence: 0.9 }),
    ]);
    const plan = refineSearchResults(bundle);

    const targetPolicies = plan.upgradePath.map((u) => u.targetLicensePolicy);
    expect(targetPolicies).toContain("open-only");
    expect(targetPolicies).toContain("prefer-safe");
    // open-only should come first (highest expected gain)
    expect(plan.upgradePath[0].targetLicensePolicy).toBe("open-only");
    expect(plan.upgradePath[0].expectedConfidenceGain).toBeGreaterThan(0);
  });

  test("upgrade path always contains prefer-safe and any", () => {
    const bundle = makeBundle([mk({ license: "CC0", confidence: 0.9 })]);
    const plan = refineSearchResults(bundle);

    const policies = plan.upgradePath.map((u) => u.targetLicensePolicy);
    expect(policies).toContain("prefer-safe");
    expect(policies).toContain("any");
  });

  test("any policy step always has expectedConfidenceGain of 0", () => {
    const bundle = makeBundle([mk({ license: "CC0", confidence: 0.9 })]);
    const plan = refineSearchResults(bundle);

    const anyStep = plan.upgradePath.find((u) => u.targetLicensePolicy === "any");
    expect(anyStep).toBeDefined();
    expect(anyStep!.expectedConfidenceGain).toBe(0);
  });

  test("highConfidenceProviders passed through to plan", () => {
    const bundle = makeBundle([mk({ license: "CC0", confidence: 0.9 })]);
    const plan = refineSearchResults(bundle, {
      highConfidenceProviders: ["wikimedia", "openverse"],
    });
    expect(plan.highConfidenceProviders).toEqual(["wikimedia", "openverse"]);
  });

  test("defaults highConfidenceProviders to empty array when not provided", () => {
    const bundle = makeBundle([mk({ license: "CC0", confidence: 0.9 })]);
    const plan = refineSearchResults(bundle);
    expect(plan.highConfidenceProviders).toEqual([]);
  });

  test("gapRatio is correct fraction", () => {
    const bundle = makeBundle([
      mk({ license: "UNKNOWN", confidence: 0 }),
      mk({ license: "UNKNOWN", confidence: 0 }),
      mk({ license: "CC0", confidence: 0.9 }),
      mk({ license: "CC_BY", confidence: 0.8 }),
    ]);
    const plan = refineSearchResults(bundle);
    expect(plan.summary.gapRatio).toBeCloseTo(0.5);
  });

  test("empty bundle returns zero-summary", () => {
    const bundle = makeBundle([]);
    const plan = refineSearchResults(bundle);
    expect(plan.summary.totalCandidates).toBe(0);
    expect(plan.summary.gapRatio).toBe(0);
    expect(plan.confidenceGaps).toHaveLength(0);
  });

  test("candidateIndex is correct in gap", () => {
    const bundle = makeBundle([
      mk({ license: "CC0", confidence: 0.9 }),
      mk({ license: "UNKNOWN", confidence: 0 }),
      mk({ license: "CC_BY", confidence: 0.8 }),
    ]);
    const plan = refineSearchResults(bundle);
    expect(plan.confidenceGaps).toHaveLength(1);
    expect(plan.confidenceGaps[0].candidateIndex).toBe(1);
  });

  test("candidate reference in gap matches original", () => {
    const cand = mk({ url: "https://example.com/special.jpg", license: "UNKNOWN", confidence: 0 });
    const bundle = makeBundle([cand]);
    const plan = refineSearchResults(bundle);
    expect(plan.confidenceGaps[0].candidate.url).toBe("https://example.com/special.jpg");
  });

  test("upgrade path steps each have a non-empty rationale", () => {
    const bundle = makeBundle([mk({ license: "UNKNOWN", confidence: 0 })]);
    const plan = refineSearchResults(bundle);
    for (const step of plan.upgradePath) {
      expect(typeof step.rationale).toBe("string");
      expect(step.rationale.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// MCP tool: refine_search_results
// ---------------------------------------------------------------------------

describe("MCP tool: refine_search_results", () => {
  const tool = TOOLS.find((t) => t.name === "refine_search_results");

  test("tool is registered in TOOLS", () => {
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("refine_search_results");
    expect(typeof tool!.handler).toBe("function");
  });

  test("tool schema has required candidates field", () => {
    const parsed = tool!.inputSchema.safeParse({ candidates: [] });
    // min(1) means empty array fails
    expect(parsed.success).toBe(false);
  });

  test("tool schema accepts valid candidates", () => {
    const parsed = tool!.inputSchema.safeParse({
      candidates: [{ url: "https://example.com/a.jpg", source: "wikimedia", license: "CC0" }],
    });
    expect(parsed.success).toBe(true);
  });

  test("tool schema rejects missing url", () => {
    const parsed = tool!.inputSchema.safeParse({
      candidates: [{ source: "wikimedia", license: "CC0" }],
    });
    expect(parsed.success).toBe(false);
  });

  test("tool schema accepts optional confidenceThreshold", () => {
    const parsed = tool!.inputSchema.safeParse({
      candidates: [{ url: "https://example.com/a.jpg", source: "wikimedia", license: "CC0" }],
      confidenceThreshold: 0.7,
    });
    expect(parsed.success).toBe(true);
  });

  test("tool schema rejects confidenceThreshold > 1", () => {
    const parsed = tool!.inputSchema.safeParse({
      candidates: [{ url: "https://example.com/a.jpg", source: "wikimedia", license: "CC0" }],
      confidenceThreshold: 1.5,
    });
    expect(parsed.success).toBe(false);
  });

  test("handler returns structured plan with correct shape", async () => {
    const result = await tool!.handler({
      candidates: [
        { url: "https://example.com/a.jpg", source: "wikimedia", license: "CC0", confidence: 0.9 },
        { url: "https://example.com/b.jpg", source: "brave", license: "UNKNOWN", confidence: 0 },
      ],
    });

    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(typeof (result.content[0] as any).text).toBe("string");

    const sc = result.structuredContent as any;
    expect(sc.plan).toBeDefined();
    expect(sc.plan.confidenceGaps).toBeDefined();
    expect(sc.plan.upgradePath).toBeDefined();
    expect(sc.plan.summary).toBeDefined();
    expect(sc.plan.highConfidenceProviders).toBeDefined();
    expect(sc.probeResult).toBeNull();
  });

  test("handler text output mentions gap count", async () => {
    const result = await tool!.handler({
      candidates: [
        { url: "https://example.com/a.jpg", source: "brave", license: "UNKNOWN", confidence: 0 },
      ],
    });
    const text = (result.content[0] as any).text as string;
    expect(text).toContain("1/1");
  });

  test("handler includes probeResult note when candidateIndex has no sourcePageUrl", async () => {
    const result = await tool!.handler({
      candidates: [
        { url: "https://example.com/a.jpg", source: "brave", license: "UNKNOWN", confidence: 0 },
      ],
      candidateIndex: 0,
    });
    const sc = result.structuredContent as any;
    expect(sc.probeResult).not.toBeNull();
    expect(sc.probeResult.note).toContain("no sourcePageUrl");
  });

  test("handler probeResult is null when candidateIndex is not provided", async () => {
    const result = await tool!.handler({
      candidates: [
        { url: "https://example.com/a.jpg", source: "wikimedia", license: "CC0", confidence: 0.9 },
      ],
    });
    const sc = result.structuredContent as any;
    expect(sc.probeResult).toBeNull();
  });

  test("tool description mentions probe-page, upgrade-provider, fallback-to-open-only", () => {
    expect(tool!.description).toContain("probe-page");
    expect(tool!.description).toContain("upgrade-provider");
    expect(tool!.description).toContain("fallback-to-open-only");
  });
});
