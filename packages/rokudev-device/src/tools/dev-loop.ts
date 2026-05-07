import { registerToolsModule, type ToolDef } from './_register.js';
import { DevPortal, TelnetClient, fail } from '@rokudev/device-client';
import { resolveTarget } from '../util/resolve-target.js';
import { checkReachable } from '../util/network-guard.js';

function tool(t: ToolDef): ToolDef { return t; }

registerToolsModule((tools) => {
  tools.set('dev_loop', tool({
    name: 'dev_loop',
    description: 'Sideload a zip and tail logs for tail_seconds. Returns sideload result and captured lines.',
    inputSchema: {
      type: 'object',
      properties: {
        device:       { type: 'string' },
        host:         { type: 'string' },
        dev_password: { type: 'string' },
        zip_path:     { type: 'string' },
        tail_seconds: { type: 'number', minimum: 0, maximum: 120, default: 10 },
        force:        { type: 'boolean' },
        // Plan 4 enforces freeform_lint_override; Plan 1 accepts but ignores it for forward compatibility.
        freeform_lint_override: { type: 'boolean' },
      },
      required: ['zip_path'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const t = await resolveTarget(a as Record<string, string>);
      await checkReachable(t.device, a['force'] === true);
      if (!t.dev_password) throw fail('DEVICE_NO_PASSWORD', 'no dev_password resolved');
      const dp = new DevPortal(t.host, t.dev_password);
      const sideloadRaw = await dp.sideload(a['zip_path'] as string);
      // Strip `ok` so it doesn't collide with our outer `ok: true` (TS2783 pattern, see devportal.ts).
      const { ok: _ok, ...sideload } = sideloadRaw as Record<string, unknown>;
      const tail = (a['tail_seconds'] as number | undefined) ?? 10;
      const lines = tail > 0 ? await new TelnetClient().tail(t.host, 8085, tail) : [];
      return { ok: true, host: t.host, sideload, log_lines: lines };
    },
  }));
});
