import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('rokudev-device e2e: tools/list', () => {
  it('lists every tool from Phase 2', async () => {
    const proc = spawn(process.execPath, [join(__dirname, '..', 'dist', 'index.js')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const result = await new Promise<string[]>((resolve, reject) => {
      let buf = '';
      let toolsListSent = false;

      proc.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const lines = buf.split('\n');

        if (!toolsListSent && lines.some((l) => l.includes('"id":1'))) {
          toolsListSent = true;
          proc.stdin.write(
            JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n',
          );
        }

        const toolsLine = lines.find((l) => l.includes('"id":2'));
        if (toolsLine) {
          try {
            const obj = JSON.parse(toolsLine);
            const names: string[] = obj.result.tools.map((t: { name: string }) => t.name).sort();
            proc.kill();
            resolve(names);
          } catch (err) {
            proc.kill();
            reject(err);
          }
        }
      });

      proc.stdout.on('close', () => {
        reject(new Error('Server closed stdout without sending tools/list response'));
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        // Ignore stderr noise from the MCP server (e.g. startup messages)
        void chunk;
      });

      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'e2e', version: '1' },
          },
        }) + '\n',
      );
    });

    expect(result).toEqual(
      [
        // device-management (T27 + T34 device_discover)
        'device_add',
        'device_discover',
        'device_list',
        'device_remove',
        'device_set_active',
        'device_set_password',
        'device_test',
        // ECP read (T28)
        'ecp_active_app',
        'ecp_apps',
        'ecp_device_info',
        'ecp_icon',
        'ecp_media_player',
        'ecp_r2d2_bitrate',
        // ECP control (T29)
        'ecp_input',
        'ecp_keypress',
        'ecp_keysequence',
        'ecp_launch',
        'ecp_to_home',
        // dev-portal (T30)
        'crashlog_pull',
        'diff_installed',
        'genkey',
        'pack_signed',
        'profiler_snapshot',
        'query_registry',
        'rekey',
        'screenshot',
        'sideload',
        'unload',
        // log (T31)
        'log_stream_close',
        'log_stream_open',
        'log_stream_read',
        'log_tail',
        // composite (T32)
        'dev_loop',
        // debug lifecycle (T20)
        'debug_attach',
        'debug_detach',
        'debug_session_state',
        // debug breakpoints (T21)
        'debug_clear_breakpoint',
        'debug_list_breakpoints',
        'debug_set_breakpoint',
        // debug execution (T22)
        'debug_continue',
        'debug_pause',
        'debug_step',
        'debug_step_out',
        'debug_step_over',
      ].sort(),
    );
  }, 15_000);
});
