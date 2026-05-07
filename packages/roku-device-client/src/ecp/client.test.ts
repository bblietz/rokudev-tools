import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EcpClient } from './client.js';

let server: Server;
let host: string;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/xml');
    switch (req.url) {
      case '/query/device-info':
        res.end(`<device-info><serial-number>X001</serial-number><model-name>Roku TV</model-name></device-info>`);
        return;
      case '/query/apps':
        res.end(`<apps><app id="dev" type="appl" version="1.0">My Dev Channel</app><app id="12">Netflix</app></apps>`);
        return;
      case '/query/active-app':
        res.end(`<active-app><app id="dev">My Dev Channel</app></active-app>`);
        return;
      case '/query/media-player':
        res.end(`<player state="play" error="false" position="1234"/>`);
        return;
      case '/query/r2d2_bitrate':
        res.end(`<r2d2-bitrates><bitrate-stream id="0" bitrate="2500000"/><bitrate-stream id="1" bitrate="3500000"/></r2d2-bitrates>`);
        return;
      case '/query/icon/dev':
        res.setHeader('content-type', 'image/png');
        res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        return;
      default:
        res.statusCode = 404;
        res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  host = '127.0.0.1';
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const client = () => new EcpClient(host, port);

describe('EcpClient', () => {
  it('parses deviceInfo', async () => {
    const i = await client().deviceInfo();
    expect(i['serial-number']).toBe('X001');
    expect(i['model-name']).toBe('Roku TV');
  });

  it('parses apps with attributes', async () => {
    const a = await client().apps();
    expect(a[0]?.id).toBe('dev');
    expect(a[1]?.id).toBe('12');
  });

  it('parses activeApp', async () => {
    const a = await client().activeApp();
    expect(a.id).toBe('dev');
  });

  it('parses media-player as flat dict', async () => {
    const p = await client().mediaPlayer();
    expect(p.state).toBe('play');
    expect(p.position).toBe('1234');
  });

  it('parses bitrate streams', async () => {
    const b = await client().r2d2Bitrate();
    expect(b).toHaveLength(2);
    expect(b[0]?.bitrate).toBe('2500000');
  });

  it('returns icon as base64 with mime', async () => {
    const i = await client().icon('dev');
    expect(i.mime).toBe('image/png');
    expect(i.bytes).toBe(4);
  });
});
