import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DevPortal } from './sideload.js';

let server: Server;
let port: number;
let mode:
  | 'success'
  | 'identical'
  | 'authfail'
  | 'notdev'
  | 'compile-failed'
  | 'install-failed-alone' = 'success';
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
        case 'compile-failed':
          // Real-device shape: Roku Ultra firmware 15.x sends BOTH the
          // "Application Received" success marker AND an "Install Failed"
          // failure marker in the same response body when a compile error
          // occurs (e.g. #Const error in source). The silent-success bug:
          // the parser used to match "Application Received" first and
          // return ok:true despite the failure.
          res.end(
            '<font color="red">Application Received: stored.</font>' +
              '<font color="red">Install Failed. #Const error pkg:/source/Feed.brs</font>',
          );
          return;
        case 'install-failed-alone':
          res.end('<font color="red">Install Failed. Generic failure reason</font>');
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

  it('throws SIDELOAD_REJECTED when Install Failed coexists with Application Received', async () => {
    // Regression: Plan 4 T27 hit a compile error where the device returned
    // BOTH "Application Received: stored." (success marker) AND "Install
    // Failed. #Const error ..." (real failure). The parser used to key on
    // the success marker and return ok:true. Any failure marker must win.
    mode = 'compile-failed';
    await expect(new DevPortal('127.0.0.1', 'pw', port).sideload(zipPath)).rejects.toMatchObject({
      code: 'SIDELOAD_REJECTED',
      details: { excerpt: expect.stringContaining('Install Failed') },
    });
  });

  it('throws SIDELOAD_REJECTED when Install Failed appears alone', async () => {
    mode = 'install-failed-alone';
    await expect(new DevPortal('127.0.0.1', 'pw', port).sideload(zipPath)).rejects.toMatchObject({
      code: 'SIDELOAD_REJECTED',
      details: { excerpt: expect.stringContaining('Install Failed') },
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

  it('omits remotedebug formdata by default', async () => {
    // Default sideload (no debug option) must NOT include the BDP-enable
    // flags, because they alter device behavior (open port 8081 at install
    // time, single-shot consumed by any TCP connect).
    mode = 'success';
    await new DevPortal('127.0.0.1', 'pw', port).sideload(zipPath);
    const body = lastBody!.toString('utf8');
    expect(body).not.toContain('name="remotedebug"');
    expect(body).not.toContain('name="remotedebug_connect_early"');
  });

  it('attaches remotedebug + remotedebug_connect_early when debug=true', async () => {
    // BDP listener gate on fw 15.2.4 build 3442: without these flags, port
    // 8081 only opens for a ~250ms post-launch window that BdpSession.attach
    // loses the race against. Verified via curl-based test against Ultra +
    // TCL TV 2026-05-20. See docs/refs/bdp-wire-format.md §6 Run 3.
    mode = 'success';
    await new DevPortal('127.0.0.1', 'pw', port).sideload(zipPath, { debug: true });
    const body = lastBody!.toString('utf8');
    expect(body).toContain('name="remotedebug"');
    expect(body).toContain('name="remotedebug_connect_early"');
    // Sanity: each appears EXACTLY once, value=1. Anchored regex to avoid
    // matching the longer `remotedebug_connect_early` field as if it were
    // a `remotedebug=1` occurrence.
    const remotedebugCount = (body.match(/name="remotedebug"/g) ?? []).length;
    const earlyCount = (body.match(/name="remotedebug_connect_early"/g) ?? []).length;
    expect(remotedebugCount).toBe(1);
    expect(earlyCount).toBe(1);
  });
});
