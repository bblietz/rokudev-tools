import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RegistryWriter } from './writer.js';
import { RegistryReader } from './reader.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'rokudev-test-'));
  process.env['ROKUDEV_CONFIG_DIR'] = tmp;
});
afterEach(async () => {
  delete process.env['ROKUDEV_CONFIG_DIR'];
  await rm(tmp, { recursive: true, force: true });
});

describe('RegistryWriter', () => {
  it('addDevice creates file with 0600 perms', async () => {
    const w = new RegistryWriter();
    await w.addDevice('home', { host: '1.2.3.4' });
    const s = await stat(join(tmp, 'devices.toml'));
    expect(s.mode & 0o777).toBe(0o600);
    const r = await new RegistryReader().read();
    expect(r.devices.home?.host).toBe('1.2.3.4');
  });

  it('addDevice rejects invalid names', async () => {
    const w = new RegistryWriter();
    await expect(w.addDevice('bad name', { host: 'x' })).rejects.toMatchObject({
      ok: false, code: 'INVALID_DEVICE_NAME',
    });
  });

  it('setPassword on existing device persists', async () => {
    const w = new RegistryWriter();
    await w.addDevice('home', { host: '1.2.3.4' });
    await w.setPassword('home', 'secret');
    const r = await new RegistryReader().read();
    expect(r.devices.home?.dev_password).toBe('secret');
  });

  it('setPassword on missing device throws DEVICE_NOT_FOUND', async () => {
    const w = new RegistryWriter();
    await expect(w.setPassword('nope', 'x')).rejects.toMatchObject({
      ok: false, code: 'DEVICE_NOT_FOUND',
    });
  });

  it('setActive requires the device to exist', async () => {
    const w = new RegistryWriter();
    await expect(w.setActive('ghost')).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' });
  });

  it('removeDevice clears active when removing the active device', async () => {
    const w = new RegistryWriter();
    await w.addDevice('home', { host: '1.2.3.4' });
    await w.setActive('home');
    await w.removeDevice('home');
    expect(await new RegistryReader().getActive()).toBeUndefined();
  });

  it('two concurrent writes do not corrupt the file', async () => {
    const w = new RegistryWriter();
    await w.addDevice('a', { host: '1.1.1.1' });
    // Fire 10 concurrent updates that each add a device.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => w.addDevice(`d${i}`, { host: `10.0.0.${i}` })),
    );
    const r = await new RegistryReader().read();
    for (let i = 0; i < 10; i++) {
      expect(r.devices[`d${i}`]?.host).toBe(`10.0.0.${i}`);
    }
    expect(r.devices.a?.host).toBe('1.1.1.1');
    expect(Object.keys(r.devices).length).toBe(11);
  });
});
