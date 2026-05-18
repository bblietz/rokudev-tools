import { describe, it, expect } from 'vitest';
import {
  buildEmittedProject,
  injectModuleScriptsIntoXml,
  INIT_HOOKS_SCRIPT_PATTERN,
} from './build.js';
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

  it('emits source/_template/config.bs when templateConfigBrs is provided', async () => {
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
    const entry = project.files.find((f) => f.path === 'source/_template/config.bs');
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
    expect(project.files.find((f) => f.path === 'source/_template/config.bs')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// XML <script>-tag injection for module source files
//
// These tests are load-bearing for any module that contributes `source/`-side
// functions invoked from `__init_hooks.bs`. Without the injection, bsc fails
// with error 1140 ("Cannot find function") because component-scope validation
// only sees scripts explicitly listed in the same <component>.
// ---------------------------------------------------------------------------

describe('INIT_HOOKS_SCRIPT_PATTERN', () => {
  it('matches pre-compile __init_hooks.bs', () => {
    const xml = '<script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />';
    expect(INIT_HOOKS_SCRIPT_PATTERN.test(xml)).toBe(true);
  });

  it('matches post-compile __init_hooks.brs', () => {
    const xml = '<script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.brs" />';
    expect(INIT_HOOKS_SCRIPT_PATTERN.test(xml)).toBe(true);
  });

  it('rejects __init_hooks.br (truncated extension)', () => {
    const xml = '<script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.br" />';
    expect(INIT_HOOKS_SCRIPT_PATTERN.test(xml)).toBe(false);
  });

  it('rejects __init_hooks.bss (typo extension)', () => {
    const xml = '<script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bss" />';
    expect(INIT_HOOKS_SCRIPT_PATTERN.test(xml)).toBe(false);
  });

  it('rejects __init_hooks.brss (typo extension)', () => {
    const xml = '<script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.brss" />';
    expect(INIT_HOOKS_SCRIPT_PATTERN.test(xml)).toBe(false);
  });

  it('rejects unrelated script tags', () => {
    const xml = '<script type="text/brightscript" uri="pkg:/source/Main.bs" />';
    expect(INIT_HOOKS_SCRIPT_PATTERN.test(xml)).toBe(false);
  });
});

describe('injectModuleScriptsIntoXml', () => {
  const baseXml = `<?xml version="1.0" encoding="utf-8" ?>
<component name="MainScene" extends="Scene">
  <script type="text/brightscript" uri="MainScene.bs" />
  <script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />
  <children />
</component>`;

  it('inserts <script> tags immediately after the __init_hooks reference', () => {
    const out = injectModuleScriptsIntoXml(baseXml, [
      'source/_modules/m/Hooks.bs',
      'source/_modules/m/config.bs',
    ]);
    expect(out).toContain('<script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />');
    expect(out).toContain(
      '<script type="text/brightscript" uri="pkg:/source/_modules/m/Hooks.bs" />',
    );
    expect(out).toContain(
      '<script type="text/brightscript" uri="pkg:/source/_modules/m/config.bs" />',
    );
    // Ordering: injected tags come AFTER the __init_hooks line.
    const initIdx = out.indexOf('__init_hooks.bs');
    const hooksIdx = out.indexOf('m/Hooks.bs');
    const configIdx = out.indexOf('m/config.bs');
    expect(hooksIdx).toBeGreaterThan(initIdx);
    expect(configIdx).toBeGreaterThan(hooksIdx);
  });

  it('returns input unchanged when modulePaths is empty (no trailing blank line)', () => {
    const out = injectModuleScriptsIntoXml(baseXml, []);
    expect(out).toBe(baseXml);
  });

  it('returns input unchanged when XML does not reference __init_hooks', () => {
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<component name="Other" extends="Scene">
  <script type="text/brightscript" uri="Other.bs" />
</component>`;
    const out = injectModuleScriptsIntoXml(xml, ['source/_modules/m/Hooks.bs']);
    expect(out).toBe(xml);
  });

  it('also patches post-compile XML referencing __init_hooks.brs', () => {
    const xml = baseXml.replace('__init_hooks.bs', '__init_hooks.brs');
    const out = injectModuleScriptsIntoXml(xml, ['source/_modules/m/Hooks.brs']);
    expect(out).toContain(
      '<script type="text/brightscript" uri="pkg:/source/_modules/m/Hooks.brs" />',
    );
  });

  it('does NOT patch XML with a similarly-named but invalid extension (e.g. .bss)', () => {
    const xml = baseXml.replace('__init_hooks.bs', '__init_hooks.bss');
    const out = injectModuleScriptsIntoXml(xml, ['source/_modules/m/Hooks.bs']);
    // No injection occurred; output equals input.
    expect(out).toBe(xml);
  });
});

describe('buildEmittedProject XML script injection integration', () => {
  // Template XML that lists __init_hooks.bs as a component script.
  const xmlBody = `<?xml version="1.0" encoding="utf-8" ?>
<component name="MainScene" extends="Scene">
  <script type="text/brightscript" uri="MainScene.bs" />
  <script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />
  <children />
</component>`;

  const xmlTemplate = {
    template: { id: 't', version: '0.1.0', spec_compat: '>=1', description: '' },
    template_exports: {
      init_hooks: [
        {
          scope: 'MainScene',
          phase: 'after_scene_show',
          file: 'components/MainScene.bs',
          signature: '(m as object) as void',
        },
      ],
      scene_nodes: [{ name: 'MainScene', file: 'components/MainScene.xml' }],
    },
    template_manifest_defaults: { title: 'T', ui_resolutions: 'fhd' },
  };

  const moduleWithSource = {
    module: { id: 'mod_a', version: '0.1.0', spec_compat: '>=2', description: '' },
    module_config_schema: { type: 'object' },
    module_files: { add: ['source/_modules/mod_a/Hooks.bs'] },
    module_wiring: {
      exports: [],
      requires: [],
      init_calls: [],
    },
    module_ordering: { before: [], after: [] },
    module_conflicts: { exclusive_with: [] },
  };

  const renderedXmlFiles = [
    { path: 'components/MainScene.xml', content: xmlBody },
    {
      path: 'components/MainScene.bs',
      content: 'sub init()\n  Modules_OnMainSceneAfterSceneShow(m)\nend sub',
    },
  ];

  const bytesWithMod = new Map<string, Buffer>([
    ['source/_modules/mod_a/Hooks.bs', Buffer.from("' stub\n")],
  ]);

  const specWithMod = {
    spec_version: 2,
    template: 't',
    modules: [{ id: 'mod_a' }],
    app: { name: 'App', major_version: 1, minor_version: 0, build_version: 0 },
  };

  it('injects <script> tags for module .bs files into XML that references __init_hooks', async () => {
    const project = await buildEmittedProject({
      spec: specWithMod as never,
      template: xmlTemplate as never,
      modules: [moduleWithSource as never],
      renderedTemplateFiles: renderedXmlFiles,
      moduleFileBytes: bytesWithMod,
      brsGenVersion: '0.6.0',
    });

    const xmlFile = project.files.find((f) => f.path === 'components/MainScene.xml');
    expect(xmlFile).toBeTruthy();
    const xml = String(xmlFile!.content);
    // Module source .bs file injected as a <script>.
    expect(xml).toContain(
      '<script type="text/brightscript" uri="pkg:/source/_modules/mod_a/Hooks.bs" />',
    );
    // Auto-generated config.bs for the module also injected.
    expect(xml).toContain(
      '<script type="text/brightscript" uri="pkg:/source/_modules/mod_a/config.bs" />',
    );
    // Original __init_hooks reference still present.
    expect(xml).toContain('__init_hooks.bs');
  });

  it('leaves XML unchanged when no modules are configured (preserves no-module byte-identity)', async () => {
    const project = await buildEmittedProject({
      spec: {
        spec_version: 2,
        template: 't',
        modules: [],
        app: { name: 'App', major_version: 1, minor_version: 0, build_version: 0 },
      } as never,
      template: xmlTemplate as never,
      modules: [],
      renderedTemplateFiles: renderedXmlFiles,
      moduleFileBytes: new Map(),
      brsGenVersion: '0.6.0',
    });
    const xmlFile = project.files.find((f) => f.path === 'components/MainScene.xml');
    expect(xmlFile).toBeTruthy();
    // Byte-identical to the input renderedTemplateFiles entry.
    expect(String(xmlFile!.content)).toBe(xmlBody);
  });
});
