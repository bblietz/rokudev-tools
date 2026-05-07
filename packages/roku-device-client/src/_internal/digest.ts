/**
 * RFC 2617 Digest authentication client.
 *
 * Single implementation used by all dev-portal calls. Not exported from the
 * package's public exports map -- internal use only.
 */

import { createHash, randomBytes } from 'node:crypto';
import { request, type Dispatcher } from 'undici';

export type DigestRequest = {
  method: 'GET' | 'POST';
  url: string;
  username: string;
  password: string;
  body?: Buffer | string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type DigestResponse = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  bodyBytes: Buffer;
  bodyText: string;
};

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

function parseChallenge(header: string): Record<string, string> {
  // Strip leading "Digest"
  const body = header.replace(/^Digest\s+/i, '');
  const out: Record<string, string> = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|([^,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    out[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
  }
  return out;
}

export async function digestRequest(req: DigestRequest): Promise<DigestResponse> {
  const u = new URL(req.url);
  const initial = await request(req.url, {
    method: req.method,
    ...(req.body !== undefined ? { body: req.body } : {}),
    ...(req.headers !== undefined ? { headers: req.headers } : {}),
    ...(req.signal !== undefined ? { signal: req.signal } : {}),
  });
  if (initial.statusCode !== 401) {
    return await collect(initial);
  }
  const wwwAuth = initial.headers['www-authenticate'];
  await initial.body.dump();
  if (!wwwAuth || Array.isArray(wwwAuth)) {
    throw new Error(`expected single WWW-Authenticate header, got ${wwwAuth}`);
  }
  const c = parseChallenge(wwwAuth);
  const realm = c.realm ?? '';
  const nonce = c.nonce ?? '';
  const opaque = c.opaque;
  const qop = (c.qop ?? '').split(',').map((s) => s.trim()).find((q) => q === 'auth') ?? '';
  const cnonce = randomBytes(8).toString('hex');
  const nc = '00000001';
  const ha1 = md5(`${req.username}:${realm}:${req.password}`);
  const ha2 = md5(`${req.method}:${u.pathname}${u.search}`);
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);
  const auth =
    `Digest username="${req.username}", realm="${realm}", nonce="${nonce}", ` +
    `uri="${u.pathname}${u.search}", response="${response}"` +
    (qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : '') +
    (opaque ? `, opaque="${opaque}"` : '');
  const second = await request(req.url, {
    method: req.method,
    ...(req.body !== undefined ? { body: req.body } : {}),
    headers: { ...req.headers, authorization: auth },
    ...(req.signal !== undefined ? { signal: req.signal } : {}),
  });
  return await collect(second);
}

async function collect(r: Dispatcher.ResponseData): Promise<DigestResponse> {
  const chunks: Buffer[] = [];
  for await (const chunk of r.body) chunks.push(Buffer.from(chunk));
  const bodyBytes = Buffer.concat(chunks);
  return {
    statusCode: r.statusCode,
    headers: r.headers as Record<string, string | string[]>,
    bodyBytes,
    bodyText: bodyBytes.toString('utf8'),
  };
}
