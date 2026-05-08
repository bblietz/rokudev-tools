/**
 * BDP wire codec.
 *
 * Translates between typed BdpRequest / BdpResponse / BdpUpdateEvent values
 * and the byte payloads that the frame layer (frame.ts) carries.
 *
 * Wire format reference: docs/refs/bdp-wire-format.md.
 *
 * ---------------------------------------------------------------------------
 * Frame-layer relationship
 * ---------------------------------------------------------------------------
 *
 * The frame layer (frame.ts) produces/consumes:
 *   [packet_length:4LE] [packetType:4LE] [payload...]
 *
 * where "packetType" is whatever UInt32LE sits immediately after the length.
 * In BDP that slot is always the wire `request_id`.
 *
 * This codec works one level above the frame layer:
 *   • For requests:  encodeRequest()  → { packetType=requestId, payload=[command:4][args...] }
 *                    decodeRequest()  ← (packetType=requestId, payload=[command:4][args...])
 *   • For responses: encodeResponse() → { packetType=requestId, payload=[error_code:4][kind_disc:4][data...] }
 *                    decodeResponse() ← (packetType=requestId, payload=[error_code:4][kind_disc:4][data...])
 *   • For events:    encodeUpdateEvent() → { packetType=0, payload=[error_code:4][update_type:4][data...] }
 *                    decodeUpdateEvent() ← (packetType=0, payload=[error_code:4][update_type:4][data...])
 *
 * ---------------------------------------------------------------------------
 * Self-describing response encoding (deviation from raw wire)
 * ---------------------------------------------------------------------------
 *
 * On the real BDP wire the response carries no command discriminator -- the
 * client infers the response type from the command it sent for each request_id.
 * However, this codec embeds a 4-byte `kind_discriminator` (= the command code)
 * immediately after `error_code` so that the codec is self-describing and
 * testable in isolation. The BdpClient (T8) and the mock server (T7) both use
 * this codec; neither needs an external requestId-to-command map.
 *
 * XXX(T7-mock-server-verify): If real-device testing (T27) reveals that the
 * self-describing layout must be stripped when sending to a real Roku, the
 * BdpClient should strip the kind_discriminator before writing to the socket
 * (or the codec should offer a separate encodeResponseWire() helper). For now
 * the mock server is the only "device" this codec talks to.
 */

import type {
  BdpRequest,
  BdpResponse,
  BdpUpdateEvent,
  BdpVariable,
  BdpBreakpointEntry,
  BdpThreadEntry,
  BdpStackFrame,
  BdpStopReason,
} from './messages.js';

// ---------------------------------------------------------------------------
// Wire constants (doc §4, §2.5)
// ---------------------------------------------------------------------------

/** Command codes for BDP request packets (doc §4 CommandCode). */
export const CommandCode = {
  Stop: 1,
  Continue: 2,
  Threads: 3,
  StackTrace: 4,
  Variables: 5,
  Step: 6,
  AddBreakpoints: 7,
  ListBreakpoints: 8,
  RemoveBreakpoints: 9,
  Execute: 10,
  AddConditionalBreakpoints: 11,
  SetExceptionBreakpoints: 12,
  ExitChannel: 122,
} as const;

/** Update type codes for async events (doc §2.5). */
export const UpdateTypeCode = {
  IOPortOpened: 1,
  AllThreadsStopped: 2,
  ThreadAttached: 3,
  BreakpointError: 4,
  CompileError: 5,
  BreakpointVerified: 6,
  ProtocolError: 7,
  ExceptionBreakpointError: 8,
} as const;

/** Stop reason codes (doc §4 StopReasonCode). */
export const StopReasonCode = {
  Undefined: 0,
  NotStopped: 1,
  NormalExit: 2,
  StopStatement: 3,
  Break: 4,
  RuntimeError: 5,
  CaughtRuntimeError: 6,
} as const;

/** Step type codes (doc §2.2 StepTypeCode). */
const StepTypeCode = {
  None: 0,
  Line: 1,
  Out: 2,
  Over: 3,
} as const;

/** Variable type codes (doc §5.4). */
const VariableTypeCode: Record<string, number> = {
  AssociativeArray: 1,
  Array: 2,
  Boolean: 3,
  Double: 4,
  Float: 5,
  Function: 6,
  Integer: 7,
  Interface: 8,
  Invalid: 9,
  List: 10,
  LongInteger: 11,
  Object: 12,
  String: 13,
  Subroutine: 14,
  SubtypedObject: 15,
  Uninitialized: 16,
  Unknown: 17,
};

/** Reverse map: code -> type name string. */
const VariableTypeCodeToName: Record<number, string> = Object.fromEntries(
  Object.entries(VariableTypeCode).map(([name, code]) => [code, name]),
);

/** Variable flags bitfield (doc §5.3). */
const VarFlag = {
  isChildKey: 0x01,
  isConst: 0x02,
  isContainer: 0x04,
  isNameHere: 0x08,
  isRefCounted: 0x10,
  isValueHere: 0x20,
  isKeysCaseSensitive: 0x40,
  isVirtual: 0x80,
} as const;

// Error code always 0 (OK) for encoded messages originating from client or mock.
const ERROR_CODE_OK = 0;

// ---------------------------------------------------------------------------
// Discriminator: is a frame an async update event?
// ---------------------------------------------------------------------------

/**
 * Returns true when `requestId` (the "packetType" from decodeFrame) indicates
 * an async update event.  Per doc §1.5: updates always have request_id == 0.
 */
export function isUpdateEventPacket(requestId: number): boolean {
  return requestId === 0;
}

// ---------------------------------------------------------------------------
// String helpers (NUL-terminated UTF-8)
// ---------------------------------------------------------------------------

function readNullTerminatedString(
  buf: Buffer,
  offset: number,
): { value: string; nextOffset: number } {
  const end = buf.indexOf(0x00, offset);
  if (end === -1)
    throw new Error(`BDP wire-codec: NUL terminator not found starting at offset ${offset}`);
  const value = buf.toString('utf8', offset, end);
  return { value, nextOffset: end + 1 };
}

function writeNullTerminatedString(value: string): Buffer {
  const encoded = Buffer.from(value, 'utf8');
  const out = Buffer.allocUnsafe(encoded.length + 1);
  encoded.copy(out);
  out[encoded.length] = 0x00;
  return out;
}

// ---------------------------------------------------------------------------
// Stop reason helpers (doc §4)
// ---------------------------------------------------------------------------

const STOP_REASON_TO_CODE: Record<BdpStopReason, number> = {
  undefined: StopReasonCode.Undefined,
  not_stopped: StopReasonCode.NotStopped,
  normal_exit: StopReasonCode.NormalExit,
  stop_statement: StopReasonCode.StopStatement,
  break: StopReasonCode.Break,
  runtime_error: StopReasonCode.RuntimeError,
  caught_runtime_error: StopReasonCode.CaughtRuntimeError,
};

const STOP_REASON_CODE_TO_STRING: Record<number, BdpStopReason> = {
  [StopReasonCode.Undefined]: 'undefined',
  [StopReasonCode.NotStopped]: 'not_stopped',
  [StopReasonCode.NormalExit]: 'normal_exit',
  [StopReasonCode.StopStatement]: 'stop_statement',
  [StopReasonCode.Break]: 'break',
  [StopReasonCode.RuntimeError]: 'runtime_error',
  [StopReasonCode.CaughtRuntimeError]: 'caught_runtime_error',
};

function encodeStopReason32(reason: BdpStopReason): number {
  return STOP_REASON_TO_CODE[reason] ?? StopReasonCode.Undefined;
}

function decodeStopReason32(code: number): BdpStopReason {
  return STOP_REASON_CODE_TO_STRING[code] ?? 'undefined';
}

function decodeStopReason8(code: number): BdpStopReason {
  return STOP_REASON_CODE_TO_STRING[code] ?? 'undefined';
}

// ---------------------------------------------------------------------------
// Error string list helpers (compile/runtime/other errors -- doc §2.3, §2.5)
// ---------------------------------------------------------------------------

function encodeStringList(strings: string[]): Buffer {
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(strings.length, 0);
  const parts = [countBuf, ...strings.map(writeNullTerminatedString)];
  return Buffer.concat(parts);
}

function decodeStringList(buf: Buffer, offset: number): { values: string[]; nextOffset: number } {
  const count = buf.readUInt32LE(offset);
  offset += 4;
  const values: string[] = [];
  for (let i = 0; i < count; i++) {
    const { value, nextOffset } = readNullTerminatedString(buf, offset);
    values.push(value);
    offset = nextOffset;
  }
  return { values, nextOffset: offset };
}

// ---------------------------------------------------------------------------
// Variable serialization helpers (doc §5)
// ---------------------------------------------------------------------------

function encodeVariable(v: BdpVariable): Buffer {
  const parts: Buffer[] = [];

  // Compute flags byte (doc §5.3).
  let flags = 0;
  if (v.isChildKey === true) flags |= VarFlag.isChildKey;
  if (v.isConst === true) flags |= VarFlag.isConst;
  if (v.isContainer === true) flags |= VarFlag.isContainer;
  if (v.name !== undefined) flags |= VarFlag.isNameHere;
  if (v.refCount !== undefined) flags |= VarFlag.isRefCounted;
  // isValueHere: set for types that carry a value on the wire (doc §5.5).
  // Container types, Uninitialized, Unknown, Invalid do NOT set isValueHere.
  const typeCode = VariableTypeCode[v.type] ?? VariableTypeCode['Unknown'];
  const hasValue = valueIsPresent(typeCode ?? 17);
  if (hasValue) flags |= VarFlag.isValueHere;
  if (v.isVirtual === true) flags |= VarFlag.isVirtual;

  const resolvedTypeCode = typeCode ?? 17; // 17 = Unknown

  // [flags:1][type_code:1]
  const header = Buffer.alloc(2);
  header.writeUInt8(flags, 0);
  header.writeUInt8(resolvedTypeCode, 1);
  parts.push(header);

  // [name?]
  if (v.name !== undefined) {
    parts.push(writeNullTerminatedString(v.name));
  }

  // [ref_count?]
  if (v.refCount !== undefined) {
    const rb = Buffer.alloc(4);
    rb.writeUInt32LE(v.refCount, 0);
    parts.push(rb);
  }

  // [key_type_code:1][child_count:4] -- present when isContainer (doc §5.2)
  if (v.isContainer === true) {
    const keyTypeCode = v.keyType !== undefined ? (VariableTypeCode[v.keyType] ?? 0) : 0;
    const containerBuf = Buffer.alloc(5);
    containerBuf.writeUInt8(keyTypeCode, 0);
    containerBuf.writeUInt32LE(v.childCount ?? 0, 1);
    parts.push(containerBuf);
  }

  // [value?] -- present when isValueHere (doc §5.5)
  if (hasValue) {
    parts.push(encodeVariableValue(resolvedTypeCode, v.value));
  }

  return Buffer.concat(parts);
}

/** Returns true for types that carry value bytes on the wire (doc §5.5). */
function valueIsPresent(typeCode: number): boolean {
  // Types with NO value bytes: Array(2), AssociativeArray(1), List(10),
  // Uninitialized(16), Unknown(17), Invalid(9).
  const noValue = new Set([
    VariableTypeCode.Array,
    VariableTypeCode.AssociativeArray,
    VariableTypeCode.List,
    VariableTypeCode.Uninitialized,
    VariableTypeCode.Unknown,
    VariableTypeCode.Invalid,
  ]);
  return !noValue.has(typeCode);
}

function encodeVariableValue(typeCode: number, value: BdpVariable['value']): Buffer {
  switch (typeCode) {
    case VariableTypeCode.String:
    case VariableTypeCode.Object:
    case VariableTypeCode.Function:
    case VariableTypeCode.Interface:
    case VariableTypeCode.Subroutine:
      return writeNullTerminatedString(typeof value === 'string' ? value : '');

    case VariableTypeCode.SubtypedObject: {
      // Two sequential NUL-terminated strings (doc §5.5).
      // The combined value is stored as "typename; subtype" -- split on "; ".
      const combined = typeof value === 'string' ? value : '';
      const sepIdx = combined.indexOf('; ');
      const [typeName, subType] =
        sepIdx >= 0 ? [combined.slice(0, sepIdx), combined.slice(sepIdx + 2)] : [combined, ''];
      return Buffer.concat([
        writeNullTerminatedString(typeName),
        writeNullTerminatedString(subType),
      ]);
    }

    case VariableTypeCode.Boolean: {
      const b = Buffer.alloc(1);
      b.writeUInt8(value === true ? 1 : 0, 0);
      return b;
    }

    case VariableTypeCode.Integer: {
      const b = Buffer.alloc(4);
      b.writeInt32LE(typeof value === 'number' ? value : 0, 0);
      return b;
    }

    case VariableTypeCode.LongInteger: {
      // Stored as a BigInt64LE on the wire; value may lose precision beyond
      // Number.MAX_SAFE_INTEGER when round-tripped through Number.
      // XXX(T7-mock-server-verify): Verify that BigInt values survive round-trip
      // through Number correctly for all expected device values.
      const b = Buffer.alloc(8);
      b.writeBigInt64LE(BigInt(typeof value === 'number' ? Math.trunc(value) : 0), 0);
      return b;
    }

    case VariableTypeCode.Float: {
      const b = Buffer.alloc(4);
      b.writeFloatLE(typeof value === 'number' ? value : 0, 0);
      return b;
    }

    case VariableTypeCode.Double: {
      const b = Buffer.alloc(8);
      b.writeDoubleLE(typeof value === 'number' ? value : 0, 0);
      return b;
    }

    default:
      return Buffer.alloc(0);
  }
}

function decodeVariable(
  buf: Buffer,
  offset: number,
): { variable: BdpVariable; nextOffset: number } {
  const flags = buf.readUInt8(offset++);
  const typeCode = buf.readUInt8(offset++);
  const typeName = VariableTypeCodeToName[typeCode] ?? 'Unknown';

  const variable: BdpVariable = {
    type: typeName,
    value: null,
  };

  if (flags & VarFlag.isChildKey) variable.isChildKey = true;
  if (flags & VarFlag.isConst) variable.isConst = true;
  if (flags & VarFlag.isContainer) variable.isContainer = true;
  if (flags & VarFlag.isVirtual) variable.isVirtual = true;

  // [name?]
  if (flags & VarFlag.isNameHere) {
    const { value: name, nextOffset } = readNullTerminatedString(buf, offset);
    variable.name = name;
    offset = nextOffset;
  }

  // [ref_count?]
  if (flags & VarFlag.isRefCounted) {
    variable.refCount = buf.readUInt32LE(offset);
    offset += 4;
  }

  // [key_type_code:1][child_count:4]
  if (flags & VarFlag.isContainer) {
    const keyTypeCode = buf.readUInt8(offset++);
    variable.keyType = VariableTypeCodeToName[keyTypeCode] ?? 'Unknown';
    variable.childCount = buf.readUInt32LE(offset);
    offset += 4;
  }

  // [value?]
  if (flags & VarFlag.isValueHere) {
    const { value, nextOffset } = decodeVariableValue(typeCode, buf, offset);
    variable.value = value;
    offset = nextOffset;
  }

  return { variable, nextOffset: offset };
}

function decodeVariableValue(
  typeCode: number,
  buf: Buffer,
  offset: number,
): { value: BdpVariable['value']; nextOffset: number } {
  switch (typeCode) {
    case VariableTypeCode.String:
    case VariableTypeCode.Object:
    case VariableTypeCode.Function:
    case VariableTypeCode.Interface:
    case VariableTypeCode.Subroutine: {
      const { value, nextOffset } = readNullTerminatedString(buf, offset);
      return { value, nextOffset };
    }

    case VariableTypeCode.SubtypedObject: {
      // Two NUL-terminated strings; rejoin as "typename; subtype".
      const { value: typeName, nextOffset: o1 } = readNullTerminatedString(buf, offset);
      const { value: subType, nextOffset: o2 } = readNullTerminatedString(buf, o1);
      return { value: subType ? `${typeName}; ${subType}` : typeName, nextOffset: o2 };
    }

    case VariableTypeCode.Boolean:
      return { value: buf.readUInt8(offset) !== 0, nextOffset: offset + 1 };

    case VariableTypeCode.Integer:
      return { value: buf.readInt32LE(offset), nextOffset: offset + 4 };

    case VariableTypeCode.LongInteger:
      // Convert BigInt to number (precision loss for values > MAX_SAFE_INTEGER).
      return { value: Number(buf.readBigInt64LE(offset)), nextOffset: offset + 8 };

    case VariableTypeCode.Float:
      return { value: buf.readFloatLE(offset), nextOffset: offset + 4 };

    case VariableTypeCode.Double:
      return { value: buf.readDoubleLE(offset), nextOffset: offset + 8 };

    default:
      return { value: null, nextOffset: offset };
  }
}

// ---------------------------------------------------------------------------
// Breakpoint entry helpers (doc §2.4 -- used for all breakpoint responses)
// ---------------------------------------------------------------------------

function encodeBreakpointEntries(entries: BdpBreakpointEntry[]): Buffer {
  const parts: Buffer[] = [];
  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(entries.length, 0);
  parts.push(countBuf);
  for (const entry of entries) {
    if (entry.breakpointId > 0) {
      // Valid breakpoint: 12 bytes (breakpoint_id + error_code + ignore_count).
      const b = Buffer.alloc(12);
      b.writeUInt32LE(entry.breakpointId, 0);
      b.writeUInt32LE(entry.errorCode, 4);
      b.writeUInt32LE(entry.ignoreCount ?? 0, 8);
      parts.push(b);
    } else {
      // Error breakpoint: 8 bytes (breakpoint_id + error_code, no ignore_count).
      const b = Buffer.alloc(8);
      b.writeUInt32LE(0, 0);
      b.writeUInt32LE(entry.errorCode, 4);
      parts.push(b);
    }
  }
  return Buffer.concat(parts);
}

function decodeBreakpointEntries(
  buf: Buffer,
  offset: number,
): { entries: BdpBreakpointEntry[]; nextOffset: number } {
  const count = buf.readUInt32LE(offset);
  offset += 4;
  const entries: BdpBreakpointEntry[] = [];
  for (let i = 0; i < count; i++) {
    const breakpointId = buf.readUInt32LE(offset);
    const errorCode = buf.readUInt32LE(offset + 4);
    if (breakpointId > 0) {
      const ignoreCount = buf.readUInt32LE(offset + 8);
      entries.push({ breakpointId, errorCode, ignoreCount });
      offset += 12;
    } else {
      entries.push({ breakpointId: 0, errorCode });
      offset += 8;
    }
  }
  return { entries, nextOffset: offset };
}

// ---------------------------------------------------------------------------
// Thread entry helpers (doc §2.3 ThreadsResponse)
// ---------------------------------------------------------------------------

function encodeThreadEntry(entry: BdpThreadEntry): Buffer {
  const parts: Buffer[] = [];

  // [flags:1] -- bit 0 = isPrimary, bit 1 = isDetached
  let flags = 0;
  if (entry.isPrimary) flags |= 0x01;
  if (entry.isDetached) flags |= 0x02;
  const flagBuf = Buffer.alloc(1);
  flagBuf.writeUInt8(flags, 0);
  parts.push(flagBuf);

  // [stop_reason:4] UInt32LE
  const srBuf = Buffer.alloc(4);
  srBuf.writeUInt32LE(encodeStopReason32(entry.stopReason), 0);
  parts.push(srBuf);

  // [stop_reason_detail:UTF-8Z]
  parts.push(writeNullTerminatedString(entry.stopReasonDetail));

  // [line_number:4] UInt32LE
  const lineBuf = Buffer.alloc(4);
  lineBuf.writeUInt32LE(entry.line, 0);
  parts.push(lineBuf);

  // [function_name:UTF-8Z]
  parts.push(writeNullTerminatedString(entry.functionName));

  // [file_path:UTF-8Z]
  parts.push(writeNullTerminatedString(entry.file));

  // [code_snippet:UTF-8Z]
  parts.push(writeNullTerminatedString(entry.codeSnippet));

  return Buffer.concat(parts);
}

function decodeThreadEntry(
  buf: Buffer,
  offset: number,
  id: number,
): { entry: BdpThreadEntry; nextOffset: number } {
  const flags = buf.readUInt8(offset++);
  const isPrimary = (flags & 0x01) !== 0;
  const isDetached = (flags & 0x02) !== 0;

  const stopReasonCode = buf.readUInt32LE(offset);
  offset += 4;
  const stopReason = decodeStopReason32(stopReasonCode);

  const { value: stopReasonDetail, nextOffset: o1 } = readNullTerminatedString(buf, offset);
  offset = o1;

  const line = buf.readUInt32LE(offset);
  offset += 4;

  const { value: functionName, nextOffset: o2 } = readNullTerminatedString(buf, offset);
  offset = o2;

  const { value: file, nextOffset: o3 } = readNullTerminatedString(buf, offset);
  offset = o3;

  const { value: codeSnippet, nextOffset: o4 } = readNullTerminatedString(buf, offset);
  offset = o4;

  return {
    entry: {
      id,
      isPrimary,
      isDetached,
      stopReason,
      stopReasonDetail,
      line,
      functionName,
      file,
      codeSnippet,
    },
    nextOffset: offset,
  };
}

// ---------------------------------------------------------------------------
// Stack frame helpers (doc §2.3 StackTraceResponse)
// ---------------------------------------------------------------------------

function encodeStackFrame(frame: BdpStackFrame): Buffer {
  const parts: Buffer[] = [];

  // [line_number:4]
  const lb = Buffer.alloc(4);
  lb.writeUInt32LE(frame.line, 0);
  parts.push(lb);

  // Wire order: file_path BEFORE function_name (doc §2.3 note -- reversed from spec).
  parts.push(writeNullTerminatedString(frame.file));
  parts.push(writeNullTerminatedString(frame.functionName ?? ''));

  return Buffer.concat(parts);
}

function decodeStackFrame(
  buf: Buffer,
  offset: number,
  idx: number,
): { frame: BdpStackFrame; nextOffset: number } {
  const line = buf.readUInt32LE(offset);
  offset += 4;

  // Wire order: file first, then function name (doc §2.3 note).
  const { value: file, nextOffset: o1 } = readNullTerminatedString(buf, offset);
  offset = o1;

  const { value: functionNameRaw, nextOffset: o2 } = readNullTerminatedString(buf, offset);
  offset = o2;

  const frame: BdpStackFrame = { idx, file, line };
  if (functionNameRaw.length > 0) frame.functionName = functionNameRaw;

  return { frame, nextOffset: offset };
}

// ---------------------------------------------------------------------------
// Request codec
// ---------------------------------------------------------------------------

/**
 * Encode a BdpRequest into a frame-layer payload.
 *
 * @param req - The logical request to encode.
 * @param requestId - Monotonically increasing client-assigned ID.
 * @returns { packetType: requestId, payload: [command:4LE][args...] }
 *   Pass to encodeFrame(packetType, payload).
 *
 * @throws For 'connect' requests (handshake uses its own frame, doc §1.2).
 */
export function encodeRequest(
  req: BdpRequest,
  requestId: number,
): { packetType: number; payload: Buffer } {
  const payload = encodeRequestPayload(req);
  return { packetType: requestId, payload };
}

function encodeRequestPayload(req: BdpRequest): Buffer {
  switch (req.kind) {
    case 'connect':
      throw new Error(
        'BDP wire-codec: connect requests use the handshake frame (encodeHandshakeRequest), not encodeRequest',
      );

    case 'pause': {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(CommandCode.Stop, 0);
      return b;
    }

    case 'continue': {
      const b = Buffer.alloc(8);
      b.writeUInt32LE(CommandCode.Continue, 0);
      b.writeUInt32LE(req.threadId, 4);
      return b;
    }

    case 'step': {
      // [command:4][thread_index:4][step_type:1] -- total 9 bytes (doc §2.2)
      const b = Buffer.alloc(9);
      b.writeUInt32LE(CommandCode.Step, 0);
      b.writeUInt32LE(req.threadId, 4);
      b[8] = granularityToStepTypeCode(req.granularity);
      return b;
    }

    case 'threads': {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(CommandCode.Threads, 0);
      return b;
    }

    case 'stack_trace': {
      const b = Buffer.alloc(8);
      b.writeUInt32LE(CommandCode.StackTrace, 0);
      b.writeUInt32LE(req.threadId, 4);
      return b;
    }

    case 'variables': {
      return encodeVariablesRequest(req);
    }

    case 'eval': {
      const parts: Buffer[] = [];
      const header = Buffer.alloc(12);
      header.writeUInt32LE(CommandCode.Execute, 0);
      header.writeUInt32LE(req.threadId, 4);
      header.writeUInt32LE(req.frameIdx, 8);
      parts.push(header);
      parts.push(writeNullTerminatedString(req.expression));
      return Buffer.concat(parts);
    }

    case 'add_breakpoints': {
      return encodeAddBreakpointsRequest(req.breakpoints);
    }

    case 'add_conditional_breakpoints': {
      return encodeAddConditionalBreakpointsRequest(req.breakpoints);
    }

    case 'remove_breakpoints': {
      return encodeRemoveBreakpointsRequest(req.ids);
    }

    case 'list_breakpoints': {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(CommandCode.ListBreakpoints, 0);
      return b;
    }

    case 'set_exception_breakpoints': {
      return encodeSetExceptionBreakpointsRequest(req.filters);
    }

    case 'exit_channel': {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(CommandCode.ExitChannel, 0);
      return b;
    }

    default: {
      const exhaustive: never = req;
      throw new Error(`BDP wire-codec: unknown request kind: ${(exhaustive as BdpRequest).kind}`);
    }
  }
}

function granularityToStepTypeCode(granularity: 'line' | 'over' | 'out'): number {
  switch (granularity) {
    case 'line':
      return StepTypeCode.Line;
    case 'over':
      return StepTypeCode.Over;
    case 'out':
      return StepTypeCode.Out;
  }
}

function stepTypeCodeToGranularity(code: number): 'line' | 'over' | 'out' {
  switch (code) {
    case StepTypeCode.Line:
      return 'line';
    case StepTypeCode.Over:
      return 'over';
    case StepTypeCode.Out:
      return 'out';
    default:
      return 'line'; // fallback
  }
}

function encodeVariablesRequest(req: Extract<BdpRequest, { kind: 'variables' }>): Buffer {
  const varPath = req.varPath ?? [];
  const getChildKeys = req.getChildKeys === true;
  const getVirtualKeys = req.getVirtualKeys === true;

  // Flags byte (doc §2.3):
  // bit 0 = GetChildKeys, bit 1 = CaseSensitivityOptions, bit 2 = GetVirtualKeys
  // bit 3 = VirtualPathIncluded
  let variableRequestFlags = 0;
  if (getChildKeys) variableRequestFlags |= 0x01;
  if (getVirtualKeys) variableRequestFlags |= 0x04;

  const parts: Buffer[] = [];
  const header = Buffer.alloc(13); // command(4) + flags(1) + thread(4) + frame(4)
  header.writeUInt32LE(CommandCode.Variables, 0);
  header[4] = variableRequestFlags;
  header.writeUInt32LE(req.threadId, 5);
  header.writeUInt32LE(req.frameIdx, 9);
  parts.push(header);

  // variable_path_len
  const pathLenBuf = Buffer.alloc(4);
  pathLenBuf.writeUInt32LE(varPath.length, 0);
  parts.push(pathLenBuf);

  // variable_path: N null-terminated strings
  for (const segment of varPath) {
    parts.push(writeNullTerminatedString(segment));
  }

  return Buffer.concat(parts);
}

function encodeAddBreakpointsRequest(
  breakpoints: Array<{ file: string; line: number; ignoreCount?: number }>,
): Buffer {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(8); // command(4) + num_breakpoints(4)
  header.writeUInt32LE(CommandCode.AddBreakpoints, 0);
  header.writeUInt32LE(breakpoints.length, 4);
  parts.push(header);
  for (const bp of breakpoints) {
    const entry = Buffer.alloc(8); // line_number(4) + ignore_count(4)
    parts.push(writeNullTerminatedString(bp.file));
    entry.writeUInt32LE(bp.line, 0);
    entry.writeUInt32LE(bp.ignoreCount ?? 0, 4);
    parts.push(entry);
  }
  return Buffer.concat(parts);
}

function encodeAddConditionalBreakpointsRequest(
  breakpoints: Array<{
    file: string;
    line: number;
    ignoreCount?: number;
    conditionalExpression: string;
  }>,
): Buffer {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(12); // command(4) + flags(4) + num_breakpoints(4)
  header.writeUInt32LE(CommandCode.AddConditionalBreakpoints, 0);
  header.writeUInt32LE(0, 4); // flags -- reserved, always 0
  header.writeUInt32LE(breakpoints.length, 8);
  parts.push(header);
  for (const bp of breakpoints) {
    parts.push(writeNullTerminatedString(bp.file));
    const entry = Buffer.alloc(8); // line_number(4) + ignore_count(4)
    entry.writeUInt32LE(bp.line, 0);
    entry.writeUInt32LE(bp.ignoreCount ?? 0, 4);
    parts.push(entry);
    parts.push(writeNullTerminatedString(bp.conditionalExpression));
  }
  return Buffer.concat(parts);
}

function encodeRemoveBreakpointsRequest(ids: number[]): Buffer {
  const buf = Buffer.alloc(4 + 4 + ids.length * 4); // command + num + ids[]
  buf.writeUInt32LE(CommandCode.RemoveBreakpoints, 0);
  buf.writeUInt32LE(ids.length, 4);
  for (let i = 0; i < ids.length; i++) {
    buf.writeUInt32LE(ids[i] ?? 0, 8 + i * 4);
  }
  return buf;
}

function encodeSetExceptionBreakpointsRequest(
  filters: Array<{ filterTypeId: 1 | 2; conditionExpression: string }>,
): Buffer {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(8); // command(4) + num_breakpoints(4)
  header.writeUInt32LE(CommandCode.SetExceptionBreakpoints, 0);
  header.writeUInt32LE(filters.length, 4);
  parts.push(header);
  for (const f of filters) {
    const entry = Buffer.alloc(4); // filter_type_id(4)
    entry.writeUInt32LE(f.filterTypeId, 0);
    parts.push(entry);
    parts.push(writeNullTerminatedString(f.conditionExpression));
  }
  return Buffer.concat(parts);
}

/**
 * Decode a frame-layer payload into a BdpRequest.
 *
 * @param packetType - The "packetType" from decodeFrame (= wire request_id).
 * @param payload - The payload bytes from decodeFrame ([command:4LE][args...]).
 * @returns { req, requestId: packetType }
 *
 * @throws For unknown command codes or malformed payloads.
 */
export function decodeRequest(
  packetType: number,
  payload: Buffer,
): { req: BdpRequest; requestId: number } {
  if (payload.length < 4) throw new Error('BDP wire-codec: request payload too short');
  const command = payload.readUInt32LE(0);
  const req = decodeRequestFromCommand(command, payload);
  return { req, requestId: packetType };
}

function decodeRequestFromCommand(command: number, payload: Buffer): BdpRequest {
  switch (command) {
    case CommandCode.Stop:
      return { kind: 'pause' };

    case CommandCode.Continue:
      return { kind: 'continue', threadId: payload.readUInt32LE(4) };

    case CommandCode.Step: {
      const threadId = payload.readUInt32LE(4);
      const stepTypeCode = payload.readUInt8(8);
      return { kind: 'step', threadId, granularity: stepTypeCodeToGranularity(stepTypeCode) };
    }

    case CommandCode.Threads:
      return { kind: 'threads' };

    case CommandCode.StackTrace:
      return { kind: 'stack_trace', threadId: payload.readUInt32LE(4) };

    case CommandCode.Variables:
      return decodeVariablesRequest(payload);

    case CommandCode.Execute: {
      const threadId = payload.readUInt32LE(4);
      const frameIdx = payload.readUInt32LE(8);
      const { value: expression } = readNullTerminatedString(payload, 12);
      return { kind: 'eval', threadId, frameIdx, expression };
    }

    case CommandCode.AddBreakpoints:
      return decodeAddBreakpointsRequest(payload);

    case CommandCode.AddConditionalBreakpoints:
      return decodeAddConditionalBreakpointsRequest(payload);

    case CommandCode.RemoveBreakpoints:
      return decodeRemoveBreakpointsRequest(payload);

    case CommandCode.ListBreakpoints:
      return { kind: 'list_breakpoints' };

    case CommandCode.SetExceptionBreakpoints:
      return decodeSetExceptionBreakpointsRequest(payload);

    case CommandCode.ExitChannel:
      return { kind: 'exit_channel' };

    default:
      throw new Error(`BDP wire-codec: unknown command code ${command}`);
  }
}

function decodeVariablesRequest(payload: Buffer): Extract<BdpRequest, { kind: 'variables' }> {
  // payload: [command:4][flags:1][thread:4][frame:4][path_len:4][path strings...]
  const variableRequestFlags = payload.readUInt8(4);
  const threadId = payload.readUInt32LE(5);
  const frameIdx = payload.readUInt32LE(9);
  const pathLen = payload.readUInt32LE(13);
  let offset = 17;

  const varPath: string[] = [];
  for (let i = 0; i < pathLen; i++) {
    const { value, nextOffset } = readNullTerminatedString(payload, offset);
    varPath.push(value);
    offset = nextOffset;
  }

  const result: Extract<BdpRequest, { kind: 'variables' }> = {
    kind: 'variables',
    threadId,
    frameIdx,
  };
  if (varPath.length > 0) result.varPath = varPath;
  if (variableRequestFlags & 0x01) result.getChildKeys = true;
  if (variableRequestFlags & 0x04) result.getVirtualKeys = true;

  return result;
}

function decodeAddBreakpointsRequest(
  payload: Buffer,
): Extract<BdpRequest, { kind: 'add_breakpoints' }> {
  const numBreakpoints = payload.readUInt32LE(4);
  let offset = 8;
  const breakpoints: Array<{ file: string; line: number; ignoreCount?: number }> = [];
  for (let i = 0; i < numBreakpoints; i++) {
    const { value: file, nextOffset } = readNullTerminatedString(payload, offset);
    offset = nextOffset;
    const line = payload.readUInt32LE(offset);
    const ignoreCount = payload.readUInt32LE(offset + 4);
    offset += 8;
    const bp: { file: string; line: number; ignoreCount?: number } = { file, line };
    if (ignoreCount !== 0) bp.ignoreCount = ignoreCount;
    breakpoints.push(bp);
  }
  return { kind: 'add_breakpoints', breakpoints };
}

function decodeAddConditionalBreakpointsRequest(
  payload: Buffer,
): Extract<BdpRequest, { kind: 'add_conditional_breakpoints' }> {
  const numBreakpoints = payload.readUInt32LE(8); // skip command(4) + flags(4)
  let offset = 12;
  const breakpoints: Array<{
    file: string;
    line: number;
    ignoreCount?: number;
    conditionalExpression: string;
  }> = [];
  for (let i = 0; i < numBreakpoints; i++) {
    const { value: file, nextOffset: o1 } = readNullTerminatedString(payload, offset);
    offset = o1;
    const line = payload.readUInt32LE(offset);
    const ignoreCount = payload.readUInt32LE(offset + 4);
    offset += 8;
    const { value: conditionalExpression, nextOffset: o2 } = readNullTerminatedString(
      payload,
      offset,
    );
    offset = o2;
    const bp: { file: string; line: number; ignoreCount?: number; conditionalExpression: string } =
      {
        file,
        line,
        conditionalExpression,
      };
    if (ignoreCount !== 0) bp.ignoreCount = ignoreCount;
    breakpoints.push(bp);
  }
  return { kind: 'add_conditional_breakpoints', breakpoints };
}

function decodeRemoveBreakpointsRequest(
  payload: Buffer,
): Extract<BdpRequest, { kind: 'remove_breakpoints' }> {
  const numIds = payload.readUInt32LE(4);
  const ids: number[] = [];
  for (let i = 0; i < numIds; i++) {
    ids.push(payload.readUInt32LE(8 + i * 4));
  }
  return { kind: 'remove_breakpoints', ids };
}

function decodeSetExceptionBreakpointsRequest(
  payload: Buffer,
): Extract<BdpRequest, { kind: 'set_exception_breakpoints' }> {
  const numFilters = payload.readUInt32LE(4);
  let offset = 8;
  const filters: Array<{ filterTypeId: 1 | 2; conditionExpression: string }> = [];
  for (let i = 0; i < numFilters; i++) {
    const filterTypeId = payload.readUInt32LE(offset) as 1 | 2;
    offset += 4;
    const { value: conditionExpression, nextOffset } = readNullTerminatedString(payload, offset);
    offset = nextOffset;
    filters.push({ filterTypeId, conditionExpression });
  }
  return { kind: 'set_exception_breakpoints', filters };
}

// ---------------------------------------------------------------------------
// Response codec
// ---------------------------------------------------------------------------

/**
 * Response kind discriminator codes embedded in response payloads.
 * These are the CommandCode values that produced each response kind.
 * (Self-describing encoding -- see module-level comment.)
 */
const RES_KIND_DISC: Record<string, number> = {
  paused: CommandCode.Stop,
  continued: CommandCode.Continue,
  stepped: CommandCode.Step,
  threads: CommandCode.Threads,
  stack_trace: CommandCode.StackTrace,
  variables: CommandCode.Variables,
  eval: CommandCode.Execute,
  breakpoints_added: CommandCode.AddBreakpoints,
  conditional_breakpoints_added: CommandCode.AddConditionalBreakpoints,
  breakpoints_removed: CommandCode.RemoveBreakpoints,
  breakpoints_list: CommandCode.ListBreakpoints,
  exception_breakpoints_set: CommandCode.SetExceptionBreakpoints,
  exited: CommandCode.ExitChannel,
};

const RES_DISC_TO_KIND: Record<number, string> = Object.fromEntries(
  Object.entries(RES_KIND_DISC).map(([kind, disc]) => [disc, kind]),
);

/**
 * Encode a BdpResponse into a frame-layer payload.
 *
 * @param res - The logical response to encode.
 * @param requestId - The request_id echoed from the triggering request.
 * @returns { packetType: requestId, payload: [error_code:4LE][kind_disc:4LE][data...] }
 *
 * @throws For 'connected' (handshake) and 'error' (client-side sentinel) kinds.
 */
export function encodeResponse(
  res: BdpResponse,
  requestId: number,
): { packetType: number; payload: Buffer } {
  const payload = encodeResponsePayload(res);
  return { packetType: requestId, payload };
}

function encodeResponsePayload(res: BdpResponse): Buffer {
  if (res.kind === 'connected') {
    throw new Error(
      'BDP wire-codec: connected responses use the handshake frame (decodeHandshakeResponse), not encodeResponse',
    );
  }
  if (res.kind === 'error') {
    throw new Error(
      'BDP wire-codec: error responses are client-side sentinels and have no wire encoding',
    );
  }

  const disc = RES_KIND_DISC[res.kind];
  if (disc === undefined) {
    throw new Error(`BDP wire-codec: unknown response kind '${res.kind}'`);
  }

  const header = Buffer.alloc(8); // error_code(4) + kind_disc(4)
  header.writeUInt32LE(ERROR_CODE_OK, 0);
  header.writeUInt32LE(disc, 4);

  const body = encodeResponseBody(res);
  return Buffer.concat([header, body]);
}

function encodeResponseBody(res: BdpResponse): Buffer {
  switch (res.kind) {
    case 'paused':
    case 'continued':
    case 'stepped':
    case 'exited':
      return Buffer.alloc(0);

    case 'threads': {
      const countBuf = Buffer.alloc(4);
      countBuf.writeUInt32LE(res.threads.length, 0);
      const parts: Buffer[] = [countBuf];
      for (const t of res.threads) parts.push(encodeThreadEntry(t));
      return Buffer.concat(parts);
    }

    case 'stack_trace': {
      const countBuf = Buffer.alloc(4);
      countBuf.writeUInt32LE(res.frames.length, 0);
      const parts: Buffer[] = [countBuf];
      for (const f of res.frames) parts.push(encodeStackFrame(f));
      return Buffer.concat(parts);
    }

    case 'variables': {
      const countBuf = Buffer.alloc(4);
      countBuf.writeUInt32LE(res.variables.length, 0);
      const parts: Buffer[] = [countBuf];
      for (const v of res.variables) parts.push(encodeVariable(v));
      return Buffer.concat(parts);
    }

    case 'eval': {
      return encodeEvalResponse(res);
    }

    case 'breakpoints_added':
    case 'conditional_breakpoints_added':
    case 'breakpoints_removed':
    case 'breakpoints_list': {
      return encodeBreakpointEntries(res.entries);
    }

    case 'exception_breakpoints_set': {
      const countBuf = Buffer.alloc(4);
      countBuf.writeUInt32LE(res.entries.length, 0);
      const parts: Buffer[] = [countBuf];
      for (const e of res.entries) {
        const b = Buffer.alloc(8);
        b.writeUInt32LE(e.filterTypeId, 0);
        b.writeUInt32LE(e.errorCode, 4);
        parts.push(b);
      }
      return Buffer.concat(parts);
    }

    // These cases are handled before this function is called.
    case 'connected':
    case 'error':
      return Buffer.alloc(0);

    default: {
      const exhaustive: never = res;
      throw new Error(
        `BDP wire-codec: unhandled response kind: ${(exhaustive as BdpResponse).kind}`,
      );
    }
  }
}

function encodeEvalResponse(res: Extract<BdpResponse, { kind: 'eval' }>): Buffer {
  const parts: Buffer[] = [];

  // [execute_success:1][runtime_stop_code:1]
  const header = Buffer.alloc(2);
  header[0] = res.success ? 1 : 0;
  header[1] = res.runtimeStopReason ? encodeStopReason32(res.runtimeStopReason) : 0;
  parts.push(header);

  parts.push(encodeStringList(res.compileErrors));
  parts.push(encodeStringList(res.runtimeErrors));
  parts.push(encodeStringList(res.otherErrors));

  return Buffer.concat(parts);
}

/**
 * Decode a frame-layer payload into a BdpResponse.
 *
 * @param packetType - The "packetType" from decodeFrame (= wire request_id).
 * @param payload - The payload bytes from decodeFrame ([error_code:4LE][kind_disc:4LE][data...]).
 * @returns { res, requestId: packetType }
 *
 * @throws For unknown kind discriminators or malformed payloads.
 *
 * NOTE: This function uses the self-describing layout (kind_disc embedded in payload).
 * For real-wire-compatible decoding use decodeResponseAs() instead.
 */
export function decodeResponse(
  packetType: number,
  payload: Buffer,
): { res: BdpResponse; requestId: number } {
  if (payload.length < 8) throw new Error('BDP wire-codec: response payload too short');
  // errorCode is at offset 0 (available for callers that need it, e.g. error handling).
  // We don't surface it into BdpResponse directly -- success is implied by non-error kinds.
  const disc = payload.readUInt32LE(4);
  const kind = RES_DISC_TO_KIND[disc];
  if (!kind) throw new Error(`BDP wire-codec: unknown response kind discriminator ${disc}`);
  const res = decodeResponseBody(kind, payload, 8);
  return { res, requestId: packetType };
}

// ---------------------------------------------------------------------------
// Real-wire-compatible response codec (no embedded kind discriminator)
// ---------------------------------------------------------------------------
//
// On the real BDP wire a response payload is:
//   [error_code:4LE][data...]
// There is no embedded kind discriminator. The caller (BdpClient) must supply
// the expected response kind by looking up the request_id in its pending-request map.
//
// encodeResponseAs / decodeResponseAs produce and consume this real-wire format.
// The mock BDP server (T7) uses encodeResponseAs so that test bytes are
// real-wire-compatible.

/**
 * Encode a BdpResponse into a real-wire-compatible frame-layer payload.
 *
 * Real wire layout: [error_code:4LE][data...]  (no kind discriminator)
 *
 * @param kind      - The BdpResponse['kind'] discriminant that determines encoding.
 * @param res       - The response value to encode.
 * @param requestId - The request_id to echo back (becomes the frame packetType).
 * @param errorCode - Optional response-level error code (default 0 = OK).
 *                    Non-zero values are used by the mock server to simulate
 *                    device-side protocol errors (e.g. thread-gone).  When
 *                    errorCode != 0 the body is still encoded but the client
 *                    will reject the pending request (see BdpClient.onData).
 * @returns { packetType: requestId, payload: [error_code:4LE][data...] }
 *
 * @throws For 'connected' and 'error' kinds (same as encodeResponse).
 */
export function encodeResponseAs<K extends BdpResponse['kind']>(
  kind: K,
  res: Extract<BdpResponse, { kind: K }>,
  requestId: number,
  errorCode?: number,
): { packetType: number; payload: Buffer } {
  if (kind === 'connected') {
    throw new Error(
      'BDP wire-codec: connected responses use the handshake frame (decodeHandshakeResponse), not encodeResponseAs',
    );
  }
  if (kind === 'error') {
    throw new Error(
      'BDP wire-codec: error responses are client-side sentinels and have no wire encoding',
    );
  }

  const header = Buffer.alloc(4); // error_code only (no kind discriminator)
  header.writeUInt32LE(errorCode ?? ERROR_CODE_OK, 0);

  const body = encodeResponseBody(res);
  return { packetType: requestId, payload: Buffer.concat([header, body]) };
}

/**
 * Decode a real-wire response payload into a typed BdpResponse.
 *
 * Real wire layout: [error_code:4LE][data...]  (no kind discriminator)
 * The caller must supply the expected kind (looked up from the pending-request map).
 *
 * @param kind    - The expected BdpResponse['kind'] (from the originating request).
 * @param payload - The payload bytes from decodeFrame.
 * @returns { res: Extract<BdpResponse, { kind: K }>, errorCode: number }
 *   `errorCode` is the response-level error code from the wire (0 = OK).
 *   BdpClient checks this and rejects the pending request when errorCode != 0.
 *
 * NOTE: The returned requestId is always the frame's packetType (passed in separately
 * to BdpClient), but this function receives only the payload. The caller already has
 * the requestId from decodeFrame's packetType field. We return a plain `res` here.
 *
 * @throws For malformed payloads.
 */
export function decodeResponseAs<K extends BdpResponse['kind']>(
  kind: K,
  payload: Buffer,
): { res: Extract<BdpResponse, { kind: K }>; errorCode: number } {
  if (payload.length < 4)
    throw new Error('BDP wire-codec: response payload too short (decodeResponseAs)');
  const errorCode = payload.readUInt32LE(0);
  // Body starts at offset 4 (after the error_code field).
  const res = decodeResponseBody(kind as string, payload, 4) as Extract<BdpResponse, { kind: K }>;
  return { res, errorCode };
}

function decodeResponseBody(kind: string, payload: Buffer, bodyOffset: number): BdpResponse {
  switch (kind) {
    case 'paused':
      return { kind: 'paused' };

    case 'continued':
      return { kind: 'continued' };

    case 'stepped':
      return { kind: 'stepped' };

    case 'exited':
      return { kind: 'exited' };

    case 'threads': {
      const numThreads = payload.readUInt32LE(bodyOffset);
      let offset = bodyOffset + 4;
      const threads: BdpThreadEntry[] = [];
      for (let i = 0; i < numThreads; i++) {
        const { entry, nextOffset } = decodeThreadEntry(payload, offset, i);
        threads.push(entry);
        offset = nextOffset;
      }
      return { kind: 'threads', threads };
    }

    case 'stack_trace': {
      const stackSize = payload.readUInt32LE(bodyOffset);
      let offset = bodyOffset + 4;
      const frames: BdpStackFrame[] = [];
      for (let i = 0; i < stackSize; i++) {
        const { frame, nextOffset } = decodeStackFrame(payload, offset, i);
        frames.push(frame);
        offset = nextOffset;
      }
      return { kind: 'stack_trace', frames };
    }

    case 'variables': {
      const numVars = payload.readUInt32LE(bodyOffset);
      let offset = bodyOffset + 4;
      const variables: BdpVariable[] = [];
      for (let i = 0; i < numVars; i++) {
        const { variable, nextOffset } = decodeVariable(payload, offset);
        variables.push(variable);
        offset = nextOffset;
      }
      return { kind: 'variables', variables };
    }

    case 'eval': {
      return decodeEvalResponse(payload, bodyOffset);
    }

    case 'breakpoints_added': {
      const { entries } = decodeBreakpointEntries(payload, bodyOffset);
      return { kind: 'breakpoints_added', entries };
    }

    case 'conditional_breakpoints_added': {
      const { entries } = decodeBreakpointEntries(payload, bodyOffset);
      return { kind: 'conditional_breakpoints_added', entries };
    }

    case 'breakpoints_removed': {
      const { entries } = decodeBreakpointEntries(payload, bodyOffset);
      return { kind: 'breakpoints_removed', entries };
    }

    case 'breakpoints_list': {
      const { entries } = decodeBreakpointEntries(payload, bodyOffset);
      return { kind: 'breakpoints_list', entries };
    }

    case 'exception_breakpoints_set': {
      const count = payload.readUInt32LE(bodyOffset);
      let offset = bodyOffset + 4;
      const entries: Array<{ filterTypeId: number; errorCode: number }> = [];
      for (let i = 0; i < count; i++) {
        const filterTypeId = payload.readUInt32LE(offset);
        const errorCode = payload.readUInt32LE(offset + 4);
        offset += 8;
        entries.push({ filterTypeId, errorCode });
      }
      return { kind: 'exception_breakpoints_set', entries };
    }

    default:
      throw new Error(`BDP wire-codec: unhandled response kind in decode: ${kind}`);
  }
}

function decodeEvalResponse(
  payload: Buffer,
  offset: number,
): Extract<BdpResponse, { kind: 'eval' }> {
  const success = payload.readUInt8(offset) !== 0;
  const runtimeStopCode = payload.readUInt8(offset + 1);
  offset += 2;

  const { values: compileErrors, nextOffset: o1 } = decodeStringList(payload, offset);
  const { values: runtimeErrors, nextOffset: o2 } = decodeStringList(payload, o1);
  const { values: otherErrors } = decodeStringList(payload, o2);

  const res: Extract<BdpResponse, { kind: 'eval' }> = {
    kind: 'eval',
    success,
    compileErrors,
    runtimeErrors,
    otherErrors,
  };

  if (runtimeStopCode !== 0) {
    res.runtimeStopReason = decodeStopReason8(runtimeStopCode);
  }

  return res;
}

// ---------------------------------------------------------------------------
// Update event codec
// ---------------------------------------------------------------------------

/**
 * Encode a BdpUpdateEvent into a frame-layer payload.
 *
 * @param event - The async update event to encode.
 * @returns { packetType: 0, payload: [error_code:4LE][update_type:4LE][data...] }
 *   packetType is always 0 (request_id == 0 for all updates, doc §1.5).
 */
export function encodeUpdateEvent(event: BdpUpdateEvent): { packetType: number; payload: Buffer } {
  const updateType = eventKindToUpdateType(event.kind);

  const header = Buffer.alloc(8); // error_code(4) + update_type(4)
  header.writeUInt32LE(ERROR_CODE_OK, 0);
  header.writeUInt32LE(updateType, 4);

  const body = encodeUpdateEventBody(event);
  return { packetType: 0, payload: Buffer.concat([header, body]) };
}

function eventKindToUpdateType(kind: BdpUpdateEvent['kind']): number {
  switch (kind) {
    case 'io_port_opened':
      return UpdateTypeCode.IOPortOpened;
    case 'stopped':
      return UpdateTypeCode.AllThreadsStopped;
    case 'thread_attached':
      return UpdateTypeCode.ThreadAttached;
    case 'breakpoint_error':
      return UpdateTypeCode.BreakpointError;
    case 'compile_error':
      return UpdateTypeCode.CompileError;
    case 'breakpoint_verified':
      return UpdateTypeCode.BreakpointVerified;
    case 'protocol_error':
      return UpdateTypeCode.ProtocolError;
    case 'exception_breakpoint_error':
      return UpdateTypeCode.ExceptionBreakpointError;
    default: {
      const exhaustive: never = kind;
      throw new Error(`BDP wire-codec: unknown update event kind: ${exhaustive as string}`);
    }
  }
}

function encodeUpdateEventBody(event: BdpUpdateEvent): Buffer {
  switch (event.kind) {
    case 'stopped':
    case 'thread_attached': {
      // [thread_index:4][stop_reason:1][stop_reason_detail:UTF-8Z]
      const parts: Buffer[] = [];
      const header = Buffer.alloc(5);
      header.writeInt32LE(event.threadId, 0);
      header.writeUInt8(encodeStopReason32(event.stopReason), 4);
      parts.push(header);
      parts.push(writeNullTerminatedString(event.stopReasonDetail));
      return Buffer.concat(parts);
    }

    case 'io_port_opened': {
      const b = Buffer.alloc(4);
      b.writeInt32LE(event.port, 0);
      return b;
    }

    case 'compile_error': {
      const parts: Buffer[] = [];
      const flagsBuf = Buffer.alloc(4);
      flagsBuf.writeUInt32LE(0, 0); // flags = 0 (reserved)
      parts.push(flagsBuf);
      parts.push(writeNullTerminatedString(event.message));
      parts.push(writeNullTerminatedString(event.file));
      const lineBuf = Buffer.alloc(4);
      lineBuf.writeUInt32LE(event.line, 0);
      parts.push(lineBuf);
      parts.push(writeNullTerminatedString(event.libraryName));
      return Buffer.concat(parts);
    }

    case 'breakpoint_error': {
      const parts: Buffer[] = [];
      const header = Buffer.alloc(8); // flags(4) + breakpoint_id(4)
      header.writeUInt32LE(0, 0); // flags = 0 (reserved)
      header.writeUInt32LE(event.breakpointId, 4);
      parts.push(header);
      parts.push(encodeStringList(event.compileErrors));
      parts.push(encodeStringList(event.runtimeErrors));
      parts.push(encodeStringList(event.otherErrors));
      return Buffer.concat(parts);
    }

    case 'breakpoint_verified': {
      const parts: Buffer[] = [];
      const header = Buffer.alloc(8); // flags(4) + breakpoint_count(4)
      header.writeUInt32LE(0, 0); // flags = 0
      header.writeUInt32LE(event.breakpointIds.length, 4);
      parts.push(header);
      for (const id of event.breakpointIds) {
        const b = Buffer.alloc(4);
        b.writeUInt32LE(id, 0);
        parts.push(b);
      }
      return Buffer.concat(parts);
    }

    case 'protocol_error':
      return Buffer.alloc(0);

    case 'exception_breakpoint_error': {
      const parts: Buffer[] = [];
      const header = Buffer.alloc(8); // flags(4) + filter_id(4)
      header.writeUInt32LE(0, 0); // flags = 0
      header.writeUInt32LE(event.filterId, 4);
      parts.push(header);
      parts.push(encodeStringList(event.compileErrors));
      parts.push(encodeStringList(event.runtimeErrors));
      parts.push(encodeStringList(event.otherErrors));
      const tail = Buffer.alloc(4);
      tail.writeInt32LE(event.line, 0);
      parts.push(tail);
      parts.push(writeNullTerminatedString(event.file));
      return Buffer.concat(parts);
    }

    default: {
      const exhaustive: never = event;
      throw new Error(
        `BDP wire-codec: unhandled update event kind: ${(exhaustive as BdpUpdateEvent).kind}`,
      );
    }
  }
}

/**
 * Decode a frame-layer payload into a BdpUpdateEvent.
 *
 * @param packetType - The "packetType" from decodeFrame (must be 0 for updates).
 * @param payload - The payload bytes from decodeFrame ([error_code:4LE][update_type:4LE][data...]).
 * @returns Decoded BdpUpdateEvent.
 *
 * @throws For unknown update type codes or malformed payloads.
 */
export function decodeUpdateEvent(packetType: number, payload: Buffer): BdpUpdateEvent {
  void packetType; // must be 0; validated by caller via isUpdateEventPacket
  if (payload.length < 8) throw new Error('BDP wire-codec: update event payload too short');
  // error_code at offset 0 (not surfaced into event types -- events don't carry per-event errors).
  const updateType = payload.readUInt32LE(4);
  return decodeUpdateEventBody(updateType, payload, 8);
}

function decodeUpdateEventBody(
  updateType: number,
  payload: Buffer,
  offset: number,
): BdpUpdateEvent {
  switch (updateType) {
    case UpdateTypeCode.AllThreadsStopped: {
      const threadId = payload.readInt32LE(offset);
      const stopReasonCode = payload.readUInt8(offset + 4);
      const { value: stopReasonDetail } = readNullTerminatedString(payload, offset + 5);
      return {
        kind: 'stopped',
        threadId,
        stopReason: decodeStopReason8(stopReasonCode),
        stopReasonDetail,
      };
    }

    case UpdateTypeCode.ThreadAttached: {
      const threadId = payload.readInt32LE(offset);
      const stopReasonCode = payload.readUInt8(offset + 4);
      const { value: stopReasonDetail } = readNullTerminatedString(payload, offset + 5);
      return {
        kind: 'thread_attached',
        threadId,
        stopReason: decodeStopReason8(stopReasonCode),
        stopReasonDetail,
      };
    }

    case UpdateTypeCode.IOPortOpened: {
      const port = payload.readInt32LE(offset);
      return { kind: 'io_port_opened', port };
    }

    case UpdateTypeCode.CompileError: {
      // flags(4) reserved
      let o = offset + 4;
      const { value: message, nextOffset: o1 } = readNullTerminatedString(payload, o);
      const { value: file, nextOffset: o2 } = readNullTerminatedString(payload, o1);
      const line = payload.readUInt32LE(o2);
      const { value: libraryName } = readNullTerminatedString(payload, o2 + 4);
      return { kind: 'compile_error', message, file, line, libraryName };
    }

    case UpdateTypeCode.BreakpointError: {
      // flags(4) + breakpoint_id(4)
      const breakpointId = payload.readUInt32LE(offset + 4);
      let o = offset + 8;
      const { values: compileErrors, nextOffset: o1 } = decodeStringList(payload, o);
      const { values: runtimeErrors, nextOffset: o2 } = decodeStringList(payload, o1);
      const { values: otherErrors } = decodeStringList(payload, o2);
      return { kind: 'breakpoint_error', breakpointId, compileErrors, runtimeErrors, otherErrors };
    }

    case UpdateTypeCode.BreakpointVerified: {
      // flags(4) + breakpoint_count(4) + ids[]
      const count = payload.readUInt32LE(offset + 4);
      let o = offset + 8;
      const breakpointIds: number[] = [];
      for (let i = 0; i < count; i++) {
        breakpointIds.push(payload.readUInt32LE(o));
        o += 4;
      }
      return { kind: 'breakpoint_verified', breakpointIds };
    }

    case UpdateTypeCode.ProtocolError:
      return { kind: 'protocol_error' };

    case UpdateTypeCode.ExceptionBreakpointError: {
      // flags(4) + filter_id(4) + errors + line(4) + file
      const filterId = payload.readUInt32LE(offset + 4);
      let o = offset + 8;
      const { values: compileErrors, nextOffset: o1 } = decodeStringList(payload, o);
      const { values: runtimeErrors, nextOffset: o2 } = decodeStringList(payload, o1);
      const { values: otherErrors, nextOffset: o3 } = decodeStringList(payload, o2);
      const line = payload.readInt32LE(o3);
      const { value: file } = readNullTerminatedString(payload, o3 + 4);
      return {
        kind: 'exception_breakpoint_error',
        filterId,
        compileErrors,
        runtimeErrors,
        otherErrors,
        line,
        file,
      };
    }

    default:
      throw new Error(`BDP wire-codec: unknown update type code ${updateType}`);
  }
}
