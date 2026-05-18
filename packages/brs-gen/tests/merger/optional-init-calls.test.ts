import { describe, it, expect } from 'vitest';
import { validateWiring } from '../../src/merger/wiring.js';
import { emitInitHooks } from '../../src/merger/emit-init-hooks.js';

// Minimal valid TemplateToml. Only the init_hooks list matters for these tests.
const template = {
  template: { id: 'tmpl_test', version: '0.1.0', spec_compat: '>=2', description: 'd' },
  template_manifest_defaults: {},
  template_branding_defaults: {},
  template_exports: {
    init_hooks: [
      { scope: 'MainScene', phase: 'after_scene_show', file: 'c/M.bs', signature: '(m as object) as void' },
    ],
    scene_nodes: [],
  },
} as const;

// Minimal valid ModuleToml with optional_init_calls populated.
const baseModule = {
  module: { id: 'mod_a', version: '0.1.0', spec_compat: '>=2', description: 'd' },
  module_config_schema: {},
  module_files: { add: [] },
  module_wiring: {
    exports: [],
    requires: [],
    init_calls: [],
    optional_init_calls: [
      { hook: 'MainScene.after_scene_show', statement: 'MatchedFn(m)' },
      { hook: 'PlayerScene.before_play', statement: 'UnmatchedFn(m)' },
    ],
  },
  module_ordering: { before: [], after: [] },
  module_conflicts: { exclusive_with: [] },
} as const;

describe('validateWiring optional_init_calls', () => {
  it('returns ok=true with matchedOptional containing only the matched call', () => {
    const result = validateWiring(template as any, [baseModule as any]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matchedOptional).toEqual([
        { moduleId: 'mod_a', hook: 'MainScene.after_scene_show', statement: 'MatchedFn(m)' },
      ]);
    }
  });

  it('does not fail when optional hooks reference missing template exports', () => {
    const result = validateWiring(template as any, [baseModule as any]);
    expect(result.ok).toBe(true);
  });

  it('returns ok=false with WIRING_OPTIONAL_HOOK_MALFORMED for malformed hook strings', () => {
    const bad = {
      ...baseModule,
      module_wiring: {
        ...baseModule.module_wiring,
        optional_init_calls: [{ hook: 'NoDot', statement: 'X()' }],
      },
    };
    const result = validateWiring(template as any, [bad as any]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('WIRING_OPTIONAL_HOOK_MALFORMED');
    }
  });

  it('returns ok=false with WIRING_OPTIONAL_DUPLICATES_STRICT when same hook in both lists', () => {
    const dup = {
      ...baseModule,
      module_wiring: {
        ...baseModule.module_wiring,
        init_calls: [{ hook: 'MainScene.after_scene_show', statement: 'StrictFn(m)' }],
        optional_init_calls: [{ hook: 'MainScene.after_scene_show', statement: 'OptFn(m)' }],
      },
    };
    const result = validateWiring(template as any, [dup as any]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.code).toBe('WIRING_OPTIONAL_DUPLICATES_STRICT');
    }
  });
});

describe('emitInitHooks with matched optional calls', () => {
  it('emits matched optional calls after strict init_calls within the same hook', () => {
    const hooks = [
      { scope: 'MainScene', phase: 'after_scene_show', file: 'c/M.bs', signature: '(m as object) as void' },
    ];
    const initOrder = ['strict_mod', 'opt_mod'];
    const callsByModule = new Map([
      ['strict_mod', [{ hook: 'MainScene.after_scene_show', statement: 'StrictFn(m)' }]],
    ]);
    const matchedOptional = [
      { moduleId: 'opt_mod', hook: 'MainScene.after_scene_show', statement: 'OptFn(m)' },
    ];
    const out = emitInitHooks(hooks, initOrder, callsByModule, matchedOptional);
    expect(out).toContain('sub Modules_OnMainSceneAfterSceneShow(m as object) as void');
    const lines = out.split('\n');
    const strictIdx = lines.findIndex((l) => l.includes('StrictFn(m)'));
    const optIdx = lines.findIndex((l) => l.includes('OptFn(m)'));
    expect(strictIdx).toBeGreaterThan(-1);
    expect(optIdx).toBeGreaterThan(strictIdx);
  });

  it('emits hook function even when only optional calls match', () => {
    const hooks = [{ scope: 'X', phase: 'y', file: 'f', signature: '() as void' }];
    const matchedOptional = [{ moduleId: 'm', hook: 'X.y', statement: 'OnlyOpt()' }];
    const out = emitInitHooks(hooks, ['m'], new Map(), matchedOptional);
    expect(out).toContain('OnlyOpt()');
  });

  it('emits matched optional calls in initOrder when multiple modules match the same hook', () => {
    const hooks = [{ scope: 'S', phase: 'h', file: 'f', signature: '() as void' }];
    const initOrder = ['opt_a', 'opt_b'];
    // matchedOptional intentionally out of initOrder sequence
    const matchedOptional = [
      { moduleId: 'opt_b', hook: 'S.h', statement: 'BFn()' },
      { moduleId: 'opt_a', hook: 'S.h', statement: 'AFn()' },
    ];
    const out = emitInitHooks(hooks, initOrder, new Map(), matchedOptional);
    const lines = out.split('\n');
    const aIdx = lines.findIndex((l) => l.includes('AFn()'));
    const bIdx = lines.findIndex((l) => l.includes('BFn()'));
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
  });
});
