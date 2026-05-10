// packages/brs-gen/scripts/gen-plan4-fixtures.mjs
// Run once: `pnpm -C packages/brs-gen exec node scripts/gen-plan4-fixtures.mjs`
// Produces 4 deterministic PNG fixtures for Plan 4:
//   tests/__fixtures__/icon-uhd.png         (336x218)   unit tests
//   tests/__fixtures__/splash-uhd.png       (1920x1080) unit tests
//   scripts/fixtures/t27-icon-uhd.png       (3840x2160) T27 operator fixture
//   scripts/fixtures/t27-splash-uhd.png     (3840x2160) T27 operator fixture
//
// Deterministic: hand-rolled PNG encoder (same approach as gen-stub-pngs.mjs).
// We want small byte sizes; solid-color keeps DEFLATE small.
//
// After running, commit the 4 PNGs and this script.
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));

function crc32(buf) {
  let c;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function solidPng(width, height, r, g, b) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const base = y * (1 + width * 3);
    raw[base] = 0;
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3 + 0] = r;
      raw[base + 1 + x * 3 + 1] = g;
      raw[base + 1 + x * 3 + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const FIX = join(HERE, '..', 'tests', '__fixtures__');
const T27 = join(HERE, 'fixtures');
await mkdir(FIX, { recursive: true });
await mkdir(T27, { recursive: true });

// Unit fixtures: solid charcoal.
await writeFile(join(FIX, 'icon-uhd.png'), solidPng(336, 218, 30, 30, 30));
await writeFile(join(FIX, 'splash-uhd.png'), solidPng(1920, 1080, 30, 30, 30));

// T27 fixtures: clearly "test channel". Dark red icon, dark navy splash.
await writeFile(join(T27, 't27-icon-uhd.png'), solidPng(3840, 2160, 229, 9, 20));
await writeFile(join(T27, 't27-splash-uhd.png'), solidPng(3840, 2160, 10, 15, 45));

console.log('Wrote 4 Plan 4 fixture PNGs.');
