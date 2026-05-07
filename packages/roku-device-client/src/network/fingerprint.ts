import { networkInterfaces } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export type Fingerprint = {
  gateway_mac?: string;
  gateway_subnet_v4?: string; // e.g. "192.168.1.0/24"
  dns_search_suffix?: string; // e.g. "corp.example.com"
  vpn_iface_present: boolean;
};

export type FingerprintIo = {
  readDefaultGatewayIpV4: () => Promise<string | undefined>;
  arpLookupMac: (ip: string) => Promise<string | undefined>;
  readDnsSearch: () => Promise<string | undefined>;
  enumInterfaces: () => ReturnType<typeof networkInterfaces>;
};

export const realFingerprintIo: FingerprintIo = {
  async readDefaultGatewayIpV4() {
    try {
      // BSD/macOS syntax. On Linux, `-f inet` is invalid and netstat fails;
      // the catch below returns undefined, which is permissive (classifies as
      // 'unknown'). Linux support requires a separate code path (e.g. `ip route show default`).
      const { stdout } = await execFileP('netstat', ['-rn', '-f', 'inet']);
      // Match the line beginning with "default" or "0.0.0.0".
      const m = stdout.match(/^(?:default|0\.0\.0\.0\/0|0\.0\.0\.0)\s+(\d+\.\d+\.\d+\.\d+)/m);
      return m?.[1];
    } catch {
      return undefined;
    }
  },
  async arpLookupMac(ip: string) {
    try {
      const { stdout } = await execFileP('arp', ['-n', ip]);
      const m = stdout.match(/(([0-9a-f]{1,2}:){5}[0-9a-f]{1,2})/i);
      return m?.[1]?.toLowerCase();
    } catch {
      return undefined;
    }
  },
  async readDnsSearch() {
    try {
      const { readFile } = await import('node:fs/promises');
      const text = await readFile('/etc/resolv.conf', 'utf8');
      const m = text.match(/^search\s+(\S+)/m) ?? text.match(/^domain\s+(\S+)/m);
      return m?.[1];
    } catch {
      return undefined;
    }
  },
  enumInterfaces: () => networkInterfaces(),
};

export async function readFingerprint(io: FingerprintIo = realFingerprintIo): Promise<Fingerprint> {
  const gwIp = await io.readDefaultGatewayIpV4();
  const gateway_mac = gwIp ? await io.arpLookupMac(gwIp) : undefined;
  const dns_search_suffix = await io.readDnsSearch();
  const ifaces = io.enumInterfaces();
  let gateway_subnet_v4: string | undefined;
  let vpn_iface_present = false;
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    if (/^(utun|tun|tap)/.test(name)) {
      const hasNonLocal = addrs.some((a) => a.family === 'IPv4' && !a.internal);
      if (hasNonLocal) vpn_iface_present = true;
    }
    if (gwIp) {
      for (const a of addrs) {
        if (a.family === 'IPv4' && !a.internal && sameSubnet(a.address, a.netmask, gwIp)) {
          gateway_subnet_v4 = makeSlash24(a.address);
        }
      }
    }
  }
  const fp: Fingerprint = { vpn_iface_present };
  if (gateway_mac !== undefined) fp.gateway_mac = gateway_mac;
  if (gateway_subnet_v4 !== undefined) fp.gateway_subnet_v4 = gateway_subnet_v4;
  if (dns_search_suffix !== undefined) fp.dns_search_suffix = dns_search_suffix;
  return fp;
}

function sameSubnet(addr: string, mask: string, target: string): boolean {
  const a = ip4ToInt(addr),
    m = ip4ToInt(mask),
    t = ip4ToInt(target);
  return (a & m) === (t & m);
}
function ip4ToInt(s: string): number {
  return s.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct, 10), 0) >>> 0;
}
function makeSlash24(addr: string): string {
  const parts = addr.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}
