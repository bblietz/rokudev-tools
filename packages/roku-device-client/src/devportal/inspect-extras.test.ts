import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yazl from 'yazl';
import { DevPortalInspect } from './inspect.js';
import { diffInstalled } from './diff.js';

let server: Server;
let port: number;
let mode:
  | 'genkey-ok'
  | 'rekey-ok'
  | 'pack-ok'
  | 'registry-ok'
  | 'profiler-ok'
  | 'crashlog-ok'
  | 'devzip-ok' = 'genkey-ok';

// Build a dev.zip buffer in-memory using yazl with two entries: a.txt and b.txt
function buildDevZip(entries: Array<{ name: string; content: string }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zf = new yazl.ZipFile();
    for (const { name, content } of entries) {
      zf.addBuffer(Buffer.from(content), name);
    }
    zf.end();
    const chunks: Buffer[] = [];
    zf.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zf.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zf.outputStream.on('error', reject);
  });
}

let devZipBuffer: Buffer;

beforeAll(async () => {
  devZipBuffer = await buildDevZip([
    { name: 'a.txt', content: 'A' },
    { name: 'b.txt', content: 'B' },
  ]);

  server = createServer((req, res) => {
    if (!req.headers.authorization) {
      res.statusCode = 401;
      res.setHeader('WWW-Authenticate', 'Digest realm="r", nonce="n", qop="auth"');
      res.end();
      return;
    }

    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = req.url ?? '';

      // genkey
      if (url === '/plugin_inspect' && mode === 'genkey-ok') {
        res.end(
          '<html><body>' +
            'Dev ID: <font color="green">deadbeef01234567</font><br/>' +
            'Dev Key: <font color="green">aabbccdd11223344</font>' +
            '</body></html>',
        );
        return;
      }

      // rekey
      if (url === '/plugin_inspect' && mode === 'rekey-ok') {
        res.end('<html><body>Rekey successful</body></html>');
        return;
      }

      // profiler snapshot
      if (url === '/plugin_inspect' && mode === 'profiler-ok') {
        res.end(
          '<html><body>' +
            '<h2>Memory</h2><p>Used: 10 MB</p>' +
            '<h2>FPS</h2><p>60 fps</p>' +
            '</body></html>',
        );
        return;
      }

      // packSigned — first POST to /plugin_package
      if (url === '/plugin_package' && mode === 'pack-ok') {
        res.end('<html><body><a href="pkgs/dev.pkg">Download</a></body></html>');
        return;
      }

      // packSigned — second GET for the .pkg binary
      if (url === '/pkgs/dev.pkg' && mode === 'pack-ok') {
        const pkgBytes = Buffer.from([0x52, 0x4f, 0x4b, 0x55]); // ROKU
        res.setHeader('content-type', 'application/octet-stream');
        res.end(pkgBytes);
        return;
      }

      // queryRegistry
      if (url.startsWith('/query/registry/') && mode === 'registry-ok') {
        res.setHeader('content-type', 'text/xml');
        res.end(
          '<?xml version="1.0" encoding="UTF-8"?>' +
            '<registry><section name="test"><item key="k1" value="v1"/></section></registry>',
        );
        return;
      }

      // crashlog
      if (url === '/plugin_factory_log' && mode === 'crashlog-ok') {
        res.setHeader('content-type', 'text/plain');
        res.end('Exception at line 42: NullPointerException');
        return;
      }

      // diffInstalled — dev.zip
      if (url === '/pkgs/dev.zip' && mode === 'devzip-ok') {
        res.setHeader('content-type', 'application/zip');
        res.end(devZipBuffer);
        return;
      }

      res.statusCode = 404;
      res.end();
    });
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('DevPortalInspect extras', () => {
  it('genkey returns dev_id and key', async () => {
    mode = 'genkey-ok';
    const r = await new DevPortalInspect('127.0.0.1', 'pw', port).genkey();
    expect(r.ok).toBe(true);
    expect(r.dev_id).toBe('deadbeef01234567');
    expect(r.key).toBe('aabbccdd11223344');
    expect(typeof r.duration_ms).toBe('number');
  });

  it('rekey on success returns ok', async () => {
    mode = 'rekey-ok';
    // Need a real file for rekey to read
    const tmp = await mkdtemp(join(tmpdir(), 'brs-rekey-'));
    const pkgPath = join(tmp, 'dev.pkg');
    await writeFile(pkgPath, Buffer.from([0x00, 0x01, 0x02]));
    try {
      const r = await new DevPortalInspect('127.0.0.1', 'pw', port).rekey(pkgPath, 'sekret');
      expect(r.ok).toBe(true);
      expect(r.message).toBe('rekeyed');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('packSigned returns pkg_bytes', async () => {
    mode = 'pack-ok';
    const r = await new DevPortalInspect('127.0.0.1', 'pw', port).packSigned('sekret');
    expect(r.ok).toBe(true);
    expect(r.pkg_bytes.length).toBeGreaterThan(0);
    // First four bytes should be our fake ROKU marker
    expect(r.pkg_bytes[0]).toBe(0x52);
    expect(r.pkg_bytes[1]).toBe(0x4f);
  });

  it('queryRegistry returns parsed XML', async () => {
    mode = 'registry-ok';
    const r = await new DevPortalInspect('127.0.0.1', 'pw', port).queryRegistry('myDevId');
    expect(r.ok).toBe(true);
    expect(r.registry).toBeDefined();
    // fast-xml-parser returns an object with the root element key
    expect(typeof r.registry).toBe('object');
    expect((r.registry as Record<string, unknown>)['registry']).toBeDefined();
  });

  it('profilerSnapshot returns sections', async () => {
    mode = 'profiler-ok';
    const r = await new DevPortalInspect('127.0.0.1', 'pw', port).profilerSnapshot();
    expect(r.ok).toBe(true);
    expect(r.sections).toHaveProperty('Memory');
    expect(r.sections).toHaveProperty('FPS');
    expect(r.truncated).toBe(false);
  });

  it('crashlogPull returns log_text', async () => {
    mode = 'crashlog-ok';
    const r = await new DevPortalInspect('127.0.0.1', 'pw', port).crashlogPull();
    expect(r.ok).toBe(true);
    expect(r.log_text).toContain('Exception at line 42');
    expect(r.truncated).toBe(false);
  });

  it('diffInstalled returns added/removed/changed/same', async () => {
    mode = 'devzip-ok';
    // Device has: a.txt (content 'A') and b.txt (content 'B')
    // Local dir has: a.txt (same 'A') and c.txt (new 'C')
    // Expected: same=['a.txt'], removed=['b.txt'], added=['c.txt'], changed=[]
    const tmp = await mkdtemp(join(tmpdir(), 'brs-diff-'));
    try {
      await writeFile(join(tmp, 'a.txt'), 'A');
      await writeFile(join(tmp, 'c.txt'), 'C');
      const r = await diffInstalled('127.0.0.1', 'pw', tmp, port);
      expect(r.ok).toBe(true);
      expect(r.same).toEqual(['a.txt']);
      expect(r.removed).toEqual(['b.txt']);
      expect(r.added).toEqual(['c.txt']);
      expect(r.changed).toEqual([]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
