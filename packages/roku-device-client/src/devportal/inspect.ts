import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { digestRequest } from '../_internal/digest.js';
import { buildBoundary, buildMultipart } from './multipart.js';
import { fail } from '../errors/index.js';
import { parseXml } from '../ecp/parse-xml.js';

export class DevPortalInspect {
  constructor(
    private host: string,
    private password: string,
    private port = 80,
  ) {}

  async screenshot(): Promise<{
    mime: string;
    bytes: number;
    base64: string;
    duration_ms: number;
  }> {
    const start = Date.now();
    const boundary = buildBoundary();
    const body = buildMultipart(
      [
        { kind: 'field', name: 'mysubmit', value: 'Screenshot' },
        { kind: 'field', name: 'passwd', value: '' },
        { kind: 'field', name: 'archive', value: '' },
      ],
      boundary,
    );
    const r1 = await digestRequest({
      method: 'POST',
      url: `http://${this.host}:${this.port}/plugin_inspect`,
      username: 'rokudev',
      password: this.password,
      body,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
    });
    if (r1.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    // Asset path is referenced in HTML as src="pkgs/dev.<ext>" (no leading
    // slash on Ultra firmware 15.x) or src="/pkgs/dev_screenshot.<ext>" on
    // older firmware. Optional query suffix like ?time=... is stripped.
    const m = r1.bodyText.match(/\b(\/?pkgs\/dev[A-Za-z0-9_]*\.(?:jpg|png))/);
    if (!m)
      throw fail('SCREENSHOT_FAILED', 'no asset path in plugin_inspect response', {
        excerpt: r1.bodyText.slice(0, 400),
      });
    const matched = m[1]!;
    const path = matched.startsWith('/') ? matched : `/${matched}`;
    const r2 = await digestRequest({
      method: 'GET',
      url: `http://${this.host}:${this.port}${path}`,
      username: 'rokudev',
      password: this.password,
    });
    if (r2.statusCode !== 200)
      throw fail('SCREENSHOT_FAILED', `asset GET returned ${r2.statusCode}`);
    const mime = path.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return {
      mime,
      bytes: r2.bodyBytes.length,
      base64: r2.bodyBytes.toString('base64'),
      duration_ms: Date.now() - start,
    };
  }

  async genkey(): Promise<{
    ok: true;
    dev_id: string;
    key: string;
    raw_html: string;
    duration_ms: number;
  }> {
    const start = Date.now();
    const boundary = buildBoundary();
    const body = buildMultipart(
      [
        { kind: 'field', name: 'mysubmit', value: 'Genkey' },
        { kind: 'field', name: 'passwd', value: '' },
        { kind: 'field', name: 'archive', value: '' },
      ],
      boundary,
    );
    const r = await digestRequest({
      method: 'POST',
      url: `http://${this.host}:${this.port}/plugin_inspect`,
      username: 'rokudev',
      password: this.password,
      body,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
    });
    if (r.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    const text = r.bodyText;
    // Match like "Dev ID: <ID>" and "Dev Key: <KEY>" with optional HTML wrapping.
    const idMatch =
      text.match(/Dev\s*ID[^:]*:\s*<[^>]*>\s*([0-9a-f]+)/i) ??
      text.match(/Dev\s*ID[^:]*:\s*([0-9a-f]+)/i);
    const keyMatch =
      text.match(/Dev\s*Key[^:]*:\s*<[^>]*>\s*([0-9a-f]+)/i) ??
      text.match(/Dev\s*Key[^:]*:\s*([0-9a-f]+)/i);
    if (!idMatch || !keyMatch) {
      throw fail('GENKEY_FAILED', 'could not parse Dev ID / Dev Key from response', {
        excerpt: text.slice(0, 400),
      });
    }
    return {
      ok: true,
      dev_id: idMatch[1]!,
      key: keyMatch[1]!,
      raw_html: text,
      duration_ms: Date.now() - start,
    };
  }

  async rekey(
    signedPkgPath: string,
    signingPassword: string,
  ): Promise<{ ok: true; message: string; duration_ms: number }> {
    const start = Date.now();
    let pkgBytes: Buffer;
    try {
      pkgBytes = await readFile(signedPkgPath);
    } catch {
      throw fail('REKEY_FAILED', `signed package not found: ${signedPkgPath}`);
    }
    const boundary = buildBoundary();
    const body = buildMultipart(
      [
        { kind: 'field', name: 'mysubmit', value: 'Rekey' },
        { kind: 'field', name: 'passwd', value: signingPassword },
        {
          kind: 'file',
          name: 'archive',
          filename: basename(signedPkgPath),
          contentType: 'application/octet-stream',
          body: pkgBytes,
        },
      ],
      boundary,
    );
    const r = await digestRequest({
      method: 'POST',
      url: `http://${this.host}:${this.port}/plugin_inspect`,
      username: 'rokudev',
      password: this.password,
      body,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
    });
    if (r.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    if (/Password mismatch/i.test(r.bodyText)) {
      throw fail('SIGNING_PASSWORD_REJECTED', 'rekey: signing password rejected');
    }
    return { ok: true, message: 'rekeyed', duration_ms: Date.now() - start };
  }

  async packSigned(
    signingPassword: string,
  ): Promise<{ ok: true; pkg_bytes: Buffer; duration_ms: number }> {
    const start = Date.now();
    const boundary = buildBoundary();
    const body = buildMultipart(
      [
        { kind: 'field', name: 'mysubmit', value: 'Package' },
        { kind: 'field', name: 'passwd', value: signingPassword },
        { kind: 'field', name: 'archive', value: '' },
        { kind: 'field', name: 'app_name', value: '' },
      ],
      boundary,
    );
    const r1 = await digestRequest({
      method: 'POST',
      url: `http://${this.host}:${this.port}/plugin_package`,
      username: 'rokudev',
      password: this.password,
      body,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
    });
    if (r1.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    if (/Password mismatch/i.test(r1.bodyText)) {
      throw fail('SIGNING_PASSWORD_REJECTED', 'pack: signing password rejected');
    }
    const m = r1.bodyText.match(/href="([^"]*\.pkg)"/i);
    if (!m)
      throw fail('PACKAGE_FAILED', 'no .pkg link in response', {
        excerpt: r1.bodyText.slice(0, 400),
      });
    const pkgPath = m[1]!.startsWith('/') ? m[1]! : `/${m[1]!}`;
    const r2 = await digestRequest({
      method: 'GET',
      url: `http://${this.host}:${this.port}${pkgPath}`,
      username: 'rokudev',
      password: this.password,
    });
    if (r2.statusCode !== 200) throw fail('PACKAGE_FAILED', `pkg GET returned ${r2.statusCode}`);
    return { ok: true, pkg_bytes: r2.bodyBytes, duration_ms: Date.now() - start };
  }

  async queryRegistry(
    devId: string,
  ): Promise<{ ok: true; registry: unknown; duration_ms: number }> {
    const start = Date.now();
    const r = await digestRequest({
      method: 'GET',
      url: `http://${this.host}:${this.port}/query/registry/${encodeURIComponent(devId)}`,
      username: 'rokudev',
      password: this.password,
    });
    if (r.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    if (r.statusCode !== 200)
      throw fail('DEVICE_UNREACHABLE', `registry query returned ${r.statusCode}`);
    return { ok: true, registry: parseXml(r.bodyText), duration_ms: Date.now() - start };
  }

  async profilerSnapshot(): Promise<{
    ok: true;
    sections: Record<string, string>;
    raw_html_excerpt: string;
    truncated: boolean;
    duration_ms: number;
  }> {
    const start = Date.now();
    const boundary = buildBoundary();
    const body = buildMultipart(
      [
        { kind: 'field', name: 'mysubmit', value: 'Inspect' },
        { kind: 'field', name: 'passwd', value: '' },
        { kind: 'field', name: 'archive', value: '' },
      ],
      boundary,
    );
    const r = await digestRequest({
      method: 'POST',
      url: `http://${this.host}:${this.port}/plugin_inspect`,
      username: 'rokudev',
      password: this.password,
      body,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
    });
    if (r.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    // Extract section name -> content via header tags. Real Roku response format uses
    // <h2> or capitalized labels; this is best-effort.
    const sections: Record<string, string> = {};
    const sectionRe = /<h[12345]>([^<]+)<\/h[12345]>([\s\S]*?)(?=<h[12345]>|$)/gi;
    let sm: RegExpExecArray | null;
    while ((sm = sectionRe.exec(r.bodyText))) {
      sections[sm[1]!.trim()] = sm[2]!.replace(/<[^>]*>/g, '').trim();
    }
    const MAX = 256 * 1024;
    const truncated = r.bodyText.length > MAX;
    const raw_html_excerpt = truncated ? r.bodyText.slice(0, MAX) : r.bodyText;
    return { ok: true, sections, raw_html_excerpt, truncated, duration_ms: Date.now() - start };
  }

  async crashlogPull(): Promise<{
    ok: true;
    log_text: string;
    truncated: boolean;
    duration_ms: number;
  }> {
    const start = Date.now();
    const r = await digestRequest({
      method: 'GET',
      url: `http://${this.host}:${this.port}/plugin_factory_log`,
      username: 'rokudev',
      password: this.password,
    });
    if (r.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    if (r.statusCode === 404) throw fail('DEV_PKG_UNAVAILABLE', 'no factory log available');
    if (r.statusCode !== 200)
      throw fail('DEVICE_UNREACHABLE', `factory log returned ${r.statusCode}`);
    const MAX = 1024 * 1024;
    const truncated = r.bodyBytes.length > MAX;
    const log_text = truncated ? r.bodyBytes.subarray(0, MAX).toString('utf8') : r.bodyText;
    return { ok: true, log_text, truncated, duration_ms: Date.now() - start };
  }
}
