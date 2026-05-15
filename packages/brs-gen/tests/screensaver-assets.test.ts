import { describe, it, expect } from 'vitest';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = join(HERE, '..', 'templates', 'screensaver', 'files', 'images');

describe('screensaver assets', () => {
  it('all 8 sample-photo JPEGs exist and are non-empty', async () => {
    for (let i = 1; i <= 8; i++) {
      const s = await stat(join(IMAGES, `sample-photo-${i}.jpg`));
      expect(s.isFile()).toBe(true);
      expect(s.size).toBeGreaterThan(1024);
    }
  });

  it('all 8 JPEGs are 1920x1080 jpeg', async () => {
    for (let i = 1; i <= 8; i++) {
      const meta = await sharp(join(IMAGES, `sample-photo-${i}.jpg`)).metadata();
      expect(meta.width).toBe(1920);
      expect(meta.height).toBe(1080);
      expect(meta.format).toBe('jpeg');
    }
  });
});
