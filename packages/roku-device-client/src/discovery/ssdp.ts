import dgram from 'node:dgram';

export type Discovered = {
  host: string;      // IPv4 of the Roku
  location: string;  // ECP base URL e.g. http://192.168.1.42:8060/
  serial?: string;   // from USN if present
};

const M_SEARCH = (host: string): string =>
  `M-SEARCH * HTTP/1.1\r\n` +
  `HOST: ${host}\r\n` +
  `MAN: "ssdp:discover"\r\n` +
  `ST: roku:ecp\r\n` +
  `MX: 3\r\n\r\n`;

export type DiscoverOptions = {
  timeoutMs?: number;
  multicastAddr?: string;
  multicastPort?: number;
};

export async function discover(opts: DiscoverOptions = {}): Promise<Discovered[]> {
  const timeoutMs = opts.timeoutMs ?? 3500;
  const multicastAddr = opts.multicastAddr ?? '239.255.255.250';
  const multicastPort = opts.multicastPort ?? 1900;
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const found = new Map<string, Discovered>();

    sock.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8');
      const loc = /^LOCATION:\s*(\S+)/im.exec(text)?.[1];
      const usn = /^USN:\s*(\S+)/im.exec(text)?.[1];
      if (!loc) return;
      const host = rinfo.address;
      if (found.has(host)) return;
      const serial = usn?.match(/uuid:roku:ecp:(\S+)/i)?.[1];
      found.set(host, { host, location: loc, ...(serial ? { serial } : {}) });
    });

    sock.on('error', () => resolve([...found.values()]));

    sock.bind(() => {
      try {
        sock.setBroadcast(true);
      } catch {
        // broadcast may not be permitted in some sandboxes; continue regardless
      }
      const datagram = Buffer.from(M_SEARCH(`${multicastAddr}:${multicastPort}`));
      sock.send(datagram, 0, datagram.length, multicastPort, multicastAddr);
    });

    setTimeout(() => {
      sock.close();
      resolve([...found.values()]);
    }, timeoutMs);
  });
}
