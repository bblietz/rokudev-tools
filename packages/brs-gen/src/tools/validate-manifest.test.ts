import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerAllTools, type ToolDef } from './_register.js';
import './validate-manifest.js';

describe('validate_manifest tool', () => {
  let handler: ToolDef['handler'];

  beforeEach(() => {
    const tools = new Map<string, ToolDef>();
    registerAllTools(tools);
    const t = tools.get('validate_manifest');
    if (!t) throw new Error('validate_manifest not registered');
    handler = t.handler;
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function makeDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'brs-gen-t24-'));
  }

  async function writeManifest(dir: string, text: string): Promise<void> {
    await writeFile(join(dir, 'manifest'), text, 'utf8');
  }

  async function writeProvenance(dir: string, obj: unknown): Promise<void> {
    const provDir = join(dir, '.rokudev-tools');
    await mkdir(provDir, { recursive: true });
    await writeFile(join(provDir, 'provenance.json'), JSON.stringify(obj), 'utf8');
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  it('happy path (no drift): all keys match', async () => {
    const dir = await makeDir();
    const keys = ['build_version', 'major_version', 'minor_version', 'title'];
    await writeManifest(dir, keys.map((k) => `${k}=1`).join('\n') + '\n');
    await writeProvenance(dir, {
      manifest_keys: keys,
      brs_gen_version: '0.3.0',
      init_order: [],
      modules: [],
      spec_version: 2,
      template: { id: 'stub_hello', version: '0.1.0' },
    });

    const payload = (await handler({ project_dir: dir })) as {
      ok: boolean;
      manifest_keys: string[];
      drift: { missing_in_manifest: string[]; extra_in_manifest: string[] };
      details?: { warnings: Array<{ code: string }> };
    };

    expect(payload.ok).toBe(true);
    expect(payload.manifest_keys).toEqual(keys); // already sorted
    expect(payload.drift.missing_in_manifest).toEqual([]);
    expect(payload.drift.extra_in_manifest).toEqual([]);
    expect(payload.details).toBeUndefined();
  });

  it('drift: manifest has extra key not in provenance', async () => {
    const dir = await makeDir();
    const baseKeys = ['build_version', 'major_version', 'minor_version', 'title'];
    await writeManifest(dir, [...baseKeys, 'extra_key'].map((k) => `${k}=1`).join('\n') + '\n');
    await writeProvenance(dir, {
      manifest_keys: baseKeys,
      brs_gen_version: '0.3.0',
      init_order: [],
      modules: [],
      spec_version: 2,
      template: { id: 'stub_hello', version: '0.1.0' },
    });

    const payload = (await handler({ project_dir: dir })) as {
      ok: boolean;
      drift: { missing_in_manifest: string[]; extra_in_manifest: string[] };
      details?: { warnings: Array<{ code: string; message: string }> };
    };

    expect(payload.ok).toBe(true);
    expect(payload.drift.extra_in_manifest).toEqual(['extra_key']);
    expect(payload.drift.missing_in_manifest).toEqual([]);
    expect(payload.details?.warnings).toContainEqual(
      expect.objectContaining({ code: 'MANIFEST_DRIFT' }),
    );
  });

  it('drift: provenance lists key absent from manifest', async () => {
    const dir = await makeDir();
    const manifestKeys = ['build_version', 'major_version', 'minor_version', 'title'];
    await writeManifest(dir, manifestKeys.map((k) => `${k}=1`).join('\n') + '\n');
    await writeProvenance(dir, {
      manifest_keys: [...manifestKeys, 'missing_key'],
      brs_gen_version: '0.3.0',
      init_order: [],
      modules: [],
      spec_version: 2,
      template: { id: 'stub_hello', version: '0.1.0' },
    });

    const payload = (await handler({ project_dir: dir })) as {
      ok: boolean;
      drift: { missing_in_manifest: string[]; extra_in_manifest: string[] };
      details?: { warnings: Array<{ code: string }> };
    };

    expect(payload.ok).toBe(true);
    expect(payload.drift.missing_in_manifest).toEqual(['missing_key']);
    expect(payload.drift.extra_in_manifest).toEqual([]);
    expect(payload.details?.warnings).toContainEqual(
      expect.objectContaining({ code: 'MANIFEST_DRIFT' }),
    );
  });

  it('MANIFEST_VALIDATION_FAILED: no manifest file', async () => {
    const dir = await makeDir();
    // No manifest written
    await expect(handler({ project_dir: dir })).rejects.toMatchObject({
      code: 'MANIFEST_VALIDATION_FAILED',
    });
  });

  it('MANIFEST_VALIDATION_FAILED: manifest present but no provenance.json', async () => {
    const dir = await makeDir();
    await writeManifest(dir, 'title=X\n');
    // No provenance written
    await expect(handler({ project_dir: dir })).rejects.toMatchObject({
      code: 'MANIFEST_VALIDATION_FAILED',
    });
  });

  it('MANIFEST_VALIDATION_FAILED: provenance.json is malformed JSON', async () => {
    const dir = await makeDir();
    await writeManifest(dir, 'title=X\n');
    const provDir = join(dir, '.rokudev-tools');
    await mkdir(provDir, { recursive: true });
    await writeFile(join(provDir, 'provenance.json'), '{not valid json', 'utf8');

    await expect(handler({ project_dir: dir })).rejects.toMatchObject({
      code: 'MANIFEST_VALIDATION_FAILED',
    });
  });

  it('manifest parsing: ignores # comments and blank lines', async () => {
    const dir = await makeDir();
    await writeManifest(dir, '# this is a comment\n\ntitle=X\n\n# another comment\n');
    await writeProvenance(dir, {
      manifest_keys: ['title'],
      brs_gen_version: '0.3.0',
      init_order: [],
      modules: [],
      spec_version: 2,
      template: { id: 'stub_hello', version: '0.1.0' },
    });

    const payload = (await handler({ project_dir: dir })) as {
      ok: boolean;
      manifest_keys: string[];
      drift: { missing_in_manifest: string[]; extra_in_manifest: string[] };
    };

    expect(payload.ok).toBe(true);
    expect(payload.manifest_keys).toEqual(['title']);
    expect(payload.drift.missing_in_manifest).toEqual([]);
    expect(payload.drift.extra_in_manifest).toEqual([]);
  });

  it('manifest parsing: last write wins on duplicate keys', async () => {
    const dir = await makeDir();
    await writeManifest(dir, 'title=A\ntitle=B\n');
    await writeProvenance(dir, {
      manifest_keys: ['title'],
      brs_gen_version: '0.3.0',
      init_order: [],
      modules: [],
      spec_version: 2,
      template: { id: 'stub_hello', version: '0.1.0' },
    });

    const payload = (await handler({ project_dir: dir })) as {
      ok: boolean;
      manifest_keys: string[];
      drift: { missing_in_manifest: string[]; extra_in_manifest: string[] };
    };

    expect(payload.ok).toBe(true);
    // title appears only once in the keys list
    expect(payload.manifest_keys).toEqual(['title']);
    expect(payload.manifest_keys.filter((k) => k === 'title')).toHaveLength(1);
    expect(payload.drift.missing_in_manifest).toEqual([]);
    expect(payload.drift.extra_in_manifest).toEqual([]);
  });
});
