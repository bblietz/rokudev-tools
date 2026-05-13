import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function sha256OfFile(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  return createHash('sha256').update(buf).digest('hex');
}

describe('asset reuse: video_grid_channel <-> news_channel', () => {
  for (const filename of ['play-icon-light.png', 'play-icon-dark.png']) {
    it(`${filename} is byte-equal across both templates`, async () => {
      const vg = join(PKG_ROOT, 'templates/video_grid_channel/files/images', filename);
      const nc = join(PKG_ROOT, 'templates/news_channel/files/images', filename);
      const [a, b] = await Promise.all([sha256OfFile(vg), sha256OfFile(nc)]);
      expect(a).toEqual(b);
    });
  }
});
