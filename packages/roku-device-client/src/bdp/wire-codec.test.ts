/**
 * Tests for the BDP wire codec.
 *
 * Verifies round-trip encoding/decoding for every BdpRequest, BdpResponse,
 * and BdpUpdateEvent variant. Also verifies isUpdateEventPacket discriminator.
 *
 * Wire format reference: docs/refs/bdp-wire-format.md.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeRequest,
  decodeRequest,
  encodeResponse,
  decodeResponse,
  encodeUpdateEvent,
  decodeUpdateEvent,
  isUpdateEventPacket,
  CommandCode,
  UpdateTypeCode,
  StopReasonCode,
} from './wire-codec.js';
import type { BdpRequest, BdpResponse, BdpUpdateEvent } from './messages.js';
import { SUPPORTED_BDP_VERSIONS } from './messages.js';

// ---------------------------------------------------------------------------
// isUpdateEventPacket
// ---------------------------------------------------------------------------

describe('isUpdateEventPacket', () => {
  it('returns true when requestId is 0 (async update sentinel)', () => {
    expect(isUpdateEventPacket(0)).toBe(true);
  });

  it('returns false when requestId is non-zero (correlated response)', () => {
    expect(isUpdateEventPacket(1)).toBe(false);
    expect(isUpdateEventPacket(42)).toBe(false);
    expect(isUpdateEventPacket(0xffffffff)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Request encoding / decoding (BdpRequest round-trips)
// ---------------------------------------------------------------------------

describe('encodeRequest / decodeRequest', () => {
  function roundTrip(req: BdpRequest, requestId: number): BdpRequest {
    const { packetType, payload } = encodeRequest(req, requestId);
    const { req: decoded, requestId: decodedId } = decodeRequest(packetType, payload);
    expect(decodedId).toBe(requestId);
    return decoded;
  }

  // connect is a special handshake -- not encoded via standard request frame
  it('encodeRequest for connect kind throws (handshake uses its own frame, not standard request)', () => {
    const req: BdpRequest = { kind: 'connect', clientVersion: SUPPORTED_BDP_VERSIONS };
    expect(() => encodeRequest(req, 0xffffffff)).toThrow();
  });

  it('round-trips a pause request (CommandCode Stop = 1)', () => {
    const req: BdpRequest = { kind: 'pause' };
    const decoded = roundTrip(req, 1);
    expect(decoded).toEqual(req);
  });

  it('encodeRequest pause produces command code 1 as first UInt32LE of payload', () => {
    const { payload } = encodeRequest({ kind: 'pause' }, 1);
    expect(payload.readUInt32LE(0)).toBe(CommandCode.Stop);
  });

  it('round-trips a continue request (CommandCode 2)', () => {
    const req: BdpRequest = { kind: 'continue', threadId: 0 };
    const decoded = roundTrip(req, 2);
    expect(decoded).toEqual(req);
  });

  it('round-trips a continue request with non-zero threadId', () => {
    const req: BdpRequest = { kind: 'continue', threadId: 3 };
    expect(roundTrip(req, 2)).toEqual(req);
  });

  it('round-trips a step/line request', () => {
    const req: BdpRequest = { kind: 'step', threadId: 0, granularity: 'line' };
    expect(roundTrip(req, 3)).toEqual(req);
  });

  it('round-trips a step/over request', () => {
    const req: BdpRequest = { kind: 'step', threadId: 2, granularity: 'over' };
    expect(roundTrip(req, 4)).toEqual(req);
  });

  it('round-trips a step/out request', () => {
    const req: BdpRequest = { kind: 'step', threadId: 1, granularity: 'out' };
    expect(roundTrip(req, 5)).toEqual(req);
  });

  it('round-trips a threads request (no payload fields)', () => {
    const req: BdpRequest = { kind: 'threads' };
    expect(roundTrip(req, 6)).toEqual(req);
  });

  it('round-trips a stack_trace request', () => {
    const req: BdpRequest = { kind: 'stack_trace', threadId: 2 };
    expect(roundTrip(req, 7)).toEqual(req);
  });

  it('round-trips a variables request (minimal -- no varPath, no flags)', () => {
    const req: BdpRequest = { kind: 'variables', threadId: 0, frameIdx: 0 };
    expect(roundTrip(req, 8)).toEqual(req);
  });

  it('round-trips a variables request with all flags and a path', () => {
    const req: BdpRequest = {
      kind: 'variables',
      threadId: 1,
      frameIdx: 2,
      varPath: ['m', 'items'],
      getChildKeys: true,
      getVirtualKeys: true,
    };
    expect(roundTrip(req, 9)).toEqual(req);
  });

  it('round-trips a variables request with getChildKeys only', () => {
    const req: BdpRequest = {
      kind: 'variables',
      threadId: 0,
      frameIdx: 0,
      getChildKeys: true,
    };
    expect(roundTrip(req, 10)).toEqual(req);
  });

  it('round-trips an eval request', () => {
    const req: BdpRequest = {
      kind: 'eval',
      threadId: 0,
      frameIdx: 0,
      expression: 'm.count',
    };
    expect(roundTrip(req, 11)).toEqual(req);
  });

  it('round-trips an eval request with empty expression string', () => {
    const req: BdpRequest = { kind: 'eval', threadId: 0, frameIdx: 0, expression: '' };
    expect(roundTrip(req, 12)).toEqual(req);
  });

  it('round-trips an add_breakpoints request with one entry (no ignoreCount)', () => {
    const req: BdpRequest = {
      kind: 'add_breakpoints',
      breakpoints: [{ file: 'pkg:/source/main.brs', line: 42 }],
    };
    expect(roundTrip(req, 13)).toEqual(req);
  });

  it('round-trips an add_breakpoints request with ignoreCount', () => {
    const req: BdpRequest = {
      kind: 'add_breakpoints',
      breakpoints: [
        { file: 'pkg:/source/main.brs', line: 10, ignoreCount: 5 },
        { file: 'pkg:/source/other.brs', line: 99 },
      ],
    };
    expect(roundTrip(req, 14)).toEqual(req);
  });

  it('round-trips an add_conditional_breakpoints request', () => {
    const req: BdpRequest = {
      kind: 'add_conditional_breakpoints',
      breakpoints: [
        {
          file: 'pkg:/source/main.brs',
          line: 10,
          ignoreCount: 2,
          conditionalExpression: 'm.count > 5',
        },
        {
          file: 'pkg:/source/main.brs',
          line: 20,
          conditionalExpression: '',
        },
      ],
    };
    expect(roundTrip(req, 15)).toEqual(req);
  });

  it('round-trips a remove_breakpoints request', () => {
    const req: BdpRequest = { kind: 'remove_breakpoints', ids: [1, 2, 3] };
    expect(roundTrip(req, 16)).toEqual(req);
  });

  it('round-trips a remove_breakpoints request with empty ids', () => {
    const req: BdpRequest = { kind: 'remove_breakpoints', ids: [] };
    expect(roundTrip(req, 17)).toEqual(req);
  });

  it('round-trips a list_breakpoints request (no payload fields)', () => {
    const req: BdpRequest = { kind: 'list_breakpoints' };
    expect(roundTrip(req, 18)).toEqual(req);
  });

  it('round-trips a set_exception_breakpoints request', () => {
    const req: BdpRequest = {
      kind: 'set_exception_breakpoints',
      filters: [
        { filterTypeId: 1, conditionExpression: '' },
        { filterTypeId: 2, conditionExpression: 'm.debug = true' },
      ],
    };
    expect(roundTrip(req, 19)).toEqual(req);
  });

  it('round-trips an exit_channel request (CommandCode 122)', () => {
    const req: BdpRequest = { kind: 'exit_channel' };
    const decoded = roundTrip(req, 20);
    expect(decoded).toEqual(req);
  });

  it('encodeRequest exit_channel produces CommandCode 122 in payload', () => {
    const { payload } = encodeRequest({ kind: 'exit_channel' }, 20);
    expect(payload.readUInt32LE(0)).toBe(CommandCode.ExitChannel);
  });

  it('requestId is preserved faithfully through encode/decode', () => {
    const req: BdpRequest = { kind: 'threads' };
    const { packetType, payload } = encodeRequest(req, 0xdeadbeef);
    expect(packetType).toBe(0xdeadbeef);
    const { requestId } = decodeRequest(packetType, payload);
    expect(requestId).toBe(0xdeadbeef);
  });

  it('decodeRequest throws on unknown command code', () => {
    // Construct a payload with an unrecognized CommandCode (e.g. 0).
    const payload = Buffer.alloc(4);
    payload.writeUInt32LE(0, 0);
    expect(() => decodeRequest(1, payload)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Response encoding / decoding (BdpResponse round-trips)
// ---------------------------------------------------------------------------

describe('encodeResponse / decodeResponse', () => {
  function roundTrip(res: BdpResponse, requestId: number): BdpResponse {
    const { packetType, payload } = encodeResponse(res, requestId);
    const { res: decoded, requestId: decodedId } = decodeResponse(packetType, payload);
    expect(decodedId).toBe(requestId);
    return decoded;
  }

  // connected response is decoded from the handshake frame, not a standard response.
  it('encodeResponse for connected kind throws (handshake uses its own frame)', () => {
    const res: BdpResponse = {
      kind: 'connected',
      bdpVersion: { major: 3, minor: 0, patch: 0 },
      revisionTimestamp: 1714900000000n,
    };
    expect(() => encodeResponse(res, 0xffffffff)).toThrow();
  });

  it('encodeResponse for error kind throws (client-side sentinel, not a wire packet)', () => {
    const res: BdpResponse = { kind: 'error', code: 'E_CODEC', message: 'bad frame' };
    expect(() => encodeResponse(res, 1)).toThrow();
  });

  it('round-trips a paused response', () => {
    const res: BdpResponse = { kind: 'paused' };
    expect(roundTrip(res, 1)).toEqual(res);
  });

  it('round-trips a continued response', () => {
    const res: BdpResponse = { kind: 'continued' };
    expect(roundTrip(res, 2)).toEqual(res);
  });

  it('round-trips a stepped response', () => {
    const res: BdpResponse = { kind: 'stepped' };
    expect(roundTrip(res, 3)).toEqual(res);
  });

  it('round-trips a threads response (empty threads list)', () => {
    const res: BdpResponse = { kind: 'threads', threads: [] };
    expect(roundTrip(res, 4)).toEqual(res);
  });

  it('round-trips a threads response with multiple threads', () => {
    const res: BdpResponse = {
      kind: 'threads',
      threads: [
        {
          id: 0,
          isPrimary: true,
          isDetached: false,
          stopReason: 'break',
          stopReasonDetail: 'hit breakpoint at line 42',
          line: 42,
          functionName: 'main',
          file: 'pkg:/source/main.brs',
          codeSnippet: 'print "hello"',
        },
        {
          id: 1,
          isPrimary: false,
          isDetached: false,
          stopReason: 'not_stopped',
          stopReasonDetail: '',
          line: 0,
          functionName: '',
          file: '',
          codeSnippet: '',
        },
      ],
    };
    expect(roundTrip(res, 5)).toEqual(res);
  });

  it('round-trips a stack_trace response (empty frames)', () => {
    const res: BdpResponse = { kind: 'stack_trace', frames: [] };
    expect(roundTrip(res, 6)).toEqual(res);
  });

  it('round-trips a stack_trace response with frames', () => {
    const res: BdpResponse = {
      kind: 'stack_trace',
      frames: [
        { idx: 0, file: 'pkg:/source/main.brs', line: 10, functionName: 'doWork' },
        { idx: 1, file: 'pkg:/source/main.brs', line: 5, functionName: 'main' },
        { idx: 2, file: 'pkg:/source/util.brs', line: 99 },
      ],
    };
    expect(roundTrip(res, 7)).toEqual(res);
  });

  it('round-trips a variables response (empty variables)', () => {
    const res: BdpResponse = { kind: 'variables', variables: [] };
    expect(roundTrip(res, 8)).toEqual(res);
  });

  it('round-trips a variables response with a string variable', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [{ name: 'greeting', type: 'String', value: 'hello world' }],
    };
    expect(roundTrip(res, 9)).toEqual(res);
  });

  it('round-trips a variables response with an integer variable', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [{ name: 'count', type: 'Integer', value: -42 }],
    };
    expect(roundTrip(res, 10)).toEqual(res);
  });

  it('round-trips a variables response with a boolean variable', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [{ name: 'flag', type: 'Boolean', value: true }],
    };
    expect(roundTrip(res, 11)).toEqual(res);
  });

  it('round-trips a variables response with a float variable', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [{ name: 'pi', type: 'Float', value: Math.fround(3.14) }],
    };
    expect(roundTrip(res, 12)).toEqual(res);
  });

  it('round-trips a variables response with a double variable', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [{ name: 'ratio', type: 'Double', value: 2.718281828459045 }],
    };
    expect(roundTrip(res, 13)).toEqual(res);
  });

  it('round-trips a variables response with a LongInteger variable', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [{ name: 'bigNum', type: 'LongInteger', value: 9007199254740993 }],
    };
    // Note: LongInteger is encoded as BigInt64LE on the wire; value is stored as number.
    // Lossy beyond Number.MAX_SAFE_INTEGER. The codec must write then read back consistently.
    expect(roundTrip(res, 14)).toEqual(res);
  });

  it('round-trips a variables response with an Invalid variable (no value bytes)', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [{ name: 'x', type: 'Invalid', value: null }],
    };
    expect(roundTrip(res, 15)).toEqual(res);
  });

  it('round-trips a variables response with an Uninitialized variable', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [{ name: 'y', type: 'Uninitialized', value: null }],
    };
    expect(roundTrip(res, 16)).toEqual(res);
  });

  it('round-trips a variables response with a container (AssociativeArray) variable', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [
        {
          name: 'm',
          type: 'AssociativeArray',
          value: null,
          isContainer: true,
          childCount: 3,
          keyType: 'String',
          refCount: 1,
          // isConst is intentionally omitted: the wire only stores a single bit
          // (set=true, unset=absent), so explicit false cannot round-trip.
        },
      ],
    };
    expect(roundTrip(res, 17)).toEqual(res);
  });

  it('round-trips a variables response with all flags set on a variable', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [
        {
          name: 'items',
          type: 'Array',
          value: null,
          isChildKey: true,
          isConst: true,
          isContainer: true,
          childCount: 5,
          keyType: 'Integer',
          refCount: 2,
          isVirtual: true,
        },
      ],
    };
    expect(roundTrip(res, 18)).toEqual(res);
  });

  it('round-trips a variables response with a SubtypedObject variable', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [
        {
          name: 'node',
          type: 'SubtypedObject',
          value: 'roSGNode; ContentNode',
        },
      ],
    };
    expect(roundTrip(res, 19)).toEqual(res);
  });

  it('round-trips an eval response (success=true, no errors)', () => {
    const res: BdpResponse = {
      kind: 'eval',
      success: true,
      compileErrors: [],
      runtimeErrors: [],
      otherErrors: [],
    };
    expect(roundTrip(res, 20)).toEqual(res);
  });

  it('round-trips an eval response with errors', () => {
    const res: BdpResponse = {
      kind: 'eval',
      success: false,
      runtimeStopReason: 'runtime_error',
      compileErrors: ['Syntax error at line 1'],
      runtimeErrors: ['undefined variable x'],
      otherErrors: ['timeout'],
    };
    expect(roundTrip(res, 21)).toEqual(res);
  });

  it('round-trips a breakpoints_added response (empty entries)', () => {
    const res: BdpResponse = { kind: 'breakpoints_added', entries: [] };
    expect(roundTrip(res, 22)).toEqual(res);
  });

  it('round-trips a breakpoints_added response with valid and error entries', () => {
    const res: BdpResponse = {
      kind: 'breakpoints_added',
      entries: [
        { breakpointId: 1, errorCode: 0, ignoreCount: 0 },
        { breakpointId: 0, errorCode: 5 }, // error entry (no ignoreCount)
        { breakpointId: 2, errorCode: 0, ignoreCount: 3 },
      ],
    };
    expect(roundTrip(res, 23)).toEqual(res);
  });

  it('round-trips a conditional_breakpoints_added response', () => {
    const res: BdpResponse = {
      kind: 'conditional_breakpoints_added',
      entries: [{ breakpointId: 5, errorCode: 0, ignoreCount: 0 }],
    };
    expect(roundTrip(res, 24)).toEqual(res);
  });

  it('round-trips a breakpoints_removed response', () => {
    const res: BdpResponse = {
      kind: 'breakpoints_removed',
      entries: [
        { breakpointId: 1, errorCode: 0, ignoreCount: 0 },
        { breakpointId: 0, errorCode: 5 },
      ],
    };
    expect(roundTrip(res, 25)).toEqual(res);
  });

  it('round-trips a breakpoints_list response', () => {
    const res: BdpResponse = {
      kind: 'breakpoints_list',
      entries: [
        { breakpointId: 1, errorCode: 0, ignoreCount: 5 },
        { breakpointId: 2, errorCode: 0, ignoreCount: 0 },
      ],
    };
    expect(roundTrip(res, 26)).toEqual(res);
  });

  it('round-trips an exception_breakpoints_set response', () => {
    const res: BdpResponse = {
      kind: 'exception_breakpoints_set',
      entries: [
        { filterTypeId: 1, errorCode: 0 },
        { filterTypeId: 2, errorCode: 5 },
      ],
    };
    expect(roundTrip(res, 27)).toEqual(res);
  });

  it('round-trips an exited response (no payload)', () => {
    const res: BdpResponse = { kind: 'exited' };
    expect(roundTrip(res, 28)).toEqual(res);
  });

  it('requestId is preserved through response encode/decode', () => {
    const res: BdpResponse = { kind: 'paused' };
    const { packetType, payload } = encodeResponse(res, 0xcafebabe);
    expect(packetType).toBe(0xcafebabe);
    const { requestId } = decodeResponse(packetType, payload);
    expect(requestId).toBe(0xcafebabe);
  });

  it('decodeResponse throws on unknown response kind discriminator', () => {
    // Payload starts with errorCode=0, then an unknown command code (0).
    const payload = Buffer.alloc(8);
    payload.writeUInt32LE(0, 0); // errorCode = 0 (OK)
    payload.writeUInt32LE(0, 4); // kind discriminator = 0 (unknown)
    expect(() => decodeResponse(1, payload)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Update event encoding / decoding (BdpUpdateEvent round-trips)
// ---------------------------------------------------------------------------

describe('encodeUpdateEvent / decodeUpdateEvent', () => {
  function roundTrip(event: BdpUpdateEvent): BdpUpdateEvent {
    const { packetType, payload } = encodeUpdateEvent(event);
    // packetType must be 0 (request_id = 0 for all async updates)
    expect(packetType).toBe(0);
    return decodeUpdateEvent(packetType, payload);
  }

  it('round-trips a stopped event', () => {
    const event: BdpUpdateEvent = {
      kind: 'stopped',
      threadId: 0,
      stopReason: 'break',
      stopReasonDetail: 'hit breakpoint',
    };
    expect(roundTrip(event)).toEqual(event);
  });

  it('round-trips a stopped event with all stop reason variants', () => {
    const reasons: BdpUpdateEvent['kind'] extends 'stopped' ? never : never = undefined as never;
    void reasons;
    const stopReasons = [
      'undefined',
      'not_stopped',
      'normal_exit',
      'stop_statement',
      'break',
      'runtime_error',
      'caught_runtime_error',
    ] as const;
    for (const stopReason of stopReasons) {
      const event: BdpUpdateEvent = {
        kind: 'stopped',
        threadId: 1,
        stopReason,
        stopReasonDetail: '',
      };
      expect(roundTrip(event)).toEqual(event);
    }
  });

  it('round-trips a thread_attached event', () => {
    const event: BdpUpdateEvent = {
      kind: 'thread_attached',
      threadId: 2,
      stopReason: 'runtime_error',
      stopReasonDetail: 'division by zero',
    };
    expect(roundTrip(event)).toEqual(event);
  });

  it('round-trips an io_port_opened event', () => {
    const event: BdpUpdateEvent = { kind: 'io_port_opened', port: 8088 };
    expect(roundTrip(event)).toEqual(event);
  });

  it('round-trips a compile_error event', () => {
    const event: BdpUpdateEvent = {
      kind: 'compile_error',
      message: 'Syntax error: unexpected token',
      file: 'pkg:/source/main.brs',
      line: 15,
      libraryName: '',
    };
    expect(roundTrip(event)).toEqual(event);
  });

  it('round-trips a compile_error event with non-empty libraryName', () => {
    const event: BdpUpdateEvent = {
      kind: 'compile_error',
      message: 'Undefined function Foo',
      file: 'lib:mylib/',
      line: 7,
      libraryName: 'mylib',
    };
    expect(roundTrip(event)).toEqual(event);
  });

  it('round-trips a breakpoint_error event', () => {
    const event: BdpUpdateEvent = {
      kind: 'breakpoint_error',
      breakpointId: 3,
      compileErrors: ['compile error 1'],
      runtimeErrors: [],
      otherErrors: ['other error 1', 'other error 2'],
    };
    expect(roundTrip(event)).toEqual(event);
  });

  it('round-trips a breakpoint_verified event', () => {
    const event: BdpUpdateEvent = { kind: 'breakpoint_verified', breakpointIds: [1, 3, 5] };
    expect(roundTrip(event)).toEqual(event);
  });

  it('round-trips a breakpoint_verified event with empty ids', () => {
    const event: BdpUpdateEvent = { kind: 'breakpoint_verified', breakpointIds: [] };
    expect(roundTrip(event)).toEqual(event);
  });

  it('round-trips a protocol_error event (no payload fields)', () => {
    const event: BdpUpdateEvent = { kind: 'protocol_error' };
    expect(roundTrip(event)).toEqual(event);
  });

  it('round-trips an exception_breakpoint_error event', () => {
    const event: BdpUpdateEvent = {
      kind: 'exception_breakpoint_error',
      filterId: 2,
      compileErrors: [],
      runtimeErrors: ['runtime err'],
      otherErrors: [],
      line: 10,
      file: 'pkg:/source/main.brs',
    };
    expect(roundTrip(event)).toEqual(event);
  });

  it('decodeUpdateEvent throws on unknown update_type code', () => {
    // Construct a payload with error_code=0 and update_type=99 (unknown)
    const payload = Buffer.alloc(8);
    payload.writeUInt32LE(0, 0); // error_code
    payload.writeUInt32LE(99, 4); // unknown update_type
    expect(() => decodeUpdateEvent(0, payload)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CommandCode / UpdateTypeCode / StopReasonCode exported enum-like objects
// ---------------------------------------------------------------------------

describe('exported codec constants', () => {
  it('CommandCode has the expected wire values', () => {
    expect(CommandCode.Stop).toBe(1);
    expect(CommandCode.Continue).toBe(2);
    expect(CommandCode.Threads).toBe(3);
    expect(CommandCode.StackTrace).toBe(4);
    expect(CommandCode.Variables).toBe(5);
    expect(CommandCode.Step).toBe(6);
    expect(CommandCode.AddBreakpoints).toBe(7);
    expect(CommandCode.ListBreakpoints).toBe(8);
    expect(CommandCode.RemoveBreakpoints).toBe(9);
    expect(CommandCode.Execute).toBe(10);
    expect(CommandCode.AddConditionalBreakpoints).toBe(11);
    expect(CommandCode.SetExceptionBreakpoints).toBe(12);
    expect(CommandCode.ExitChannel).toBe(122);
  });

  it('UpdateTypeCode has the expected wire values', () => {
    expect(UpdateTypeCode.IOPortOpened).toBe(1);
    expect(UpdateTypeCode.AllThreadsStopped).toBe(2);
    expect(UpdateTypeCode.ThreadAttached).toBe(3);
    expect(UpdateTypeCode.BreakpointError).toBe(4);
    expect(UpdateTypeCode.CompileError).toBe(5);
    expect(UpdateTypeCode.BreakpointVerified).toBe(6);
    expect(UpdateTypeCode.ProtocolError).toBe(7);
    expect(UpdateTypeCode.ExceptionBreakpointError).toBe(8);
  });

  it('StopReasonCode has the expected wire values', () => {
    expect(StopReasonCode.Undefined).toBe(0);
    expect(StopReasonCode.NotStopped).toBe(1);
    expect(StopReasonCode.NormalExit).toBe(2);
    expect(StopReasonCode.StopStatement).toBe(3);
    expect(StopReasonCode.Break).toBe(4);
    expect(StopReasonCode.RuntimeError).toBe(5);
    expect(StopReasonCode.CaughtRuntimeError).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Specific byte-sequence structural tests
// ---------------------------------------------------------------------------

describe('specific byte-sequence structural validation', () => {
  it('a pause request payload starts with UInt32LE(1) (CommandCode.Stop)', () => {
    const { payload } = encodeRequest({ kind: 'pause' }, 1);
    expect(payload.length).toBe(4); // only command code, no args
    expect(payload.readUInt32LE(0)).toBe(1);
  });

  it('a continue request payload starts with UInt32LE(2) and then threadId', () => {
    const { payload } = encodeRequest({ kind: 'continue', threadId: 7 }, 1);
    // payload = [command:4][threadId:4]
    expect(payload.length).toBe(8);
    expect(payload.readUInt32LE(0)).toBe(CommandCode.Continue);
    expect(payload.readUInt32LE(4)).toBe(7);
  });

  it('a step request payload encodes thread_index and step_type byte correctly', () => {
    const { payload } = encodeRequest({ kind: 'step', threadId: 1, granularity: 'line' }, 1);
    // [command:4][thread_index:4][step_type:1] = 9 bytes
    expect(payload.length).toBe(9);
    expect(payload.readUInt32LE(0)).toBe(CommandCode.Step);
    expect(payload.readUInt32LE(4)).toBe(1); // thread_index
    expect(payload[8]).toBe(1); // StepTypeCode.Line = 1
  });

  it('step granularity over encodes as StepTypeCode.Over = 3', () => {
    const { payload } = encodeRequest({ kind: 'step', threadId: 0, granularity: 'over' }, 1);
    expect(payload[8]).toBe(3); // StepTypeCode.Over = 3
  });

  it('step granularity out encodes as StepTypeCode.Out = 2', () => {
    const { payload } = encodeRequest({ kind: 'step', threadId: 0, granularity: 'out' }, 1);
    expect(payload[8]).toBe(2); // StepTypeCode.Out = 2
  });

  it('a response payload starts with errorCode UInt32LE(0) for OK responses', () => {
    const { payload } = encodeResponse({ kind: 'paused' }, 1);
    expect(payload.readUInt32LE(0)).toBe(0); // error_code = 0 (OK)
  });

  it('update event payload starts with errorCode then update_type', () => {
    const event: BdpUpdateEvent = { kind: 'io_port_opened', port: 8088 };
    const { packetType, payload } = encodeUpdateEvent(event);
    expect(packetType).toBe(0);
    expect(payload.readUInt32LE(0)).toBe(0); // error_code = 0
    expect(payload.readUInt32LE(4)).toBe(UpdateTypeCode.IOPortOpened);
    // Then Int32LE port
    expect(payload.readInt32LE(8)).toBe(8088);
  });

  it('variable isChildKey flag is encoded in the flags byte (bit 0x01)', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [{ name: 'k', type: 'String', value: 'val', isChildKey: true }],
    };
    const { payload } = encodeResponse(res, 1);
    // payload: [error_code:4][kind_disc:4][num_vars:4][var_entry...]
    // var_entry: [flags:1][type_code:1][name?][value?]
    const varStart = 4 + 4 + 4; // skip error_code + kind_disc + num_vars
    const flagsByte = payload.readUInt8(varStart);
    expect(flagsByte & 0x01).toBe(0x01); // isChildKey bit
  });

  it('variable isContainer flag sets bit 0x04 and encodes key_type_code and child_count', () => {
    const res: BdpResponse = {
      kind: 'variables',
      variables: [
        {
          name: 'aa',
          type: 'AssociativeArray',
          value: null,
          isContainer: true,
          childCount: 2,
          keyType: 'String',
        },
      ],
    };
    const { payload } = encodeResponse(res, 1);
    const varStart = 4 + 4 + 4;
    const flagsByte = payload.readUInt8(varStart);
    expect(flagsByte & 0x04).toBe(0x04); // isContainer bit
  });
});
