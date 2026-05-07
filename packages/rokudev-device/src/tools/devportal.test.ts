import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Hoisted mock factories — declared before vi.mock() factories run.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  DevPortal: vi.fn(),
  DevPortalInspect: vi.fn(),
  diffInstalled: vi.fn(),
  checkReachable: vi.fn(),
  // homedir override: null means use the real homedir; set to a string to redirect.
  homedirOverride: null as string | null,
}));

// Swap DevPortal, DevPortalInspect, diffInstalled; keep all other exports real.
vi.mock('@rokudev/device-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rokudev/device-client')>();
  return {
    ...actual,
    DevPortal: mocks.DevPortal,
    DevPortalInspect: mocks.DevPortalInspect,
    diffInstalled: mocks.diffInstalled,
  };
});

// Swap checkReachable only; keep _resetCache real.
vi.mock('../util/network-guard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../util/network-guard.js')>();
  return { ...actual, checkReachable: mocks.checkReachable };
});

// Mock node:os so that homedir() can be redirected via mocks.homedirOverride.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => mocks.homedirOverride ?? actual.homedir(),
  };
});

// Side-effect: register devportal tools (runs with mocked classes).
await import('./devportal.js');

import { registerAllTools, type ToolDef } from './_register.js';
import { fail } from '@rokudev/device-client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let originalEnv: NodeJS.ProcessEnv;
let tools: Map<string, ToolDef>;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'rokudev-devportal-'));
  originalEnv = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ROKUDEV_')) delete process.env[k];
  }
  process.env['ROKUDEV_CONFIG_DIR'] = tmpDir;
  tools = new Map();
  registerAllTools(tools);

  mocks.DevPortal.mockReset();
  mocks.DevPortalInspect.mockReset();
  mocks.diffInstalled.mockReset();
  mocks.checkReachable.mockReset();
  mocks.homedirOverride = null;
  mocks.checkReachable.mockResolvedValue(undefined);
});

afterEach(async () => {
  process.env = originalEnv;
  vi.restoreAllMocks();
  await rm(tmpDir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const def = tools.get(name);
  if (!def) throw new Error(`tool '${name}' not registered`);
  return def.handler(args);
}

// Helper: build a full DevPortal mock with all methods stubbed, overriding select ones.
function mockDevPortal(overrides: Partial<{ sideload: ReturnType<typeof vi.fn>; unload: ReturnType<typeof vi.fn> }> = {}): void {
  mocks.DevPortal.mockImplementation(() => ({
    sideload: vi.fn().mockResolvedValue({ message: 'ok', http_code: 200, duration_ms: 50 }),
    unload:   vi.fn().mockResolvedValue({ ok: true, message: 'unloaded', duration_ms: 30 }),
    ...overrides,
  }));
}

// Helper: build a full DevPortalInspect mock with all methods stubbed, overriding select ones.
function mockDevPortalInspect(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}): void {
  mocks.DevPortalInspect.mockImplementation(() => ({
    screenshot:       vi.fn().mockResolvedValue({ mime: 'image/jpeg', bytes: 1234, base64: 'YWFh', duration_ms: 50 }),
    genkey:           vi.fn().mockResolvedValue({ ok: true, dev_id: 'aabbcc112233', key: 'keydata', raw_html: '<html/>', duration_ms: 50 }),
    rekey:            vi.fn().mockResolvedValue({ ok: true, message: 'rekeyed', duration_ms: 50 }),
    packSigned:       vi.fn().mockResolvedValue({ ok: true, pkg_bytes: Buffer.from('fakepkgdata'), duration_ms: 80 }),
    queryRegistry:    vi.fn().mockResolvedValue({ ok: true, registry: { section: {} }, duration_ms: 40 }),
    profilerSnapshot: vi.fn().mockResolvedValue({ ok: true, sections: { 'Memory': 'usage data' }, raw_html_excerpt: '<html/>', truncated: false, duration_ms: 60 }),
    crashlogPull:     vi.fn().mockResolvedValue({ ok: true, log_text: 'crash log text', truncated: false, duration_ms: 35 }),
    ...overrides,
  }));
}

// ---------------------------------------------------------------------------
// 1. Schema registration smoke
// ---------------------------------------------------------------------------

describe('devportal tool registration', () => {
  it('registers all 10 tools', () => {
    const names = [
      'sideload', 'unload', 'screenshot', 'genkey', 'rekey',
      'pack_signed', 'diff_installed', 'query_registry',
      'profiler_snapshot', 'crashlog_pull',
    ];
    for (const name of names) {
      expect(tools.has(name), `${name} not registered`).toBe(true);
      const def = tools.get(name)!;
      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(def.inputSchema).toBeDefined();
      const schema = def.inputSchema as Record<string, unknown>;
      expect(schema['type']).toBe('object');
      expect(typeof def.handler).toBe('function');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path — one test per tool
// ---------------------------------------------------------------------------

describe('sideload happy path', () => {
  it('calls DevPortal.sideload(zip_path) and returns { ok, host, ... }', async () => {
    const sideloadFn = vi.fn().mockResolvedValue({ message: 'Success', http_code: 200, duration_ms: 120 });
    mockDevPortal({ sideload: sideloadFn });

    const result = await call('sideload', { host: '192.168.1.100', dev_password: 'devpw', zip_path: '/tmp/app.zip' }) as Record<string, unknown>;

    expect(sideloadFn).toHaveBeenCalledWith('/tmp/app.zip');
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.100');
    expect(result['message']).toBe('Success');
    expect(result['http_code']).toBe(200);
  });
});

describe('unload happy path', () => {
  it('calls DevPortal.unload() and returns { ok, host, ... }', async () => {
    const unloadFn = vi.fn().mockResolvedValue({ ok: true, message: 'unloaded', duration_ms: 30 });
    mockDevPortal({ unload: unloadFn });

    const result = await call('unload', { host: '192.168.1.100', dev_password: 'devpw' }) as Record<string, unknown>;

    expect(unloadFn).toHaveBeenCalledTimes(1);
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.100');
    expect(result['message']).toBe('unloaded');
  });
});

describe('screenshot happy path', () => {
  it('calls DevPortalInspect.screenshot() with no args and returns inline by default', async () => {
    const screenshotFn = vi.fn().mockResolvedValue({ mime: 'image/jpeg', bytes: 2048, base64: 'abc123', duration_ms: 75 });
    mockDevPortalInspect({ screenshot: screenshotFn });

    const result = await call('screenshot', { host: '192.168.1.100', dev_password: 'devpw' }) as Record<string, unknown>;

    expect(screenshotFn).toHaveBeenCalledWith();       // no args — Gotcha 1
    expect(screenshotFn).toHaveBeenCalledTimes(1);
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.100');
    expect(result['mime']).toBe('image/jpeg');
    expect(result['bytes']).toBe(2048);
    expect(result['base64']).toBe('abc123');
  });
});

describe('screenshot ref mode', () => {
  it('writes screenshot to ref path with mode 0o600', async () => {
    mocks.homedirOverride = tmpDir;
    mockDevPortalInspect();   // default: mime=image/jpeg, base64='YWFh'

    const result = await call('screenshot', { host: '192.168.1.100', dev_password: 'devpw', return: 'ref' }) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['mime']).toBe('image/jpeg');
    expect(result['bytes']).toBe(1234);
    expect(result).not.toHaveProperty('base64');   // ref mode: no base64 in response

    const path = result['path'] as string;
    expect(path).toMatch(new RegExp(`${tmpDir.replace(/\//g, '/')}/.cache/rokudev/screenshots/[0-9a-f]{64}\\.jpg$`));

    const st = await stat(path);
    expect(st.mode & 0o777).toBe(0o600);
  });
});

describe('genkey happy path', () => {
  it('calls DevPortalInspect.genkey() and returns { ok, host, dev_id, key }', async () => {
    const genkeyFn = vi.fn().mockResolvedValue({ ok: true, dev_id: 'deadbeef01234', key: 'keyABCD', raw_html: '<html/>', duration_ms: 50 });
    mockDevPortalInspect({ genkey: genkeyFn });

    const result = await call('genkey', { host: '192.168.1.100', dev_password: 'devpw' }) as Record<string, unknown>;

    expect(genkeyFn).toHaveBeenCalledTimes(1);
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.100');
    expect(result['dev_id']).toBe('deadbeef01234');
    expect(result['key']).toBe('keyABCD');
  });
});

describe('rekey happy path', () => {
  it('calls DevPortalInspect.rekey(signed_pkg_path, password) and returns { ok, host }', async () => {
    const rekeyFn = vi.fn().mockResolvedValue({ ok: true, message: 'rekeyed', duration_ms: 50 });
    mockDevPortalInspect({ rekey: rekeyFn });

    const result = await call('rekey', {
      host: '192.168.1.100',
      dev_password: 'devpw',
      signed_pkg_path: '/tmp/app.pkg',
      password: 'signsecret',
    }) as Record<string, unknown>;

    expect(rekeyFn).toHaveBeenCalledWith('/tmp/app.pkg', 'signsecret');
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.100');
    expect(result['message']).toBe('rekeyed');
  });
});

describe('pack_signed happy path', () => {
  it('calls DevPortalInspect.packSigned(), writes pkg to disk, returns { ok, host, output_pkg, bytes }', async () => {
    const pkgData = Buffer.from('fakepkgcontent');
    const packSignedFn = vi.fn().mockResolvedValue({ ok: true, pkg_bytes: pkgData, duration_ms: 80 });
    mockDevPortalInspect({ packSigned: packSignedFn });

    const outputPkg = join(tmpDir, 'app-signed.pkg');
    const result = await call('pack_signed', {
      host: '192.168.1.100',
      dev_password: 'devpw',
      project_dir: tmpDir,
      signing_password: 'signingpw',
      output_pkg: outputPkg,
    }) as Record<string, unknown>;

    expect(packSignedFn).toHaveBeenCalledWith('signingpw');
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.100');
    expect(result['output_pkg']).toBe(outputPkg);
    expect(result['bytes']).toBe(pkgData.length);
    // Verify file written to disk.
    const { readFile } = await import('node:fs/promises');
    const written = await readFile(outputPkg);
    expect(written).toEqual(pkgData);
    // pkg_bytes must NOT be in the response — it would be huge and leak the package.
    expect(result).not.toHaveProperty('pkg_bytes');
  });
});

describe('diff_installed happy path', () => {
  it('calls diffInstalled(host, dev_password, project_dir) and returns { ok, host, ... }', async () => {
    mocks.diffInstalled.mockResolvedValue({
      added: ['components/NewScene.xml'],
      removed: [],
      changed: ['source/main.brs'],
      same: ['manifest'],
    });
    mockDevPortal();   // not called, but keeps DevPortal constructable

    const result = await call('diff_installed', {
      host: '192.168.1.100',
      dev_password: 'devpw',
      project_dir: tmpDir,
    }) as Record<string, unknown>;

    expect(mocks.diffInstalled).toHaveBeenCalledWith('192.168.1.100', 'devpw', tmpDir);
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.100');
    expect((result['added'] as string[])).toContain('components/NewScene.xml');
  });
});

describe('query_registry happy path', () => {
  it('calls DevPortalInspect.queryRegistry(dev_id) and returns { ok, host, registry }', async () => {
    const queryFn = vi.fn().mockResolvedValue({ ok: true, registry: { section1: { key: 'val' } }, duration_ms: 40 });
    mockDevPortalInspect({ queryRegistry: queryFn });

    const result = await call('query_registry', {
      host: '192.168.1.100',
      dev_password: 'devpw',
      dev_id: 'myDevId123',
    }) as Record<string, unknown>;

    expect(queryFn).toHaveBeenCalledWith('myDevId123');
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.100');
    expect(result['registry']).toEqual({ section1: { key: 'val' } });
  });
});

describe('profiler_snapshot happy path', () => {
  it('calls DevPortalInspect.profilerSnapshot() and returns { ok, host, sections }', async () => {
    const profilerFn = vi.fn().mockResolvedValue({ ok: true, sections: { 'Memory': '4MB' }, raw_html_excerpt: '<html/>', truncated: false, duration_ms: 60 });
    mockDevPortalInspect({ profilerSnapshot: profilerFn });

    const result = await call('profiler_snapshot', { host: '192.168.1.100', dev_password: 'devpw' }) as Record<string, unknown>;

    expect(profilerFn).toHaveBeenCalledTimes(1);
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.100');
    expect(result['sections']).toEqual({ 'Memory': '4MB' });
    expect(result['truncated']).toBe(false);
  });
});

describe('crashlog_pull happy path', () => {
  it('calls DevPortalInspect.crashlogPull() and returns { ok, host, log_text }', async () => {
    const crashlogFn = vi.fn().mockResolvedValue({ ok: true, log_text: 'crash data here', truncated: false, duration_ms: 35 });
    mockDevPortalInspect({ crashlogPull: crashlogFn });

    const result = await call('crashlog_pull', { host: '192.168.1.100', dev_password: 'devpw' }) as Record<string, unknown>;

    expect(crashlogFn).toHaveBeenCalledTimes(1);
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.100');
    expect(result['log_text']).toBe('crash data here');
  });
});

// ---------------------------------------------------------------------------
// 3. MANDATORY secret-handling tests (1 per tool = 10 tests)
// ---------------------------------------------------------------------------

describe('secret-handling: dev_password never appears in response', () => {
  it('sideload: dev_password not in response', async () => {
    mockDevPortal();
    const result = await call('sideload', { host: '192.168.1.1', dev_password: 'verysecretXYZ', zip_path: '/tmp/x.zip' });
    expect(JSON.stringify(result)).not.toContain('verysecretXYZ');
  });

  it('unload: dev_password not in response', async () => {
    mockDevPortal();
    const result = await call('unload', { host: '192.168.1.1', dev_password: 'verysecretXYZ' });
    expect(JSON.stringify(result)).not.toContain('verysecretXYZ');
  });

  it('screenshot: dev_password not in response (inline mode)', async () => {
    mockDevPortalInspect();
    const result = await call('screenshot', { host: '192.168.1.1', dev_password: 'verysecretXYZ' });
    expect(JSON.stringify(result)).not.toContain('verysecretXYZ');
  });

  it('screenshot: dev_password not in response (ref mode)', async () => {
    mocks.homedirOverride = tmpDir;
    mockDevPortalInspect();
    const result = await call('screenshot', { host: '192.168.1.1', dev_password: 'verysecretXYZ', return: 'ref' });
    expect(JSON.stringify(result)).not.toContain('verysecretXYZ');
  });

  it('genkey: dev_password not in response', async () => {
    mockDevPortalInspect();
    const result = await call('genkey', { host: '192.168.1.1', dev_password: 'verysecretXYZ' });
    expect(JSON.stringify(result)).not.toContain('verysecretXYZ');
  });

  it('rekey: dev_password and signing password not in response', async () => {
    mockDevPortalInspect();
    const result = await call('rekey', {
      host: '192.168.1.1',
      dev_password: 'verysecretXYZ',
      signed_pkg_path: '/tmp/app.pkg',
      password: 'signsecretXYZ',
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain('verysecretXYZ');
    expect(json).not.toContain('signsecretXYZ');
  });

  it('pack_signed: dev_password and signing_password not in response', async () => {
    mockDevPortalInspect();
    const outputPkg = join(tmpDir, 'signed-secret.pkg');
    const result = await call('pack_signed', {
      host: '192.168.1.1',
      dev_password: 'verysecretXYZ',
      project_dir: tmpDir,
      signing_password: 'signsecretXYZ',
      output_pkg: outputPkg,
    });
    const json = JSON.stringify(result);
    expect(json).not.toContain('verysecretXYZ');
    expect(json).not.toContain('signsecretXYZ');
  });

  it('diff_installed: dev_password not in response', async () => {
    mocks.diffInstalled.mockResolvedValue({ added: [], removed: [], changed: [], same: [] });
    const result = await call('diff_installed', { host: '192.168.1.1', dev_password: 'verysecretXYZ', project_dir: tmpDir });
    expect(JSON.stringify(result)).not.toContain('verysecretXYZ');
  });

  it('query_registry: dev_password not in response', async () => {
    mockDevPortalInspect();
    const result = await call('query_registry', { host: '192.168.1.1', dev_password: 'verysecretXYZ', dev_id: 'myId' });
    expect(JSON.stringify(result)).not.toContain('verysecretXYZ');
  });

  it('profiler_snapshot: dev_password not in response', async () => {
    mockDevPortalInspect();
    const result = await call('profiler_snapshot', { host: '192.168.1.1', dev_password: 'verysecretXYZ' });
    expect(JSON.stringify(result)).not.toContain('verysecretXYZ');
  });

  it('crashlog_pull: dev_password not in response', async () => {
    mockDevPortalInspect();
    const result = await call('crashlog_pull', { host: '192.168.1.1', dev_password: 'verysecretXYZ' });
    expect(JSON.stringify(result)).not.toContain('verysecretXYZ');
  });
});

// ---------------------------------------------------------------------------
// 4. DEVICE_NO_PASSWORD when dev_password not resolvable
// ---------------------------------------------------------------------------

describe('DEVICE_NO_PASSWORD', () => {
  it('throws DEVICE_NO_PASSWORD when no dev_password in args, env, or registry', async () => {
    mockDevPortal();
    // No dev_password, no env vars, no registry entry — resolveTarget will give host but no password.
    await expect(call('sideload', { host: '127.0.0.1', zip_path: '/x.zip' }))
      .rejects.toMatchObject({ ok: false, code: 'DEVICE_NO_PASSWORD', stage: 'device' });
  });

  it('throws DEVICE_NO_PASSWORD for screenshot when password missing', async () => {
    mockDevPortalInspect();
    await expect(call('screenshot', { host: '127.0.0.1' }))
      .rejects.toMatchObject({ ok: false, code: 'DEVICE_NO_PASSWORD', stage: 'device' });
  });
});

// ---------------------------------------------------------------------------
// 5. Pass-through failure (fail() propagates unwrapped)
// ---------------------------------------------------------------------------

describe('pass-through failures', () => {
  it('sideload propagates SIDELOAD_REJECTED failure unwrapped', async () => {
    const err = fail('SIDELOAD_REJECTED', 'device rejected the zip', { http_code: 400 });
    const sideloadFn = vi.fn().mockRejectedValue(err);
    mockDevPortal({ sideload: sideloadFn });

    await expect(call('sideload', { host: '192.168.1.100', dev_password: 'pw', zip_path: '/tmp/app.zip' }))
      .rejects.toMatchObject({ ok: false, code: 'SIDELOAD_REJECTED' });
  });

  it('genkey propagates GENKEY_FAILED failure unwrapped', async () => {
    const err = fail('GENKEY_FAILED', 'could not parse dev key');
    const genkeyFn = vi.fn().mockRejectedValue(err);
    mockDevPortalInspect({ genkey: genkeyFn });

    await expect(call('genkey', { host: '192.168.1.100', dev_password: 'pw' }))
      .rejects.toMatchObject({ ok: false, code: 'GENKEY_FAILED' });
  });
});
