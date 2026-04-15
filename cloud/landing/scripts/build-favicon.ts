/**
 * build-favicon.ts — generate a multi-resolution favicon.ico (16, 32, 48)
 * from the canonical "wf." SVG mark. Writes to src/app/favicon.ico so
 * Next.js serves it as the site root favicon.
 *
 * ICO format note: we embed PNG payloads (valid per the ICO spec since
 * Vista+) to keep each frame small and crisp. All modern browsers accept
 * PNG-in-ICO.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const SIZES = [16, 32, 48];

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0a0a0c"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
    font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, monospace"
    font-weight="800" font-size="34" fill="#ff5a1f" letter-spacing="-2">wf.</text>
</svg>`;

async function pngBuffer(size: number): Promise<Buffer> {
  return await sharp(Buffer.from(SVG))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function buildIco(pngs: { size: number; data: Buffer }[]): Buffer {
  // ICONDIR (6 bytes): reserved=0, type=1 (ICO), count
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirSize = 16 * count;
  const entries = Buffer.alloc(dirSize);
  const dataOffsetStart = 6 + dirSize;
  let offset = dataOffsetStart;
  const dataChunks: Buffer[] = [];

  pngs.forEach((p, i) => {
    const pos = i * 16;
    // width/height: 0 encodes 256
    entries.writeUInt8(p.size >= 256 ? 0 : p.size, pos + 0);
    entries.writeUInt8(p.size >= 256 ? 0 : p.size, pos + 1);
    entries.writeUInt8(0, pos + 2); // palette
    entries.writeUInt8(0, pos + 3); // reserved
    entries.writeUInt16LE(1, pos + 4); // planes
    entries.writeUInt16LE(32, pos + 6); // bpp
    entries.writeUInt32LE(p.data.length, pos + 8); // size
    entries.writeUInt32LE(offset, pos + 12); // offset
    dataChunks.push(p.data);
    offset += p.data.length;
  });

  return Buffer.concat([header, entries, ...dataChunks]);
}

async function run() {
  const pngs = await Promise.all(
    SIZES.map(async (size) => ({ size, data: await pngBuffer(size) })),
  );
  const ico = buildIco(pngs);
  const outDir = join(process.cwd(), "src", "app");
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "favicon.ico"), ico);
  // also drop one in /public for legacy linkers
  await writeFile(join(process.cwd(), "public", "favicon.ico"), ico);
  console.log(`favicon.ico built (${ico.length} bytes, ${SIZES.join("/")})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
