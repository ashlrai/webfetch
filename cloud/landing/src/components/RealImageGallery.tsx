import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RealImageGalleryClient, type GalleryItem } from "./RealImageGalleryClient";

async function loadManifest(): Promise<GalleryItem[]> {
  try {
    const p = join(process.cwd(), "public", "gallery", "manifest.json");
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as GalleryItem[];
  } catch {
    return [];
  }
}

export async function RealImageGallery() {
  const items = await loadManifest();
  if (items.length === 0) return null;
  return <RealImageGalleryClient items={items} />;
}
