#!/usr/bin/env bun
/**
 * Emits three placeholder PNGs (16/48/128) of a solid dark-blue square so
 * Chrome accepts the manifest. Hand-rolled PNG encoder — no dependencies.
 *
 * Replace with a real icon later.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

const COLOR = { r: 0x1d, g: 0x4e, b: 0xd8, a: 0xff }; // indigo-600

function makePng(size: number): Uint8Array {
  const row = new Uint8Array(1 + size * 4);
  for (let x = 0; x < size; x++) {
    row[1 + x * 4 + 0] = COLOR.r;
    row[1 + x * 4 + 1] = COLOR.g;
    row[1 + x * 4 + 2] = COLOR.b;
    row[1 + x * 4 + 3] = COLOR.a;
  }
  const raw = new Uint8Array(row.length * size);
  for (let y = 0; y < size; y++) raw.set(row, y * row.length);
  const idat = deflateSync(raw);

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, size);
  dv.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const chunks: Uint8Array[] = [
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array()),
  ];
  return concat(chunks);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const crcInput = concat([typeBytes, data]);
  const c = crc32(crcInput);
  const crcB = new Uint8Array(4);
  new DataView(crcB.buffer).setUint32(0, c);
  return concat([len, typeBytes, data, crcB]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const dir = join(import.meta.dir, "icons");
mkdirSync(dir, { recursive: true });
for (const size of [16, 48, 128]) {
  const png = makePng(size);
  await Bun.write(join(dir, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png (${png.length} bytes)`);
}
