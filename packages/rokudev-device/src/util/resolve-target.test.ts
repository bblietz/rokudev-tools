import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTarget } from './resolve-target.js';

let tmpDir: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'rokudev-resolve-'));
  originalEnv = { ...process.env };
  // Clear any ROKUDEV_* env vars that could pollute tests.
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('ROKUDEV_')) delete process.env[k];
  }
  process.env['ROKUDEV_CONFIG_DIR'] = tmpDir;
});

afterEach(async () => {
  process.env = originalEnv;
  await rm(tmpDir, { recursive: true, force: true });
});

async function writeRegistry(toml: string): Promise<void> {
  await writeFile(join(tmpDir, 'devices.toml'), toml, 'utf8');
}

describe('resolveTarget', () => {
  // Scenario 1: per-call host wins over env and registry
  it('per-call host wins over global env and registry', async () => {
    process.env['ROKUDEV_DEFAULT_ROKU_HOST'] = '9.9.9.9';
    await writeRegistry(`active = "home-tv"\n[devices.home-tv]\nhost = "1.1.1.1"\n`);

    const result = await resolveTarget({ host: '5.5.5.5' });

    expect(result).toEqual({ host: '5.5.5.5' });
    expect(result).not.toHaveProperty('device');
    expect(result).not.toHaveProperty('dev_password');
  });

  // Scenario 2a: per-call host + per-call dev_password returned together
  it('per-call host and dev_password are returned together', async () => {
    const result = await resolveTarget({ host: '5.5.5.5', dev_password: 'secret' });

    expect(result).toEqual({ host: '5.5.5.5', dev_password: 'secret' });
  });

  // Scenario 2b: legacy device_ip alias works
  it('legacy device_ip alias resolves to host', async () => {
    const result = await resolveTarget({ device_ip: '5.5.5.5' });

    expect(result).toEqual({ host: '5.5.5.5' });
  });

  // Scenario 2c: per-call passes device: through if both device and host given
  it('device: passes through when both device and host are given', async () => {
    const result = await resolveTarget({ device: 'home-tv', host: '5.5.5.5' });

    expect(result).toEqual({ device: 'home-tv', host: '5.5.5.5' });
  });

  // Scenario 3: device: arg + per-device env (ROKUDEV_HOST_HOME_TV) overrides registry host
  it('per-device env host overrides registry host for named device', async () => {
    await writeRegistry(`[devices.home-tv]\nhost = "1.1.1.1"\n`);
    process.env['ROKUDEV_HOST_HOME_TV'] = '2.2.2.2';

    const result = await resolveTarget({ device: 'home-tv' });

    expect(result).toEqual({ device: 'home-tv', host: '2.2.2.2' });
  });

  // Scenario 4: device: arg + per-device env password overrides registry password
  it('per-device env password overrides registry password', async () => {
    await writeRegistry(`[devices.home-tv]\nhost = "1.1.1.1"\ndev_password = "oldpw"\n`);
    process.env['ROKUDEV_DEV_PASSWORD_HOME_TV'] = 'newpw';

    const result = await resolveTarget({ device: 'home-tv' });

    expect(result).toEqual({ device: 'home-tv', host: '1.1.1.1', dev_password: 'newpw' });
  });

  // Scenario 5: active-device + per-device env vars override registry (no device arg)
  it('active device per-device env host overrides registry when no device arg', async () => {
    await writeRegistry(`active = "home-tv"\n[devices.home-tv]\nhost = "1.1.1.1"\n`);
    process.env['ROKUDEV_HOST_HOME_TV'] = '2.2.2.2';

    const result = await resolveTarget({});

    expect(result).toEqual({ device: 'home-tv', host: '2.2.2.2' });
  });

  // Scenario 6: global env used when no device: and no active
  it('global env vars used when no device arg and no active in registry', async () => {
    // No writeRegistry call — registry is empty
    process.env['ROKUDEV_DEFAULT_ROKU_HOST'] = '9.9.9.9';
    process.env['ROKUDEV_ROKU_DEV_PASSWORD'] = 'globalpw';

    const result = await resolveTarget({});

    expect(result).toEqual({ host: '9.9.9.9', dev_password: 'globalpw' });
    expect(result).not.toHaveProperty('device');
  });

  // Scenario 7a: active registry device used when no device: and no env
  it('active registry device used as fallback when no device arg and no env', async () => {
    await writeRegistry(`active = "corp-tv-43"\n[devices.corp-tv-43]\nhost = "3.3.3.3"\n`);

    const result = await resolveTarget({});

    expect(result).toEqual({ device: 'corp-tv-43', host: '3.3.3.3' });
  });

  // Scenario 7b: env-var name normalization: corp-tv-43 probes ROKUDEV_HOST_CORP_TV_43
  it('env-var name normalization: dashes and digits map to underscores/uppercase', async () => {
    await writeRegistry(`active = "corp-tv-43"\n[devices.corp-tv-43]\nhost = "3.3.3.3"\n`);
    process.env['ROKUDEV_HOST_CORP_TV_43'] = '4.4.4.4';

    const result = await resolveTarget({});

    expect(result).toEqual({ device: 'corp-tv-43', host: '4.4.4.4' });
  });

  // Scenario 8: DEVICE_NOT_RESOLVED thrown when nothing resolves
  it('throws DEVICE_NOT_RESOLVED when no host can be resolved', async () => {
    // No registry file, no env vars.
    await expect(resolveTarget({})).rejects.toMatchObject({
      ok: false,
      code: 'DEVICE_NOT_RESOLVED',
      stage: 'device',
      details: { tried: expect.arrayContaining(['per-call', 'global-env']) },
    });
  });

  // Additional: DEVICE_NOT_RESOLVED tried array includes registry step when device name is present
  it('tried array includes registry step when device arg given but not found', async () => {
    // No registry file, no env vars.
    await expect(resolveTarget({ device: 'missing-tv' })).rejects.toMatchObject({
      ok: false,
      code: 'DEVICE_NOT_RESOLVED',
      stage: 'device',
      details: { tried: expect.arrayContaining(['per-call', 'registry-device', 'global-env']) },
    });
  });
});
