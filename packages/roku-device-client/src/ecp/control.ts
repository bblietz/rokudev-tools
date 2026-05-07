import { request } from 'undici';
import { fail } from '../errors/index.js';
import { isAllowedKey } from './keys.js';
import { isAllowedInputParamKey, isAllowedLaunchParamKey } from './params.js';

export type Mode = 'press' | 'down' | 'up';

async function post(url: string): Promise<number> {
  const r = await request(url, { method: 'POST' });
  await r.body.dump();
  return r.statusCode;
}

export class EcpControl {
  constructor(
    private host: string,
    private port = 8060,
  ) {}

  async keypress(key: string, mode: Mode = 'press'): Promise<void> {
    if (!isAllowedKey(key)) throw fail('ECP_KEY_DISALLOWED', `key not allowed: ${key}`, { key });
    const verb = mode === 'press' ? 'keypress' : mode === 'down' ? 'keydown' : 'keyup';
    const sc = await post(`http://${this.host}:${this.port}/${verb}/${encodeURIComponent(key)}`);
    if (sc < 200 || sc > 299) throw fail('DEVICE_UNREACHABLE', `ECP ${verb} returned ${sc}`);
  }

  async keysequence(keys: string[], delayMs = 150): Promise<void> {
    for (const k of keys) {
      await this.keypress(k);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  async launch(appId: string, params?: Record<string, string>): Promise<void> {
    const qs = this.encodeParams(params, isAllowedLaunchParamKey);
    const sc = await post(
      `http://${this.host}:${this.port}/launch/${encodeURIComponent(appId)}${qs}`,
    );
    if (sc < 200 || sc > 299) throw fail('DEVICE_UNREACHABLE', `ECP launch returned ${sc}`);
  }

  async input(params: Record<string, string>): Promise<void> {
    const qs = this.encodeParams(params, isAllowedInputParamKey);
    const sc = await post(`http://${this.host}:${this.port}/input${qs}`);
    if (sc < 200 || sc > 299) throw fail('DEVICE_UNREACHABLE', `ECP input returned ${sc}`);
  }

  async toHome(): Promise<void> {
    await this.keypress('Home');
    await new Promise((r) => setTimeout(r, 100));
    await this.keypress('Home');
  }

  private encodeParams(
    p: Record<string, string> | undefined,
    allow: (k: string) => boolean,
  ): string {
    if (!p || Object.keys(p).length === 0) return '';
    const parts: string[] = [];
    for (const [k, v] of Object.entries(p)) {
      if (!allow(k)) throw fail('ECP_PARAM_DISALLOWED', `param key not allowed: ${k}`, { key: k });
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    return `?${parts.join('&')}`;
  }
}
