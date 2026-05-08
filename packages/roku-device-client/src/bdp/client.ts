/**
 * BdpClient: low-level production BDP TCP client.
 *
 * Owns a TCP socket, runs the handshake, implements standard-frame
 * framing/buffering, request/response correlation by request_id, and
 * async event delivery to registered listeners.
 *
 * Wire format reference: docs/refs/bdp-wire-format.md.
 *
 * Design notes
 * ------------
 * - Response decoding uses real-wire format (decodeResponseAs): the client
 *   maintains a pending-request map keyed by request_id that stores the
 *   expected response kind. When a frame arrives, the kind is looked up and
 *   used to drive decoding -- no embedded kind discriminator needed.
 * - BdpSession (T10+) layers higher-level state (thread tracking, breakpoints,
 *   etc.) on top of BdpClient.
 * - close() is idempotent. After close(), send() rejects immediately.
 */

import net from 'node:net';
import { fail } from '../errors/index.js';
import {
  encodeFrame,
  decodeFrame,
  encodeHandshakeRequest,
  decodeHandshakeResponse,
} from './frame.js';
import {
  encodeRequest,
  decodeResponseAs,
  decodeUpdateEvent,
  isUpdateEventPacket,
} from './wire-codec.js';
import type {
  BdpRequest,
  BdpResponse,
  BdpUpdateEvent,
  BdpVersion,
  BdpVersionRange,
} from './messages.js';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Default time to wait for the BDP handshake response after TCP connects. */
export const HANDSHAKE_TIMEOUT_MS = 5000;

/** Default per-request timeout for send(). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type PendingEntry = {
  kind: BdpResponse['kind'];
  resolve: (v: BdpResponse) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

// ---------------------------------------------------------------------------
// BdpClient
// ---------------------------------------------------------------------------

export class BdpClient {
  /** Receive buffer -- accumulates partial frames from the TCP stream. */
  private buf = Buffer.alloc(0);

  /** Monotonically increasing request ID counter. Starts at 1. */
  private nextReqId = 1;

  /** Pending request map: request_id -> { kind, resolve, reject, timer }. */
  private pending = new Map<number, PendingEntry>();

  /** Registered async event listeners. */
  private listeners: Array<(e: BdpUpdateEvent) => void> = [];

  /** Registered close listeners -- called once when the underlying socket closes. */
  private closeListeners: Array<() => void> = [];

  /** True after close() has been called (or after socket close). */
  private closed = false;

  private constructor(
    private readonly socket: net.Socket,
    public readonly bdpVersion: BdpVersion,
  ) {
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('close', () => this.handleSocketClose());
    // Suppress unhandled 'error' events -- handleSocketClose() handles cleanup.
    socket.on('error', () => {
      /* close path handles cleanup */
    });
  }

  // ---------------------------------------------------------------------------
  // Static factory
  // ---------------------------------------------------------------------------

  /**
   * Connect to a Roku device's BDP port, perform the handshake, and return
   * an initialized BdpClient.
   *
   * @param host               - Device IP or hostname.
   * @param port               - BDP port (8081 or 8086).
   * @param supportedVersions  - Version range the client accepts.
   * @param opts.handshakeTimeoutMs - How long to wait for handshake bytes (default 5000).
   *
   * @throws Failure with code BDP_ATTACH_FAILED when TCP connect or handshake fails.
   * @throws Failure with code BDP_VERSION_UNSUPPORTED when device BDP version is
   *         outside the accepted range.
   */
  static async connect(
    host: string,
    port: 8081 | 8086,
    supportedVersions: BdpVersionRange,
    opts: { handshakeTimeoutMs?: number } = {},
  ): Promise<BdpClient> {
    const handshakeTimeoutMs = opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;

    // -----------------------------------------------------------------------
    // Step 1: TCP connect
    // -----------------------------------------------------------------------
    const sock = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(port, host);
      const onErr = (e: unknown) => {
        s.destroy();
        const causeCode = (e as { code?: string }).code;
        reject(
          fail(
            'BDP_ATTACH_FAILED',
            `BDP connect ${host}:${port} failed: ${e instanceof Error ? e.message : String(e)}`,
            { host, port, cause_code: causeCode },
          ),
        );
      };
      s.once('connect', () => {
        s.off('error', onErr);
        resolve(s);
      });
      s.once('error', onErr);
    });

    // -----------------------------------------------------------------------
    // Step 2: Send handshake request then race for response vs. timeout
    // -----------------------------------------------------------------------
    sock.write(encodeHandshakeRequest());

    let handshakeResult: { version: BdpVersion };
    try {
      handshakeResult = await Promise.race<{ version: BdpVersion }>([
        readHandshakeBytes(sock),
        new Promise<never>((_, rej) =>
          setTimeout(() => {
            sock.destroy();
            rej(
              fail(
                'BDP_ATTACH_FAILED',
                `BDP handshake to ${host}:${port} timed out after ${handshakeTimeoutMs}ms`,
                { host, port, reason: 'handshake_timeout' },
              ),
            );
          }, handshakeTimeoutMs),
        ),
      ]);
    } catch (e) {
      // Ensure the socket is closed if we errored (e.g. remote closed early).
      if (!sock.destroyed) sock.destroy();
      throw e;
    }

    // -----------------------------------------------------------------------
    // Step 3: Validate device BDP version against supportedVersions
    // -----------------------------------------------------------------------
    const dev = handshakeResult.version;
    if (!isVersionInRange(dev, supportedVersions)) {
      sock.destroy();
      throw fail(
        'BDP_VERSION_UNSUPPORTED',
        `Device speaks BDP v${formatVersion(dev)}; client supports ${formatVersion(supportedVersions.min)}-${formatVersion(supportedVersions.max)}`,
        { device_version: dev, supported_range: supportedVersions },
      );
    }

    return new BdpClient(sock, dev);
  }

  // ---------------------------------------------------------------------------
  // Static factory: port-fallback variant
  // ---------------------------------------------------------------------------

  /**
   * Attempt to connect to port 8081. If the TCP connection is refused
   * (ECONNREFUSED), fall back to port 8086. Any other error is re-thrown
   * immediately without trying the fallback port.
   *
   * Per spec §4.5.1: some Roku firmwares serve BDP on 8086 rather than 8081.
   *
   * @param host               - Device IP or hostname.
   * @param supportedVersions  - Version range the client accepts.
   * @param opts.handshakeTimeoutMs - How long to wait for handshake bytes (default 5000).
   * @param opts._primaryPort  - Override the primary port (test hook only, default 8081).
   * @param opts._fallbackPort - Override the fallback port (test hook only, default 8086).
   *
   * @throws Failure(BDP_ATTACH_FAILED) if both ports are refused or handshake fails.
   * @throws Failure(BDP_VERSION_UNSUPPORTED) if the device speaks an unsupported version.
   */
  static async connectWithFallback(
    host: string,
    supportedVersions: BdpVersionRange,
    opts: {
      handshakeTimeoutMs?: number;
      /** Test hook: override primary port (default 8081). Do not use in production. */
      _primaryPort?: number;
      /** Test hook: override fallback port (default 8086). Do not use in production. */
      _fallbackPort?: number;
    } = {},
  ): Promise<BdpClient> {
    const primaryPort = opts._primaryPort ?? 8081;
    const fallbackPort = opts._fallbackPort ?? 8086;
    const connectOpts = {
      ...(opts.handshakeTimeoutMs !== undefined
        ? { handshakeTimeoutMs: opts.handshakeTimeoutMs }
        : {}),
    };

    try {
      return await BdpClient.connect(
        host,
        primaryPort as 8081 | 8086,
        supportedVersions,
        connectOpts,
      );
    } catch (e: unknown) {
      const failure = e as { code?: string; details?: { cause_code?: string } };
      if (failure.code === 'BDP_ATTACH_FAILED' && failure.details?.cause_code === 'ECONNREFUSED') {
        return BdpClient.connect(host, fallbackPort as 8081 | 8086, supportedVersions, connectOpts);
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Send a BDP request and return a promise that resolves with the correlated
   * response.
   *
   * @param request         - The BDP command to send.
   * @param opts.timeoutMs  - Per-request timeout (default DEFAULT_REQUEST_TIMEOUT_MS).
   *
   * @throws Failure(BDP_THREAD_LOST) on timeout or socket close.
   */
  send(request: BdpRequest, opts: { timeoutMs?: number } = {}): Promise<BdpResponse> {
    if (this.closed) {
      return Promise.reject(
        fail('BDP_THREAD_LOST', 'BdpClient is closed', { session_state: 'connection_lost' }),
      );
    }

    const id = this.nextReqId++;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const kind = expectedResponseKind(request);

    return new Promise<BdpResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          fail(
            'BDP_THREAD_LOST',
            `BDP request ${request.kind}#${id} timed out after ${timeoutMs}ms`,
            { session_state: 'connection_lost' },
          ),
        );
      }, timeoutMs);

      this.pending.set(id, { kind, resolve, reject, timer });

      try {
        const { packetType, payload } = encodeRequest(request, id);
        this.socket.write(encodeFrame(packetType, payload));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  /**
   * Register a listener for async BDP update events (server-pushed, request_id == 0).
   *
   * Multiple listeners may be registered; all are called for each event in
   * registration order.
   */
  onEvent(listener: (event: BdpUpdateEvent) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Register a listener that fires exactly once when the underlying TCP socket
   * closes (either because close() was called or the socket dropped).
   *
   * Used by BdpSession (T10) to transition state to 'connection_lost'.
   */
  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  /**
   * Close the underlying TCP socket and reject all pending requests.
   * Idempotent -- safe to call multiple times.
   */
  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.drainPending();
    }
    if (!this.socket.destroyed) {
      this.socket.destroy();
    }
  }

  // ---------------------------------------------------------------------------
  // Private socket event handlers
  // ---------------------------------------------------------------------------

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);

    while (true) {
      const decoded = decodeFrame(this.buf);
      if (!decoded) break;
      this.buf = this.buf.subarray(decoded.consumed);

      if (isUpdateEventPacket(decoded.packetType)) {
        // Async update event (request_id == 0).
        try {
          const evt = decodeUpdateEvent(decoded.packetType, decoded.payload);
          for (const listener of this.listeners) {
            listener(evt);
          }
        } catch {
          // Malformed event -- ignore; do not crash the client.
        }
        continue;
      }

      // Correlated response (request_id == packetType).
      const requestId = decoded.packetType;
      const pending = this.pending.get(requestId);
      if (!pending) continue; // stale or unknown frame -- ignore

      clearTimeout(pending.timer);
      this.pending.delete(requestId);

      try {
        const { res, errorCode } = decodeResponseAs(pending.kind, decoded.payload);
        if (errorCode !== 0) {
          // Non-zero response-level error_code means the device rejected the
          // request at the protocol level (e.g. thread no longer exists).
          // Reject with BDP_THREAD_LOST and embed the raw wire error_code so
          // BdpSession can translate it to the appropriate session_state.
          pending.reject(
            fail(
              'BDP_THREAD_LOST',
              `BDP device returned error_code ${errorCode} for ${pending.kind} response`,
              { bdp_error_code: errorCode, session_state: 'connection_lost' as const },
            ),
          );
        } else {
          pending.resolve(res);
        }
      } catch (e) {
        pending.reject(e);
      }
    }
  }

  private handleSocketClose(): void {
    if (!this.closed) {
      this.closed = true;
    }
    this.drainPending();
    for (const listener of this.closeListeners) {
      listener();
    }
    this.closeListeners = [];
  }

  /**
   * Reject all pending requests with BDP_THREAD_LOST. Clears the pending map.
   */
  private drainPending(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(
        fail('BDP_THREAD_LOST', 'BDP socket closed unexpectedly', {
          session_state: 'connection_lost',
        }),
      );
    }
    this.pending.clear();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Accumulate bytes from a socket until decodeHandshakeResponse returns a
 * non-null result, then resolve with the decoded version.
 *
 * This handles the case where the handshake bytes arrive in multiple TCP
 * segments (uncommon for local sockets, but correct per TCP framing).
 */
function readHandshakeBytes(sock: net.Socket): Promise<{ version: BdpVersion }> {
  return new Promise((resolve, reject) => {
    let accumulated = Buffer.alloc(0);

    const onData = (chunk: Buffer) => {
      accumulated = Buffer.concat([accumulated, chunk]);
      const decoded = decodeHandshakeResponse(accumulated);
      if (decoded) {
        sock.off('data', onData);
        sock.off('error', onError);
        resolve({ version: { major: decoded.major, minor: decoded.minor, patch: decoded.patch } });
      }
    };

    const onError = (e: Error) => {
      sock.off('data', onData);
      sock.off('error', onError);
      reject(e);
    };

    sock.on('data', onData);
    sock.once('error', onError);
  });
}

/**
 * Map each BdpRequest['kind'] to the BdpResponse['kind'] that the device will
 * reply with. Used to populate the pending-request map before sending.
 */
function expectedResponseKind(req: BdpRequest): BdpResponse['kind'] {
  switch (req.kind) {
    case 'pause':
      return 'paused';
    case 'continue':
      return 'continued';
    case 'step':
      return 'stepped';
    case 'threads':
      return 'threads';
    case 'stack_trace':
      return 'stack_trace';
    case 'variables':
      return 'variables';
    case 'eval':
      return 'eval';
    case 'add_breakpoints':
      return 'breakpoints_added';
    case 'add_conditional_breakpoints':
      return 'conditional_breakpoints_added';
    case 'set_exception_breakpoints':
      return 'exception_breakpoints_set';
    case 'remove_breakpoints':
      return 'breakpoints_removed';
    case 'list_breakpoints':
      return 'breakpoints_list';
    case 'exit_channel':
      return 'exited';
    case 'connect':
      // 'connect' uses the handshake frame, not send(). This should never
      // be reached from send() but TypeScript requires exhaustive handling.
      throw new Error(
        `BdpClient.send: 'connect' kind is not a valid send() request; use BdpClient.connect()`,
      );
    default: {
      const exhaustive: never = req;
      throw new Error(`BdpClient: unknown request kind: ${(exhaustive as BdpRequest).kind}`);
    }
  }
}

function isVersionInRange(v: BdpVersion, r: BdpVersionRange): boolean {
  return compareVersion(v, r.min) >= 0 && compareVersion(v, r.max) <= 0;
}

function compareVersion(a: BdpVersion, b: BdpVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function formatVersion(v: BdpVersion): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}
