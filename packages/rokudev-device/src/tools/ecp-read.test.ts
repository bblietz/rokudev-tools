import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Hoisted mock factories — declared before vi.mock() factories run.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  return {
    EcpClient: vi.fn(),
    checkReachable: vi.fn(),
  };
});

// Swap EcpClient only; keep all other exports real.
vi.mock('@rokudev/device-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rokudev/device-client')>();
  return { ...actual, EcpClient: mocks.EcpClient };
});

// Swap checkReachable only; keep resolveTarget real.
vi.mock('../util/network-guard.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../util/network-guard.js')>();
  return { ...actual, checkReachable: mocks.checkReachable };
});

// Side-effect: register ecp-read tools (runs with mocked EcpClient).
await import('./ecp-read.js');

import { registerAllTools, type ToolDef } from './_register.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpDir: string;
let originalEnv: NodeJS.ProcessEnv;
let tools: Map<string, ToolDef>;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'rokudev-ecpread-'));
  originalEnv = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ROKUDEV_')) delete process.env[k];
  }
  process.env['ROKUDEV_CONFIG_DIR'] = tmpDir;
  tools = new Map();
  registerAllTools(tools);

  // Default: checkReachable is a no-op.
  mocks.checkReachable.mockReset();
  mocks.checkReachable.mockResolvedValue(undefined);
  mocks.EcpClient.mockReset();
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

/** Helper: configure EcpClient mock so that the given method returns canned data. */
function mockEcpMethod(method: string, returnValue: unknown): void {
  mocks.EcpClient.mockImplementation((_host: string) => ({
    [method]: vi.fn().mockResolvedValue(returnValue),
  }));
}

// ---------------------------------------------------------------------------
// 1. Schema / registration smoke
// ---------------------------------------------------------------------------

describe('ecp-read registration', () => {
  it('registers all six tools with required schema shape', () => {
    const names = [
      'ecp_device_info',
      'ecp_apps',
      'ecp_active_app',
      'ecp_media_player',
      'ecp_r2d2_bitrate',
      'ecp_icon',
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

  it('ecp_icon has required: ["app_id"] in its schema', () => {
    const def = tools.get('ecp_icon')!;
    const schema = def.inputSchema as Record<string, unknown>;
    expect(schema['required']).toEqual(['app_id']);
  });
});

// ---------------------------------------------------------------------------
// 2. Each tool returns expected shape (6 tests)
// ---------------------------------------------------------------------------

describe('ecp_device_info', () => {
  it('returns { ok, host, info } with device-info map', async () => {
    const cannedInfo: Record<string, string> = { 'model-name': 'Roku TV', 'serial-number': 'ABC' };
    mockEcpMethod('deviceInfo', cannedInfo);

    const result = await call('ecp_device_info', { host: '10.0.0.1' }) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('10.0.0.1');
    expect(result['info']).toEqual(cannedInfo);
    expect(mocks.EcpClient).toHaveBeenCalledWith('10.0.0.1');
  });
});

describe('ecp_apps', () => {
  it('returns { ok, host, apps } with array of app objects', async () => {
    const cannedApps = [
      { id: '12', name: 'Netflix', version: '4.0.218', type: 'appl' },
      { id: '13', name: 'Amazon', version: '2.1.0', type: 'appl' },
    ];
    mockEcpMethod('apps', cannedApps);

    const result = await call('ecp_apps', { host: '10.0.0.2' }) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('10.0.0.2');
    expect(result['apps']).toEqual(cannedApps);
  });
});

describe('ecp_active_app', () => {
  it('returns { ok, host, active } with active-app object', async () => {
    const cannedActive = { id: '12', name: 'Netflix' };
    mockEcpMethod('activeApp', cannedActive);

    const result = await call('ecp_active_app', { host: '10.0.0.3' }) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('10.0.0.3');
    expect(result['active']).toEqual(cannedActive);
  });
});

describe('ecp_media_player', () => {
  it('returns { ok, host, media_player } with player state map', async () => {
    const cannedPlayer: Record<string, string> = { state: 'play', position: '5000', duration: '120000' };
    mockEcpMethod('mediaPlayer', cannedPlayer);

    const result = await call('ecp_media_player', { host: '10.0.0.4' }) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('10.0.0.4');
    expect(result['media_player']).toEqual(cannedPlayer);
  });
});

describe('ecp_r2d2_bitrate', () => {
  it('returns { ok, host, streams } with array of stream records', async () => {
    const cannedStreams = [
      { bitrate: '2000', width: '1280', height: '720' },
      { bitrate: '4000', width: '1920', height: '1080' },
    ];
    mockEcpMethod('r2d2Bitrate', cannedStreams);

    const result = await call('ecp_r2d2_bitrate', { host: '10.0.0.5' }) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('10.0.0.5');
    expect(result['streams']).toEqual(cannedStreams);
  });
});

describe('ecp_icon', () => {
  it('returns { ok, host, mime, bytes, base64 } spread from icon()', async () => {
    const cannedIcon = { mime: 'image/png', bytes: 1024, base64: 'abc123==' };
    mocks.EcpClient.mockImplementation((_host: string) => ({
      icon: vi.fn().mockResolvedValue(cannedIcon),
    }));

    const result = await call('ecp_icon', { host: '10.0.0.6', app_id: '12' }) as Record<string, unknown>;

    expect(result['ok']).toBe(true);
    expect(result['host']).toBe('10.0.0.6');
    expect(result['mime']).toBe('image/png');
    expect(result['bytes']).toBe(1024);
    expect(result['base64']).toBe('abc123==');
  });

  it('passes app_id to EcpClient.icon()', async () => {
    const iconFn = vi.fn().mockResolvedValue({ mime: 'image/jpeg', bytes: 512, base64: 'zz==' });
    mocks.EcpClient.mockImplementation((_host: string) => ({ icon: iconFn }));

    await call('ecp_icon', { host: '10.0.0.6', app_id: '42' });

    expect(iconFn).toHaveBeenCalledWith('42');
  });
});

// ---------------------------------------------------------------------------
// 3. Network guard is invoked
// ---------------------------------------------------------------------------

describe('network guard integration', () => {
  it('calls checkReachable with (undefined, false) when only host is supplied', async () => {
    mockEcpMethod('deviceInfo', { 'model-name': 'Test' });

    await call('ecp_device_info', { host: '10.0.0.9' });

    // resolveTarget returns { host } with no device name when called with host only.
    expect(mocks.checkReachable).toHaveBeenCalledWith(undefined, false);
  });

  it('propagates NETWORK_UNREACHABLE when checkReachable throws', async () => {
    const err = Object.assign(new Error('blocked'), { code: 'NETWORK_UNREACHABLE', ok: false });
    mocks.checkReachable.mockRejectedValue(err);
    mockEcpMethod('deviceInfo', {});

    await expect(call('ecp_device_info', { host: '10.0.0.9' }))
      .rejects.toMatchObject({ code: 'NETWORK_UNREACHABLE' });
  });

  it('force:true passes true to checkReachable', async () => {
    mockEcpMethod('deviceInfo', { 'model-name': 'Test' });

    await call('ecp_device_info', { host: '10.0.0.9', force: true });

    expect(mocks.checkReachable).toHaveBeenCalledWith(undefined, true);
  });
});
