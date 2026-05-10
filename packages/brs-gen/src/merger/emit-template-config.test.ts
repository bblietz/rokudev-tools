import { describe, it, expect } from 'vitest';
import { emitTemplateConfigBs } from './emit-template-config.js';

describe('emitTemplateConfigBs', () => {
  it('emits a minimal config for an empty object', () => {
    const out = emitTemplateConfigBs({});
    expect(out).toContain('function TemplateConfig() as object');
    expect(out).toContain('return {');
    expect(out).toContain('end function');
  });

  it('sorts keys alphabetically', () => {
    const out = emitTemplateConfigBs({ zebra: 'z', apple: 'a', mango: 'm' });
    // Find the relative positions of the three tokens; apple first, zebra last.
    const ia = out.indexOf('apple:');
    const im = out.indexOf('mango:');
    const iz = out.indexOf('zebra:');
    expect(ia).toBeGreaterThan(-1);
    expect(im).toBeGreaterThan(ia);
    expect(iz).toBeGreaterThan(im);
  });

  it('escapes embedded double-quotes via doubling', () => {
    const out = emitTemplateConfigBs({ name: 'say "hi"' });
    expect(out).toContain('name: "say ""hi"""');
  });

  it('rejects control chars by throwing APP_SPEC_INVALID', () => {
    expect(() => emitTemplateConfigBs({ name: 'bad\nvalue' })).toThrow();
  });

  it('header is auto-generated banner (do not edit)', () => {
    const out = emitTemplateConfigBs({ a: 1 });
    expect(out.startsWith("' Auto-generated")).toBe(true);
  });
});
