import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RegistryReader } from './reader.js';

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'brs-test-'));
  process.env['BRS_CONFIG_DIR'] = tmp;
});

afterEach(async () => {
  delete process.env['BRS_CONFIG_DIR'];
  await rm(tmp, { recursive: true, force: true });
});

describe('RegistryReader', () => {
  it('returns empty when file does not exist', async () => {
    const r = await new RegistryReader().read();
    expect(r).toEqual({ devices: {}, networks: {} });
  });

  it('reads an existing registry', async () => {
    await writeFile(join(tmp, 'devices.toml'),
      `active = "home"\n[devices.home]\nhost = "1.2.3.4"\n`);
    const r = await new RegistryReader().read();
    expect(r.active).toBe('home');
    expect(r.devices.home?.host).toBe('1.2.3.4');
  });

  it('getDevice returns undefined for missing entries', async () => {
    expect(await new RegistryReader().getDevice('absent')).toBeUndefined();
  });
});
