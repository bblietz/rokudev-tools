import { describe, it, expect } from 'vitest';
import { escapeBsString, stringifyAsBsValue, sortByPath } from './deterministic.js';

describe('escapeBsString', () => {
  it('wraps in double quotes and escapes embedded quotes', () => {
    expect(escapeBsString('he said "hi"')).toBe('"he said ""hi"""');
  });
  it('leaves plain strings as-is', () => {
    expect(escapeBsString('plain')).toBe('"plain"');
  });
  it('rejects newlines (no BrightScript escape for them)', () => {
    expect(() => escapeBsString('line1\nline2')).toThrow(/control character/);
  });
  it('rejects NUL bytes', () => {
    expect(() => escapeBsString('a\0b')).toThrow(/control character/);
  });
});

describe('stringifyAsBsValue', () => {
  it('handles primitives', () => {
    expect(stringifyAsBsValue('x')).toBe('"x"');
    expect(stringifyAsBsValue(42)).toBe('42');
    expect(stringifyAsBsValue(1.5)).toBe('1.5');
    expect(stringifyAsBsValue(true)).toBe('true');
    expect(stringifyAsBsValue(false)).toBe('false');
    expect(stringifyAsBsValue(null)).toBe('invalid');
  });
  it('emits arrays with sorted-stable element order as provided', () => {
    expect(stringifyAsBsValue(['a', 'b'])).toBe('["a", "b"]');
  });
  it('emits AAs with keys sorted asc', () => {
    expect(stringifyAsBsValue({ b: 1, a: 2 })).toBe('{ a: 2, b: 1 }');
  });
});

describe('sortByPath', () => {
  it('sorts by path ascending', () => {
    const files = [
      { path: 'c.bs', content: '' },
      { path: 'a.bs', content: '' },
    ];
    expect(sortByPath(files).map((f) => f.path)).toEqual(['a.bs', 'c.bs']);
  });
});
