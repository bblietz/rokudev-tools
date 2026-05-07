import type { Fingerprint } from './fingerprint.js';
import type { Registry, NetworkTag } from '../registry/types.js';

export function classifyNetwork(fp: Fingerprint, networks: Registry['networks']): NetworkTag {
  // Match each [networks.*] entry: requires gateway_mac AND at least one of
  // gateway_subnet_v4 or dns_search_suffix to match.
  const matches: string[] = [];
  for (const [name, n] of Object.entries(networks)) {
    if (!n.gateway_mac || !fp.gateway_mac) continue;
    if (n.gateway_mac.toLowerCase() !== fp.gateway_mac.toLowerCase()) continue;
    const subnetMatch = !!n.gateway_subnet_v4 && n.gateway_subnet_v4 === fp.gateway_subnet_v4;
    const dnsMatch = !!n.dns_search_suffix && n.dns_search_suffix === fp.dns_search_suffix;
    if (!subnetMatch && !dnsMatch) continue;
    matches.push(name);
  }
  if (matches.length === 0) return 'unknown';
  // home_via_vpn = vpn iface up + matched the corp network.
  if (fp.vpn_iface_present && matches.includes('corp')) return 'home_via_vpn';
  // Pick a known tag; prefer 'home' over 'corp' (explicit priority order).
  for (const tag of ['home', 'corp'] as const) {
    if (matches.includes(tag)) return tag;
  }
  return 'unknown';
}

export function isReachable(
  current: NetworkTag,
  target: NetworkTag,
  networks: Registry['networks'],
): boolean {
  if (current === 'unknown') return true; // permissive on unknown (§4.2)
  if (current === target) return true;
  // Look up the target network's reachable_from list.
  const targetNet = networks[target];
  if (!targetNet?.reachable_from) return false;
  return targetNet.reachable_from.includes(current);
}
