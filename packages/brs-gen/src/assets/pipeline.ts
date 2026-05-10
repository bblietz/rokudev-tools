import sharp from 'sharp';
import { ICON_BUCKETS, SPLASH_BUCKETS, type Bucket } from './constants.js';

export type AssetKind = 'icon' | 'splash';

function bucketsFor(kind: AssetKind): readonly Bucket[] {
  return kind === 'icon' ? ICON_BUCKETS : SPLASH_BUCKETS;
}

/**
 * Produce one PNG buffer per bucket keyed by a project-relative path.
 * Keys take the form `<outputPrefix>_<bucket>.png` (e.g. `images/icon_hd.png`).
 *
 * Determinism: pinned kernel + compression options produce byte-identical
 * output on repeat runs on the same machine. Cross-machine determinism is
 * verified by `tests/determinism.test.ts`.
 */
export async function bucketAsset(
  source: Buffer,
  kind: AssetKind,
  outputPrefix: string,
): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const b of bucketsFor(kind)) {
    const buf = await sharp(source)
      .resize(b.width, b.height, { fit: 'cover', kernel: 'lanczos3' })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
    out.set(`${outputPrefix}_${b.bucket}.png`, buf);
  }
  return out;
}

/**
 * Map bucketed output paths to Roku manifest keys, with the `pkg:/` prefix
 * Roku requires at runtime. Keys sorted deterministically.
 */
export function manifestEntriesForBuckets(
  kind: AssetKind,
  outputPrefix: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of bucketsFor(kind)) {
    out[b.manifestKey] = `pkg:/${outputPrefix}_${b.bucket}.png`;
  }
  return out;
}
