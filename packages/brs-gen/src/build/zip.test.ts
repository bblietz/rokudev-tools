import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { packageProject } from './zip.js';

function tmp() { return join(tmpdir(), `brs-gen-zip-${randomUUID()}`); }

async function writeMiniProject(dir: string) {
  await mkdir(join(dir, 'source'), { recursive: true });
  await writeFile(join(dir, 'manifest'), 'title=Test\n');
  await writeFile(join(dir, 'source/Main.brs'), 'sub Main(): end sub\n');
}

function sha256(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex');
}

describe('packageProject', () => {
  let root: string;
  beforeEach(async () => { root = tmp(); await mkdir(root, { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('produces a zip file at the requested output_zip path', async () => {
    const proj = join(root, 'p'); await writeMiniProject(proj);
    const out = join(root, 'p.zip');
    await packageProject({ projectDir: proj, outputZip: out });
    const bytes = await readFile(out);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('byte-equal output on two zips of the same project', async () => {
    const proj = join(root, 'p'); await writeMiniProject(proj);
    const a = join(root, 'a.zip');
    const b = join(root, 'b.zip');
    await packageProject({ projectDir: proj, outputZip: a });
    await packageProject({ projectDir: proj, outputZip: b });
    const A = await readFile(a);
    const B = await readFile(b);
    expect(sha256(A)).toBe(sha256(B));
  });

  it('excludes paths in the exclude array', async () => {
    const proj = join(root, 'p'); await writeMiniProject(proj);
    await mkdir(join(proj, '.rokudev-tools/sourcemaps'), { recursive: true });
    await writeFile(join(proj, '.rokudev-tools/sourcemaps/main.brs.map'), '{}');
    const out = join(root, 'p.zip');
    await packageProject({ projectDir: proj, outputZip: out, exclude: ['.rokudev-tools/sourcemaps'] });
    const bytes = await readFile(out);
    expect(bytes.toString('latin1')).not.toContain('main.brs.map');
  });
});
