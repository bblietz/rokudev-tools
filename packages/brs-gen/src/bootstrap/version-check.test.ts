import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkSiblings } from './version-check.js';

function makeTmpDir() {
  return join(tmpdir(), `brs-gen-vcheck-${randomUUID()}`);
}
async function writePackageJson(dir: string, version: string) {
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'brs-gen', version }));
}
async function writeAnchorFile(dir: string) {
  await writeFile(join(dir, 'index.js'), '');
}
async function writeSibling(dir: string, version: string) {
  const p = join(dir, 'node_modules', '@rokudev', 'device-client');
  await mkdir(p, { recursive: true });
  await writeFile(
    join(p, 'package.json'),
    JSON.stringify({ name: '@rokudev/device-client', version }),
  );
}

describe('brs-gen checkSiblings', () => {
  let d: string;
  beforeEach(async () => {
    d = makeTmpDir();
    await mkdir(d, { recursive: true });
  });
  afterEach(async () => {
    await rm(d, { recursive: true, force: true });
  });

  it('ok when versions match', async () => {
    await writePackageJson(d, '0.3.0');
    await writeAnchorFile(d);
    await writeSibling(d, '0.3.0');
    const r = await checkSiblings(pathToFileURL(join(d, 'index.js')).href);
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty('warning');
  });

  it('warning on any non-equal version drift (patch shown)', async () => {
    // Patch drift is enough to produce a warning -- matches rokudev-device.
    await writePackageJson(d, '0.3.0');
    await writeAnchorFile(d);
    await writeSibling(d, '0.3.1');
    const r = await checkSiblings(pathToFileURL(join(d, 'index.js')).href);
    expect(r.ok).toBe(true);
    if (!('warning' in r)) throw new Error('expected warning');
    expect(r.warning.code).toBe('CROSS_PACKAGE_VERSION_MISMATCH');
  });

  it('warning on minor-level drift', async () => {
    await writePackageJson(d, '0.3.0');
    await writeAnchorFile(d);
    await writeSibling(d, '0.4.0');
    const r = await checkSiblings(pathToFileURL(join(d, 'index.js')).href);
    expect(r.ok).toBe(true);
    if (!('warning' in r)) throw new Error('expected warning');
    expect(r.warning.code).toBe('CROSS_PACKAGE_VERSION_MISMATCH');
  });

  it('failure on major drift', async () => {
    await writePackageJson(d, '0.3.0');
    await writeAnchorFile(d);
    await writeSibling(d, '1.0.0');
    const r = await checkSiblings(pathToFileURL(join(d, 'index.js')).href);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('CROSS_PACKAGE_VERSION_MISMATCH');
  });

  it('ok when sibling cannot be loaded (malformed pkg.json)', async () => {
    await writePackageJson(d, '0.3.0');
    await writeAnchorFile(d);
    const p = join(d, 'node_modules', '@rokudev', 'device-client');
    await mkdir(p, { recursive: true });
    await writeFile(join(p, 'package.json'), '{not valid');
    const r = await checkSiblings(pathToFileURL(join(d, 'index.js')).href);
    expect(r.ok).toBe(true);
  });
});
