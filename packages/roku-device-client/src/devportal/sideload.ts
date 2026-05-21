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

export type SideloadOptions = {
  /**
   * When true, attach BOTH `remotedebug=1` AND `remotedebug_connect_early=1`
   * formdata fields to the install POST. These flags tell the device to open
   * the BrightScript Debug Protocol (BDP) listener on TCP 8081 at install time
   * (not just briefly post-launch) and keep it available until the first
   * client connects. Required on firmware 15.2.4 build 3442 (and likely
   * newer) for `BdpSession.attach()` to reliably win the listener race.
   * See `docs/refs/bdp-wire-format.md §6 Run 3` for the verification log.
   */
  debug?: boolean;
};

export class DevPortal {
  constructor(
    private host: string,
    private password: string,
    private port = 80,
  ) {}

  async sideload(zipPath: string, options: SideloadOptions = {}): Promise<SideloadResult> {
    const start = Date.now();
    let zipBytes: Buffer;
    try {
      zipBytes = await readFile(zipPath);
    } catch {
      throw fail('ZIP_NOT_FOUND', `zip not found: ${zipPath}`);
    }
    const boundary = buildBoundary();
    const parts = [
      { kind: 'field' as const, name: 'mysubmit', value: 'Install' },
      {
        kind: 'file' as const,
        name: 'archive',
        filename: basename(zipPath),
        contentType: 'application/zip',
        body: zipBytes,
      },
    ];
    if (options.debug) {
      // Upstream reference: rokucommunity/roku-deploy RokuDeploy.ts:485-493.
      // Both flags must be sent together on current firmware -- only
      // `remotedebug_connect_early=1` opens the early listener, but Roku's
      // own tooling sends both, so we match that contract.
      parts.push({ kind: 'field' as const, name: 'remotedebug', value: '1' });
      parts.push({
        kind: 'field' as const,
        name: 'remotedebug_connect_early',
        value: '1',
      });
    }
    const body = buildMultipart(parts, boundary);
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
    // Failure markers MUST be checked before success markers. Roku Ultra
    // firmware 15.x returns both "Application Received: stored." AND
    // "Install Failed. <reason>" in the same response body when a compile
    // error occurs during install (e.g. #Const error, missing component,
    // malformed manifest). Keying on the success marker first silently
    // declared success on real failures.
    if (text.includes('Failed: Not in developer mode')) {
      throw fail('DEVICE_NOT_DEV_MODE', 'device is not in developer mode');
    }
    if (text.includes('Install Failed')) {
      throw fail('SIDELOAD_REJECTED', 'device rejected sideload', {
        excerpt: text.slice(0, 400),
      });
    }
    if (text.includes('Identical to previous version')) {
      return { ok: true, status: 'identical', message: 'identical', duration_ms };
    }
    if (text.includes('Install Success.') || text.includes('Application Received')) {
      return { ok: true, status: 'installed', message: 'installed', duration_ms };
    }
    throw fail('SIDELOAD_REJECTED', `device rejected sideload`, {
      excerpt: text.slice(0, 400),
    });
  }

  async unload(): Promise<{ ok: true; message: string; duration_ms: number }> {
    const start = Date.now();
    const boundary = buildBoundary();
    const body = buildMultipart(
      [
        { kind: 'field', name: 'mysubmit', value: 'Delete' },
        { kind: 'field', name: 'archive', value: '' },
      ],
      boundary,
    );
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
    return { ok: true, message: 'deleted', duration_ms };
  }
}
