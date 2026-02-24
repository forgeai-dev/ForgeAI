#!/usr/bin/env node
/**
 * Generate minimal valid icon files for Tauri build.
 * Creates PNG (32x32, 128x128, 256x256) and ICO files.
 * No external dependencies — pure Node.js Buffer manipulation.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'src-tauri', 'icons');

if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });

import { deflateSync } from 'zlib';

// ForgeAI brand color: indigo #6366f1
const R = 99, G = 102, B = 241, A = 255;

/** Create a minimal ICO file from a 32x32 PNG */
function createICO(png32) {
  // ICO header: reserved(2) + type(2) + count(2)
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: ICO
  header.writeUInt16LE(1, 4); // 1 image

  // ICO directory entry (16 bytes)
  const entry = Buffer.alloc(16);
  entry[0] = 32;  // width
  entry[1] = 32;  // height
  entry[2] = 0;   // color palette
  entry[3] = 0;   // reserved
  entry.writeUInt16LE(1, 4);  // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png32.length, 8);  // size of PNG data
  entry.writeUInt32LE(22, 12); // offset to PNG data (6 + 16 = 22)

  return Buffer.concat([header, entry, png32]);
}

function createPNGSync(width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const rawRow = Buffer.alloc(1 + width * 4);
  rawRow[0] = 0;
  for (let x = 0; x < width; x++) {
    const off = 1 + x * 4;
    rawRow[off] = R;
    rawRow[off + 1] = G;
    rawRow[off + 2] = B;
    rawRow[off + 3] = A;
  }
  const rawData = Buffer.concat(Array(height).fill(rawRow));
  const compressed = deflateSync(rawData);

  function crc32(buf) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type);
    const crcVal = Buffer.alloc(4);
    crcVal.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
    return Buffer.concat([len, typeB, data, crcVal]);
  }

  return Buffer.concat([
    sig,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

console.log('Generating ForgeAI Companion icons...');

const png32 = createPNGSync(32, 32);
const png128 = createPNGSync(128, 128);
const png256 = createPNGSync(256, 256);
const ico = createICO(png32);

writeFileSync(join(iconsDir, '32x32.png'), png32);
writeFileSync(join(iconsDir, '128x128.png'), png128);
writeFileSync(join(iconsDir, '128x128@2x.png'), png256);
writeFileSync(join(iconsDir, 'icon.ico'), ico);
writeFileSync(join(iconsDir, 'tray-icon.png'), png32);

console.log('  ✓ 32x32.png');
console.log('  ✓ 128x128.png');
console.log('  ✓ 128x128@2x.png');
console.log('  ✓ icon.ico');
console.log('  ✓ tray-icon.png');
console.log('Done!');
