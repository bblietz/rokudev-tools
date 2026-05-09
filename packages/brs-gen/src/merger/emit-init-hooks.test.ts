import { describe, it, expect } from 'vitest';
import { emitInitHooks } from './emit-init-hooks.js';

describe('emitInitHooks', () => {
  it('generates one sub per template hook', () => {
    const hooks = [
      {
        scope: 'Main',
        phase: 'before_scene_show',
        file: 'x.bs',
        signature: '(args as dynamic) as void',
      },
    ];
    const callsByModule = new Map<string, Array<{ hook: string; statement: string }>>();
    const out = emitInitHooks(hooks, [], callsByModule);
    expect(out).toContain('sub Modules_OnMainBeforeSceneShow(args as dynamic) as void');
    expect(out).toContain('end sub');
  });

  it('inserts init_calls in topo order', () => {
    const hooks = [
      {
        scope: 'Main',
        phase: 'before_scene_show',
        file: 'x.bs',
        signature: '(args as dynamic) as void',
      },
    ];
    const callsByModule = new Map([
      ['b', [{ hook: 'Main.before_scene_show', statement: 'B_init(args)' }]],
      ['a', [{ hook: 'Main.before_scene_show', statement: 'A_init(args)' }]],
    ]);
    const out = emitInitHooks(hooks, ['a', 'b'], callsByModule);
    const aIdx = out.indexOf('A_init(args)');
    const bIdx = out.indexOf('B_init(args)');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it('emits empty sub bodies when no module contributes', () => {
    const hooks = [
      {
        scope: 'MainScene.init',
        phase: 'after_content_load',
        file: 'y.bs',
        signature: '(top as roSGNode) as void',
      },
    ];
    const out = emitInitHooks(hooks, [], new Map());
    expect(out).toContain('sub Modules_OnMainSceneInitAfterContentLoad(top as roSGNode) as void');
    expect(out).toContain('end sub');
  });

  it('handles multiple hooks in file', () => {
    const hooks = [
      { scope: 'Main', phase: 'before_scene_show', file: 'x.bs', signature: '(args) as void' },
      { scope: 'Main', phase: 'after_scene_show', file: 'x.bs', signature: '(args) as void' },
    ];
    const out = emitInitHooks(hooks, [], new Map());
    expect(out.match(/sub Modules_On/g)?.length).toBe(2);
  });
});
