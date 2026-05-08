/**
 * Tests for BdpClient: TCP framing, handshake, request/response correlation,
 * async event delivery, and timeout/error handling.
 *
 * These tests use the in-process mock BDP server (T7) so no real Roku device
 * is needed. The mock server now uses real-wire-compatible encoding
 * (encodeResponseAs -- no embedded kind discriminator).
 */
import { describe, it, expect, afterEach } from 'vitest';
import net from 'node:net';
import { BdpClient, HANDSHAKE_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS } from './client.js';
import { SUPPORTED_BDP_VERSIONS } from './messages.js';
import type { BdpUpdateEvent } from './messages.js';
import { startMockBdpServer, type MockBdpServer } from './_internal/mock-bdp-server.js';

// ---------------------------------------------------------------------------
// Test lifecycle helpers
// ---------------------------------------------------------------------------

const teardowns: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const fn of teardowns.splice(0)) {
    await fn();
  }
});

async function startServer(): Promise<MockBdpServer> {
  const server = await startMockBdpServer();
  teardowns.push(() => server.stop());
  return server;
}

// ---------------------------------------------------------------------------
// T8-1: Constants exported
// ---------------------------------------------------------------------------

describe('BdpClient constants', () => {
  it('exports HANDSHAKE_TIMEOUT_MS = 5000', () => {
    expect(HANDSHAKE_TIMEOUT_MS).toBe(5000);
  });

  it('exports DEFAULT_REQUEST_TIMEOUT_MS = 30000', () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(30_000);
  });
});

// ---------------------------------------------------------------------------
// T8-2: Happy path -- handshake and bdpVersion
// ---------------------------------------------------------------------------

describe('BdpClient.connect', () => {
  it('handshakes and connects, exposing bdpVersion', async () => {
    const server = await startServer();
    const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS);
    teardowns.push(() => client.close());

    expect(client.bdpVersion).toEqual({ major: 3, minor: 0, patch: 0 });
  });

  // -------------------------------------------------------------------------
  // T8-3: BDP_ATTACH_FAILED on ECONNREFUSED
  // -------------------------------------------------------------------------

  it('throws BDP_ATTACH_FAILED with cause_code ECONNREFUSED when connection is refused', async () => {
    // Use port 1 -- guaranteed to be refused on any OS without root privileges.
    await expect(
      BdpClient.connect('127.0.0.1', 1 as 8081, SUPPORTED_BDP_VERSIONS),
    ).rejects.toMatchObject({
      ok: false,
      code: 'BDP_ATTACH_FAILED',
      stage: 'debug',
      details: { cause_code: 'ECONNREFUSED' },
    });
  });

  // -------------------------------------------------------------------------
  // T8-4: handshake_timeout when device accepts TCP but never sends handshake
  // -------------------------------------------------------------------------

  it('throws BDP_ATTACH_FAILED with reason handshake_timeout when device never sends handshake', async () => {
    const clientSockets = new Set<net.Socket>();
    const silent = net.createServer((s) => {
      clientSockets.add(s);
      s.on('close', () => clientSockets.delete(s));
    }); // accepts but never writes
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
    const port = (silent.address() as net.AddressInfo).port;
    teardowns.push(() => {
      for (const s of clientSockets) s.destroy();
      return new Promise<void>((r) => silent.close(() => r()));
    });

    await expect(
      BdpClient.connect('127.0.0.1', port as 8081, SUPPORTED_BDP_VERSIONS, { handshakeTimeoutMs: 100 }),
    ).rejects.toMatchObject({
      ok: false,
      code: 'BDP_ATTACH_FAILED',
      details: { reason: 'handshake_timeout' },
    });
  });

  // -------------------------------------------------------------------------
  // T8-5: BDP_VERSION_UNSUPPORTED when device version is outside supported range
  // -------------------------------------------------------------------------

  it('throws BDP_VERSION_UNSUPPORTED with details when device version is outside supported range', async () => {
    const server = await startServer();
    // Override handshake to report version 99.0.0 -- outside SUPPORTED_BDP_VERSIONS.
    server.setHandshakeVersion({ major: 99, minor: 0, patch: 0 });

    await expect(
      BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS),
    ).rejects.toMatchObject({
      ok: false,
      code: 'BDP_VERSION_UNSUPPORTED',
      stage: 'debug',
      details: {
        device_version: { major: 99, minor: 0, patch: 0 },
        supported_range: SUPPORTED_BDP_VERSIONS,
      },
    });
  });

  // -------------------------------------------------------------------------
  // T8-6: Min version boundary
  // -------------------------------------------------------------------------

  it('rejects BDP_VERSION_UNSUPPORTED when device version is below the minimum supported', async () => {
    const server = await startServer();
    // 0.9.0 is below min (1.0.0).
    server.setHandshakeVersion({ major: 0, minor: 9, patch: 0 });

    await expect(
      BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS),
    ).rejects.toMatchObject({
      ok: false,
      code: 'BDP_VERSION_UNSUPPORTED',
    });
  });

  // -------------------------------------------------------------------------
  // T8-7: Version at max boundary is accepted
  // -------------------------------------------------------------------------

  it('accepts the max supported version (3.2.0)', async () => {
    const server = await startServer();
    server.setHandshakeVersion({ major: 3, minor: 2, patch: 0 });

    const client = await BdpClient.connect(
      '127.0.0.1',
      server.port as 8081 | 8086,
      SUPPORTED_BDP_VERSIONS,
    );
    teardowns.push(() => client.close());
    expect(client.bdpVersion).toEqual({ major: 3, minor: 2, patch: 0 });
  });
});

// ---------------------------------------------------------------------------
// T8-8: Request/response correlation
// ---------------------------------------------------------------------------

describe('BdpClient.send', () => {
  it('correlates request/response by id and returns the correct payload', async () => {
    const server = await startServer();
    server.onRequest('threads', () => ({
      kind: 'threads',
      threads: [
        {
          id: 0,
          isPrimary: true,
          isDetached: false,
          stopReason: 'break' as const,
          stopReasonDetail: 'breakpoint',
          line: 10,
          functionName: 'main',
          file: 'pkg:/source/main.brs',
          codeSnippet: 'stop',
        },
      ],
    }));

    const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS);
    teardowns.push(() => client.close());

    const res = await client.send({ kind: 'threads' });
    expect(res.kind).toBe('threads');
    if (res.kind === 'threads') {
      expect(res.threads).toHaveLength(1);
      expect(res.threads[0]?.id).toBe(0);
      expect(res.threads[0]?.isPrimary).toBe(true);
      expect(res.threads[0]?.file).toBe('pkg:/source/main.brs');
    }
  });

  it('correlates multiple back-to-back requests to their correct responses', async () => {
    const server = await startServer();
    server.onRequest('pause', () => ({ kind: 'paused' }));
    server.onRequest('threads', () => ({ kind: 'threads', threads: [] }));

    const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS);
    teardowns.push(() => client.close());

    const [r1, r2] = await Promise.all([
      client.send({ kind: 'pause' }),
      client.send({ kind: 'threads' }),
    ]);

    expect(r1.kind).toBe('paused');
    expect(r2.kind).toBe('threads');
  });

  it('resolves a paused response correctly (no payload variant)', async () => {
    const server = await startServer();
    server.onRequest('pause', () => ({ kind: 'paused' }));

    const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS);
    teardowns.push(() => client.close());

    const res = await client.send({ kind: 'pause' });
    expect(res.kind).toBe('paused');
  });

  it('resolves a variables response with the full payload', async () => {
    const server = await startServer();
    server.onRequest('variables', () => ({
      kind: 'variables',
      variables: [
        { name: 'count', type: 'Integer', value: 42 },
      ],
    }));

    const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS);
    teardowns.push(() => client.close());

    const res = await client.send({ kind: 'variables', threadId: 0, frameIdx: 0 });
    expect(res.kind).toBe('variables');
    if (res.kind === 'variables') {
      expect(res.variables).toHaveLength(1);
      expect(res.variables[0]?.name).toBe('count');
      expect(res.variables[0]?.value).toBe(42);
    }
  });

  // -------------------------------------------------------------------------
  // T8-9: send() timeout
  // -------------------------------------------------------------------------

  it('throws BDP_THREAD_LOST when send() exceeds timeoutMs', async () => {
    const server = await startServer();
    // No handler registered -- server will silently drop the request.

    const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS);
    teardowns.push(() => client.close());

    await expect(
      client.send({ kind: 'threads' }, { timeoutMs: 80 }),
    ).rejects.toMatchObject({
      ok: false,
      code: 'BDP_THREAD_LOST',
      stage: 'debug',
      details: { session_state: 'connection_lost' },
    });
  });

  // -------------------------------------------------------------------------
  // T8-10: Socket close rejects all pending requests
  // -------------------------------------------------------------------------

  it('rejects all pending requests with BDP_THREAD_LOST when socket closes', async () => {
    const server = await startServer();
    // Do not register any handler -- the server will drop requests.

    const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS);
    teardowns.push(() => client.close());

    const pendingPromise = client.send({ kind: 'threads' }, { timeoutMs: 5000 });

    // Stop the server immediately after sending -- forces socket close.
    await server.stop();

    await expect(pendingPromise).rejects.toMatchObject({
      ok: false,
      code: 'BDP_THREAD_LOST',
      details: { session_state: 'connection_lost' },
    });
  });

  // -------------------------------------------------------------------------
  // T8-11: send() on closed client rejects immediately
  // -------------------------------------------------------------------------

  it('rejects immediately with BDP_THREAD_LOST when called on an already-closed client', async () => {
    const server = await startServer();
    const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS);
    client.close();

    await expect(client.send({ kind: 'pause' })).rejects.toMatchObject({
      ok: false,
      code: 'BDP_THREAD_LOST',
    });
  });
});

// ---------------------------------------------------------------------------
// T8-12: Async event delivery
// ---------------------------------------------------------------------------

describe('BdpClient.onEvent', () => {
  it('delivers async compile_error events to registered listeners', async () => {
    const server = await startServer();
    const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS);
    teardowns.push(() => client.close());

    const received = await new Promise<BdpUpdateEvent>((resolve) => {
      client.onEvent((evt) => resolve(evt));
      server.emitEvent({
        kind: 'compile_error',
        message: 'Syntax error',
        file: 'pkg:/source/main.brs',
        line: 5,
        libraryName: '',
      });
    });

    expect(received.kind).toBe('compile_error');
    if (received.kind === 'compile_error') {
      expect(received.message).toBe('Syntax error');
      expect(received.file).toBe('pkg:/source/main.brs');
      expect(received.line).toBe(5);
    }
  });

  it('delivers async stopped events to registered listeners', async () => {
    const server = await startServer();
    const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS);
    teardowns.push(() => client.close());

    const received = await new Promise<BdpUpdateEvent>((resolve) => {
      client.onEvent((evt) => resolve(evt));
      server.emitEvent({
        kind: 'stopped',
        threadId: 0,
        stopReason: 'break',
        stopReasonDetail: 'breakpoint hit',
      });
    });

    expect(received.kind).toBe('stopped');
    if (received.kind === 'stopped') {
      expect(received.threadId).toBe(0);
      expect(received.stopReason).toBe('break');
    }
  });

  it('delivers events to multiple listeners', async () => {
    const server = await startServer();
    const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS);
    teardowns.push(() => client.close());

    const events: BdpUpdateEvent[] = [];
    client.onEvent((e) => events.push(e));
    client.onEvent((e) => events.push(e));

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
      server.emitEvent({ kind: 'protocol_error' });
    });

    // Both listeners should have received the event.
    expect(events.filter((e) => e.kind === 'protocol_error')).toHaveLength(2);
  });

  it('delivers io_port_opened events correctly', async () => {
    const server = await startServer();
    const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, SUPPORTED_BDP_VERSIONS);
    teardowns.push(() => client.close());

    const received = await new Promise<BdpUpdateEvent>((resolve) => {
      client.onEvent((evt) => resolve(evt));
      server.emitEvent({ kind: 'io_port_opened', port: 8080 });
    });

    expect(received.kind).toBe('io_port_opened');
    if (received.kind === 'io_port_opened') {
      expect(received.port).toBe(8080);
    }
  });
});
