import { describe, it, expect } from 'vitest';
import { AppSpecV2Wrapper, AppSpecV1Wrapper, ModuleReference } from './app-spec.js';

describe('AppSpecV2Wrapper', () => {
  const base = {
    spec_version: 2 as const,
    template: 'stub_hello',
    modules: [],
    app: { name: 'Test', major_version: 1, minor_version: 0, build_version: 0 },
  };

  it('parses a minimal valid spec', () => {
    expect(AppSpecV2Wrapper.safeParse(base).success).toBe(true);
  });
  it('passes through extra top-level fields (per-template schema enforces strictness in pass 2)', () => {
    // Wrapper is intentionally .passthrough() so per-template fields survive.
    // The per-template schema (T6 / T20 / T22) is .strict() and rejects typos
    // at the full-shape parse step.
    const r = AppSpecV2Wrapper.safeParse({ ...base, nope: 1 });
    expect(r.success).toBe(true);
    if (!r.success) throw new Error('narrowing');
    expect((r.data as Record<string, unknown>).nope).toBe(1);
  });
  it('rejects missing app.name', () => {
    expect(
      AppSpecV2Wrapper.safeParse({
        ...base,
        app: { major_version: 1, minor_version: 0, build_version: 0 },
      }).success,
    ).toBe(false);
  });
  it('accepts module references with optional version_range', () => {
    expect(
      AppSpecV2Wrapper.safeParse({
        ...base,
        modules: [{ id: 'stub_label', config: { text: 'hi' } }],
      }).success,
    ).toBe(true);
  });
  it('requires non-negative integer versions on app.*', () => {
    expect(
      AppSpecV2Wrapper.safeParse({ ...base, app: { ...base.app, major_version: -1 } }).success,
    ).toBe(false);
  });
  it('ModuleReference rejects version_range that is not a string', () => {
    expect(ModuleReference.safeParse({ id: 'x', version_range: 1 }).success).toBe(false);
  });
});

describe('AppSpecV1Wrapper', () => {
  const baseV1 = {
    spec_version: 1 as const,
    template: 'stub_hello',
    app: { name: 'Test', major_version: 1, minor_version: 0, build_version: 0 },
  };

  it('parses a minimal valid v1 spec', () => {
    expect(AppSpecV1Wrapper.safeParse(baseV1).success).toBe(true);
  });

  it('rejects missing app.name in v1', () => {
    expect(
      AppSpecV1Wrapper.safeParse({
        ...baseV1,
        app: { major_version: 0, minor_version: 0, build_version: 0 },
      }).success,
    ).toBe(false);
  });
});

describe('AppSpecV2Wrapper + branding/content', () => {
  const baseApp = { name: 'X', major_version: 1, minor_version: 0, build_version: 0 };

  it('accepts a wrapper without branding or content (back-compat)', () => {
    const r = AppSpecV2Wrapper.safeParse({
      spec_version: 2,
      template: 'stub_hello',
      modules: [],
      app: baseApp,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a wrapper with branding + content', () => {
    const r = AppSpecV2Wrapper.safeParse({
      spec_version: 2,
      template: 'video_grid_channel',
      modules: [],
      app: baseApp,
      branding: { primary_color: '#E50914', icon: 'icon.png', splash: 'splash.png' },
      content: { feed_url: 'https://ex.com/f.json', feed_format: 'roku_direct_publisher_json' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid branding primary_color at wrapper time', () => {
    const r = AppSpecV2Wrapper.safeParse({
      spec_version: 2,
      template: 'video_grid_channel',
      modules: [],
      app: baseApp,
      branding: { primary_color: 'red' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid feed_url at wrapper time', () => {
    const r = AppSpecV2Wrapper.safeParse({
      spec_version: 2,
      template: 'video_grid_channel',
      modules: [],
      app: baseApp,
      content: { feed_url: 'not-a-url', feed_format: 'roku_direct_publisher_json' },
    });
    expect(r.success).toBe(false);
  });
});
