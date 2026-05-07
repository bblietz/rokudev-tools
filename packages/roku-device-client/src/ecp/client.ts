import { request } from 'undici';
import { parseXml } from './parse-xml.js';
import { fail } from '../errors/index.js';

const TIMEOUT_MS = 5_000;

async function get(
  host: string,
  port: number,
  path: string,
): Promise<{ statusCode: number; body: Buffer; headers: Record<string, string | string[]> }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await request(`http://${host}:${port}${path}`, { method: 'GET', signal: ctrl.signal });
    const chunks: Buffer[] = [];
    for await (const c of r.body) chunks.push(Buffer.from(c));
    return { statusCode: r.statusCode, body: Buffer.concat(chunks), headers: r.headers as Record<string, string | string[]> };
  } catch (e: unknown) {
    if ((e as Error).name === 'AbortError') {
      throw fail('DEVICE_UNREACHABLE', `ECP request to ${host}:${port}${path} timed out`);
    }
    throw fail('DEVICE_UNREACHABLE', `ECP request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(t);
  }
}

export class EcpClient {
  constructor(private host: string, private port: number = 8060) {}

  async deviceInfo(): Promise<Record<string, string>> {
    const r = await get(this.host, this.port, '/query/device-info');
    if (r.statusCode !== 200) throw fail('DEVICE_UNREACHABLE', `ECP returned ${r.statusCode}`);
    const parsed = parseXml(r.body.toString('utf8')) as { 'device-info'?: Record<string, string | number | boolean> };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed['device-info'] ?? {})) out[k] = String(v);
    return out;
  }

  async apps(): Promise<Array<{ id: string; name: string; version: string; type: string }>> {
    const r = await get(this.host, this.port, '/query/apps');
    if (r.statusCode !== 200) throw fail('DEVICE_UNREACHABLE', `ECP returned ${r.statusCode}`);
    const parsed = parseXml(r.body.toString('utf8')) as { apps?: { app?: any[] | any } };
    const list = parsed.apps?.app ?? [];
    const arr = Array.isArray(list) ? list : [list];
    return arr.map((a) => ({
      id: String(a['@_id']),
      name: typeof a === 'string' ? a : String(a['#text'] ?? ''),
      version: String(a['@_version'] ?? ''),
      type: String(a['@_type'] ?? ''),
    }));
  }

  async activeApp(): Promise<{ id?: string; name?: string }> {
    const r = await get(this.host, this.port, '/query/active-app');
    if (r.statusCode !== 200) throw fail('DEVICE_UNREACHABLE', `ECP returned ${r.statusCode}`);
    const parsed = parseXml(r.body.toString('utf8')) as { 'active-app'?: { app?: any } };
    const a = parsed['active-app']?.app;
    if (!a) return {};
    const id = a['@_id'];
    return { ...(id ? { id: String(id) } : {}), name: typeof a === 'string' ? a : String(a['#text'] ?? '') };
  }

  async mediaPlayer(): Promise<Record<string, string>> {
    const r = await get(this.host, this.port, '/query/media-player');
    if (r.statusCode !== 200) throw fail('DEVICE_UNREACHABLE', `ECP returned ${r.statusCode}`);
    const parsed = parseXml(r.body.toString('utf8')) as { player?: Record<string, unknown> };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.player ?? {})) {
      out[k.replace(/^@_/, '')] = String(typeof v === 'object' && v && '#text' in v ? (v as any)['#text'] : v);
    }
    return out;
  }

  async r2d2Bitrate(): Promise<Array<Record<string, string>>> {
    const r = await get(this.host, this.port, '/query/r2d2_bitrate');
    if (r.statusCode !== 200) throw fail('DEVICE_UNREACHABLE', `ECP returned ${r.statusCode}`);
    const parsed = parseXml(r.body.toString('utf8')) as { 'r2d2-bitrates'?: { 'bitrate-stream'?: any | any[] } };
    const list = parsed['r2d2-bitrates']?.['bitrate-stream'] ?? [];
    const arr = Array.isArray(list) ? list : [list];
    return arr.map((s) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(s as Record<string, unknown>)) out[k.replace(/^@_/, '')] = String(v);
      return out;
    });
  }

  async icon(appId: string): Promise<{ mime: string; bytes: number; base64: string }> {
    const r = await get(this.host, this.port, `/query/icon/${encodeURIComponent(appId)}`);
    if (r.statusCode !== 200) throw fail('DEVICE_UNREACHABLE', `ECP returned ${r.statusCode}`);
    const mime = String(r.headers['content-type'] ?? 'application/octet-stream').split(';')[0]!;
    return { mime, bytes: r.body.length, base64: r.body.toString('base64') };
  }
}
