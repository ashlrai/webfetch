import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RealImageGalleryClient, type GalleryItem } from "./RealImageGalleryClient";

const SITE = "https://getwebfetch.com";

async function loadManifest(): Promise<GalleryItem[]> {
  try {
    const p = join(process.cwd(), "public", "gallery", "manifest.json");
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as GalleryItem[];
  } catch {
    return [];
  }
}

function licenseUrl(license: string): string | undefined {
  const up = license.toUpperCase();
  if (up.includes("CC0")) return "https://creativecommons.org/publicdomain/zero/1.0/";
  if (up.includes("PUBLIC")) return "https://en.wikipedia.org/wiki/Public_domain";
  if (up.includes("CC-BY-SA") || up.includes("CC BY-SA"))
    return "https://creativecommons.org/licenses/by-sa/4.0/";
  if (up.includes("CC-BY") || up.includes("CC BY"))
    return "https://creativecommons.org/licenses/by/4.0/";
  return undefined;
}

function buildCollectionLd(items: GalleryItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Real images, real licenses — webfetch gallery",
    description:
      "A live gallery of public-domain and Creative Commons images fetched through webfetch. Every entry is license-stamped with full attribution and a link back to the origin.",
    url: `${SITE}/#gallery`,
    hasPart: items.map((it) => {
      const lic = licenseUrl(it.license);
      return {
        "@type": "ImageObject",
        name: it.title,
        contentUrl: `${SITE}/gallery/${it.file}`,
        thumbnailUrl: `${SITE}/gallery/${it.file.replace(/\.jpg$/, "-600.webp")}`,
        creator: { "@type": "Person", name: it.author },
        creditText: it.attributionLine,
        copyrightNotice: it.attributionLine,
        license: lic,
        acquireLicensePage: it.pageUrl,
        isAccessibleForFree: true,
        provider: {
          "@type": "Organization",
          name: it.sourceProvider,
        },
      };
    }),
  };
}

export async function RealImageGallery() {
  const items = await loadManifest();
  if (items.length === 0) return null;
  const collectionLd = buildCollectionLd(items);
  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionLd) }}
      />
      <RealImageGalleryClient items={items} />
    </>
  );
}
