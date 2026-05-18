import { describe, it, expect } from 'vitest';
import { ModuleTomlSchema } from '../../src/catalog/module-toml.js';

describe('ModuleTomlSchema optional_init_calls', () => {
  const baseModule = {
    module: { id: 'x', version: '0.1.0', spec_compat: '>=2', description: 'd' },
    module_config_schema: {},
    module_files: { add: [] },
    module_wiring: {
      exports: [],
      requires: [],
      init_calls: [],
    },
    module_ordering: { before: [], after: [] },
    module_conflicts: { exclusive_with: [] },
  };

  it('defaults optional_init_calls to empty array when omitted', () => {
    const parsed = ModuleTomlSchema.parse(baseModule);
    expect(parsed.module_wiring.optional_init_calls).toEqual([]);
  });

  it('accepts valid optional_init_calls entries', () => {
    const mod = {
      ...baseModule,
      module_wiring: {
        ...baseModule.module_wiring,
        optional_init_calls: [
          { hook: 'MainScene.after_scene_show', statement: 'Foo_bar(m)' },
        ],
      },
    };
    expect(() => ModuleTomlSchema.parse(mod)).not.toThrow();
  });

  it('rejects optional_init_calls entry missing hook field', () => {
    const mod = {
      ...baseModule,
      module_wiring: {
        ...baseModule.module_wiring,
        optional_init_calls: [{ statement: 'Foo()' }],
      },
    };
    expect(() => ModuleTomlSchema.parse(mod)).toThrow();
  });

  it('rejects optional_init_calls entry with extra field (strict mode)', () => {
    const mod = {
      ...baseModule,
      module_wiring: {
        ...baseModule.module_wiring,
        optional_init_calls: [{ hook: 'X.y', statement: 'Z()', extra: 1 }],
      },
    };
    expect(() => ModuleTomlSchema.parse(mod)).toThrow();
  });
});
