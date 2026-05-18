import { describe, it, expect } from 'vitest';
import { mergeIdentity } from './analytics-helpers.js';

describe('mergeIdentity', () => {
  it('adds new keys', () => {
    expect(mergeIdentity({}, { user_id: 'u1' })).toEqual({ user_id: 'u1' });
  });
  it('overwrites existing keys with new value', () => {
    expect(mergeIdentity({ user_id: 'u1' }, { user_id: 'u2' })).toEqual({ user_id: 'u2' });
  });
  it('deletes keys whose new value is null', () => {
    expect(mergeIdentity({ user_id: 'u1', tier: 'pro' }, { tier: null })).toEqual({ user_id: 'u1' });
  });
  it('returns a new object (no mutation)', () => {
    const base = { a: 1 };
    const out = mergeIdentity(base, { b: 2 });
    expect(base).toEqual({ a: 1 });
    expect(out).toEqual({ a: 1, b: 2 });
  });
});
