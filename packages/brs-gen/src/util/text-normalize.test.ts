import { describe, it, expect } from 'vitest';
import { normalizeText } from './text-normalize.js';

describe('normalizeText', () => {
  it('strips UTF-8 BOM', () => {
    expect(normalizeText('\uFEFFhello')).toBe('hello');
  });
  it('converts CRLF to LF', () => {
    expect(normalizeText('a\r\nb\r\n')).toBe('a\nb\n');
  });
  it('converts CR to LF', () => {
    expect(normalizeText('a\rb\r')).toBe('a\nb\n');
  });
  it('leaves already-normalised content alone', () => {
    expect(normalizeText('a\nb\n')).toBe('a\nb\n');
  });
});
