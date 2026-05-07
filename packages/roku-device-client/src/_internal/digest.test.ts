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
    const r = await digestRequest({
      method: 'GET', url: `http://127.0.0.1:${port}/x`,
      username: 'rokudev', password: 'pw',
    });
    expect(r.statusCode).toBe(200);
    // Extract the actual cnonce from the captured Authorization header so we can
    // compute the expected response value.
    const cnonceMatch = lastAuth!.match(/cnonce="([^"]+)"/);
    expect(cnonceMatch).toBeTruthy();
    const cnonce = cnonceMatch![1]!;
    const ha1 = md5('rokudev:rokudev:pw');
    const ha2 = md5('GET:/x');
    const expectedResponse = md5(`${ha1}:abc123:00000001:${cnonce}:auth:${ha2}`);
    const responseMatch = lastAuth!.match(/response="([^"]+)"/);
    expect(responseMatch).toBeTruthy();
    expect(responseMatch![1]).toBe(expectedResponse);
  });

  it('does not leak the password into the auth header', async () => {
    await digestRequest({
      method: 'GET', url: `http://127.0.0.1:${port}/x`,
      username: 'rokudev', password: 'verysecret',
    });
    expect(lastAuth).not.toContain('verysecret');
  });

  it('forwards body identically on the authenticated second request', async () => {
    const body = Buffer.from('the body bytes');
    // Mock server captures the second-roundtrip body.
    let capturedBody: Buffer | undefined;
    const handler = (req: any, res: any) => {
      if (!req.headers.authorization) {
        res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="rokudev", nonce="b", qop="auth", opaque="op"' });
        res.end();
        return;
      }
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        capturedBody = Buffer.concat(chunks);
        res.writeHead(200);
        res.end('OK');
      });
    };
    // Stand up a temporary second server for this test (avoids cross-test state leak).
    const tmpServer = createServer(handler);
    await new Promise<void>((r) => tmpServer.listen(0, '127.0.0.1', r));
    const tmpPort = (tmpServer.address() as AddressInfo).port;
    try {
      const r = await digestRequest({
        method: 'POST',
        url: `http://127.0.0.1:${tmpPort}/x`,
        username: 'rokudev', password: 'pw',
        body,
        headers: { 'content-type': 'application/octet-stream' },
      });
      expect(r.statusCode).toBe(200);
      expect(capturedBody).toBeDefined();
      expect(Buffer.compare(capturedBody!, body)).toBe(0);
    } finally {
      await new Promise<void>((r) => tmpServer.close(() => r()));
    }
  });
});
