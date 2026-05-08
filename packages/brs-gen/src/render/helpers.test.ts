import { describe, it, expect } from 'vitest';
import { makeHelpers } from './helpers.js';

describe('render helpers', () => {
  it('xmlEscape escapes ampersand, angle brackets, quotes', () => {
    const h = makeHelpers();
    expect(h.xmlEscape('a & b')).toBe('a &amp; b');
    expect(h.xmlEscape('<tag>')).toBe('&lt;tag&gt;');
    expect(h.xmlEscape('"quoted"')).toBe('&quot;quoted&quot;');
    expect(h.xmlEscape("'apos'")).toBe('&apos;apos&apos;');
  });
  it('hex color passthrough is exact (no escaping)', () => {
    const h = makeHelpers();
    expect(h.xmlEscape('&hFF00FFFF')).toBe('&amp;hFF00FFFF');
  });
});
