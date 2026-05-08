/**
 * BdpSession: higher-level session lifecycle on top of BdpClient.
 *
 * Implements the read-only state surface specified in spec §4.5.5 (T10).
 * Subsequent tasks (T11-T14) layer on operational methods (breakpoints,
 * execution control, introspection, variables/eval).
 *
 * State transitions
 * -----------------
 * live -> connection_lost  when the BDP socket closes (either because
 *                          detach() was called or the socket dropped).
 * live -> channel_exited   deferred -- no clean wire-protocol signal for
 *                          channel exit exists in BDP v1-v3. The type is
 *                          retained in the union for future use and for
 *                          type-safety in T11+ mocks.
 *
 * Concern: the BDP wire format has no dedicated 'channel exited' update event.
 * The AllThreadsStopped event with stopReason='normal_exit' is the closest
 * signal, but it may also fire during legitimate debugging stops when the user
 * manually exits. Transitioning to 'channel_exited' on that stopReason is
 * risky without real-device confirmation. Left as a deferred refinement task.
 */

import { fail } from '../errors/index.js';
import { BdpClient, SUPPORTED_BDP_VERSIONS as _defaultVersions } from './client.js';
import type { BdpVersion, BdpVersionRange } from './messages.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Observable state of a BdpSession.
 *
 * 'thread_terminated_other' is a per-thread concept surfaced only in
 * details.session_state of operation failures targeting a dead thread
 * (see T12). It is never assigned to BdpSession.state itself.
 */
export type BdpSessionState = 'live' | 'channel_exited' | 'connection_lost';

/** Payload delivered to onStopped listeners. */
export type BdpStoppedEvent = {
  threadId: number;
  reason: string;
  file?: string;
  line?: number;
};

// ---------------------------------------------------------------------------
// BdpSession
// ---------------------------------------------------------------------------

export class BdpSession {
  /** Device IP or hostname captured at attach time. */
  readonly host: string;

  /** BDP protocol version negotiated during handshake. */
  readonly bdpVersion: BdpVersion;

  /** Observable session state. Starts 'live' and transitions on close. */
  private _state: BdpSessionState = 'live';

  /** Underlying low-level client. */
  private client: BdpClient;

  /** Whether detach() has already been called (for idempotency guard). */
  private detached = false;

  /** Registered onStopped listeners. */
  private stoppedListeners: Array<(e: BdpStoppedEvent) => void> = [];

  // Private constructor -- use BdpSession.attach() to create instances.
  private constructor(host: string, client: BdpClient) {
    this.host = host;
    this.client = client;
    this.bdpVersion = client.bdpVersion;

    // Wire client events to session state and listener dispatch.
    client.onEvent((evt) => {
      if (evt.kind === 'stopped') {
        const payload: BdpStoppedEvent = {
          threadId: evt.threadId,
          reason: evt.stopReason,
          // file and line are NOT part of the AllThreadsStopped wire payload
          // (doc §2.5); they are available only via a subsequent Threads or
          // StackTrace request. Omit them here.
        };
        for (const listener of this.stoppedListeners) {
          listener(payload);
        }
      }
    });

    // Transition to connection_lost when the underlying socket closes.
    client.onClose(() => {
      if (this._state === 'live') {
        this._state = 'connection_lost';
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Static factory
  // ---------------------------------------------------------------------------

  /**
   * Connect to a Roku device's BDP port, perform the handshake, and return
   * an initialized BdpSession.
   *
   * Calls BdpClient.connectWithFallback(host, supportedVersions, opts).
   *
   * @param host               - Device IP or hostname.
   * @param supportedVersions  - BDP version range the client accepts (defaults
   *                             to SUPPORTED_BDP_VERSIONS if omitted).
   * @param opts               - Optional connect options forwarded to
   *                             BdpClient.connectWithFallback. The `_primaryPort`
   *                             and `_fallbackPort` keys are test hooks only.
   *
   * @throws Failure(BDP_ATTACH_FAILED)       when TCP connect or handshake fails.
   * @throws Failure(BDP_VERSION_UNSUPPORTED) when device BDP version is outside
   *                                          the accepted range.
   */
  static async attach(
    host: string,
    supportedVersions?: BdpVersionRange,
    opts?: {
      handshakeTimeoutMs?: number;
      /** Test hook: override primary port (default 8081). Do not use in production. */
      _primaryPort?: number;
      /** Test hook: override fallback port (default 8086). Do not use in production. */
      _fallbackPort?: number;
    },
  ): Promise<BdpSession> {
    const versions = supportedVersions ?? _defaultVersions;
    const client = await BdpClient.connectWithFallback(host, versions, opts ?? {});
    return new BdpSession(host, client);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Current observable state of this session. */
  get state(): BdpSessionState {
    return this._state;
  }

  /**
   * Close the underlying BDP connection and transition state to
   * 'connection_lost'. Idempotent -- safe to call multiple times.
   */
  detach(): void {
    if (this.detached) return;
    this.detached = true;
    // close() on BdpClient triggers socket.destroy(), which emits 'close',
    // which calls handleSocketClose(), which calls our onClose listener,
    // which sets this._state = 'connection_lost'. The detached guard above
    // ensures we don't register a second listener or double-close.
    this.client.close();
    // In the unlikely case the socket was already destroyed before detach()
    // (e.g., the server stopped), handleSocketClose already fired and set the
    // state. Unconditionally set here for safety.
    if (this._state === 'live') {
      this._state = 'connection_lost';
    }
  }

  /**
   * Register a listener that fires when all threads stop (e.g. breakpoint hit,
   * STOP statement, runtime error). May be called multiple times; all listeners
   * are invoked in registration order.
   */
  onStopped(listener: (e: BdpStoppedEvent) => void): void {
    this.stoppedListeners.push(listener);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Guard used by every operational method added in T11-T14.
   * Throws Failure(BDP_THREAD_LOST) if the session is not in 'live' state.
   *
   * Not called by any public method in T10 -- declared here so T11-T14 can
   * layer operational methods on top without further structural changes.
   */
  private guardLive(): void {
    if (this._state !== 'live') {
      throw fail(
        'BDP_THREAD_LOST',
        `BDP session is in state '${this._state}'`,
        { session_state: this._state },
      );
    }
  }
}
