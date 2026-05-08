import { describe, it, expect } from 'vitest';
import { validateWiring } from './wiring.js';

const mkTemplate = (hooks: Array<{ scope: string; phase: string }>, scenes: string[] = []) => ({
  template: { id: 'stub_hello' },
  template_exports: {
    init_hooks: hooks.map((h) => ({ ...h, file: 'x.bs', signature: '()' })),
    scene_nodes: scenes.map((n) => ({ name: n, file: 'x.xml' })),
  },
});
const mkModule = (id: string, reqs: Array<{ kind: 'init_hook'; scope: string; phase: string } | { kind: 'scene_node'; name: string }>,
                  calls: Array<{ hook: string; statement: string }>) => ({
  module: { id, version: '0.1.0', spec_compat: '>=2', description: '' },
  module_wiring: { exports: [], requires: reqs, init_calls: calls },
});

describe('validateWiring', () => {
  it('passes when every require matches an export', () => {
    const t = mkTemplate([{ scope: 'Main', phase: 'before_scene_show' }]);
    const m = mkModule('m', [{ kind: 'init_hook', scope: 'Main', phase: 'before_scene_show' }],
                       [{ hook: 'Main.before_scene_show', statement: 'x()' }]);
    expect(validateWiring(t as any, [m as any]).ok).toBe(true);
  });

  it('WIRING_CONTRACT_VIOLATION when init_hook missing', () => {
    const t = mkTemplate([{ scope: 'Main', phase: 'other_phase' }]);
    const m = mkModule('m', [{ kind: 'init_hook', scope: 'Main', phase: 'before_scene_show' }], []);
    const r = validateWiring(t as any, [m as any]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('WIRING_CONTRACT_VIOLATION');
  });

  it('WIRING_CONTRACT_VIOLATION when scene_node missing', () => {
    const t = mkTemplate([], ['MainScene']);
    const m = mkModule('m', [{ kind: 'scene_node', name: 'OtherScene' }], []);
    const r = validateWiring(t as any, [m as any]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('WIRING_CONTRACT_VIOLATION');
  });

  it('WIRING_CONTRACT_VIOLATION when init_call hook does not match any template init_hook', () => {
    const t = mkTemplate([{ scope: 'Main', phase: 'before_scene_show' }]);
    const m = mkModule('m', [{ kind: 'init_hook', scope: 'Main', phase: 'before_scene_show' }],
                       [{ hook: 'Main.wrong_phase', statement: 'x()' }]);
    const r = validateWiring(t as any, [m as any]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('WIRING_CONTRACT_VIOLATION');
  });
});
