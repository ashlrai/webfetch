/**
 * XMP sidecar: structure, skip-when-empty, written-next-to-file.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { run } from "../src/commands.ts";
import { __setCoreForTests, core } from "../src/core.ts";
import { buildXmp, candidateToXmpFields, writeSidecar } from "../src/xmp.ts";

const originalCore = { ...core() };
let tmp: string;

beforeEach(async () => {
  tmp = resolve(tmpdir(), `webfetch-xmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tmp, { recursive: true });
});

afterEach(async () => {
  __setCoreForTests(originalCore);
  await rm(tmp, { recursive: true, force: true });
});

describe("buildXmp", () => {
  test("contains dc/cc/xmpRights fields with escaped values", () => {
    const xml = buildXmp({
      creator: "Jane <Doe>",
      rights: "© 2025 Jane",
      license: "CC_BY",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      usageTerms: "Credit required",
      webStatement: "https://example.com/photo",
      title: "A & B",
    });
    expect(xml).toContain("dc:creator");
    expect(xml).toContain("dc:rights");
    expect(xml).toContain("cc:license");
    expect(xml).toContain("xmpRights:UsageTerms");
    expect(xml).toContain("xmpRights:WebStatement");
    expect(xml).toContain("Jane &lt;Doe&gt;");
    expect(xml).toContain("A &amp; B");
    expect(xml).toContain("https://creativecommons.org/licenses/by/4.0/");
    expect(xml.trim().startsWith("<?xpacket")).toBe(true);
    expect(xml.trim().endsWith('<?xpacket end="w"?>')).toBe(true);
  });
});

describe("candidateToXmpFields", () => {
  test("maps ImageCandidate fields", () => {
    const f = candidateToXmpFields({
      author: "X",
      license: "CC0",
      attributionLine: "by X",
      sourcePageUrl: "https://s/",
    } as any);
    expect(f.creator).toBe("X");
    expect(f.license).toBe("CC0");
    expect(f.webStatement).toBe("https://s/");
  });
});

describe("writeSidecar", () => {
  test("writes .xmp next to image when attribution present", async () => {
    const imagePath = resolve(tmp, "photo.jpg");
    const out = await writeSidecar(imagePath, {
      url: imagePath,
      source: "wikimedia",
      license: "CC_BY" as any,
      author: "J. Doe",
      attributionLine: "Photo by J. Doe (CC BY)",
      sourcePageUrl: "https://commons.wikimedia.org/x",
    });
    expect(out).toBe(`${imagePath}.xmp`);
    expect(existsSync(out!)).toBe(true);
    const xml = await readFile(out!, "utf8");
    expect(xml).toContain("J. Doe");
    expect(xml).toContain("CC_BY");
    expect(xml).toContain("commons.wikimedia.org");
  });

  test("skips when no attribution data", async () => {
    const imagePath = resolve(tmp, "bare.jpg");
    const out = await writeSidecar(imagePath, { url: "x", source: "x", license: undefined as any });
    expect(out).toBeUndefined();
    expect(existsSync(`${imagePath}.xmp`)).toBe(false);
  });
});

describe("download writes sidecar by default; --no-sidecar opts out", () => {
  test("download + sidecar integration", async () => {
    const out = resolve(tmp, "img.jpg");
    __setCoreForTests({
      downloadImage: (async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        mime: "image/jpeg",
        sha256: "c".repeat(64),
        cachedPath: resolve(tmp, "cached"),
        license: "CC0",
        author: "Sidecar Test",
        attributionLine: "by Sidecar Test",
      })) as any,
    });
    const logs: string[] = [];
    const errs: string[] = [];
    const code = await run(["download", "https://example.com/a.jpg", "--out", out, "--json"], {
      stdout: (s) => logs.push(s),
      stderr: (s) => errs.push(s),
      env: { PATH: "/bin", WEBFETCH_CONFIG: "/nope" } as NodeJS.ProcessEnv,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(logs.join("\n"));
    expect(parsed.sidecar).toBe(`${out}.xmp`);
    const xml = await readFile(`${out}.xmp`, "utf8");
    expect(xml).toContain("Sidecar Test");
  });

  test("--no-sidecar disables writing", async () => {
    const out = resolve(tmp, "img2.jpg");
    __setCoreForTests({
      downloadImage: (async () => ({
        bytes: new Uint8Array([1]),
        mime: "image/jpeg",
        sha256: "d".repeat(64),
        cachedPath: resolve(tmp, "cached2"),
        license: "CC0",
        author: "x",
      })) as any,
    });
    const logs: string[] = [];
    const code = await run(
      ["download", "https://example.com/a.jpg", "--out", out, "--json", "--no-sidecar"],
      {
        stdout: (s) => logs.push(s),
        stderr: () => {},
        env: { PATH: "/bin", WEBFETCH_CONFIG: "/nope" } as NodeJS.ProcessEnv,
      },
    );
    expect(code).toBe(0);
    expect(existsSync(`${out}.xmp`)).toBe(false);
  });
});
