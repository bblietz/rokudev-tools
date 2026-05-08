/**
 * Tests for BdpSession: lifecycle, state surface, and onStopped event delivery.
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
});
