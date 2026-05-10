import { describe, it, expect } from 'vitest';
import { BrandingSchema } from './branding.js';

describe('BrandingSchema', () => {
  it('accepts valid #RRGGBB hex color', () => {
    const r = BrandingSchema.safeParse({ primary_color: '#E50914' });
    expect(r.success).toBe(true);
  });

  it('rejects 3-digit hex', () => {
    const r = BrandingSchema.safeParse({ primary_color: '#abc' });
    expect(r.success).toBe(false);
  });

  it('rejects missing leading #', () => {
    const r = BrandingSchema.safeParse({ primary_color: 'E50914' });
    expect(r.success).toBe(false);
  });

  it('accepts icon + splash path strings', () => {
    const r = BrandingSchema.safeParse({
      icon: './assets/icon.png',
      splash: 'assets/splash.png',
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty string for icon path', () => {
    const r = BrandingSchema.safeParse({ icon: '' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown fields via .strict()', () => {
    const r = BrandingSchema.safeParse({
      primary_color: '#000000',
      bogus: 1,
    });
    expect(r.success).toBe(false);
  });
});
