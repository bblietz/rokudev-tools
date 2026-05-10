import { describe, it, expect } from 'vitest';
import { validateAssetSource } from './validate.js';

/** Minimal valid PNG: 8-byte sig + IHDR with the given width x height. */
function pngHeader(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR chunk: length=13, type='IHDR', data (13 bytes), crc(4 bytes).
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  const type = Buffer.from('IHDR', 'ascii');
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = 2; // color type RGB
  // CRC left zeroed; validate does not verify CRC.
  const crc = Buffer.alloc(4);
  return Buffer.concat([sig, len, type, data, crc]);
}

describe('validateAssetSource', () => {
  it('returns {width,height} on valid PNG meeting min', async () => {
    const buf = pngHeader(336, 218);
    const r = await validateAssetSource(
      buf,
      { min_width: 336, min_height: 218 },
      { field: 'branding.icon', path: '/some/path.png' },
    );
    expect(r).toEqual({ width: 336, height: 218 });
  });

  it('throws ASSET_VALIDATION_FAILED when not a PNG', async () => {
    const buf = Buffer.from('not a png at all!', 'ascii');
    await expect(
      validateAssetSource(buf, { min_width: 1, min_height: 1 }, { field: 'branding.icon' }),
    ).rejects.toMatchObject({ code: 'ASSET_VALIDATION_FAILED' });
  });

  it('throws ASSET_VALIDATION_FAILED + reason=source_too_small when under min', async () => {
    const buf = pngHeader(100, 100);
    await expect(
      validateAssetSource(
        buf,
        { min_width: 336, min_height: 218 },
        { field: 'branding.icon', path: '/p.png' },
      ),
    ).rejects.toMatchObject({
      code: 'ASSET_VALIDATION_FAILED',
      details: {
        reason: 'source_too_small',
        given: '100x100',
        required: '336x218',
        field: 'branding.icon',
      },
    });
  });

  it('failure details include field + path context', async () => {
    const buf = Buffer.from([0x00, 0x00]);
    try {
      await validateAssetSource(
        buf,
        { min_width: 1, min_height: 1 },
        { field: 'branding.splash', path: '/x/y.png' },
      );
      throw new Error('should have thrown');
    } catch (e) {
      const f = e as { code: string; details: Record<string, unknown> };
      expect(f.code).toBe('ASSET_VALIDATION_FAILED');
      expect(f.details.field).toBe('branding.splash');
      expect(f.details.path).toBe('/x/y.png');
    }
  });
});
