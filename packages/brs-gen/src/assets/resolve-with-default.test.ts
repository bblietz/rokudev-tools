import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAssetSource } from './resolve-with-default.js';

const tmpdirs: string[] = [];

afterEach(async () => {
  for (const d of tmpdirs.splice(0)) {
    await rm(d, { recursive: true, force: true });
  }
});

describe('resolveAssetSource — precedence', () => {
  it('returns operator-supplied asset bytes when spec provides a path', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'rwd-op-'));
    tmpdirs.push(tmp);
    const opPath = join(tmp, 'op-icon.png');
    await writeFile(opPath, Buffer.from('operator-png-bytes'));
    const r = await resolveAssetSource({
      specAssetPath: opPath,
      specOrigin: null,
      templateRoot: '/unused',
      templateDefaultPath: 'assets/ignored.png',
      effectivePrimaryColor: '#000000',
      kind: 'icon',
      sourceMin: { min_width: 1, min_height: 1 }, // disable dim check for this test
      noValidate: true,
    });
    expect(r.source).toBe('operator');
    if (r.source === 'none') throw new Error('expected source !== none');
    expect(r.bytes.toString()).toBe('operator-png-bytes');
  });

  it('returns template-static bytes when operator omits + template declares path', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'rwd-static-'));
    tmpdirs.push(tmp);
    await mkdir(join(tmp, 'assets'), { recursive: true });
    const staticPath = 'assets/static-icon.png';
    await writeFile(join(tmp, staticPath), Buffer.from('template-static-bytes'));
    const r = await resolveAssetSource({
      specAssetPath: undefined,
      specOrigin: null,
      templateRoot: tmp,
      templateDefaultPath: staticPath,
      effectivePrimaryColor: '#000000',
      kind: 'icon',
      sourceMin: { min_width: 1, min_height: 1 },
      noValidate: true,
    });
    expect(r.source).toBe('template-static');
    if (r.source === 'none') throw new Error('expected source !== none');
    expect(r.bytes.toString()).toBe('template-static-bytes');
  });

  it('synthesizes from effectivePrimaryColor when both operator and template-static are absent', async () => {
    const r = await resolveAssetSource({
      specAssetPath: undefined,
      specOrigin: null,
      templateRoot: '/unused',
      templateDefaultPath: undefined,
      effectivePrimaryColor: '#123456',
      kind: 'icon',
      sourceMin: { min_width: 336, min_height: 218 },
      noValidate: false,
    });
    expect(r.source).toBe('synthesized');
    if (r.source === 'none') throw new Error('expected source !== none');
    // The byte length is non-zero and the PNG sig is correct.
    expect(r.bytes.subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG magic
  });

  it('returns source:none when all three inputs are absent', async () => {
    const r = await resolveAssetSource({
      specAssetPath: undefined,
      specOrigin: null,
      templateRoot: '/unused',
      templateDefaultPath: undefined,
      effectivePrimaryColor: undefined,
      kind: 'icon',
      sourceMin: { min_width: 336, min_height: 218 },
      noValidate: false,
    });
    expect(r.source).toBe('none');
    expect(r.bytes).toBeUndefined();
  });
});
