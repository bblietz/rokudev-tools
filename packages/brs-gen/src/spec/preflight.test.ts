import { describe, it, expect } from 'vitest';
import { preflightTemplate } from './preflight.js';

describe('preflightTemplate', () => {
  it('returns ok when template id is in the provided set', () => {
    expect(preflightTemplate('stub_hello', new Set(['stub_hello', 'other']))).toEqual({ ok: true });
  });
  it('returns UNKNOWN_TEMPLATE when not', () => {
    const r = preflightTemplate('missing', new Set(['stub_hello']));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('UNKNOWN_TEMPLATE');
    expect(r.failure.details?.known).toEqual(['stub_hello']);
    expect(r.failure.details?.given).toBe('missing');
    expect(r.failure.details?.stage).toBe('preflight');
  });
});
