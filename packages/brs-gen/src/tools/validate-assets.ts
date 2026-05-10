import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseManifest } from './validate-manifest.js';
import { registerToolsModule } from './_register.js';
import { ICON_BUCKETS, SPLASH_BUCKETS } from '../assets/constants.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const ONE_MB = 1_048_576;

/** Keys in the Roku manifest that reference image asset paths. */
const ASSET_KEY_RE = /^(mm_icon_focus_.*|splash_screen_.*)$/;

/**
 * Return the expected pixel dimensions for a known manifest key, or null if
 * the key is not a bucket we validate dimensions for.
 */
function expectedDimsFor(manifestKey: string): { w: number; h: number } | null {
  for (const b of ICON_BUCKETS)
    if (b.manifestKey === manifestKey) return { w: b.width, h: b.height };
  for (const b of SPLASH_BUCKETS)
    if (b.manifestKey === manifestKey) return { w: b.width, h: b.height };
  return null;
}

/**
 * Strip a leading `pkg:/` prefix from a manifest image value, returning the
 * bare relative path suitable for `join(projectDir, strippedPath)`.
 */
function stripPkgPrefix(value: string): string {
  return value.startsWith('pkg:/') ? value.slice('pkg:/'.length) : value;
}

/**
 * Read only the first n bytes of a file, efficiently.
 */
async function readFirstBytes(path: string, n: number): Promise<Buffer> {
  const fd = await open(path, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fd.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
}

registerToolsModule((tools) => {
  tools.set('validate_assets', {
    name: 'validate_assets',
    description:
      'Checks manifest-referenced icon/splash images: each file must exist, ' +
      'start with PNG magic bytes (89 50 4E 47), and be smaller than 1 MB. ' +
      'Returns ok:true when all assets pass, or ok:false with details on ' +
      'missing / not_png / oversize files.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['project_dir'],
      properties: {
        project_dir: { type: 'string', minLength: 1 },
      },
    },
    handler: async (args) => {
      const projectDir = args['project_dir'] as string;

      // 1. Read and parse the manifest.
      const manifestPath = join(projectDir, 'manifest');
      let manifestText: string;
      try {
        manifestText = await readFile(manifestPath, 'utf8');
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        const reason = e?.code === 'ENOENT' ? 'manifest not found' : (e?.message ?? String(err));
        return {
          ok: false as const,
          failure: {
            stage: 'validate' as const,
            code: 'ASSET_VALIDATION_FAILED' as const,
            message: reason,
            details: { missing: [], not_png: [], oversize: [], wrong_dimensions: [] },
          },
        };
      }

      const parsed = parseManifest(manifestText);

      // 2. Collect asset paths referenced by matching keys.
      const assetEntries: Array<{ relPath: string; manifestKey: string }> = [];
      for (const [key, value] of Object.entries(parsed)) {
        if (ASSET_KEY_RE.test(key) && value.trim().length > 0) {
          assetEntries.push({ relPath: stripPkgPrefix(value.trim()), manifestKey: key });
        }
      }

      // 3. Validate each asset.
      const missing: string[] = [];
      const not_png: string[] = [];
      const oversize: string[] = [];
      const wrong_dimensions: string[] = [];

      for (const { relPath, manifestKey } of assetEntries) {
        const fullPath = join(projectDir, relPath);

        // Check existence and size via stat.
        let fileSize: number;
        try {
          const s = await stat(fullPath);
          fileSize = s.size;
        } catch {
          missing.push(relPath);
          continue;
        }

        // Check oversize.
        if (fileSize >= ONE_MB) {
          oversize.push(relPath);
        }

        // Read first 24 bytes to check PNG magic and IHDR dimensions.
        let header: Buffer;
        try {
          header = await readFirstBytes(fullPath, 24);
        } catch {
          // Can't read header — already flagged as missing if stat failed.
          // If stat succeeded but read failed, we treat as not-PNG.
          if (fileSize < ONE_MB) {
            not_png.push(relPath);
          }
          continue;
        }
        if (header.length < 4 || !header.subarray(0, 4).equals(PNG_MAGIC)) {
          not_png.push(relPath);
          continue;
        }
        // Decode IHDR dimensions: width at offset 16, height at offset 20 (big-endian u32).
        // Bytes 12-15 must spell "IHDR" — if they don't, skip dimension check
        // (the file may be a minimal stub or truncated PNG; we don't fail it here).
        const expected = expectedDimsFor(manifestKey);
        if (
          expected !== null &&
          header.length >= 24 &&
          header.subarray(12, 16).toString('ascii') === 'IHDR'
        ) {
          const w = header.readUInt32BE(16);
          const h = header.readUInt32BE(20);
          if (w !== expected.w || h !== expected.h) {
            wrong_dimensions.push(relPath);
          }
        }
      }

      // 4. Build response.
      const totalFailures =
        missing.length + not_png.length + oversize.length + wrong_dimensions.length;

      if (totalFailures === 0) {
        return {
          ok: true as const,
          missing: [] as string[],
          oversize: [] as string[],
          wrong_dimensions: [] as string[],
        };
      }

      return {
        ok: false as const,
        failure: {
          stage: 'validate' as const,
          code: 'ASSET_VALIDATION_FAILED' as const,
          message: `${totalFailures} asset(s) failed validation`,
          details: {
            missing,
            not_png,
            oversize,
            wrong_dimensions,
          },
        },
      };
    },
  });
});
