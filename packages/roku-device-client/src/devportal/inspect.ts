import { digestRequest } from '../_internal/digest.js';
import { buildBoundary, buildMultipart } from './multipart.js';
import { fail } from '../errors/index.js';

export class DevPortalInspect {
  constructor(private host: string, private password: string, private port = 80) {}

  async screenshot(format: 'jpg' | 'png' = 'jpg'): Promise<{ mime: string; bytes: number; base64: string; duration_ms: number }> {
    const start = Date.now();
    const boundary = buildBoundary();
    const body = buildMultipart(
      [{ kind: 'field', name: 'mysubmit', value: 'Screenshot' },
       { kind: 'field', name: 'passwd', value: '' },
       { kind: 'field', name: 'archive', value: '' }],
      boundary,
    );
    const r1 = await digestRequest({
      method: 'POST',
      url: `http://${this.host}:${this.port}/plugin_inspect`,
      username: 'rokudev', password: this.password,
      body, headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
    });
    if (r1.statusCode === 401) throw fail('DEVICE_AUTH_FAILED', 'dev portal rejected credentials');
    // Asset path is referenced in HTML as src="pkgs/dev.<ext>" or "pkgs/dev_screenshot.<ext>"
    const m = r1.bodyText.match(/(\/pkgs\/dev[A-Za-z0-9_]*\.(?:jpg|png))/);
    if (!m) throw fail('SCREENSHOT_FAILED', 'no asset path in plugin_inspect response',
      { excerpt: r1.bodyText.slice(0, 400) });
    const path = m[1]!;
    const r2 = await digestRequest({
      method: 'GET',
      url: `http://${this.host}:${this.port}${path}`,
      username: 'rokudev', password: this.password,
    });
    if (r2.statusCode !== 200) throw fail('SCREENSHOT_FAILED', `asset GET returned ${r2.statusCode}`);
    const mime = path.endsWith('.png') ? 'image/png' : 'image/jpeg';
    void format;
    return { mime, bytes: r2.bodyBytes.length, base64: r2.bodyBytes.toString('base64'),
             duration_ms: Date.now() - start };
  }
}
