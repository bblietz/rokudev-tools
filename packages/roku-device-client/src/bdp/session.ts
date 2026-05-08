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
import type { BdpVersion, BdpVersionRange, BdpBreakpointEntry, BdpThreadEntry, BdpStackFrame, BdpVariable, BdpStopReason } from './messages.js';

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
// Breakpoint cache key type
// ---------------------------------------------------------------------------

/** Composite key for breakpoint cache: `${file}:${line}`. */
type BpKey = string;

/** Shape of each cached breakpoint entry. */
type BpCacheEntry = { id: number; file: string; line: number };

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

  /**
   * Local breakpoint cache keyed by `${file}:${line}`.
   *
   * Populated by setBreakpoint(), removed by clearBreakpoint().
   * Intentionally preserved across detach() so that currentBreakpoints()
   * returns the last-known snapshot even after the connection is gone
   * (the MCP detach handler reads this before or after detach() -- both safe).
   */
  private breakpoints: Map<BpKey, BpCacheEntry> = new Map();

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
  // Breakpoint methods (T11)
  // ---------------------------------------------------------------------------

  /**
   * Set a breakpoint at the given (file, line).
   *
   * Sends an `add_breakpoints` request with one entry and returns the
   * assigned breakpoint ID on success. The entry is stored in the local
   * cache so that `listBreakpoints()` and `currentBreakpoints()` can return
   * full `{ id, file, line }` triples (the device's `list_breakpoints`
   * response only carries IDs, not the original file/line).
   *
   * @throws Failure(BDP_THREAD_LOST)         if the session is not live.
   * @throws Failure(BDP_BREAKPOINT_INVALID)  if the device rejects the breakpoint (errorCode != 0).
   */
  async setBreakpoint(file: string, line: number): Promise<{ id: number }> {
    this.guardLive();

    const res = await this.client.send({
      kind: 'add_breakpoints',
      breakpoints: [{ file, line }],
    });

    if (res.kind !== 'breakpoints_added') {
      throw fail('BDP_BREAKPOINT_INVALID', `Unexpected response kind '${res.kind}' for add_breakpoints`, { file, line });
    }

    const entry = res.entries[0] as BdpBreakpointEntry | undefined;
    if (entry === undefined) {
      throw fail('BDP_BREAKPOINT_INVALID', 'Device returned no breakpoint entries', { file, line, reason: 'empty_response' });
    }

    if (entry.errorCode !== 0) {
      throw fail(
        'BDP_BREAKPOINT_INVALID',
        `Device rejected breakpoint at ${file}:${line} (errorCode ${entry.errorCode})`,
        { file, line, reason: `error_code:${entry.errorCode}` },
      );
    }

    const key: BpKey = `${file}:${line}`;
    this.breakpoints.set(key, { id: entry.breakpointId, file, line });
    return { id: entry.breakpointId };
  }

  /**
   * Clear a previously-set breakpoint by its ID.
   *
   * Sends a `remove_breakpoints` request and removes the entry from the
   * local cache on success.
   *
   * @throws Failure(BDP_THREAD_LOST) if the session is not live.
   */
  async clearBreakpoint(id: number): Promise<void> {
    this.guardLive();

    await this.client.send({
      kind: 'remove_breakpoints',
      ids: [id],
    });

    // Remove the entry from cache by searching for matching id.
    for (const [key, entry] of this.breakpoints) {
      if (entry.id === id) {
        this.breakpoints.delete(key);
        break;
      }
    }
  }

  /**
   * Query the device for active breakpoints and merge with the local cache
   * to produce `{ id, file, line }` triples.
   *
   * The device's `list_breakpoints` response returns only breakpoint IDs
   * (no file/line). This method merges the device-reported IDs with the
   * local cache to produce full triples. Entries reported by the device
   * whose IDs are not in the cache (i.e., set outside this session) are
   * silently skipped -- we do not fabricate file/line we don't know.
   *
   * @throws Failure(BDP_THREAD_LOST) if the session is not live.
   */
  async listBreakpoints(): Promise<Array<{ id: number; file: string; line: number }>> {
    this.guardLive();

    const res = await this.client.send({ kind: 'list_breakpoints' });

    if (res.kind !== 'breakpoints_list') {
      throw fail('BDP_THREAD_LOST', `Unexpected response kind '${res.kind}' for list_breakpoints`, { session_state: this._state });
    }

    // Build a reverse lookup: id -> cache entry.
    const byId = new Map<number, BpCacheEntry>();
    for (const entry of this.breakpoints.values()) {
      byId.set(entry.id, entry);
    }

    const result: Array<{ id: number; file: string; line: number }> = [];
    for (const entry of res.entries) {
      const cached = byId.get(entry.breakpointId);
      if (cached !== undefined) {
        result.push({ id: cached.id, file: cached.file, line: cached.line });
      }
      // Entries not in cache are skipped -- we don't know their file/line.
    }
    return result;
  }

  /**
   * Return a snapshot of the currently-known active breakpoints from the
   * local cache.
   *
   * CRITICAL: This method does NOT call guardLive(). It is a pure cache read
   * and is safe to call up to and including the moment detach() returns, so
   * the MCP detach handler (T20) can always read the snapshot before closing
   * the connection. The cache is preserved across detach() for this reason.
   *
   * Returns `{ file, line }` pairs only (no IDs); callers that need IDs
   * should use `listBreakpoints()` while the session is still live.
   */
  currentBreakpoints(): ReadonlyArray<{ file: string; line: number }> {
    return Array.from(this.breakpoints.values()).map(({ file, line }) => ({ file, line }));
  }

  // ---------------------------------------------------------------------------
  // Execution control methods (T12)
  // ---------------------------------------------------------------------------

  /**
   * Resume (continue) a stopped thread.
   *
   * Sends a `continue` request for `threadId` and waits for the `continued`
   * acknowledgement.
   *
   * @throws Failure(BDP_THREAD_LOST) with session_state 'thread_terminated_other'
   *   when the device reports that the targeted thread no longer exists
   *   (wire error_code indicates INVALID_THREAD).
   * @throws Failure(BDP_THREAD_LOST) when the session is not live (guardLive).
   */
  async resume(threadId: number): Promise<void> {
    this.guardLive();
    try {
      await this.client.send({ kind: 'continue', threadId });
    } catch (e: unknown) {
      throw this.translateThreadGone(e, threadId);
    }
  }

  /**
   * Step a stopped thread.
   *
   * Sends a `step` request for `threadId` with the given `granularity` and
   * waits for the `stepped` acknowledgement.
   *
   * Granularity values:
   *   - 'line' = StepTypeCode.Line (1) -- step into next line
   *   - 'over' = StepTypeCode.Over (3) -- step over current call
   *   - 'out'  = StepTypeCode.Out  (2) -- step out of current frame
   *
   * @throws Failure(BDP_THREAD_LOST) with session_state 'thread_terminated_other'
   *   when the device reports that the targeted thread no longer exists.
   * @throws Failure(BDP_THREAD_LOST) when the session is not live (guardLive).
   */
  async step(threadId: number, granularity: 'line' | 'over' | 'out'): Promise<void> {
    this.guardLive();
    try {
      await this.client.send({ kind: 'step', threadId, granularity });
    } catch (e: unknown) {
      throw this.translateThreadGone(e, threadId);
    }
  }

  /**
   * Pause (stop) all running threads.
   *
   * Sends a `pause` request (CommandCode Stop) and waits for the `paused`
   * acknowledgement.  Unlike `resume` and `step`, `pause` targets no specific
   * thread, so no thread-gone translation is applied.
   *
   * @throws Failure(BDP_THREAD_LOST) when the session is not live (guardLive).
   */
  async pause(): Promise<void> {
    this.guardLive();
    await this.client.send({ kind: 'pause' });
  }

  // ---------------------------------------------------------------------------
  // Introspection methods (T13)
  // ---------------------------------------------------------------------------

  /**
   * Retrieve the list of all threads currently known to the device debugger.
   *
   * Sends a `threads` request and returns the decoded `BdpThreadEntry[]` from
   * the device response. Each entry includes stop reason, line/function/file at
   * the stop point, and a source snippet.
   *
   * Because this request is not thread-targeted, thread-gone translation is
   * not applied -- errors propagate as-is from BdpClient.
   *
   * @throws Failure(BDP_THREAD_LOST) if the session is not live (guardLive).
   */
  async threads(): Promise<BdpThreadEntry[]> {
    this.guardLive();
    const res = await this.client.send({ kind: 'threads' });
    if (res.kind !== 'threads') {
      throw fail('BDP_THREAD_LOST', `Unexpected response kind '${res.kind}' for threads`, { session_state: this._state });
    }
    return res.threads;
  }

  /**
   * Retrieve the call stack for a specific thread.
   *
   * Sends a `stack_trace` request for `threadId` and returns the decoded
   * `BdpStackFrame[]` from the device response. Frame 0 is the innermost
   * (most recent) frame. File paths are raw compiled-line paths as reported
   * by the device (e.g. `pkg:/source/main.brs`); `.brs` -> `.bs` translation
   * is deferred to the tool layer (T23).
   *
   * @throws Failure(BDP_THREAD_LOST) with session_state 'thread_terminated_other'
   *   when the device reports that the targeted thread no longer exists
   *   (wire error_code indicates INVALID_THREAD).
   * @throws Failure(BDP_THREAD_LOST) if the session is not live (guardLive).
   */
  async stackTrace(threadId: number): Promise<BdpStackFrame[]> {
    this.guardLive();
    try {
      const res = await this.client.send({ kind: 'stack_trace', threadId });
      if (res.kind !== 'stack_trace') {
        throw fail('BDP_THREAD_LOST', `Unexpected response kind '${res.kind}' for stack_trace`, { session_state: this._state });
      }
      return res.frames;
    } catch (e: unknown) {
      throw this.translateThreadGone(e, threadId);
    }
  }

  // ---------------------------------------------------------------------------
  // Variables and eval (T14)
  // ---------------------------------------------------------------------------

  /**
   * Retrieve the variables in scope for a specific thread and stack frame.
   *
   * Sends a `variables` request for `threadId` / `frameIdx` and returns the
   * decoded `BdpVariable[]`. When `opts.varPath` is provided, the device
   * returns the children of the container at that path rather than top-level
   * scope variables.
   *
   * `opts.getChildKeys` (flag bit 0) causes child key entries to be included.
   * `opts.getVirtualKeys` (flag bit 2) includes virtual (synthetic) variables.
   *
   * @throws Failure(BDP_THREAD_LOST) with session_state 'thread_terminated_other'
   *   when the device reports that the targeted thread no longer exists
   *   (wire error_code indicates INVALID_THREAD).
   * @throws Failure(BDP_THREAD_LOST) if the session is not live (guardLive).
   */
  async variables(
    threadId: number,
    frameIdx: number,
    opts?: { getChildKeys?: boolean; getVirtualKeys?: boolean; varPath?: string[] },
  ): Promise<BdpVariable[]> {
    this.guardLive();
    try {
      const res = await this.client.send({
        kind: 'variables',
        threadId,
        frameIdx,
        ...(opts?.getChildKeys !== undefined ? { getChildKeys: opts.getChildKeys } : {}),
        ...(opts?.getVirtualKeys !== undefined ? { getVirtualKeys: opts.getVirtualKeys } : {}),
        ...(opts?.varPath !== undefined ? { varPath: opts.varPath } : {}),
      });
      if (res.kind !== 'variables') {
        throw fail('BDP_THREAD_LOST', `Unexpected response kind '${res.kind}' for variables`, { session_state: this._state });
      }
      return res.variables;
    } catch (e: unknown) {
      throw this.translateThreadGone(e, threadId);
    }
  }

  /**
   * Evaluate a BrightScript expression in the context of a specific thread
   * and stack frame.
   *
   * Sends an `eval` (Execute) request. Because user-supplied expressions may
   * be long-running, `opts.timeoutMs` is forwarded to the underlying
   * `client.send` call (default 30 s). The returned status indicates whether
   * compilation and execution succeeded; any variable values produced by the
   * expression must be retrieved via a subsequent `variables()` call.
   *
   * IMPORTANT: eval does NOT return a variable value directly. The Execute
   * wire command returns success/error status only. To inspect values
   * produced by an expression, call `variables()` after a successful eval.
   *
   * @throws Failure(BDP_THREAD_LOST) with session_state 'thread_terminated_other'
   *   when the device reports that the targeted thread no longer exists.
   * @throws Failure(BDP_THREAD_LOST) if the session is not live (guardLive).
   */
  async eval(
    threadId: number,
    frameIdx: number,
    expression: string,
    opts?: { timeoutMs?: number },
  ): Promise<{
    success: boolean;
    runtimeStopReason?: BdpStopReason;
    compileErrors: string[];
    runtimeErrors: string[];
    otherErrors: string[];
  }> {
    this.guardLive();
    try {
      const res = await this.client.send(
        { kind: 'eval', threadId, frameIdx, expression },
        opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {},
      );
      if (res.kind !== 'eval') {
        throw fail('BDP_THREAD_LOST', `Unexpected response kind '${res.kind}' for eval`, { session_state: this._state });
      }
      return {
        success: res.success,
        ...(res.runtimeStopReason !== undefined ? { runtimeStopReason: res.runtimeStopReason } : {}),
        compileErrors: res.compileErrors,
        runtimeErrors: res.runtimeErrors,
        otherErrors: res.otherErrors,
      };
    } catch (e: unknown) {
      throw this.translateThreadGone(e, threadId);
    }
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

  /**
   * Translate a BDP_THREAD_LOST failure from the client layer into the
   * correct session-level error shape.
   *
   * When the device rejects a thread-targeted command because the thread is
   * gone, the BdpClient rejects with BDP_THREAD_LOST and embeds the raw wire
   * error_code as `details.bdp_error_code`.  This method re-throws with the
   * correct `session_state: 'thread_terminated_other'` detail for callers
   * that care about the thread-gone case (resume, step).
   *
   * Wire error_code interpretation (T27 verification pending):
   *   6 = INVALID_THREAD -- chosen as the most likely "thread gone" indicator
   *   based on the `roku-debug` ErrorCode table (T5 research).  Real-device
   *   testing in T27 must confirm this mapping; adjust the constant if the
   *   firmware uses a different code.
   *
   * Any other non-zero error_code is re-thrown as-is (no translation).
   */
  private translateThreadGone(e: unknown, threadId: number): unknown {
    // BDP wire error_code 6 = INVALID_THREAD (T27: verify on real device).
    const BDP_WIRE_ERROR_INVALID_THREAD = 6;

    const failure = e as { code?: string; details?: { bdp_error_code?: number } };
    if (
      failure.code === 'BDP_THREAD_LOST' &&
      failure.details?.bdp_error_code === BDP_WIRE_ERROR_INVALID_THREAD
    ) {
      return fail(
        'BDP_THREAD_LOST',
        `Thread ${threadId} is no longer available (wire error_code ${BDP_WIRE_ERROR_INVALID_THREAD})`,
        { session_state: 'thread_terminated_other' },
      );
    }
    return e;
  }
}
