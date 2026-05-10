import { describe, it, expect } from 'vitest';
import { buildEmittedProject } from './build.js';
import type { TemplateToml } from '../catalog/template-toml.js';

// A minimal fake catalog-shape. Real types are imported from catalog/ but the
// assembler is tested in isolation with plain objects.
const fakeTemplate = {
  template: { id: 't', version: '0.1.0', spec_compat: '>=1', description: '' },
  template_exports: {
    init_hooks: [
      {
        scope: 'Main',
        phase: 'before_scene_show',
        file: 'source/Main.bs',
        signature: '(args) as void',
      },
    ],
    scene_nodes: [],
  },
  template_manifest_defaults: { title: '<%= spec.app.name %>', ui_resolutions: 'fhd' },
};

const fakeModule = {
  module: { id: 'm', version: '0.1.0', spec_compat: '>=2', description: '' },
  module_config_schema: { type: 'object' },
  module_files: { add: ['source/_modules/m/Init.bs'] },
  module_wiring: {
    exports: [],
    requires: [{ kind: 'init_hook', scope: 'Main', phase: 'before_scene_show' }],
    init_calls: [{ hook: 'Main.before_scene_show', statement: 'M_init(args)' }],
  },
  module_ordering: { before: [], after: [] },
  module_conflicts: { exclusive_with: [] },
};

const fakeSpec = {
  spec_version: 2,
  template: 't',
  modules: [{ id: 'm', config: { text: 'hi' } }],
  app: { name: 'Hi', major_version: 1, minor_version: 0, build_version: 0 },
};

// renderedTemplateFiles is the output of Phase 3's render step; the assembler
// accepts it as input and does not re-render.
const renderedTemplateFiles = [
  {
    path: 'source/Main.bs',
    content: 'sub Main(args): Modules_OnMainBeforeSceneShow(args): end sub',
  },
];
const moduleFileBytes = new Map<string, Buffer>([
  ['source/_modules/m/Init.bs', Buffer.from('sub M_init(args): end sub')],
]);

describe('buildEmittedProject', () => {
  it('assembles a sorted project tree with manifest, config.bs, and __init_hooks.bs', async () => {
    const p = await buildEmittedProject({
      spec: fakeSpec as any,
      template: fakeTemplate as any,
      modules: [fakeModule as any],
      renderedTemplateFiles,
      moduleFileBytes,
      brsGenVersion: '0.3.0',
    });
    const paths = p.files.map((f) => f.path);
    expect(paths).toContain('source/Main.bs');
    expect(paths).toContain('source/_modules/m/Init.bs');
    expect(paths).toContain('source/_modules/m/config.bs');
    expect(paths).toContain('source/_modules/__init_hooks.bs');
    expect(paths).toContain('.rokudev-tools/provenance.json');
    expect(paths).toEqual([...paths].sort());
    expect(p.manifest.get('title')).toBe('Hi');
  });

  it('is deterministic across runs', async () => {
    const a = await buildEmittedProject({
      spec: fakeSpec as any,
      template: fakeTemplate as any,
      modules: [fakeModule as any],
      renderedTemplateFiles,
      moduleFileBytes,
      brsGenVersion: '0.3.0',
    });
    const b = await buildEmittedProject({
      spec: fakeSpec as any,
      template: fakeTemplate as any,
      modules: [fakeModule as any],
      renderedTemplateFiles,
      moduleFileBytes,
      brsGenVersion: '0.3.0',
    });
    expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
    expect(
      a.files.map((f) =>
        typeof f.content === 'string' ? f.content : f.content.toString('base64'),
      ),
    ).toEqual(
      b.files.map((f) =>
        typeof f.content === 'string' ? f.content : f.content.toString('base64'),
      ),
    );
  });

  it('throws APP_SPEC_INVALID when a template_manifest_defaults value has malformed EJS', async () => {
    const badTemplate = {
      ...fakeTemplate,
      template_manifest_defaults: {
        title: '<% throw new Error("malformed EJS template") %>',
      },
    };
    await expect(
      buildEmittedProject({
        spec: fakeSpec as any,
        template: badTemplate as any,
        modules: [fakeModule as any],
        renderedTemplateFiles,
        moduleFileBytes,
        brsGenVersion: '0.3.0',
      }),
    ).rejects.toMatchObject({
      code: 'APP_SPEC_INVALID',
      details: expect.objectContaining({ key: 'title', stage: 'build' }),
    });
  });
});

/** Fixture template matching stub_hello shape but no files — driven through
 *  buildEmittedProject with hand-crafted renderedTemplateFiles. */
const fixtureTemplate: TemplateToml = {
  template: { id: 't', version: '0.1.0', spec_compat: '>=1', description: '' },
  template_manifest_defaults: {
    title: 'X',
    major_version: '1',
    minor_version: '0',
    build_version: '0',
  },
  template_exports: { init_hooks: [], scene_nodes: [] },
};

describe('buildEmittedProject asset integration', () => {
  it('merges assetManifestEntries as set-if-unset (template defaults win)', async () => {
    const project = await buildEmittedProject({
      spec: {
        spec_version: 2,
        template: 't',
        modules: [],
        app: { name: 'X', major_version: 1, minor_version: 0, build_version: 0 },
      } as never,
      template: fixtureTemplate,
      modules: [],
      renderedTemplateFiles: [],
      moduleFileBytes: new Map(),
      brsGenVersion: '0.4.0-dev.0',
      assetBuckets: new Map([['images/icon_hd.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])]]),
      assetManifestEntries: { mm_icon_focus_hd: 'pkg:/images/icon_hd.png' },
    });
    expect(project.manifest.get('mm_icon_focus_hd')).toBe('pkg:/images/icon_hd.png');
    const paths = project.files.map((f) => f.path);
    expect(paths).toContain('images/icon_hd.png');
  });

  it('template default wins over asset entry for the same key', async () => {
    const tpl = { ...fixtureTemplate };
    tpl.template_manifest_defaults = {
      ...tpl.template_manifest_defaults,
      mm_icon_focus_hd: 'pkg:/custom.png',
    };
    const project = await buildEmittedProject({
      spec: {
        spec_version: 2,
        template: 't',
        modules: [],
        app: { name: 'X', major_version: 1, minor_version: 0, build_version: 0 },
      } as never,
      template: tpl,
      modules: [],
      renderedTemplateFiles: [],
      moduleFileBytes: new Map(),
      brsGenVersion: '0.4.0-dev.0',
      assetBuckets: new Map(),
      assetManifestEntries: { mm_icon_focus_hd: 'pkg:/images/icon_hd.png' },
    });
    expect(project.manifest.get('mm_icon_focus_hd')).toBe('pkg:/custom.png');
  });

  it('emits source/_template/config.brs when templateConfigBrs is provided', async () => {
    const project = await buildEmittedProject({
      spec: {
        spec_version: 2,
        template: 't',
        modules: [],
        app: { name: 'X', major_version: 1, minor_version: 0, build_version: 0 },
      } as never,
      template: fixtureTemplate,
      modules: [],
      renderedTemplateFiles: [],
      moduleFileBytes: new Map(),
      brsGenVersion: '0.4.0-dev.0',
      templateConfigBrs:
        "' marker\nfunction TemplateConfig() as object\n  return {}\nend function\n",
    });
    const entry = project.files.find((f) => f.path === 'source/_template/config.brs');
    expect(entry).toBeTruthy();
    expect(String(entry!.content)).toContain("' marker");
  });

  it('omits template-config file when templateConfigBrs is undefined', async () => {
    const project = await buildEmittedProject({
      spec: {
        spec_version: 2,
        template: 't',
        modules: [],
        app: { name: 'X', major_version: 1, minor_version: 0, build_version: 0 },
      } as never,
      template: fixtureTemplate,
      modules: [],
      renderedTemplateFiles: [],
      moduleFileBytes: new Map(),
      brsGenVersion: '0.4.0-dev.0',
    });
    expect(project.files.find((f) => f.path === 'source/_template/config.brs')).toBeUndefined();
  });
});
