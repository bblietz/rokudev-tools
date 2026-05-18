import { describe, it, expect } from 'vitest';
import { validateWiring } from '../../src/merger/wiring.js';

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
});
