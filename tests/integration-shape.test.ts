import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWebfetchAction } from "../integrations/github-action/run.ts";

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
