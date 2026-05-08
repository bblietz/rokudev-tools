import { registerToolsModule, type ToolDef } from './_register.js';
import { getSession } from '../util/debug-session-registry.js';

function tool(t: ToolDef): ToolDef { return t; }

const sessionThreadProps = {
  session_id: { type: 'string' },
  thread_id: { type: 'integer' },
};

registerToolsModule((tools) => {
  tools.set('debug_continue', tool({
    name: 'debug_continue',
    description: 'Resume execution of a paused thread.',
    inputSchema: {
      type: 'object',
      properties: { ...sessionThreadProps },
      required: ['session_id', 'thread_id'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const session = getSession(a['session_id'] as string);
      await session.resume(a['thread_id'] as number);
      return { ok: true, session_id: a['session_id'] };
    },
  }));

  tools.set('debug_step', tool({
    name: 'debug_step',
    description: 'Step into a single source line on a thread.',
    inputSchema: {
      type: 'object',
      properties: { ...sessionThreadProps },
      required: ['session_id', 'thread_id'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const session = getSession(a['session_id'] as string);
      await session.step(a['thread_id'] as number, 'line');
      return { ok: true, session_id: a['session_id'] };
    },
  }));

  tools.set('debug_step_over', tool({
    name: 'debug_step_over',
    description: 'Step over the current line on a thread.',
    inputSchema: {
      type: 'object',
      properties: { ...sessionThreadProps },
      required: ['session_id', 'thread_id'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const session = getSession(a['session_id'] as string);
      await session.step(a['thread_id'] as number, 'over');
      return { ok: true, session_id: a['session_id'] };
    },
  }));

  tools.set('debug_step_out', tool({
    name: 'debug_step_out',
    description: 'Step out of the current function on a thread.',
    inputSchema: {
      type: 'object',
      properties: { ...sessionThreadProps },
      required: ['session_id', 'thread_id'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const session = getSession(a['session_id'] as string);
      await session.step(a['thread_id'] as number, 'out');
      return { ok: true, session_id: a['session_id'] };
    },
  }));

  tools.set('debug_pause', tool({
    name: 'debug_pause',
    description: 'Pause the running channel.',
    inputSchema: {
      type: 'object',
      properties: { session_id: { type: 'string' } },
      required: ['session_id'],
      additionalProperties: false,
    },
    handler: async (a) => {
      const session = getSession(a['session_id'] as string);
      await session.pause();
      return { ok: true, session_id: a['session_id'] };
    },
  }));
});
