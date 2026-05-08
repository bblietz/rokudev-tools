#!/usr/bin/env node
// Manual BDP smoke. Usage:
//   ROKUDEV_DEFAULT_ROKU_HOST=192.168.1.42 ROKUDEV_ROKU_DEV_PASSWORD=rokudev node scripts/manual-bdp-smoke.mjs
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const proc = spawn(
  process.execPath,
  [resolve('packages/rokudev-device/dist/index.js')],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);

let nextId = 1;
let buf = '';
const pending = new Map(); // id -> resolve fn

proc.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const l of lines) {
    if (!l) continue;
    try {
      const obj = JSON.parse(l);
      const cb = pending.get(obj.id);
      if (cb) {
        pending.delete(obj.id);
        cb(obj);
      }
    } catch {
      // ignore non-JSON lines
    }
  }
});

function call(method, params) {
  const id = nextId++;
  const req = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  return new Promise((res) => {
    pending.set(id, res);
    proc.stdin.write(req + '\n');
  });
}

await call('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'bdp-smoke', version: '1' },
});

const attach = await call('tools/call', { name: 'debug_attach', arguments: {} });
console.log('attach:', JSON.stringify(attach, null, 2));

const attachResult = JSON.parse(attach.result.content[0].text);
const sessionId = attachResult.session_id;

const threads = await call('tools/call', {
  name: 'debug_threads',
  arguments: { session_id: sessionId },
});
console.log('threads:', JSON.stringify(threads, null, 2));

const detach = await call('tools/call', {
  name: 'debug_detach',
  arguments: { session_id: sessionId },
});
console.log('detach:', JSON.stringify(detach, null, 2));

proc.kill();
