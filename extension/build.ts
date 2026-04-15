#!/usr/bin/env bun
/**
 * Build script: bundles each entry point (background, content/sidebar, popup, options)
 * as ESM browser modules into dist/, then copies manifest + static assets.
 *
 * MV3 requires service_worker "type":"module" — we keep each entry isolated
 * so Chrome can load them independently.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const root = import.meta.dir;
const out = join(root, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const entries: Record<string, string> = {
  "background.js": "src/background.ts",
  "content/sidebar.js": "src/content/sidebar.ts",
  "popup/popup.js": "src/popup/popup.ts",
  "options/options.js": "src/options/options.ts",
};

for (const [outName, entry] of Object.entries(entries)) {
  const outPath = join(out, outName);
  mkdirSync(dirname(outPath), { recursive: true });
  const res = await Bun.build({
    entrypoints: [join(root, entry)],
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "none",
  });
  if (!res.success) {
    console.error(res.logs);
    process.exit(1);
  }
  const artifact = res.outputs[0]!;
  const text = await artifact.text();
  await Bun.write(outPath, text);
  console.log(`built ${outName} (${text.length} bytes)`);
}

// static copies
cpSync(join(root, "manifest.json"), join(out, "manifest.json"));
cpSync(join(root, "src/popup/popup.html"), join(out, "popup/popup.html"));
cpSync(join(root, "src/popup/popup.css"), join(out, "popup/popup.css"));
cpSync(join(root, "src/options/options.html"), join(out, "options/options.html"));
cpSync(join(root, "src/content/sidebar.html"), join(out, "content/sidebar.html"));
cpSync(join(root, "src/content/sidebar.css"), join(out, "content/sidebar.css"));

const iconsDir = join(root, "icons");
if (!existsSync(join(iconsDir, "icon-16.png"))) {
  console.log("icons missing — run `bun run icons` first.");
} else {
  cpSync(iconsDir, join(out, "icons"), { recursive: true });
}

console.log(`\ndone -> ${out}`);
