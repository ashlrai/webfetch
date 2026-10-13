/**
 * Hermetic test for the agent-pipeline recipe: every network call goes through
 * a stub fetcher, so this runs offline in CI.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { illustrate, slugify } from "./illustrate.ts";

// 1x1 transparent PNG.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

function wikimediaPage(id: number, file: string, license: string | null, artist: string) {
  const extmetadata: Record<string, { value: string }> = {
    ImageDescription: { value: file },
    Artist: { value: artist },
  };
  if (license) extmetadata.LicenseShortName = { value: license };
  return {
    pageid: id,
    title: `File:${file}`,
    imageinfo: [
      {
        url: `https://upload.wikimedia.org/wikipedia/commons/${file}`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`,
        extmetadata,
        width: 1200,
        height: 800,
      },
    ],
  };
}

const requested: string[] = [];
const stubFetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  requested.push(url);
  const host = new URL(url).hostname;
  if (host === "commons.wikimedia.org") {
    const q =
      new URL(url).searchParams.get("gsrsearch") ?? new URL(url).searchParams.get("srsearch") ?? "";
    if (q.includes("nothing")) {
      // Only an unlicensed result: open-only must refuse it.
      return Response.json({
        query: { pages: { "9": wikimediaPage(9, "mystery.png", null, "Unknown") } },
      });
    }
    return Response.json({
      query: { pages: { "1": wikimediaPage(1, "Red_panda.png", "CC0", "Jane Photog") } },
    });
  }
  if (host === "upload.wikimedia.org") {
    return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
  }
  return new Response("{}", { status: 503 });
}) as unknown as typeof fetch;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  requested.length = 0;
});

describe("agent-pipeline recipe", () => {
  test("slugify makes safe file names", () => {
    expect(slugify("Apollo 11: Moon landing!")).toBe("apollo-11-moon-landing");
    expect(slugify("???")).toBe("image");
  });

  test("downloads an open-licensed image and writes credits + manifest", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "webfetch-illustrate-"));
    dirs.push(outDir);
    const entries = await illustrate(["red panda", "nothing licensed"], {
      outDir,
      providers: ["wikimedia"],
      fetcher: stubFetch,
      timeoutMs: 2_000,
    });

    expect(entries).toHaveLength(2);
    const [ok, skipped] = entries;
    expect(ok?.file).toBe("red-panda.png");
    expect(ok?.license).toBe("CC0");
    expect(ok?.attribution).toContain("Jane Photog");
    expect(readFileSync(join(outDir, "red-panda.png"))).toEqual(Buffer.from(PNG));

    // The unlicensed candidate is filtered by the open-only policy, never downloaded.
    expect(skipped?.file).toBeNull();
    expect(requested.some((u) => u.includes("mystery.png"))).toBe(false);

    const credits = readFileSync(join(outDir, "CREDITS.md"), "utf8");
    expect(credits).toContain("`red-panda.png`");
    expect(credits).toContain("nothing licensed: no image");
    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    expect(manifest[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(outDir, "nothing-licensed.png"))).toBe(false);
  });
});
