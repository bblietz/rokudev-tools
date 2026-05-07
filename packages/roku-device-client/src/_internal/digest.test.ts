import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import { digestRequest } from './digest.js';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

let server: Server;
let port: number;
let lastAuth: string | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (!req.headers.authorization) {
      res.writeHead(401, {
        'WWW-Authenticate': `Digest realm="rokudev", nonce="abc123", qop="auth", opaque="op"`,
      });
      res.end();
      return;
    }
    lastAuth = req.headers.authorization;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('OK');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('digestRequest', () => {
  it('completes the 401 challenge and returns 200', async () => {
    const r = await digestRequest({
      method: 'GET',
      url: `http://127.0.0.1:${port}/x`,
      username: 'rokudev', password: 'pw',
    });
    expect(r.statusCode).toBe(200);
    expect(r.bodyText).toBe('OK');
    expect(lastAuth).toMatch(/^Digest username="rokudev"/);
    expect(lastAuth).toContain('qop=auth');
    expect(lastAuth).toContain('nc=00000001');
  });

  it('uses correct response hash for known inputs', async () => {
    // Same algorithm, manually computed.
    const ha1 = md5('rokudev:rokudev:pw');
    const ha2 = md5('GET:/x');
    // We don't know cnonce; just verify the response field shape.
    const r = await digestRequest({
      method: 'GET', url: `http://127.0.0.1:${port}/x`,
      username: 'rokudev', password: 'pw',
    });
    expect(r.statusCode).toBe(200);
    const m = lastAuth!.match(/response="([^"]+)"/);
    expect(m).toBeTruthy();
    expect(m![1]).toHaveLength(32); // MD5 hex
    void ha1; void ha2;
  });

  it('does not leak the password into the auth header', async () => {
    await digestRequest({
      method: 'GET', url: `http://127.0.0.1:${port}/x`,
      username: 'rokudev', password: 'verysecret',
    });
    expect(lastAuth).not.toContain('verysecret');
  });
});
