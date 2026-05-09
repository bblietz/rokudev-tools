import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { access, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { compileProject } from './compile.js';

function tmp() {
  return join(tmpdir(), `brs-gen-compile-${randomUUID()}`);
}

async function writeMiniProject(dir: string, mainBody: string) {
  await mkdir(join(dir, 'source'), { recursive: true });
  await writeFile(
    join(dir, 'manifest'),
    'title=Test\nmajor_version=1\nminor_version=0\nbuild_version=0\nui_resolutions=fhd\n',
  );
  await writeFile(join(dir, 'source/Main.bs'), mainBody);
  await writeFile(join(dir, 'bsconfig.json'), JSON.stringify({ sourceMap: true, rootDir: '.' }));
}

describe('compileProject', () => {
  let root: string;
  beforeEach(async () => {
    root = tmp();
    await mkdir(root, { recursive: true });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns ok with no diagnostics for a clean project', async () => {
    await writeMiniProject(root, 'sub Main(args as dynamic) as void\n  print "hi"\nend sub\n');
    const r = await compileProject(root);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('emits .brs into source/ and .brs.map into .rokudev-tools/sourcemaps/, deletes .bs', async () => {
    await writeMiniProject(root, 'sub Main(args as dynamic) as void\n  print "hi"\nend sub\n');
    const r = await compileProject(root);
    expect(r.ok).toBe(true);
    await expect(access(join(root, 'source/Main.brs'))).resolves.toBeUndefined();
    await expect(
      access(join(root, '.rokudev-tools/sourcemaps/source/Main.brs.map')),
    ).resolves.toBeUndefined();
    await expect(access(join(root, 'source/Main.bs'))).rejects.toThrow();
    await expect(access(join(root, '.rokudev-tools/staging'))).rejects.toThrow();
  });

  it('returns LINT_FAILED on a syntax error', async () => {
    await writeMiniProject(
      root,
      'sub Main(args as dynamic) as void\n  print "unterminated\nend sub\n',
    );
    const r = await compileProject(root);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('LINT_FAILED');
    expect(r.failure.details?.diagnostics).toBeDefined();
  });

  it('patches uri="*.bs" to uri="*.brs" in XML files after compile', async () => {
    await writeMiniProject(root, 'sub Main(args as dynamic) as void\n  print "hi"\nend sub\n');
    await mkdir(join(root, 'components'), { recursive: true });
    await writeFile(
      join(root, 'components/MainScene.bs'),
      'sub init()\nend sub\n',
    );
    await writeFile(
      join(root, 'components/MainScene.xml'),
      '<?xml version="1.0" encoding="utf-8" ?>\n<component name="MainScene" extends="Scene">\n    <script type="text/brightscript" uri="MainScene.bs" />\n</component>\n',
    );
    const r = await compileProject(root);
    expect(r.ok).toBe(true);
    const xml = await readFile(join(root, 'components/MainScene.xml'), 'utf8');
    expect(xml).toContain('uri="MainScene.brs"');
    expect(xml).not.toContain('uri="MainScene.bs"');
  });

  it('produces byte-equal output across two invocations on the same input', async () => {
    await writeMiniProject(root, 'sub Main(args as dynamic) as void\n  print "hi"\nend sub\n');
    const a = await compileProject(root);
    expect(a.ok).toBe(true);
    const fa = await readFile(join(root, 'source/Main.brs'));
    await writeMiniProject(root, 'sub Main(args as dynamic) as void\n  print "hi"\nend sub\n');
    const b = await compileProject(root);
    expect(b.ok).toBe(true);
    const fb = await readFile(join(root, 'source/Main.brs'));
    expect(fa.equals(fb)).toBe(true);
  });
});
