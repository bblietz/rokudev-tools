import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevPortal } from './sideload.js';

let server: Server;
let port: number;
let mode: 'success' | 'identical' | 'authfail' | 'notdev' = 'success';
let lastBody: Buffer | undefined;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (mode === 'authfail') {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Digest realm="r",nonce="n"');
      res.end();
      return;
    }
    if (!req.headers.authorization) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Digest realm="rokudev", nonce="abc", qop="auth"');
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      lastBody = Buffer.concat(chunks);
      res.statusCode = 200;
      switch (mode) {
        case 'success':
          res.end('<font color="red">Install Success.</font>');
          return;
        case 'identical':
          res.end(
            '<font color="red">Identical to previous version, application not installed</font>',
          );
          return;
        case 'notdev':
          res.end('Failed: Not in developer mode');
          return;
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('DevPortal sideload/unload', () => {
  let tmp: string, zipPath: string;
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'rokudev-test-'));
    zipPath = join(tmp, 'channel.zip');
    await writeFile(zipPath, Buffer.from('PK\u0003\u0004fake-zip')); // PK header so the body looks plausible
  });
  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns installed on Install Success', async () => {
    mode = 'success';
    const r = await new DevPortal('127.0.0.1', 'pw', port).sideload(zipPath);
    expect(r.status).toBe('installed');
  });

  it('returns identical on identical version response', async () => {
    mode = 'identical';
    const r = await new DevPortal('127.0.0.1', 'pw', port).sideload(zipPath);
    expect(r.status).toBe('identical');
  });

  it('throws DEVICE_NOT_DEV_MODE when device says so', async () => {
    mode = 'notdev';
    await expect(new DevPortal('127.0.0.1', 'pw', port).sideload(zipPath)).rejects.toMatchObject({
      code: 'DEVICE_NOT_DEV_MODE',
    });
  });

  it('throws ZIP_NOT_FOUND for missing path', async () => {
    mode = 'success';
    await expect(
      new DevPortal('127.0.0.1', 'pw', port).sideload('/no/such/file'),
    ).rejects.toMatchObject({ code: 'ZIP_NOT_FOUND' });
  });

  it('unload sends mysubmit=Delete', async () => {
    mode = 'success';
    await new DevPortal('127.0.0.1', 'pw', port).unload();
    expect(lastBody!.toString('utf8')).toContain('name="mysubmit"');
    expect(lastBody!.toString('utf8')).toContain('Delete');
  });

  it('does not echo the password into the multipart body', async () => {
    mode = 'success';
    await new DevPortal('127.0.0.1', 'verysecret', port).sideload(zipPath);
    expect(lastBody!.toString('utf8')).not.toContain('verysecret');
  });

  it('handles a 10 MB body across the Digest re-issue', async () => {
    mode = 'success';
    const big = join(tmp, 'big.zip');
    await writeFile(big, Buffer.alloc(10 * 1024 * 1024, 'x'));
    const r = await new DevPortal('127.0.0.1', 'pw', port).sideload(big);
    expect(r.status).toBe('installed');
  });
});
