/**
 * BDP logical message type definitions.
 *
 * These types represent the **decoded, high-level** form of BrightScript Debug
 * Protocol messages -- one discriminated union per direction.  The lower-level
 * wire codec (T6) translates between raw `Buffer` frames and these types.
 *
 * Wire format reference: docs/refs/bdp-wire-format.md
 *
 * --------------------------------------------------------------------------
 * Design notes
 * --------------------------------------------------------------------------
 *
 * • All optional fields use `?` per `exactOptionalPropertyTypes`.
 * • No runtime code in this file -- types only.
 * • `BdpRequest` covers logical requests including the handshake connect.
 *   The handshake itself uses a special non-standard frame on the wire
 *   (§1.2), but it is exposed here as a first-class request for the
 *   higher-level `BdpClient` API.
 * • `BdpResponse` kinds match the command that produced them (by name), not
 *   the wire `CommandCode` enum value, to keep the API readable.
 * • `BdpUpdateEvent` covers all async server-pushed events (§2.5).
 * • Open question refs (T1 §7 item N) are noted inline where the doc is
 *   ambiguous.
 */

// ---------------------------------------------------------------------------
// Version types (doc §3.3)
// ---------------------------------------------------------------------------

/**
 * A BDP protocol version expressed as a semver triple (doc §3.3).
 *
 * Wire encoding: three consecutive UInt32LE fields (major, minor, patch).
 * This corrects the plan's original "integer protocol version" assumption;
 * the actual scheme is a three-field tuple, as confirmed by T1 source study.
 */
export type BdpVersion = { major: number; minor: number; patch: number };

/**
 * Inclusive range of BDP protocol versions (doc §3.3).
 *
 * Both `min` and `max` are semver triples compared with standard semver
 * precedence (major first, then minor, then patch).
 */
export type BdpVersionRange = { min: BdpVersion; max: BdpVersion };

/**
 * The range of BDP protocol versions supported by this client (doc §3.1 item 5).
 *
 * `max` is `3.5.0`. T27 real-device verification on Roku Ultra 4850X firmware
 * 15.2.4 build 3442 (2026-05-08) observed the device offering BDP 3.5.0 in its
 * handshake response, so we accept up through that version. roku-debug v0.23.6
 * documents `<=3.2.0` but Roku has shipped newer minors since.
 * `min` is `1.0.0` (earliest version observed in the wild).
 */
export const SUPPORTED_BDP_VERSIONS: BdpVersionRange = {
  min: { major: 1, minor: 0, patch: 0 },
  max: { major: 3, minor: 5, patch: 0 },
} as const;

// ---------------------------------------------------------------------------
// Stop reasons / error codes (doc §4)
// ---------------------------------------------------------------------------

/**
 * Decoded stop reason -- used in AllThreadsStopped, ThreadAttached, and
 * Threads response entries (doc §4, StopReasonCode).
 */
export type BdpStopReason =
  | 'undefined'
  | 'not_stopped'
  | 'normal_exit'
  | 'stop_statement'
  | 'break'
  | 'runtime_error'
  | 'caught_runtime_error';

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/**
 * A decoded stack frame (doc §2.3 StackTraceResponse).
 *
 * Wire order: line_number (UInt32LE), file_path (UTF-8Z), function_name
 * (UTF-8Z).  Note: the device sends file_path *before* function_name on the
 * wire -- this is the reverse of what the BDP spec document describes but
 * matches the actual `roku-debug` implementation (doc §2.3 note).
 *
 * No column number field exists in either pre-v3 or v3 StackTrace responses
 * (doc §2.3, open question §7 item 4).
 */
export type BdpStackFrame = {
  /** 0-based frame index within the stack (frame 0 = innermost). */
  idx: number;
  /** Source file path (e.g. `pkg:/source/main.brs`). */
  file: string;
  /** 1-based line number. */
  line: number;
  /** Function name; absent for anonymous contexts or when not supplied. */
  functionName?: string;
};

/**
 * A decoded BrightScript variable (doc §5).
 *
 * The wire encoding uses a flags bitfield (§5.3) to indicate which fields are
 * present.  The codec collapses that into this richer struct.
 *
 * Expandability: a variable is expandable when `isContainer` is true AND
 * `childCount > 0` (doc §5.3 -- there is no separate `expandable` wire flag;
 * the plan's `expandable?: boolean` field does not exist on the wire).
 */
export type BdpVariable = {
  /** Variable name; may be absent for child-key entries when isNameHere=0. */
  name?: string;
  /**
   * BrightScript type name (from VariableTypeCode, doc §5.4).
   * Examples: 'String', 'Integer', 'Boolean', 'AssociativeArray', 'Invalid'.
   */
  type: string;
  /**
   * Serialized value.  Primitive types carry a JS-native value; container
   * types (AssociativeArray, Array, List) carry null because their children
   * are emitted as subsequent variable entries (doc §5.5).
   * Uninitialized and Unknown also carry null.
   */
  value: string | number | boolean | null;
  /** True when this variable is a child key of the preceding non-child entry (flag isChildKey, doc §5.3). */
  isChildKey?: boolean;
  /** True when the variable is declared constant/immutable (flag isConst, doc §5.3). */
  isConst?: boolean;
  /**
   * True when this is a container type (AssociativeArray, Array, List).
   * When true and childCount > 0 the variable is expandable -- a new
   * VariablesRequest with the variable's name appended to the path fetches
   * the children (doc §5.3).
   */
  isContainer?: boolean;
  /**
   * Number of direct children; present when isContainer is true (doc §5.2).
   * A value of 0 means the container is empty and non-expandable.
   */
  childCount?: number;
  /**
   * VariableTypeCode of the key type for container variables (doc §5.2).
   * 'String' (13) for AssociativeArray; 'Integer' (7) for Array.
   */
  keyType?: string;
  /** Reference count; present when the isRefCounted wire flag is set (doc §5.3). */
  refCount?: number;
  /**
   * True when this is a virtual (synthetic) variable, not a real BrightScript
   * variable (flag isVirtual, doc §5.3).
   */
  isVirtual?: boolean;
};

/**
 * A decoded breakpoint entry returned in AddBreakpoints, ListBreakpoints, and
 * RemoveBreakpoints responses (doc §2.4).
 *
 * Valid breakpoints: `breakpointId > 0`, `errorCode === 0`.
 * Error breakpoints: `breakpointId === 0`, `errorCode === 5` (INVALID_ARGS).
 */
export type BdpBreakpointEntry = {
  /** Assigned breakpoint ID.  > 0 = active; 0 = error (could not set). */
  breakpointId: number;
  /** Wire error_code for this individual breakpoint (0 = OK, 5 = INVALID_ARGS). */
  errorCode: number;
  /**
   * Remaining ignore count.  Present only when breakpointId > 0 (doc §2.4).
   * 0 = break every time (or remaining count exhausted).
   */
  ignoreCount?: number;
};

/**
 * A decoded thread entry from a ThreadsResponse (doc §2.3).
 *
 * The wire encoding packs multiple fields not captured in the plan's snippet:
 * stop reason, stop reason detail, line/function/file at stop point, and a
 * source snippet.
 */
export type BdpThreadEntry = {
  /** Thread index (0-based). */
  id: number;
  /** True when bit 0 of the flags byte is set (doc §2.3). */
  isPrimary: boolean;
  /** True when bit 1 of the flags byte is set (doc §2.3). */
  isDetached: boolean;
  /** Decoded stop reason code (doc §4). */
  stopReason: BdpStopReason;
  /** Human-readable stop reason detail string (UTF-8Z, may be empty). */
  stopReasonDetail: string;
  /** 1-based line number where the thread is stopped (doc §2.3). */
  line: number;
  /** Function name at the stop point (doc §2.3). */
  functionName: string;
  /** File path at the stop point (doc §2.3). */
  file: string;
  /** Source code text at the stop point (doc §2.3). */
  codeSnippet: string;
};

// ---------------------------------------------------------------------------
// BdpRequest -- client -> device (doc §2)
// ---------------------------------------------------------------------------

/**
 * All logical request messages from client to device.
 *
 * Most map 1:1 to a `CommandCode` (doc §4).  The `connect` kind is special:
 * it corresponds to the handshake frame (§1.2, no CommandCode), but is
 * represented here for the higher-level API.
 *
 * Changes from plan snippet (all driven by doc):
 *
 * • `step.granularity` renamed from `'into'` to `'line'` to match the wire
 *   `StepTypeCode.Line` (doc §4, §2.2).  'over' and 'out' are unchanged.
 *
 * • `add_breakpoints` entries gain optional `ignoreCount` (doc §2.4 field
 *   `ignore_count`).  Missing from plan snippet.
 *
 * • `add_conditional_breakpoints` added (CommandCode 11, doc §2.4).
 *   Missing from plan snippet.
 *
 * • `set_exception_breakpoints` added (CommandCode 12, doc §2.4).
 *   Missing from plan snippet.
 *
 * • `variables` flags decomposed: plan had `getChildren?: boolean` (maps to
 *   GetChildKeys flag bit 0) plus `varPath`.  The doc (§2.3) shows four flag
 *   bits; exposed as individual optional booleans for clarity.  `varPath` is
 *   kept as the variable path segments array.
 */
export type BdpRequest =
  | {
      kind: 'connect';
      /**
       * The version range this client supports.
       * Sent as part of the handshake (doc §1.2, §3.3).
       * Typically `SUPPORTED_BDP_VERSIONS`.
       */
      clientVersion: BdpVersionRange;
    }
  | {
      kind: 'continue';
      /** Index of the thread to continue (maps to CommandCode 2, doc §2.2). */
      threadId: number;
    }
  | {
      kind: 'step';
      /** Thread to step (doc §2.2 StepRequest field `thread_index`). */
      threadId: number;
      /**
       * Step granularity (doc §2.2 StepTypeCode):
       * - 'line' = StepTypeCode.Line (1) -- step into next line
       * - 'over' = StepTypeCode.Over (3) -- step over
       * - 'out'  = StepTypeCode.Out  (2) -- step out of current frame
       *
       * NOTE: plan used 'into' but the wire constant is 'Line' (doc §4).
       * Renamed to 'line' to match the actual StepTypeCode name.
       */
      granularity: 'line' | 'over' | 'out';
    }
  | {
      /** Maps to CommandCode Stop (1).  Called 'pause' here for API clarity. */
      kind: 'pause';
    }
  | {
      /** CommandCode Threads (3), doc §2.3. */
      kind: 'threads';
    }
  | {
      /** CommandCode StackTrace (4), doc §2.3. */
      kind: 'stack_trace';
      /** Thread index to retrieve the stack for. */
      threadId: number;
    }
  | {
      /** CommandCode Variables (5), doc §2.3. */
      kind: 'variables';
      /** Thread index (doc §2.3 `thread_index`). */
      threadId: number;
      /** Stack frame index from a prior StackTrace response (doc §2.3 `stack_frame_index`). */
      frameIdx: number;
      /**
       * Path segments into the variable tree (doc §2.3 `variable_path`).
       * Empty array = top-level scope variables.
       */
      varPath?: string[];
      /**
       * Request child keys (GetChildKeys flag bit 0, doc §2.3).
       * When true the device returns one entry per child key of the target variable.
       */
      getChildKeys?: boolean;
      /**
       * Include virtual (synthetic) keys (GetVirtualKeys flag bit 2, doc §2.3).
       */
      getVirtualKeys?: boolean;
    }
  | {
      /** CommandCode Execute (10), doc §2.3. */
      kind: 'eval';
      /** Thread to execute in. */
      threadId: number;
      /** Stack frame context. */
      frameIdx: number;
      /** BrightScript expression to evaluate (UTF-8Z encoded on wire, doc §2.3). */
      expression: string;
    }
  | {
      /** CommandCode AddBreakpoints (7), doc §2.4. */
      kind: 'add_breakpoints';
      breakpoints: {
        /** File location (e.g. `pkg:/source/main.brs`). */
        file: string;
        /** 1-based line number. */
        line: number;
        /**
         * Number of hits to ignore before breaking (doc §2.4 `ignore_count`).
         * 0 or omitted = break every time.
         */
        ignoreCount?: number;
      }[];
    }
  | {
      /**
       * CommandCode AddConditionalBreakpoints (11), doc §2.4.
       *
       * Added: not in plan snippet.  The doc documents this as a distinct
       * command with a conditional_expression per breakpoint.
       *
       * Feature-flag gate: `supportsConditionalBreakpoints` (exact version
       * threshold not yet extracted -- T1 §7 item 1).  The client should check
       * the connected device version before issuing this request.
       */
      kind: 'add_conditional_breakpoints';
      breakpoints: {
        file: string;
        line: number;
        /**
         * 0 or omitted = break every time (when condition is true).
         * Non-zero = skip this many condition-true hits before breaking
         * (doc §2.4 conditional breakpoint `ignore_count` semantics, open question §7 item 6).
         */
        ignoreCount?: number;
        /**
         * BrightScript boolean expression.  Empty string = unconditional
         * (equivalent to a plain breakpoint, doc §2.4).
         */
        conditionalExpression: string;
      }[];
    }
  | {
      /** CommandCode RemoveBreakpoints (9), doc §2.4. */
      kind: 'remove_breakpoints';
      /** Breakpoint IDs to remove (from a prior add/list response). */
      ids: number[];
    }
  | {
      /** CommandCode ListBreakpoints (8), doc §2.4. */
      kind: 'list_breakpoints';
    }
  | {
      /**
       * CommandCode SetExceptionBreakpoints (12), doc §2.4.
       *
       * Added: not in plan snippet.  The doc documents this as a distinct
       * command for setting exception filter breakpoints.
       */
      kind: 'set_exception_breakpoints';
      filters: {
        /**
         * Filter type ID (doc §2.4):
         * 1 = caught exceptions, 2 = uncaught exceptions.
         */
        filterTypeId: 1 | 2;
        /**
         * BrightScript boolean condition or empty string for unconditional
         * (doc §2.4).
         */
        conditionExpression: string;
      }[];
    }
  | {
      /** CommandCode ExitChannel (122), doc §2.2. */
      kind: 'exit_channel';
    };

// ---------------------------------------------------------------------------
// BdpResponse -- device -> client (correlated, request_id != 0, doc §1.4)
// ---------------------------------------------------------------------------

/**
 * All logical response messages from device to client.
 *
 * Changes from plan snippet (all driven by doc):
 *
 * • `connected` gains `revisionTimestamp?: bigint` (HandshakeV3Response, doc
 *   §1.2).
 *
 * • `threads` entry shape extended to `BdpThreadEntry` which includes stop
 *   reason, line/function/file, and code snippet (doc §2.3).  Plan had only
 *   `{ id, name, isPrimary }`.
 *
 * • `eval` (Execute) response replaced: plan had `result: BdpVariable` but
 *   the doc §2.3 shows `ExecuteV3Response` returns success flag, runtime stop
 *   code, and arrays of compile/runtime/other errors -- not a single variable.
 *   If evaluation produced a value it is accessible via a subsequent
 *   VariablesRequest (the Execute command does not return a variable value
 *   directly).
 *
 * • `breakpoints_added` / `breakpoints_removed` / `breakpoints_list` unified:
 *   the doc §2.4 shows AddBreakpointsResponse, RemoveBreakpointsResponse, and
 *   ListBreakpointsResponse all use the same payload (a list of BdpBreakpointEntry).
 *   Plan's `rejected: { file, line, reason }[]` does not exist on the wire;
 *   rejection is indicated by `breakpointId === 0` in the entry.
 *
 * • `set_exception_breakpoints` response added (doc §2.4).
 *
 * • `error` kind retained for transport/protocol-level errors not covered by
 *   the wire `ErrorCode` field (e.g. codec failures, connection drops).
 *   Not a wire packet type.
 */
export type BdpResponse =
  | {
      kind: 'connected';
      /** BDP protocol version reported by the device (doc §1.2, §3.3). */
      bdpVersion: BdpVersion;
      /**
       * Device firmware build timestamp in milliseconds since Unix epoch.
       * Present only for protocol >= 3.0.0 (HandshakeV3Response, doc §1.2).
       */
      revisionTimestamp?: bigint;
    }
  | {
      /** Response to 'pause' (Stop, CommandCode 1).  No payload (doc §2.2). */
      kind: 'paused';
    }
  | {
      /** Response to 'continue' (CommandCode 2).  No payload (doc §2.2). */
      kind: 'continued';
    }
  | {
      /** Response to 'step' (CommandCode 6).  No payload (doc §2.2). */
      kind: 'stepped';
    }
  | {
      /** Response to 'threads' (CommandCode 3, doc §2.3). */
      kind: 'threads';
      threads: BdpThreadEntry[];
    }
  | {
      /** Response to 'stack_trace' (CommandCode 4, doc §2.3). */
      kind: 'stack_trace';
      frames: BdpStackFrame[];
    }
  | {
      /** Response to 'variables' (CommandCode 5, doc §2.3, §5). */
      kind: 'variables';
      variables: BdpVariable[];
    }
  | {
      /**
       * Response to 'eval' (Execute, CommandCode 10, doc §2.3).
       *
       * Changed from plan: plan had `result: BdpVariable`.  The doc shows
       * ExecuteV3Response carries success/error information only.  Variable
       * values produced by the expression are accessible via a subsequent
       * VariablesRequest.
       */
      kind: 'eval';
      /** Non-zero = success (doc §2.3 `execute_success`). */
      success: boolean;
      /**
       * Stop reason code if a runtime halt occurred during execution
       * (doc §2.3 `runtime_stop_code`).
       */
      runtimeStopReason?: BdpStopReason;
      /** Compile errors produced during expression compilation (doc §2.3). */
      compileErrors: string[];
      /** Runtime errors produced during expression execution (doc §2.3). */
      runtimeErrors: string[];
      /** Other errors (doc §2.3). */
      otherErrors: string[];
    }
  | {
      /**
       * Response to 'add_breakpoints' (CommandCode 7, doc §2.4).
       *
       * Changed from plan: plan had `ids: number[]` and
       * `rejected: { file, line, reason }[]`.  The wire payload is a list of
       * BdpBreakpointEntry values; rejection is signalled by `breakpointId === 0`.
       */
      kind: 'breakpoints_added';
      entries: BdpBreakpointEntry[];
    }
  | {
      /**
       * Response to 'add_conditional_breakpoints' (CommandCode 11, doc §2.4).
       * Same payload structure as breakpoints_added (doc §2.4).
       */
      kind: 'conditional_breakpoints_added';
      entries: BdpBreakpointEntry[];
    }
  | {
      /**
       * Response to 'remove_breakpoints' (CommandCode 9, doc §2.4).
       * The wire payload is identical to ListBreakpointsResponse (doc §2.4).
       */
      kind: 'breakpoints_removed';
      entries: BdpBreakpointEntry[];
    }
  | {
      /** Response to 'list_breakpoints' (CommandCode 8, doc §2.4). */
      kind: 'breakpoints_list';
      entries: BdpBreakpointEntry[];
    }
  | {
      /**
       * Response to 'set_exception_breakpoints' (CommandCode 12, doc §2.4).
       * Each entry echoes the filter_type_id and its error_code.
       */
      kind: 'exception_breakpoints_set';
      entries: {
        /** Filter type ID echoed from request. */
        filterTypeId: number;
        /** 0 = OK, 5 = INVALID_ARGS (doc §2.4). */
        errorCode: number;
      }[];
    }
  | {
      /** Response to 'exit_channel' (CommandCode 122).  No payload (doc §2.2). */
      kind: 'exited';
    }
  | {
      /**
       * Transport or codec-level error (not a wire packet).
       * Emitted by the client when a connection fails, a frame is malformed,
       * or an unrecoverable decode error occurs.
       *
       * Open question (T1 §7 item 2): ProtocolError (UpdateTypeCode 7) has no
       * documented payload beyond the common update header; that async event is
       * represented in BdpUpdateEvent.  This `error` response kind is distinct:
       * it is a client-side sentinel, not a wire packet.
       */
      kind: 'error';
      code: string;
      message: string;
    };

// ---------------------------------------------------------------------------
// BdpUpdateEvent -- device -> client (async, request_id == 0, doc §1.5, §2.5)
// ---------------------------------------------------------------------------

/**
 * All async update events pushed by the device (doc §2.5).
 *
 * Changes from plan snippet (all driven by doc):
 *
 * • `stopped` renamed from plan's shape to match `AllThreadsStopped`
 *   (UpdateTypeCode 2).  Added `stopReason: BdpStopReason` and
 *   `stopReasonDetail: string` from wire payload (doc §2.5).  Plan had
 *   `file?` and `line?` but these do NOT appear in the AllThreadsStopped
 *   payload (they appear in the ThreadsResponse entries via a Threads request).
 *
 * • `thread_attached` gains `stopReason` and `stopReasonDetail` (doc §2.5
 *   ThreadAttached payload).
 *
 * • `compile_error` (UpdateTypeCode 5) gains `libraryName: string` (doc §2.5
 *   `library_name` field).  Plan had no `libraryName`.
 *
 * • `breakpoint_error` added (UpdateTypeCode 4, doc §2.5).  Missing from
 *   plan snippet.
 *
 * • `breakpoint_verified` added (UpdateTypeCode 6, doc §2.5).  Missing from
 *   plan snippet.
 *
 * • `protocol_error` added (UpdateTypeCode 7, doc §2.5).  No payload beyond
 *   common update header (open question T1 §7 item 2).
 *
 * • `exception_breakpoint_error` added (UpdateTypeCode 8, doc §2.5).
 *   Missing from plan snippet.
 *
 * • `app_exited` removed: not a wire UpdateTypeCode (doc §2.5 lists no such
 *   event).  The channel exit is signalled by a normal exit stop reason in
 *   AllThreadsStopped or by the ExitChannel response.
 */
export type BdpUpdateEvent =
  | {
      /**
       * AllThreadsStopped (UpdateTypeCode 2, doc §2.5).
       *
       * Emitted when all threads have stopped (e.g. breakpoint hit, STOP
       * statement, runtime error).
       *
       * Note: `file` and `line` are NOT part of this update payload (doc §2.5).
       * To get file/line context, issue a Threads or StackTrace request after
       * receiving this event.
       */
      kind: 'stopped';
      /** Index of the primary thread that triggered the stop (Int32LE, doc §2.5). */
      threadId: number;
      /** Decoded stop reason (doc §4 StopReasonCode). */
      stopReason: BdpStopReason;
      /** Human-readable stop reason detail (UTF-8Z, may be empty, doc §2.5). */
      stopReasonDetail: string;
    }
  | {
      /**
       * ThreadAttached (UpdateTypeCode 3, doc §2.5).
       *
       * Emitted when a new thread is attached to the debugger.
       */
      kind: 'thread_attached';
      /** Index of the newly attached thread. */
      threadId: number;
      stopReason: BdpStopReason;
      stopReasonDetail: string;
    }
  | {
      /**
       * IOPortOpened (UpdateTypeCode 1, doc §2.5).
       *
       * Sent once after the handshake; the client should connect to `port`
       * on the same device IP to receive channel stdout/stderr.
       * Wire encoding: Int32LE (doc §2.5).
       *
       * Note: plan had this kind but the io_port_opened shape was `{ port: number }`.
       * Retained as-is; shape matches the doc.
       */
      kind: 'io_port_opened';
      /** TCP port for the IO stream (stdout/stderr). */
      port: number;
    }
  | {
      /**
       * CompileError (UpdateTypeCode 5, doc §2.5).
       *
       * Emitted when a compile error is detected in channel code.
       * Added `libraryName` field -- missing from plan snippet.
       */
      kind: 'compile_error';
      /** Compile error description (UTF-8Z, doc §2.5). */
      message: string;
      /** Source file (e.g. `pkg:/source/main.brs` or `lib:<name>/`). */
      file: string;
      /** 1-based line number (doc §2.5). */
      line: number;
      /** Library name or empty string (doc §2.5 `library_name`). */
      libraryName: string;
    }
  | {
      /**
       * BreakpointError (UpdateTypeCode 4, doc §2.5).
       *
       * Added: not in plan snippet.  Emitted when a breakpoint encounters an
       * error during execution (distinct from the per-entry error in the add
       * response).
       */
      kind: 'breakpoint_error';
      /** Affected breakpoint ID (doc §2.5). */
      breakpointId: number;
      compileErrors: string[];
      runtimeErrors: string[];
      otherErrors: string[];
    }
  | {
      /**
       * BreakpointVerified (UpdateTypeCode 6, doc §2.5).
       *
       * Added: not in plan snippet.  Emitted when previously-pending
       * breakpoints are verified (resolved to an actual source location).
       *
       * Feature-flag gate: `supportsBreakpointVerification` (exact version
       * threshold not yet extracted -- T1 §7 item 1).
       */
      kind: 'breakpoint_verified';
      /** IDs of newly verified breakpoints (doc §2.5). */
      breakpointIds: number[];
    }
  | {
      /**
       * ProtocolError (UpdateTypeCode 7, doc §2.5).
       *
       * No documented payload beyond the common update header (open question
       * T1 §7 item 2).  Emitted by the device when it detects a protocol
       * violation.
       */
      kind: 'protocol_error';
    }
  | {
      /**
       * ExceptionBreakpointError (UpdateTypeCode 8, doc §2.5).
       *
       * Added: not in plan snippet.  Emitted when an exception breakpoint
       * filter encounters an error.
       */
      kind: 'exception_breakpoint_error';
      /** Exception filter ID (doc §2.5). */
      filterId: number;
      compileErrors: string[];
      runtimeErrors: string[];
      otherErrors: string[];
      /** 1-based source line number (doc §2.5). */
      line: number;
      /** Source file path (doc §2.5). */
      file: string;
    };
