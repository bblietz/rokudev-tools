import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { bucketAsset, manifestEntriesForBuckets } from './pipeline.js';
import { ICON_BUCKETS, SPLASH_BUCKETS } from './constants.js';

async function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0x20, g: 0x20, b: 0x20 },
    },
  })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

describe('bucketAsset', () => {
  it('produces one buffer per icon bucket at exact dimensions', async () => {
    const src = await solidPng(400, 300);
    const out = await bucketAsset(src, 'icon', 'images/icon');
    expect([...out.keys()].sort()).toEqual(['images/icon_fhd.png', 'images/icon_hd.png']);
    for (const b of ICON_BUCKETS) {
      const buf = out.get(`images/icon_${b.bucket}.png`)!;
      const meta = await sharp(buf).metadata();
      expect(meta.width).toBe(b.width);
      expect(meta.height).toBe(b.height);
      expect(meta.format).toBe('png');
    }
  });

  it('produces three buffers for splash', async () => {
    const src = await solidPng(3840, 2160);
    const out = await bucketAsset(src, 'splash', 'images/splash');
    expect([...out.keys()].sort()).toEqual([
      'images/splash_fhd.png',
      'images/splash_hd.png',
      'images/splash_uhd.png',
    ]);
    for (const b of SPLASH_BUCKETS) {
      const buf = out.get(`images/splash_${b.bucket}.png`)!;
      const meta = await sharp(buf).metadata();
      expect(meta.width).toBe(b.width);
      expect(meta.height).toBe(b.height);
    }
  });

  it('is byte-deterministic across two in-process runs', async () => {
    const src = await solidPng(3840, 2160);
    const a = await bucketAsset(src, 'splash', 'images/splash');
    const b = await bucketAsset(src, 'splash', 'images/splash');
    for (const k of a.keys()) {
      expect(a.get(k)!.equals(b.get(k)!)).toBe(true);
    }
  });
});

describe('manifestEntriesForBuckets', () => {
  it('maps icon buckets to pkg:/ paths', () => {
    const entries = manifestEntriesForBuckets('icon', 'images/icon');
    expect(entries).toEqual({
      mm_icon_focus_hd: 'pkg:/images/icon_hd.png',
      mm_icon_focus_fhd: 'pkg:/images/icon_fhd.png',
    });
  });

  it('maps splash buckets to pkg:/ paths', () => {
    const entries = manifestEntriesForBuckets('splash', 'images/splash');
    expect(entries).toEqual({
      splash_screen_hd: 'pkg:/images/splash_hd.png',
      splash_screen_fhd: 'pkg:/images/splash_fhd.png',
      splash_screen_uhd: 'pkg:/images/splash_uhd.png',
    });
  });
});
