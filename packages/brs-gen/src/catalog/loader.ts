import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from '@rokudev/device-client';
import { parseToml } from './toml.js';
import { TemplateTomlSchema, type TemplateToml } from './template-toml.js';
import { ModuleTomlSchema, type ModuleToml } from './module-toml.js';

export type Catalog = {
  templates: ReadonlyMap<string, TemplateToml>;
  modules: ReadonlyMap<string, ModuleToml>;
  warnings: ReadonlyArray<{ code: string; message: string; details?: Record<string, unknown> }>;
};

// smol-toml parses [template.exports] as `template.exports` nested under the
// top-level `template` object. Our Zod schemas model this as two separate
// flat keys: `template` (primitives only) and `template_exports` (a sibling
// sub-table). We rewrite the parsed output to match: for every top-level
// key whose value is an object, we split its children into primitives
// (kept on the original key) and sub-tables (hoisted to `<parent>_<child>`).
// Arrays count as primitives so array-of-tables keeps its natural shape.
function flatten(parsed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const primitivesOnly: Record<string, unknown> = {};
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (v2 && typeof v2 === 'object' && !Array.isArray(v2)) {
          // sub-table: hoist to a sibling flat key
          out[`${k}_${k2}`] = v2;
        } else {
          // primitive or array: keep on the parent
          primitivesOnly[k2] = v2;
        }
      }
      out[k] = primitivesOnly;
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function loadOne<T>(
  tomlPath: string, expectedId: string, idPath: string,
  zodSchema: { safeParse(o: unknown): { success: boolean; data?: T; error?: unknown } },
): Promise<T> {
  let raw: string;
  try { raw = await readFile(tomlPath, 'utf8'); }
  catch (e) { throw fail('CATALOG_INVALID', `cannot read ${tomlPath}`, { cause: String(e) }); }
  let parsed: Record<string, unknown>;
  try { parsed = parseToml(raw); }
  catch (e) { throw fail('CATALOG_INVALID', `malformed TOML in ${tomlPath}`, { cause: String(e) }); }
  const flat = flatten(parsed);
  const r = zodSchema.safeParse(flat);
  if (!r.success) throw fail('CATALOG_INVALID', `schema error in ${tomlPath}`, { issues: r.error });
  // idPath is a dot path like "template.id" or "module.id".
  const actualId = idPath.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], r.data!);
  if (actualId !== expectedId) {
    throw fail('CATALOG_INVALID', `${idPath}=${String(actualId)} in ${tomlPath} does not match dir name ${expectedId}`,
               { expected: expectedId, got: actualId });
  }
  return r.data!;
}

function detectAsymmetric(modules: ReadonlyMap<string, ModuleToml>) {
  const out: Array<{ code: string; message: string; details: Record<string, unknown> }> = [];
  for (const [id, m] of modules) {
    for (const other of m.module_conflicts.exclusive_with) {
      const partner = modules.get(other);
      if (!partner) continue;
      if (!partner.module_conflicts.exclusive_with.includes(id)) {
        out.push({
          code: 'ASYMMETRIC_CONFLICT',
          message: `module ${id} declares exclusive_with ${other}, but ${other} does not reciprocate`,
          details: { from: id, to: other },
        });
      }
    }
  }
  return out;
}

// Guard against path-traversal in module.files.add entries.
// Modules declare file paths RELATIVE to their own `files/` directory. Any
// absolute path, '..' segment, or traversal pattern is rejected at catalog
// load time so the generate_app pipeline never opens a file outside the
// bundled catalog root. Also guards against `.ejs.` in the middle of a
// filename (only a trailing `.ejs` is meaningful to T14's strip logic).
function validateModuleFilePath(p: string, moduleId: string, tomlPath: string): void {
  if (p.startsWith('/') || p.startsWith('\\')) {
    throw fail('CATALOG_INVALID',
      `${tomlPath}: module ${moduleId} declares absolute path ${p}`,
      { module_id: moduleId, path: p });
  }
  const segs = p.split(/[\\/]/);
  if (segs.some((s) => s === '..' || s === '.')) {
    throw fail('CATALOG_INVALID',
      `${tomlPath}: module ${moduleId} declares traversal path ${p}`,
      { module_id: moduleId, path: p });
  }
  const base = segs[segs.length - 1] ?? '';
  if (base.includes('.ejs.')) {
    throw fail('CATALOG_INVALID',
      `${tomlPath}: module ${moduleId} file ${p} has '.ejs.' in the middle; only a trailing .ejs is allowed`,
      { module_id: moduleId, path: p });
  }
}

// Guard against case-insensitive scope collisions in template hook exports.
// BrightScript identifiers are case-insensitive, so template-level hook
// scopes 'main' and 'Main' would generate colliding Modules_OnMain<Phase>
// dispatch functions (T12). Reject at load time.
function validateHookScopeCasing(t: TemplateToml, tomlPath: string): void {
  const seen = new Map<string, string>();
  for (const hook of t.template_exports.init_hooks) {
    const scope = (hook as { scope: string }).scope;
    const lc = scope.toLowerCase();
    const prior = seen.get(lc);
    if (prior !== undefined && prior !== scope) {
      throw fail('CATALOG_INVALID',
        `${tomlPath}: hook scopes '${prior}' and '${scope}' differ only in case; BrightScript is case-insensitive`,
        { template_id: t.template.id, scopes: [prior, scope] });
    }
    seen.set(lc, scope);
  }
}

export async function loadCatalog(root: string): Promise<Catalog> {
  const templates = new Map<string, TemplateToml>();
  const modules = new Map<string, ModuleToml>();

  for (const d of await readdir(join(root, 'templates'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const tomlPath = join(root, 'templates', d.name, 'template.toml');
    const t = await loadOne<TemplateToml>(tomlPath, d.name, 'template.id', TemplateTomlSchema);
    validateHookScopeCasing(t, tomlPath);
    templates.set(d.name, t);
  }
  for (const d of await readdir(join(root, 'modules'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const tomlPath = join(root, 'modules', d.name, 'module.toml');
    const m = await loadOne<ModuleToml>(tomlPath, d.name, 'module.id', ModuleTomlSchema);
    for (const p of m.module_files.add) validateModuleFilePath(p, d.name, tomlPath);
    for (const rel of m.module_files.add) {
      const onDisk = join(root, 'modules', d.name, 'files', rel);
      try { await readFile(onDisk); }
      catch {
        throw fail('CATALOG_INVALID',
          `${tomlPath}: module ${d.name} declares file ${rel} which does not exist at ${onDisk}`,
          { module_id: d.name, path: rel });
      }
    }
    modules.set(d.name, m);
  }

  return { templates, modules, warnings: detectAsymmetric(modules) };
}
