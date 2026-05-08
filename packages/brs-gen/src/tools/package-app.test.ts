import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerAllTools, type ToolDef } from './_register.js';
import './package-app.js';

describe('package_app tool', () => {
  let handler: ToolDef['handler'];

  beforeEach(() => {
    const tools = new Map<string, ToolDef>();
    registerAllTools(tools);
    const t = tools.get('package_app');
    if (!t) throw new Error('package_app not registered');
    handler = t.handler;
  });

  it('happy path: zips a project dir with manifest, default output_zip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brs-gen-t23-'));
    await writeFile(join(dir, 'manifest'), 'title=Test\n');
    await mkdir(join(dir, 'source'));
    await writeFile(join(dir, 'source', 'main.brs'), "' hello\n");

    const r = await handler({ project_dir: dir });
    const payload = JSON.parse((r as any).content[0].text) as {
      ok: boolean;
      zip_path: string;
      zip_bytes: number;
    };

    expect(payload.ok).toBe(true);
    expect(payload.zip_path).toBe(`${dir}.zip`);
    expect(payload.zip_bytes).toBeGreaterThan(0);

    // The zip file must exist on disk.
    const s = await stat(`${dir}.zip`);
    expect(s.size).toBeGreaterThan(0);
  });

  it('refuses when manifest is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brs-gen-t23-'));
    await writeFile(join(dir, 'source.brs'), "' no manifest here\n");

    await expect(handler({ project_dir: dir })).rejects.toMatchObject({
      code: 'MANIFEST_VALIDATION_FAILED',
    });
  });

  it('custom output_zip: writes zip to the given path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brs-gen-t23-'));
    await writeFile(join(dir, 'manifest'), 'title=Custom\n');
    await writeFile(join(dir, 'main.brs'), "' one file\n");

    const outDir = await mkdtemp(join(tmpdir(), 'brs-gen-t23-out-'));
    const customZip = join(outDir, 'custom.zip');

    const r = await handler({ project_dir: dir, output_zip: customZip });
    const payload = JSON.parse((r as any).content[0].text) as {
      ok: boolean;
      zip_path: string;
      zip_bytes: number;
    };

    expect(payload.ok).toBe(true);
    expect(payload.zip_path).toBe(customZip);
    expect(payload.zip_bytes).toBeGreaterThan(0);

    const s = await stat(customZip);
    expect(s.size).toBeGreaterThan(0);
  });
});
