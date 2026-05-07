import { registerToolsModule, type ToolDef } from './_register.js';
import { EcpClient } from '@rokudev/device-client';
import { resolveTarget } from '../util/resolve-target.js';
import { checkReachable } from '../util/network-guard.js';

function tool(t: ToolDef): ToolDef { return t; }

const baseProps = {
  device: { type: 'string' },
  host:   { type: 'string' },
  force:  { type: 'boolean' },
};

registerToolsModule((tools) => {
  tools.set('ecp_device_info', tool({
    name: 'ecp_device_info',
    description: 'Read ECP /query/device-info from the targeted Roku.',
    inputSchema: { type: 'object', properties: { ...baseProps }, additionalProperties: false },
    handler: async (a) => {
      const t = await resolveTarget(a as Record<string, string>);
      await checkReachable(t.device, a['force'] === true);
      const info = await new EcpClient(t.host).deviceInfo();
      return { ok: true, host: t.host, info };
    },
  }));

  tools.set('ecp_apps', tool({
    name: 'ecp_apps',
    description: 'List installed channels via ECP /query/apps from the targeted Roku.',
    inputSchema: { type: 'object', properties: { ...baseProps }, additionalProperties: false },
    handler: async (a) => {
      const t = await resolveTarget(a as Record<string, string>);
      await checkReachable(t.device, a['force'] === true);
      const apps = await new EcpClient(t.host).apps();
      return { ok: true, host: t.host, apps };
    },
  }));

  tools.set('ecp_active_app', tool({
    name: 'ecp_active_app',
    description: 'Get the currently active channel via ECP /query/active-app from the targeted Roku.',
    inputSchema: { type: 'object', properties: { ...baseProps }, additionalProperties: false },
    handler: async (a) => {
      const t = await resolveTarget(a as Record<string, string>);
      await checkReachable(t.device, a['force'] === true);
      const active = await new EcpClient(t.host).activeApp();
      return { ok: true, host: t.host, active };
    },
  }));

  tools.set('ecp_media_player', tool({
    name: 'ecp_media_player',
    description: 'Read media player state via ECP /query/media-player from the targeted Roku.',
    inputSchema: { type: 'object', properties: { ...baseProps }, additionalProperties: false },
    handler: async (a) => {
      const t = await resolveTarget(a as Record<string, string>);
      await checkReachable(t.device, a['force'] === true);
      const media_player = await new EcpClient(t.host).mediaPlayer();
      return { ok: true, host: t.host, media_player };
    },
  }));

  tools.set('ecp_r2d2_bitrate', tool({
    name: 'ecp_r2d2_bitrate',
    description: 'Read stream bitrate info via ECP /query/r2d2_bitrate from the targeted Roku.',
    inputSchema: { type: 'object', properties: { ...baseProps }, additionalProperties: false },
    handler: async (a) => {
      const t = await resolveTarget(a as Record<string, string>);
      await checkReachable(t.device, a['force'] === true);
      const streams = await new EcpClient(t.host).r2d2Bitrate();
      return { ok: true, host: t.host, streams };
    },
  }));

  tools.set('ecp_icon', tool({
    name: 'ecp_icon',
    description: 'Fetch a channel icon as base64 from ECP /query/icon/<app_id> on the targeted Roku.',
    inputSchema: {
      type: 'object',
      properties: { ...baseProps, app_id: { type: 'string' } },
      required: ['app_id'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const t = await resolveTarget(a as Record<string, string>);
      await checkReachable(t.device, a['force'] === true);
      const result = await new EcpClient(t.host).icon(a['app_id'] as string);
      return { ok: true, host: t.host, ...result };
    },
  }));
});
