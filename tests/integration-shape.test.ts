import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWebfetchAction } from "../integrations/github-action/run.ts";
import {
  _resetTelemetry,
  computeProviderRecommendations,
  emitProviderEvent,
} from "../packages/core/src/federation-telemetry.ts";
import { _resetBuckets, getBucket } from "../packages/core/src/rate-limit.ts";

const ROOT = join(import.meta.dir, "..");
const tempDirs: string[] = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "webfetch-action-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("integration manifests", () => {
  test("GitHub Action delegates search and download to the tracked script", () => {
    const action = readFileSync(join(ROOT, "integrations/github-action/action.yml"), "utf8");
    expect(action).toContain('bun "$GITHUB_ACTION_PATH/run.ts"');
    expect(action).toContain('--webfetch-bin "$WEBFETCH_BIN"');
    expect(action).not.toContain('bun - "$RESULTS"');
    expect(action).not.toContain("write manifest deterministically");
  });

  test("GitHub Action script downloads candidates and preserves manifest metadata", () => {
    const dir = makeTempDir();
    const stubBin = join(dir, "stub-webfetch.ts");
    writeFileSync(
      stubBin,
      `
        import { writeFileSync } from "node:fs";
        const [command, ...args] = Bun.argv.slice(2);
        if (command === "search") {
          console.log(JSON.stringify([
            {
              url: "https://example.test/image.png?size=large",
              provider: "stub",
              attributionLine: "Photo by Stub"
            },
            {
              url: "https://example.test/skipped.jpg",
              provider: "stub",
              attributionLine: "Skipped"
            }
          ]));
        } else if (command === "download") {
          const url = args[0];
          if (url.includes("skipped")) {
            console.error("intentional failure");
            process.exit(2);
          }
          const out = args[args.indexOf("--out") + 1];
          writeFileSync(out, "fake image");
          console.log(JSON.stringify({
            path: out,
            sha256: "abc123",
            mime: "image/png",
            bytes: 10,
            cachedPath: "/tmp/cache/image.png",
            sidecar: out + ".xmp"
          }));
        }
      `,
    );

    const outDir = join(dir, "out");
    const result = runWebfetchAction({
      query: "stub image",
      outDir,
      license: "safe-only",
      providers: "stub",
      maxPerProvider: "2",
      limit: "2",
      minWidth: "640",
      minHeight: "480",
      webfetchBin: stubBin,
    });

    const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
    expect(result.count).toBe(1);
    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({
      file: join(outDir, "001.png"),
      path: join(outDir, "001.png"),
      sha256: "abc123",
      mime: "image/png",
      byteSize: 10,
      cachedPath: "/tmp/cache/image.png",
      sidecar: join(outDir, "001.png.xmp"),
      attributionPath: join(outDir, "001.png.attribution.txt"),
      candidate: {
        url: "https://example.test/image.png?size=large",
        provider: "stub",
        attributionLine: "Photo by Stub",
      },
    });
    expect(readFileSync(join(outDir, "001.png.attribution.txt"), "utf8")).toBe("Photo by Stub\n");
    expect(JSON.parse(readFileSync(result.searchPath, "utf8"))).toHaveLength(2);
  });

  test("Docker image starts the TypeScript CLI by default", () => {
    const dockerfile = readFileSync(join(ROOT, "docker/Dockerfile"), "utf8");
    const entrypoint = readFileSync(join(ROOT, "docker/entrypoint.sh"), "utf8");
    expect(dockerfile).toContain('CMD ["cli", "--help"]');
    expect(entrypoint).toContain("exec node /app/packages/cli/dist/index.js");
  });
});

// ---------------------------------------------------------------------------
// Federation Diagnostics Dashboard: provider_recommendations integration tests
// ---------------------------------------------------------------------------

describe("provider_recommendations — shape and actionability", () => {
  // Reset BEFORE each test too: this suite asserts on an empty telemetry window,
  // so it must not inherit events recorded by earlier test files in the run.
  beforeEach(() => {
    _resetTelemetry();
    _resetBuckets();
  });

  afterEach(() => {
    _resetTelemetry();
    _resetBuckets();
  });

  test("empty window returns valid structure with all four enhanced fields", () => {
    const recs = computeProviderRecommendations();

    // Core fields
    expect(Array.isArray(recs.rankedProviders)).toBe(true);
    expect(Array.isArray(recs.suggestedFallbackChain)).toBe(true);
    expect(typeof recs.windowMs).toBe("number");
    expect(typeof recs.generatedAt).toBe("number");

    // Enhanced field 1: performanceInsights
    expect(Array.isArray(recs.performanceInsights)).toBe(true);

    // Enhanced field 2: licenseCoverageHeatmap
    expect(recs.licenseCoverageHeatmap).toBeDefined();
    expect(Array.isArray(recs.licenseCoverageHeatmap.byOpenness)).toBe(true);
    // mostOpen/mostUnknown are null when no providers have data
    expect(recs.licenseCoverageHeatmap.mostOpen).toBeNull();
    expect(recs.licenseCoverageHeatmap.mostUnknown).toBeNull();

    // Enhanced field 3: perQueryAdvice
    expect(Array.isArray(recs.perQueryAdvice)).toBe(true);
    expect(recs.perQueryAdvice.length).toBeGreaterThan(0);
    const portraitsAdvice = recs.perQueryAdvice.find((a) => a.category === "portraits");
    expect(portraitsAdvice).toBeDefined();
    expect(Array.isArray(portraitsAdvice!.recommendedProviders)).toBe(true);
    expect(typeof portraitsAdvice!.rationale).toBe("string");
    expect(portraitsAdvice!.rationale.length).toBeGreaterThan(0);

    // Enhanced field 4: costBenefitAnalysis
    expect(Array.isArray(recs.costBenefitAnalysis)).toBe(true);
  });

  test("performanceInsights are generated for providers with data in window", () => {
    const now = Date.now();
    // Emit events for two providers with different latencies
    emitProviderEvent({
      providerId: "wikimedia",
      startedAt: now - 100,
      endedAt: now,
      durationMs: 100,
      resultCount: 5,
      ok: true,
      errorKind: "ok",
      payloadBytes: 512,
    });
    emitProviderEvent({
      providerId: "bing",
      startedAt: now - 2000,
      endedAt: now,
      durationMs: 2000,
      resultCount: 3,
      ok: true,
      errorKind: "ok",
      payloadBytes: 256,
    });

    const recs = computeProviderRecommendations();
    expect(recs.performanceInsights.length).toBe(2);

    const wikiInsight = recs.performanceInsights.find((p) => p.providerId === "wikimedia");
    const bingInsight = recs.performanceInsights.find((p) => p.providerId === "bing");
    expect(wikiInsight).toBeDefined();
    expect(bingInsight).toBeDefined();

    // wikimedia should be noted as faster (relativeLatency < 1)
    expect(wikiInsight!.relativeLatency).toBeLessThan(1);
    // bing should be noted as slower (relativeLatency > 1)
    expect(bingInsight!.relativeLatency).toBeGreaterThan(1);

    // summaries should be non-empty strings
    expect(typeof wikiInsight!.summary).toBe("string");
    expect(wikiInsight!.summary.length).toBeGreaterThan(0);
    expect(typeof bingInsight!.summary).toBe("string");
  });

  test("performanceInsights include error-rate narrative for degraded provider", () => {
    const now = Date.now();
    // Emit 1 success + 4 failures for bing → 80% error rate
    emitProviderEvent({
      providerId: "bing",
      startedAt: now - 500,
      endedAt: now,
      durationMs: 500,
      resultCount: 2,
      ok: true,
      errorKind: "ok",
      payloadBytes: 256,
    });
    for (let i = 0; i < 4; i++) {
      emitProviderEvent({
        providerId: "bing",
        startedAt: now - 500,
        endedAt: now,
        durationMs: 500,
        resultCount: 0,
        ok: false,
        errorKind: "timeout",
        payloadBytes: 0,
      });
    }

    const recs = computeProviderRecommendations();
    const bingInsight = recs.performanceInsights.find((p) => p.providerId === "bing");
    expect(bingInsight).toBeDefined();
    // Summary should reference the error rate
    expect(bingInsight!.summary).toMatch(/80%|error/i);
    expect(bingInsight!.errorRate).toBeCloseTo(0.8, 1);
  });

  test("licenseCoverageHeatmap identifies most-open and most-unknown providers", () => {
    const now = Date.now();
    // Emit events for wikimedia (high open fraction) and bing (high unknown fraction)
    emitProviderEvent({
      providerId: "wikimedia",
      startedAt: now - 200,
      endedAt: now,
      durationMs: 200,
      resultCount: 8,
      ok: true,
      errorKind: "ok",
      payloadBytes: 1024,
    });
    emitProviderEvent({
      providerId: "bing",
      startedAt: now - 300,
      endedAt: now,
      durationMs: 300,
      resultCount: 5,
      ok: true,
      errorKind: "ok",
      payloadBytes: 512,
    });

    const recs = computeProviderRecommendations();
    const heatmap = recs.licenseCoverageHeatmap;

    // mostOpen should be wikimedia (openFraction=0.95 vs bing=0.10)
    expect(heatmap.mostOpen).toBe("wikimedia");
    // mostUnknown should be bing (unknownFraction=0.70 vs wikimedia=0.03)
    expect(heatmap.mostUnknown).toBe("bing");

    // byOpenness should be sorted: wikimedia before bing
    const wikiIdx = heatmap.byOpenness.findIndex((e) => e.providerId === "wikimedia");
    const bingIdx = heatmap.byOpenness.findIndex((e) => e.providerId === "bing");
    expect(wikiIdx).toBeLessThan(bingIdx);

    // Each entry has required fields
    for (const entry of heatmap.byOpenness) {
      expect(typeof entry.openFraction).toBe("number");
      expect(entry.openFraction).toBeGreaterThanOrEqual(0);
      expect(entry.openFraction).toBeLessThanOrEqual(1);
      expect(typeof entry.unknownFraction).toBe("number");
      expect(typeof entry.note).toBe("string");
      expect(entry.note.length).toBeGreaterThan(0);
    }
  });

  test("perQueryAdvice covers portraits and album_art categories with actionable providers", () => {
    const recs = computeProviderRecommendations();

    const portraitsAdvice = recs.perQueryAdvice.find((a) => a.category === "portraits");
    expect(portraitsAdvice).toBeDefined();
    expect(portraitsAdvice!.recommendedProviders.length).toBeGreaterThan(0);
    expect(portraitsAdvice!.rationale).toMatch(/wikimedia|spotify|portrait/i);

    const albumAdvice = recs.perQueryAdvice.find((a) => a.category === "album_art");
    expect(albumAdvice).toBeDefined();
    expect(albumAdvice!.recommendedProviders.length).toBeGreaterThan(0);
    expect(albumAdvice!.rationale).toMatch(/musicbrainz|itunes|spotify|album/i);
  });

  test("perQueryAdvice excludes saturated providers from recommendations", () => {
    // Saturate wikimedia bucket
    const bucket = getBucket("wikimedia");
    for (let i = 0; i < 30; i++) bucket.tryTake();

    const now = Date.now();
    emitProviderEvent({
      providerId: "wikimedia",
      startedAt: now - 100,
      endedAt: now,
      durationMs: 100,
      resultCount: 0,
      ok: false,
      errorKind: "rate-limited",
      payloadBytes: 0,
    });

    const recs = computeProviderRecommendations();
    const portraitsAdvice = recs.perQueryAdvice.find((a) => a.category === "portraits");
    expect(portraitsAdvice).toBeDefined();
    // wikimedia is saturated so should be excluded from active recommendations
    expect(portraitsAdvice!.recommendedProviders).not.toContain("wikimedia");
  });

  test("costBenefitAnalysis entries have required fields and actionable verdicts", () => {
    const now = Date.now();
    emitProviderEvent({
      providerId: "smithsonian",
      startedAt: now - 2000,
      endedAt: now,
      durationMs: 2000,
      resultCount: 3,
      ok: true,
      errorKind: "ok",
      payloadBytes: 512,
    });
    emitProviderEvent({
      providerId: "serpapi",
      startedAt: now - 300,
      endedAt: now,
      durationMs: 300,
      resultCount: 10,
      ok: true,
      errorKind: "ok",
      payloadBytes: 1024,
    });

    const recs = computeProviderRecommendations();

    const smithsonianEntry = recs.costBenefitAnalysis.find((e) => e.providerId === "smithsonian");
    const serpapiEntry = recs.costBenefitAnalysis.find((e) => e.providerId === "serpapi");

    expect(smithsonianEntry).toBeDefined();
    expect(smithsonianEntry!.isPaid).toBe(false);
    expect(smithsonianEntry!.licenseProfile).toMatch(/CC0|public.domain/i);
    expect(smithsonianEntry!.verdict.length).toBeGreaterThan(0);
    expect(smithsonianEntry!.currentStatus).toBe("healthy");

    expect(serpapiEntry).toBeDefined();
    expect(serpapiEntry!.isPaid).toBe(true);
    expect(serpapiEntry!.coversGaps).toBe(true);
    expect(serpapiEntry!.verdict.length).toBeGreaterThan(0);
  });

  test("costBenefitAnalysis verdict includes current health context for degraded provider", () => {
    const now = Date.now();
    // 1 success + 4 failures → degraded
    emitProviderEvent({
      providerId: "bing",
      startedAt: now - 500,
      endedAt: now,
      durationMs: 500,
      resultCount: 2,
      ok: true,
      errorKind: "ok",
      payloadBytes: 256,
    });
    for (let i = 0; i < 4; i++) {
      emitProviderEvent({
        providerId: "bing",
        startedAt: now - 500,
        endedAt: now,
        durationMs: 500,
        resultCount: 0,
        ok: false,
        errorKind: "timeout",
        payloadBytes: 0,
      });
    }

    const recs = computeProviderRecommendations();
    const bingEntry = recs.costBenefitAnalysis.find((e) => e.providerId === "bing");
    expect(bingEntry).toBeDefined();
    expect(bingEntry!.currentStatus).toBe("degraded");
    // Verdict should note the degradation
    expect(bingEntry!.verdict).toMatch(/DEGRADED|degraded|error rate/i);
  });

  test("recommendations are actionable: ranked providers have rank field and score in [0,1]", () => {
    const now = Date.now();
    const providers = ["wikimedia", "unsplash", "pexels"] as const;
    for (const pid of providers) {
      emitProviderEvent({
        providerId: pid,
        startedAt: now - 200,
        endedAt: now,
        durationMs: 200,
        resultCount: 5,
        ok: true,
        errorKind: "ok",
        payloadBytes: 512,
      });
    }

    const recs = computeProviderRecommendations();
    expect(recs.rankedProviders.length).toBe(3);

    for (const r of recs.rankedProviders) {
      expect(r.rank).toBeGreaterThanOrEqual(1);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(["healthy", "degraded", "saturated", "unavailable"]).toContain(r.status);
    }

    // Ranks should be sequential 1-based integers
    const ranks = recs.rankedProviders.map((r) => r.rank).sort((a, b) => a - b);
    expect(ranks).toEqual([1, 2, 3]);
  });
});
