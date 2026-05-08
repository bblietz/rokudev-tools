import { describe, it, expect, vi } from 'vitest';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../src/catalog/loader.js';
import { buildEmittedProject } from '../src/merger/build.js';
import { renderTemplateFiles } from '../src/render/ejs.js';
import { compileProject } from '../src/build/compile.js';
import { packageProject } from '../src/build/zip.js';

// Package root = packages/brs-gen/. This file lives at
// packages/brs-gen/tests/determinism.test.ts, so `..` from its URL is the
// package root in both vite-node (source tree) and any future dist layout.
const PKG_ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const BRS_GEN_VERSION = '0.3.0-dev.0';

function tmp(label: string) {
  return join(tmpdir(), `brs-gen-det-${label}-${randomUUID()}`);
}

const sharedSpec = {
  spec_version: 2 as const,
  template: 'stub_hello',
  modules: [{ id: 'stub_label', config: { text: 'hi' } }],
  app: { name: 'Hi', major_version: 1, minor_version: 0, build_version: 0 },
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

// Given the module TOML list, load every declared file's bytes and map by
// the same relative path the module declared. `buildEmittedProject` expects
// a flat Map<relpath, Buffer> keyed by the module_files.add entries.
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

async function runMerge() {
  const cat = await loadCatalog(PKG_ROOT);
  const template = cat.templates.get('stub_hello')!;
  const modules = [cat.modules.get('stub_label')!];
  const templateFiles = await walkTemplateFiles(
    join(PKG_ROOT, 'templates', 'stub_hello', 'files'),
  );
  const renderedTemplateFiles = await renderTemplateFiles(templateFiles, sharedSpec, {
    brs_gen_version: BRS_GEN_VERSION,
    template_version: template.template.version,
  });
  const moduleFileBytes = await loadModuleFileBytes(PKG_ROOT, modules);
  return buildEmittedProject({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spec: sharedSpec as any,
    template,
    modules,
    renderedTemplateFiles,
    moduleFileBytes,
    brsGenVersion: BRS_GEN_VERSION,
  });
}

async function writeMiniProject(dir: string): Promise<void> {
  await mkdir(join(dir, 'source'), { recursive: true });
  await writeFile(
    join(dir, 'manifest'),
    'title=Test\nmajor_version=1\nminor_version=0\nbuild_version=0\nui_resolutions=fhd\n',
  );
  await writeFile(
    join(dir, 'source/Main.bs'),
    'sub Main(args as dynamic) as void\n  print "hi"\nend sub\n',
  );
  await writeFile(join(dir, 'bsconfig.json'), JSON.stringify({ sourceMap: true, rootDir: '.' }));
}

describe('determinism', () => {
  it('pure merger byte equality across runs in same process', async () => {
    const a = await runMerge();
    const b = await runMerge();
    expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
    for (let i = 0; i < a.files.length; i++) {
      const ac = a.files[i]!.content;
      const bc = b.files[i]!.content;
      if (Buffer.isBuffer(ac) && Buffer.isBuffer(bc)) {
        expect(ac.equals(bc)).toBe(true);
      } else {
        expect(ac).toBe(bc);
      }
    }
    expect(a.provenance).toBe(b.provenance);
  });

  it('wall-clock invariance: merger output identical across system-time changes', async () => {
    // If any step in the pipeline (notably buildProvenance) embeds
    // `new Date()` / `Date.now()`, shifting the system clock between the
    // two runs will surface as a diff. Spec §8 requires reproducibility
    // from source + catalog alone, so bytes MUST be unchanged.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
      const a = await runMerge();
      vi.setSystemTime(new Date('2030-06-15T12:34:56Z'));
      const b = await runMerge();
      expect(a.provenance).toBe(b.provenance);
      expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
      for (let i = 0; i < a.files.length; i++) {
        const ac = a.files[i]!.content;
        const bc = b.files[i]!.content;
        if (Buffer.isBuffer(ac) && Buffer.isBuffer(bc)) {
          expect(ac.equals(bc)).toBe(true);
        } else {
          expect(ac).toBe(bc);
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('bsc compile output is byte-equal across two identical input trees', async () => {
    const dirA = tmp('a');
    const dirB = tmp('b');
    await mkdir(dirA, { recursive: true });
    await mkdir(dirB, { recursive: true });
    try {
      await writeMiniProject(dirA);
      await writeMiniProject(dirB);
      const ra = await compileProject(dirA);
      const rb = await compileProject(dirB);
      expect(ra.ok).toBe(true);
      expect(rb.ok).toBe(true);
      const fa = await readFile(join(dirA, 'source/Main.brs'));
      const fb = await readFile(join(dirB, 'source/Main.brs'));
      expect(fa.equals(fb)).toBe(true);
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });

  it('zip external-file-attributes are OS-independent (0o644)', async () => {
    // Regression guard for yazl's `mode` option. Cross-OS byte-equality
    // of the zip depends on the central-directory external-file-attributes
    // field encoding the unix mode in its high 16 bits. If a future yazl
    // version drops honor for the `mode` option, this test fails first
    // and tells us to pin or fork.
    const proj = tmp('zip');
    await mkdir(join(proj, 'source'), { recursive: true });
    try {
      await writeFile(join(proj, 'manifest'), 'title=X\n');
      await writeFile(join(proj, 'source/Main.brs'), 'sub Main(): end sub\n');
      const out = join(proj, 'p.zip');
      await packageProject({ projectDir: proj, outputZip: out });
      const bytes = await readFile(out);
      // ZIP central directory entry signature = 0x02014b50 (little endian).
      // external_file_attributes is a 4-byte LE field at offset 38 within
      // each central-directory entry; unix mode sits in the high 16 bits.
      // A linear scan is fine at test-fixture sizes.
      const expected = 0o644;
      let found = 0;
      for (let i = 0; i <= bytes.length - 4; i++) {
        if (bytes.readUInt32LE(i) === 0x02014b50) {
          const ext = bytes.readUInt32LE(i + 38);
          const mode = (ext >>> 16) & 0o777;
          expect(mode).toBe(expected);
          found++;
        }
      }
      expect(found).toBeGreaterThan(0);
    } finally {
      await rm(proj, { recursive: true, force: true });
    }
  });
});
