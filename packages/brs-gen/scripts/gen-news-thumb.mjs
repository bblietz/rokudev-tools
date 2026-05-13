// Generates the deterministic 1280x720 dark gradient PNG used as
// templates/news_channel/files/images/live-thumb-placeholder.png.
//
// Deterministic on the same OS/arch (sharp 0.34.5 + libvips lanczos3 +
// PNG compressionLevel 9 + adaptiveFiltering false). Run once during
// implementation to author the asset; thereafter the file is checked
// into git. Re-run only if the gradient design intentionally changes.
//
// Usage:
//   node packages/brs-gen/scripts/gen-news-thumb.mjs

import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(
  HERE,
  '..',
  'templates',
  'news_channel',
  'files',
  'images',
  'live-thumb-placeholder.png',
);

const W = 1280;
const H = 720;

// Pre-compute pixel buffer: vertical gradient from #1d2a4a (top) to #0c1320 (bottom).
const buf = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  const r = Math.round(0x1d * (1 - t) + 0x0c * t);
  const g = Math.round(0x2a * (1 - t) + 0x13 * t);
  const b = Math.round(0x4a * (1 - t) + 0x20 * t);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
  }
}

const png = await sharp(buf, { raw: { width: W, height: H, channels: 4 } })
  .png({ compressionLevel: 9, palette: false, adaptiveFiltering: false })
  .toBuffer();

await writeFile(OUT, png);
console.log(`Wrote ${png.length} bytes -> ${OUT}`);
