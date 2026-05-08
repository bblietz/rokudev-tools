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
});
