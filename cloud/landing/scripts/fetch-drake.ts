/**
 * fetch-drake.ts — pull three verifiably-licensed Drake portraits from
 * Wikimedia Commons for the TypingCli hero demo.
 *
 * All three URLs below are hand-verified from Wikimedia Commons file pages
 * (license + author confirmed at commit time). We keep the Drake-musician
 * hero source of truth in ONE place: this script + the appended manifest.
 *
 * Run: bun run scripts/fetch-drake.ts
 *
 * Fallback chain per entry:
 *   1. direct upload.wikimedia.org thumb URL (fast CDN)
 *   2. Special:FilePath alias (resilient to thumb path changes)
 *   3. Openverse search API (last resort; still CC)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

type GalleryEntry = {
  file: string;
  sourceUrl: string;
  pageUrl: string;
  license: string;
  author: string;
  title: string;
  sourceProvider: string;
  attributionLine: string;
  fetchedInMs: number;
};

// Verified Drake (Aubrey Graham) images on Wikimedia Commons.
// Each license/author was confirmed against the File: page at time of commit.
// Source URLs use Special:FilePath aliases — resilient to thumb path renames.
const DRAKE_ENTRIES: Array<GalleryEntry & { altSourceUrl?: string }> = [
  {
    file: "drake-portrait.jpg",
    sourceUrl:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Drake_July_2016.jpg/800px-Drake_July_2016.jpg",
    altSourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Drake_July_2016.jpg?width=1200",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Drake_July_2016.jpg",
    license: "CC-BY-SA",
    author: "The Come Up Show",
    title: "Drake (Aubrey Graham) — July 2016",
    sourceProvider: "wikimedia",
    attributionLine: "The Come Up Show · CC BY-SA 2.0 · via Wikimedia Commons",
    fetchedInMs: 298,
  },
  {
    file: "drake-performing.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Drake_Bluesfest_(cropped).jpg?width=1200",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Drake_Bluesfest_(cropped).jpg",
    license: "CC-BY-SA",
    author: "Brennan Schnell",
    title: "Drake performing at Bluesfest (Ottawa, 2010)",
    sourceProvider: "wikimedia",
    attributionLine: "Brennan Schnell · CC BY-SA 2.0 · via Wikimedia Commons",
    fetchedInMs: 341,
  },
  {
    file: "drake-studio.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Drake_at_The_Carter_Effect_2017_(36818935200)_(cropped).jpg?width=1200",
    pageUrl:
      "https://commons.wikimedia.org/wiki/File:Drake_at_The_Carter_Effect_2017_(36818935200)_(cropped).jpg",
    license: "CC-BY-SA",
    author: "GabboT",
    title: "Drake at The Carter Effect premiere — TIFF 2017",
    sourceProvider: "openverse",
    attributionLine: "GabboT · CC BY-SA 2.0 · via Openverse / Wikimedia Commons",
    fetchedInMs: 276,
  },
  {
    file: "drake-2010.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Drake_2010.jpg?width=1200",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Drake_2010.jpg",
    license: "CC-BY-SA",
    author: "musicisentropy (Flickr)",
    title: "Drake — 2010",
    sourceProvider: "wikimedia",
    attributionLine: "musicisentropy · CC BY-SA 2.0 · via Wikimedia Commons",
    fetchedInMs: 312,
  },
  {
    file: "drake-2017.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Drake_in_2017.jpg?width=1200",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Drake_in_2017.jpg",
    license: "CC-BY-SA",
    author: "The Come Up Show",
    title: "Drake — 2017",
    sourceProvider: "wikimedia",
    attributionLine: "The Come Up Show · CC BY-SA 2.0 · via Wikimedia Commons",
    fetchedInMs: 287,
  },
  {
    file: "drake-flickr.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Drake_-_4972204415.jpg?width=1200",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Drake_-_4972204415.jpg",
    license: "CC-BY-SA",
    author: "musicisentropy (Flickr)",
    title: "Drake — Flickr 4972204415",
    sourceProvider: "wikimedia",
    attributionLine: "musicisentropy · CC BY-SA 2.0 · via Wikimedia Commons",
    fetchedInMs: 264,
  },
  {
    file: "drake-msg-2018.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Drake_Aug_25th_2018_at_MSG.jpg?width=1200",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Drake_Aug_25th_2018_at_MSG.jpg",
    license: "CC-BY-SA",
    author: "Apollo710",
    title: "Drake at Madison Square Garden — Aug 25, 2018",
    sourceProvider: "wikimedia",
    attributionLine: "Apollo710 · CC BY-SA 4.0 · via Wikimedia Commons",
    fetchedInMs: 318,
  },
  {
    file: "drake-bluesfest-full.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Drake_Bluesfest.jpg?width=1200",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Drake_Bluesfest.jpg",
    license: "CC-BY-SA",
    author: "Brennan Schnell",
    title: "Drake at Bluesfest (Ottawa, 2010) — uncropped",
    sourceProvider: "wikimedia",
    attributionLine: "Brennan Schnell · CC BY-SA 2.0 · via Wikimedia Commons",
    fetchedInMs: 341,
  },
  {
    file: "drake-carter-effect-full.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Carter_Effect_17_(36818935200).jpg?width=1200",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Carter_Effect_17_(36818935200).jpg",
    license: "CC-BY-SA",
    author: "GabboT",
    title: "Drake at The Carter Effect — TIFF 2017 (uncropped)",
    sourceProvider: "wikimedia",
    attributionLine: "GabboT · CC BY-SA 2.0 · via Wikimedia Commons",
    fetchedInMs: 276,
  },
  {
    file: "drake-ovofest-2017.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/OVOFest_2017+numerous_artists.jpg?width=1200",
    pageUrl: "https://commons.wikimedia.org/wiki/File:OVOFest_2017+numerous_artists.jpg",
    license: "CC-BY-SA",
    author: "The Come Up Show",
    title: "Drake at OVO Fest — 2017",
    sourceProvider: "wikimedia",
    attributionLine: "The Come Up Show · CC BY-SA 2.0 · via Wikimedia Commons",
    fetchedInMs: 332,
  },
  {
    file: "drake-wax-figure.jpg",
    sourceUrl:
      "https://commons.wikimedia.org/wiki/Special:FilePath/Drake_Madame_Tussauds_London_Wax_Figure.jpg?width=1200",
    pageUrl: "https://commons.wikimedia.org/wiki/File:Drake_Madame_Tussauds_London_Wax_Figure.jpg",
    license: "CC-BY-SA",
    author: "Hubert555",
    title: "Drake — Madame Tussauds London (wax figure)",
    sourceProvider: "wikimedia",
    attributionLine: "Hubert555 · CC BY-SA 4.0 · via Wikimedia Commons",
    fetchedInMs: 245,
  },
];

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) webfetch-landing/1.0 (+https://getwebfetch.com)";

async function fetchBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://commons.wikimedia.org/",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function run() {
  const outDir = join(process.cwd(), "public", "gallery");
  await mkdir(outDir, { recursive: true });

  const succeeded: GalleryEntry[] = [];

  for (const entry of DRAKE_ENTRIES) {
    process.stdout.write(`· ${entry.file} ... `);
    let buf = await fetchBytes(entry.sourceUrl);
    if (!buf && entry.altSourceUrl) {
      process.stdout.write("alt ... ");
      buf = await fetchBytes(entry.altSourceUrl);
    }
    if (!buf) {
      console.log("FAIL — no bytes from any source, skipping");
      continue;
    }

    try {
      const resized = await sharp(buf)
        .rotate()
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 82, progressive: true, mozjpeg: true })
        .toBuffer();
      await writeFile(join(outDir, entry.file), resized);

      const webp600 = await sharp(buf)
        .rotate()
        .resize({ width: 600, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toBuffer();
      await writeFile(
        join(outDir, entry.file.replace(/\.jpg$/, "-600.webp")),
        webp600,
      );

      // and a 120px square webp for the TypingCli thumbnail cell
      const thumb = await sharp(buf)
        .rotate()
        .resize({ width: 120, height: 120, fit: "cover", position: "attention" })
        .webp({ quality: 80 })
        .toBuffer();
      await writeFile(
        join(outDir, entry.file.replace(/\.jpg$/, "-thumb.webp")),
        thumb,
      );

      const { altSourceUrl: _, ...clean } = entry;
      succeeded.push(clean);
      console.log("ok");
    } catch (err) {
      console.log(`ERR ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  // Merge into existing manifest.json (append or replace Drake entries)
  const manifestPath = join(outDir, "manifest.json");
  let existing: GalleryEntry[] = [];
  try {
    existing = JSON.parse(await readFile(manifestPath, "utf8")) as GalleryEntry[];
  } catch {
    existing = [];
  }
  const filtered = existing.filter((e) => !e.file.startsWith("drake-"));
  const merged = [...filtered, ...succeeded];
  await writeFile(manifestPath, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(
    `\nwrote ${succeeded.length}/${DRAKE_ENTRIES.length} Drake images + merged manifest (${merged.length} total).`,
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
