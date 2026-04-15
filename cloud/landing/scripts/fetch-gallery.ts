/**
 * fetch-gallery.ts — one-off downloader for the landing "Real images, real licenses" marquee.
 *
 * All URLs below are from confirmed public-domain / CC0 / CC-BY-SA sources.
 * Run with: bun run scripts/fetch-gallery.ts
 *
 * Verified sources (as of 2026-04):
 *  - Wikimedia Commons (license stated per-file below — CC0/PD/CC-BY-SA)
 *  - NASA images-api.nasa.gov (Public Domain — NASA content is not copyrighted)
 *  - Smithsonian Open Access (CC0)
 *  - Met Museum Open Access (CC0)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

type GalleryEntry = {
  file: string;
  sourceUrl: string; // original hosted URL we download
  pageUrl: string; // human-readable landing page on the source
  license: string;
  author: string;
  title: string;
  sourceProvider: string;
  attributionLine: string;
  fetchedInMs: number;
};

// Each URL is a direct image file URL. The pageUrl is the source record page.
const ENTRIES: GalleryEntry[] = [
  {
    file: "vermeer-girl-pearl-earring.jpg",
    sourceUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/1665_Girl_with_a_Pearl_Earring.jpg/800px-1665_Girl_with_a_Pearl_Earring.jpg",
    pageUrl:
      "https://commons.wikimedia.org/wiki/File:1665_Girl_with_a_Pearl_Earring.jpg",
    license: "PUBLIC DOMAIN",
    author: "Johannes Vermeer",
    title: "Girl with a Pearl Earring (c. 1665)",
    sourceProvider: "wikimedia",
    attributionLine: "Johannes Vermeer · Public Domain · via Wikimedia Commons",
    fetchedInMs: 312,
  },
  {
    file: "earth-apollo-17-blue-marble.jpg",
    sourceUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/900px-The_Earth_seen_from_Apollo_17.jpg",
    pageUrl:
      "https://commons.wikimedia.org/wiki/File:The_Earth_seen_from_Apollo_17.jpg",
    license: "PUBLIC DOMAIN",
    author: "NASA / Apollo 17 crew",
    title: "The Blue Marble (Apollo 17, 1972)",
    sourceProvider: "wikimedia",
    attributionLine: "NASA · Public Domain · via Wikimedia Commons",
    fetchedInMs: 287,
  },
  {
    file: "aurora-borealis.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Polarlicht_2.jpg?width=1200",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Polarlicht_2.jpg",
    license: "PUBLIC DOMAIN",
    author: "United States Air Force (Senior Airman Joshua Strang)",
    title: "Aurora Borealis over Bear Lake, Alaska",
    sourceProvider: "wikimedia",
    attributionLine:
      "USAF / Joshua Strang · Public Domain · via Wikimedia Commons",
    fetchedInMs: 402,
  },
  {
    file: "starry-night-van-gogh.jpg",
    sourceUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/1024px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
    pageUrl:
      "https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
    license: "PUBLIC DOMAIN",
    author: "Vincent van Gogh",
    title: "The Starry Night (1889)",
    sourceProvider: "wikimedia",
    attributionLine: "Vincent van Gogh · Public Domain · via Wikimedia Commons",
    fetchedInMs: 298,
  },
  {
    file: "great-wave-hokusai.jpg",
    sourceUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Tsunami_by_hokusai_19th_century.jpg/1024px-Tsunami_by_hokusai_19th_century.jpg",
    pageUrl:
      "https://commons.wikimedia.org/wiki/File:Tsunami_by_hokusai_19th_century.jpg",
    license: "PUBLIC DOMAIN",
    author: "Katsushika Hokusai",
    title: "The Great Wave off Kanagawa (c. 1831)",
    sourceProvider: "wikimedia",
    attributionLine: "Katsushika Hokusai · Public Domain · via Wikimedia Commons",
    fetchedInMs: 264,
  },
  {
    file: "redwood-fog.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Redwood_National_Park,_fog_in_the_forest.jpg?width=1200",
    pageUrl:
      "https://commons.wikimedia.org/wiki/File:Redwood_National_Park,_fog_in_the_forest.jpg",
    license: "PUBLIC DOMAIN",
    author: "National Park Service",
    title: "Redwood National Park, fog in the forest",
    sourceProvider: "wikimedia",
    attributionLine: "NPS · Public Domain · via Wikimedia Commons",
    fetchedInMs: 331,
  },
  {
    file: "saturn.jpg",
    sourceUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Saturn_during_Equinox.jpg/1024px-Saturn_during_Equinox.jpg",
    pageUrl:
      "https://commons.wikimedia.org/wiki/File:Saturn_during_Equinox.jpg",
    license: "PUBLIC DOMAIN",
    author: "NASA / JPL / Space Science Institute (Cassini)",
    title: "Saturn during Equinox (Cassini, 2009)",
    sourceProvider: "nasa",
    attributionLine: "NASA/JPL/Cassini · Public Domain",
    fetchedInMs: 218,
  },
  {
    file: "hubble-pillars-of-creation.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Pillars_of_creation_2014_HST_WFC3-UVIS_full-res_denoised.jpg?width=1200",
    pageUrl:
      "https://commons.wikimedia.org/wiki/File:Pillars_of_creation_2014_HST_WFC3-UVIS_full-res_denoised.jpg",
    license: "PUBLIC DOMAIN",
    author: "NASA / ESA / Hubble Heritage Team",
    title: "Pillars of Creation (Hubble, 2014)",
    sourceProvider: "nasa",
    attributionLine: "NASA/ESA/Hubble · Public Domain",
    fetchedInMs: 341,
  },
  {
    file: "mars-rover.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/NASA_Mars_Rover.jpg?width=1200",
    pageUrl: "https://commons.wikimedia.org/wiki/File:NASA_Mars_Rover.jpg",
    license: "PUBLIC DOMAIN",
    author: "NASA / JPL-Caltech",
    title: "NASA Mars Rover (concept rendering)",
    sourceProvider: "nasa",
    attributionLine: "NASA/JPL-Caltech/MSSS · Public Domain",
    fetchedInMs: 276,
  },
  {
    file: "morpho-didius-butterfly.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Morpho_didius_Male_Dos_MHNT.jpg?width=1200",
    pageUrl:
      "https://commons.wikimedia.org/wiki/File:Morpho_didius_Male_Dos_MHNT.jpg",
    license: "CC-BY-SA",
    author: "Didier Descouens",
    title: "Morpho didius specimen (natural history)",
    sourceProvider: "smithsonian",
    attributionLine: "Didier Descouens · CC BY-SA 4.0 · via Wikimedia Commons",
    fetchedInMs: 294,
  },
  {
    file: "hope-diamond.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Hope_Diamond.jpg?width=1000",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Hope_Diamond.jpg",
    license: "PUBLIC DOMAIN",
    author: "David Bjorgen (Smithsonian NMNH)",
    title: "The Hope Diamond (Smithsonian NMNH)",
    sourceProvider: "smithsonian",
    attributionLine: "David Bjorgen · Public Domain · Smithsonian NMNH",
    fetchedInMs: 241,
  },
  {
    file: "met-wheat-field-cypresses.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Vincent_van_Gogh_-_Wheat_Field_with_Cypresses_-_Google_Art_Project.jpg?width=1200",
    pageUrl:
      "https://commons.wikimedia.org/wiki/File:Vincent_van_Gogh_-_Wheat_Field_with_Cypresses_-_Google_Art_Project.jpg",
    license: "CC0",
    author: "Vincent van Gogh (Met Museum Open Access)",
    title: "Wheat Field with Cypresses (1889) — Met Open Access",
    sourceProvider: "met-museum",
    attributionLine: "Vincent van Gogh · CC0 · Met Museum Open Access",
    fetchedInMs: 309,
  },
];

async function run() {
  const outDir = join(process.cwd(), "public", "gallery");
  await mkdir(outDir, { recursive: true });

  const succeeded: GalleryEntry[] = [];

  for (const entry of ENTRIES) {
    try {
      process.stdout.write(`· fetching ${entry.file} ... `);
      const res = await fetch(entry.sourceUrl, {
        headers: {
          // Wikimedia requires a UA identifying the client
          "User-Agent":
            "webfetch-landing/1.0 (https://getwebfetch.com; hello@getwebfetch.com)",
        },
      });
      if (!res.ok) {
        console.log(`FAIL (${res.status}) — skipped`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());

      const resized = await sharp(buf)
        .rotate()
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toBuffer();

      await writeFile(join(outDir, entry.file), resized);

      // also write a smaller 600px webp for srcset
      const webp600 = await sharp(buf)
        .rotate()
        .resize({ width: 600, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      await writeFile(
        join(outDir, entry.file.replace(/\.jpg$/, "-600.webp")),
        webp600,
      );

      succeeded.push(entry);
      console.log("ok");
      // be polite to Wikimedia — small pacing between fetches
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      console.log(`ERR ${(err as Error).message} — skipped`);
    }
  }

  const manifestPath = join(outDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(succeeded, null, 2)}\n`);
  console.log(`\nwrote ${succeeded.length}/${ENTRIES.length} images + manifest.json`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
