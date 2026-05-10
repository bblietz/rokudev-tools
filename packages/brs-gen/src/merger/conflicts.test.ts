import { describe, it, expect } from 'vitest';
import { detectConflicts } from './conflicts.js';
import type { ModuleToml } from '../catalog/module-toml.js';

const mod = (id: string, files: string[], exclusive: string[] = []): ModuleToml =>
  ({
    module: { id, version: '0.1.0', spec_compat: '>=2', description: '' },
    module_files: { add: files },
    module_conflicts: { exclusive_with: exclusive },
  }) as unknown as ModuleToml;

describe('detectConflicts', () => {
  it('ok when no collisions', () => {
    expect(detectConflicts([mod('a', ['a.bs']), mod('b', ['b.bs'])], []).ok).toBe(true);
  });

  it('MODULE_CONFLICT when A exclusive_with B and both present', () => {
    const r = detectConflicts([mod('a', ['a.bs'], ['b']), mod('b', ['b.bs'])], []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('MODULE_CONFLICT');
  });

  it('FILE_COLLISION when two modules add the same path', () => {
    const r = detectConflicts([mod('a', ['shared.bs']), mod('b', ['shared.bs'])], []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('FILE_COLLISION');
  });

  it('FILE_COLLISION when a module shadows a template file', () => {
    const r = detectConflicts([mod('a', ['source/Main.bs'])], ['source/Main.bs']);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('FILE_COLLISION');
  });

  it('FILE_COLLISION when a module contributes a path under source/_template/', () => {
    const r = detectConflicts([mod('a', ['source/_template/config.brs'])], []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('FILE_COLLISION');
  });
});
