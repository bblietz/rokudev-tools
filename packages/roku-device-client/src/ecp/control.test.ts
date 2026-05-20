import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EcpControl } from './control.js';

const requests: { method: string; url: string }[] = [];
let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    requests.push({ method: req.method!, url: req.url! });
    res.statusCode = 200;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('EcpControl', () => {
  const c = () => new EcpControl('127.0.0.1', port);

  it('rejects disallowed standard key', async () => {
    await expect(c().keypress('NotAKey' as any)).rejects.toMatchObject({
      code: 'ECP_KEY_DISALLOWED',
    });
  });

  it('rejects Lit_ with disallowed char', async () => {
    await expect(c().keypress('Lit_/')).rejects.toMatchObject({ code: 'ECP_KEY_DISALLOWED' });
    await expect(c().keypress('Lit_ ')).rejects.toMatchObject({ code: 'ECP_KEY_DISALLOWED' });
    await expect(c().keypress('Lit_&')).rejects.toMatchObject({ code: 'ECP_KEY_DISALLOWED' });
  });

  it('accepts standard and Lit_<safe> keys', async () => {
    requests.length = 0;
    await c().keypress('Up');
    await c().keypress('Lit_a');
    expect(requests.map((r) => r.url)).toEqual(['/keypress/Up', '/keypress/Lit_a']);
  });

  it('keysequence sends in order with delay', async () => {
    requests.length = 0;
    const start = Date.now();
    await c().keysequence(['Down', 'Right'], 50);
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
    expect(requests.map((r) => r.url)).toEqual(['/keypress/Down', '/keypress/Right']);
  });

  it('launch encodes allowed param keys', async () => {
    requests.length = 0;
    await c().launch('dev', { contentId: 'abc 123', x_custom: 'v' });
    expect(requests[0]!.url).toBe('/launch/dev?contentId=abc%20123&x_custom=v');
  });

  it('launch rejects disallowed param keys', async () => {
    await expect(c().launch('dev', { evil: 'x' })).rejects.toMatchObject({
      code: 'ECP_PARAM_DISALLOWED',
    });
  });

  it('launch accepts bs_debug_protocol (BDP enablement)', async () => {
    requests.length = 0;
    await c().launch('dev', { bs_debug_protocol: '1' });
    expect(requests[0]!.url).toBe('/launch/dev?bs_debug_protocol=1');
  });

  it('input accepts action key (deep-link standard)', async () => {
    requests.length = 0;
    await c().input({ action: 'play', contentId: 'abc' });
    expect(requests[0]!.url).toBe('/input?action=play&contentId=abc');
  });

  it('input rejects disallowed keys', async () => {
    await expect(c().input({ random: 'x' })).rejects.toMatchObject({
      code: 'ECP_PARAM_DISALLOWED',
    });
  });

  it('toHome sends Home twice', async () => {
    requests.length = 0;
    await c().toHome();
    expect(requests.filter((r) => r.url === '/keypress/Home')).toHaveLength(2);
  });
});
