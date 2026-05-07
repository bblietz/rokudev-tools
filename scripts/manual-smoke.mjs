#!/usr/bin/env node
// Manual smoke: spawn rokudev-device, exercise the device tools against a real Roku.
// Usage: ROKUDEV_DEFAULT_ROKU_HOST=192.168.1.42 ROKUDEV_ROKU_DEV_PASSWORD=rokudev node scripts/manual-smoke.mjs
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const proc = spawn(process.execPath, [resolve('packages/rokudev-device/dist/index.js')], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let nextId = 1;
function call(method, params) {
  const id = nextId++;
  return new Promise((res) => {
    const onData = (chunk) => {
      const text = chunk.toString();
      const line = text.split('\n').find((l) => l.includes(`"id":${id}`));
      if (line) {
        proc.stdout.off('data', onData);
        res(JSON.parse(line));
      }
    };
    proc.stdout.on('data', onData);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

await call('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '1' },
});
console.log(await call('tools/list', {}));
// device_test first: surfaces DEVICE_NOT_RESOLVED clearly if env vars are missing.
console.log(await call('tools/call', { name: 'device_test', arguments: {} }));
console.log(await call('tools/call', { name: 'ecp_device_info', arguments: {} }));
console.log(await call('tools/call', { name: 'ecp_apps', arguments: {} }));
console.log(await call('tools/call', { name: 'log_tail', arguments: { seconds: 2 } }));
proc.kill();
