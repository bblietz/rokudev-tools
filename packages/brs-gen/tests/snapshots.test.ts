import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { loadCatalog } from '../src/catalog/loader.js';
import { buildEmittedProject } from '../src/merger/build.js';
import { renderTemplateFiles } from '../src/render/ejs.js';
import { writeProject } from '../src/build/write.js';

// Package root = packages/brs-gen/. This file lives at
// packages/brs-gen/tests/snapshots.test.ts, so `..` from its URL is the
// package root in both vite-node (source tree) and any future dist layout.
const PKG_ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const BRS_GEN_VERSION = '0.3.0-dev.0';

const sharedSpec = {
  spec_version: 2 as const,
  template: 'stub_hello',
  modules: [{ id: 'stub_label', config: { text: 'hello world' } }],
  app: { name: 'Stub Channel', major_version: 1, minor_version: 0, build_version: 0 },
};

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

// Runs the merger + writeProject and STOPS BEFORE compileProject. The .bs
// sources on disk are therefore still .bs (not .brs). Rationale (spec §10.3):
// post-compile bytes depend on the brighterscript version; pre-compile state
// is what we author and reason about. T28 covers post-compile byte equality.
async function generateStubProjectPreCompile(parentDir: string): Promise<string> {
  const cat = await loadCatalog(PKG_ROOT);
  const template = cat.templates.get('stub_hello')!;
  const modules = [cat.modules.get('stub_label')!];
  const templateFiles = await walkTemplateFiles(join(PKG_ROOT, 'templates', 'stub_hello', 'files'));
  const renderedTemplateFiles = await renderTemplateFiles(templateFiles, sharedSpec, {
    brs_gen_version: BRS_GEN_VERSION,
    template_version: template.template.version,
  });
  const moduleFileBytes = await loadModuleFileBytes(PKG_ROOT, modules);
  const project = await buildEmittedProject({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spec: sharedSpec as any,
    template,
    modules,
    renderedTemplateFiles,
    moduleFileBytes,
    brsGenVersion: BRS_GEN_VERSION,
  });

  // writeProject refuses to clobber a non-empty directory unless overwrite:true,
  // so point at a not-yet-existing child of the tmpdir that beforeAll created.
  const outputDir = join(parentDir, 'project');
  await writeProject({ outputDir, files: project.files, overwrite: false });
  return outputDir;
}

// Recursive walk returning sorted [{path, size}] for every file under root.
// Paths use forward slashes for cross-OS stable snapshots.
async function sortedPathSizeList(root: string): Promise<Array<{ path: string; size: number }>> {
  const out: Array<{ path: string; size: number }> = [];
  async function walk(current: string): Promise<void> {
    for (const e of await readdir(current, { withFileTypes: true })) {
      const full = join(current, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const rel = relative(root, full).split(/[\\/]/).join('/');
        const st = await stat(full);
        out.push({ path: rel, size: st.size });
      }
    }
  }
  await walk(root);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

describe('stub catalog snapshot', () => {
  // Snapshots are taken at the PRE-COMPILE state (the EmittedProject that
  // the merger produces), not the post-compile state. Rationale: the .bs
  // source is what we author and reason about; the .brs is a byproduct of
  // the brighterscript compiler version, and its exact bytes are already
  // covered by T28's bsc-byte-equality test. This decision keeps snapshots
  // stable across brighterscript upgrades.
  let parentDir: string;
  let projectDir: string;
  beforeAll(async () => {
    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-snap-'));
    projectDir = await generateStubProjectPreCompile(parentDir);
  });
  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('emitted manifest matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'manifest'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/manifest.snap');
  });
  it('__init_hooks.bs matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'source/_modules/__init_hooks.bs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/init_hooks.bs.snap');
  });
  it('config.bs for stub_label matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'source/_modules/stub_label/config.bs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/stub_label-config.bs.snap');
  });
  it('provenance.json matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, '.rokudev-tools/provenance.json'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/provenance.json.snap');
  });
  it('file listing matches saved snapshot', async () => {
    const sortedList = await sortedPathSizeList(projectDir);
    await expect(JSON.stringify(sortedList, null, 2) + '\n').toMatchFileSnapshot(
      '__snapshots__/files.snap',
    );
  });
});
