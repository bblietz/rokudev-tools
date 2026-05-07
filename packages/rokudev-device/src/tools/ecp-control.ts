import { registerToolsModule, type ToolDef } from './_register.js';
import { EcpControl } from '@rokudev/device-client';
import { resolveTarget } from '../util/resolve-target.js';
import { checkReachable } from '../util/network-guard.js';

function tool(t: ToolDef): ToolDef { return t; }

const baseProps = {
  device: { type: 'string' },
  host:   { type: 'string' },
  force:  { type: 'boolean' },
};

registerToolsModule((tools) => {
  tools.set('ecp_keypress', tool({
    name: 'ecp_keypress',
    description: 'Send a keypress (or keydown/keyup) event to the targeted Roku.',
    inputSchema: {
      type: 'object',
      properties: {
        ...baseProps,
        key:    { type: 'string' },
        mode:   { type: 'string', enum: ['press', 'down', 'up'], default: 'press' },
        repeat: { type: 'integer', minimum: 1, maximum: 50, default: 1 },
      },
      required: ['key'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const t = await resolveTarget(a as Record<string, string>);
      await checkReachable(t.device, a['force'] === true);
      const ctl = new EcpControl(t.host);
      const key    = a['key'] as string;
      const mode   = (a['mode'] as 'press' | 'down' | 'up' | undefined) ?? 'press';
      const repeat = (a['repeat'] as number | undefined) ?? 1;
      for (let i = 0; i < repeat; i++) await ctl.keypress(key, mode);
      return { ok: true, host: t.host, key, mode, repeat };
    },
  }));

  tools.set('ecp_keysequence', tool({
    name: 'ecp_keysequence',
    description: 'Send a sequence of keypress events with optional delay between them.',
    inputSchema: {
      type: 'object',
      properties: {
        ...baseProps,
        keys:     { type: 'array', items: { type: 'string' }, minItems: 1 },
        delay_ms: { type: 'integer', minimum: 0, maximum: 5000, default: 150 },
      },
      required: ['keys'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const t = await resolveTarget(a as Record<string, string>);
      await checkReachable(t.device, a['force'] === true);
      const ctl     = new EcpControl(t.host);
      const keys    = a['keys'] as string[];
      const delayMs = (a['delay_ms'] as number | undefined) ?? 150;
      await ctl.keysequence(keys, delayMs);
      return { ok: true, host: t.host, count: keys.length };
    },
  }));

  tools.set('ecp_launch', tool({
    name: 'ecp_launch',
    description: 'Launch a Roku channel by app_id, with optional deep-link params.',
    inputSchema: {
      type: 'object',
      properties: {
        ...baseProps,
        app_id: { type: 'string' },
        params: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['app_id'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const t      = await resolveTarget(a as Record<string, string>);
      await checkReachable(t.device, a['force'] === true);
      const ctl    = new EcpControl(t.host);
      const appId  = a['app_id'] as string;
      const params = a['params'] as Record<string, string> | undefined;
      await ctl.launch(appId, params);
      return { ok: true, host: t.host, app_id: appId };
    },
  }));

  tools.set('ecp_input', tool({
    name: 'ecp_input',
    description: 'POST /input to deep-link into the running channel.',
    inputSchema: {
      type: 'object',
      properties: {
        ...baseProps,
        params: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['params'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const t      = await resolveTarget(a as Record<string, string>);
      await checkReachable(t.device, a['force'] === true);
      const ctl    = new EcpControl(t.host);
      const params = a['params'] as Record<string, string>;
      await ctl.input(params);
      return { ok: true, host: t.host };
    },
  }));

  tools.set('ecp_to_home', tool({
    name: 'ecp_to_home',
    description: 'Send Home twice to return the device to the home screen.',
    inputSchema: {
      type: 'object',
      properties: { ...baseProps },
      additionalProperties: false,
    },
    handler: async (a) => {
      const t = await resolveTarget(a as Record<string, string>);
      await checkReachable(t.device, a['force'] === true);
      await new EcpControl(t.host).toHome();
      return { ok: true, host: t.host };
    },
  }));
});
