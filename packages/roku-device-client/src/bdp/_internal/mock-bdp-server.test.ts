/**
 * Tests for the in-process mock BDP TCP server.
 *
 * Exercises the handshake exchange, request routing, update-event broadcast,
 * and back-to-back request sequencing over a real loopback TCP socket.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import { startMockBdpServer, type MockBdpServer } from './mock-bdp-server.js';
import {
  encodeFrame,
  decodeFrame,
  encodeHandshakeRequest,
  decodeHandshakeResponse,
} from '../frame.js';
import {
  encodeRequest,
  decodeResponseAs,
  encodeUpdateEvent,
  decodeUpdateEvent,
  isUpdateEventPacket,
} from '../wire-codec.js';
import type { BdpResponse, BdpThreadEntry } from '../messages.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Connect a raw TCP socket to the mock server and return it.
 * The returned socket is in raw data mode (no encoding set).
 */
async function connectSocket(port: number): Promise<net.Socket> {
  const sock = net.connect(port, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    sock.once('connect', resolve);
    sock.once('error', reject);
  });
  return sock;
}

/**
 * Perform the handshake exchange on an already-connected socket.
 * Sends the HandshakeRequest and returns the decoded HandshakeResponse.
 */
async function doHandshake(sock: net.Socket): Promise<ReturnType<typeof decodeHandshakeResponse>> {
  sock.write(encodeHandshakeRequest());
  const data = await new Promise<Buffer>((resolve) => sock.once('data', (b: Buffer) => resolve(b)));
  return decodeHandshakeResponse(data);
}

/**
 * Collect the next data chunk from the socket as a Buffer.
 */
function nextChunk(sock: net.Socket): Promise<Buffer> {
  return new Promise<Buffer>((resolve) => sock.once('data', (b: Buffer) => resolve(b)));
}

/**
 * Send a request frame and wait for the response frame, then decode it.
 *
 * `expectedKind` must match the response kind the server will return.
 * Since the mock server now uses real-wire encoding (no kind discriminator),
 * the caller must provide the expected kind explicitly.
 */
async function sendAndReceive<K extends BdpResponse['kind']>(
  sock: net.Socket,
  req: Parameters<typeof encodeRequest>[0],
  requestId: number,
  expectedKind: K,
): Promise<{ res: Extract<BdpResponse, { kind: K }>; requestId: number }> {
  const { packetType, payload } = encodeRequest(req, requestId);
  sock.write(encodeFrame(packetType, payload));
  const buf = await nextChunk(sock);
  const frame = decodeFrame(buf);
  if (!frame) throw new Error('sendAndReceive: incomplete frame in response');
  const { res } = decodeResponseAs(expectedKind, frame.payload);
  return { res, requestId: frame.packetType };
}

// A minimal but complete BdpThreadEntry for use in test handlers.
const THREAD_ENTRY: BdpThreadEntry = {
  id: 0,
  isPrimary: true,
  isDetached: false,
  stopReason: 'break',
  stopReasonDetail: 'hit breakpoint',
  line: 10,
  functionName: 'main',
  file: 'pkg:/source/main.brs',
  codeSnippet: 'stop',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mock BDP server', () => {
  let server: MockBdpServer;

  beforeEach(async () => {
    server = await startMockBdpServer();
  });

  afterEach(async () => {
    await server.stop();
  });

  // -------------------------------------------------------------------------
  // T7-1: Server starts and exposes a port
  // -------------------------------------------------------------------------

  it('starts and exposes a valid port number', () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.port).toBeLessThanOrEqual(65535);
  });

  // -------------------------------------------------------------------------
  // T7-2: Handshake
  // -------------------------------------------------------------------------

  it('handshakes a connecting client and returns a v3 HandshakeResponse', async () => {
    const sock = await connectSocket(server.port);
    try {
      const handshake = await doHandshake(sock);
      expect(handshake).not.toBeNull();
      expect(handshake?.major).toBe(3);
      expect(handshake?.minor).toBe(0);
      expect(handshake?.patch).toBe(0);
      expect(handshake?.isV3).toBe(true);
      // v3 response must include a revision timestamp
      expect(typeof handshake?.revisionTimestamp).toBe('bigint');
    } finally {
      sock.destroy();
    }
  });

  it('accepts multiple independent client connections', async () => {
    const s1 = await connectSocket(server.port);
    const s2 = await connectSocket(server.port);
    try {
      const h1 = await doHandshake(s1);
      const h2 = await doHandshake(s2);
      expect(h1?.isV3).toBe(true);
      expect(h2?.isV3).toBe(true);
    } finally {
      s1.destroy();
      s2.destroy();
    }
  });

  // -------------------------------------------------------------------------
  // T7-3: Request routing and response
  // -------------------------------------------------------------------------

  it('routes a registered threads request to its handler and returns the response', async () => {
    server.onRequest('threads', () => ({
      kind: 'threads',
      threads: [THREAD_ENTRY],
    }));

    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);
      const { res, requestId } = await sendAndReceive(sock, { kind: 'threads' }, 1, 'threads');
      expect(requestId).toBe(1);
      expect(res.kind).toBe('threads');
      if (res.kind === 'threads') {
        expect(res.threads).toHaveLength(1);
        expect(res.threads[0]).toEqual(THREAD_ENTRY);
      }
    } finally {
      sock.destroy();
    }
  });

  it('routes a registered pause request to its handler and returns the response', async () => {
    server.onRequest('pause', () => ({ kind: 'paused' }));

    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);
      const { res, requestId } = await sendAndReceive(sock, { kind: 'pause' }, 42, 'paused');
      expect(requestId).toBe(42);
      expect(res.kind).toBe('paused');
    } finally {
      sock.destroy();
    }
  });

  it('routes a registered stack_trace request with correct threadId', async () => {
    server.onRequest('stack_trace', (req) => {
      expect(req.threadId).toBe(2);
      return {
        kind: 'stack_trace',
        frames: [
          { idx: 0, file: 'pkg:/source/main.brs', line: 5, functionName: 'main' },
        ],
      };
    });

    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);
      const { res } = await sendAndReceive(sock, { kind: 'stack_trace', threadId: 2 }, 7, 'stack_trace');
      expect(res.kind).toBe('stack_trace');
      if (res.kind === 'stack_trace') {
        expect(res.frames).toHaveLength(1);
        expect(res.frames[0]?.functionName).toBe('main');
      }
    } finally {
      sock.destroy();
    }
  });

  it('ignores requests for which no handler is registered', async () => {
    // Do NOT register a handler -- the server should silently drop the request.
    // We verify the server does not crash by sending a second registered request.
    server.onRequest('pause', () => ({ kind: 'paused' }));

    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);

      // Send an unhandled threads request
      const { packetType: pt1, payload: p1 } = encodeRequest({ kind: 'threads' }, 10);
      sock.write(encodeFrame(pt1, p1));

      // Immediately send a handled pause request
      const { res, requestId } = await sendAndReceive(sock, { kind: 'pause' }, 11, 'paused');
      expect(requestId).toBe(11);
      expect(res.kind).toBe('paused');
    } finally {
      sock.destroy();
    }
  });

  it('preserves requestId faithfully across different request IDs', async () => {
    server.onRequest('pause', () => ({ kind: 'paused' }));

    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);
      for (const id of [1, 99, 0xdeadbeef]) {
        const { requestId } = await sendAndReceive(sock, { kind: 'pause' }, id, 'paused');
        expect(requestId).toBe(id);
      }
    } finally {
      sock.destroy();
    }
  });

  // -------------------------------------------------------------------------
  // T7-4: Async update events
  // -------------------------------------------------------------------------

  it('broadcasts emitted compile_error events to connected clients', async () => {
    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);

      server.emitEvent({
        kind: 'compile_error',
        file: '/pkg:/source/main.brs',
        line: 1,
        message: 'oops',
        libraryName: '',
      });

      const buf = await nextChunk(sock);
      const frame = decodeFrame(buf);
      expect(frame).not.toBeNull();
      if (!frame) return;
      expect(isUpdateEventPacket(frame.packetType)).toBe(true);
      const evt = decodeUpdateEvent(frame.packetType, frame.payload);
      expect(evt.kind).toBe('compile_error');
      if (evt.kind === 'compile_error') {
        expect(evt.message).toBe('oops');
        expect(evt.file).toBe('/pkg:/source/main.brs');
        expect(evt.line).toBe(1);
        expect(evt.libraryName).toBe('');
      }
    } finally {
      sock.destroy();
    }
  });

  it('broadcasts emitted stopped events to connected clients', async () => {
    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);

      server.emitEvent({
        kind: 'stopped',
        threadId: 0,
        stopReason: 'break',
        stopReasonDetail: 'breakpoint hit',
      });

      const buf = await nextChunk(sock);
      const frame = decodeFrame(buf);
      expect(frame).not.toBeNull();
      if (!frame) return;
      expect(isUpdateEventPacket(frame.packetType)).toBe(true);
      const evt = decodeUpdateEvent(frame.packetType, frame.payload);
      expect(evt.kind).toBe('stopped');
      if (evt.kind === 'stopped') {
        expect(evt.threadId).toBe(0);
        expect(evt.stopReason).toBe('break');
        expect(evt.stopReasonDetail).toBe('breakpoint hit');
      }
    } finally {
      sock.destroy();
    }
  });

  it('broadcasts emitted io_port_opened events to connected clients', async () => {
    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);

      server.emitEvent({ kind: 'io_port_opened', port: 8080 });

      const buf = await nextChunk(sock);
      const frame = decodeFrame(buf);
      expect(frame).not.toBeNull();
      if (!frame) return;
      expect(isUpdateEventPacket(frame.packetType)).toBe(true);
      const evt = decodeUpdateEvent(frame.packetType, frame.payload);
      expect(evt.kind).toBe('io_port_opened');
      if (evt.kind === 'io_port_opened') {
        expect(evt.port).toBe(8080);
      }
    } finally {
      sock.destroy();
    }
  });

  it('broadcasts events to all connected clients simultaneously', async () => {
    const s1 = await connectSocket(server.port);
    const s2 = await connectSocket(server.port);
    try {
      await doHandshake(s1);
      await doHandshake(s2);

      server.emitEvent({ kind: 'protocol_error' });

      const [b1, b2] = await Promise.all([nextChunk(s1), nextChunk(s2)]);
      const f1 = decodeFrame(b1);
      const f2 = decodeFrame(b2);
      expect(f1).not.toBeNull();
      expect(f2).not.toBeNull();
      if (!f1 || !f2) return;
      const e1 = decodeUpdateEvent(f1.packetType, f1.payload);
      const e2 = decodeUpdateEvent(f2.packetType, f2.payload);
      expect(e1.kind).toBe('protocol_error');
      expect(e2.kind).toBe('protocol_error');
    } finally {
      s1.destroy();
      s2.destroy();
    }
  });

  // -------------------------------------------------------------------------
  // T7-5: Back-to-back requests on a single connection
  // -------------------------------------------------------------------------

  it('handles back-to-back requests on a single connection and preserves order', async () => {
    server.onRequest('pause', () => ({ kind: 'paused' }));
    server.onRequest('threads', () => ({ kind: 'threads', threads: [] }));

    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);

      // Send two requests back-to-back without waiting between them.
      const { packetType: pt1, payload: p1 } = encodeRequest({ kind: 'pause' }, 1);
      const { packetType: pt2, payload: p2 } = encodeRequest({ kind: 'threads' }, 2);
      sock.write(Buffer.concat([encodeFrame(pt1, p1), encodeFrame(pt2, p2)]));

      // Read both responses. Due to TCP stream framing each response is a
      // separate write from the server, but they may arrive in one or two
      // data events. We collect them by accumulating a buffer and extracting
      // frames until we have two.
      const frames: ReturnType<typeof decodeFrame>[] = [];
      let accumBuf = Buffer.alloc(0);
      while (frames.length < 2) {
        const chunk = await nextChunk(sock);
        accumBuf = Buffer.concat([accumBuf, chunk]);
        let decoded = decodeFrame(accumBuf);
        while (decoded) {
          frames.push(decoded);
          accumBuf = accumBuf.subarray(decoded.consumed);
          decoded = decodeFrame(accumBuf);
        }
      }

      expect(frames).toHaveLength(2);
      // The mock now uses real-wire encoding: correlate frames by their requestId
      // (packetType) to determine which kind to decode with.
      const frame1 = frames[0]!;
      const frame2 = frames[1]!;
      // Frame 1 has requestId=1 (pause -> paused), frame 2 has requestId=2 (threads -> threads).
      const r1 = { res: decodeResponseAs('paused', frame1.payload).res, requestId: frame1.packetType };
      const r2 = { res: decodeResponseAs('threads', frame2.payload).res, requestId: frame2.packetType };
      expect(r1.requestId).toBe(1);
      expect(r1.res.kind).toBe('paused');
      expect(r2.requestId).toBe(2);
      expect(r2.res.kind).toBe('threads');
    } finally {
      sock.destroy();
    }
  });

  it('handles three sequential requests with correct requestIds', async () => {
    server.onRequest('pause', () => ({ kind: 'paused' }));

    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);
      const { requestId: id1 } = await sendAndReceive(sock, { kind: 'pause' }, 100, 'paused');
      const { requestId: id2 } = await sendAndReceive(sock, { kind: 'pause' }, 200, 'paused');
      const { requestId: id3 } = await sendAndReceive(sock, { kind: 'pause' }, 300, 'paused');
      expect(id1).toBe(100);
      expect(id2).toBe(200);
      expect(id3).toBe(300);
    } finally {
      sock.destroy();
    }
  });

  // -------------------------------------------------------------------------
  // T7-6: LongInteger round-trip (XXX(T7-mock-server-verify))
  // -------------------------------------------------------------------------

  it('round-trips a variables response containing a LongInteger through the mock server', async () => {
    server.onRequest('variables', () => ({
      kind: 'variables',
      variables: [
        {
          name: 'bigNum',
          type: 'LongInteger',
          value: Number.MAX_SAFE_INTEGER,
        },
        {
          name: 'negNum',
          type: 'LongInteger',
          value: -1,
        },
      ],
    }));

    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);
      const { res } = await sendAndReceive(
        sock,
        { kind: 'variables', threadId: 0, frameIdx: 0 },
        5,
        'variables',
      );
      expect(res.kind).toBe('variables');
      if (res.kind === 'variables') {
        expect(res.variables).toHaveLength(2);
        const first = res.variables[0];
        const second = res.variables[1];
        expect(first?.name).toBe('bigNum');
        expect(first?.type).toBe('LongInteger');
        expect(first?.value).toBe(Number.MAX_SAFE_INTEGER);
        expect(second?.name).toBe('negNum');
        expect(second?.value).toBe(-1);
      }
    } finally {
      sock.destroy();
    }
  });

  // -------------------------------------------------------------------------
  // T7-7: Async handler
  // -------------------------------------------------------------------------

  it('supports async request handlers that resolve after a tick', async () => {
    server.onRequest('pause', async () => {
      await new Promise<void>((r) => setImmediate(r));
      return { kind: 'paused' };
    });

    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);
      const { res } = await sendAndReceive(sock, { kind: 'pause' }, 77, 'paused');
      expect(res.kind).toBe('paused');
    } finally {
      sock.destroy();
    }
  });

  // -------------------------------------------------------------------------
  // T7-8: Clean stop
  // -------------------------------------------------------------------------

  it('stop() resolves cleanly even when no clients are connected', async () => {
    // No clients -- just stop the server.
    await expect(server.stop()).resolves.toBeUndefined();
    // Re-create a replacement so afterEach stop() does not fail.
    server = await startMockBdpServer();
  });

  it('stop() closes active client sockets', async () => {
    const sock = await connectSocket(server.port);
    // The 'close' event passes `hadError: boolean` -- wrap to normalize.
    const closedPromise = new Promise<void>((resolve) => sock.once('close', () => resolve()));
    await doHandshake(sock);
    await server.stop();
    await expect(closedPromise).resolves.toBeUndefined();
    // Re-create a replacement so afterEach does not fail.
    server = await startMockBdpServer();
  });

  // -------------------------------------------------------------------------
  // T7-9: Breakpoint-related round-trip through mock server
  // -------------------------------------------------------------------------

  it('routes an add_breakpoints request and returns a breakpoints_added response', async () => {
    server.onRequest('add_breakpoints', (req) => ({
      kind: 'breakpoints_added',
      entries: req.breakpoints.map((_, i) => ({
        breakpointId: i + 1,
        errorCode: 0,
        ignoreCount: 0,
      })),
    }));

    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);
      const { res } = await sendAndReceive(
        sock,
        {
          kind: 'add_breakpoints',
          breakpoints: [
            { file: 'pkg:/source/main.brs', line: 5 },
            { file: 'pkg:/source/util.brs', line: 10, ignoreCount: 3 },
          ],
        },
        9,
        'breakpoints_added',
      );
      expect(res.kind).toBe('breakpoints_added');
      if (res.kind === 'breakpoints_added') {
        expect(res.entries).toHaveLength(2);
        expect(res.entries[0]?.breakpointId).toBe(1);
        expect(res.entries[1]?.breakpointId).toBe(2);
      }
    } finally {
      sock.destroy();
    }
  });

  // -------------------------------------------------------------------------
  // T7-10: Eval (Execute) round-trip
  // -------------------------------------------------------------------------

  it('routes an eval request and returns an eval response', async () => {
    server.onRequest('eval', (req) => {
      expect(req.expression).toBe('print m.count');
      return {
        kind: 'eval',
        success: true,
        compileErrors: [],
        runtimeErrors: [],
        otherErrors: [],
      };
    });

    const sock = await connectSocket(server.port);
    try {
      await doHandshake(sock);
      const { res } = await sendAndReceive(
        sock,
        { kind: 'eval', threadId: 0, frameIdx: 0, expression: 'print m.count' },
        15,
        'eval',
      );
      expect(res.kind).toBe('eval');
      if (res.kind === 'eval') {
        expect(res.success).toBe(true);
        expect(res.compileErrors).toHaveLength(0);
      }
    } finally {
      sock.destroy();
    }
  });
});
