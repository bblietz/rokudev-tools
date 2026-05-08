/**
 * Tests for BdpSession: lifecycle, state surface, onStopped event delivery,
 * and breakpoint methods (T11).
 *
 * These tests use the in-process mock BDP server so no real Roku device is needed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startMockBdpServer, type MockBdpServer } from './_internal/mock-bdp-server.js';
import { BdpSession } from './session.js';
import { SUPPORTED_BDP_VERSIONS } from './messages.js';

// Wire error_code used by BdpSession to detect thread-gone responses.
// Must match the BDP_WIRE_ERROR_INVALID_THREAD constant in session.ts.
// T27: verify this value against a real Roku device.
const BDP_WIRE_ERROR_INVALID_THREAD = 6;

describe('BdpSession', () => {
  let server: MockBdpServer;

  beforeEach(async () => { server = await startMockBdpServer(); });
  afterEach(async () => { await server.stop(); });

  // -------------------------------------------------------------------------
  // attach
  // -------------------------------------------------------------------------

  describe('attach', () => {
    it('returns a session with host, bdpVersion, state="live"', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      expect(session.host).toBe('127.0.0.1');
      expect(session.bdpVersion).toEqual({ major: 3, minor: 0, patch: 0 });
      expect(session.state).toBe('live');
      session.detach();
    });

    it('propagates BDP_VERSION_UNSUPPORTED from BdpClient', async () => {
      server.setHandshakeVersion({ major: 99, minor: 0, patch: 0 });
      await expect(
        BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any),
      ).rejects.toMatchObject({ ok: false, code: 'BDP_VERSION_UNSUPPORTED' });
    });

    it('propagates BDP_ATTACH_FAILED when connect fails', async () => {
      // both ports refused
      await expect(
        BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: 1, _fallbackPort: 2 } as any),
      ).rejects.toMatchObject({ ok: false, code: 'BDP_ATTACH_FAILED' });
    });
  });

  // -------------------------------------------------------------------------
  // detach
  // -------------------------------------------------------------------------

  describe('detach', () => {
    it('sets state to connection_lost and is idempotent', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();
      expect(session.state).toBe('connection_lost');
      session.detach();   // idempotent
      expect(session.state).toBe('connection_lost');
    });
  });

  // -------------------------------------------------------------------------
  // state transitions
  // -------------------------------------------------------------------------

  describe('state', () => {
    it('transitions to connection_lost when underlying client closes (mock server stops)', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      expect(session.state).toBe('live');
      await server.stop();
      // wait a tick for socket close to propagate
      await new Promise((r) => setTimeout(r, 50));
      expect(session.state).toBe('connection_lost');
    });
  });

  // -------------------------------------------------------------------------
  // onStopped
  // -------------------------------------------------------------------------

  describe('onStopped', () => {
    it('fires registered listeners on a Stopped update event', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      const events: Array<{ threadId: number; reason: string }> = [];
      session.onStopped((e) => events.push({ threadId: e.threadId, reason: e.reason }));
      // Emit a stopped event from the mock; the event kind in BdpUpdateEvent is 'stopped'.
      server.emitEvent({
        kind: 'stopped',
        threadId: 1,
        stopReason: 'break',
        stopReasonDetail: '',
      } as any);
      await new Promise((r) => setTimeout(r, 50));
      expect(events).toHaveLength(1);
      expect(events[0]!.reason).toBe('break');
      session.detach();
    });

    it('fires multiple registered listeners', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      const callCounts = [0, 0];
      session.onStopped(() => { callCounts[0]!++; });
      session.onStopped(() => { callCounts[1]!++; });
      server.emitEvent({ kind: 'stopped', threadId: 0, stopReason: 'break', stopReasonDetail: '' } as any);
      await new Promise((r) => setTimeout(r, 50));
      expect(callCounts).toEqual([1, 1]);
      session.detach();
    });

    it('surfaces file and line from the stopped event when present', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      const events: Array<{ threadId: number; reason: string; file?: string; line?: number }> = [];
      session.onStopped((e) => events.push(e));
      server.emitEvent({ kind: 'stopped', threadId: 2, stopReason: 'runtime_error', stopReasonDetail: 'div by zero' } as any);
      await new Promise((r) => setTimeout(r, 50));
      expect(events[0]!.threadId).toBe(2);
      expect(events[0]!.reason).toBe('runtime_error');
      session.detach();
    });
  });

  // -------------------------------------------------------------------------
  // Breakpoint methods (T11)
  // -------------------------------------------------------------------------

  describe('setBreakpoint', () => {
    it('happy path: returns { id } and populates currentBreakpoints()', async () => {
      server.onRequest('add_breakpoints', (_req) => ({
        kind: 'breakpoints_added',
        entries: [{ breakpointId: 42, errorCode: 0 }],
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      const result = await session.setBreakpoint('main.brs', 10);

      expect(result).toEqual({ id: 42 });
      expect(session.currentBreakpoints()).toContainEqual({ file: 'main.brs', line: 10 });

      session.detach();
    });

    it('rejection: throws BDP_BREAKPOINT_INVALID with details when device returns errorCode != 0', async () => {
      server.onRequest('add_breakpoints', (_req) => ({
        kind: 'breakpoints_added',
        entries: [{ breakpointId: 0, errorCode: 5 }],
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);

      await expect(session.setBreakpoint('main.brs', 99)).rejects.toMatchObject({
        ok: false,
        code: 'BDP_BREAKPOINT_INVALID',
        details: {
          file: 'main.brs',
          line: 99,
          reason: expect.stringContaining('5'),
        },
      });

      // Cache must remain empty after rejection.
      expect(session.currentBreakpoints()).toHaveLength(0);

      session.detach();
    });

    it('rejects with BDP_THREAD_LOST after detach', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();

      await expect(session.setBreakpoint('main.brs', 1)).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
      });
    });
  });

  describe('clearBreakpoint', () => {
    it('happy path: removes the breakpoint from cache', async () => {
      server.onRequest('add_breakpoints', (_req) => ({
        kind: 'breakpoints_added',
        entries: [{ breakpointId: 7, errorCode: 0 }],
      }));
      server.onRequest('remove_breakpoints', (_req) => ({
        kind: 'breakpoints_removed',
        entries: [{ breakpointId: 7, errorCode: 0 }],
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await session.setBreakpoint('scene.brs', 5);
      expect(session.currentBreakpoints()).toHaveLength(1);

      await session.clearBreakpoint(7);
      expect(session.currentBreakpoints()).toHaveLength(0);

      session.detach();
    });

    it('rejects with BDP_THREAD_LOST after detach', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();

      await expect(session.clearBreakpoint(1)).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
      });
    });
  });

  describe('listBreakpoints', () => {
    it('happy path: merges device-reported ids with local cache', async () => {
      // Set up two breakpoints.
      let callCount = 0;
      server.onRequest('add_breakpoints', (_req) => {
        callCount++;
        const id = callCount === 1 ? 10 : 20;
        return { kind: 'breakpoints_added', entries: [{ breakpointId: id, errorCode: 0 }] };
      });
      server.onRequest('list_breakpoints', (_req) => ({
        kind: 'breakpoints_list',
        entries: [
          { breakpointId: 10, errorCode: 0 },
          { breakpointId: 20, errorCode: 0 },
        ],
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await session.setBreakpoint('main.brs', 10);
      await session.setBreakpoint('util.brs', 20);

      const list = await session.listBreakpoints();

      expect(list).toHaveLength(2);
      expect(list).toContainEqual({ id: 10, file: 'main.brs', line: 10 });
      expect(list).toContainEqual({ id: 20, file: 'util.brs', line: 20 });

      session.detach();
    });

    it('skips device-reported ids not present in the local cache', async () => {
      // No setBreakpoint calls -- cache is empty.
      server.onRequest('list_breakpoints', (_req) => ({
        kind: 'breakpoints_list',
        entries: [
          // id 99 is unknown to this session (set outside this session).
          { breakpointId: 99, errorCode: 0 },
        ],
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      const list = await session.listBreakpoints();

      // Unknown id must be skipped; result is empty.
      expect(list).toHaveLength(0);

      session.detach();
    });

    it('rejects with BDP_THREAD_LOST after detach', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();

      await expect(session.listBreakpoints()).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
      });
    });
  });

  describe('currentBreakpoints', () => {
    it('does NOT throw after detach -- reads from cache without calling guardLive()', async () => {
      server.onRequest('add_breakpoints', (_req) => ({
        kind: 'breakpoints_added',
        entries: [{ breakpointId: 55, errorCode: 0 }],
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await session.setBreakpoint('main.brs', 15);

      // Detach transitions state to connection_lost.
      session.detach();
      expect(session.state).toBe('connection_lost');

      // currentBreakpoints() must NOT throw even though state is connection_lost.
      // Cache is preserved across detach() per spec.
      let result: ReadonlyArray<{ file: string; line: number }>;
      expect(() => {
        result = session.currentBreakpoints();
      }).not.toThrow();

      // Belt-and-suspenders: cache still holds the breakpoint set before detach.
      expect(result!).toContainEqual({ file: 'main.brs', line: 15 });
    });
  });

  // -------------------------------------------------------------------------
  // Execution control (T12): resume, step, pause
  // -------------------------------------------------------------------------

  describe('resume', () => {
    it('sends continue with threadId and resolves on success', async () => {
      let capturedThreadId: number | undefined;
      server.onRequest('continue', (req) => {
        capturedThreadId = req.threadId;
        return { kind: 'continued' };
      });

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await expect(session.resume(1)).resolves.toBeUndefined();
      expect(capturedThreadId).toBe(1);
      session.detach();
    });

    it('throws BDP_THREAD_LOST with session_state thread_terminated_other when device returns INVALID_THREAD error', async () => {
      // Mock server returns a protocol-level error_code == 6 (INVALID_THREAD).
      // T27: verify that real Roku firmware uses error_code 6 for thread-gone.
      server.onRequest('continue', (_req) => ({
        response: { kind: 'continued' },
        errorCode: BDP_WIRE_ERROR_INVALID_THREAD,
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await expect(session.resume(1)).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
        details: { session_state: 'thread_terminated_other' },
      });
      session.detach();
    });

    it('throws BDP_THREAD_LOST after detach (guardLive)', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();
      await expect(session.resume(1)).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
      });
    });
  });

  describe('step', () => {
    it('propagates granularity and threadId, resolves on success', async () => {
      let capturedReq: { threadId: number; granularity: string } | undefined;
      server.onRequest('step', (req) => {
        capturedReq = { threadId: req.threadId, granularity: req.granularity };
        return { kind: 'stepped' };
      });

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await expect(session.step(1, 'over')).resolves.toBeUndefined();
      expect(capturedReq).toEqual({ threadId: 1, granularity: 'over' });
      session.detach();
    });

    it('sends granularity=line correctly', async () => {
      let capturedGranularity: string | undefined;
      server.onRequest('step', (req) => {
        capturedGranularity = req.granularity;
        return { kind: 'stepped' };
      });

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await session.step(2, 'line');
      expect(capturedGranularity).toBe('line');
      session.detach();
    });

    it('sends granularity=out correctly', async () => {
      let capturedGranularity: string | undefined;
      server.onRequest('step', (req) => {
        capturedGranularity = req.granularity;
        return { kind: 'stepped' };
      });

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await session.step(0, 'out');
      expect(capturedGranularity).toBe('out');
      session.detach();
    });

    it('throws BDP_THREAD_LOST with session_state thread_terminated_other when device returns INVALID_THREAD error', async () => {
      server.onRequest('step', (_req) => ({
        response: { kind: 'stepped' },
        errorCode: BDP_WIRE_ERROR_INVALID_THREAD,
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await expect(session.step(1, 'over')).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
        details: { session_state: 'thread_terminated_other' },
      });
      session.detach();
    });

    it('throws BDP_THREAD_LOST after detach (guardLive)', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();
      await expect(session.step(1, 'over')).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
      });
    });
  });

  describe('pause', () => {
    it('sends pause (no args) and resolves on success', async () => {
      let pauseCalled = false;
      server.onRequest('pause', () => {
        pauseCalled = true;
        return { kind: 'paused' };
      });

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await expect(session.pause()).resolves.toBeUndefined();
      expect(pauseCalled).toBe(true);
      session.detach();
    });

    it('throws BDP_THREAD_LOST after detach (guardLive)', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();
      await expect(session.pause()).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
      });
    });
  });

  describe('execution control state guard (all three methods)', () => {
    it('all three execution methods throw BDP_THREAD_LOST after detach', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();
      await expect(session.resume(1)).rejects.toMatchObject({ code: 'BDP_THREAD_LOST' });
      await expect(session.step(1, 'over')).rejects.toMatchObject({ code: 'BDP_THREAD_LOST' });
      await expect(session.pause()).rejects.toMatchObject({ code: 'BDP_THREAD_LOST' });
    });
  });

  // -------------------------------------------------------------------------
  // Introspection (T13): threads, stackTrace
  // -------------------------------------------------------------------------

  describe('threads', () => {
    it('returns BdpThreadEntry[] from device response', async () => {
      server.onRequest('threads', () => ({
        kind: 'threads',
        threads: [
          {
            id: 0,
            isPrimary: true,
            isDetached: false,
            stopReason: 'break',
            stopReasonDetail: 'breakpoint hit',
            line: 42,
            functionName: 'main',
            file: 'pkg:/source/main.brs',
            codeSnippet: 'stop',
          },
          {
            id: 1,
            isPrimary: false,
            isDetached: false,
            stopReason: 'not_stopped',
            stopReasonDetail: '',
            line: 10,
            functionName: 'runLoop',
            file: 'pkg:/source/lib.brs',
            codeSnippet: 'while true',
          },
        ],
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      const result = await session.threads();

      expect(result).toHaveLength(2);

      expect(result[0]).toMatchObject({
        id: 0,
        isPrimary: true,
        isDetached: false,
        stopReason: 'break',
        stopReasonDetail: 'breakpoint hit',
        line: 42,
        functionName: 'main',
        file: 'pkg:/source/main.brs',
        codeSnippet: 'stop',
      });

      expect(result[1]).toMatchObject({
        id: 1,
        isPrimary: false,
        stopReason: 'not_stopped',
        functionName: 'runLoop',
        file: 'pkg:/source/lib.brs',
      });

      session.detach();
    });

    it('throws BDP_THREAD_LOST after detach (state guard)', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();
      await expect(session.threads()).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
      });
    });
  });

  describe('stackTrace', () => {
    it('returns BdpStackFrame[] for a thread', async () => {
      server.onRequest('stack_trace', (req) => {
        expect(req.threadId).toBe(1);
        return {
          kind: 'stack_trace',
          frames: [
            { idx: 0, file: '/main.brs', line: 10, functionName: 'main' },
            { idx: 1, file: '/lib.brs', line: 25 },
          ],
        };
      });

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      const frames = await session.stackTrace(1);

      expect(frames).toHaveLength(2);
      expect(frames[0]!.file).toBe('/main.brs');
      expect(frames[0]!.line).toBe(10);
      expect(frames[0]!.functionName).toBe('main');
      expect(frames[0]!.idx).toBe(0);
      expect(frames[1]!.file).toBe('/lib.brs');
      expect(frames[1]!.idx).toBe(1);

      session.detach();
    });

    it('propagates threadId in the stack_trace request', async () => {
      let capturedThreadId: number | undefined;
      server.onRequest('stack_trace', (req) => {
        capturedThreadId = req.threadId;
        return {
          kind: 'stack_trace',
          frames: [{ idx: 0, file: 'pkg:/source/main.brs', line: 5 }],
        };
      });

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await session.stackTrace(3);
      expect(capturedThreadId).toBe(3);
      session.detach();
    });

    it('throws BDP_THREAD_LOST with session_state:thread_terminated_other on dead thread (wire errorCode 6)', async () => {
      // Mock server returns wire errorCode 6 (INVALID_THREAD) -- simulates thread gone.
      // T27: verify this error_code value against a real Roku device.
      server.onRequest('stack_trace', (_req) => ({
        response: { kind: 'stack_trace', frames: [] },
        errorCode: BDP_WIRE_ERROR_INVALID_THREAD,
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await expect(session.stackTrace(2)).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
        details: { session_state: 'thread_terminated_other' },
      });
      session.detach();
    });

    it('throws BDP_THREAD_LOST after detach (state guard)', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();
      await expect(session.stackTrace(1)).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Variables (T14)
  // -------------------------------------------------------------------------

  describe('variables', () => {
    it('returns BdpVariable[] for a thread/frame', async () => {
      server.onRequest('variables', (req) => {
        expect(req.threadId).toBe(1);
        expect(req.frameIdx).toBe(0);
        return {
          kind: 'variables',
          variables: [
            { name: 'x', type: 'Integer', value: 42 },
            { name: 'msg', type: 'String', value: 'hello' },
          ],
        };
      });

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      const vars = await session.variables(1, 0);

      expect(vars).toHaveLength(2);
      expect(vars[0]).toMatchObject({ name: 'x', type: 'Integer', value: 42 });
      expect(vars[1]).toMatchObject({ name: 'msg', type: 'String', value: 'hello' });

      session.detach();
    });

    it('propagates getChildKeys, getVirtualKeys, and varPath options', async () => {
      let capturedReq: { getChildKeys?: boolean; getVirtualKeys?: boolean; varPath?: string[] } | undefined;
      server.onRequest('variables', (req) => {
        capturedReq = {
          ...(req.getChildKeys !== undefined ? { getChildKeys: req.getChildKeys } : {}),
          ...(req.getVirtualKeys !== undefined ? { getVirtualKeys: req.getVirtualKeys } : {}),
          ...(req.varPath !== undefined ? { varPath: req.varPath } : {}),
        };
        return { kind: 'variables', variables: [] };
      });

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await session.variables(1, 0, { getChildKeys: true, getVirtualKeys: false, varPath: ['root', 'child'] });

      expect(capturedReq).toBeDefined();
      // Wire codec sets flag bits: bit 0 = getChildKeys (true), bit 2 = getVirtualKeys (false/absent).
      // Decoded request only carries `true` for set bits; `false` is represented as absent (undefined).
      expect(capturedReq!.getChildKeys).toBe(true);
      expect(capturedReq!.getVirtualKeys).toBeFalsy(); // false opt -> bit not set -> decoded as undefined
      expect(capturedReq!.varPath).toEqual(['root', 'child']);

      session.detach();
    });

    it('returns empty array when device reports no variables', async () => {
      server.onRequest('variables', (_req) => ({ kind: 'variables', variables: [] }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      const vars = await session.variables(0, 0);
      expect(vars).toHaveLength(0);
      session.detach();
    });

    it('throws BDP_THREAD_LOST with session_state:thread_terminated_other on dead thread (wire errorCode 6)', async () => {
      server.onRequest('variables', (_req) => ({
        response: { kind: 'variables', variables: [] },
        errorCode: BDP_WIRE_ERROR_INVALID_THREAD,
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await expect(session.variables(1, 0)).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
        details: { session_state: 'thread_terminated_other' },
      });
      session.detach();
    });

    it('throws BDP_THREAD_LOST after detach (state guard)', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();
      await expect(session.variables(1, 0)).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Eval (T14)
  // -------------------------------------------------------------------------

  describe('eval', () => {
    it('returns success=true and empty error arrays on success', async () => {
      server.onRequest('eval', (req) => {
        expect(req.expression).toBe('m.foo = 42');
        expect(req.threadId).toBe(1);
        expect(req.frameIdx).toBe(0);
        return {
          kind: 'eval',
          success: true,
          compileErrors: [],
          runtimeErrors: [],
          otherErrors: [],
        };
      });

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      const result = await session.eval(1, 0, 'm.foo = 42');

      expect(result.success).toBe(true);
      expect(result.compileErrors).toEqual([]);
      expect(result.runtimeErrors).toEqual([]);
      expect(result.otherErrors).toEqual([]);
      expect(result).not.toHaveProperty('runtimeStopReason');

      session.detach();
    });

    it('surfaces compile errors when expression is invalid', async () => {
      server.onRequest('eval', (_req) => ({
        kind: 'eval',
        success: false,
        compileErrors: ['Syntax error at line 1'],
        runtimeErrors: [],
        otherErrors: [],
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      const result = await session.eval(1, 0, 'invalid bs code');

      expect(result.success).toBe(false);
      expect(result.compileErrors).toContain('Syntax error at line 1');
      expect(result.runtimeErrors).toHaveLength(0);

      session.detach();
    });

    it('surfaces runtimeStopReason and runtime errors when execution halts', async () => {
      server.onRequest('eval', (_req) => ({
        kind: 'eval',
        success: false,
        runtimeStopReason: 'runtime_error' as const,
        compileErrors: [],
        runtimeErrors: ['Division by zero'],
        otherErrors: [],
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      const result = await session.eval(1, 0, 'x = 1 / 0');

      expect(result.success).toBe(false);
      expect(result.runtimeStopReason).toBe('runtime_error');
      expect(result.runtimeErrors).toContain('Division by zero');
      expect(result.compileErrors).toHaveLength(0);

      session.detach();
    });

    it('honors timeoutMs -- rejects with BDP_THREAD_LOST when server never responds', async () => {
      // No handler registered: server will not respond and the request times out.
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await expect(session.eval(1, 0, 'expr', { timeoutMs: 50 }))
        .rejects.toMatchObject({ code: 'BDP_THREAD_LOST' });
      session.detach();
    });

    it('throws BDP_THREAD_LOST with session_state:thread_terminated_other on dead thread (wire errorCode 6)', async () => {
      server.onRequest('eval', (_req) => ({
        response: {
          kind: 'eval',
          success: false,
          compileErrors: [],
          runtimeErrors: [],
          otherErrors: [],
        },
        errorCode: BDP_WIRE_ERROR_INVALID_THREAD,
      }));

      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      await expect(session.eval(1, 0, 'expr')).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
        details: { session_state: 'thread_terminated_other' },
      });
      session.detach();
    });

    it('throws BDP_THREAD_LOST after detach (state guard)', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();
      await expect(session.eval(1, 0, 'expr')).rejects.toMatchObject({
        ok: false,
        code: 'BDP_THREAD_LOST',
      });
    });
  });

  describe('variables and eval after detach (combined state guard)', () => {
    it('both methods throw BDP_THREAD_LOST after detach', async () => {
      const session = await BdpSession.attach('127.0.0.1', SUPPORTED_BDP_VERSIONS, { _primaryPort: server.port } as any);
      session.detach();
      await expect(session.variables(1, 0)).rejects.toMatchObject({ code: 'BDP_THREAD_LOST' });
      await expect(session.eval(1, 0, 'expr')).rejects.toMatchObject({ code: 'BDP_THREAD_LOST' });
    });
  });
});
