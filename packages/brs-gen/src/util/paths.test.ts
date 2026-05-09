import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findPkgRoot } from './paths.js';

describe('findPkgRoot', () => {
  it('resolves to the brs-gen package root from a nested src path', async () => {
    // Simulate being called from a deeply-nested src file.
    const nestedUrl = pathToFileURL(
      join(import.meta.dirname, 'deeply', 'nested', 'file.ts'),
    ).href;
    const root = await findPkgRoot(nestedUrl);
    // The resolved root must contain package.json and have the right package name.
    const { readFile } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      name?: string;
    };
    expect(pkg.name).toBe('brs-gen');
  });

  it('resolves correctly when called from import.meta.url itself', async () => {
    const root = await findPkgRoot(import.meta.url);
    const { readFile } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      name?: string;
    };
    expect(pkg.name).toBe('brs-gen');
  });
});
