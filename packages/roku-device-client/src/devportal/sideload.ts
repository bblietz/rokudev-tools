// Note: the Digest re-issue pattern means the entire request body is buffered
// in memory and sent twice. For zips > ~100 MB this becomes a memory concern;
// streaming Digest is a v1.x consideration.

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { digestRequest } from '../_internal/digest.js';
import { buildBoundary, buildMultipart } from './multipart.js';
import { fail } from '../errors/index.js';

export type SideloadResult = {
  ok: true;
  status: 'installed' | 'identical';
  message: string;
  duration_ms: number;
};

export class DevPortal {
  constructor(private host: string, private password: string, private port = 80) {}

  async sideload(zipPath: string): Promise<SideloadResult> {
    const start = Date.now();
    let zipBytes: Buffer;
    try { zipBytes = await readFile(zipPath); }
    catch { throw fail('ZIP_NOT_FOUND', `zip not found: ${zipPath}`); }
    const boundary = buildBoundary();
    const body = buildMultipart([
      { kind: 'field', name: 'mysubmit', value: 'Install' },
      { kind: 'file', name: 'archive', filename: basename(zipPath),
        contentType: 'application/zip', body: zipBytes },
    ], boundary);
    const r = await digestRequest({
      method: 'POST',
      url: `http://${this.host}:${this.port}/plugin_install`,
      username: 'rokudev',
      password: this.password,
      body,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
    });
    const duration_ms = Date.now() - start;
    if (r.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    const text = r.bodyText;
    if (text.includes('Identical to previous version')) {
      return { ok: true, status: 'identical', message: 'identical', duration_ms };
    }
    if (text.includes('Install Success.') || text.includes('Application Received')) {
      return { ok: true, status: 'installed', message: 'installed', duration_ms };
    }
    if (text.includes('Failed: Not in developer mode')) {
      throw fail('DEVICE_NOT_DEV_MODE', 'device is not in developer mode');
    }
    throw fail('SIDELOAD_REJECTED', `device rejected sideload`, {
      excerpt: text.slice(0, 400),
    });
  }

  async unload(): Promise<{ ok: true; message: string; duration_ms: number }> {
    const start = Date.now();
    const boundary = buildBoundary();
    const body = buildMultipart(
      [{ kind: 'field', name: 'mysubmit', value: 'Delete' },
       { kind: 'field', name: 'archive', value: '' }],
      boundary,
    );
    const r = await digestRequest({
      method: 'POST',
      url: `http://${this.host}:${this.port}/plugin_install`,
      username: 'rokudev', password: this.password,
      body, headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
    });
    const duration_ms = Date.now() - start;
    if (r.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    return { ok: true, message: 'deleted', duration_ms };
  }
}
