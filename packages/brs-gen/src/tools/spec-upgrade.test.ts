import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerAllTools, type ToolDef } from './_register.js';
import './spec-upgrade.js';

// ---------------------------------------------------------------------------
// Minimal fixture specs
// ---------------------------------------------------------------------------

const V1_SPEC = {
  spec_version: 1,
  template: 'stub_hello',
  app: { name: 'Test App', major_version: 1, minor_version: 0, build_version: 0 },
};

const V2_SPEC = {
  spec_version: 2,
  template: 'stub_hello',
  modules: [],
  app: { name: 'Test App', major_version: 1, minor_version: 0, build_version: 0 },
};

describe('spec_upgrade tool', () => {
  let handler: ToolDef['handler'];

  beforeEach(() => {
    const tools = new Map<string, ToolDef>();
    registerAllTools(tools);
    const t = tools.get('spec_upgrade');
    if (!t) throw new Error('spec_upgrade not registered');
    handler = t.handler;
  });

  // ---------------------------------------------------------------------------
  // Helper
  // ---------------------------------------------------------------------------

  async function makeDir(): Promise<string> {
    return mkdtemp(join(tmpdir(), 'brs-gen-t26-'));
  }

  async function writeSpec(dir: string, name: string, obj: unknown): Promise<string> {
    const p = join(dir, name);
    await writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    return p;
  }

  function parsePayload(r: unknown): {
    ok: boolean;
    spec_version_before: number;
    spec_version_after: number;
    written_to: string | null;
    diff: string;
  } {
    const res = r as { content: [{ text: string }] };
    return JSON.parse(res.content[0].text) as {
      ok: boolean;
      spec_version_before: number;
      spec_version_after: number;
      written_to: string | null;
      diff: string;
    };
  }

  // ---------------------------------------------------------------------------
  // 1. v1 default (sidecar)
  // ---------------------------------------------------------------------------

  it('v1 default (sidecar): promotes to v2, writes sidecar, leaves original', async () => {
    const dir = await makeDir();
    const filePath = await writeSpec(dir, 'app.json', V1_SPEC);
    const originalContent = await readFile(filePath, 'utf8');

    const r = await handler({ file_path: filePath });
    const payload = parsePayload(r);

    expect(payload.ok).toBe(true);
    expect(payload.spec_version_before).toBe(1);
    expect(payload.spec_version_after).toBe(2);
    expect(payload.written_to).toBe(`${filePath}.v2.json`);
    expect(payload.diff).not.toBe('');

    // Sidecar must exist and be valid v2 JSON.
    const sidecarText = await readFile(`${filePath}.v2.json`, 'utf8');
    const sidecar = JSON.parse(sidecarText) as { spec_version: number; modules: unknown[] };
    expect(sidecar.spec_version).toBe(2);
    expect(Array.isArray(sidecar.modules)).toBe(true);

    // Original must be untouched.
    const afterContent = await readFile(filePath, 'utf8');
    expect(afterContent).toBe(originalContent);
  });

  // ---------------------------------------------------------------------------
  // 2. v1 in-place
  // ---------------------------------------------------------------------------

  it('v1 in-place: overwrites original with v2 content', async () => {
    const dir = await makeDir();
    const filePath = await writeSpec(dir, 'app.json', V1_SPEC);

    const r = await handler({ file_path: filePath, in_place: true });
    const payload = parsePayload(r);

    expect(payload.ok).toBe(true);
    expect(payload.spec_version_before).toBe(1);
    expect(payload.spec_version_after).toBe(2);
    expect(payload.written_to).toBe(filePath);

    const updated = JSON.parse(await readFile(filePath, 'utf8')) as { spec_version: number; modules: unknown[] };
    expect(updated.spec_version).toBe(2);
    expect(Array.isArray(updated.modules)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // 3. v2 no-op
  // ---------------------------------------------------------------------------

  it('v2 no-op: returns null written_to and empty diff, no sidecar created', async () => {
    const dir = await makeDir();
    const filePath = await writeSpec(dir, 'app.v2.json', V2_SPEC);
    const originalContent = await readFile(filePath, 'utf8');

    const r = await handler({ file_path: filePath });
    const payload = parsePayload(r);

    expect(payload.ok).toBe(true);
    expect(payload.spec_version_before).toBe(2);
    expect(payload.spec_version_after).toBe(2);
    expect(payload.written_to).toBeNull();
    expect(payload.diff).toBe('');

    // No sidecar.
    await expect(access(`${filePath}.v2.json`)).rejects.toThrow();

    // Original untouched.
    const afterContent = await readFile(filePath, 'utf8');
    expect(afterContent).toBe(originalContent);
  });

  // ---------------------------------------------------------------------------
  // 4. File not found
  // ---------------------------------------------------------------------------

  it('APP_SPEC_INVALID: file not found', async () => {
    const dir = await makeDir();
    const missing = join(dir, 'does-not-exist.json');
    await expect(handler({ file_path: missing })).rejects.toMatchObject({
      code: 'APP_SPEC_INVALID',
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Malformed JSON
  // ---------------------------------------------------------------------------

  it('APP_SPEC_INVALID: malformed JSON', async () => {
    const dir = await makeDir();
    const filePath = join(dir, 'bad.json');
    await writeFile(filePath, '{broken', 'utf8');
    await expect(handler({ file_path: filePath })).rejects.toMatchObject({
      code: 'APP_SPEC_INVALID',
    });
  });
});
