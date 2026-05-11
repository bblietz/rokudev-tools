import sharp from 'sharp';
import { fail } from '@rokudev/device-client';

/**
 * Synthesize a solid-color source PNG at the given dimensions.
 *
 * Deterministic contract:
 * - Given the exact pinned sharp version (patch-level match, see pin in
 *   packages/brs-gen/package.json) + identical {width, height, color},
 *   output bytes are byte-equal on the same OS/arch.
 * - Determinism across OS/arch is NOT guaranteed; asserted only by the
 *   darwin-arm64-gated sha256 test in synthesize.test.ts. If libvips
 *   variance ever breaks this, switch to static PNGs per-template.
 *
 * Pinned params (DO NOT CHANGE without regenerating goldens):
 *   create: { width, height, channels: 4, background: hexToRgba(color) }
 *   png:    { compressionLevel: 9, palette: false, adaptiveFiltering: false }
 */
export async function synthesizeSolidPng(
  color: string,
  width: number,
  height: number,
): Promise<Buffer> {
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
    throw fail(
      'ASSET_INVALID_COLOR',
      `color must match /^#[0-9A-Fa-f]{6}$/; got ${JSON.stringify(color)}`,
      { color },
    );
  }
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  try {
    return await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r, g, b, alpha: 1 },
      },
    })
      .png({ compressionLevel: 9, palette: false, adaptiveFiltering: false })
      .toBuffer();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw fail('ASSET_SYNTHESIS_FAILED', `sharp failed to synthesize PNG: ${msg}`, {
      color,
      width,
      height,
    });
  }
}
