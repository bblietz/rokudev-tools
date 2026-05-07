import { describe, it, expect } from 'vitest';
import { parseRegistry, serializeRegistry } from './parse.js';
import { RegistrySchema } from './types.js';

describe('registry/parse', () => {
  it('returns empty registry on empty input', () => {
    expect(parseRegistry('')).toEqual({ devices: {}, networks: {} });
  });

  it('parses a minimal registry', () => {
    const text = `
active = "home-tv"

[devices.home-tv]
host = "192.168.1.42"
network_tag = "home"
dev_password = "rokudev"

[networks.home]
gateway_mac = "ac:de:48:00:11:22"
`;
    const r = parseRegistry(text);
    expect(r.active).toBe('home-tv');
    expect(r.devices['home-tv']?.host).toBe('192.168.1.42');
    expect(r.devices['home-tv']?.network_tag).toBe('home');
    expect(r.networks.home?.gateway_mac).toBe('ac:de:48:00:11:22');
  });

  it('rejects invalid network_tag', () => {
    expect(() => parseRegistry('[devices.x]\nhost = "1.1.1.1"\nnetwork_tag = "garage"\n')).toThrow();
  });

  it('rejects invalid device name when constructed in-memory', () => {
    // TOML keys with spaces are rejected by the TOML parser itself, which is
    // not what we want to assert here; the schema validation is the load-bearing
    // check. Construct the object directly and run RegistrySchema.parse.
    expect(() => RegistrySchema.parse({
      devices: { 'bad name': { host: '1.1.1.1' } },
      networks: {},
    })).toThrow();
  });

  it('rejects invalid device name appearing through TOML quoted-key parse', () => {
    // smol-toml accepts quoted keys with arbitrary characters; our DeviceNameSchema
    // is the load-bearing rejection. Ensure that an attacker cannot smuggle a
    // slash-bearing device name through the TOML layer.
    const text = '[devices."with/slash"]\nhost = "1.1.1.1"\n';
    expect(() => parseRegistry(text)).toThrow();
  });

  it('serialize then parse round-trips devices and networks', () => {
    const r = {
      active: 'a',
      devices: {
        a: { host: '10.0.0.1', dev_password: 'p', network_tag: 'corp' as const },
        b: { host: '10.0.0.2' },
      },
      networks: {
        corp: { gateway_mac: '00:11:22:33:44:55', reachable_from: ['corp', 'home_via_vpn'] },
      },
    };
    const r2 = parseRegistry(serializeRegistry(r));
    expect(r2).toEqual(r);
  });

  it('serialize is deterministic (sorted keys)', () => {
    const r1 = parseRegistry(serializeRegistry({
      devices: { z: { host: 'h' }, a: { host: 'h' } },
      networks: {},
    }));
    const r2 = parseRegistry(serializeRegistry({
      devices: { a: { host: 'h' }, z: { host: 'h' } },
      networks: {},
    }));
    expect(serializeRegistry(r1)).toBe(serializeRegistry(r2));
  });
});
