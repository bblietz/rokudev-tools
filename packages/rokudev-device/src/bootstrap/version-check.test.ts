import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkSiblings } from './version-check.js';

function makeTmpDir(): string {
  return join(tmpdir(), `rokudev-vcheck-${randomUUID()}`);
}

async function writePackageJson(dir: string, version: string): Promise<void> {
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'rokudev-device', version }));
}

async function writeSiblingPackageJson(tmpDir: string, version: string): Promise<void> {
  const siblingDir = join(tmpDir, 'node_modules', '@rokudev', 'device-client');
  await mkdir(siblingDir, { recursive: true });
  await writeFile(join(siblingDir, 'package.json'), JSON.stringify({ name: '@rokudev/device-client', version }));
}

async function writeAnchorFile(tmpDir: string): Promise<void> {
  // createRequire resolves node_modules relative to this file's location
  await writeFile(join(tmpDir, 'index.js'), '');
}

describe('checkSiblings', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns ok:true (no warning) when versions are equal', async () => {
    await writePackageJson(tmpDir, '0.1.0');
    await writeAnchorFile(tmpDir);
    await writeSiblingPackageJson(tmpDir, '0.1.0');

    const result = await checkSiblings(pathToFileURL(join(tmpDir, 'index.js')).href);

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty('warning');
    expect(result).not.toHaveProperty('failure');
  });

  it('returns ok:true with warning on minor/patch drift', async () => {
    await writePackageJson(tmpDir, '0.1.0');
    await writeAnchorFile(tmpDir);
    await writeSiblingPackageJson(tmpDir, '0.1.1');

    const result = await checkSiblings(pathToFileURL(join(tmpDir, 'index.js')).href);

    expect(result.ok).toBe(true);
    expect(result).toHaveProperty('warning');
    if (!result.ok || !('warning' in result)) throw new Error('narrowing');
    expect(result.warning.code).toBe('CROSS_PACKAGE_VERSION_MISMATCH');
    expect(result.warning).toHaveProperty('installed_version', '0.1.1');
  });

  it('returns ok:false with failure on major version drift', async () => {
    await writePackageJson(tmpDir, '0.1.0');
    await writeAnchorFile(tmpDir);
    await writeSiblingPackageJson(tmpDir, '1.0.0');

    const result = await checkSiblings(pathToFileURL(join(tmpDir, 'index.js')).href);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('narrowing');
    expect(result.failure.code).toBe('CROSS_PACKAGE_VERSION_MISMATCH');
    expect(result.failure.stage).toBe('bootstrap');
    expect(result.failure.details).toHaveProperty('installed_version', '1.0.0');
  });

  it('returns ok:true (no-op) when sibling is not resolvable', async () => {
    await writePackageJson(tmpDir, '0.1.0');
    await writeAnchorFile(tmpDir);
    // Intentionally do NOT create the sibling node_modules

    const result = await checkSiblings(pathToFileURL(join(tmpDir, 'index.js')).href);

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty('warning');
    expect(result).not.toHaveProperty('failure');
  });
});
