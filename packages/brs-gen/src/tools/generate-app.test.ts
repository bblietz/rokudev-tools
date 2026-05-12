import { describe, it, expect, afterAll, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadCatalog } from '../catalog/loader.js';
import { setCatalogForTests, _resetCatalog } from './_catalog-singleton.js';
import { registerAllTools, type ToolDef } from './_register.js';
import './generate-app.js';

// Resolve to the packages/brs-gen directory once for the whole suite.
const PKG_ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function freshTmp(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `brs-gen-t22-${prefix}-`));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function countRealFiles(
  dir: string,
  excludePrefixes: ReadonlyArray<string>,
): Promise<number> {
  let count = 0;
  async function walk(sub: string, relPrefix: string): Promise<void> {
    for (const ent of await readdir(sub, { withFileTypes: true })) {
      const rel = relPrefix ? `${relPrefix}/${ent.name}` : ent.name;
      if (excludePrefixes.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
      if (ent.isDirectory()) await walk(join(sub, ent.name), rel);
      else if (ent.isFile()) count++;
    }
  }
  await walk(dir, '');
  return count;
}

function getHandler(): ToolDef['handler'] {
  const tools = new Map<string, ToolDef>();
  registerAllTools(tools);
  const def = tools.get('generate_app');
  if (!def) throw new Error('generate_app not registered');
  return def.handler;
}

function parsePayload(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') {
    throw new Error('no payload on result');
  }
  return result as Record<string, unknown>;
}

async function makeSourcePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 0x00, g: 0x00, b: 0x00 } },
  })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

describe('generate_app tool', () => {
  beforeAll(async () => {
    // Load the bundled stub catalog once; the tool reads via getCatalog().
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);
  });

  describe('happy path', () => {
    let outputDir: string;
    let parent: string;
    beforeEach(async () => {
      parent = await freshTmp('hp-parent');
      // writeProject does an atomic rename ONTO outputDir, so outputDir itself
      // must not exist as the final target. We pass a not-yet-created child.
      outputDir = join(parent, 'project');
    });
    afterEach(async () => {
      await rm(parent, { recursive: true, force: true });
    });

    it('generates a project with expected files', async () => {
      const handler = getHandler();
      const result = await handler({
        spec: {
          spec_version: 2,
          template: 'stub_hello',
          modules: [{ id: 'stub_label', version_range: '^0.1.0', config: { text: 'hi' } }],
          app: { name: 'Hi', major_version: 1, minor_version: 0, build_version: 0 },
        },
        output_dir: outputDir,
      });
      const payload = parsePayload(result);
      expect(payload['ok']).toBe(true);
      expect(payload['project_dir']).toBe(outputDir);
      expect(Array.isArray(payload['manifest_keys'])).toBe(true);

      // Core files present.
      expect(await pathExists(join(outputDir, 'manifest'))).toBe(true);
      expect(await pathExists(join(outputDir, 'source/Main.brs'))).toBe(true);
      expect(await pathExists(join(outputDir, 'source/_modules/stub_label/Init.brs'))).toBe(true);
      expect(await pathExists(join(outputDir, 'source/_modules/stub_label/config.brs'))).toBe(true);
      expect(await pathExists(join(outputDir, 'source/_modules/__init_hooks.brs'))).toBe(true);
      expect(await pathExists(join(outputDir, '.rokudev-tools/provenance.json'))).toBe(true);

      // Post-compile sweep removed .bs sources.
      expect(await pathExists(join(outputDir, 'source/Main.bs'))).toBe(false);

      // Source map was moved into the tooling dir.
      expect(
        await pathExists(join(outputDir, '.rokudev-tools/sourcemaps/source/Main.brs.map')),
      ).toBe(true);
    });

    it('files_written matches on-disk count excluding staging+sourcemaps', async () => {
      const handler = getHandler();
      const result = await handler({
        spec: {
          spec_version: 2,
          template: 'stub_hello',
          modules: [{ id: 'stub_label', version_range: '^0.1.0', config: { text: 'hi' } }],
          app: { name: 'Hi', major_version: 1, minor_version: 0, build_version: 0 },
        },
        output_dir: outputDir,
      });
      const payload = parsePayload(result);
      const expected = await countRealFiles(outputDir, [
        '.rokudev-tools/staging',
        '.rokudev-tools/sourcemaps',
      ]);
      expect(payload['files_written']).toBe(expected);
    });
  });

  describe('errors', () => {
    it('OUTPUT_DIR_NOT_EMPTY when output_dir is non-empty and overwrite is not set', async () => {
      const dir = await freshTmp('notempty');
      try {
        // Seed a stray file so writeProject refuses without overwrite.
        await writeFile(join(dir, 'stray.txt'), 'noise');
        const handler = getHandler();
        await expect(
          handler({
            spec: {
              spec_version: 2,
              template: 'stub_hello',
              modules: [],
              app: { name: 'X', major_version: 1, minor_version: 0, build_version: 0 },
            },
            output_dir: dir,
          }),
        ).rejects.toMatchObject({ code: 'OUTPUT_DIR_NOT_EMPTY' });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('rejects spec.freeform with NOT_IMPLEMENTED', async () => {
      const parent = await freshTmp('freeform');
      try {
        const handler = getHandler();
        await expect(
          handler({
            spec: {
              spec_version: 2,
              template: 'stub_hello',
              modules: [],
              app: { name: 'X', major_version: 1, minor_version: 0, build_version: 0 },
              freeform: { prompt: 'hi' },
            },
            output_dir: join(parent, 'project'),
          }),
        ).rejects.toMatchObject({
          code: 'NOT_IMPLEMENTED',
          details: expect.objectContaining({ field: 'spec.freeform' }),
        });
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it('template-strict schema rejects a top-level typo with APP_SPEC_INVALID', async () => {
      const parent = await freshTmp('strict');
      try {
        const handler = getHandler();
        await expect(
          handler({
            spec: {
              spec_version: 2,
              template: 'stub_hello',
              modules: [],
              app: { name: 'X', major_version: 1, minor_version: 0, build_version: 0 },
              wrong_key: 1,
            },
            output_dir: join(parent, 'project'),
          }),
        ).rejects.toMatchObject({
          code: 'APP_SPEC_INVALID',
          details: expect.objectContaining({ template_id: 'stub_hello' }),
        });
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it('raises APP_SPEC_INVALID when spec path does not exist', async () => {
      const handler = getHandler();
      const missing = join(tmpdir(), `brs-gen-t22-missing-${Date.now()}-${Math.random()}.json`);
      const parent = await freshTmp('missing');
      try {
        await expect(
          handler({ spec: missing, output_dir: join(parent, 'project') }),
        ).rejects.toMatchObject({
          code: 'APP_SPEC_INVALID',
          details: expect.objectContaining({ given: missing }),
        });
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it('inline JSON with syntax error raises APP_SPEC_INVALID', async () => {
      const handler = getHandler();
      const parent = await freshTmp('badinline');
      try {
        await expect(
          handler({ spec: '{broken', output_dir: join(parent, 'project') }),
        ).rejects.toMatchObject({
          code: 'APP_SPEC_INVALID',
          message: expect.stringMatching(/spec is not valid JSON/i),
        });
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it('spec file with malformed JSON raises APP_SPEC_INVALID', async () => {
      const parent = await freshTmp('badfile');
      try {
        const specPath = join(parent, 'bad.json');
        await writeFile(specPath, '{broken');
        const handler = getHandler();
        await expect(
          handler({ spec: specPath, output_dir: join(parent, 'project') }),
        ).rejects.toMatchObject({
          code: 'APP_SPEC_INVALID',
          message: expect.stringMatching(/spec file contains invalid JSON/i),
          details: expect.objectContaining({ given_path: specPath }),
        });
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });
  });

  describe('warnings', () => {
    it('surfaces SPEC_AUTO_PROMOTED when a v1 spec is passed', async () => {
      const parent = await freshTmp('promote');
      try {
        const handler = getHandler();
        const result = await handler({
          spec: {
            spec_version: 1,
            template: 'stub_hello',
            app: { name: 'P', major_version: 1, minor_version: 0, build_version: 0 },
          },
          output_dir: join(parent, 'project'),
        });
        const payload = parsePayload(result);
        expect(payload['ok']).toBe(true);
        const details = payload['details'] as { warnings?: Array<{ code: string }> } | undefined;
        const codes = (details?.warnings ?? []).map((w) => w.code);
        expect(codes).toContain('SPEC_AUTO_PROMOTED');
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });
  });

  describe('spec input shapes', () => {
    it('accepts inline JSON with a leading BOM', async () => {
      const parent = await freshTmp('bom');
      try {
        const handler = getHandler();
        const specString =
          '\uFEFF' +
          JSON.stringify({
            spec_version: 2,
            template: 'stub_hello',
            modules: [],
            app: { name: 'Hi', major_version: 1, minor_version: 0, build_version: 0 },
          });
        const result = await handler({
          spec: specString,
          output_dir: join(parent, 'project'),
        });
        const payload = parsePayload(result);
        expect(payload['ok']).toBe(true);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it('accepts an inline JSON string (leading "{")', async () => {
      const parent = await freshTmp('inline');
      try {
        const handler = getHandler();
        const specString = JSON.stringify({
          spec_version: 2,
          template: 'stub_hello',
          modules: [],
          app: { name: 'Inline', major_version: 1, minor_version: 0, build_version: 0 },
        });
        const result = await handler({
          spec: specString,
          output_dir: join(parent, 'project'),
        });
        const payload = parsePayload(result);
        expect(payload['ok']).toBe(true);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it('accepts a filesystem path to a JSON spec file', async () => {
      const parent = await freshTmp('path');
      try {
        const specPath = join(parent, 'spec.json');
        await writeFile(
          specPath,
          JSON.stringify({
            spec_version: 2,
            template: 'stub_hello',
            modules: [],
            app: { name: 'FromFile', major_version: 1, minor_version: 0, build_version: 0 },
          }),
        );
        const handler = getHandler();
        const result = await handler({
          spec: specPath,
          output_dir: join(parent, 'project'),
        });
        const payload = parsePayload(result);
        expect(payload['ok']).toBe(true);
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it('treats args.zip: null as no-zip (does not crash, no zip_path)', async () => {
      const parent = await freshTmp('zipnull');
      try {
        const handler = getHandler();
        const result = await handler({
          spec: {
            spec_version: 2,
            template: 'stub_hello',
            modules: [],
            app: { name: 'ZN', major_version: 1, minor_version: 0, build_version: 0 },
          },
          output_dir: join(parent, 'project'),
          zip: null,
        });
        const payload = parsePayload(result);
        expect(payload['ok']).toBe(true);
        expect(payload['zip_path']).toBeUndefined();
        expect(payload['zip_bytes']).toBeUndefined();
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });
  });

  describe('sideload guardrails', () => {
    it('missing sideload.dev_password -> DEVICE_NO_PASSWORD', async () => {
      const parent = await freshTmp('sl-nopw');
      try {
        const handler = getHandler();
        await expect(
          handler({
            spec: {
              spec_version: 2,
              template: 'stub_hello',
              modules: [],
              app: { name: 'S', major_version: 1, minor_version: 0, build_version: 0 },
            },
            output_dir: join(parent, 'project'),
            zip: true,
            sideload: { device: '10.0.0.2' },
          }),
        ).rejects.toMatchObject({ code: 'DEVICE_NO_PASSWORD' });
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it('missing sideload.device -> DEVICE_NOT_RESOLVED', async () => {
      const parent = await freshTmp('sl-nodev');
      try {
        const handler = getHandler();
        await expect(
          handler({
            spec: {
              spec_version: 2,
              template: 'stub_hello',
              modules: [],
              app: { name: 'S', major_version: 1, minor_version: 0, build_version: 0 },
            },
            output_dir: join(parent, 'project'),
            zip: true,
            sideload: { dev_password: '1234' },
          }),
        ).rejects.toMatchObject({ code: 'DEVICE_NOT_RESOLVED' });
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });

    it('sideload requested without zip -> NOT_IMPLEMENTED', async () => {
      const parent = await freshTmp('sl-nozip');
      try {
        const handler = getHandler();
        await expect(
          handler({
            spec: {
              spec_version: 2,
              template: 'stub_hello',
              modules: [],
              app: { name: 'S', major_version: 1, minor_version: 0, build_version: 0 },
            },
            output_dir: join(parent, 'project'),
            sideload: { device: '10.0.0.2', dev_password: '1234' },
          }),
        ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });
  });

  describe('Plan 4 asset block regression (stub_hello)', () => {
    it('stub_hello path unaffected by Plan 4 asset block (no branding -> no asset buckets)', async () => {
      const parent = await freshTmp('t14-noasset');
      try {
        const handler = getHandler();
        const result = await handler({
          spec: {
            spec_version: 2,
            template: 'stub_hello',
            modules: [],
            app: { name: 'X', major_version: 1, minor_version: 0, build_version: 0 },
          },
          output_dir: join(parent, 'project'),
        });
        const payload = parsePayload(result);
        expect(payload['ok']).toBe(true);

        // No splash_screen_uhd key: stub_hello manifest_defaults don't include it,
        // and the asset pipeline was not triggered (no branding.splash supplied).
        const manifestKeys = payload['manifest_keys'] as string[];
        expect(manifestKeys).not.toEqual(expect.arrayContaining(['splash_screen_uhd']));

        // No source/_template/config.brs file emitted (templateConfigBrs path skipped).
        expect(await pathExists(join(parent, 'project', 'source/_template/config.brs'))).toBe(
          false,
        );
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });
  });

  describe('generate_app video_grid_channel happy path', () => {
    it('produces bucketed icon+splash files, template-config.brs, and asset manifest keys', async () => {
      const work = await mkdtemp(join(tmpdir(), 'brs-gen-p4-'));
      try {
        await writeFile(join(work, 'icon.png'), await makeSourcePng(336, 218));
        await writeFile(join(work, 'splash.png'), await makeSourcePng(3840, 2160));

        const spec = {
          spec_version: 2,
          template: 'video_grid_channel',
          modules: [],
          app: { name: 'Sample', major_version: 0, minor_version: 1, build_version: 0 },
          branding: { primary_color: '#E50914', icon: 'icon.png', splash: 'splash.png' },
          content: {
            feed_url: 'https://example.com/feed.json',
            feed_format: 'roku_direct_publisher_json',
          },
        };
        const specPath = join(work, 'spec.json');
        await writeFile(specPath, JSON.stringify(spec));

        const handler = getHandler();
        const result = await handler({
          spec: specPath,
          output_dir: join(work, 'project'),
        });
        const out = parsePayload(result);
        expect(out['ok']).toBe(true);
        expect(out['manifest_keys']).toEqual(
          expect.arrayContaining([
            'mm_icon_focus_hd',
            'mm_icon_focus_fhd',
            'splash_screen_hd',
            'splash_screen_fhd',
            'splash_screen_uhd',
          ]),
        );
        const projectDir = join(work, 'project');
        for (const rel of [
          'images/icon_hd.png',
          'images/icon_fhd.png',
          'images/splash_hd.png',
          'images/splash_fhd.png',
          'images/splash_uhd.png',
          'source/_template/config.brs',
        ]) {
          const bytes = await readFile(join(projectDir, rel));
          expect(bytes.byteLength).toBeGreaterThan(0);
        }
        const cfg = (await readFile(join(projectDir, 'source/_template/config.brs'))).toString(
          'utf8',
        );
        expect(cfg).toContain('feed_url: "https://example.com/feed.json"');
        expect(cfg).toContain('primary_color: "#E50914"');
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });

    it('rejects icon source_too_small with ASSET_VALIDATION_FAILED', async () => {
      const work = await mkdtemp(join(tmpdir(), 'brs-gen-p4-small-'));
      try {
        // 100x100 is below ICON_SOURCE_MIN (336x218).
        await writeFile(join(work, 'icon.png'), await makeSourcePng(100, 100));
        await writeFile(join(work, 'splash.png'), await makeSourcePng(3840, 2160));

        const spec = {
          spec_version: 2,
          template: 'video_grid_channel',
          modules: [],
          app: { name: 'Tiny', major_version: 0, minor_version: 1, build_version: 0 },
          branding: { primary_color: '#000000', icon: 'icon.png', splash: 'splash.png' },
          content: {
            feed_url: 'https://example.com/feed.json',
            feed_format: 'roku_direct_publisher_json',
          },
        };
        const specPath = join(work, 'spec.json');
        await writeFile(specPath, JSON.stringify(spec));

        const handler = getHandler();
        await expect(
          handler({ spec: specPath, output_dir: join(work, 'project') }),
        ).rejects.toMatchObject({
          code: 'ASSET_VALIDATION_FAILED',
          details: expect.objectContaining({ reason: 'source_too_small' }),
        });
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });

    it('rejects non-PNG icon with ASSET_VALIDATION_FAILED reason not_a_png', async () => {
      const work = await mkdtemp(join(tmpdir(), 'brs-gen-p4-notpng-'));
      try {
        // Write plain text instead of a PNG.
        await writeFile(join(work, 'icon.png'), Buffer.from('this is not a png file', 'utf8'));
        await writeFile(join(work, 'splash.png'), await makeSourcePng(3840, 2160));

        const spec = {
          spec_version: 2,
          template: 'video_grid_channel',
          modules: [],
          app: { name: 'Bad', major_version: 0, minor_version: 1, build_version: 0 },
          branding: { primary_color: '#000000', icon: 'icon.png', splash: 'splash.png' },
          content: {
            feed_url: 'https://example.com/feed.json',
            feed_format: 'roku_direct_publisher_json',
          },
        };
        const specPath = join(work, 'spec.json');
        await writeFile(specPath, JSON.stringify(spec));

        const handler = getHandler();
        await expect(
          handler({ spec: specPath, output_dir: join(work, 'project') }),
        ).rejects.toMatchObject({
          code: 'ASSET_VALIDATION_FAILED',
          details: expect.objectContaining({ reason: 'not_a_png' }),
        });
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });

    it('accepts absolute paths for branding.icon / branding.splash', async () => {
      const work = await mkdtemp(join(tmpdir(), 'brs-gen-p4-abs-'));
      try {
        const iconAbs = join(work, 'icon.png');
        const splashAbs = join(work, 'splash.png');
        await writeFile(iconAbs, await makeSourcePng(336, 218));
        await writeFile(splashAbs, await makeSourcePng(3840, 2160));

        const spec = {
          spec_version: 2,
          template: 'video_grid_channel',
          modules: [],
          app: { name: 'X', major_version: 0, minor_version: 1, build_version: 0 },
          branding: { primary_color: '#000000', icon: iconAbs, splash: splashAbs },
          content: {
            feed_url: 'https://example.com/f.json',
            feed_format: 'roku_direct_publisher_json',
          },
        };
        // Pass spec INLINE as an object so specOrigin is null; only the absolute branch works.
        const handler = getHandler();
        const result = await handler({ spec, output_dir: join(work, 'project') });
        const out = parsePayload(result);
        expect(out['ok']).toBe(true);
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    });
  });

  describe('generate_app — template_branding_defaults synthesis path', () => {
    // The fixture template 'template-with-static-branding-default' declares:
    //   template_branding_defaults.icon = 'assets/icon.png'   (336x218 real PNG)
    //   template_branding_defaults.primary_color = '#123456'
    // It does NOT declare a splash default. So with a spec that has no branding:
    //   icon   -> source='template-static'  (read from templates/<id>/assets/icon.png)
    //   splash -> source='synthesized'      (effectivePrimaryColor = '#123456')
    //
    // The fixture lives at tests/fixtures/template-with-static-branding-default/ and
    // must NOT be committed into packages/brs-gen/templates/ (that would ship it as
    // a real catalog entry). Instead, beforeAll copies it into PKG_ROOT/templates/
    // temporarily so the module-level pkgRoot lookups in generate-app.ts resolve
    // correctly, then injects the catalog via setCatalogForTests. afterAll removes
    // the copy and restores the bundled catalog.
    const FIXTURE_SRC = join(PKG_ROOT, 'tests/fixtures/template-with-static-branding-default');
    const FIXTURE_DST = join(PKG_ROOT, 'templates/template-with-static-branding-default');

    beforeAll(async () => {
      await cp(FIXTURE_SRC, FIXTURE_DST, { recursive: true });
      const cat = await loadCatalog(PKG_ROOT);
      setCatalogForTests(cat);
    });

    afterAll(async () => {
      await rm(FIXTURE_DST, { recursive: true, force: true });
      // Restore the bundled catalog (without the fixture) so downstream
      // describe blocks are unaffected.
      const bundledCat = await loadCatalog(PKG_ROOT);
      setCatalogForTests(bundledCat);
    });

    it('uses template-static icon and synthesizes splash when spec has no branding', async () => {
      const parent = await freshTmp('tbrand');
      try {
        const handler = getHandler();
        const result = await handler({
          spec: {
            spec_version: 2,
            template: 'template-with-static-branding-default',
            modules: [],
            app: { name: 'BrandTest', major_version: 1, minor_version: 0, build_version: 0 },
          },
          output_dir: join(parent, 'project'),
        });
        const payload = parsePayload(result);
        expect(payload['ok']).toBe(true);

        // Icon buckets: template-static path -> icon hd + fhd emitted.
        const manifestKeys = payload['manifest_keys'] as string[];
        expect(manifestKeys).toEqual(
          expect.arrayContaining(['mm_icon_focus_hd', 'mm_icon_focus_fhd']),
        );

        // Splash buckets: synthesized from effectivePrimaryColor=#123456.
        expect(manifestKeys).toEqual(
          expect.arrayContaining(['splash_screen_hd', 'splash_screen_fhd', 'splash_screen_uhd']),
        );

        // Physical PNG files written.
        const projectDir = join(parent, 'project');
        for (const rel of [
          'images/icon_hd.png',
          'images/icon_fhd.png',
          'images/splash_hd.png',
          'images/splash_fhd.png',
          'images/splash_uhd.png',
        ]) {
          const bytes = await readFile(join(projectDir, rel));
          expect(bytes.byteLength, `${rel} should be non-empty`).toBeGreaterThan(0);
        }
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    });
  });

  describe('generate_app — blank_scenegraph zero-input spec', () => {
    it('generates a valid channel tree from {spec_version, template, modules:[], app:{}}', async () => {
      const tmp = await mkdtemp(join(tmpdir(), 'gen-blank-'));
      const outDir = join(tmp, 'out');
      try {
        const handler = getHandler();
        const res = parsePayload(
          await handler({
            spec: {
              spec_version: 2,
              template: 'blank_scenegraph',
              modules: [],
              app: { name: 'Blank Test', major_version: 0, minor_version: 0, build_version: 1 },
            },
            output_dir: outDir,
          }),
        );
        expect(res['ok']).toBe(true);
        // Synthesized assets present.
        expect(res['manifest_keys']).toContain('mm_icon_focus_hd');
        expect(res['manifest_keys']).toContain('mm_icon_focus_fhd');
        expect(res['manifest_keys']).toContain('splash_screen_hd');
        expect(res['manifest_keys']).toContain('splash_screen_fhd');
        expect(res['manifest_keys']).toContain('splash_screen_uhd');
        // init_order empty (no modules).
        expect(res['init_order']).toEqual([]);
        // Key files exist on disk post-compile.
        await stat(join(outDir, 'manifest'));
        await stat(join(outDir, 'components/MainScene.xml'));
        await stat(join(outDir, 'components/MainScene.brs'));
        await stat(join(outDir, 'source/Main.brs'));
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('sideload happy path (mocked portal)', () => {
    // Only this sub-block mocks @rokudev/device-client so the real fail() /
    // RegistryReader / etc. remain intact for every other test in the file.
    // We mock the default export module in a nested describe so the vi.mock
    // applies only after setup here.
    const mockSideload = vi.fn(async (_zipPath: string) => ({
      ok: true as const,
      status: 'installed',
    }));

    beforeAll(() => {
      vi.doMock('@rokudev/device-client', async (importOriginal) => {
        const original = await importOriginal<typeof import('@rokudev/device-client')>();
        return {
          ...original,
          DevPortal: class {
            constructor(_host: string, _password: string) {
              /* no-op */
            }
            async sideload(zipPath: string) {
              return mockSideload(zipPath);
            }
          },
        };
      });
    });

    it('invokes DevPortal.sideload with the zip path and surfaces its result', async () => {
      mockSideload.mockResolvedValueOnce({ ok: true, status: 'installed' });
      // Re-import generate-app under the mocked module graph.
      vi.resetModules();
      await import('./generate-app.js');
      // Re-seed catalog after resetModules() (singleton lives in a new module
      // instance now).
      const { setCatalogForTests: setCatAgain } = await import('./_catalog-singleton.js');
      const { loadCatalog: loadAgain } = await import('../catalog/loader.js');
      const cat = await loadAgain(PKG_ROOT);
      setCatAgain(cat);
      const { registerAllTools: regAgain } = await import('./_register.js');
      const tools = new Map<string, ToolDef>();
      regAgain(tools);
      const handler = tools.get('generate_app')!.handler;

      const parent = await freshTmp('sl-ok');
      try {
        const result = await handler({
          spec: {
            spec_version: 2,
            template: 'stub_hello',
            modules: [],
            app: { name: 'SL', major_version: 1, minor_version: 0, build_version: 0 },
          },
          output_dir: join(parent, 'project'),
          zip: true,
          sideload: { device: '10.0.0.2', dev_password: '1234' },
        });
        const payload = parsePayload(result);
        expect(payload['ok']).toBe(true);
        expect(payload['sideload']).toEqual({ ok: true, status: 'installed' });
        expect(mockSideload).toHaveBeenCalledTimes(1);
        const callArg = mockSideload.mock.calls[0]?.[0] ?? '';
        expect(callArg).toMatch(/\.zip$/);
        // Payload must not leak the dev_password.
        const text = JSON.stringify(payload);
        expect(text).not.toContain('1234');
      } finally {
        await rm(parent, { recursive: true, force: true });
        vi.doUnmock('@rokudev/device-client');
        vi.resetModules();
      }
    });
  });
});

describe('TemplateConfig live_label threading', () => {
  // Note: news_channel template is created in Task 2. Until then these tests
  // fail with "Unknown template: news_channel". After Task 2's first commit
  // they proceed to fail with file-not-found errors against the component
  // XMLs (which Tasks 5-9 populate). After Task 9 both should pass.
  beforeAll(async () => {
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);
  });

  afterAll(async () => {
    // Restore the bundled catalog so downstream describe blocks are unaffected.
    const bundledCat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(bundledCat);
  });

  it('threads spec.content.live_label into emitted TemplateConfig() body', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'brs-gen-live-label-'));
    try {
      const handler = getHandler();
      const result = await handler({
        spec: {
          spec_version: 2,
          template: 'news_channel',
          modules: [],
          app: { name: 'NewsTest', major_version: 0, minor_version: 1, build_version: 0 },
          content: { live_label: 'AO VIVO' },
        },
        output_dir: join(tmpDir, 'out'),
        overwrite: true,
      });
      const payload = parsePayload(result);
      expect(payload['ok']).toBe(true);
      const configBs = await readFile(
        join(tmpDir, 'out', 'source', '_template', 'config.bs'),
        'utf8',
      );
      expect(configBs).toContain('"live_label"');
      expect(configBs).toContain('"AO VIVO"');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('omits live_label key when spec.content.live_label is absent', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'brs-gen-live-label-absent-'));
    try {
      const handler = getHandler();
      const result = await handler({
        spec: {
          spec_version: 2,
          template: 'news_channel',
          modules: [],
          app: { name: 'NewsTest', major_version: 0, minor_version: 1, build_version: 0 },
        },
        output_dir: join(tmpDir, 'out'),
        overwrite: true,
      });
      const payload = parsePayload(result);
      expect(payload['ok']).toBe(true);
      const configBs = await readFile(
        join(tmpDir, 'out', 'source', '_template', 'config.bs'),
        'utf8',
      );
      expect(configBs).not.toContain('"live_label"');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
