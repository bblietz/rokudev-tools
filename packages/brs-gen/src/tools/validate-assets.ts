import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseManifest } from './validate-manifest.js';
import { registerToolsModule } from './_register.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const ONE_MB = 1_048_576;

/** Keys in the Roku manifest that reference image asset paths. */
const ASSET_KEY_RE = /^(mm_icon_focus_.*|splash_screen_.*)$/;

/**
 * Strip a leading `pkg:/` prefix from a manifest image value, returning the
 * bare relative path suitable for `join(projectDir, strippedPath)`.
 */
function stripPkgPrefix(value: string): string {
  return value.startsWith('pkg:/') ? value.slice('pkg:/'.length) : value;
}

registerToolsModule((tools) => {
  tools.set('validate_assets', {
    name: 'validate_assets',
    description:
      'Checks manifest-referenced icon/splash images: each file must exist, '
      + 'start with PNG magic bytes (89 50 4E 47), and be smaller than 1 MB. '
      + 'Returns ok:true when all assets pass, or ok:false with details on '
      + 'missing / not_png / oversize files.',
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
        const payload = {
          ok: false as const,
          failure: {
            stage: 'validate' as const,
            code: 'ASSET_VALIDATION_FAILED' as const,
            message: reason,
            details: { missing: [], not_png: [], oversize: [], wrong_dimensions: [] },
          },
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
      }

      const parsed = parseManifest(manifestText);

      // 2. Collect asset paths referenced by matching keys.
      const assetPaths: string[] = [];
      for (const [key, value] of Object.entries(parsed)) {
        if (ASSET_KEY_RE.test(key) && value.trim().length > 0) {
          assetPaths.push(stripPkgPrefix(value.trim()));
        }
      }

      // 3. Validate each asset.
      const missing: string[] = [];
      const not_png: string[] = [];
      const oversize: string[] = [];

      for (const relPath of assetPaths) {
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

        // Check oversize first (we still need to read header for PNG check).
        if (fileSize >= ONE_MB) {
          oversize.push(relPath);
          // Even if oversize, still check PNG magic so caller gets full picture.
          // Read only the first 4 bytes.
          let header: Buffer;
          try {
            const fd = await import('node:fs').then((m) => m.promises.open(fullPath, 'r'));
            try {
              header = Buffer.alloc(4);
              await fd.read(header, 0, 4, 0);
            } finally {
              await fd.close();
            }
          } catch {
            // Can't read — treat as not-PNG as well? No: we already have
            // oversize. Per the spec, each path can appear in multiple arrays.
            // But the plan only defines separate arrays; if we can't read the
            // header we'll leave not_png alone (the file is already flagged).
            continue;
          }
          if (!header.slice(0, 4).equals(PNG_MAGIC)) {
            not_png.push(relPath);
          }
          continue;
        }

        // File is under 1 MB. Check PNG magic.
        let header: Buffer;
        try {
          header = await readFile(fullPath);
        } catch {
          missing.push(relPath);
          continue;
        }
        if (header.length < 4 || !header.slice(0, 4).equals(PNG_MAGIC)) {
          not_png.push(relPath);
        }
      }

      // 4. Build response.
      const totalFailures = missing.length + not_png.length + oversize.length;

      if (totalFailures === 0) {
        const payload = {
          ok: true as const,
          missing: [] as string[],
          oversize: [] as string[],
          wrong_dimensions: [] as string[],
        };
        return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
      }

      const payload = {
        ok: false as const,
        failure: {
          stage: 'validate' as const,
          code: 'ASSET_VALIDATION_FAILED' as const,
          message: `${totalFailures} asset(s) failed validation`,
          details: {
            missing,
            not_png,
            oversize,
            wrong_dimensions: [] as string[],
          },
        },
      };
      return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
    },
  });
});
