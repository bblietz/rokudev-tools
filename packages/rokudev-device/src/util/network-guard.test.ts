import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Use vi.hoisted to declare mock functions so they are available when the
// hoisted vi.mock factory runs (variables declared with const/let are not
// initialized yet at that point).
const { mockReadFingerprint, mockClassifyNetwork } = vi.hoisted(() => ({
  mockReadFingerprint: vi.fn(),
  mockClassifyNetwork: vi.fn(),
}));

vi.mock('@rokudev/device-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rokudev/device-client')>();
  return {
    ...actual,
    readFingerprint: mockReadFingerprint,
    classifyNetwork: mockClassifyNetwork,
  };
});

// Import after vi.mock declaration so the mock is in effect.
import { checkReachable, _resetCache } from './network-guard.js';

let tmpDir: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'rokudev-netguard-'));
  originalEnv = { ...process.env };
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ROKUDEV_')) delete process.env[k];
  }
  process.env['ROKUDEV_CONFIG_DIR'] = tmpDir;
  _resetCache();
  mockReadFingerprint.mockReset();
  mockClassifyNetwork.mockReset();
});

afterEach(async () => {
  process.env = originalEnv;
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeDevicesToml(toml: string): Promise<void> {
  await writeFile(join(tmpDir, 'devices.toml'), toml, 'utf8');
}

describe('checkReachable', () => {
  // Case 1: force: true never throws even when device's network would be unreachable.
  it('force:true skips the guard and never throws', async () => {
    await writeDevicesToml(`
[devices.corp-tv]
host = "1.2.3.4"
network_tag = "corp"

[networks.corp]
gateway_mac = "aa:bb:cc:dd:ee:ff"
gateway_subnet_v4 = "10.0.0.0/24"
`);
    // Even if classify would say 'home' (different network), force skips the check.
    mockClassifyNetwork.mockReturnValue('home');
    mockReadFingerprint.mockResolvedValue({ vpn_iface_present: false });

    await expect(checkReachable('corp-tv', true)).resolves.toBeUndefined();
    // readFingerprint should not be called when force=true.
    expect(mockReadFingerprint).not.toHaveBeenCalled();
  });

  // Case 2: No network_tag on entry means no policy; never throws.
  it('no network_tag on device entry skips the guard', async () => {
    await writeDevicesToml(`
[devices.home-tv]
host = "5.6.7.8"
# no network_tag
`);
    mockReadFingerprint.mockResolvedValue({ vpn_iface_present: false });
    mockClassifyNetwork.mockReturnValue('home');

    await expect(checkReachable('home-tv', false)).resolves.toBeUndefined();
    // No classification needed; entry has no tag.
    expect(mockReadFingerprint).not.toHaveBeenCalled();
  });

  // Case 3: Classifier returns unreachable => throws NETWORK_UNREACHABLE with details.
  it('throws NETWORK_UNREACHABLE when current network cannot reach device network', async () => {
    await writeDevicesToml(`
[devices.corp-tv]
host = "1.2.3.4"
network_tag = "corp"

[networks.corp]
gateway_mac = "aa:bb:cc:dd:ee:ff"
gateway_subnet_v4 = "10.0.0.0/24"
`);
    // Classify says we're on 'home'; no reachable_from chain on corp => isReachable returns false.
    mockReadFingerprint.mockResolvedValue({ vpn_iface_present: false });
    mockClassifyNetwork.mockReturnValue('home');

    await expect(checkReachable('corp-tv', false)).rejects.toMatchObject({
      ok: false,
      code: 'NETWORK_UNREACHABLE',
      stage: 'device',
      details: { device_network: 'corp', current_network: 'home' },
    });
  });

  // Case 4: Classification is cached for 30s — readFingerprint called once only.
  it('caches the network classification for 30s (readFingerprint called once)', async () => {
    await writeDevicesToml(`
[devices.home-tv]
host = "5.6.7.8"
network_tag = "home"

[networks.home]
gateway_mac = "11:22:33:44:55:66"
gateway_subnet_v4 = "192.168.1.0/24"
`);
    mockReadFingerprint.mockResolvedValue({ vpn_iface_present: false });
    // Both classify calls return 'home' => same network => reachable.
    mockClassifyNetwork.mockReturnValue('home');

    await checkReachable('home-tv', false);
    await checkReachable('home-tv', false);

    expect(mockReadFingerprint).toHaveBeenCalledTimes(1);
  });

  // Case 5: deviceName undefined => never throws (can't enforce policy without target).
  it('deviceName:undefined skips the guard and never throws', async () => {
    mockReadFingerprint.mockResolvedValue({ vpn_iface_present: false });
    mockClassifyNetwork.mockReturnValue('corp');

    await expect(checkReachable(undefined, false)).resolves.toBeUndefined();
    expect(mockReadFingerprint).not.toHaveBeenCalled();
  });

  // Extra: same network => resolves without throwing.
  it('resolves when current network matches device network', async () => {
    await writeDevicesToml(`
[devices.home-tv]
host = "5.6.7.8"
network_tag = "home"

[networks.home]
gateway_mac = "11:22:33:44:55:66"
gateway_subnet_v4 = "192.168.1.0/24"
`);
    mockReadFingerprint.mockResolvedValue({ vpn_iface_present: false });
    mockClassifyNetwork.mockReturnValue('home');

    await expect(checkReachable('home-tv', false)).resolves.toBeUndefined();
  });

  // Extra: current network 'unknown' is always permissive (per §4.2).
  it('current network unknown is permissive and does not throw', async () => {
    await writeDevicesToml(`
[devices.corp-tv]
host = "1.2.3.4"
network_tag = "corp"

[networks.corp]
gateway_mac = "aa:bb:cc:dd:ee:ff"
gateway_subnet_v4 = "10.0.0.0/24"
`);
    mockReadFingerprint.mockResolvedValue({ vpn_iface_present: false });
    mockClassifyNetwork.mockReturnValue('unknown');

    await expect(checkReachable('corp-tv', false)).resolves.toBeUndefined();
  });
});
