import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerAllTools, type ToolDef } from './_register.js';
import './validate-assets.js';

// PNG magic bytes (first 8 bytes of every valid PNG file).
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('validate_assets tool', () => {
  let handler: ToolDef['handler'];

  beforeEach(() => {
    const tools = new Map<string, ToolDef>();
    registerAllTools(tools);
    const t = tools.get('validate_assets');
    if (!t) throw new Error('validate_assets not registered');
    handler = t.handler;
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function makeDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'brs-gen-t25-'));
  }

  async function writeManifest(dir: string, text: string): Promise<void> {
    await writeFile(join(dir, 'manifest'), text, 'utf8');
  }

  async function writePng(dir: string, relPath: string, size = 64): Promise<void> {
    const fullPath = join(dir, relPath);
    await mkdir(join(dir, relPath.split('/').slice(0, -1).join('/')), { recursive: true });
    // Start with PNG header, pad to requested size.
    const buf = Buffer.alloc(size);
    PNG_HEADER.copy(buf, 0);
    await writeFile(fullPath, buf);
  }

  async function writeNonPng(dir: string, relPath: string): Promise<void> {
    const fullPath = join(dir, relPath);
    await mkdir(join(dir, relPath.split('/').slice(0, -1).join('/')), { recursive: true });
    await writeFile(fullPath, Buffer.from('not a png file'));
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  it('1. happy path (all valid)', async () => {
    const dir = await makeDir();
    await writeManifest(
      dir,
      'mm_icon_focus_hd=images/icon.png\nsplash_screen_hd=images/splash.png\n',
    );
    await writePng(dir, 'images/icon.png');
    await writePng(dir, 'images/splash.png');

    const r = await handler({ project_dir: dir });
    const payload = JSON.parse((r as { content: [{ text: string }] }).content[0].text) as {
      ok: boolean;
      missing: string[];
      oversize: string[];
      wrong_dimensions: string[];
    };

    expect(payload.ok).toBe(true);
    expect(payload.missing).toEqual([]);
    expect(payload.oversize).toEqual([]);
    expect(payload.wrong_dimensions).toEqual([]);
  });

  it('2. missing file', async () => {
    const dir = await makeDir();
    await writeManifest(dir, 'mm_icon_focus_hd=images/icon.png\n');
    // Do NOT write the icon file.

    const r = await handler({ project_dir: dir });
    const payload = JSON.parse((r as { content: [{ text: string }] }).content[0].text) as {
      ok: boolean;
      failure: {
        code: string;
        details: { missing: string[]; not_png: string[]; oversize: string[]; wrong_dimensions: string[] };
      };
    };

    expect(payload.ok).toBe(false);
    expect(payload.failure.code).toBe('ASSET_VALIDATION_FAILED');
    expect(payload.failure.details.missing).toEqual(['images/icon.png']);
  });

  it('3. not PNG (file exists but wrong magic bytes)', async () => {
    const dir = await makeDir();
    await writeManifest(dir, 'mm_icon_focus_hd=images/icon.png\n');
    await writeNonPng(dir, 'images/icon.png');

    const r = await handler({ project_dir: dir });
    const payload = JSON.parse((r as { content: [{ text: string }] }).content[0].text) as {
      ok: boolean;
      failure: {
        code: string;
        details: { missing: string[]; not_png: string[]; oversize: string[]; wrong_dimensions: string[] };
      };
    };

    expect(payload.ok).toBe(false);
    expect(payload.failure.code).toBe('ASSET_VALIDATION_FAILED');
    expect(payload.failure.details.not_png).toEqual(['images/icon.png']);
  });

  it('4. oversize (>= 1 MB)', async () => {
    const dir = await makeDir();
    await writeManifest(dir, 'mm_icon_focus_hd=images/icon.png\n');
    // Write 1 MB file starting with PNG header.
    await writePng(dir, 'images/icon.png', 1_048_576);

    const r = await handler({ project_dir: dir });
    const payload = JSON.parse((r as { content: [{ text: string }] }).content[0].text) as {
      ok: boolean;
      failure: {
        code: string;
        details: { missing: string[]; not_png: string[]; oversize: string[]; wrong_dimensions: string[] };
      };
    };

    expect(payload.ok).toBe(false);
    expect(payload.failure.code).toBe('ASSET_VALIDATION_FAILED');
    expect(payload.failure.details.oversize).toEqual(['images/icon.png']);
  });

  it('5. pkg:/ prefix stripping', async () => {
    const dir = await makeDir();
    await writeManifest(dir, 'mm_icon_focus_hd=pkg:/images/icon.png\n');
    await writePng(dir, 'images/icon.png');

    const r = await handler({ project_dir: dir });
    const payload = JSON.parse((r as { content: [{ text: string }] }).content[0].text) as {
      ok: boolean;
      missing: string[];
      oversize: string[];
      wrong_dimensions: string[];
    };

    expect(payload.ok).toBe(true);
    expect(payload.missing).toEqual([]);
  });

  it('6. multiple failures aggregated', async () => {
    const dir = await makeDir();
    await writeManifest(
      dir,
      [
        'mm_icon_focus_hd=images/icon_missing.png',
        'mm_icon_focus_sd=images/icon_bad.png',
        'splash_screen_hd=images/splash_big.png',
      ].join('\n') + '\n',
    );
    // icon_missing.png: does not exist.
    // icon_bad.png: not PNG.
    await writeNonPng(dir, 'images/icon_bad.png');
    // splash_big.png: oversize with PNG header.
    await writePng(dir, 'images/splash_big.png', 1_048_576);

    const r = await handler({ project_dir: dir });
    const payload = JSON.parse((r as { content: [{ text: string }] }).content[0].text) as {
      ok: boolean;
      failure: {
        code: string;
        message: string;
        details: { missing: string[]; not_png: string[]; oversize: string[]; wrong_dimensions: string[] };
      };
    };

    expect(payload.ok).toBe(false);
    expect(payload.failure.code).toBe('ASSET_VALIDATION_FAILED');
    expect(payload.failure.message).toBe('3 asset(s) failed validation');
    expect(payload.failure.details.missing).toEqual(['images/icon_missing.png']);
    expect(payload.failure.details.not_png).toEqual(['images/icon_bad.png']);
    expect(payload.failure.details.oversize).toEqual(['images/splash_big.png']);
    expect(payload.failure.details.wrong_dimensions).toEqual([]);
  });

  it('7. ignores non-matching manifest keys', async () => {
    const dir = await makeDir();
    await writeManifest(
      dir,
      'title=My Channel\nmm_icon_focus_hd=images/icon.png\nbuild_version=1\n',
    );
    await writePng(dir, 'images/icon.png');

    const r = await handler({ project_dir: dir });
    const payload = JSON.parse((r as { content: [{ text: string }] }).content[0].text) as {
      ok: boolean;
      missing: string[];
      oversize: string[];
      wrong_dimensions: string[];
    };

    // Only mm_icon_focus_hd is checked; title and build_version are ignored.
    expect(payload.ok).toBe(true);
    expect(payload.missing).toEqual([]);
  });

  it('8. no manifest file', async () => {
    const dir = await makeDir();
    // No manifest written.

    const r = await handler({ project_dir: dir });
    const payload = JSON.parse((r as { content: [{ text: string }] }).content[0].text) as {
      ok: boolean;
      failure: { code: string; message: string };
    };

    expect(payload.ok).toBe(false);
    expect(payload.failure.code).toBe('ASSET_VALIDATION_FAILED');
    expect(payload.failure.message).toMatch(/manifest/i);
  });
});
