import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('rokudev-device server smoke', () => {
  it('responds to MCP initialize handshake', async () => {
    const proc = spawn(process.execPath, [join(__dirname, '..', 'dist', 'index.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const reqId = 1;
    const req = JSON.stringify({
      jsonrpc: '2.0',
      id: reqId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 't', version: '1' },
      },
    });
    proc.stdin.write(req + '\n');
    let out = '';
    for await (const chunk of proc.stdout) {
      out += chunk.toString();
      // MCP responses are newline-delimited JSON-RPC; try parsing the first complete line.
      const firstLine = out.split('\n').filter(Boolean)[0];
      if (firstLine) {
        try {
          const obj = JSON.parse(firstLine);
          expect(obj.result.protocolVersion).toBe('2024-11-05');
          proc.kill();
          return;
        } catch {
          /* keep reading */
        }
      }
    }
    // If stdout closed without a valid MCP response, the server is not wired up.
    throw new Error('Server closed stdout without sending an MCP initialize response');
  }, 10_000);
});
