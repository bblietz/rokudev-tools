import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from '@rokudev/device-client';
import { registerToolsModule } from './_register.js';

/**
 * Parse a Roku manifest file (key=value, one per line).
 *
 * Rules:
 *  - Lines are trimmed.
 *  - Blank lines and lines starting with `#` are skipped.
 *  - Each remaining line is split on the first `=`; left is the key (trimmed),
 *    right is the value (no extra trimming beyond the newline stripping that
 *    comes from the split). Lines with no `=` are skipped (lenient).
 *  - Last write wins on duplicate keys.
 */
export function parseManifest(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    out[key] = value;
  }
  return out;
}

registerToolsModule((tools) => {
  tools.set('validate_manifest', {
    name: 'validate_manifest',
    description:
      'Reads project_dir/manifest and project_dir/.rokudev-tools/provenance.json, ' +
      'parses both, and cross-checks manifest keys against the provenance key list. ' +
      'Drift (keys that appear in one but not the other) is reported as a ' +
      'MANIFEST_DRIFT warning (non-fatal). Missing files are MANIFEST_VALIDATION_FAILED ' +
      'failures.',
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

      // 1. Read and parse manifest.
      const manifestPath = join(projectDir, 'manifest');
      let manifestText: string;
      try {
        manifestText = await readFile(manifestPath, 'utf8');
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e?.code === 'ENOENT') {
          throw fail('MANIFEST_VALIDATION_FAILED', `manifest not found: ${manifestPath}`, {
            project_dir: projectDir,
            missing: 'manifest',
          });
        }
        throw fail(
          'MANIFEST_VALIDATION_FAILED',
          `failed to read manifest: ${manifestPath}: ${e?.message ?? String(err)}`,
          { project_dir: projectDir },
        );
      }
      const parsed = parseManifest(manifestText);
      const manifestKeySet = new Set(Object.keys(parsed));
      const manifestKeys = [...manifestKeySet].sort();

      // 2. Read and parse provenance.json.
      const provenancePath = join(projectDir, '.rokudev-tools', 'provenance.json');
      let provenanceText: string;
      try {
        provenanceText = await readFile(provenancePath, 'utf8');
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e?.code === 'ENOENT') {
          throw fail('MANIFEST_VALIDATION_FAILED', `provenance.json not found: ${provenancePath}`, {
            project_dir: projectDir,
            missing: '.rokudev-tools/provenance.json',
          });
        }
        throw fail(
          'MANIFEST_VALIDATION_FAILED',
          `failed to read provenance.json: ${provenancePath}: ${e?.message ?? String(err)}`,
          { project_dir: projectDir },
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let provenance: any;
      try {
        provenance = JSON.parse(provenanceText);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw fail('MANIFEST_VALIDATION_FAILED', `provenance.json is not valid JSON: ${msg}`, {
          project_dir: projectDir,
        });
      }

      // 3. Compute drift.
      const provenanceManifestKeys: string[] = Array.isArray(provenance?.manifest_keys)
        ? (provenance.manifest_keys as string[])
        : [];
      const provenanceKeySet = new Set(provenanceManifestKeys);

      const missingInManifest = provenanceManifestKeys.filter((k) => !manifestKeySet.has(k)).sort();
      const extraInManifest = manifestKeys.filter((k) => !provenanceKeySet.has(k)).sort();

      // 4. Build response.
      const warnings: Array<{ code: string; message: string }> = [];
      if (missingInManifest.length > 0 || extraInManifest.length > 0) {
        warnings.push({
          code: 'MANIFEST_DRIFT',
          message: `manifest drift detected: ${missingInManifest.length} keys missing, ${extraInManifest.length} keys extra`,
        });
      }

      const payload: Record<string, unknown> = {
        ok: true,
        manifest_keys: manifestKeys,
        provenance,
        drift: {
          missing_in_manifest: missingInManifest,
          extra_in_manifest: extraInManifest,
        },
      };
      if (warnings.length > 0) {
        payload['details'] = { warnings };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(payload),
          },
        ],
      };
    },
  });
});
