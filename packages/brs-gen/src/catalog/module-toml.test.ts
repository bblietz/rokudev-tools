import { describe, it, expect } from 'vitest';
import { ModuleTomlSchema } from './module-toml.js';

const minimal = {
  module: { id: 'stub_label', version: '0.1.0', spec_compat: '>=2', description: 'd' },
  module_config_schema: { type: 'object', properties: {} },
  module_files: { add: [] },
  module_wiring: { exports: [], requires: [], init_calls: [] },
  module_ordering: { before: [], after: [] },
  module_conflicts: { exclusive_with: [] },
};

describe('ModuleTomlSchema', () => {
  it('parses minimal', () => {
    expect(ModuleTomlSchema.safeParse(minimal).success).toBe(true);
  });
  it('rejects missing module.id', () => {
    expect(
      ModuleTomlSchema.safeParse({
        ...minimal,
        module: { version: '0.1.0', spec_compat: '>=2', description: 'd' },
      }).success,
    ).toBe(false);
  });
  it('accepts optional module_manifest', () => {
    expect(
      ModuleTomlSchema.safeParse({ ...minimal, module_manifest: { title: 'x' } }).success,
    ).toBe(true);
  });
  it('validates init_calls entries', () => {
    expect(
      ModuleTomlSchema.safeParse({
        ...minimal,
        module_wiring: {
          exports: [],
          requires: [{ kind: 'init_hook', scope: 'Main', phase: 'before_scene_show' }],
          init_calls: [{ hook: 'Main.before_scene_show', statement: 'StubLabel_init(args)' }],
        },
      }).success,
    ).toBe(true);
  });
  it('rejects module.id with non-identifier characters', () => {
    const bad = {
      ...minimal,
      module: { id: 'my-module', version: '0.1.0', spec_compat: '>=2', description: 'test' },
    };
    const r = ModuleTomlSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (r.success) throw new Error('narrowing');
    expect(r.error.issues[0]?.message).toMatch(/valid BrightScript identifier/);
  });
  it('rejects init_hook.scope with non-identifier characters', () => {
    const bad = {
      ...minimal,
      module_wiring: {
        exports: [],
        requires: [{ kind: 'init_hook', scope: 'my-scope', phase: 'before_scene_show' }],
        init_calls: [],
      },
    };
    const r = ModuleTomlSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (r.success) throw new Error('narrowing');
    expect(r.error.issues[0]?.message).toMatch(/valid BrightScript identifier/);
  });
  it('rejects init_hook.phase with non-identifier characters', () => {
    const bad = {
      ...minimal,
      module_wiring: {
        exports: [],
        requires: [{ kind: 'init_hook', scope: 'Main', phase: 'before-scene-show' }],
        init_calls: [],
      },
    };
    const r = ModuleTomlSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (r.success) throw new Error('narrowing');
    expect(r.error.issues[0]?.message).toMatch(/valid BrightScript identifier/);
  });
});
