#!/usr/bin/env bun
/**
 * Rasterizes scripts/og-image.svg into public/og-image.png at 1200x630.
 *
 * Run: bun run cloud/landing/scripts/build-og.ts
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = join(here, "og-image.svg");
const outPath = join(here, "..", "public", "og-image.png");

const svg = readFileSync(svgPath);

await sharp(svg, { density: 192 })
  .resize(1200, 630, { fit: "fill" })
  .png({ compressionLevel: 9, quality: 95, palette: false })
  .toFile(outPath);

const meta = await sharp(outPath).metadata();
console.log(`wrote ${outPath} (${meta.width}x${meta.height}, ${meta.size} bytes)`);
