// One-shot verification for v0.4.2's DetailsScene leak fix.
//
// Pre-req: channel is already sideloaded (e.g. via t27-video-grid.mjs).
// We launch dev, wait for feed, navigate to a tile, enter Details, press
// Back, screenshot. The Back screenshot should match the row screenshot
// (i.e. the overlay was actually removed).
//
// Usage:
//   ROKUDEV_HOST=10.128.161.203 ROKUDEV_DEV_PASSWORD=1234 \
//   TZ=UTC node packages/brs-gen/scripts/v042-back-from-details.mjs

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keypress, screenshotNoError, sleep } from './_t27-lib.mjs';
import { EcpControl } from '@rokudev/device-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);

const host = process.env.ROKUDEV_HOST;
const password = process.env.ROKUDEV_DEV_PASSWORD || '1234';
if (!host) {
  console.error('ROKUDEV_HOST required.');
  process.exit(2);
}

const iso = new Date().toISOString().replace(/[:.]/g, '-');
const screensDir = join(PKG_ROOT, 'scripts', 't27-screenshots', `v042-${iso}`);
await mkdir(screensDir, { recursive: true });

const ecp = new EcpControl(host);

// Launch already-installed dev channel.
await ecp.launch('dev', {});
await sleep(5000);

await screenshotNoError(host, password, join(screensDir, '01-home.png'));

// Navigate to first row, second tile.
await keypress(host, 'Down');
await sleep(400);
await keypress(host, 'Right');
await sleep(400);

await screenshotNoError(host, password, join(screensDir, '02-row.png'));

// Enter details.
await keypress(host, 'Select');
await sleep(1000);
await screenshotNoError(host, password, join(screensDir, '03-details.png'));

// Back out of details (THIS is the v0.4.2 fix path).
await keypress(host, 'Back');
await sleep(800);
await screenshotNoError(host, password, join(screensDir, '04-after-back.png'));

// Re-enter details to confirm no stacking.
await keypress(host, 'Select');
await sleep(1000);
await screenshotNoError(host, password, join(screensDir, '05-details-again.png'));

// Back again.
await keypress(host, 'Back');
await sleep(800);
await screenshotNoError(host, password, join(screensDir, '06-after-back-again.png'));

console.log('Screenshots written to', screensDir);
console.log('Expected: 04-after-back and 06-after-back-again look like 02-row');
console.log('         (i.e. row visible, no details overlay).');
