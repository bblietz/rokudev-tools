/**
 * In-process mock BDP TCP server for unit tests.
 *
 * Listens on an OS-assigned loopback port (port 0). Callers register typed
 * request handlers via `onRequest` and push async update events via
 * `emitEvent`. Used by T8+ tests so no real Roku device is needed.
 *
 * This file is intentionally inside `_internal/` and is NOT re-exported by
 * the package public surface (`bdp/index.ts` / `index.ts`). The existing
 * `tests/exports.test.ts` verifies this invariant automatically.
 *
 * Wire format reference: docs/refs/bdp-wire-format.md §1.
 */

import net from 'node:net';
import { encodeFrame, decodeFrame, HANDSHAKE_MAGIC } from '../frame.js';
import { decodeRequest, encodeResponseAs, encodeUpdateEvent } from '../wire-codec.js';
import type { BdpRequest, BdpResponse, BdpUpdateEvent } from '../messages.js';

// ---------------------------------------------------------------------------
// Handshake constants (doc §1.2)
// ---------------------------------------------------------------------------

// The client sends exactly 8 bytes: "bsdebug\0".
const HANDSHAKE_REQUEST_LENGTH = 8;

/**
 * Encode a HandshakeV3Response to write to the connecting client.
 *
 * Layout (doc §1.2):
 *   [magic: 7 bytes] [NUL: 1 byte]  (8 bytes total)
 *   [major: UInt32LE]               (4 bytes)
 *   [minor: UInt32LE]               (4 bytes)
 *   [patch: UInt32LE]               (4 bytes)
 *   [remaining_packet_length: UInt32LE]  (4 bytes -- counts bytes that follow)
 *   [revision_timestamp: BigUInt64LE]    (8 bytes)
 *
 * Total: 8 + 12 + 4 + 8 = 32 bytes.
 *
 * remaining_packet_length = 8 (the timestamp only).
 */
function encodeHandshakeV3Response(version: {
  major: number;
  minor: number;
  patch: number;
}): Buffer {
  const buf = Buffer.allocUnsafe(32);
  // magic (7 bytes) + NUL
  buf.write(HANDSHAKE_MAGIC, 0, 'utf8');
  buf[7] = 0x00;
  // version triple
  buf.writeUInt32LE(version.major, 8);
  buf.writeUInt32LE(version.minor, 12);
  buf.writeUInt32LE(version.patch, 16);
  // remaining_packet_length = 8 (timestamp field only)
  buf.writeUInt32LE(8, 20);
  // revision_timestamp: use current time in ms as BigUInt64LE
  buf.writeBigUInt64LE(BigInt(Date.now()), 24);
  return buf;
}

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

/**
 * A handler return value that wraps a BdpResponse with an optional wire-level
 * error_code.  When errorCode != 0 the client will receive a protocol-level
 * rejection (see BdpClient.onData), which BdpSession translates to a
 * BDP_THREAD_LOST failure with session_state: 'thread_terminated_other'.
 *
 * Used in T12 tests to simulate the device reporting that a thread is gone.
 */
export type MockResponseWrapper = {
  response: BdpResponse;
  errorCode: number;
};

type RequestHandler<K extends BdpRequest['kind']> = (
  req: Extract<BdpRequest, { kind: K }>,
) => BdpResponse | MockResponseWrapper | Promise<BdpResponse | MockResponseWrapper>;

export type MockBdpServer = {
  /** The TCP port the server is listening on (OS-assigned, in range 1-65535). */
  port: number;
  /**
   * Register a typed handler for a given request kind.
   * Replaces any previously registered handler for the same kind.
   *
   * The handler may return either a plain BdpResponse or a MockResponseWrapper
   * (which includes an errorCode).  A non-zero errorCode causes the mock to
   * send a real-wire response with that error_code, simulating a device-side
   * protocol error (e.g. thread-gone).
   */
  onRequest<K extends BdpRequest['kind']>(kind: K, handler: RequestHandler<K>): void;
  /**
   * Broadcast a typed update event to all currently connected clients.
   * Frames the event using `encodeUpdateEvent` and `encodeFrame`.
   */
  emitEvent(event: BdpUpdateEvent): void;
  /**
   * Override the BDP version advertised in the handshake response.
   * Useful for testing BDP_VERSION_UNSUPPORTED error paths.
   * Must be called before the client connects.
   */
  setHandshakeVersion(version: { major: number; minor: number; patch: number }): void;
  /** Destroy all active sockets and close the server. */
  stop(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export async function startMockBdpServer(opts: { port?: number } = {}): Promise<MockBdpServer> {
  // Map from request kind -> handler (holds a covariant cast: see onRequest).
  const handlers = new Map<
    BdpRequest['kind'],
    (
      req: BdpRequest,
    ) => BdpResponse | MockResponseWrapper | Promise<BdpResponse | MockResponseWrapper>
  >();

  // Handshake version advertised to clients. Default: v3.0.0.
  let handshakeVersion = { major: 3, minor: 0, patch: 0 };

  const sockets = new Set<net.Socket>();

  const server = net.createServer((sock) => {
    sockets.add(sock);
    let recvBuf = Buffer.alloc(0);
    let handshakeDone = false;

    sock.on('data', (chunk: Buffer) => {
      recvBuf = Buffer.concat([recvBuf, chunk]);

      // ----------------------------------------------------------------
      // Step 1: Consume the client's HandshakeRequest (8 bytes).
      // ----------------------------------------------------------------
      if (!handshakeDone) {
        if (recvBuf.length < HANDSHAKE_REQUEST_LENGTH) return;
        // Consume the 8-byte handshake request (we do not validate the magic
        // here -- if it were wrong the socket would be in a bad state, and
        // the test would fail naturally on the handshake response decode).
        recvBuf = recvBuf.subarray(HANDSHAKE_REQUEST_LENGTH);
        // Write the HandshakeV3Response using the current handshakeVersion.
        sock.write(encodeHandshakeV3Response(handshakeVersion));
        handshakeDone = true;
        // Fall through: remaining data (if any) may contain the first request frame.
      }

      // ----------------------------------------------------------------
      // Step 2: Standard frame loop.
      // ----------------------------------------------------------------
      // Wrap in void IIFE so we can use async/await without the data handler
      // returning a Promise (which net.Socket does not consume).
      void (async () => {
        while (true) {
          const frame = decodeFrame(recvBuf);
          if (!frame) break;
          recvBuf = recvBuf.subarray(frame.consumed);

          let decoded: ReturnType<typeof decodeRequest>;
          try {
            decoded = decodeRequest(frame.packetType, frame.payload);
          } catch {
            // Malformed frame -- silently skip (the test will fail naturally).
            continue;
          }

          const { req, requestId } = decoded;
          const handler = handlers.get(req.kind);
          if (!handler) continue;

          let handlerResult: BdpResponse | MockResponseWrapper;
          try {
            handlerResult = await handler(req);
          } catch {
            // Handler threw -- silently skip.
            continue;
          }

          // Unwrap MockResponseWrapper if the handler returned one.
          const res: BdpResponse =
            'errorCode' in handlerResult && 'response' in handlerResult
              ? (handlerResult as MockResponseWrapper).response
              : (handlerResult as BdpResponse);
          const wireErrorCode: number =
            'errorCode' in handlerResult && 'response' in handlerResult
              ? (handlerResult as MockResponseWrapper).errorCode
              : 0;

          let encoded: { packetType: number; payload: Buffer };
          try {
            encoded = encodeResponseAs(
              res.kind,
              res as Parameters<typeof encodeResponseAs>[1],
              requestId,
              wireErrorCode,
            );
          } catch {
            continue;
          }

          if (!sock.destroyed) {
            sock.write(encodeFrame(encoded.packetType, encoded.payload));
          }
        }
      })();
    });

    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => sockets.delete(sock));
  });

  // Listen on the requested port (0 = OS-assigned) on localhost.
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    port,

    onRequest<K extends BdpRequest['kind']>(kind: K, handler: RequestHandler<K>): void {
      // Cast to the widened handler type stored in the map.
      handlers.set(
        kind,
        handler as (
          req: BdpRequest,
        ) => BdpResponse | MockResponseWrapper | Promise<BdpResponse | MockResponseWrapper>,
      );
    },

    setHandshakeVersion(version: { major: number; minor: number; patch: number }): void {
      handshakeVersion = version;
    },

    emitEvent(event: BdpUpdateEvent): void {
      const encoded = encodeUpdateEvent(event);
      const frame = encodeFrame(encoded.packetType, encoded.payload);
      for (const s of sockets) {
        if (!s.destroyed) s.write(frame);
      }
    },

    async stop(): Promise<void> {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
