import { describe, it, expect } from 'vitest';
import { parseToml } from './toml.js';

describe('parseToml', () => {
  it('parses valid TOML', () => {
    expect(parseToml('[section]\nkey = "v"')).toEqual({ section: { key: 'v' } });
  });
  it('throws on invalid TOML', () => {
    expect(() => parseToml('= = =')).toThrow();
  });
});
