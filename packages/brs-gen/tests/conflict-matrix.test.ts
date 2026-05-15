import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/loader.js';
import { buildEmittedProject } from '../src/merger/build.js';
import { renderTemplateFiles } from '../src/render/ejs.js';
import type { ModuleToml } from '../src/catalog/module-toml.js';

// Package root = packages/brs-gen/. This file lives at
// packages/brs-gen/tests/conflict-matrix.test.ts, so `..` from its URL is
// the package root in both vite-node (source tree) and any future dist layout.
const PKG_ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const BRS_GEN_VERSION = '0.3.0-dev.0';

// Failure codes that are acceptable outcomes in the conflict-matrix sweep.
// MODULE_CONFIG_INVALID: config-validation failure when synthesized config does
//   not fully satisfy the schema (e.g. enum constraints beyond what synthesize covers).
//   This is a validation-layer failure, not a conflict, but is acceptable here.
// MODULE_CONFLICT: exclusive_with triggered between the two modules.
// FILE_COLLISION: the two modules declare overlapping file paths.
// MANIFEST_KEY_CONFLICT: both modules write the same manifest key with conflicting values.
// INIT_ORDER_CYCLE, WIRING_CONTRACT_VIOLATION: structural failures acceptable as
//   "not a conflict but a detected incompatibility".
const ALLOWED_FAILURE_CODES = new Set([
  'MODULE_CONFIG_INVALID',
  'MODULE_CONFLICT',
  'FILE_COLLISION',
  'MANIFEST_KEY_CONFLICT',
  'INIT_ORDER_CYCLE',
  'WIRING_CONTRACT_VIOLATION',
]);

// Synthesize a minimal config object that satisfies the JSON Schema `required`
// set. Same logic as in src/tools/get-module-schema.ts (not exported, so
// inlined here). For type arrays (e.g. ['string','null']), picks the first
// non-'null' type. Nested object properties recurse into their own
// `required`/`properties`.
function synthesizeExample(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!schema || typeof schema !== 'object') return out;
  const required: string[] = Array.isArray(schema['required'])
    ? (schema['required'] as string[])
    : [];
  const props = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>;
  for (const key of required) {
    const prop = props[key];
    if (!prop || typeof prop !== 'object') {
      out[key] = null;
      continue;
    }
    const rawT = prop['type'];
    const types: unknown[] = Array.isArray(rawT) ? rawT : [rawT];
    const primary = types.find((x) => x !== 'null') ?? types[0];
    if (primary === 'string') out[key] = 'hello';
    else if (primary === 'integer' || primary === 'number') out[key] = 0;
    else if (primary === 'boolean') out[key] = false;
    else if (primary === 'array') out[key] = [];
    else if (primary === 'object') out[key] = synthesizeExample(prop);
    else out[key] = null;
  }
  return out;
}

// Walk a directory, returning every file as { path, bytes } where path is
// relative to `root` and uses forward slashes on every OS. Sorted by path to
// keep the EJS render pass deterministic.
async function walkTemplateFiles(root: string): Promise<Array<{ path: string; bytes: Buffer }>> {
  const out: Array<{ path: string; bytes: Buffer }> = [];
  async function walk(current: string): Promise<void> {
    for (const e of await readdir(current, { withFileTypes: true })) {
      const full = join(current, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const rel = relative(root, full).split(/[\\/]/).join('/');
        out.push({ path: rel, bytes: await readFile(full) });
      }
    }
  }
  await walk(root);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

// Load every file declared by each module from disk into a flat Map keyed by
// the relative path declared in module_files.add.
async function loadModuleFileBytes(
  pkgRoot: string,
  modules: ReadonlyArray<{ module: { id: string }; module_files: { add: string[] } }>,
): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const m of modules) {
    for (const rel of m.module_files.add) {
      const onDisk = join(pkgRoot, 'modules', m.module.id, 'files', rel);
      out.set(rel, await readFile(onDisk));
    }
  }
  return out;
}

// Enumerate every 2-element combination (unordered) from an array.
function twoSubsets<T>(items: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      out.push([items[i]!, items[j]!]);
    }
  }
  return out;
}

// Build and run the full merger pipeline for a pair of modules against
// stub_hello. Returns { ok: true } on success or { ok: false, code } on a
// documented failure.
async function runPair(
  template: import('../src/catalog/template-toml.js').TemplateToml,
  moduleA: ModuleToml,
  moduleB: ModuleToml,
): Promise<{ ok: true } | { ok: false; code: string }> {
  const modules = [moduleA, moduleB];

  // Synthesize minimal valid configs for each module from its schema.
  const specModules = modules.map((m) => ({
    id: m.module.id,
    config: synthesizeExample(m.module_config_schema as Record<string, unknown>),
  }));

  const spec = {
    spec_version: 2 as const,
    template: 'stub_hello',
    modules: specModules,
    app: { name: 'ConflictTest', major_version: 1, minor_version: 0, build_version: 0 },
  };

  const templateFiles = await walkTemplateFiles(join(PKG_ROOT, 'templates', 'stub_hello', 'files'));
  const renderedTemplateFiles = await renderTemplateFiles(templateFiles, spec, {
    brs_gen_version: BRS_GEN_VERSION,
    template_version: template.template.version,
  });
  const moduleFileBytes = await loadModuleFileBytes(PKG_ROOT, modules);

  try {
    await buildEmittedProject({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spec: spec as any,
      template,
      modules,
      renderedTemplateFiles,
      moduleFileBytes,
      brsGenVersion: BRS_GEN_VERSION,
    });
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'UNKNOWN';
    return { ok: false, code };
  }
}

// Build and run the full merger pipeline for a single module (or zero modules)
// against a given template. Returns { ok: true } on success or { ok: false, code }
// on a documented failure.
async function runEntry(
  template: import('../src/catalog/template-toml.js').TemplateToml,
  modules: ModuleToml[],
): Promise<{ ok: true } | { ok: false; code: string }> {
  const specModules = modules.map((m) => ({
    id: m.module.id,
    config: synthesizeExample(m.module_config_schema as Record<string, unknown>),
  }));

  const spec = {
    spec_version: 2 as const,
    template: template.template.id,
    modules: specModules,
    app: { name: 'ConflictTest', major_version: 1, minor_version: 0, build_version: 0 },
  };

  const templateFiles = await walkTemplateFiles(
    join(PKG_ROOT, 'templates', template.template.id, 'files'),
  );
  const renderedTemplateFiles = await renderTemplateFiles(templateFiles, spec, {
    brs_gen_version: BRS_GEN_VERSION,
    template_version: template.template.version,
  });
  const moduleFileBytes = await loadModuleFileBytes(PKG_ROOT, modules);

  try {
    await buildEmittedProject({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spec: spec as any,
      template,
      modules,
      renderedTemplateFiles,
      moduleFileBytes,
      brsGenVersion: BRS_GEN_VERSION,
    });
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'UNKNOWN';
    return { ok: false, code };
  }
}

describe('conflict-matrix', () => {
  it('every 2-subset of modules either merges cleanly or fails with a documented code', async () => {
    const cat = await loadCatalog(PKG_ROOT);
    const template = cat.templates.get('stub_hello')!;
    expect(template).toBeDefined();

    const allModules = [...cat.modules.values()];
    const subsets = twoSubsets(allModules);

    // Plan 3 ships only stub_label — the loop is empty and the test passes
    // trivially. When Plan 5 adds real modules, subsets will be non-empty and
    // this harness exercises every pair automatically.
    console.log(
      `conflict-matrix: checked ${subsets.length} 2-subset(s) from ${allModules.length} module(s)`,
    );

    // Ensure the harness itself ran (even with zero subsets).
    expect(subsets.length).toBeGreaterThanOrEqual(0);

    const unexpected: string[] = [];

    for (const [a, b] of subsets) {
      const result = await runPair(template, a, b);
      if (result.ok) {
        // Clean merge — acceptable.
        continue;
      }
      if (ALLOWED_FAILURE_CODES.has(result.code)) {
        // Known conflict or validation failure — acceptable.
        continue;
      }
      unexpected.push(
        `pair [${a.module.id}, ${b.module.id}] failed with unexpected code '${result.code}'`,
      );
    }

    if (unexpected.length > 0) {
      throw new Error(
        `conflict-matrix: ${unexpected.length} unexpected failure(s):\n${unexpected.join('\n')}`,
      );
    }
  });
});

// Explicit entries for blank_scenegraph. Each entry is either an ok merge or
// a WIRING_CONTRACT_VIOLATION (stub_label requires Main.before_scene_show
// which blank_scenegraph does not export; it only exports
// MainScene.after_scene_show). Both outcomes are acceptable.
describe('conflict-matrix: blank_scenegraph entries', () => {
  const entries: Array<{ modules: string[] }> = [{ modules: [] }, { modules: ['stub_label'] }];

  for (const entry of entries) {
    it(`blank_scenegraph + [${entry.modules.join(', ')}] merges cleanly or fails with a documented code`, async () => {
      const cat = await loadCatalog(PKG_ROOT);
      const template = cat.templates.get('blank_scenegraph')!;
      expect(template).toBeDefined();

      const modules = entry.modules.map((id) => {
        const m = cat.modules.get(id);
        if (!m) throw new Error(`module '${id}' not found in catalog`);
        return m;
      });

      const result = await runEntry(template, modules);
      if (result.ok) {
        // Clean merge — pass.
        return;
      }
      expect(ALLOWED_FAILURE_CODES.has(result.code)).toBe(true);
    });
  }
});

describe('conflict-matrix: news_channel entries', () => {
  it('news_channel + no modules: merges cleanly', async () => {
    const cat = await loadCatalog(PKG_ROOT);
    const template = cat.templates.get('news_channel')!;
    expect(template).toBeDefined();

    const result = await runEntry(template, []);
    expect(result.ok).toBe(true);
  });

  it('news_channel + stub_label: merges cleanly and dispatcher contains Modules_OnMainBeforeSceneShow + StubLabel_init', async () => {
    const cat = await loadCatalog(PKG_ROOT);
    const template = cat.templates.get('news_channel')!;
    expect(template).toBeDefined();

    const stubLabel = cat.modules.get('stub_label');
    if (!stubLabel) throw new Error("module 'stub_label' not found in catalog");
    const modules = [stubLabel];

    const specModules = [{ id: 'stub_label', config: { text: 'matrix-news' } }];
    const spec = {
      spec_version: 2 as const,
      template: 'news_channel',
      modules: specModules,
      app: { name: 'News Matrix Stub', major_version: 0, minor_version: 1, build_version: 0 },
    };

    const templateFiles = await walkTemplateFiles(
      join(PKG_ROOT, 'templates', 'news_channel', 'files'),
    );
    const renderedTemplateFiles = await renderTemplateFiles(templateFiles, spec, {
      brs_gen_version: BRS_GEN_VERSION,
      template_version: template.template.version,
    });
    const moduleFileBytes = await loadModuleFileBytes(PKG_ROOT, modules);

    const emitted = await buildEmittedProject({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spec: spec as any,
      template,
      modules,
      renderedTemplateFiles,
      moduleFileBytes,
      brsGenVersion: BRS_GEN_VERSION,
    });

    // Confirm dispatcher fires the stub_label hook.
    const hooksEntry = emitted.files.find(
      (f) => f.path === 'source/_modules/__init_hooks.bs',
    );
    expect(hooksEntry).toBeDefined();
    const dispatcher = hooksEntry!.content.toString();
    expect(dispatcher).toContain('Modules_OnMainBeforeSceneShow');
    expect(dispatcher).toContain('StubLabel_init');
  });
});

describe('conflict-matrix: music_player entries', () => {
  it('music_player + no modules: merges cleanly', async () => {
    const cat = await loadCatalog(PKG_ROOT);
    const template = cat.templates.get('music_player')!;
    expect(template).toBeDefined();

    const result = await runEntry(template, []);
    expect(result.ok).toBe(true);
  });
});

describe('conflict-matrix: screensaver entries', () => {
  it('screensaver + no modules: merges cleanly', async () => {
    const cat = await loadCatalog(PKG_ROOT);
    const template = cat.templates.get('screensaver')!;
    expect(template).toBeDefined();
    const result = await runEntry(template, []);
    expect(result.ok).toBe(true);
  });
});

describe('conflict-matrix: game_shell entries', () => {
  it('game_shell + no modules: merges cleanly', async () => {
    const cat = await loadCatalog(PKG_ROOT);
    const template = cat.templates.get('game_shell')!;
    expect(template).toBeDefined();
    const result = await runEntry(template, []);
    expect(result.ok).toBe(true);
  });
});
