# Plan 2: BDP Debugger (BrightScript Debug Protocol)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a BDP client to `@rokudev/device-client` and 15 `debug_*` MCP tools to `rokudev-device`, so an agent (eventually wrapped by the `roku-debug-session` skill in Plan 6) can attach to a sideloaded channel, set source-mapped breakpoints in `.bs`/`.brs` files, step/over/out/continue/pause, inspect the stack and locals, and evaluate expressions, all over Roku's native binary debug protocol on TCP 8081 (with 8086 fallback).

**Architecture:** Four cohesive modules in `@rokudev/device-client`. (1) `BdpClient`: low-level TCP socket, length-prefixed binary framing, request/response correlation, version negotiation, per-request and handshake timeouts. (2) `BdpSession`: high-level lifecycle, invalidated-breakpoint tracking per §4.5.4, `BDP_THREAD_LOST` recovery contract per §4.5.5. (3) `SourceMapResolver`: `.bs` ↔ `.brs` line translation per §4.5.3, with explicit dispose to release the underlying WASM consumer. (4) `findSourceMap`: project-tree map discovery against a real BrighterScript build layout. The `rokudev-device` MCP server adds 15 thin tools that own a `Map<session_id, BdpSession>` (mirroring the `log_stream_*` session pattern from Plan 1 T31) and surface the spec's failure codes verbatim.

**Tech Stack:** Node 20+, TypeScript 5.x, `node:net` (TCP), `source-map` (Mozilla source-map v3 parser, BSD-3), Vitest, `@modelcontextprotocol/sdk`. Reuses Plan 1's resolveTarget, network-guard, error helpers, registry, and the established `vi.hoisted` + `vi.mock('@rokudev/device-client', ...)` test pattern.

**Spec:** `docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md` §4.5 is the source of truth. New error codes per §4.6 (`BDP_*`). Warning code `BDP_FALLBACK_TO_TELNET` already lives in Plan 1's `WARNING_CODES`. The `debug` stage is already in `STAGES`.

**Estimated tasks:** ~28 across six phases.

---

## Open Decisions and Risks

These must be resolved (or explicitly accepted as documented assumptions) before Phase 1 implementation begins. Phase 0 captures the answers in `docs/refs/bdp-wire-format.md` so subsequent tasks can cite a single reference.

| # | Decision | Default if unanswered | Owner |
|---|----------|-----------------------|-------|
| D1 | BDP wire format reference source. | Use `roku-debug` (https://github.com/rokucommunity/roku-debug, MIT) at the latest tagged release commit. The implementer studies `src/debugProtocol/` and writes a concise wire-format doc in `docs/refs/bdp-wire-format.md`. Do **not** copy code; cite the SHA in the doc for traceability. | Phase 0 T1 |
| D2 | BDP version scheme is integer (`[min, max]`). Per spec §8.4 item 4, validate against current RokuOS firmware. | Assume integer protocol versions; ship `BdpVersionRange = { min: 1, max: 3 }` with a TODO comment. If real-device validation in Phase 0 T2 reveals a non-integer scheme, adapt the type (e.g. `{ major, minor }` tuples) before writing the codec. | Phase 0 T2 |
| D3 | Real-device verification of the BDP wire is mandatory before v0.2.0 ships. Per spec §6 (line 885), CI emits one of `PASS`, `FAIL`, or a documented `SKIPPED_*` token; a silent skip never satisfies the gate. | The implementer (or user) runs `scripts/manual-bdp-smoke.mjs` against a real Roku in dev mode after Phase 4 and before Phase 5 close. Record the outcome in `docs/refs/bdp-wire-format.md` §6 with one of: `outcome=PASS`, `outcome=FAIL`, `outcome=SKIPPED_NO_DEVICE_ATTACHED`, `outcome=SKIPPED_DEVICE_OFFLINE`. The v0.2.0 tag requires at least one entry with `outcome=PASS`; SKIPPED is logged but does not satisfy D3. | Phase 5 T27 |
| D4 | License compatibility for studying `roku-debug` source. | `roku-debug` is MIT. Study and re-implement the wire format from scratch. Do **not** copy code; cite the file/commit-SHA in `bdp-wire-format.md`. No runtime dependency on `roku-debug`. | Phase 0 T1 |
| D5 | Source-map library. | Use `source-map` (Mozilla, BSD-3). Standard, well-maintained, parses BrighterScript `.brs.map` output. The package's `SourceMapConsumer` requires async initialization and explicit `destroy()` to release the underlying WASM. `SourceMapResolver` exposes a `dispose()` that calls `consumer.destroy()`. The tool layer (T21 set-breakpoint, T23 stack-trace) loads and disposes resolvers per call inside `try/finally`. `BdpSession` does NOT own resolver lifetimes. | Phase 2 T16 |
| D6 | Mock BDP server for tests. | In-process TCP server in `bdp/_internal/mock-bdp-server.ts` that uses the real `wire-codec.ts` to encode/decode payloads, so test interactions match production wire bytes. All Phase 1 tests target it. The real device is exercised only by `manual-bdp-smoke.mjs`. | Phase 1 T7 |
| D7 | `inputSchema` style for new tools. | Hand-rolled JSON Schema literals matching Plan 1's `tools/log.ts` style. Do not introduce Zod-to-JSON-Schema conversion in this plan. | Phase 4 |
| D8 | TS internal naming vs. MCP wire naming. | Internals are camelCase (`bdpVersion`, `sessionId`, `frameIdx`); MCP wire results are snake_case (`bdp_version`, `session_id`, `frame_idx`). Each tool handler converts at the boundary. Plan 1 follows the same convention. | Phase 4 |

---

## Phase 0: Research and Scaffolding

This phase produces the wire-format reference doc, validates the version scheme, and adds the empty subdir + new error codes. No tools yet.

### Task 1: Author `docs/refs/bdp-wire-format.md`

**Files:**
- Create: `docs/refs/bdp-wire-format.md`

This is a research deliverable. The author studies `roku-debug` (https://github.com/rokucommunity/roku-debug at the latest release commit) and produces a self-contained wire-format spec.

**Required sections (each populated, not skeletal):**

1. **Frame layout.** Length-prefix encoding of every BDP packet. Number of bytes in the header, byte order (LE/BE), every header field with offset and width.
2. **Packet types.** Enumeration of every packet kind v1 uses: `Connect`, `Continue`, `StepOver`, `StepInto`, `StepOut`, `Pause`, `Threads`, `StackTrace`, `Variables`, `Execute` (eval), `AddBreakpoints`, `RemoveBreakpoints`, `ListBreakpoints`, `ExitChannel`. For each: numeric type discriminator, request payload schema, response payload schema.
3. **Version negotiation.** Bytes exchanged during `Connect`/handshake. Where in the response the device's version sits and whether it is a single integer or a `(major, minor)` pair.
4. **Update events.** Async events the device sends without a request: `Stopped`, `ThreadAttached`, `AppExited`, `IoPortOpened`, `CompileError`. How a client distinguishes a request-correlated response (carries a `requestId`) from an async event (no `requestId`, distinct packet-type discriminator).
5. **Stop reasons.** Enum of values in a `Stopped` event (`break`, `step`, `pause`, `exception`, `unknown`).
6. **Variable serialization.** Wire encoding of primitives (string, int, float, bool), arrays, AssociativeArrays, roSGNode, and roFunction values. Including the `expandable` flag for tree variables.

- [ ] **Step 1: Fetch reference material**

Open `https://github.com/rokucommunity/roku-debug` (use WebFetch or local clone), navigate to `src/debugProtocol/`. Identify the latest tagged release (e.g. `v0.21.x`) and pin to that commit SHA. Note the SHA in the doc's first paragraph.

If WebFetch is unavailable in the agent's environment, escalate to the user with a request: "I need the user to either (a) clone `https://github.com/rokucommunity/roku-debug` to `~/work/roku-debug-ref/`, or (b) paste the contents of `src/debugProtocol/Debugger.ts` and any sibling event/request/response files I can reference."

- [ ] **Step 2: Write the doc**

`docs/refs/bdp-wire-format.md` skeleton:

```markdown
# BDP Wire Format Reference (vendored summary)

**Source:** `rokucommunity/roku-debug` @ `<COMMIT_SHA>`. License: MIT. Re-implemented from scratch in `@rokudev/device-client`; this doc is the authoritative wire-format reference for that work.

## 1. Frame layout
[length prefix bytes, byte order, header fields with offsets, payload]

## 2. Packet types
### 2.1 Connect / Handshake
### 2.2 Continue / StepInto / StepOver / StepOut / Pause / ExitChannel
### 2.3 Threads / StackTrace / Variables / Execute (eval)
### 2.4 AddBreakpoints / RemoveBreakpoints / ListBreakpoints
### 2.5 Update events (async, server-pushed)

## 3. Version negotiation
### 3a. Version-scheme validation (D2)
[fill from T2]

## 4. Stop reasons enum
## 5. Variable serialization
## 6. Verification log
[appended in T27]
```

- [ ] **Step 3: Commit**

```bash
git add docs/refs/bdp-wire-format.md
git commit -m "docs(bdp): vendor BDP wire-format reference from roku-debug"
```

---

### Task 2: Document the BDP version-scheme assumption (D2)

**Files:**
- Modify: `docs/refs/bdp-wire-format.md` (populate §3a)

A real-device probe is only useful AFTER the frame codec and message types exist, so this task only **documents the assumption** at this point. A real handshake probe is performed in T27 (real-device verification) once the codec is built. If the verification reveals the scheme is not integer, the codec and types are revised before tag.

- [ ] **Step 1: Append to `bdp-wire-format.md` §3a**

```markdown
## 3a. Version-scheme validation (D2)

**Assumed:** integer protocol version. The handshake response carries a single integer in the version field; the client supports range `{ min: 1, max: 3 }`.

**Rationale:** `roku-debug`'s implementation as of <COMMIT_SHA> uses integer versions. RokuOS has not, to our knowledge, published a non-integer scheme.

**Implication for `BdpVersionRange`:**
`type BdpVersionRange = { min: number; max: number };`
`const SUPPORTED_BDP_VERSIONS: BdpVersionRange = { min: 1, max: 3 };`

**Verification gate:** T27 runs the real-device smoke. If the device returns a non-integer (e.g., `1.2`), the type is widened to `{ min: [number, number]; max: [number, number] }` before tag.
```

- [ ] **Step 2: Commit**

```bash
git add docs/refs/bdp-wire-format.md
git commit -m "docs(bdp): pin BDP version-scheme assumption (D2)"
```

---

### Task 3: Add new error codes; create `bdp/` subdir

**Files:**
- Modify: `packages/roku-device-client/src/errors/codes.ts`
- Create: `packages/roku-device-client/src/errors/codes.test.ts` (extend if it exists)
- Create: `packages/roku-device-client/src/bdp/index.ts` (placeholder)

- [ ] **Step 1: Add the new failure codes (per spec §4.6)**

Modify `packages/roku-device-client/src/errors/codes.ts` and add to `FAILURE_CODES` (in the `// debug` group):

```ts
// debug
BDP_ATTACH_FAILED: 'debug',
BDP_ATTACH_BUSY: 'debug',
BDP_VERSION_UNSUPPORTED: 'debug',
BDP_BREAKPOINT_INVALID: 'debug',
BDP_NO_SOURCE_MAP: 'debug',
BDP_THREAD_LOST: 'debug',
```

Verify `STAGES` already includes `'debug'` (Plan 1 added it). `BDP_FALLBACK_TO_TELNET` is already in `WARNING_CODES` from Plan 1; no change needed.

- [ ] **Step 2: Tests verifying registration**

```ts
import { FAILURE_CODES, WARNING_CODES, STAGES } from './codes.js';
import { describe, it, expect } from 'vitest';

describe('BDP error codes', () => {
  it('STAGES includes "debug"', () => { expect(STAGES).toContain('debug'); });

  it.each([
    'BDP_ATTACH_FAILED', 'BDP_ATTACH_BUSY', 'BDP_VERSION_UNSUPPORTED',
    'BDP_BREAKPOINT_INVALID', 'BDP_NO_SOURCE_MAP', 'BDP_THREAD_LOST',
  ])('registers %s as a debug-stage failure', (code) => {
    expect(FAILURE_CODES[code as keyof typeof FAILURE_CODES]).toBe('debug');
  });

  it('BDP_FALLBACK_TO_TELNET is a warning code', () => {
    expect(WARNING_CODES).toContain('BDP_FALLBACK_TO_TELNET');
  });
});
```

- [ ] **Step 3: Create empty `bdp/index.ts` placeholder**

```ts
// BDP module. Populated by Plan 2 Phase 1+.
export {};
```

- [ ] **Step 4: Build, run tests, commit**

```bash
pnpm --filter @rokudev/device-client build
pnpm --filter @rokudev/device-client test
git add packages/roku-device-client/src/bdp/ packages/roku-device-client/src/errors/
git commit -m "feat(roku-device-client): add BDP error codes and bdp/ subdir"
```

---

## Phase 1: Wire Protocol in `@rokudev/device-client`

All work in this phase tests against the in-process mock BDP server (T7). Real-device verification happens in Phase 5 T27.

**TDD discipline applies to every Phase 1 task:** write failing test first, observe red, implement, observe green, commit.

### Task 4: BDP frame codec

**Files:**
- Create: `packages/roku-device-client/src/bdp/frame.ts`
- Create: `packages/roku-device-client/src/bdp/frame.test.ts`

Pure functions: `encodeFrame(packetType, payload): Buffer` and `decodeFrame(buf): { packetType, payload, consumed } | null` (returns null if the buffer doesn't yet contain a complete frame, so callers can implement incremental parsing on stream chunks).

The exact header byte count, byte order, and field offsets are defined in `bdp-wire-format.md` §1. Implementer must round-trip example bytes from that doc before committing.

- [ ] **Step 1: Write the test first**

```ts
import { describe, it, expect } from 'vitest';
import { encodeFrame, decodeFrame } from './frame.js';

describe('BDP frame codec', () => {
  it('round-trips a frame', () => {
    const payload = Buffer.from([0x01, 0x02, 0x03]);
    const encoded = encodeFrame(/* packetType per docs */ 0x01, payload);
    const decoded = decodeFrame(encoded);
    expect(decoded).not.toBeNull();
    expect(decoded!.packetType).toBe(0x01);
    expect(decoded!.payload).toEqual(payload);
    expect(decoded!.consumed).toBe(encoded.length);
  });

  it('returns null when the frame is incomplete', () => {
    const partial = Buffer.from([0x00, 0x00]);
    expect(decodeFrame(partial)).toBeNull();
  });

  it('decodes back-to-back frames in one buffer', () => {
    const a = encodeFrame(0x01, Buffer.from([0xaa]));
    const b = encodeFrame(0x02, Buffer.from([0xbb]));
    const combined = Buffer.concat([a, b]);
    const first = decodeFrame(combined)!;
    expect(first.packetType).toBe(0x01);
    const second = decodeFrame(combined.subarray(first.consumed))!;
    expect(second.packetType).toBe(0x02);
  });
});
```

- [ ] **Step 2: Implement against the doc's frame layout**

Implementation depends on `bdp-wire-format.md` §1. Verify the byte count and field order against the doc before coding. Typical pattern:

```ts
export function encodeFrame(packetType: number, payload: Buffer): Buffer {
  const len = payload.length;
  const header = Buffer.alloc(/* HEADER_BYTES per docs */ 8);
  header.writeUInt32LE(len, 0);
  header.writeUInt32LE(packetType, 4);
  return Buffer.concat([header, payload]);
}
export function decodeFrame(buf: Buffer): { packetType: number; payload: Buffer; consumed: number } | null {
  if (buf.length < 8) return null;
  const len = buf.readUInt32LE(0);
  if (buf.length < 8 + len) return null;
  const packetType = buf.readUInt32LE(4);
  return { packetType, payload: buf.subarray(8, 8 + len), consumed: 8 + len };
}
```

- [ ] **Step 3: Build, test, commit**

```bash
git commit -m "feat(roku-device-client): BDP frame codec"
```

---

### Task 5: BDP message type definitions

**Files:**
- Create: `packages/roku-device-client/src/bdp/messages.ts`

Type-only file. One union per direction. The MCP-wire snake_case naming is reserved for the tool layer; internals use camelCase per D8.

- [ ] **Step 1: Define the types**

```ts
export type BdpVersionRange = { min: number; max: number };

export type BdpRequest =
  | { kind: 'connect'; clientVersion: BdpVersionRange }
  | { kind: 'continue'; threadId: number }
  | { kind: 'step'; threadId: number; granularity: 'into' | 'over' | 'out' }
  | { kind: 'pause' }
  | { kind: 'threads' }
  | { kind: 'stack_trace'; threadId: number }
  | { kind: 'variables'; threadId: number; frameIdx: number; getChildren?: boolean; varPath?: string[] }
  | { kind: 'eval'; threadId: number; frameIdx: number; expression: string }
  | { kind: 'add_breakpoints'; breakpoints: { file: string; line: number }[] }
  | { kind: 'remove_breakpoints'; ids: number[] }
  | { kind: 'list_breakpoints' }
  | { kind: 'exit_channel' };

export type BdpResponse =
  | { kind: 'connected'; bdpVersion: number }
  | { kind: 'continued' }
  | { kind: 'stepped' }
  | { kind: 'paused' }
  | { kind: 'threads'; threads: { id: number; name: string; isPrimary: boolean }[] }
  | { kind: 'stack_trace'; frames: BdpStackFrame[] }
  | { kind: 'variables'; variables: BdpVariable[] }
  | { kind: 'eval'; result: BdpVariable }
  | { kind: 'breakpoints_added'; ids: number[]; rejected: { file: string; line: number; reason: string }[] }
  | { kind: 'breakpoints_removed' }
  | { kind: 'breakpoints_list'; entries: { id: number; file: string; line: number }[] }
  | { kind: 'exited' }
  | { kind: 'error'; code: string; message: string };

export type BdpUpdateEvent =
  | { kind: 'stopped'; threadId: number; reason: 'break' | 'step' | 'pause' | 'exception' | 'unknown'; file?: string; line?: number }
  | { kind: 'thread_attached'; threadId: number }
  | { kind: 'app_exited' }
  | { kind: 'compile_error'; file: string; line: number; message: string }
  | { kind: 'io_port_opened'; port: number };

export type BdpStackFrame = { idx: number; file: string; line: number; functionName?: string };
export type BdpVariable = {
  name: string;
  type: string;
  value: string | number | boolean | null;
  expandable?: boolean;
  varPath?: string[];
};
```

- [ ] **Step 2: Commit (no test for type-only file)**

```bash
git commit -m "feat(roku-device-client): BDP message type union"
```

---

### Task 6: BDP wire codec (payload <-> bytes)

**Files:**
- Create: `packages/roku-device-client/src/bdp/wire-codec.ts`
- Create: `packages/roku-device-client/src/bdp/wire-codec.test.ts`

This module owns conversion between `BdpRequest`/`BdpResponse`/`BdpUpdateEvent` typed values and their on-the-wire payload bytes (the `payload: Buffer` argument/return of `frame.ts`). It is the single source of truth that both `BdpClient` (production) and `mock-bdp-server` (tests) consume, so behavior cannot drift between them.

Required functions:

```ts
export function encodeRequest(req: BdpRequest, requestId: number): { packetType: number; payload: Buffer };
export function decodeRequest(packetType: number, payload: Buffer): { req: BdpRequest; requestId: number };
export function encodeResponse(res: BdpResponse, requestId: number): { packetType: number; payload: Buffer };
export function decodeResponse(packetType: number, payload: Buffer): { res: BdpResponse; requestId: number };
export function encodeUpdateEvent(event: BdpUpdateEvent): { packetType: number; payload: Buffer };
export function decodeUpdateEvent(packetType: number, payload: Buffer): BdpUpdateEvent;
export function isUpdateEventPacket(packetType: number): boolean;
```

`isUpdateEventPacket` lets a receiver distinguish a request-correlated response (carries `requestId`) from an async event (no `requestId`).

- [ ] **Step 1: Tests for round-trip**

For each `BdpRequest` and `BdpResponse` variant in T5: encode, then decode, then assert equality of the resulting object. Same for `BdpUpdateEvent`. Cover the variable/stack-trace serialization explicitly (these are non-trivial). All packet-type discriminators come from `bdp-wire-format.md` §2.

- [ ] **Step 2: Implement**

Per `bdp-wire-format.md` §2-§4 (the `roku-debug` reference implementation guides each variant's bytes; we re-implement, do not copy).

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(roku-device-client): BDP wire codec for requests, responses, and update events"
```

---

### Task 7: Mock BDP server for tests

**Files:**
- Create: `packages/roku-device-client/src/bdp/_internal/mock-bdp-server.ts`
- Create: `packages/roku-device-client/src/bdp/_internal/mock-bdp-server.test.ts`

In-process TCP server (`net.createServer`) on an OS-assigned port (port 0). Uses `wire-codec.ts` and `frame.ts` to encode every byte; tests register typed handlers on `BdpRequest['kind']` and emit typed `BdpUpdateEvent`s.

Strict typing: no `any` anywhere.

```ts
import net from 'node:net';
import { encodeFrame, decodeFrame } from '../frame.js';
import { decodeRequest, encodeResponse, encodeUpdateEvent, isUpdateEventPacket } from '../wire-codec.js';
import type { BdpRequest, BdpResponse, BdpUpdateEvent } from '../messages.js';

type RequestHandler<K extends BdpRequest['kind']> = (req: Extract<BdpRequest, { kind: K }>) => BdpResponse | Promise<BdpResponse>;

export type MockBdpServer = {
  port: number;
  onRequest<K extends BdpRequest['kind']>(kind: K, handler: RequestHandler<K>): void;
  emitEvent(event: BdpUpdateEvent): void;
  stop(): Promise<void>;
};

export async function startMockBdpServer(): Promise<MockBdpServer> {
  const handlers = new Map<BdpRequest['kind'], (req: BdpRequest) => BdpResponse | Promise<BdpResponse>>();
  const sockets = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    sockets.add(sock);
    let buf = Buffer.alloc(0);
    sock.on('data', async (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const decoded = decodeFrame(buf);
        if (!decoded) break;
        buf = buf.subarray(decoded.consumed);
        const { req, requestId } = decodeRequest(decoded.packetType, decoded.payload);
        const handler = handlers.get(req.kind);
        if (!handler) continue;
        const res = await handler(req);
        const encoded = encodeResponse(res, requestId);
        sock.write(encodeFrame(encoded.packetType, encoded.payload));
      }
    });
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => sockets.delete(sock));
  });
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res));
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    onRequest(kind, h) { handlers.set(kind, h as (req: BdpRequest) => BdpResponse | Promise<BdpResponse>); },
    emitEvent(evt: BdpUpdateEvent) {
      const encoded = encodeUpdateEvent(evt);
      const frame = encodeFrame(encoded.packetType, encoded.payload);
      for (const s of sockets) s.write(frame);
    },
    async stop() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((res) => server.close(() => res()));
    },
  };
}
```

- [ ] **Step 1: Tests** (response routing, async event broadcast, multiple connected clients)
- [ ] **Step 2: Implement**
- [ ] **Step 3: Commit**

```bash
git commit -m "test(roku-device-client): mock BDP TCP server using wire codec"
```

---

### Task 8: BdpClient (TCP, framing, request/response correlation, timeouts)

**Files:**
- Create: `packages/roku-device-client/src/bdp/client.ts`
- Create: `packages/roku-device-client/src/bdp/client.test.ts`

Low-level client. Owns the TCP socket and an incremental decode loop using `frame.ts` + `wire-codec.ts`. Maintains a `Map<requestId, Deferred>` for pending requests; resolves when the matching response arrives. Routes async update events to a registered listener. Does NOT implement source maps, breakpoint state, or recovery; those live in `BdpSession`.

API:
```ts
export const HANDSHAKE_TIMEOUT_MS = 5000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class BdpClient {
  static connect(host: string, port: 8081 | 8086, supportedVersions: BdpVersionRange, opts?: { handshakeTimeoutMs?: number }): Promise<BdpClient>;
  send(request: BdpRequest, opts?: { timeoutMs?: number }): Promise<BdpResponse>;
  onEvent(listener: (event: BdpUpdateEvent) => void): void;
  close(): void;
  readonly bdpVersion: number;
}
```

**Error normalization (resolves review issues C5 / H4 / H5).** Every reject path produces a `Failure` object via `fail(...)`:
- TCP `error` event before `connect`: `fail('BDP_ATTACH_FAILED', ...)`. The handler accepts `unknown` and uses `e instanceof Error ? e.message : String(e)` so non-Error rejections do not throw inside the rejection callback. Node error codes (`ECONNREFUSED`, `EHOSTUNREACH`, `ETIMEDOUT`) are surfaced in `details.cause_code`.
- TCP `connect` succeeds but no handshake bytes within `HANDSHAKE_TIMEOUT_MS`: `fail('BDP_ATTACH_FAILED', ..., { reason: 'handshake_timeout' })`.
- Handshake response parsed; device version outside `supportedVersions`: `fail('BDP_VERSION_UNSUPPORTED', ..., { device_version, supported_range: supportedVersions })`. **Tests must assert these `details` fields** (resolves M7).
- `send()` exceeds `timeoutMs`: pending entry is removed and the promise rejects with `fail('BDP_THREAD_LOST', ..., { session_state: 'connection_lost' })`.
- Socket closes with pending requests: each pending entry rejects with `fail('BDP_THREAD_LOST', ..., { session_state: 'connection_lost' })`.

- [ ] **Step 1: Write tests**

```ts
it('correlates request/response by id', async () => {
  server.onRequest('threads', () => ({ kind: 'threads', threads: [{ id: 1, name: 'main', isPrimary: true }] }));
  const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, { min: 1, max: 3 });
  const r = await client.send({ kind: 'threads' });
  expect(r).toEqual({ kind: 'threads', threads: [{ id: 1, name: 'main', isPrimary: true }] });
  client.close();
});

it('delivers async events to listeners', async () => {
  const client = await BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, { min: 1, max: 3 });
  const events: BdpUpdateEvent[] = [];
  client.onEvent((e) => events.push(e));
  server.emitEvent({ kind: 'stopped', threadId: 1, reason: 'break', file: '/x.brs', line: 5 });
  await new Promise((r) => setTimeout(r, 50));
  expect(events).toHaveLength(1);
  expect(events[0].kind).toBe('stopped');
  client.close();
});

it('throws BDP_VERSION_UNSUPPORTED with details on out-of-range', async () => {
  server.onRequest('connect', () => ({ kind: 'connected', bdpVersion: 99 }));
  await expect(BdpClient.connect('127.0.0.1', server.port as 8081 | 8086, { min: 1, max: 3 }))
    .rejects.toMatchObject({
      ok: false, code: 'BDP_VERSION_UNSUPPORTED', stage: 'debug',
      details: { device_version: 99, supported_range: { min: 1, max: 3 } },
    });
});

it('throws BDP_ATTACH_FAILED with cause_code on connection refused', async () => {
  await expect(BdpClient.connect('127.0.0.1', /* unbound port */ 1 as 8081, { min: 1, max: 3 }))
    .rejects.toMatchObject({ ok: false, code: 'BDP_ATTACH_FAILED', stage: 'debug', details: { cause_code: 'ECONNREFUSED' } });
});

it('handshake_timeout when device accepts TCP but never sends handshake', async () => {
  // start a bare TCP server that never writes any bytes
  const silent = net.createServer(() => {});
  await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r));
  const port = (silent.address() as net.AddressInfo).port;
  await expect(BdpClient.connect('127.0.0.1', port as 8081, { min: 1, max: 3 }, { handshakeTimeoutMs: 100 }))
    .rejects.toMatchObject({ ok: false, code: 'BDP_ATTACH_FAILED', details: { reason: 'handshake_timeout' } });
  silent.close();
});

it('send() honours timeoutMs and rejects with BDP_THREAD_LOST', async () => {
  // server registered for 'threads' but never replies (delete the handler before send)
  const client = await BdpClient.connect('127.0.0.1', server.port as 8081, { min: 1, max: 3 });
  await expect(client.send({ kind: 'threads' }, { timeoutMs: 50 }))
    .rejects.toMatchObject({ ok: false, code: 'BDP_THREAD_LOST', details: { session_state: 'connection_lost' } });
  client.close();
});
```

- [ ] **Step 2: Implement**

Sketch (full handshake details per `bdp-wire-format.md` §3):

```ts
import net from 'node:net';
import { fail } from '../errors/index.js';
import { encodeFrame, decodeFrame } from './frame.js';
import { encodeRequest, decodeResponse, decodeUpdateEvent, isUpdateEventPacket } from './wire-codec.js';
import type { BdpRequest, BdpResponse, BdpUpdateEvent, BdpVersionRange } from './messages.js';

export const HANDSHAKE_TIMEOUT_MS = 5000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

type Deferred<T> = { resolve: (v: T) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout };

export class BdpClient {
  private buf = Buffer.alloc(0);
  private nextReqId = 1;
  private pending = new Map<number, Deferred<BdpResponse>>();
  private listeners: Array<(e: BdpUpdateEvent) => void> = [];

  private constructor(private socket: net.Socket, public readonly bdpVersion: number) {
    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('close', () => this.onClose());
    socket.on('error', () => { /* close path will run */ });
  }

  static async connect(
    host: string,
    port: 8081 | 8086,
    supportedVersions: BdpVersionRange,
    opts: { handshakeTimeoutMs?: number } = {},
  ): Promise<BdpClient> {
    const handshakeTimeoutMs = opts.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    const sock = await new Promise<net.Socket>((res, rej) => {
      const s = net.connect(port, host);
      const onErr = (e: unknown) => {
        const causeCode = (e as { code?: string }).code;
        rej(fail('BDP_ATTACH_FAILED',
          `BDP connect ${host}:${port} failed: ${e instanceof Error ? e.message : String(e)}`,
          { host, port, cause_code: causeCode }));
      };
      s.once('connect', () => { s.off('error', onErr); res(s); });
      s.once('error', onErr);
    });
    // perform handshake within handshakeTimeoutMs
    const negotiated = await Promise.race([
      doHandshake(sock, supportedVersions),
      new Promise<never>((_, rej) => setTimeout(() => {
        sock.destroy();
        rej(fail('BDP_ATTACH_FAILED', `BDP handshake to ${host}:${port} timed out`, { host, port, reason: 'handshake_timeout' }));
      }, handshakeTimeoutMs)),
    ]);
    if (negotiated < supportedVersions.min || negotiated > supportedVersions.max) {
      sock.destroy();
      throw fail('BDP_VERSION_UNSUPPORTED',
        `device speaks BDP v${negotiated}; client supports ${supportedVersions.min}..${supportedVersions.max}`,
        { device_version: negotiated, supported_range: supportedVersions });
    }
    return new BdpClient(sock, negotiated);
  }

  send(req: BdpRequest, opts: { timeoutMs?: number } = {}): Promise<BdpResponse> {
    const id = this.nextReqId++;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(fail('BDP_THREAD_LOST', `BDP request ${req.kind}#${id} timed out after ${timeoutMs}ms`, { session_state: 'connection_lost' }));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const { packetType, payload } = encodeRequest(req, id);
      this.socket.write(encodeFrame(packetType, payload));
    });
  }

  onEvent(listener: (e: BdpUpdateEvent) => void): void { this.listeners.push(listener); }

  close(): void { this.onClose(); this.socket.destroy(); }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      const decoded = decodeFrame(this.buf);
      if (!decoded) break;
      this.buf = this.buf.subarray(decoded.consumed);
      if (isUpdateEventPacket(decoded.packetType)) {
        const evt = decodeUpdateEvent(decoded.packetType, decoded.payload);
        for (const l of this.listeners) l(evt);
      } else {
        const { res, requestId } = decodeResponse(decoded.packetType, decoded.payload);
        const pending = this.pending.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(requestId);
          pending.resolve(res);
        }
      }
    }
  }
  private onClose(): void {
    for (const d of this.pending.values()) {
      clearTimeout(d.timer);
      d.reject(fail('BDP_THREAD_LOST', 'BDP socket closed', { session_state: 'connection_lost' }));
    }
    this.pending.clear();
  }
}

async function doHandshake(sock: net.Socket, range: BdpVersionRange): Promise<number> {
  // encode connect request, write, read first frame, decode connected response, return bdpVersion.
  // exact bytes per docs/refs/bdp-wire-format.md §3.
  return 3;   // replaced by real implementation
}
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(roku-device-client): BdpClient with framing, correlation, and timeouts"
```

---

### Task 9: BdpClient port fallback (8081 → 8086)

**Files:**
- Modify: `packages/roku-device-client/src/bdp/client.ts`
- Modify: `packages/roku-device-client/src/bdp/client.test.ts`

Per spec §4.5.1, some firmwares serve BDP on 8086. Add `connectWithFallback(host, supportedVersions, opts?)`. Trigger fallback on `BDP_ATTACH_FAILED` whose `details.cause_code` is `'ECONNREFUSED'` (the canonical "port not listening" Node error).

```ts
static async connectWithFallback(host: string, supportedVersions: BdpVersionRange, opts?: { handshakeTimeoutMs?: number }): Promise<BdpClient> {
  try {
    return await BdpClient.connect(host, 8081, supportedVersions, opts);
  } catch (e: unknown) {
    const failure = e as { code?: string; details?: { cause_code?: string } };
    if (failure.code === 'BDP_ATTACH_FAILED' && failure.details?.cause_code === 'ECONNREFUSED') {
      return BdpClient.connect(host, 8086, supportedVersions, opts);
    }
    throw e;
  }
}
```

- [ ] **Step 1: Tests**

Two mock servers: 8081 returns ECONNREFUSED (don't bind it); 8086 accepts and handshakes. Verify `connectWithFallback` succeeds on 8086. Negative test: 8081 accepts but `BDP_VERSION_UNSUPPORTED` does NOT trigger fallback.

- [ ] **Step 2: Implement**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(roku-device-client): BdpClient connectWithFallback (8081 → 8086)"
```

---

### Task 10: BdpSession (attach, detach, state surface)

**Files:**
- Create: `packages/roku-device-client/src/bdp/session.ts`
- Create: `packages/roku-device-client/src/bdp/session.test.ts`

First slice of `BdpSession`. Implements lifecycle and the read-only state surface required by §4.5.5. Subsequent tasks (T11-T14) layer on the operational methods. The state guard is built in from the start (resolves L7).

```ts
// 'thread_terminated_other' is per-thread, surfaced only in details.session_state of operations
// targeting a dead thread (see T12), never assigned to BdpSession.state itself.
export type BdpSessionState = 'live' | 'channel_exited' | 'connection_lost';

export class BdpSession {
  static async attach(host: string, supportedVersions?: BdpVersionRange, opts?: { handshakeTimeoutMs?: number }): Promise<BdpSession>;
  detach(): void;
  readonly host: string;       // captured at attach; available to consumers that need a host without going through the registry's reverse lookup. The MCP detach handler uses the registry's getHostForSession(id) instead, but session.host is exposed for log lines and future use.
  readonly bdpVersion: number;
  readonly state: BdpSessionState;
  // event hooks
  onStopped(listener: (e: { threadId: number; reason: string; file?: string; line?: number }) => void): void;
  // private helper used by every method added in T11-T14
  private guardLive(): void;
}
```

`attach` calls `BdpClient.connectWithFallback` and stores the `host` on the instance. `detach` closes the client. The session does NOT cache `SourceMapResolver` instances; resolver lifetime is owned by the tool layer (T21, T23), which loads + disposes inside `try/finally` per call. Wires `onEvent` to track `app_exited` → `state = 'channel_exited'`.

`guardLive` throws `fail('BDP_THREAD_LOST', ..., { session_state: this.state })` if state is anything other than `'live'`.

The `invalidatedBreakpoints` surface mentioned in §4.5.4 is NOT a property of `BdpSession`; it is computed by the MCP layer (T20) from the `DebugSessionRegistry`'s host-keyed memory of breakpoints from prior detached sessions.

- [ ] **Step 1: Tests** (attach happy path, detach idempotent, app_exited transitions state, post-detach methods throw with details.session_state)
- [ ] **Step 2: Implement**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(roku-device-client): BdpSession lifecycle and state guard"
```

---

### Task 11: BdpSession breakpoints

**Files:**
- Modify: `packages/roku-device-client/src/bdp/session.ts`
- Modify: `packages/roku-device-client/src/bdp/session.test.ts`

Add `setBreakpoint(file, line)`, `clearBreakpoint(id)`, `listBreakpoints()`, plus a public `currentBreakpoints(): ReadonlyArray<{ file: string; line: number }>` that returns a snapshot of the session's active breakpoints. Source-map translation lives in the tool layer (Phase 4 T21), not here; these methods take already-compiled `(file, line)` pairs and return `{ id }`.

The `currentBreakpoints()` method exists so the `debug_detach` MCP handler (Phase 4 T20) can read the breakpoints BEFORE invoking `session.detach()` and persist them via the session registry's `rememberBreakpoints(host, ...)`. The session itself does NOT call into the MCP-layer registry (no cross-package coupling).

Unlike the operational methods, `currentBreakpoints()` is a pure cache read and does NOT call `guardLive()`. It remains safe to call after the session has transitioned to `'channel_exited'` and up to the moment `detach()` returns, so the detach handler can always read the snapshot before closing the client.

If the device returns `breakpoints_added.rejected` for an entry, throw `fail('BDP_BREAKPOINT_INVALID', ..., { file, line, reason })`.

- [ ] **Step 1: Tests**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(roku-device-client): BdpSession breakpoint methods"
```

---

### Task 12: BdpSession execution control

**Files:**
- Modify: `packages/roku-device-client/src/bdp/session.ts`
- Modify: `packages/roku-device-client/src/bdp/session.test.ts`

Add `resume(threadId)`, `step(threadId, granularity)`, `pause()`. Names: prefer `resume` over `continue` to avoid the JS keyword optics and to match DAP terminology (resolves M1). All three call `guardLive()` first.

A thread-targeted method (`resume`, `step`) that returns `kind: 'error'` with a thread-gone payload throws `fail('BDP_THREAD_LOST', ..., { session_state: 'thread_terminated_other' })`.

- [ ] **Step 1: Tests** (happy path + thread-gone error mapping)
- [ ] **Step 2: Implement**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(roku-device-client): BdpSession execution control (resume, step, pause)"
```

---

### Task 13: BdpSession introspection (threads, stack_trace)

**Files:**
- Modify: `packages/roku-device-client/src/bdp/session.ts`
- Modify: `packages/roku-device-client/src/bdp/session.test.ts`

Add `threads()` and `stackTrace(threadId)`. Both call `guardLive()`. `stackTrace` returns the raw compiled-line frames; reverse `.brs` → `.bs` translation happens in the tool layer (Phase 4 T23).

- [ ] **Step 1: Tests**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(roku-device-client): BdpSession threads and stackTrace"
```

---

### Task 14: BdpSession variables and eval

**Files:**
- Modify: `packages/roku-device-client/src/bdp/session.ts`
- Modify: `packages/roku-device-client/src/bdp/session.test.ts`

Add `variables(threadId, frameIdx, opts?)` and `eval(threadId, frameIdx, expression)`. Both call `guardLive()`. `eval` accepts an optional `timeoutMs` (default 30s, passes through to `BdpClient.send`) since user-supplied expressions can be long-running.

- [ ] **Step 1: Tests**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(roku-device-client): BdpSession variables and eval"
```

---

## Phase 2: Source-Map Handler

### Task 15: Add `source-map` dependency

**Files:**
- Modify: `packages/roku-device-client/package.json` (add `"source-map": "^0.7.4"`)

- [ ] **Step 1: Add dep, run `pnpm install`.**
- [ ] **Step 2: Commit.**

```bash
git commit -m "chore(roku-device-client): add source-map dep"
```

(No test step; T16's tests will exercise the import.)

---

### Task 16: SourceMapResolver

**Files:**
- Create: `packages/roku-device-client/src/bdp/source-map.ts`
- Create: `packages/roku-device-client/src/bdp/source-map.test.ts`

Wraps a `SourceMapConsumer` instance. The instance owns WASM-backed state and **must be explicitly disposed** (D5). Tests use a tmp-dir factory (matching T18) to write `.brs.map` JSON files and instantiate against them; no committed fixture file (resolves M2).

```ts
import { SourceMapConsumer } from 'source-map';
import { readFile } from 'node:fs/promises';

export class SourceMapResolver {
  private constructor(private consumer: SourceMapConsumer) {}

  static async fromMapFile(mapPath: string): Promise<SourceMapResolver> {
    const json = await readFile(mapPath, 'utf8');
    const consumer = await new SourceMapConsumer(json);
    return new SourceMapResolver(consumer);
  }

  // .bs (source) line → .brs (compiled) line
  toCompiled(sourceFile: string, sourceLine: number): { compiledFile: string; compiledLine: number } | null {
    const pos = this.consumer.generatedPositionFor({ source: sourceFile, line: sourceLine, column: 0 });
    if (pos.line == null) return null;
    return { compiledFile: this.consumer.file ?? sourceFile, compiledLine: pos.line };
  }

  // .brs (compiled) line → .bs (source) line
  toSource(_compiledFile: string, compiledLine: number): { sourceFile: string; sourceLine: number } | null {
    const pos = this.consumer.originalPositionFor({ line: compiledLine, column: 0 });
    if (pos.source == null || pos.line == null) return null;
    return { sourceFile: pos.source, sourceLine: pos.line };
  }

  dispose(): void { this.consumer.destroy(); }
}
```

- [ ] **Step 1: Test fixture factory.** A helper `writeMinimalSourceMap(dir, { source: 'foo.bs', mappings: [...] })` that writes a real `.brs.map` JSON to `dir`.
- [ ] **Step 2: Round-trip tests:** `.bs` → `.brs` and back, plus the missing-mapping null case.
- [ ] **Step 3: dispose() is idempotent and frees the consumer** (call destroy twice; expect no throw).
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Commit.**

```bash
git commit -m "feat(roku-device-client): SourceMapResolver with explicit dispose"
```

---

### Task 17: findSourceMap helper

**Files:**
- Create: `packages/roku-device-client/src/bdp/source-map-find.ts`
- Create: `packages/roku-device-client/src/bdp/source-map-find.test.ts`

Locate the `.brs.map` for a `.bs` file in a real BrighterScript project layout. **Resolves H8.** BrighterScript writes per-file outputs to its `stagingFolderPath` (defaults to `./.roku-deploy-staging/` in older versions and `./out/.roku-deploy-staging/` in newer ones), and the maps are named `<rel-source>.brs.map` (the `.bs` extension is replaced with `.brs.map`).

```ts
export async function findSourceMap(bsFilePath: string, projectRoot?: string): Promise<string | null>;
```

Algorithm:
1. From `bsFilePath`, walk up to find `bsconfig.json`. If `projectRoot` is given, use it as the search root; else walk parents up to the filesystem root.
2. Parse `bsconfig.json` (best-effort JSON; ignore comments). Read `stagingFolderPath` (string) and `rootDir` (string, default `'./'`). Both are relative to the bsconfig's directory.
3. Compute the relative path of `bsFilePath` from `rootDir`. Replace the trailing `.bs` with `.brs.map`.
4. Look in the following order, returning the first existing path:
   - `<bsconfig-dir>/<stagingFolderPath>/<rel-with-.brs.map>` (canonical authoritative location)
   - `<bsconfig-dir>/out/.roku-deploy-staging/<rel-with-.brs.map>` (newer default)
   - `<bsconfig-dir>/.roku-deploy-staging/<rel-with-.brs.map>` (older default)
5. If none exists, return null.

**Staleness note:** when `bsconfig.json` specifies a non-default `stagingFolderPath`, the configured path is authoritative. The two fallbacks exist only because older BrighterScript versions wrote to `.roku-deploy-staging/` regardless of config; they may surface stale maps from a previous build configuration. Tests must cover both the configured-path-wins case and the legacy-fallback case.

A pure-`.brs` file (path ends with `.brs`) is NOT a valid input; callers should not invoke `findSourceMap` for them. The tool layer (T22) gates on extension before calling.

- [ ] **Step 1: Build a real fixture project under `tmpdir()`**

`tmpdir()/proj/bsconfig.json` with `{"rootDir":"src","stagingFolderPath":"out/.roku-deploy-staging"}`, `tmpdir()/proj/src/main.bs`, `tmpdir()/proj/out/.roku-deploy-staging/main.brs.map` (a real source-map JSON written by T16's factory).

- [ ] **Step 2: Tests**

Find by walking up from `src/main.bs`. Find with explicit `projectRoot`. Returns null when no `bsconfig.json`. Returns null when the staging path has no map. Tries the legacy `.roku-deploy-staging` location.

- [ ] **Step 3: Implement.**
- [ ] **Step 4: Commit.**

```bash
git commit -m "feat(roku-device-client): findSourceMap matches BrighterScript build layout"
```

---

## Phase 3: Public Exports

### Task 18: Update `@rokudev/device-client` public surface

**Files:**
- Modify: `packages/roku-device-client/src/index.ts`
- Modify: `packages/roku-device-client/src/bdp/index.ts`
- Modify: `packages/roku-device-client/package.json` (add `"./bdp"` subpath export)
- Modify: `packages/roku-device-client/tests/exports.test.ts`

- [ ] **Step 1: Populate `bdp/index.ts`**

```ts
export { BdpClient, HANDSHAKE_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS } from './client.js';
export { BdpSession, type BdpSessionState } from './session.js';
export { SourceMapResolver } from './source-map.js';
export { findSourceMap } from './source-map-find.js';
export type { BdpRequest, BdpResponse, BdpUpdateEvent, BdpStackFrame, BdpVariable, BdpVersionRange } from './messages.js';
```

- [ ] **Step 2: Re-export from root `src/index.ts`**

```ts
export {
  BdpClient, BdpSession, SourceMapResolver, findSourceMap,
  HANDSHAKE_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS,
  type BdpSessionState, type BdpRequest, type BdpResponse, type BdpUpdateEvent,
  type BdpStackFrame, type BdpVariable, type BdpVersionRange,
} from './bdp/index.js';
```

- [ ] **Step 3: Add `"./bdp"` subpath export to `package.json`**

```json
"./bdp": {
  "types": "./dist/bdp/index.d.ts",
  "import": "./dist/bdp/index.js"
}
```

- [ ] **Step 4: Update `tests/exports.test.ts`**

The existing `'does not expose _internal'` test already iterates over all keys (resolves M10; no change needed there). Update the `'exports the public surface'` test (or equivalent) to include `'./bdp'` in the asserted-keys list.

- [ ] **Step 5: Build, run all tests, commit**

```bash
git commit -m "feat(roku-device-client): export BDP public surface"
```

---

## Phase 4: rokudev-device MCP Tools (15 tools)

**Common shape for every `debug_*` tool:**
1. `resolveTarget(args)` per Plan 1 §2.4 (registry/env/per-call precedence).
2. `await checkReachable(t.device, args.force === true)` per Plan 1 network-guard.
3. For tools other than `debug_attach`: `getSession(args.session_id)`, which throws `BDP_THREAD_LOST` with `details.session_state: 'connection_lost'` for unknown ids.
4. Call the matching `BdpSession` method.
5. Translate camelCase internal field names to snake_case for the MCP wire surface (per D8). Return `{ ok: true, ... }`.

**Pattern reuse:** Plan 1's `tools/log.ts` (`log_stream_*`) is the explicit reference for session-registry semantics. `inputSchema` literals are hand-rolled JSON Schema (per D7). The `vi.hoisted` + `vi.mock('@rokudev/device-client', ...)` test pattern is the established mocking style.

### Task 19: DebugSessionRegistry helper (with host reservation and last-breakpoint memory)

**Files:**
- Create: `packages/rokudev-device/src/util/debug-session-registry.ts`
- Create: `packages/rokudev-device/src/util/debug-session-registry.test.ts`

Four responsibilities:
1. Per-id session lookup (`registerSession`, `getSession`, `dropSession`).
2. Per-host reservation (`reserveHost`, `releaseHost`) so concurrent `debug_attach` to the same Roku raises `BDP_ATTACH_BUSY` (resolves H3).
3. Cross-attach breakpoint memory: `rememberBreakpoints(host, list)` and `consumeInvalidatedBreakpoints(host)` for surfacing `details.invalidated_breakpoints` on the next attach (resolves H1).
4. Detached-id memory: a bounded set of recently-detached session ids so `debug_session_state` can return `'detached'` (vs. `'unknown'` for never-issued ids; resolves N2).

```ts
import { BdpSession, fail } from '@rokudev/device-client';

const sessions = new Map<string, BdpSession>();
const sessionsByHost = new Map<string, string>();   // host → session_id
const lastBreakpointsByHost = new Map<string, Array<{ file: string; line: number }>>();
const detachedIds = new Map<string, number>();      // id → detach timestamp (ms since epoch); bounded by DETACHED_MAX
const DETACHED_MAX = 256;                            // FIFO eviction when this many detached ids are tracked

export function registerSession(s: BdpSession): string {
  const id = `bdp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  sessions.set(id, s);
  return id;
}
export function getSession(id: string): BdpSession {
  const s = sessions.get(id);
  if (!s) throw fail('BDP_THREAD_LOST', `unknown session_id ${id}`, { session_state: 'connection_lost' });
  return s;
}
// Non-throwing read helpers used by debug_detach (idempotent) and debug_session_state (introspection).
export function tryGetSession(id: string): BdpSession | null { return sessions.get(id) ?? null; }
export function hasSession(id: string): boolean { return sessions.has(id); }
export function dropSession(id: string): boolean {
  const existed = sessions.delete(id);
  if (existed) {
    detachedIds.set(id, Date.now());
    if (detachedIds.size > DETACHED_MAX) {
      // FIFO evict oldest entry
      const oldest = detachedIds.keys().next().value;
      if (oldest !== undefined) detachedIds.delete(oldest);
    }
  }
  return existed;
}
export function isKnownDetached(id: string): boolean { return detachedIds.has(id); }

export function reserveHost(host: string): void {
  if (sessionsByHost.has(host)) throw fail('BDP_ATTACH_BUSY', `host ${host} already has an active BDP session`, { host });
  sessionsByHost.set(host, '<pending>');
}
export function bindHost(host: string, sessionId: string): void { sessionsByHost.set(host, sessionId); }
export function releaseHost(host: string): void { sessionsByHost.delete(host); }
// Reverse lookup so debug_detach can find the host for a given session_id (resolves N1).
export function getHostForSession(sessionId: string): string | null {
  for (const [host, id] of sessionsByHost.entries()) {
    if (id === sessionId) return host;
  }
  return null;
}

export function rememberBreakpoints(host: string, bps: Array<{ file: string; line: number }>): void {
  if (bps.length > 0) lastBreakpointsByHost.set(host, bps);
}
export function consumeInvalidatedBreakpoints(host: string): Array<{ file: string; line: number; reason: 'channel_exited' | 'line_no_longer_present' }> {
  const list = lastBreakpointsByHost.get(host) ?? [];
  lastBreakpointsByHost.delete(host);
  // v1 only surfaces 'channel_exited'; 'line_no_longer_present' requires server confirmation (deferred).
  return list.map((b) => ({ ...b, reason: 'channel_exited' as const }));
}
export function _resetSessions(): void {
  sessions.clear(); sessionsByHost.clear(); lastBreakpointsByHost.clear(); detachedIds.clear();
}
```

- [ ] **Step 1: Tests**

Cover: register/get/drop; `tryGetSession` returns the session for a registered id and null for unknown; `hasSession` mirrors that as a boolean; reserve/release; reserve while reserved → BDP_ATTACH_BUSY; `getHostForSession` returns the host for a bound id and null otherwise; `dropSession` records the id in `detachedIds`; `isKnownDetached` returns true for a recently-dropped id and false for a never-issued id; FIFO eviction at `DETACHED_MAX + 1` entries; `rememberBreakpoints`/`consume` returns + clears; `_resetSessions` clears all four maps.

- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit.**

```bash
git commit -m "feat(rokudev-device): DebugSessionRegistry with host reservation and bp memory"
```

---

### Task 20: Lifecycle tools (`debug_attach`, `debug_detach`, `debug_session_state`)

**Files:**
- Create: `packages/rokudev-device/src/tools/debug-lifecycle.ts`
- Create: `packages/rokudev-device/src/tools/debug-lifecycle.test.ts`
- Modify: `packages/rokudev-device/src/tools/all.ts` (add `import './debug-lifecycle.js';`)

**`debug_attach`** input schema: `{ device?, host?, force? }`. No `port` parameter (resolves M9). Always uses `connectWithFallback`. Output:
```ts
{ ok: true, host, session_id, bdp_version, details?: { invalidated_breakpoints: [...] } }
```
`details.invalidated_breakpoints` is populated from `consumeInvalidatedBreakpoints(host)` (resolves H1). When empty, `details` is omitted entirely.

Reservation order (resolves H3):
```ts
const t = await resolveTarget(args);
await checkReachable(t.device, args.force === true);
reserveHost(t.host);
try {
  const session = await BdpSession.attach(t.host);
  const id = registerSession(session);
  bindHost(t.host, id);
  const invalidated = consumeInvalidatedBreakpoints(t.host);
  const out: Record<string, unknown> = { ok: true, host: t.host, session_id: id, bdp_version: session.bdpVersion };
  if (invalidated.length > 0) out['details'] = { invalidated_breakpoints: invalidated };
  return out;
} catch (e) {
  releaseHost(t.host);
  throw e;
}
```

**`debug_detach`** input: `{ session_id }`. Idempotent. The handler resolves the host via the registry's reverse lookup (resolves N1):
```ts
const id = args.session_id as string;
const host = getHostForSession(id);
if (!host) {
  // Already detached or never issued; idempotent no-op.
  return { ok: true, session_id: id };
}
const session = tryGetSession(id);
if (session) {
  // Snapshot breakpoints BEFORE closing the client (resolves H1).
  rememberBreakpoints(host, session.currentBreakpoints().slice());
  session.detach();
}
dropSession(id);
releaseHost(host);
return { ok: true, session_id: id };
```

**`debug_session_state`** input: `{ session_id }`. Output: `{ ok: true, session_id, state, bdp_version: number | null }` where `state` is one of `'live' | 'channel_exited' | 'connection_lost' | 'detached' | 'unknown'`. Lookup order:
1. If `hasSession(id)`: read with `tryGetSession(id)!` and return the live session's `state` and `bdp_version` (cast non-null since `hasSession` is true).
2. Else if `isKnownDetached(id)`: return `state: 'detached'`, `bdp_version: null` (resolves H6 / N2).
3. Else: return `state: 'unknown'`, `bdp_version: null`.

Never throws. Never destructive.

- [ ] **Step 1: Tests**

Cover:
- Happy attach with no prior breakpoints → no `details` field in response.
- Attach AFTER prior detach that had active breakpoints → `details.invalidated_breakpoints` populated with each entry's `reason: 'channel_exited'`.
- `BDP_ATTACH_BUSY` on second concurrent attach to the same host.
- `BDP_VERSION_UNSUPPORTED` pass-through with full `details: { device_version, supported_range }`.
- **Failure-then-retry (resolves N8):** first attach fails with `BDP_VERSION_UNSUPPORTED`; second attach to the same host immediately afterwards succeeds without `BDP_ATTACH_BUSY` (proves `releaseHost` ran in the catch).
- `debug_detach` idempotent: detaching an already-detached id returns `{ ok: true }` without error.
- `debug_detach` with breakpoints persists them; the next `debug_attach` to the same host surfaces them in `details.invalidated_breakpoints`.
- `debug_session_state` returns `'detached'` post-detach (not `'connection_lost'`).
- `debug_session_state` returns `'unknown'` for a never-issued id.
- `debug_session_state` returns `'live'` with the correct `bdp_version` for an active session.

Mocks: `vi.mock('@rokudev/device-client', ...)` to swap `BdpSession.attach`. Per-test reset: `_resetSessions()` plus `_resetCache()` from network-guard.

- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit.**

```bash
git commit -m "feat(rokudev-device): debug_attach / debug_detach / debug_session_state"
```

---

### Task 21: Breakpoint tools (`debug_set_breakpoint`, `debug_clear_breakpoint`, `debug_list_breakpoints`)

**Files:**
- Create: `packages/rokudev-device/src/tools/debug-breakpoints.ts`
- Create: `packages/rokudev-device/src/tools/debug-breakpoints.test.ts`
- Modify: `packages/rokudev-device/src/tools/all.ts`

**`debug_set_breakpoint`** input: `{ session_id, file, line, project_root? }`.

Algorithm (resolves C2):
```ts
const session = getSession(args.session_id);
const file = args.file as string;
const line = args.line as number;
let compiledFile = file;
let compiledLine = line;
let resolver: SourceMapResolver | null = null;
if (file.endsWith('.bs')) {
  const mapPath = await findSourceMap(file, args.project_root as string | undefined);
  if (!mapPath) {
    throw fail('BDP_NO_SOURCE_MAP',
      `no .brs.map found for ${file}`,
      { file, hint: 'set sourceMap: true in bsconfig.json and re-build' });   // exact verbatim string per spec §4.5.3
  }
  resolver = await SourceMapResolver.fromMapFile(mapPath);
  try {
    const translated = resolver.toCompiled(file, line);
    if (!translated) throw fail('BDP_BREAKPOINT_INVALID', `cannot translate ${file}:${line} via source map`, { file, line });
    compiledFile = translated.compiledFile;
    compiledLine = translated.compiledLine;
  } finally {
    resolver.dispose();
  }
}
const { id } = await session.setBreakpoint(compiledFile, compiledLine);
return { ok: true, id, source: { file, line }, compiled: { file: compiledFile, line: compiledLine } };
```

Pure `.brs` files (file does NOT end with `.bs`) bypass the source-map machinery entirely (resolves §4.5.3 third bullet). For these, `source` and `compiled` are equal in the response.

**`debug_clear_breakpoint`** and **`debug_list_breakpoints`** are thin pass-throughs.

- [ ] **Step 1: Tests**

Required:
- `.brs` file: no findSourceMap, direct pass-through.
- `.bs` file with map: forward translation, response shape correct.
- `.bs` file without map: throws BDP_NO_SOURCE_MAP, **assert `details.hint === 'set sourceMap: true in bsconfig.json and re-build'` byte-for-byte** (resolves C2).
- `.bs` file with map but mapping returns null: throws BDP_BREAKPOINT_INVALID with file+line.
- clear/list pass-through.

- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit.**

```bash
git commit -m "feat(rokudev-device): debug_set_breakpoint / clear / list with source-map handling"
```

---

### Task 22: Execution-control tools (`debug_continue`, `debug_step`, `debug_step_over`, `debug_step_out`, `debug_pause`)

**Files:**
- Create: `packages/rokudev-device/src/tools/debug-execution.ts`
- Create: `packages/rokudev-device/src/tools/debug-execution.test.ts`
- Modify: `packages/rokudev-device/src/tools/all.ts`

Five thin tools. Internal session method names: `resume`, `step('into'|'over'|'out')`, `pause`. MCP tool names per spec §4.5: `debug_continue`, `debug_step` (granularity `'into'`), `debug_step_over`, `debug_step_out`, `debug_pause`.

Each tool input: `{ session_id, thread_id? }` (`thread_id` not required for `debug_pause`). Output: `{ ok: true, session_id }`.

- [ ] **Step 1: Tests** (5 happy-path + 1 BDP_THREAD_LOST pass-through)
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit.**

```bash
git commit -m "feat(rokudev-device): debug_continue / step / step_over / step_out / pause"
```

---

### Task 23: Introspection tools (`debug_threads`, `debug_stack_trace`, `debug_variables`, `debug_eval`)

**Files:**
- Create: `packages/rokudev-device/src/tools/debug-introspect.ts`
- Create: `packages/rokudev-device/src/tools/debug-introspect.test.ts`
- Modify: `packages/rokudev-device/src/tools/all.ts`

**`debug_threads`** → `{ ok, threads: [{ id, name, is_primary }] }`.

**`debug_stack_trace`** input: `{ session_id, thread_id, project_root? }`. Output frames carry both compiled and source coordinates (resolves §4.5.3 second bullet):
```ts
{ ok, frames: [{ idx, function_name?, source_file, source_line, compiled_file, compiled_line }] }
```
Reverse translation: for each frame, attempt `findSourceMap(compiled_file, project_root)`; if found, load resolver, translate, dispose. If no map exists for that compiled file, `source_file = compiled_file` and `source_line = compiled_line`.

Disposal: each frame may load and dispose its own resolver; for performance, the handler caches `Map<compiled_file, SourceMapResolver | null>` for the duration of the call (null = "we tried and there is no map for this file") and disposes all loaded resolvers in `finally`.

**`debug_variables`** input: `{ session_id, thread_id, frame_idx, var_path?, get_children? }`. Output: `{ ok, variables: [{ name, type, value, expandable, var_path }] }`. Pass-through.

**`debug_eval`** input: `{ session_id, thread_id, frame_idx, expression, timeout_ms? }`. Output: `{ ok, result: { name, type, value, expandable, var_path } }`. Pass-through. Default `timeout_ms` is 30000.

- [ ] **Step 1: Tests**

`debug_threads` happy. `debug_stack_trace` with map present (assert source/compiled differ correctly). `debug_stack_trace` without map (source = compiled). `debug_stack_trace` ensures all loaded resolvers are disposed (spy on `dispose()`). `debug_variables` happy. `debug_eval` happy. `debug_eval` honours `timeout_ms`.

- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit.**

```bash
git commit -m "feat(rokudev-device): debug_threads / stack_trace / variables / eval"
```

---

### Task 24: Register all `debug_*` tools; update e2e expected list; concurrency smoke

**Files:**
- Modify: `packages/rokudev-device/src/tools/all.ts`. Verify all four debug-* modules are imported (lifecycle, breakpoints, execution, introspect).
- Modify: `packages/rokudev-device/tests/e2e.test.ts`. Add the 15 debug tool names as a new comment-grouped block.

The expected catalog grows from 33 to 48 tools (33 + 15 = 48; resolves H9). The e2e test already calls `.sort()` on the names array, so any insertion order works in the assertion; for diff readability, append a new comment-delimited block under the existing `// composite (T32)` block:

```ts
// debug (Plan 2)
'debug_attach', 'debug_clear_breakpoint', 'debug_continue', 'debug_detach',
'debug_eval', 'debug_list_breakpoints', 'debug_pause', 'debug_session_state',
'debug_set_breakpoint', 'debug_stack_trace', 'debug_step', 'debug_step_out',
'debug_step_over', 'debug_threads', 'debug_variables',
```

**Concurrency smoke (resolves H2).** Add a new test in the same e2e file that asserts BDP and telnet sessions can coexist:

```ts
it('debug_attach and log_stream_open coexist for the same host', async () => {
  // mock both BdpSession.attach and LogStream.open at the rokudev-device level so the e2e
  // doesn't require a real Roku. Verify both calls succeed and neither raises BDP_ATTACH_BUSY
  // or LOG_TAIL_BUSY for the cross-session combination.
});
```

(This is a unit-style test added to the e2e file; the actual MCP-spawn e2e remains the catalog assertion.)

- [ ] **Step 1: Edit e2e expected list (interpolated comment block).**
- [ ] **Step 2: Add concurrency smoke.**
- [ ] **Step 3: Build, run e2e:** `pnpm --filter rokudev-device build && pnpm --filter rokudev-device test`. Mismatch fails clearly.
- [ ] **Step 4: Commit.**

```bash
git commit -m "test(rokudev-device): e2e catalog expands to 48 tools; BDP + telnet concurrency smoke"
```

---

## Phase 5: Quality Gate and Release

### Task 25: Manual BDP smoke script

**Files:**
- Create: `scripts/manual-bdp-smoke.mjs`
- Modify: `README.md` (add a "Manual BDP smoke" section)

The script exercises `attach → threads → detach` against a real Roku in dev mode. Pinned channel-fixture work is deferred to Plan 3+; this script just attaches to whatever channel is currently sideloaded.

The script uses an accumulator buffer pattern matching `tests/e2e.test.ts` (resolves L6) so chunk-boundary splits don't drop responses:

```js
#!/usr/bin/env node
// Manual BDP smoke. Usage:
//   ROKUDEV_DEFAULT_ROKU_HOST=192.168.1.42 ROKUDEV_ROKU_DEV_PASSWORD=rokudev node scripts/manual-bdp-smoke.mjs
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const proc = spawn(process.execPath,
  [resolve('packages/rokudev-device/dist/index.js')],
  { stdio: ['pipe', 'pipe', 'inherit'] });

let nextId = 1;
let buf = '';
const pending = new Map();   // id → resolve fn

proc.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  const lines = buf.split('\n');
  buf = lines.pop() ?? '';
  for (const l of lines) {
    if (!l) continue;
    try {
      const obj = JSON.parse(l);
      const cb = pending.get(obj.id);
      if (cb) { pending.delete(obj.id); cb(obj); }
    } catch { /* ignore non-JSON lines */ }
  }
});

function call(method, params) {
  const id = nextId++;
  const req = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  return new Promise((res) => {
    pending.set(id, res);
    proc.stdin.write(req + '\n');
  });
}

await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bdp-smoke', version: '1' } });
const attach = await call('tools/call', { name: 'debug_attach', arguments: {} });
console.log('attach:', JSON.stringify(attach, null, 2));
const attachResult = JSON.parse(attach.result.content[0].text);
const sessionId = attachResult.session_id;
const threads = await call('tools/call', { name: 'debug_threads', arguments: { session_id: sessionId } });
console.log('threads:', JSON.stringify(threads, null, 2));
const detach = await call('tools/call', { name: 'debug_detach', arguments: { session_id: sessionId } });
console.log('detach:', JSON.stringify(detach, null, 2));
proc.kill();
```

- [ ] **Step 1: Create the script and `chmod +x`.**
- [ ] **Step 2: Append README "Manual BDP smoke" section.**
- [ ] **Step 3: Commit.**

```bash
git commit -m "chore: manual BDP smoke script"
```

---

### Task 26: README inventory update for Plan 2

**Files:**
- Modify: `README.md`

Append:

```md
## What's in v0.2 (Plan 2)

- BDP debugger client in `@rokudev/device-client`: TCP framing, version negotiation, port fallback (8081 → 8086), session lifecycle with state guard, BrighterScript `.brs.map` source-map handling, explicit dispose on resolvers.
- 15 new MCP tools in `rokudev-device`: `debug_attach`, `debug_detach`, `debug_session_state`, `debug_set_breakpoint`, `debug_clear_breakpoint`, `debug_list_breakpoints`, `debug_continue`, `debug_step`, `debug_step_over`, `debug_step_out`, `debug_pause`, `debug_stack_trace`, `debug_threads`, `debug_variables`, `debug_eval`.
- `debug_attach` surfaces `details.invalidated_breakpoints` for breakpoints carried over from a previous session that has since detached/exited (per spec §4.5.4).

Out of v0.2: conditional breakpoints, watch expressions, hot-reload (deferred per spec §4.5).
```

- [ ] **Step 1: Edit README.**
- [ ] **Step 2: Commit.**

```bash
git commit -m "docs: Plan 2 release notes in README"
```

---

### Task 27: Real-device verification (D3 gate)

**Files:**
- Modify: `docs/refs/bdp-wire-format.md` (append §6 verification entry)

This is the gating check for D3. The implementer (or user) runs `manual-bdp-smoke.mjs` against a real Roku in dev mode and records the outcome.

- [ ] **Step 1: Run** `node scripts/manual-bdp-smoke.mjs` with env vars set.

- [ ] **Step 2: Record the run as a verification log entry in `docs/refs/bdp-wire-format.md` §6**

Format (matches spec §6 line 885 requirement):
```
v2026-MM-DD: outcome=PASS, bdp_version=N, model=<roku model>, firmware=<version>, notes=<optional>
```

If no real Roku is available, record:
```
v2026-MM-DD: outcome=SKIPPED_NO_DEVICE_ATTACHED
```
or
```
v2026-MM-DD: outcome=SKIPPED_DEVICE_OFFLINE
```

If the smoke fails, capture the failure and use `outcome=FAIL`. Then revise client/session code in Phase 1 and re-run.

**Tagging gate:** v0.2.0 (Task 28) requires at least one §6 entry with `outcome=PASS`. SKIPPED entries are recorded for audit but do **not** satisfy D3. If the only entry is SKIPPED, the tag is held until a real-device pass is logged.

- [ ] **Step 3: Commit the verification-log update.**

```bash
git commit -m "docs(bdp): real-device verification log entry"
```

---

### Task 28: Bump versions, run `pnpm release-prep`, tag v0.2.0

**Files:**
- Modify: `packages/roku-device-client/package.json` (`0.1.0` → `0.2.0`)
- Modify: `packages/rokudev-device/package.json` (`0.1.0` → `0.2.0`)
- Modify: `package.json` (root, `0.1.0` → `0.2.0`)

Bump all three in a single edit pass and run `pnpm install` exactly once afterwards (resolves H11). Mid-bump `pnpm install`s would surface CROSS_PACKAGE_VERSION_MISMATCH warnings between the bumped and unbumped packages; do not commit between bumps.

**D3 gate:** before tagging, verify §6 of `bdp-wire-format.md` contains at least one `outcome=PASS` entry. If only SKIPPED entries are present, STOP and escalate; do not tag.

- [ ] **Step 1: Bump all three package.json versions in a single editing pass.**

- [ ] **Step 2: Run `pnpm install` exactly once.**

- [ ] **Step 3: Run `pnpm release-prep`.** Must be green.

- [ ] **Step 4: Verify D3 gate satisfied.** Read `docs/refs/bdp-wire-format.md` §6 and confirm at least one `outcome=PASS` line.

- [ ] **Step 5: Commit the version bump.**

```bash
git add packages/roku-device-client/package.json packages/rokudev-device/package.json package.json pnpm-lock.yaml
git commit -m "chore: bump to v0.2.0"
```

- [ ] **Step 6: Tag v0.2.0 (only if D3 satisfied).**

```bash
git tag -a v0.2.0 -m "v0.2.0: BDP debugger client + 15 debug_* MCP tools"
```

---

## Post-plan checklist

- [ ] Every task above has its tests run and committed.
- [ ] `pnpm release-prep` passes from a clean checkout.
- [ ] `manual-bdp-smoke.mjs` exercised against at least one real Roku; `bdp-wire-format.md` §6 contains an `outcome=PASS` line (D3 satisfied).
- [ ] `docs/refs/bdp-wire-format.md` is internally consistent: §1 frame layout matches `bdp/frame.ts`; §2 packet types match `bdp/messages.ts` and `bdp/wire-codec.ts`; §3a version-scheme decision matches `BdpVersionRange`.
- [ ] Public export surface of `@rokudev/device-client` includes `BdpClient`, `BdpSession`, `SourceMapResolver`, `findSourceMap`, and the BDP type union; `_internal/mock-bdp-server` is NOT in package `exports` (verified by `tests/exports.test.ts`).
- [ ] e2e catalog test asserts exactly 48 tools.
- [ ] BDP and telnet log streams demonstrably coexist (concurrency smoke from T24 passes).
- [ ] `BDP_NO_SOURCE_MAP` `details.hint` is the exact string `"set sourceMap: true in bsconfig.json and re-build"`.
- [ ] Every `SourceMapResolver` instance is disposed in a `finally` block at the call site (T21 for breakpoint translation, T23 for stack-trace reverse translation). No WASM-consumer leaks across breakpoint/stack-trace calls.
- [ ] `debug_attach` populates `details.invalidated_breakpoints` when breakpoints from a prior detach are present for that host (verified via end-to-end test in T20: detach with breakpoints, then re-attach, observe field).
- [ ] `debug_session_state` returns `'detached'` (not `'connection_lost'` or `'unknown'`) for an id that this process previously issued and detached.
- [ ] No `dev_password` or signing-password reference appears anywhere in BDP code (BDP is unauthenticated; this is defensive).

When the checklist is green, hand off to Plan 3 (generator + module merger). Plan 3 depends only on what Plans 1 and 2 ship.
