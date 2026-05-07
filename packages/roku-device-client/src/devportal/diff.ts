import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import yauzl from 'yauzl';
import { digestRequest } from '../_internal/digest.js';
import { fail } from '../errors/index.js';

export type DiffResult = {
  ok: true;
  added: string[];
  removed: string[];
  changed: string[];
  same: string[];
  duration_ms: number;
};

export async function diffInstalled(
  host: string,
  password: string,
  projectDir: string,
  port = 80,
): Promise<DiffResult> {
  const start = Date.now();
  // Fetch the device's dev.zip
  const r = await digestRequest({
    method: 'GET',
    url: `http://${host}:${port}/pkgs/dev.zip`,
    username: 'rokudev',
    password,
  });
  if (r.statusCode === 404) throw fail('DEV_PKG_UNAVAILABLE', 'no dev.zip on device');
  if (r.statusCode !== 200)
    throw fail('DEVICE_UNREACHABLE', `dev.zip GET returned ${r.statusCode}`);
  const remote = await zipToHashMap(r.bodyBytes);
  const local = await dirToHashMap(projectDir);
  const added: string[] = [],
    removed: string[] = [],
    changed: string[] = [],
    same: string[] = [];
  const all = new Set([...remote.keys(), ...local.keys()]);
  for (const path of all) {
    const a = local.get(path),
      b = remote.get(path);
    if (a && !b) added.push(path);
    else if (!a && b) removed.push(path);
    else if (a !== b) changed.push(path);
    else same.push(path);
  }
  added.sort();
  removed.sort();
  changed.sort();
  same.sort();
  return { ok: true, added, removed, changed, same, duration_ms: Date.now() - start };
}

async function zipToHashMap(bytes: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, zf) => {
      if (err || !zf) return reject(err);
      const m = new Map<string, string>();
      zf.on('entry', (e) => {
        if (/\/$/.test(e.fileName)) {
          zf.readEntry();
          return;
        }
        zf.openReadStream(e, (err, rs) => {
          if (err || !rs) return reject(err);
          const chunks: Buffer[] = [];
          rs.on('data', (c) => chunks.push(c));
          rs.on('end', () => {
            m.set(e.fileName, createHash('sha256').update(Buffer.concat(chunks)).digest('hex'));
            zf.readEntry();
          });
        });
      });
      zf.on('end', () => resolve(m));
      zf.readEntry();
    });
  });
}

async function dirToHashMap(dir: string): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    const parent =
      (e as unknown as { parentPath?: string; path?: string }).parentPath ??
      (e as unknown as { path?: string }).path ??
      dir;
    const full = join(parent, e.name);
    const rel = relative(dir, full).split(sep).join('/');
    const data = await readFile(full);
    m.set(rel, createHash('sha256').update(data).digest('hex'));
  }
  return m;
}
