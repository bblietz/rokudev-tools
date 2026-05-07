import { registerToolsModule, type ToolDef } from './_register.js';
import { TelnetClient, LogStream, fail, type TelnetPort } from '@rokudev/device-client';
import { resolveTarget } from '../util/resolve-target.js';
import { checkReachable } from '../util/network-guard.js';

const sessions = new Map<string, LogStream>();

function tool(t: ToolDef): ToolDef {
  return t;
}

const baseProps = {
  device: { type: 'string' },
  host: { type: 'string' },
  force: { type: 'boolean' },
};

registerToolsModule((tools) => {
  tools.set(
    'log_tail',
    tool({
      name: 'log_tail',
      description: 'Capture BrightScript debug console output for a fixed duration.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseProps,
          port: { type: 'integer', enum: [8080, 8085, 8087], default: 8085 },
          seconds: { type: 'number', minimum: 0.5, maximum: 600, default: 10 },
        },
        additionalProperties: false,
      },
      handler: async (a) => {
        const t = await resolveTarget(a as Record<string, string>);
        await checkReachable(t.device, a['force'] === true);
        const port = (a['port'] as TelnetPort | undefined) ?? 8085;
        const seconds = (a['seconds'] as number | undefined) ?? 10;
        const lines = await new TelnetClient().tail(t.host, port, seconds);
        return { ok: true, host: t.host, port, lines };
      },
    }),
  );

  tools.set(
    'log_stream_open',
    tool({
      name: 'log_stream_open',
      description: 'Open a long-running telnet log session. Returns session_id.',
      inputSchema: {
        type: 'object',
        properties: {
          ...baseProps,
          port: { type: 'integer', enum: [8080, 8085, 8087], default: 8085 },
        },
        additionalProperties: false,
      },
      handler: async (a) => {
        const t = await resolveTarget(a as Record<string, string>);
        await checkReachable(t.device, a['force'] === true);
        const port = (a['port'] as TelnetPort | undefined) ?? 8085;
        const ls = await LogStream.open(t.host, port);
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        sessions.set(id, ls);
        return { ok: true, session_id: id, host: t.host, port };
      },
    }),
  );

  tools.set(
    'log_stream_read',
    tool({
      name: 'log_stream_read',
      description: 'Read pending lines from a long-running telnet log session.',
      inputSchema: {
        type: 'object',
        properties: { session_id: { type: 'string' } },
        required: ['session_id'],
        additionalProperties: false,
      },
      handler: async (a) => {
        const ls = sessions.get(a['session_id'] as string);
        if (!ls) throw fail('LOG_STREAM_TIMED_OUT', 'unknown session_id');
        const r = ls.read();
        // Library returns the canonical {lines, details?} shape; pass through directly.
        return { ok: true, ...r };
      },
    }),
  );

  tools.set(
    'log_stream_close',
    tool({
      name: 'log_stream_close',
      description: 'Close a long-running telnet log session. Idempotent.',
      inputSchema: {
        type: 'object',
        properties: { session_id: { type: 'string' } },
        required: ['session_id'],
        additionalProperties: false,
      },
      handler: async (a) => {
        const id = a['session_id'] as string;
        const ls = sessions.get(id);
        if (ls) ls.close();
        sessions.delete(id);
        return { ok: true };
      },
    }),
  );
});

// Test-only export so tests can clear sessions between runs.
export function _resetSessions(): void {
  sessions.clear();
}
