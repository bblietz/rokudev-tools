import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Hoisted mock factories — declared before vi.mock() factories run.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  TelnetClient: vi.fn(),
  LogStreamOpen: vi.fn(),     // wired as LogStream.open
  checkReachable: vi.fn(),
}));

// Swap TelnetClient and LogStream; keep all other exports real.
vi.mock('@rokudev/device-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rokudev/device-client')>();
  return {
    ...actual,
    TelnetClient: mocks.TelnetClient,
    LogStream: { open: mocks.LogStreamOpen },     // class-with-static replacement
  };
});

// Swap checkReachable; keep _resetCache real.
vi.mock('../util/network-guard.js', () => ({
  checkReachable: mocks.checkReachable,
  _resetCache: () => {},
}));

// Side-effect: register log tools (runs with mocked classes).
await import('./log.js');
const { _resetSessions } = await import('./log.js');

import { registerAllTools, type ToolDef } from './_register.js';
import { fail } from '@rokudev/device-client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let originalEnv: NodeJS.ProcessEnv;
let tools: Map<string, ToolDef>;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'rokudev-log-'));
  originalEnv = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ROKUDEV_')) delete process.env[k];
  }
  process.env['ROKUDEV_CONFIG_DIR'] = tmpDir;
  tools = new Map();
  registerAllTools(tools);

  // Reset all mocks then configure defaults.
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.checkReachable.mockResolvedValue(undefined);

  // Clear session state between tests.
  _resetSessions();
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

// ---------------------------------------------------------------------------
// 1. Schema registration smoke
// ---------------------------------------------------------------------------

describe('log tool registration', () => {
  it('registers all 4 tools with expected shape', () => {
    const expected: Record<string, string[]> = {
      log_tail:         [],
      log_stream_open:  [],
      log_stream_read:  ['session_id'],
      log_stream_close: ['session_id'],
    };

    for (const [name, required] of Object.entries(expected)) {
      expect(tools.has(name), `${name} not registered`).toBe(true);
      const def = tools.get(name)!;
      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(def.inputSchema).toBeDefined();
      const schema = def.inputSchema as Record<string, unknown>;
      expect(schema['type']).toBe('object');
      expect(typeof def.handler).toBe('function');
      if (required.length > 0) {
        expect(schema['required']).toEqual(expect.arrayContaining(required));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. log_tail returns lines
// ---------------------------------------------------------------------------

describe('log_tail', () => {
  it('uses default port 8085 and seconds 10, returns { ok, host, port, lines }', async () => {
    const tail = vi.fn().mockResolvedValue(['line1', 'line2']);
    mocks.TelnetClient.mockImplementation(() => ({ tail }));

    const result = await call('log_tail', { host: '192.168.1.50' }) as Record<string, unknown>;

    expect(tail).toHaveBeenCalledWith('192.168.1.50', 8085, 10);
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.50');
    expect(result['port']).toBe(8085);
    expect(result['lines']).toEqual(['line1', 'line2']);
  });

  it('propagates custom port 8087 and seconds 0.5', async () => {
    const tail = vi.fn().mockResolvedValue(['a', 'b', 'c']);
    mocks.TelnetClient.mockImplementation(() => ({ tail }));

    const result = await call('log_tail', { host: '10.0.0.1', port: 8087, seconds: 0.5 }) as Record<string, unknown>;

    expect(tail).toHaveBeenCalledWith('10.0.0.1', 8087, 0.5);
    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('10.0.0.1');
    expect(result['port']).toBe(8087);
    expect(result['lines']).toEqual(['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// 3. log_stream_open returns session_id
// ---------------------------------------------------------------------------

describe('log_stream_open', () => {
  it('returns { ok, session_id, host, port } with a non-empty session_id string', async () => {
    const fakeStream = { read: vi.fn(), close: vi.fn() };
    mocks.LogStreamOpen.mockResolvedValue(fakeStream);

    const result = await call('log_stream_open', { host: '192.168.1.50' }) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(typeof result['session_id']).toBe('string');
    expect((result['session_id'] as string).length).toBeGreaterThan(0);
    expect(result['host']).toBe('192.168.1.50');
    expect(result['port']).toBe(8085);
  });

  it('calls LogStream.open with (host, port)', async () => {
    const fakeStream = { read: vi.fn(), close: vi.fn() };
    mocks.LogStreamOpen.mockResolvedValue(fakeStream);

    await call('log_stream_open', { host: '10.0.0.5', port: 8080 });

    expect(mocks.LogStreamOpen).toHaveBeenCalledWith('10.0.0.5', 8080);
  });
});

// ---------------------------------------------------------------------------
// 4. log_stream_read returns canonical shape
// ---------------------------------------------------------------------------

describe('log_stream_read', () => {
  it('returns { ok, lines } for a valid session', async () => {
    const fakeStream = {
      read: vi.fn().mockReturnValue({ lines: ['a', 'b'] }),
      close: vi.fn(),
    };
    mocks.LogStreamOpen.mockResolvedValue(fakeStream);

    const openResult = await call('log_stream_open', { host: '192.168.1.50' }) as Record<string, unknown>;
    const sid = openResult['session_id'] as string;

    const result = await call('log_stream_read', { session_id: sid }) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['lines']).toEqual(['a', 'b']);
    expect(result).not.toHaveProperty('details');
  });

  it('passes LOG_STREAM_OVERFLOW warning through without recoding', async () => {
    const warning = { code: 'LOG_STREAM_OVERFLOW' as const, dropped_lines: 5, message: 'x' };
    const fakeStream = {
      read: vi.fn().mockReturnValue({ lines: ['c'], details: { warnings: [warning] } }),
      close: vi.fn(),
    };
    mocks.LogStreamOpen.mockResolvedValue(fakeStream);

    const openResult = await call('log_stream_open', { host: '192.168.1.50' }) as Record<string, unknown>;
    const sid = openResult['session_id'] as string;

    const result = await call('log_stream_read', { session_id: sid }) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['lines']).toEqual(['c']);
    const details = result['details'] as { warnings: typeof warning[] };
    expect(details.warnings).toHaveLength(1);
    expect(details.warnings[0]?.code).toBe('LOG_STREAM_OVERFLOW');
    expect(details.warnings[0]?.dropped_lines).toBe(5);
  });

  it('throws LOG_STREAM_TIMED_OUT for an unknown session_id', async () => {
    await expect(call('log_stream_read', { session_id: 'nonexistent-id' }))
      .rejects.toMatchObject({ ok: false, code: 'LOG_STREAM_TIMED_OUT', stage: 'device' });
  });
});

// ---------------------------------------------------------------------------
// 5. log_stream_close is idempotent
// ---------------------------------------------------------------------------

describe('log_stream_close', () => {
  it('calls ls.close() and removes the session from the map', async () => {
    const fakeStream = {
      read: vi.fn().mockReturnValue({ lines: [] }),
      close: vi.fn(),
    };
    mocks.LogStreamOpen.mockResolvedValue(fakeStream);

    const openResult = await call('log_stream_open', { host: '192.168.1.50' }) as Record<string, unknown>;
    const sid = openResult['session_id'] as string;

    const closeResult = await call('log_stream_close', { session_id: sid }) as Record<string, unknown>;
    expect(closeResult['ok']).toBe(true);
    expect(fakeStream.close).toHaveBeenCalledTimes(1);

    // Session removed — subsequent read should throw.
    await expect(call('log_stream_read', { session_id: sid }))
      .rejects.toMatchObject({ code: 'LOG_STREAM_TIMED_OUT' });
  });

  it('returns { ok: true } for a non-existent session_id without error', async () => {
    const result = await call('log_stream_close', { session_id: 'does-not-exist' }) as Record<string, unknown>;
    expect(result['ok']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. force: true bypasses checkReachable
// ---------------------------------------------------------------------------

describe('force flag', () => {
  it('passes force=true to checkReachable for log_tail', async () => {
    const tail = vi.fn().mockResolvedValue([]);
    mocks.TelnetClient.mockImplementation(() => ({ tail }));

    await call('log_tail', { host: '192.168.1.50', force: true });

    // checkReachable is called with (device, true) — device is undefined when only host is given.
    expect(mocks.checkReachable).toHaveBeenCalledWith(undefined, true);
  });
});
