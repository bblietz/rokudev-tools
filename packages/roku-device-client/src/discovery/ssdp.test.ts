import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dgram from 'node:dgram';
import { discover, type Discovered } from './ssdp.js';

let server: dgram.Socket;
let port: number;

beforeAll(async () => {
  server = dgram.createSocket('udp4');
  server.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');
    if (text.startsWith('M-SEARCH') && /ST:\s*roku:ecp/i.test(text)) {
      const reply = [
        'HTTP/1.1 200 OK',
        'CACHE-CONTROL: max-age=300',
        'ST: roku:ecp',
        'USN: uuid:roku:ecp:X00100ABCDEF',
        'LOCATION: http://127.0.0.1:8060/',
        '',
      ].join('\r\n');
      server.send(reply, rinfo.port, rinfo.address);
    }
  });
  await new Promise<void>((r) => {
    server.bind(0, '127.0.0.1', () => r());
  });
  const addr = server.address();
  port = (addr as { port: number }).port;
});

afterAll(() => {
  return new Promise<void>((r) => server.close(() => r()));
});

describe('discover', () => {
  it('returns Discovered when a fake SSDP responder replies', async () => {
    const results: Discovered[] = await discover({
      multicastAddr: '127.0.0.1',
      multicastPort: port,
      timeoutMs: 1000,
    });
    expect(results.length).toBeGreaterThanOrEqual(1);
    const r = results[0]!;
    expect(r.location).toBe('http://127.0.0.1:8060/');
    expect(r.serial).toBe('X00100ABCDEF');
    expect(r.host).toBe('127.0.0.1');
  });

  it('returns empty when nothing responds', async () => {
    // Use a port with no listener.
    const results = await discover({
      multicastAddr: '127.0.0.1',
      multicastPort: 65530, // unlikely to have responder
      timeoutMs: 200,
    });
    expect(results).toEqual([]);
  });
});
