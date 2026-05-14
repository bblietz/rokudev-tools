import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DevPortalInspect } from './inspect.js';

// Two known firmware shapes for the screenshot asset src= attribute:
//   'leading-slash' : <img src="/pkgs/dev.jpg"/>     (Roku Ultra firmware 15.x and older)
//   'no-slash'      : <img src="pkgs/dev_screenshot.png"/>  (Roku TV Native Build 2910X firmware 15.2.4)
// Plus the regex tolerates filename suffixes ([A-Za-z0-9_]*) and both jpg/png.
let server: Server;
let port: number;
let mode: 'leading-slash' | 'no-slash' = 'leading-slash';

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
        if (mode === 'leading-slash') {
          res.end(`<html><img src="/pkgs/dev.jpg"/></html>`);
        } else {
          // Native Build emits the path with no leading slash AND a different
          // filename suffix. The regex must accept both shapes.
          res.end(`<html><img src="pkgs/dev_screenshot.png"/></html>`);
        }
      });
      return;
    }
    if (req.url === '/pkgs/dev.jpg') {
      res.setHeader('content-type', 'image/jpeg');
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // jpeg header
      return;
    }
    if (req.url === '/pkgs/dev_screenshot.png') {
      res.setHeader('content-type', 'image/png');
      res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
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
  it('roundtrips inspect + asset GET (leading-slash form, Roku Ultra firmware 15.x)', async () => {
    mode = 'leading-slash';
    const r = await new DevPortalInspect('127.0.0.1', 'pw', port).screenshot();
    expect(r.mime).toBe('image/jpeg');
    expect(r.bytes).toBe(4);
  });

  it('roundtrips inspect + asset GET (no-slash form, Roku TV Native Build 2910X firmware 15.2.4)', async () => {
    mode = 'no-slash';
    const r = await new DevPortalInspect('127.0.0.1', 'pw', port).screenshot();
    expect(r.mime).toBe('image/png');
    expect(r.bytes).toBe(4);
  });
});
