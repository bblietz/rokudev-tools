import { describe, it, expect } from 'vitest';
import { SinkRegistry } from './analytics-helpers.js';

describe('SinkRegistry', () => {
  it('returns monotonic positive handle on first add', () => {
    const r = new SinkRegistry();
    expect(r.add('A_handler')).toBe(1);
    expect(r.add('B_handler')).toBe(2);
  });
  it('returns existing handle when same name registered twice', () => {
    const r = new SinkRegistry();
    const h1 = r.add('A_handler');
    expect(r.add('A_handler')).toBe(h1);
    expect(r.list()).toEqual(['A_handler']);
  });
  it('removes by handle and returns true', () => {
    const r = new SinkRegistry();
    const h = r.add('A_handler');
    expect(r.remove(h)).toBe(true);
    expect(r.list()).toEqual([]);
  });
  it('returns false on remove with unknown handle', () => {
    const r = new SinkRegistry();
    expect(r.remove(999)).toBe(false);
  });
  it('preserves registration order in list()', () => {
    const r = new SinkRegistry();
    r.add('Z_handler'); r.add('A_handler'); r.add('M_handler');
    expect(r.list()).toEqual(['Z_handler', 'A_handler', 'M_handler']);
  });
});
