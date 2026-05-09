// packages/brs-gen/scripts/regen-helper.mjs
//
// Thin in-process wrapper around the generate_app tool, used by regen-golden
// and any future golden-driven fixture. Loads the catalog, seeds the
// module-level singleton, imports side-effect tool registrations, then calls
// generate_app's handler directly (no MCP stdio plumbing).
//
// Written as .mjs rather than .ts because brs-gen has no tsx / ts-node in
// devDeps and we don't want to add one just for a regen script. The script
// consumes packages/brs-gen/dist/, so `pnpm build` must run before calling
// this helper.

import { loadCatalog } from '../dist/catalog/loader.js';
import { setCatalog } from '../dist/tools/_catalog-singleton.js';
import { registerAllTools } from '../dist/tools/_register.js';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import '../dist/tools/all.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');

/**
 * Invoke the generate_app tool handler in-process.
 *
 * @param {{ outputDir: string, spec: unknown, outputZip: string }} args
 * @returns {Promise<{ zip_path: string, output_dir: string, payload: Record<string, unknown> }>}
 */
export async function generateAppForRegen({ outputDir, spec, outputZip }) {
  const catalog = await loadCatalog(PKG_ROOT);
  setCatalog(catalog);

  const tools = new Map();
  registerAllTools(tools);
  const def = tools.get('generate_app');
  if (!def) throw new Error('generate_app not registered after importing all.js');

  const payload = await def.handler({
    spec,
    output_dir: outputDir,
    zip: { output_zip: outputZip },
  });

  // generate_app returns the plain payload object directly.
  if (!payload || typeof payload !== 'object') {
    throw new Error('generate_app did not return a payload object');
  }
  if (payload.ok !== true) {
    throw new Error(`generate_app failed: ${JSON.stringify(payload)}`);
  }
  return {
    zip_path: payload.zip_path,
    output_dir: payload.project_dir,
    payload,
  };
}
