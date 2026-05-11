import { describe, it, expect } from 'vitest';
import { TemplateTomlSchema } from './template-toml.js';

const minimal = {
  template: { id: 'stub_hello', version: '0.1.0', spec_compat: '>=1', description: 'x' },
  template_exports: { init_hooks: [], scene_nodes: [] },
  template_manifest_defaults: {},
};

describe('TemplateTomlSchema', () => {
  it('parses minimal', () => {
    expect(TemplateTomlSchema.safeParse(minimal).success).toBe(true);
  });
  it('rejects missing template.id', () => {
    expect(
      TemplateTomlSchema.safeParse({
        ...minimal,
        template: { version: '0.1.0', spec_compat: '>=1', description: 'x' },
      }).success,
    ).toBe(false);
  });
  it('rejects invalid spec_compat semver', () => {
    expect(
      TemplateTomlSchema.safeParse({
        ...minimal,
        template: { ...minimal.template, spec_compat: 'nope' },
      }).success,
    ).toBe(false);
  });
  it('accepts init_hooks entries', () => {
    expect(
      TemplateTomlSchema.safeParse({
        ...minimal,
        template_exports: {
          init_hooks: [
            {
              scope: 'Main',
              phase: 'before_scene_show',
              file: 'source/Main.bs',
              signature: '(args as dynamic) as void',
            },
          ],
          scene_nodes: [{ name: 'MainScene', file: 'components/MainScene.xml' }],
        },
      }).success,
    ).toBe(true);
  });
  it('accepts optional suppressed_warnings', () => {
    expect(
      TemplateTomlSchema.safeParse({
        ...minimal,
        template_suppressed_warnings: { codes: ['HOOK_DISPATCH_NOT_INVOKED'] },
      }).success,
    ).toBe(true);
  });
  it('rejects init_hook.scope with non-identifier characters', () => {
    const bad = {
      ...minimal,
      template_exports: {
        init_hooks: [
          {
            scope: 'my-scope',
            phase: 'before_scene_show',
            file: 'source/Main.bs',
            signature: '(args as dynamic) as void',
          },
        ],
        scene_nodes: [],
      },
    };
    const r = TemplateTomlSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (r.success) throw new Error('narrowing');
    expect(r.error.issues[0]?.message).toMatch(/valid BrightScript identifier/);
  });
  it('rejects init_hook.phase with non-identifier characters', () => {
    const bad = {
      ...minimal,
      template_exports: {
        init_hooks: [
          {
            scope: 'Main',
            phase: 'before-scene-show',
            file: 'source/Main.bs',
            signature: '(args as dynamic) as void',
          },
        ],
        scene_nodes: [],
      },
    };
    const r = TemplateTomlSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (r.success) throw new Error('narrowing');
    expect(r.error.issues[0]?.message).toMatch(/valid BrightScript identifier/);
  });
});

describe('template_branding_defaults', () => {
  function baseValidTemplate() {
    return {
      template: { id: 'x', version: '0.1.0', spec_compat: '>=2', description: 'x' },
      template_manifest_defaults: { title: 'x' },
      template_exports: { init_hooks: [], scene_nodes: [] },
    };
  }

  it('accepts branding_defaults with all three sub-keys', () => {
    const input = {
      ...baseValidTemplate(),
      template_branding_defaults: {
        icon: 'assets/icon.png',
        splash: 'assets/splash.png',
        primary_color: '#123456',
      },
    };
    const r = TemplateTomlSchema.safeParse(input);
    expect(r.success).toBe(true);
  });

  it('accepts branding_defaults with only primary_color', () => {
    const input = {
      ...baseValidTemplate(),
      template_branding_defaults: { primary_color: '#000000' },
    };
    expect(TemplateTomlSchema.safeParse(input).success).toBe(true);
  });

  it('rejects invalid hex in primary_color', () => {
    const input = {
      ...baseValidTemplate(),
      template_branding_defaults: { primary_color: 'not-a-hex' },
    };
    const r = TemplateTomlSchema.safeParse(input);
    expect(r.success).toBe(false);
  });

  it('rejects unknown sub-keys under branding_defaults (strict)', () => {
    const input = {
      ...baseValidTemplate(),
      template_branding_defaults: { primary_color: '#000000', bogus: 'x' },
    };
    expect(TemplateTomlSchema.safeParse(input).success).toBe(false);
  });
});
