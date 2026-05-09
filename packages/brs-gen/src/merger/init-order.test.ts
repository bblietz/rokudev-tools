import { describe, it, expect } from 'vitest';
import { topoSortInitOrder } from './init-order.js';
import type { ModuleToml } from '../catalog/module-toml.js';

const mod = (id: string, before: string[] = [], after: string[] = []): ModuleToml =>
  ({
    module: { id, version: '0.1.0', spec_compat: '>=2', description: '' },
    module_ordering: { before, after },
  }) as unknown as ModuleToml;

describe('topoSortInitOrder', () => {
  it('returns lexical order when no constraints', () => {
    const r = topoSortInitOrder([mod('c'), mod('a'), mod('b')]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.order).toEqual(['a', 'b', 'c']);
  });
  it('respects before', () => {
    const r = topoSortInitOrder([mod('a', ['b']), mod('b')]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.order).toEqual(['a', 'b']);
  });
  it('respects after', () => {
    const r = topoSortInitOrder([mod('a'), mod('b', [], ['a'])]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.order).toEqual(['a', 'b']);
  });
  it('tie-break lexical when a single layer has multiple independent nodes', () => {
    const r = topoSortInitOrder([mod('x', [], ['z']), mod('y', [], ['z']), mod('z')]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.order).toEqual(['z', 'x', 'y']);
  });
  it('returns INIT_ORDER_CYCLE when cyclic', () => {
    const r = topoSortInitOrder([mod('a', ['b']), mod('b', ['a'])]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('INIT_ORDER_CYCLE');
    expect(r.failure.details?.cycle).toBeDefined();
  });
  it('ignores edges to modules not present', () => {
    const r = topoSortInitOrder([mod('a', ['not-there']), mod('b')]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.order).toEqual(['a', 'b']);
  });
});
