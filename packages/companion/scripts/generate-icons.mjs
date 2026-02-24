#!/usr/bin/env node
/**
 * Generate ForgeAI Companion icons from the SVG source.
 * Uses sharp to render forge-icon.svg into PNG and ICO at all required sizes.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'src-tauri', 'icons');
const svgPath = join(iconsDir, 'forge-icon.svg');

if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });

/** Create ICO file from a 32x32 PNG buffer */
function createICO(png32) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = 32;
  entry[1] = 32;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png32.length, 8);
  entry.writeUInt32LE(22, 12);

  return Buffer.concat([header, entry, png32]);
}

console.log('Generating ForgeAI Companion icons from SVG...');

const svgBuffer = readFileSync(svgPath);

const sizes = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
  { name: 'tray-icon.png', size: 32 },
];

for (const { name, size } of sizes) {
  const png = await sharp(svgBuffer, { density: Math.round(72 * size / 32) })
    .resize(size, size)
    .png()
    .toBuffer();
  writeFileSync(join(iconsDir, name), png);
  console.log(`  ✓ ${name} (${size}x${size})`);
}

// ICO from 32x32 PNG
const png32 = await sharp(svgBuffer, { density: 72 })
  .resize(32, 32)
  .png()
  .toBuffer();
const ico = createICO(png32);
writeFileSync(join(iconsDir, 'icon.ico'), ico);
console.log('  ✓ icon.ico');

console.log('Done!');
