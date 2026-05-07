import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Hoisted mock factories — declared before vi.mock() factories run.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  return {
    EcpControl: vi.fn(),
    checkReachable: vi.fn(),
  };
});

// Swap EcpControl only; keep all other exports real (including fail).
vi.mock('@rokudev/device-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rokudev/device-client')>();
  return { ...actual, EcpControl: mocks.EcpControl };
});

// Swap checkReachable only; keep _resetCache real.
vi.mock('../util/network-guard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../util/network-guard.js')>();
  return { ...actual, checkReachable: mocks.checkReachable };
});

// Side-effect: register ecp-control tools (runs with mocked EcpControl).
await import('./ecp-control.js');

import { registerAllTools, type ToolDef } from './_register.js';
import { fail } from '@rokudev/device-client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let originalEnv: NodeJS.ProcessEnv;
let tools: Map<string, ToolDef>;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'rokudev-ecpctl-'));
  originalEnv = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ROKUDEV_')) delete process.env[k];
  }
  process.env['ROKUDEV_CONFIG_DIR'] = tmpDir;
  tools = new Map();
  registerAllTools(tools);

  mocks.EcpControl.mockReset();
  mocks.checkReachable.mockReset();
  mocks.checkReachable.mockResolvedValue(undefined);
});

afterEach(async () => {
  process.env = originalEnv;
  await rm(tmpDir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const def = tools.get(name);
  if (!def) throw new Error(`tool '${name}' not registered`);
  return def.handler(args);
}

/** Helper: build a full EcpControl mock with all methods stubbed, overriding select ones. */
function mockEcpControl(
  overrides: Partial<
    Record<'keypress' | 'keysequence' | 'launch' | 'input' | 'toHome', ReturnType<typeof vi.fn>>
  >,
): void {
  mocks.EcpControl.mockImplementation(() => ({
    keypress: vi.fn().mockResolvedValue(undefined),
    keysequence: vi.fn().mockResolvedValue(undefined),
    launch: vi.fn().mockResolvedValue(undefined),
    input: vi.fn().mockResolvedValue(undefined),
    toHome: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }));
}

// ---------------------------------------------------------------------------
// 1. Schema / registration smoke
// ---------------------------------------------------------------------------

describe('ecp-control registration', () => {
  it('registers all five tools', () => {
    const names = ['ecp_keypress', 'ecp_keysequence', 'ecp_launch', 'ecp_input', 'ecp_to_home'];
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

  it('ecp_keypress has required: ["key"]', () => {
    const schema = tools.get('ecp_keypress')!.inputSchema as Record<string, unknown>;
    expect(schema['required']).toEqual(['key']);
  });

  it('ecp_keysequence has required: ["keys"]', () => {
    const schema = tools.get('ecp_keysequence')!.inputSchema as Record<string, unknown>;
    expect(schema['required']).toEqual(['keys']);
  });

  it('ecp_launch has required: ["app_id"]', () => {
    const schema = tools.get('ecp_launch')!.inputSchema as Record<string, unknown>;
    expect(schema['required']).toEqual(['app_id']);
  });

  it('ecp_input has required: ["params"]', () => {
    const schema = tools.get('ecp_input')!.inputSchema as Record<string, unknown>;
    expect(schema['required']).toEqual(['params']);
  });

  it('ecp_to_home has no required fields', () => {
    const schema = tools.get('ecp_to_home')!.inputSchema as Record<string, unknown>;
    // Either required is absent or is an empty array.
    const req = schema['required'] as string[] | undefined;
    expect(req == null || req.length === 0).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path — one test per tool
// ---------------------------------------------------------------------------

describe('ecp_keypress happy path', () => {
  it('calls keypress(key, mode) once and returns correct shape', async () => {
    const keypress = vi.fn().mockResolvedValue(undefined);
    mockEcpControl({ keypress });

    const result = (await call('ecp_keypress', { host: '127.0.0.1', key: 'Up' })) as Record<
      string,
      unknown
    >;

    expect(keypress).toHaveBeenCalledTimes(1);
    expect(keypress).toHaveBeenCalledWith('Up', 'press');
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('127.0.0.1');
    expect(result['key']).toBe('Up');
    expect(result['mode']).toBe('press');
    expect(result['repeat']).toBe(1);
  });
});

describe('ecp_keysequence happy path', () => {
  it('calls keysequence(keys, delayMs) and returns { ok, host, count }', async () => {
    const keysequence = vi.fn().mockResolvedValue(undefined);
    mockEcpControl({ keysequence });

    const result = (await call('ecp_keysequence', {
      host: '127.0.0.1',
      keys: ['Up', 'Down'],
      delay_ms: 50,
    })) as Record<string, unknown>;

    expect(keysequence).toHaveBeenCalledWith(['Up', 'Down'], 50);
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('127.0.0.1');
    expect(result['count']).toBe(2);
  });
});

describe('ecp_launch happy path', () => {
  it('calls launch(appId, params) and returns { ok, host, app_id }', async () => {
    const launch = vi.fn().mockResolvedValue(undefined);
    mockEcpControl({ launch });

    const result = (await call('ecp_launch', {
      host: '127.0.0.1',
      app_id: 'dev',
      params: { contentId: 'abc' },
    })) as Record<string, unknown>;

    expect(launch).toHaveBeenCalledWith('dev', { contentId: 'abc' });
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('127.0.0.1');
    expect(result['app_id']).toBe('dev');
  });
});

describe('ecp_input happy path', () => {
  it('calls input(params) and returns { ok, host }', async () => {
    const input = vi.fn().mockResolvedValue(undefined);
    mockEcpControl({ input });

    const result = (await call('ecp_input', {
      host: '127.0.0.1',
      params: { foo: 'bar' },
    })) as Record<string, unknown>;

    expect(input).toHaveBeenCalledWith({ foo: 'bar' });
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('127.0.0.1');
  });
});

describe('ecp_to_home happy path', () => {
  it('calls toHome() and returns { ok, host }', async () => {
    const toHome = vi.fn().mockResolvedValue(undefined);
    mockEcpControl({ toHome });

    const result = (await call('ecp_to_home', { host: '127.0.0.1' })) as Record<string, unknown>;

    expect(toHome).toHaveBeenCalledTimes(1);
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('127.0.0.1');
  });
});

// ---------------------------------------------------------------------------
// 3. Disallowed key surfaces ECP_KEY_DISALLOWED (pass-through)
// ---------------------------------------------------------------------------

describe('ecp_keypress disallowed key', () => {
  it('rejects with ECP_KEY_DISALLOWED failure unmodified', async () => {
    const keyDisallowed = fail('ECP_KEY_DISALLOWED', 'key not allowed: BADKEY', { key: 'BADKEY' });
    const keypress = vi.fn().mockRejectedValue(keyDisallowed);
    mockEcpControl({ keypress });

    await expect(call('ecp_keypress', { host: '127.0.0.1', key: 'BADKEY' })).rejects.toMatchObject({
      ok: false,
      code: 'ECP_KEY_DISALLOWED',
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Disallowed param surfaces ECP_PARAM_DISALLOWED (pass-through)
// ---------------------------------------------------------------------------

describe('ecp_launch disallowed param', () => {
  it('rejects with ECP_PARAM_DISALLOWED failure unmodified', async () => {
    const paramDisallowed = fail('ECP_PARAM_DISALLOWED', 'param key not allowed: evil', {
      key: 'evil',
    });
    const launch = vi.fn().mockRejectedValue(paramDisallowed);
    mockEcpControl({ launch });

    await expect(
      call('ecp_launch', { host: '127.0.0.1', app_id: 'dev', params: { evil: 'x' } }),
    ).rejects.toMatchObject({ ok: false, code: 'ECP_PARAM_DISALLOWED' });
  });
});

// ---------------------------------------------------------------------------
// 5. repeat: 5 calls keypress 5 times
// ---------------------------------------------------------------------------

describe('ecp_keypress repeat', () => {
  it('calls keypress N times when repeat is given', async () => {
    const keypress = vi.fn().mockResolvedValue(undefined);
    mockEcpControl({ keypress });

    await call('ecp_keypress', { host: '127.0.0.1', key: 'Down', repeat: 5 });

    expect(keypress).toHaveBeenCalledTimes(5);
    // Each call should be with ('Down', 'press').
    for (const [args] of keypress.mock.calls) {
      expect(args).toBe('Down');
    }
    expect(keypress.mock.calls[0]).toEqual(['Down', 'press']);
  });
});

// ---------------------------------------------------------------------------
// 6. force: true / false passes through to checkReachable
// ---------------------------------------------------------------------------

describe('ecp_keypress force flag', () => {
  it('calls checkReachable with (undefined, false) when force is absent', async () => {
    mockEcpControl({});

    await call('ecp_keypress', { host: '127.0.0.1', key: 'Up' });

    expect(mocks.checkReachable).toHaveBeenCalledWith(undefined, false);
  });

  it('calls checkReachable with (undefined, true) when force: true', async () => {
    mockEcpControl({});

    await call('ecp_keypress', { host: '127.0.0.1', key: 'Up', force: true });

    expect(mocks.checkReachable).toHaveBeenCalledWith(undefined, true);
  });
});

// ---------------------------------------------------------------------------
// 7. mode: 'down' is propagated to keypress
// ---------------------------------------------------------------------------

describe('ecp_keypress mode propagation', () => {
  it('passes mode: "down" to EcpControl.keypress', async () => {
    const keypress = vi.fn().mockResolvedValue(undefined);
    mockEcpControl({ keypress });

    const result = (await call('ecp_keypress', {
      host: '127.0.0.1',
      key: 'PowerOff',
      mode: 'down',
    })) as Record<string, unknown>;

    expect(keypress).toHaveBeenCalledWith('PowerOff', 'down');
    expect(result['mode']).toBe('down');
  });
});

// ---------------------------------------------------------------------------
// 8. ecp_keysequence default delay_ms
// ---------------------------------------------------------------------------

describe('ecp_keysequence default delay_ms', () => {
  it('defaults delay_ms to 150 when omitted', async () => {
    const keysequence = vi.fn().mockResolvedValue(undefined);
    mockEcpControl({ keysequence });

    await call('ecp_keysequence', { host: '127.0.0.1', keys: ['Select'] });

    expect(keysequence).toHaveBeenCalledWith(['Select'], 150);
  });
});

// ---------------------------------------------------------------------------
// 9. ecp_launch without params
// ---------------------------------------------------------------------------

describe('ecp_launch without params', () => {
  it('calls launch with undefined params when omitted', async () => {
    const launch = vi.fn().mockResolvedValue(undefined);
    mockEcpControl({ launch });

    await call('ecp_launch', { host: '127.0.0.1', app_id: '12' });

    expect(launch).toHaveBeenCalledWith('12', undefined);
  });
});
