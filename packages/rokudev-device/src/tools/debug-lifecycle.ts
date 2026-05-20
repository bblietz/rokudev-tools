import { registerToolsModule, type ToolDef } from './_register.js';
import { BdpSession, EcpClient, fail } from '@rokudev/device-client';
import { resolveTarget } from '../util/resolve-target.js';
import { checkReachable } from '../util/network-guard.js';
import {
  registerSession,
  tryGetSession,
  hasSession,
  dropSession,
  isKnownDetached,
  reserveHost,
  bindHost,
  releaseHost,
  getHostForSession,
  rememberBreakpoints,
  consumeInvalidatedBreakpoints,
} from '../util/debug-session-registry.js';

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
    'debug_attach',
    tool({
      name: 'debug_attach',
      description:
        'Attach a BrightScript Debug Protocol (BDP) session to a Roku device. ' +
        'Returns session_id for use in subsequent debug tools.',
      inputSchema: {
        type: 'object',
        properties: { ...baseProps },
        additionalProperties: false,
      },
      handler: async (args) => {
        const t = await resolveTarget(args as Record<string, string>);
        await checkReachable(t.device, args['force'] === true);
        reserveHost(t.host);
        try {
          const session = await BdpSession.attach(t.host);
          const id = registerSession(session);
          bindHost(t.host, id);
          const invalidated = consumeInvalidatedBreakpoints(t.host);
          const out: Record<string, unknown> = {
            ok: true,
            host: t.host,
            session_id: id,
            bdp_version: session.bdpVersion,
          };
          if (invalidated.length > 0) out['details'] = { invalidated_breakpoints: invalidated };
          return out;
        } catch (e) {
          releaseHost(t.host);
          // Best-effort: BDP listener is gated off on Roku TV firmware regardless
          // of bs_debug_protocol=1 launch param or ECP mobile-control mode.
          // (See docs/refs/bdp-wire-format.md §6 Run 2.) If attach failed AND the
          // device is a TV, surface a clear hint instead of the generic timeout.
          // Any failure of the probe itself is swallowed so we never mask the
          // original error with a probe-side network issue.
          const failure = e as { code?: string; message?: string; details?: Record<string, unknown> };
          if (failure?.code === 'BDP_ATTACH_FAILED') {
            let info: Record<string, string> | null = null;
            try {
              info = await new EcpClient(t.host).deviceInfo();
            } catch {
              // Probe failed; fall through and re-throw the original error.
            }
            if (info?.['is-tv'] === 'true') {
              const model = info['model-name'] ?? info['model-number'] ?? 'unknown';
              throw fail(
                'BDP_ATTACH_FAILED',
                `BDP not supported on Roku TV hardware (${model}); attach to a non-TV Roku (Express / Stick / Ultra). Original: ${failure.message ?? ''}`,
                {
                  ...(failure.details ?? {}),
                  is_tv: true,
                  model_name: model,
                  hint: 'See docs/refs/bdp-wire-format.md §6 Run 2: the BDP listener is gated off in TV-class firmware regardless of bs_debug_protocol=1 launch param or ECP mobile-control mode.',
                },
              );
            }
          }
          throw e;
        }
      },
    }),
  );

  tools.set(
    'debug_detach',
    tool({
      name: 'debug_detach',
      description:
        'Detach from an active BDP debug session. Idempotent -- safe to call multiple times ' +
        'or with an already-closed session_id.',
      inputSchema: {
        type: 'object',
        properties: { session_id: { type: 'string' } },
        required: ['session_id'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const id = args['session_id'] as string;
        const host = getHostForSession(id);
        if (!host) {
          // Already detached or never issued; idempotent no-op.
          return { ok: true, session_id: id };
        }
        const session = tryGetSession(id);
        if (session) {
          // Snapshot breakpoints BEFORE closing the client.
          rememberBreakpoints(host, session.currentBreakpoints().slice());
          session.detach();
        }
        dropSession(id);
        releaseHost(host);
        return { ok: true, session_id: id };
      },
    }),
  );

  tools.set(
    'debug_session_state',
    tool({
      name: 'debug_session_state',
      description:
        'Return the current state of a BDP debug session without modifying it. ' +
        'Safe to call at any time; never throws.',
      inputSchema: {
        type: 'object',
        properties: { session_id: { type: 'string' } },
        required: ['session_id'],
        additionalProperties: false,
      },
      handler: async (args) => {
        const id = args['session_id'] as string;
        if (hasSession(id)) {
          const session = tryGetSession(id)!;
          return {
            ok: true,
            session_id: id,
            state: session.state,
            bdp_version: session.bdpVersion,
          };
        } else if (isKnownDetached(id)) {
          return { ok: true, session_id: id, state: 'detached', bdp_version: null };
        } else {
          return { ok: true, session_id: id, state: 'unknown', bdp_version: null };
        }
      },
    }),
  );
});
