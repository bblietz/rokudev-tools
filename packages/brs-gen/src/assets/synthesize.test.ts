import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { synthesizeSolidPng } from './synthesize.js';

describe('synthesizeSolidPng — shape + error handling', () => {
  it('emits a PNG of the requested dimensions', async () => {
    const buf = await synthesizeSolidPng('#123456', 336, 218);
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(336);
    expect(meta.height).toBe(218);
  });

  it('throws ASSET_INVALID_COLOR for non-hex input', async () => {
    await expect(synthesizeSolidPng('not-a-hex', 10, 10)).rejects.toMatchObject({
      code: 'ASSET_INVALID_COLOR',
    });
  });

  it('throws ASSET_INVALID_COLOR for #RGB (3-digit) shorthand', async () => {
    await expect(synthesizeSolidPng('#abc', 10, 10)).rejects.toMatchObject({
      code: 'ASSET_INVALID_COLOR',
    });
  });
});

describe('synthesizeSolidPng — byte-determinism gate', () => {
  // This test pins the sharp version AND the output sha256 of a known
  // color+dimensions. It is darwin-arm64-only by design (see spec §9.1);
  // other platforms skip the sha256 branch with a warning but still run
  // the sharp-version assertion. If CI lands on a different platform,
  // either switch CI to macOS arm64 or extract the hash per-platform.
  it('has the pinned sharp version', () => {
    expect(sharp.versions.sharp).toBe('0.34.5');
  });

  it('produces a deterministic sha256 for a known color+dimensions', async () => {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      console.warn(
        `skipping sha256 gate on ${process.platform}/${process.arch} (pinned to darwin/arm64)`,
      );
      return;
    }
    const buf = await synthesizeSolidPng('#6F3FF5', 336, 218);
    const hash = createHash('sha256').update(buf).digest('hex');
    // PIN_REPLACE_ME is replaced in Step 7 with the actual hash captured
    // from the first successful synthesis on the dev machine.
    expect(hash).toBe('71a2461889d7c9728c33c392648544c3014331d0782f7e5cc5d4c5c431c29ba7');
  });
});
