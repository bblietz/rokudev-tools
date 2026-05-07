import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DevPortalInspect } from './inspect.js';

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (!req.headers.authorization) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Digest realm="r", nonce="n", qop="auth"');
      res.end();
      return;
    }
    if (req.url === '/plugin_inspect') {
      let buf = '';
      req.on('data', (c) => (buf += c));
      req.on('end', () => {
        res.end(`<html><img src="/pkgs/dev.jpg"/></html>`);
      });
      return;
    }
    if (req.url === '/pkgs/dev.jpg') {
      res.setHeader('content-type', 'image/jpeg');
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // jpeg header
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('DevPortalInspect.screenshot', () => {
  it('roundtrips inspect + asset GET', async () => {
    const r = await new DevPortalInspect('127.0.0.1', 'pw', port).screenshot();
    expect(r.mime).toBe('image/jpeg');
    expect(r.bytes).toBe(4);
  });
});
