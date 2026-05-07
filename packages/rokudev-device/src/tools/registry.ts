import { registerToolsModule, type ToolDef } from './_register.js';
import { RegistryReader, RegistryWriter, EcpClient, type DeviceEntry } from '@rokudev/device-client';

function tool(t: ToolDef): ToolDef { return t; }

registerToolsModule((tools) => {
  tools.set('device_list', tool({
    name: 'device_list',
    description: 'List devices in the registry.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const r = await new RegistryReader().read();
      const devices = Object.entries(r.devices).map(([name, d]) => ({
        name, host: d.host, network_tag: d.network_tag, model: d.model, last_seen: d.last_seen,
      }));
      return { ok: true, active: r.active, devices };
    },
  }));

  tools.set('device_add', tool({
    name: 'device_add',
    description: 'Add or upsert a device registry entry. Optionally set dev_password.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        host: { type: 'string' },
        hostname: { type: 'string' },
        network_tag: { type: 'string', enum: ['home', 'corp', 'home_via_vpn', 'unknown'] },
        serial: { type: 'string' }, model: { type: 'string' },
        dev_password: { type: 'string' },
      },
      required: ['name', 'host'], additionalProperties: false,
    },
    handler: async (a) => {
      const w = new RegistryWriter();
      const { name, ...entry } = a as Record<string, string>;
      if (typeof name !== 'string') throw new Error('name is required');
      await w.addDevice(name, { ...entry, added_at: new Date().toISOString() } as DeviceEntry);
      return { ok: true, name };
    },
  }));

  tools.set('device_set_password', tool({
    name: 'device_set_password',
    description: 'Set or update the dev_password for an existing registry entry.',
    inputSchema: {
      type: 'object',
      properties: { device: { type: 'string' }, dev_password: { type: 'string' } },
      required: ['device', 'dev_password'], additionalProperties: false,
    },
    handler: async (a) => {
      await new RegistryWriter().setPassword(a['device'] as string, a['dev_password'] as string);
      return { ok: true, device: a['device'] };
    },
  }));

  tools.set('device_set_active', tool({
    name: 'device_set_active',
    description: 'Mark the named device as the registry-default active device.',
    inputSchema: {
      type: 'object',
      properties: { device: { type: 'string' } },
      required: ['device'], additionalProperties: false,
    },
    handler: async (a) => {
      await new RegistryWriter().setActive(a['device'] as string);
      return { ok: true, active: a['device'] };
    },
  }));

  tools.set('device_remove', tool({
    name: 'device_remove',
    description: 'Remove a device from the registry.',
    inputSchema: {
      type: 'object',
      properties: { device: { type: 'string' } },
      required: ['device'], additionalProperties: false,
    },
    handler: async (a) => {
      await new RegistryWriter().removeDevice(a['device'] as string);
      return { ok: true, device: a['device'] };
    },
  }));

  tools.set('device_test', tool({
    name: 'device_test',
    description: 'Confirm a device is reachable (ECP /query/device-info round-trip).',
    inputSchema: {
      type: 'object',
      properties: { device: { type: 'string' }, host: { type: 'string' } },
      additionalProperties: false,
    },
    handler: async (a) => {
      const { resolveTarget } = await import('../util/resolve-target.js');
      const t = await resolveTarget(a as Record<string, string>);
      const info = await new EcpClient(t.host).deviceInfo();
      return { ok: true, host: t.host, model: info['model-name'], serial: info['serial-number'] };
    },
  }));

  tools.set('device_discover', tool({
    name: 'device_discover',
    description: 'Run an SSDP roku:ecp scan on the current LAN. Returns devices found; does NOT add them to the registry.',
    inputSchema: {
      type: 'object',
      properties: { timeout_ms: { type: 'integer', minimum: 500, maximum: 30_000, default: 3500 } },
      additionalProperties: false,
    },
    handler: async (a) => {
      const { discover } = await import('@rokudev/device-client');
      const list = await discover({ timeoutMs: (a['timeout_ms'] as number | undefined) ?? 3500 });
      return { ok: true, found: list };
    },
  }));
});
