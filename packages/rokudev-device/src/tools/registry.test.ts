import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// vi.hoisted declares mock functions before the vi.mock factory runs.
const { mockDeviceInfo } = vi.hoisted(() => ({
  mockDeviceInfo: vi.fn(),
}));

// Mock @rokudev/device-client, swapping only EcpClient, keeping everything else real.
vi.mock('@rokudev/device-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rokudev/device-client')>();
  return {
    ...actual,
    EcpClient: vi.fn().mockImplementation(() => ({
      deviceInfo: mockDeviceInfo,
    })),
  };
});

// Import _register and registry module. The registry module side-effect populates REGISTRARS.
import { registerAllTools, type ToolDef } from './_register.js';
import './registry.js';

let tmpDir: string;
let originalEnv: NodeJS.ProcessEnv;
let tools: Map<string, ToolDef>;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'rokudev-regtools-'));
  originalEnv = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ROKUDEV_')) delete process.env[k];
  }
  process.env['ROKUDEV_CONFIG_DIR'] = tmpDir;
  tools = new Map();
  registerAllTools(tools);
  mockDeviceInfo.mockReset();
});

afterEach(async () => {
  process.env = originalEnv;
  await rm(tmpDir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const def = tools.get(name);
  if (!def) throw new Error(`tool ${name} not registered`);
  return def.handler(args);
}

// ---------------------------------------------------------------------------
// Schema / registration smoke
// ---------------------------------------------------------------------------

describe('registry tool registration', () => {
  it('registers all six tools with required shape', () => {
    const names = [
      'device_list', 'device_add', 'device_set_password',
      'device_set_active', 'device_remove', 'device_test',
    ];
    for (const name of names) {
      expect(tools.has(name), `${name} not registered`).toBe(true);
      const def = tools.get(name)!;
      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(def.inputSchema).toBeDefined();
      expect((def.inputSchema as Record<string, unknown>)['type']).toBe('object');
      expect(typeof def.handler).toBe('function');
    }
  });

  it('registers device_discover with the right schema', () => {
    const def = tools.get('device_discover');
    expect(def).toBeDefined();
    expect(def!.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        timeout_ms: { type: 'integer', minimum: 500, maximum: 30_000, default: 3500 },
      },
    });
  });
});

// ---------------------------------------------------------------------------
// device_list
// ---------------------------------------------------------------------------

describe('device_list', () => {
  it('returns empty device list when registry does not exist', async () => {
    const result = await call('device_list') as { ok: boolean; devices: unknown[]; active?: string };
    expect(result.ok).toBe(true);
    expect(result.devices).toEqual([]);
    expect(result.active).toBeUndefined();
  });

  it('returns one entry after device_add', async () => {
    await call('device_add', { name: 'home-tv', host: '1.1.1.1', model: 'Roku TV' });
    const result = await call('device_list') as { ok: boolean; devices: unknown[]; active?: string };
    expect(result.ok).toBe(true);
    expect(result.devices).toHaveLength(1);
    const first = result.devices[0] as Record<string, unknown>;
    expect(first['name']).toBe('home-tv');
    expect(first['host']).toBe('1.1.1.1');
  });
});

// ---------------------------------------------------------------------------
// device_add
// ---------------------------------------------------------------------------

describe('device_add', () => {
  it('adds device and persists to devices.toml', async () => {
    const result = await call('device_add', { name: 'home-tv', host: '1.1.1.1' }) as { ok: boolean; name: string };
    expect(result.ok).toBe(true);
    expect(result.name).toBe('home-tv');

    const toml = await readFile(join(tmpDir, 'devices.toml'), 'utf8');
    expect(toml).toContain('home-tv');
    expect(toml).toContain('1.1.1.1');
  });

  it('upserts: second call with same name overrides host', async () => {
    await call('device_add', { name: 'home-tv', host: '1.1.1.1' });
    await call('device_add', { name: 'home-tv', host: '2.2.2.2' });

    const result = await call('device_list') as { ok: boolean; devices: Array<Record<string, unknown>> };
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]?.['host']).toBe('2.2.2.2');
  });

  it('persists added_at ISO timestamp', async () => {
    await call('device_add', { name: 'home-tv', host: '1.1.1.1' });

    const toml = await readFile(join(tmpDir, 'devices.toml'), 'utf8');
    // ISO 8601 dates look like 2026-05-07T...
    expect(toml).toMatch(/added_at\s*=\s*"20\d\d-\d\d-\d\dT/);
  });
});

// ---------------------------------------------------------------------------
// device_set_password
// ---------------------------------------------------------------------------

describe('device_set_password', () => {
  it('sets password on existing device', async () => {
    await call('device_add', { name: 'home-tv', host: '1.1.1.1' });
    const result = await call('device_set_password', { device: 'home-tv', dev_password: 'secret' }) as { ok: boolean; device: string };
    expect(result.ok).toBe(true);
    expect(result.device).toBe('home-tv');

    const toml = await readFile(join(tmpDir, 'devices.toml'), 'utf8');
    expect(toml).toContain('secret');
  });

  it('throws DEVICE_NOT_FOUND when device absent', async () => {
    await expect(call('device_set_password', { device: 'missing-tv', dev_password: 'pw' }))
      .rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// device_set_active
// ---------------------------------------------------------------------------

describe('device_set_active', () => {
  it('marks device as active', async () => {
    await call('device_add', { name: 'home-tv', host: '1.1.1.1' });
    const result = await call('device_set_active', { device: 'home-tv' }) as { ok: boolean; active: string };
    expect(result.ok).toBe(true);
    expect(result.active).toBe('home-tv');

    const listResult = await call('device_list') as { ok: boolean; active?: string };
    expect(listResult.active).toBe('home-tv');
  });

  it('throws DEVICE_NOT_FOUND when device absent', async () => {
    await expect(call('device_set_active', { device: 'missing-tv' }))
      .rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// device_remove
// ---------------------------------------------------------------------------

describe('device_remove', () => {
  it('removes an existing device', async () => {
    await call('device_add', { name: 'home-tv', host: '1.1.1.1' });
    const result = await call('device_remove', { device: 'home-tv' }) as { ok: boolean; device: string };
    expect(result.ok).toBe(true);
    expect(result.device).toBe('home-tv');

    const listResult = await call('device_list') as { ok: boolean; devices: unknown[] };
    expect(listResult.devices).toHaveLength(0);
  });

  it('is idempotent: removing non-existent device does not throw', async () => {
    const result = await call('device_remove', { device: 'ghost-tv' }) as { ok: boolean; device: string };
    expect(result.ok).toBe(true);
    expect(result.device).toBe('ghost-tv');
  });

  it('clears active when the active device is removed', async () => {
    await call('device_add', { name: 'home-tv', host: '1.1.1.1' });
    await call('device_set_active', { device: 'home-tv' });
    await call('device_remove', { device: 'home-tv' });

    const listResult = await call('device_list') as { ok: boolean; active?: string };
    expect(listResult.active).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// device_test
// ---------------------------------------------------------------------------

describe('device_test', () => {
  it('resolves target by host and returns device info', async () => {
    mockDeviceInfo.mockResolvedValue({
      'model-name': 'Roku TV',
      'serial-number': 'X00ABC',
    });

    const result = await call('device_test', { host: '5.5.5.5' }) as {
      ok: boolean; host: string; model: string; serial: string;
    };
    expect(result.ok).toBe(true);
    expect(result.host).toBe('5.5.5.5');
    expect(result.model).toBe('Roku TV');
    expect(result.serial).toBe('X00ABC');
  });

  it('throws DEVICE_NOT_RESOLVED when no host provided and registry is empty', async () => {
    await expect(call('device_test', {}))
      .rejects.toMatchObject({ code: 'DEVICE_NOT_RESOLVED' });
  });
});
