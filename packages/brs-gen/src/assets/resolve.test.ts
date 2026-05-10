import { describe, it, expect } from 'vitest';
import { resolveAssetPath } from './resolve.js';
import { isAbsolute, join } from 'node:path';

describe('resolveAssetPath', () => {
  it('returns absolute paths unchanged', () => {
    const abs = '/abs/path/icon.png';
    expect(resolveAssetPath(abs, null)).toBe(abs);
    expect(resolveAssetPath(abs, '/some/spec/dir/spec.json')).toBe(abs);
  });

  it('relative + specOrigin → resolved relative to spec file dir', () => {
    const origin = '/proj/spec.json';
    const resolved = resolveAssetPath('./assets/icon.png', origin);
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(join('/proj', 'assets/icon.png'));
  });

  it('relative + null origin → resolved relative to process.cwd()', () => {
    const resolved = resolveAssetPath('assets/icon.png', null);
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved.startsWith(process.cwd())).toBe(true);
  });
});
