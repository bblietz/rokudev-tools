import { describe, it, expect, beforeEach, vi } from 'vitest';

// Side-effect: register debug-execution tools.
await import('./debug-execution.js');

import { registerAllTools, type ToolDef } from './_register.js';
import { _resetSessions, registerSession } from '../util/debug-session-registry.js';
import { fail } from '@rokudev/device-client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tools: Map<string, ToolDef>;

beforeEach(() => {
  tools = new Map();
  registerAllTools(tools);
  _resetSessions();
});

function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const def = tools.get(name);
  if (!def) throw new Error(`tool ${name} not registered`);
  return def.handler(args);
}

function registerFakeSession(
  stubs: { resume?: ReturnType<typeof vi.fn>; step?: ReturnType<typeof vi.fn>; pause?: ReturnType<typeof vi.fn> } = {},
): string {
  const session = {
    resume: stubs.resume ?? vi.fn().mockResolvedValue(undefined),
    step: stubs.step ?? vi.fn().mockResolvedValue(undefined),
    pause: stubs.pause ?? vi.fn().mockResolvedValue(undefined),
    // Minimal stubs required by session registry typing.
    state: 'live',
    bdpVersion: { major: 3, minor: 0, patch: 0 },
    currentBreakpoints: vi.fn().mockReturnValue([]),
    detach: vi.fn(),
  } as unknown as import('@rokudev/device-client').BdpSession;
  return registerSession(session);
}

// ---------------------------------------------------------------------------
// 1. Schema registration smoke
// ---------------------------------------------------------------------------

describe('debug execution tool registration', () => {
  it('registers all 5 tools with expected shapes', () => {
    const expected: Record<string, string[]> = {
      debug_continue:   ['session_id', 'thread_id'],
      debug_step:       ['session_id', 'thread_id'],
      debug_step_over:  ['session_id', 'thread_id'],
      debug_step_out:   ['session_id', 'thread_id'],
      debug_pause:      ['session_id'],
    };

    for (const [name, required] of Object.entries(expected)) {
      expect(tools.has(name), `${name} not registered`).toBe(true);
      const def = tools.get(name)!;
      expect(typeof def.name).toBe('string');
      expect(typeof def.description).toBe('string');
      expect(def.inputSchema).toBeDefined();
      const schema = def.inputSchema as Record<string, unknown>;
      expect(schema['type']).toBe('object');
      expect(typeof def.handler).toBe('function');
      expect(schema['required']).toEqual(expect.arrayContaining(required));
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path for each tool
// ---------------------------------------------------------------------------

describe('debug_continue happy path', () => {
  it('calls session.resume(thread_id) and returns { ok: true, session_id }', async () => {
    const resume = vi.fn().mockResolvedValue(undefined);
    const sid = registerFakeSession({ resume });

    const result = (await call('debug_continue', { session_id: sid, thread_id: 1 })) as Record<string, unknown>;

    expect(resume).toHaveBeenCalledWith(1);
    expect(result).toEqual({ ok: true, session_id: sid });
  });
});

describe('debug_step happy path', () => {
  it('calls session.step(thread_id, "line") and returns { ok: true, session_id }', async () => {
    const step = vi.fn().mockResolvedValue(undefined);
    const sid = registerFakeSession({ step });

    const result = (await call('debug_step', { session_id: sid, thread_id: 1 })) as Record<string, unknown>;

    expect(step).toHaveBeenCalledWith(1, 'line');
    expect(result).toEqual({ ok: true, session_id: sid });
  });
});

describe('debug_step_over happy path', () => {
  it('calls session.step(thread_id, "over") and returns { ok: true, session_id }', async () => {
    const step = vi.fn().mockResolvedValue(undefined);
    const sid = registerFakeSession({ step });

    const result = (await call('debug_step_over', { session_id: sid, thread_id: 1 })) as Record<string, unknown>;

    expect(step).toHaveBeenCalledWith(1, 'over');
    expect(result).toEqual({ ok: true, session_id: sid });
  });
});

describe('debug_step_out happy path', () => {
  it('calls session.step(thread_id, "out") and returns { ok: true, session_id }', async () => {
    const step = vi.fn().mockResolvedValue(undefined);
    const sid = registerFakeSession({ step });

    const result = (await call('debug_step_out', { session_id: sid, thread_id: 1 })) as Record<string, unknown>;

    expect(step).toHaveBeenCalledWith(1, 'out');
    expect(result).toEqual({ ok: true, session_id: sid });
  });
});

describe('debug_pause happy path', () => {
  it('calls session.pause() (no thread_id) and returns { ok: true, session_id }', async () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    const sid = registerFakeSession({ pause });

    const result = (await call('debug_pause', { session_id: sid })) as Record<string, unknown>;

    expect(pause).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledWith();
    expect(result).toEqual({ ok: true, session_id: sid });
  });
});

// ---------------------------------------------------------------------------
// 3. BDP_THREAD_LOST pass-through
// ---------------------------------------------------------------------------

describe('BDP_THREAD_LOST pass-through', () => {
  it('debug_continue re-throws BDP_THREAD_LOST from session.resume', async () => {
    const err = fail('BDP_THREAD_LOST', 'thread terminated', { session_state: 'thread_terminated_other' });
    const resume = vi.fn().mockRejectedValue(err);
    const sid = registerFakeSession({ resume });

    await expect(
      call('debug_continue', { session_id: sid, thread_id: 1 }),
    ).rejects.toMatchObject({
      ok: false,
      code: 'BDP_THREAD_LOST',
      details: { session_state: 'thread_terminated_other' },
    });
  });

  it('debug_step re-throws BDP_THREAD_LOST from session.step', async () => {
    const err = fail('BDP_THREAD_LOST', 'thread terminated', { session_state: 'thread_terminated_other' });
    const step = vi.fn().mockRejectedValue(err);
    const sid = registerFakeSession({ step });

    await expect(
      call('debug_step', { session_id: sid, thread_id: 1 }),
    ).rejects.toMatchObject({
      ok: false,
      code: 'BDP_THREAD_LOST',
      details: { session_state: 'thread_terminated_other' },
    });
  });

  it('debug_pause re-throws BDP_THREAD_LOST from session.pause', async () => {
    const err = fail('BDP_THREAD_LOST', 'thread terminated', { session_state: 'thread_terminated_other' });
    const pause = vi.fn().mockRejectedValue(err);
    const sid = registerFakeSession({ pause });

    await expect(
      call('debug_pause', { session_id: sid }),
    ).rejects.toMatchObject({
      ok: false,
      code: 'BDP_THREAD_LOST',
      details: { session_state: 'thread_terminated_other' },
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Unknown session_id throws BDP_THREAD_LOST
// ---------------------------------------------------------------------------

describe('unknown session_id', () => {
  it('debug_continue throws BDP_THREAD_LOST for unknown session', async () => {
    await expect(
      call('debug_continue', { session_id: 'nonexistent', thread_id: 1 }),
    ).rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST' });
  });

  it('debug_step throws BDP_THREAD_LOST for unknown session', async () => {
    await expect(
      call('debug_step', { session_id: 'nonexistent', thread_id: 1 }),
    ).rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST' });
  });

  it('debug_step_over throws BDP_THREAD_LOST for unknown session', async () => {
    await expect(
      call('debug_step_over', { session_id: 'nonexistent', thread_id: 1 }),
    ).rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST' });
  });

  it('debug_step_out throws BDP_THREAD_LOST for unknown session', async () => {
    await expect(
      call('debug_step_out', { session_id: 'nonexistent', thread_id: 1 }),
    ).rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST' });
  });

  it('debug_pause throws BDP_THREAD_LOST for unknown session', async () => {
    await expect(
      call('debug_pause', { session_id: 'nonexistent' }),
    ).rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST' });
  });
});
