import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { writeProject } from './write.js';

function mkdirTmp() { return join(tmpdir(), `brs-gen-write-${randomUUID()}`); }

const sample = [
  { path: 'manifest', content: 'title=Hi\n' },
  { path: 'source/Main.bs', content: 'sub Main(): end sub\n' },
  { path: 'images/icon_hd.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  { path: '.rokudev-tools/provenance.json', content: '{"spec_version":2}' },
];

describe('writeProject', () => {
  let parent: string;
  beforeEach(async () => { parent = mkdirTmp(); await mkdir(parent, { recursive: true }); });
  afterEach(async () => { await rm(parent, { recursive: true, force: true }); });

  it('writes all files under output_dir', async () => {
    const out = join(parent, 'proj');
    await writeProject({ outputDir: out, files: sample, overwrite: false });
    expect((await readFile(join(out, 'manifest'), 'utf8'))).toBe('title=Hi\n');
    expect((await readFile(join(out, 'source/Main.bs'), 'utf8'))).toBe('sub Main(): end sub\n');
    const bin = await readFile(join(out, 'images/icon_hd.png'));
    expect([bin[0], bin[1], bin[2], bin[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('refuses to overwrite existing output_dir without flag', async () => {
    const out = join(parent, 'proj');
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'existing.txt'), 'x');
    await expect(writeProject({ outputDir: out, files: sample, overwrite: false }))
      .rejects.toMatchObject({ code: 'OUTPUT_DIR_NOT_EMPTY' });
  });

  it('replaces existing dir when overwrite=true', async () => {
    const out = join(parent, 'proj');
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'stale.txt'), 'x');
    await writeProject({ outputDir: out, files: sample, overwrite: true });
    await expect(readFile(join(out, 'stale.txt'))).rejects.toBeDefined(); // deleted
    expect((await readFile(join(out, 'manifest'), 'utf8'))).toBe('title=Hi\n');
  });

  it('tmpdir lives inside dirname(output_dir)', async () => {
    const out = join(parent, 'nested', 'proj');
    await mkdir(dirname(out), { recursive: true });
    await writeProject({ outputDir: out, files: sample, overwrite: false });
    expect(await stat(out)).toBeTruthy();
  });

  it('creates nested parent directories inside output_dir', async () => {
    const out = join(parent, 'proj');
    await writeProject({ outputDir: out, files: sample, overwrite: false });
    expect(await stat(join(out, '.rokudev-tools'))).toBeTruthy();
    expect(await stat(join(out, 'source'))).toBeTruthy();
  });
});
