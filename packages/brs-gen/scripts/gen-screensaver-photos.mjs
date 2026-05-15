#!/usr/bin/env node
// Deterministic generator for screensaver template's 8 sample JPEGs.
// 1920x1080 each, 8 distinct gradients with "Sample Photo N" text overlay.
// Sharp 0.34.5 pinned for determinism; if regeneration produces non-equal bytes
// across runs, switch to copyFile pattern (see Plan 4d play-icon precedent).

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);
const IMAGES = join(PKG_ROOT, 'templates', 'screensaver', 'files', 'images');

const PHOTOS = [
  { n: 1, top: '#1a3a8a', bot: '#0a1a4a' },
  { n: 2, top: '#2a8a3a', bot: '#0a4a1a' },
  { n: 3, top: '#8a3a2a', bot: '#4a0a0a' },
  { n: 4, top: '#7a2a8a', bot: '#3a0a4a' },
  { n: 5, top: '#8a7a2a', bot: '#4a3a0a' },
  { n: 6, top: '#2a7a8a', bot: '#0a3a4a' },
  { n: 7, top: '#5a5a5a', bot: '#1a1a1a' },
  { n: 8, top: '#8a4a6a', bot: '#3a1a2a' },
];

async function main() {
  await mkdir(IMAGES, { recursive: true });
  for (const p of PHOTOS) {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.top}" />
      <stop offset="1" stop-color="${p.bot}" />
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#g)" />
  <text x="960" y="600" text-anchor="middle" font-family="sans-serif" font-size="120" font-weight="700" fill="#FFFFFF" opacity="0.85">Sample Photo ${p.n}</text>
</svg>`;
    const file = `sample-photo-${p.n}.jpg`;
    await sharp(Buffer.from(svg))
      .jpeg({ quality: 82, mozjpeg: false, chromaSubsampling: '4:2:0' })
      .toFile(join(IMAGES, file));
    process.stdout.write(`wrote ${file}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`gen-screensaver-photos failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
