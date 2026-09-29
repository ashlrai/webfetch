/**
 * Agent pipeline recipe: illustrate a document with license-safe images.
 *
 * For each topic: search keyless providers with an `open-only` license policy,
 * take the top-ranked candidate, download it (SSRF-guarded, size-capped), and
 * record who made it and under which license. The output is an image folder
 * plus CREDITS.md and manifest.json that a writing agent can cite verbatim.
 *
 * Run from the repo root (after `bun install && bun run --cwd packages/core build`):
 *   bun examples/agent-pipeline/illustrate.ts "apollo 11" "saturn rings" --out ./illustrations
 */

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type Fetcher,
  type ImageCandidate,
  type LicensePolicy,
  type ProviderId,
  downloadImage,
  searchImages,
} from "webfetch-core";

/** Providers that need no API key, so the recipe works on a fresh machine. */
export const KEYLESS_PROVIDERS: ProviderId[] = ["wikimedia", "openverse", "nasa"];

export interface IllustrateOptions {
  outDir: string;
  providers?: ProviderId[];
  licensePolicy?: LicensePolicy;
  timeoutMs?: number;
  /** Injectable fetch, used by the test to run without network access. */
  fetcher?: Fetcher;
}

export interface IllustrationEntry {
  topic: string;
  file: string | null;
  license: string | null;
  source: string | null;
  sourcePageUrl: string | null;
  attribution: string | null;
  sha256: string | null;
  skippedReason?: string;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export function slugify(topic: string): string {
  return (
    topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "image"
  );
}

function attributionFor(c: ImageCandidate): string {
  if (c.attributionLine) return c.attributionLine;
  const who = c.author ? ` by ${c.author}` : "";
  return `${c.title ?? "Image"}${who} (${c.source}), ${c.license}${c.sourcePageUrl ? ` — ${c.sourcePageUrl}` : ""}`;
}

export async function illustrate(
  topics: string[],
  opts: IllustrateOptions,
): Promise<IllustrationEntry[]> {
  const outDir = resolve(opts.outDir);
  mkdirSync(outDir, { recursive: true });
  const entries: IllustrationEntry[] = [];

  for (const topic of topics) {
    const bundle = await searchImages(topic, {
      providers: opts.providers ?? KEYLESS_PROVIDERS,
      licensePolicy: opts.licensePolicy ?? "open-only",
      maxPerProvider: 5,
      timeoutMs: opts.timeoutMs ?? 10_000,
      fetcher: opts.fetcher,
    });

    let entry: IllustrationEntry = {
      topic,
      file: null,
      license: null,
      source: null,
      sourcePageUrl: null,
      attribution: null,
      sha256: null,
      skippedReason: "no candidate passed the license policy",
    };

    // Candidates arrive ranked license-first; try the next one if a download fails.
    for (const candidate of bundle.candidates.slice(0, 3)) {
      try {
        const dl = await downloadImage(candidate.url, {
          fetcher: opts.fetcher,
          cacheDir: join(outDir, ".cache"),
        });
        const file = `${slugify(topic)}.${EXT[dl.mime] ?? "img"}`;
        copyFileSync(dl.cachedPath, join(outDir, file));
        entry = {
          topic,
          file,
          license: candidate.license,
          source: candidate.source,
          sourcePageUrl: candidate.sourcePageUrl ?? null,
          attribution: attributionFor(candidate),
          sha256: dl.sha256,
        };
        break;
      } catch (err) {
        entry.skippedReason = `download failed: ${(err as Error).message}`;
      }
    }
    entries.push(entry);
  }

  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(entries, null, 2)}\n`);
  const credits = [
    "# Image credits",
    "",
    ...entries.map((e) =>
      e.file ? `- \`${e.file}\`: ${e.attribution}` : `- ${e.topic}: no image (${e.skippedReason})`,
    ),
    "",
  ].join("\n");
  writeFileSync(join(outDir, "CREDITS.md"), credits);
  return entries;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : "./illustrations";
  const topics = args.filter((_, i) => i !== outIdx && i !== outIdx + 1);
  if (topics.length === 0 || !outDir) {
    console.error(
      'usage: bun examples/agent-pipeline/illustrate.ts "<topic>" ["<topic>" ...] [--out DIR]',
    );
    process.exit(2);
  }
  const entries = await illustrate(topics, { outDir });
  for (const e of entries) {
    console.log(
      e.file
        ? `ok   ${e.topic} -> ${e.file} [${e.license}]`
        : `skip ${e.topic}: ${e.skippedReason}`,
    );
  }
  console.log(`\nWrote ${resolve(outDir, "CREDITS.md")} and manifest.json`);
  if (entries.every((e) => !e.file)) process.exit(1);
}
