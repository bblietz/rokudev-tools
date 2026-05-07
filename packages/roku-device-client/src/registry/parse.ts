import { parse as parseToml } from 'smol-toml';
import { RegistrySchema, type Registry } from './types.js';

export function parseRegistry(text: string): Registry {
  if (text.trim() === '') {
    return { devices: {}, networks: {} };
  }
  const raw = parseToml(text) as Record<string, unknown>;
  // Normalize: smol-toml returns nested tables as objects; ensure devices/networks keys exist.
  return RegistrySchema.parse({
    active: raw['active'],
    devices: raw['devices'] ?? {},
    networks: raw['networks'] ?? {},
  });
}

export function serializeRegistry(r: Registry): string {
  // smol-toml does not emit nested-table headers in the form we want for empty
  // records, so build the output manually for full control over formatting and
  // determinism.
  const lines: string[] = [];
  lines.push('# brs-tools device registry');
  lines.push('# WARNING: dev_password stored in plaintext. Set BRS_NO_PLAINTEXT=1 to refuse.');
  lines.push('');
  if (r.active !== undefined) {
    lines.push(`active = ${JSON.stringify(r.active)}`);
    lines.push('');
  }
  for (const name of Object.keys(r.devices).sort()) {
    const d = r.devices[name]!;
    lines.push(`[devices.${name}]`);
    for (const [k, v] of Object.entries(d).sort(([a], [b]) => a.localeCompare(b))) {
      if (v === undefined) continue;
      lines.push(`${k} = ${JSON.stringify(v)}`);
    }
    lines.push('');
  }
  for (const name of Object.keys(r.networks).sort()) {
    const n = r.networks[name]!;
    lines.push(`[networks.${name}]`);
    for (const [k, v] of Object.entries(n).sort(([a], [b]) => a.localeCompare(b))) {
      if (v === undefined) continue;
      lines.push(`${k} = ${JSON.stringify(v)}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
