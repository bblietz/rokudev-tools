import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Hoisted mock factories -- declared before vi.mock() factories run.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  attach: vi.fn(),
  checkReachable: vi.fn(),
}));

// Swap BdpSession.attach; keep all other exports real (fail, RegistryReader, etc.).
vi.mock('@rokudev/device-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rokudev/device-client')>();
  return {
    ...actual,
    BdpSession: { attach: mocks.attach },
  };
});

// Swap checkReachable; keep _resetCache real.
vi.mock('../util/network-guard.js', () => ({
  checkReachable: mocks.checkReachable,
  _resetCache: () => {},
}));

// Side-effect: register debug-lifecycle tools (runs with mocked BdpSession).
await import('./debug-lifecycle.js');

import { registerAllTools, type ToolDef } from './_register.js';
import { fail } from '@rokudev/device-client';
import { _resetSessions } from '../util/debug-session-registry.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let originalEnv: NodeJS.ProcessEnv;
let tools: Map<string, ToolDef>;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'rokudev-dbgli-'));
  originalEnv = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ROKUDEV_')) delete process.env[k];
  }
  process.env['ROKUDEV_CONFIG_DIR'] = tmpDir;
  tools = new Map();
  registerAllTools(tools);
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.checkReachable.mockResolvedValue(undefined);
  _resetSessions();
});

afterEach(async () => {
  process.env = originalEnv;
  vi.restoreAllMocks();
  await rm(tmpDir, { recursive: true, force: true });
});

function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const def = tools.get(name);
  if (!def) throw new Error(`tool ${name} not registered`);
  return def.handler(args);
}

function fakeSession(
  opts: {
    bdpVersion?: { major: number; minor: number; patch: number };
    breakpoints?: Array<{ file: string; line: number }>;
    state?: string;
  } = {},
) {
  return {
    bdpVersion: opts.bdpVersion ?? { major: 3, minor: 0, patch: 0 },
    state: opts.state ?? 'live',
    host: '127.0.0.1',
    currentBreakpoints: vi.fn().mockReturnValue(opts.breakpoints ?? []),
    detach: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// 1. Schema registration smoke
// ---------------------------------------------------------------------------

describe('debug lifecycle tool registration', () => {
  it('registers all 3 tools with expected shapes', () => {
    const expected: Record<string, string[]> = {
      debug_attach: [],
      debug_detach: ['session_id'],
      debug_session_state: ['session_id'],
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
// 2. debug_attach happy path with no prior breakpoints
// ---------------------------------------------------------------------------

describe('debug_attach happy path - no prior breakpoints', () => {
  it('returns ok, host, session_id, bdp_version; NO details field', async () => {
    const session = fakeSession();
    mocks.attach.mockResolvedValue(session);

    const result = (await call('debug_attach', { host: '192.168.1.50' })) as Record<
      string,
      unknown
    >;

    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.50');
    expect(typeof result['session_id']).toBe('string');
    expect((result['session_id'] as string).length).toBeGreaterThan(0);
    expect(result['bdp_version']).toEqual({ major: 3, minor: 0, patch: 0 });
    expect(result).not.toHaveProperty('details');
  });
});

// ---------------------------------------------------------------------------
// 3. debug_attach after prior detach with breakpoints -> details populated
// ---------------------------------------------------------------------------

describe('debug_attach with invalidated breakpoints from prior detach', () => {
  it('details.invalidated_breakpoints populated with reason: channel_exited', async () => {
    // First attach + detach with breakpoints.
    const bps = [
      { file: 'pkg:/source/main.brs', line: 42 },
      { file: 'pkg:/source/lib.brs', line: 10 },
    ];
    const session1 = fakeSession({ breakpoints: bps });
    mocks.attach.mockResolvedValue(session1);

    const r1 = (await call('debug_attach', { host: '192.168.1.50' })) as Record<string, unknown>;
    const sid1 = r1['session_id'] as string;

    await call('debug_detach', { session_id: sid1 });

    // Second attach to same host: breakpoints should surface.
    const session2 = fakeSession();
    mocks.attach.mockResolvedValue(session2);

    const result = (await call('debug_attach', { host: '192.168.1.50' })) as Record<
      string,
      unknown
    >;

    expect(result['ok']).toBe(true);
    expect(result).toHaveProperty('details');
    const details = result['details'] as Record<string, unknown>;
    const invalidated = details['invalidated_breakpoints'] as Array<Record<string, unknown>>;
    expect(invalidated).toHaveLength(2);
    expect(invalidated[0]).toEqual({
      file: 'pkg:/source/main.brs',
      line: 42,
      reason: 'channel_exited',
    });
    expect(invalidated[1]).toEqual({
      file: 'pkg:/source/lib.brs',
      line: 10,
      reason: 'channel_exited',
    });
  });
});

// ---------------------------------------------------------------------------
// 4. debug_attach BDP_ATTACH_BUSY on second concurrent attach to same host
// ---------------------------------------------------------------------------

describe('debug_attach BDP_ATTACH_BUSY', () => {
  it('second concurrent attach to same host throws BDP_ATTACH_BUSY', async () => {
    const session = fakeSession();
    mocks.attach.mockResolvedValue(session);

    // First attach succeeds; second attempt to same host without detach.
    await call('debug_attach', { host: '192.168.1.50' });

    await expect(call('debug_attach', { host: '192.168.1.50' })).rejects.toMatchObject({
      ok: false,
      code: 'BDP_ATTACH_BUSY',
      details: { host: '192.168.1.50' },
    });
  });
});

// ---------------------------------------------------------------------------
// 5. debug_attach BDP_VERSION_UNSUPPORTED pass-through
// ---------------------------------------------------------------------------

describe('debug_attach BDP_VERSION_UNSUPPORTED', () => {
  it('propagates failure with full details when BdpSession.attach throws', async () => {
    const err = fail('BDP_VERSION_UNSUPPORTED', 'device uses BDP v1.0.0; client requires >=3.0.0', {
      device_version: { major: 1, minor: 0, patch: 0 },
      supported_range: {
        min: { major: 3, minor: 0, patch: 0 },
        max: { major: 3, minor: 99, patch: 99 },
      },
    });
    mocks.attach.mockRejectedValue(err);

    await expect(call('debug_attach', { host: '192.168.1.50' })).rejects.toMatchObject({
      ok: false,
      code: 'BDP_VERSION_UNSUPPORTED',
      details: {
        device_version: { major: 1, minor: 0, patch: 0 },
      },
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Failure-then-retry (resolves N8): releaseHost runs in catch
// ---------------------------------------------------------------------------

describe('debug_attach failure-then-retry', () => {
  it('first attach fails; second attach to same host succeeds (no BDP_ATTACH_BUSY)', async () => {
    const err = fail('BDP_VERSION_UNSUPPORTED', 'unsupported', {
      device_version: { major: 1, minor: 0, patch: 0 },
      supported_range: {
        min: { major: 3, minor: 0, patch: 0 },
        max: { major: 3, minor: 99, patch: 99 },
      },
    });
    mocks.attach.mockRejectedValueOnce(err);

    await expect(call('debug_attach', { host: '192.168.1.50' })).rejects.toMatchObject({
      code: 'BDP_VERSION_UNSUPPORTED',
    });

    // Now the host should be released; second attach should work.
    const session = fakeSession();
    mocks.attach.mockResolvedValue(session);

    const result = (await call('debug_attach', { host: '192.168.1.50' })) as Record<
      string,
      unknown
    >;

    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('192.168.1.50');
  });
});

// ---------------------------------------------------------------------------
// 7. debug_detach idempotent
// ---------------------------------------------------------------------------

describe('debug_detach idempotent', () => {
  it('detaching an unknown id returns { ok: true } without error', async () => {
    const result = (await call('debug_detach', { session_id: 'unknown-id-xyz' })) as Record<
      string,
      unknown
    >;
    expect(result['ok']).toBe(true);
    expect(result['session_id']).toBe('unknown-id-xyz');
  });

  it('detaching twice (second call on already-detached id) returns ok without error', async () => {
    const session = fakeSession();
    mocks.attach.mockResolvedValue(session);

    const r1 = (await call('debug_attach', { host: '192.168.1.50' })) as Record<string, unknown>;
    const sid = r1['session_id'] as string;

    await call('debug_detach', { session_id: sid });
    const r2 = (await call('debug_detach', { session_id: sid })) as Record<string, unknown>;

    expect(r2['ok']).toBe(true);
    expect(r2['session_id']).toBe(sid);
  });
});

// ---------------------------------------------------------------------------
// 8. debug_detach with breakpoints persists them for next attach
// ---------------------------------------------------------------------------

describe('debug_detach with breakpoints', () => {
  it('persists breakpoints; next debug_attach surfaces them as invalidated', async () => {
    const bps = [{ file: 'pkg:/source/main.brs', line: 99 }];
    const session1 = fakeSession({ breakpoints: bps });
    mocks.attach.mockResolvedValue(session1);

    const r1 = (await call('debug_attach', { host: '10.0.0.1' })) as Record<string, unknown>;
    await call('debug_detach', { session_id: r1['session_id'] as string });

    // Confirm detach() was called on the session.
    expect(session1.detach).toHaveBeenCalledTimes(1);
    // Confirm breakpoints were snapshotted.
    expect(session1.currentBreakpoints).toHaveBeenCalled();

    // Next attach: breakpoints surface.
    const session2 = fakeSession();
    mocks.attach.mockResolvedValue(session2);
    const r2 = (await call('debug_attach', { host: '10.0.0.1' })) as Record<string, unknown>;

    expect(r2).toHaveProperty('details');
    const details = r2['details'] as Record<string, unknown>;
    const invalidated = details['invalidated_breakpoints'] as Array<Record<string, unknown>>;
    expect(invalidated).toHaveLength(1);
    expect(invalidated[0]).toMatchObject({
      file: 'pkg:/source/main.brs',
      line: 99,
      reason: 'channel_exited',
    });
  });
});

// ---------------------------------------------------------------------------
// 9. debug_session_state returns 'detached' post-detach
// ---------------------------------------------------------------------------

describe('debug_session_state after detach', () => {
  it('returns state: detached (not connection_lost) after explicit detach', async () => {
    const session = fakeSession();
    mocks.attach.mockResolvedValue(session);

    const r1 = (await call('debug_attach', { host: '192.168.1.50' })) as Record<string, unknown>;
    const sid = r1['session_id'] as string;

    await call('debug_detach', { session_id: sid });

    const state = (await call('debug_session_state', { session_id: sid })) as Record<
      string,
      unknown
    >;

    expect(state['ok']).toBe(true);
    expect(state['session_id']).toBe(sid);
    expect(state['state']).toBe('detached');
    expect(state['bdp_version']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. debug_session_state returns 'unknown' for never-issued id
// ---------------------------------------------------------------------------

describe('debug_session_state for unknown id', () => {
  it('returns state: unknown without throwing', async () => {
    const result = (await call('debug_session_state', {
      session_id: 'never-issued-abc',
    })) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['session_id']).toBe('never-issued-abc');
    expect(result['state']).toBe('unknown');
    expect(result['bdp_version']).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. debug_session_state returns 'live' with correct bdp_version for active session
// ---------------------------------------------------------------------------

describe('debug_session_state for live session', () => {
  it('returns state: live with bdp_version from session', async () => {
    const session = fakeSession({ bdpVersion: { major: 3, minor: 1, patch: 2 } });
    mocks.attach.mockResolvedValue(session);

    const r1 = (await call('debug_attach', { host: '192.168.1.50' })) as Record<string, unknown>;
    const sid = r1['session_id'] as string;

    const state = (await call('debug_session_state', { session_id: sid })) as Record<
      string,
      unknown
    >;

    expect(state['ok']).toBe(true);
    expect(state['session_id']).toBe(sid);
    expect(state['state']).toBe('live');
    expect(state['bdp_version']).toEqual({ major: 3, minor: 1, patch: 2 });
  });
});
