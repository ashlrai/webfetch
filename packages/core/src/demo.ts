/**
 * Demo script — dry-run `searchArtistImages("Drake", "portrait")` and print
 * which providers would be hit, plus a realistic synthetic result set.
 *
 * Run: `bun run demo` from repo root.
 */

import { searchArtistImages, pickBest } from "./index.ts";
import type { ImageCandidate } from "./types.ts";

async function main() {
  const name = process.argv[2] ?? "Drake";
  const kind = (process.argv[3] as any) ?? "portrait";
  console.log(`webfetch-mcp demo: searchArtistImages(${JSON.stringify(name)}, ${JSON.stringify(kind)})\n`);

  const dry = await searchArtistImages(name, kind, { dryRun: true });
  console.log("providers that would be hit:");
  for (const r of dry.providerReports) console.log(`  - ${r.provider}`);
  console.log();

  // Synthetic result set to show the shape of a real response.
  const synthetic: ImageCandidate[] = [
    {
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/example.jpg/1600px-example.jpg",
      thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/example.jpg/320px-example.jpg",
      width: 1600,
      height: 2000,
      source: "wikimedia",
      sourcePageUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      title: `${name} at an event`,
      author: "Jane Photog",
      license: "CC_BY_SA",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      confidence: 0.95,
      attributionLine: `"${name} at an event" by Jane Photog (Wikimedia Commons), licensed CC BY-SA 4.0 — https://commons.wikimedia.org/wiki/File:Example.jpg`,
    },
    {
      url: "https://i.scdn.co/image/abcd",
      width: 640,
      height: 640,
      source: "spotify",
      sourcePageUrl: "https://open.spotify.com/artist/abcd",
      title: name,
      author: name,
      license: "EDITORIAL_LICENSED",
      confidence: 0.8,
      attributionLine: `"${name}" (Spotify), licensed Editorial Use (platform-licensed)`,
    },
  ];

  console.log("sample candidates (synthetic, for shape):");
  console.log(JSON.stringify(synthetic, null, 2));

  const best = pickBest(synthetic);
  console.log("\npickBest =>", best ? `${best.source} (${best.license})` : "none");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
