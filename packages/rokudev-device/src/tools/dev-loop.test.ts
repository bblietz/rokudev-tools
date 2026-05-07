import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Hoisted mock factories — declared before vi.mock() factories run.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  DevPortal: vi.fn(),
  TelnetClient: vi.fn(),
  checkReachable: vi.fn(),
}));

// Swap DevPortal and TelnetClient; keep all other exports real.
vi.mock('@rokudev/device-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rokudev/device-client')>();
  return {
    ...actual,
    DevPortal: mocks.DevPortal,
    TelnetClient: mocks.TelnetClient,
  };
});

// Swap checkReachable; keep _resetCache real.
vi.mock('../util/network-guard.js', () => ({
  checkReachable: mocks.checkReachable,
  _resetCache: () => {},
}));

// Side-effect: register dev-loop tool (runs with mocked classes).
await import('./dev-loop.js');

import { registerAllTools, type ToolDef } from './_register.js';
import { fail } from '@rokudev/device-client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let originalEnv: NodeJS.ProcessEnv;
let tools: Map<string, ToolDef>;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'rokudev-devloop-'));
  originalEnv = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ROKUDEV_')) delete process.env[k];
  }
  process.env['ROKUDEV_CONFIG_DIR'] = tmpDir;
  tools = new Map();
  registerAllTools(tools);

  for (const m of Object.values(mocks)) m.mockReset();
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

function mockHappyDevPortal(): ReturnType<typeof vi.fn> {
  const sideload = vi.fn().mockResolvedValue({
    ok: true,
    status: 'installed',
    message: 'sideloaded',
    duration_ms: 50,
  });
  mocks.DevPortal.mockImplementation(() => ({ sideload }));
  return sideload;
}

function mockHappyTelnet(lines: string[] = ['line1', 'line2']): ReturnType<typeof vi.fn> {
  const tail = vi.fn().mockResolvedValue(lines);
  mocks.TelnetClient.mockImplementation(() => ({ tail }));
  return tail;
}

// ---------------------------------------------------------------------------
// 1. Schema registration smoke
// ---------------------------------------------------------------------------

describe('dev_loop tool registration', () => {
  it('registers dev_loop with required = [zip_path]', () => {
    expect(tools.has('dev_loop')).toBe(true);
    const def = tools.get('dev_loop')!;
    expect(typeof def.name).toBe('string');
    expect(typeof def.description).toBe('string');
    expect(def.inputSchema).toBeDefined();
    const schema = def.inputSchema as Record<string, unknown>;
    expect(schema['type']).toBe('object');
    expect(typeof def.handler).toBe('function');
    expect(schema['required']).toEqual(['zip_path']);
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path
// ---------------------------------------------------------------------------

describe('dev_loop happy path', () => {
  it('sideloads and tails with default tail_seconds=10, returns { ok, host, sideload, log_lines }', async () => {
    const sideloadFn = mockHappyDevPortal();
    const tailFn = mockHappyTelnet(['line1', 'line2']);

    const result = await call('dev_loop', {
      host: '192.168.1.100',
      dev_password: 'devpw',
      zip_path: '/tmp/app.zip',
    }) as Record<string, unknown>;

    expect(sideloadFn).toHaveBeenCalledWith('/tmp/app.zip');
    expect(tailFn).toHaveBeenCalledWith('192.168.1.100', 8085, 10);
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.100');
    const sideload = result['sideload'] as Record<string, unknown>;
    expect(sideload['message']).toBe('sideloaded');
    expect(sideload['status']).toBe('installed');
    expect(sideload['duration_ms']).toBe(50);
    // `ok` must be excluded from the nested sideload object (TS2783 pattern).
    expect(sideload).not.toHaveProperty('ok');
    expect(result['log_lines']).toEqual(['line1', 'line2']);
  });
});

// ---------------------------------------------------------------------------
// 3. Custom tail_seconds
// ---------------------------------------------------------------------------

describe('dev_loop custom tail_seconds', () => {
  it('passes tail_seconds=5 to TelnetClient.tail', async () => {
    mockHappyDevPortal();
    const tailFn = mockHappyTelnet();

    await call('dev_loop', {
      host: '192.168.1.100',
      dev_password: 'devpw',
      zip_path: '/tmp/app.zip',
      tail_seconds: 5,
    });

    expect(tailFn).toHaveBeenCalledWith('192.168.1.100', 8085, 5);
  });
});

// ---------------------------------------------------------------------------
// 4. tail_seconds: 0 skips telnet
// ---------------------------------------------------------------------------

describe('dev_loop tail_seconds=0', () => {
  it('skips TelnetClient.tail when tail_seconds is 0, log_lines is []', async () => {
    mockHappyDevPortal();
    const tailFn = mockHappyTelnet();

    const result = await call('dev_loop', {
      host: '192.168.1.100',
      dev_password: 'devpw',
      zip_path: '/tmp/app.zip',
      tail_seconds: 0,
    }) as Record<string, unknown>;

    expect(tailFn).not.toHaveBeenCalled();
    expect(result['log_lines']).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. freeform_lint_override accepted but ignored
// ---------------------------------------------------------------------------

describe('dev_loop freeform_lint_override', () => {
  it('accepts freeform_lint_override=true without error, returns normal shape', async () => {
    mockHappyDevPortal();
    mockHappyTelnet();

    const result = await call('dev_loop', {
      host: '192.168.1.100',
      dev_password: 'devpw',
      zip_path: '/tmp/app.zip',
      freeform_lint_override: true,
    }) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.100');
    expect(result['sideload']).toBeDefined();
    expect(result['log_lines']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 6. DEVICE_NO_PASSWORD when dev_password not resolvable
// ---------------------------------------------------------------------------

describe('dev_loop DEVICE_NO_PASSWORD', () => {
  it('throws DEVICE_NO_PASSWORD when no dev_password in args, env, or registry', async () => {
    mockHappyDevPortal();
    mockHappyTelnet();

    await expect(call('dev_loop', { host: '127.0.0.1', zip_path: '/x' }))
      .rejects.toMatchObject({ ok: false, code: 'DEVICE_NO_PASSWORD', stage: 'device' });
  });
});

// ---------------------------------------------------------------------------
// 7. Pass-through sideload failure
// ---------------------------------------------------------------------------

describe('dev_loop pass-through sideload failure', () => {
  it('propagates SIDELOAD_REJECTED unwrapped; TelnetClient.tail not called', async () => {
    const err = fail('SIDELOAD_REJECTED', 'device rejected the zip', { http_code: 400 });
    mocks.DevPortal.mockImplementation(() => ({
      sideload: vi.fn().mockRejectedValue(err),
    }));
    const tailFn = vi.fn();
    mocks.TelnetClient.mockImplementation(() => ({ tail: tailFn }));

    await expect(call('dev_loop', {
      host: '192.168.1.100',
      dev_password: 'pw',
      zip_path: '/tmp/app.zip',
    })).rejects.toMatchObject({ ok: false, code: 'SIDELOAD_REJECTED' });

    expect(tailFn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 8. Secret leak guard
// ---------------------------------------------------------------------------

describe('dev_loop secret leak guard', () => {
  it('dev_password never appears in the response JSON', async () => {
    mockHappyDevPortal();
    mockHappyTelnet();

    const result = await call('dev_loop', {
      host: '192.168.1.100',
      dev_password: 'verysecretXYZ',
      zip_path: '/tmp/app.zip',
    });

    expect(JSON.stringify(result)).not.toContain('verysecretXYZ');
  });
});
