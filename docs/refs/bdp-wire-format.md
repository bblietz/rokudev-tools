# BDP Wire Format Reference (vendored summary)

**Source:** `rokucommunity/roku-debug` @ `2a5249edee59221b48895441b4046b6f7f76921d` (tag `v0.23.6`, released 2026-04-30). License: MIT. Re-implemented from scratch in `@rokudev/device-client`; this doc is the authoritative wire-format reference for that work.

**Key source files studied:**

- `src/debugProtocol/Constants.ts`
- `src/debugProtocol/ProtocolUtil.ts`
- `src/debugProtocol/events/ProtocolEvent.ts`
- `src/debugProtocol/client/DebugProtocolClient.ts`
- `src/debugProtocol/events/requests/` (all request types)
- `src/debugProtocol/events/responses/` (all response types)
- `src/debugProtocol/events/updates/` (all async update types)

---

## 1. Frame layout

### 1.1 Transport

BDP runs over a **plain TCP socket** to port **8081** (the "control port"). A second dynamic port ("IO port") is used for stdout capture; its number is delivered in an `IOPortOpened` async update after connection. All multi-byte integers are **little-endian** unless otherwise noted.

### 1.2 Handshake frame (special)

The handshake exchange does NOT follow the standard frame layout. It uses a raw null-terminated magic string.

**HandshakeRequest** (client -> device):

```
[magic_string] [NUL]
```

| Field | Width    | Type   | Description                                       |
| ----- | -------- | ------ | ------------------------------------------------- |
| magic | variable | UTF-8Z | The ASCII string `bsdebug` followed by a NUL byte |

The constant is documented as the 64-bit little-endian encoding of `b'bsdebug\0'`.
`REQUEST_ID` for the handshake is the sentinel value `4294967295` (= `0xFFFFFFFF`, max UInt32).

**HandshakeResponse** (device -> client, protocol < v3.0.0):

```
[magic_string][NUL] [major:4] [minor:4] [patch:4]
```

| Field | Width    | Type     | Description                             |
| ----- | -------- | -------- | --------------------------------------- |
| magic | variable | UTF-8Z   | Echo of the magic string sent by client |
| major | 4        | UInt32LE | Protocol major version                  |
| minor | 4        | UInt32LE | Protocol minor version                  |
| patch | 4        | UInt32LE | Protocol patch version                  |

Versions >= 3.0.0 use the V3 handshake response instead (see below). If the device returns a version >= 3.0.0 here, the client will reject the connection.

**HandshakeV3Response** (device -> client, protocol >= v3.0.0):

```
[magic_string][NUL] [major:4] [minor:4] [patch:4] [remaining_packet_length:4] [revision_timestamp:8]
```

| Field                   | Width    | Type        | Description                                                     |
| ----------------------- | -------- | ----------- | --------------------------------------------------------------- |
| magic                   | variable | UTF-8Z      | Echo of the magic string sent by client                         |
| major                   | 4        | UInt32LE    | Protocol major version                                          |
| minor                   | 4        | UInt32LE    | Protocol minor version                                          |
| patch                   | 4        | UInt32LE    | Protocol patch version                                          |
| remaining_packet_length | 4        | UInt32LE    | Byte count from this field's end to end of packet               |
| revision_timestamp      | 8        | BigUInt64LE | Milliseconds since Unix epoch (device firmware build timestamp) |

Total required buffer: `remaining_packet_length + (offset of remaining_packet_length field)`. The read offset is advanced to the full end of the packet.

### 1.3 Standard request frame (client -> device)

All requests after the handshake share this header layout. The header is **prepended** by `insertCommonRequestFields()` after the payload body has been written.

```
[packet_length:4] [request_id:4] [command:4] [payload...]
```

| Field         | Offset | Width | Type     | Description                                         |
| ------------- | ------ | ----- | -------- | --------------------------------------------------- |
| packet_length | 0      | 4     | UInt32LE | Total packet size in bytes, including this field    |
| request_id    | 4      | 4     | UInt32LE | Monotonically increasing client-assigned request ID |
| command       | 8      | 4     | UInt32LE | Command discriminator (see §2 for values)           |
| payload       | 12     | var   | -        | Command-specific payload (may be zero bytes)        |

The `packet_length` value equals the final write offset plus 4 (the field itself is counted in the total).

### 1.4 Standard response frame (device -> client, correlated)

All responses share this header. The `request_id` is non-zero and matches the `request_id` from the triggering request.

```
[packet_length:4] [request_id:4] [error_code:4] [payload...]
```

For protocol < v3.0.0, there is **no** `packet_length` field; the frame begins at `request_id`:

```
[request_id:4] [error_code:4] [payload...]
```

| Field         | Offset (v3+) | Width | Type     | Description                           |
| ------------- | ------------ | ----- | -------- | ------------------------------------- |
| packet_length | 0            | 4     | UInt32LE | Total packet size in bytes (v3+ only) |
| request_id    | 4 (v3+) / 0  | 4     | UInt32LE | Echoes the request's request_id       |
| error_code    | 8 (v3+) / 4  | 4     | UInt32LE | See ErrorCode enum §4                 |
| payload       | 12 (v3+) / 8 | var   | -        | Command-specific response payload     |

**Optional error detail** (appended after `error_code` when `error_code != OK` and extra bytes remain):

| Field              | Width | Type     | Condition                                                            |
| ------------------ | ----- | -------- | -------------------------------------------------------------------- |
| error_flags        | 4     | UInt32LE | Bitfield: bit 0 = INVALID_VALUE_IN_PATH, bit 1 = MISSING_KEY_IN_PATH |
| invalid_path_index | 4     | UInt32LE | Only present if INVALID_VALUE_IN_PATH flag set                       |
| missing_key_index  | 4     | UInt32LE | Only present if MISSING_KEY_IN_PATH flag set                         |

### 1.5 Standard update frame (device -> client, async)

Async updates are identified by `request_id = 0`. The receiver checks the `request_id` field first; if zero, it reads `update_type` from the position immediately following `error_code`.

```
[packet_length:4] [request_id:4] [error_code:4] [update_type:4] [payload...]
```

For protocol < v3.0.0, `packet_length` is absent:

```
[request_id:4] [error_code:4] [update_type:4] [payload...]
```

| Field         | Offset (v3+)  | Width | Type     | Description                           |
| ------------- | ------------- | ----- | -------- | ------------------------------------- |
| packet_length | 0             | 4     | UInt32LE | Total packet size in bytes (v3+ only) |
| request_id    | 4 (v3+) / 0   | 4     | UInt32LE | Always 0 for updates                  |
| error_code    | 8 (v3+) / 4   | 4     | UInt32LE | See ErrorCode enum §4                 |
| update_type   | 12 (v3+) / 8  | 4     | UInt32LE | See UpdateTypeCode enum §2.5          |
| payload       | 16 (v3+) / 12 | var   | -        | Update-specific payload               |

### 1.6 Request/response/update disambiguation

The receiver reads the minimum header bytes (8 for pre-v3, 12 for v3+) and applies this logic:

1. If `request_id == 0xFFFFFFFF` (sentinel): this is part of a handshake.
2. If `request_id != 0`: this is a **correlated response** to a pending request.
3. If `request_id == 0`: this is an **async update**; read `update_type` at `byte[12]` (v3+) or `byte[8]` (pre-v3).

For v3+ framing, the receiver reads 4 bytes (`packet_length`) at offset 0, waits until `buffer.length >= packet_length`, then parses the full message. Oversized or malformed packets are discarded.

---

## 2. Packet types

### 2.1 Connect / Handshake

See §1.2 for full byte layout. Summary:

| Direction     | Packet              | command / discriminator |
| ------------- | ------------------- | ----------------------- |
| client -> dev | HandshakeRequest    | n/a (no command field)  |
| dev -> client | HandshakeResponse   | n/a (version < 3.0.0)   |
| dev -> client | HandshakeV3Response | n/a (version >= 3.0.0)  |

No `command` field exists in the handshake; framing relies on the known magic prefix.

### 2.2 Continue / StepInto / StepOver / StepOut / Pause (Stop) / ExitChannel

These are **command-only requests** (no response-specific payload beyond the common fields). Each carries only the standard 12-byte request header.

| Command     | CommandCode | Response payload beyond common fields   |
| ----------- | ----------- | --------------------------------------- |
| Stop        | 1           | none (GenericResponse / 8 bytes pre-v3) |
| Continue    | 2           | none                                    |
| ExitChannel | 122         | none                                    |

**StepRequest** (CommandCode 6) adds a payload:

Request payload (after common 12-byte header):
| Field | Width | Type | Description |
|-------------|-------|----------|--------------------------------------|
| thread_index| 4 | UInt32LE | Index of the thread to step |
| step_type | 1 | UInt8 | StepTypeCode (see §4) |

Total request size: 17 bytes.

Response: `GenericResponse` (common fields only, 8 bytes pre-v3, 12 bytes v3+).

**StepTypeCode values:**

| Name | Code |
| ---- | ---- |
| None | 0    |
| Line | 1    |
| Out  | 2    |
| Over | 3    |

### 2.3 Threads / StackTrace / Variables / Execute (eval)

#### ThreadsRequest (CommandCode 3)

Request payload: none (12-byte header only).

**ThreadsResponse** payload (after common response header):

| Field       | Width | Type     | Description              |
| ----------- | ----- | -------- | ------------------------ |
| num_threads | 4     | UInt32LE | Number of thread entries |

Followed by `num_threads` thread entries, each:

| Field              | Width | Type     | Description                                    |
| ------------------ | ----- | -------- | ---------------------------------------------- |
| flags              | 1     | UInt8    | bit 0 = isPrimary, bit 1 = isDetached          |
| stop_reason        | 4     | UInt32LE | StopReasonCode (32-bit for historical reasons) |
| stop_reason_detail | var   | UTF-8Z   | Null-terminated human-readable detail string   |
| line_number        | 4     | UInt32LE | 1-based line number where thread stopped       |
| function_name      | var   | UTF-8Z   | Null-terminated function name                  |
| file_path          | var   | UTF-8Z   | Null-terminated file path                      |
| code_snippet       | var   | UTF-8Z   | Null-terminated source code text at stop point |

#### StackTraceRequest (CommandCode 4)

Request payload (after common 12-byte header):

| Field        | Width | Type     | Description                |
| ------------ | ----- | -------- | -------------------------- |
| thread_index | 4     | UInt32LE | Index of the target thread |

Total request size: 16 bytes.

**StackTraceResponse** payload (after common response header):

| Field      | Width | Type     | Description             |
| ---------- | ----- | -------- | ----------------------- |
| stack_size | 4     | UInt32LE | Number of stack entries |

Followed by `stack_size` stack entries, each (protocol < v3.0.0, also v3.0.0):

| Field         | Width | Type     | Notes                                                                    |
| ------------- | ----- | -------- | ------------------------------------------------------------------------ |
| line_number   | 4     | UInt32LE | 1-based line number                                                      |
| file_path     | var   | UTF-8Z   | NOTE: device sends filePath BEFORE functionName (reversed from spec doc) |
| function_name | var   | UTF-8Z   | Null-terminated function name                                            |

No column number field exists in either StackTraceResponse or StackTraceV3Response.

**StackTraceV3Response** has identical per-entry layout to the above (the field reversal noted above applies to both versions).

#### VariablesRequest (CommandCode 5)

Request payload (after common 12-byte header):

| Field                  | Width | Type       | Description                                                                                 |
| ---------------------- | ----- | ---------- | ------------------------------------------------------------------------------------------- |
| variable_request_flags | 1     | UInt8      | Bitfield: 1=GetChildKeys, 2=CaseSensitivityOptions, 4=GetVirtualKeys, 8=VirtualPathIncluded |
| thread_index           | 4     | UInt32LE   | Thread index                                                                                |
| stack_frame_index      | 4     | UInt32LE   | Stack frame index (from StackTrace response)                                                |
| variable_path_len      | 4     | UInt32LE   | Number of path segments                                                                     |
| variable_path          | var   | UTF-8Z x N | variable_path_len null-terminated strings (path components)                                 |
| force_case_insensitive | var   | UInt8 x N  | One UInt8 per path entry; present only if CaseSensitivityOptions flag set                   |
| is_virtual             | var   | UInt8 x N  | One UInt8 per path entry; present only if VirtualPathIncluded flag set                      |

**VariablesResponse** payload (after common response header): see §5 for complete variable serialization.

#### ExecuteRequest (CommandCode 10)

Request payload (after common 12-byte header):

| Field             | Width | Type     | Description                         |
| ----------------- | ----- | -------- | ----------------------------------- |
| thread_index      | 4     | UInt32LE | Thread to execute in                |
| stack_frame_index | 4     | UInt32LE | Stack frame context                 |
| source_code       | var   | UTF-8Z   | BrightScript expression to evaluate |

**ExecuteV3Response** payload (after common response header):

| Field               | Width | Type       | Description                             |
| ------------------- | ----- | ---------- | --------------------------------------- |
| execute_success     | 1     | UInt8      | Non-zero = success                      |
| runtime_stop_code   | 1     | UInt8      | StopReasonCode of any runtime halt      |
| compile_error_count | 4     | UInt32LE   | Number of compile errors                |
| compile_errors      | var   | UTF-8Z x N | N null-terminated compile error strings |
| runtime_error_count | 4     | UInt32LE   | Number of runtime errors                |
| runtime_errors      | var   | UTF-8Z x N | N null-terminated runtime error strings |
| other_error_count   | 4     | UInt32LE   | Number of other errors                  |
| other_errors        | var   | UTF-8Z x N | N null-terminated other error strings   |

### 2.4 AddBreakpoints / RemoveBreakpoints / ListBreakpoints

#### AddBreakpointsRequest (CommandCode 7)

Request payload (after common 12-byte header):

| Field           | Width | Type     | Description                  |
| --------------- | ----- | -------- | ---------------------------- |
| num_breakpoints | 4     | UInt32LE | Number of breakpoint entries |

Followed by `num_breakpoints` breakpoint entries, each:

| Field        | Width | Type     | Description                                                     |
| ------------ | ----- | -------- | --------------------------------------------------------------- |
| file_path    | var   | UTF-8Z   | File location (e.g., `pkg:/source/main.brs`)                    |
| line_number  | 4     | UInt32LE | 1-based line number                                             |
| ignore_count | 4     | UInt32LE | Number of hits to ignore before breaking (0 = break every time) |

**AddBreakpointsResponse** is identical in structure to **ListBreakpointsResponse** (see below).

#### AddConditionalBreakpointsRequest (CommandCode 11)

Request payload (after common 12-byte header):

| Field           | Width | Type     | Description                  |
| --------------- | ----- | -------- | ---------------------------- |
| flags           | 4     | UInt32LE | Reserved, always 0           |
| num_breakpoints | 4     | UInt32LE | Number of breakpoint entries |

Followed by `num_breakpoints` conditional breakpoint entries, each:

| Field                  | Width | Type     | Description                                                   |
| ---------------------- | ----- | -------- | ------------------------------------------------------------- |
| file_path              | var   | UTF-8Z   | File location                                                 |
| line_number            | 4     | UInt32LE | 1-based line number                                           |
| ignore_count           | 4     | UInt32LE | Skip count (conditional: only decrements if expr is true)     |
| conditional_expression | var   | UTF-8Z   | BrightScript boolean expression; empty string = unconditional |

#### ListBreakpointsRequest (CommandCode 8)

Request payload: none (12-byte header only).

**ListBreakpointsResponse** (also used as **AddBreakpointsResponse** and **RemoveBreakpointsResponse**):

Payload (after common response header):

| Field           | Width | Type     | Description                  |
| --------------- | ----- | -------- | ---------------------------- |
| num_breakpoints | 4     | UInt32LE | Number of breakpoint entries |

Followed by `num_breakpoints` breakpoint entries, each:

| Field         | Width | Type     | Condition                 | Description                        |
| ------------- | ----- | -------- | ------------------------- | ---------------------------------- |
| breakpoint_id | 4     | UInt32LE | always present            | > 0 = active breakpoint; 0 = error |
| error_code    | 4     | UInt32LE | always present            | 0 = OK, 5 = INVALID_ARGS           |
| ignore_count  | 4     | UInt32LE | only if breakpoint_id > 0 | Current ignore count remaining     |

Valid breakpoints: 12 bytes each. Error breakpoints: 8 bytes each.

#### RemoveBreakpointsRequest (CommandCode 9)

Request payload (after common 12-byte header):

| Field           | Width | Type         | Description                |
| --------------- | ----- | ------------ | -------------------------- |
| num_breakpoints | 4     | UInt32LE     | Number of breakpoint IDs   |
| breakpoint_ids  | var   | UInt32LE x N | N breakpoint IDs to remove |

**RemoveBreakpointsResponse** is identical in structure to **ListBreakpointsResponse**.

#### SetExceptionBreakpointsRequest (CommandCode 12)

Request payload (after common 12-byte header):

| Field           | Width | Type     | Description                        |
| --------------- | ----- | -------- | ---------------------------------- |
| num_breakpoints | 4     | UInt32LE | Number of exception filter entries |

Followed by `num_breakpoints` exception filter entries, each:

| Field                | Width | Type     | Description                                    |
| -------------------- | ----- | -------- | ---------------------------------------------- |
| filter_type_id       | 4     | UInt32LE | 1 = caught exceptions, 2 = uncaught exceptions |
| condition_expression | var   | UTF-8Z   | BrightScript boolean condition or empty string |

**SetExceptionBreakpointsResponse** payload (after common response header):

| Field           | Width | Type     | Description              |
| --------------- | ----- | -------- | ------------------------ |
| num_breakpoints | 4     | UInt32LE | Number of filter entries |

Followed by `num_breakpoints` entries, each:

| Field      | Width | Type     | Description                        |
| ---------- | ----- | -------- | ---------------------------------- |
| filter     | 4     | UInt32LE | Filter type ID echoed from request |
| error_code | 4     | UInt32LE | 0 = OK, 5 = INVALID_ARGS           |

### 2.5 Update events (async, server-pushed)

Async updates always have `request_id = 0` in the frame header. The `update_type` field (at byte 12 for v3+, byte 8 for pre-v3) identifies the event. There are no numeric "ranges" for updates vs. responses; the sole discriminator is `request_id == 0`.

**UpdateTypeCode values:**

| Name                     | Code |
| ------------------------ | ---- |
| Undefined                | 0    |
| IOPortOpened             | 1    |
| AllThreadsStopped        | 2    |
| ThreadAttached           | 3    |
| BreakpointError          | 4    |
| CompileError             | 5    |
| BreakpointVerified       | 6    |
| ProtocolError            | 7    |
| ExceptionBreakpointError | 8    |

#### AllThreadsStopped (UpdateTypeCode 2)

Payload (after common 16-byte update header):

| Field              | Width | Type    | Description                                 |
| ------------------ | ----- | ------- | ------------------------------------------- |
| thread_index       | 4     | Int32LE | Index of primary thread that triggered stop |
| stop_reason        | 1     | UInt8   | StopReasonCode (see §4)                     |
| stop_reason_detail | var   | UTF-8Z  | Human-readable detail                       |

Minimum buffer: 16 bytes.

#### ThreadAttached (UpdateTypeCode 3)

Payload (after common 16-byte update header):

| Field              | Width | Type    | Description                    |
| ------------------ | ----- | ------- | ------------------------------ |
| thread_index       | 4     | Int32LE | Index of newly attached thread |
| stop_reason        | 1     | UInt8   | StopReasonCode                 |
| stop_reason_detail | var   | UTF-8Z  | Human-readable detail          |

Minimum buffer: 12 bytes (as declared in the source).

#### IOPortOpened (UpdateTypeCode 1)

Payload (after common 16-byte update header):

| Field | Width | Type    | Description                                                    |
| ----- | ----- | ------- | -------------------------------------------------------------- |
| port  | 4     | Int32LE | TCP port the client should connect to for stdout/stderr output |

#### CompileError (UpdateTypeCode 5)

Payload (after common 16-byte update header):

| Field         | Width | Type     | Description                             |
| ------------- | ----- | -------- | --------------------------------------- |
| flags         | 4     | UInt32LE | Reserved, always 0                      |
| error_message | var   | UTF-8Z   | Compile error description               |
| file_path     | var   | UTF-8Z   | Source file (`pkg:/` or `lib:/<name>/`) |
| line_number   | 4     | UInt32LE | 1-based line number                     |
| library_name  | var   | UTF-8Z   | Library name or empty string            |

#### BreakpointError (UpdateTypeCode 4)

Payload (after common 16-byte update header):

| Field               | Width | Type       | Description                             |
| ------------------- | ----- | ---------- | --------------------------------------- |
| flags               | 4     | UInt32LE   | Reserved, always 0                      |
| breakpoint_id       | 4     | UInt32LE   | Affected breakpoint ID                  |
| compile_error_count | 4     | UInt32LE   | Number of compile errors                |
| compile_errors      | var   | UTF-8Z x N | N null-terminated compile error strings |
| runtime_error_count | 4     | UInt32LE   | Number of runtime errors                |
| runtime_errors      | var   | UTF-8Z x N | N null-terminated runtime error strings |
| other_error_count   | 4     | UInt32LE   | Number of other errors                  |
| other_errors        | var   | UTF-8Z x N | N null-terminated other error strings   |

#### BreakpointVerified (UpdateTypeCode 6)

Payload (after common 16-byte update header):

| Field            | Width | Type         | Description                    |
| ---------------- | ----- | ------------ | ------------------------------ |
| flags            | 4     | UInt32LE     | Reserved, always 0             |
| breakpoint_count | 4     | UInt32LE     | Number of verified breakpoints |
| breakpoint_ids   | var   | UInt32LE x N | N verified breakpoint IDs      |

#### ExceptionBreakpointError (UpdateTypeCode 8)

Payload (after common 16-byte update header):

| Field               | Width | Type       | Description               |
| ------------------- | ----- | ---------- | ------------------------- |
| flags               | 4     | UInt32LE   | Reserved, always 0        |
| filter_id           | 4     | UInt32LE   | Exception filter ID       |
| compile_error_count | 4     | UInt32LE   | Number of compile errors  |
| compile_errors      | var   | UTF-8Z x N | Compile error strings     |
| runtime_error_count | 4     | UInt32LE   | Number of runtime errors  |
| runtime_errors      | var   | UTF-8Z x N | Runtime error strings     |
| other_error_count   | 4     | UInt32LE   | Number of other errors    |
| other_errors        | var   | UTF-8Z x N | Other error strings       |
| line_number         | 4     | Int32LE    | Source code line number   |
| file_path           | var   | UTF-8Z     | Null-terminated file path |

#### ProtocolError (UpdateTypeCode 7)

No additional payload documented beyond common update header fields.

---

## 3. Version negotiation

### 3.1 Protocol

1. Client opens TCP connection to device port 8081.
2. Client sends `HandshakeRequest` with magic string `bsdebug\0`.
3. Device responds with either `HandshakeResponse` (protocol < 3.0.0) or `HandshakeV3Response` (protocol >= 3.0.0).
4. Client attempts `HandshakeV3Response` parse first; if major version < 3, falls back to `HandshakeResponse` parse.
5. Client validates that the magic echo matches and that `protocolVersion` falls within `supportedVersionRange = '<=3.2.0'`. Versions below the minimum cause the connection to close; versions above emit a warning but the connection proceeds.

### 3.2 Version-scheme validation

After version extraction (three UInt32LE fields concatenated as `"major.minor.patch"`):

- Protocol `>= 3.0.0`: enables `watchPacketLength` mode; `packet_length` field is present in all response/update frames.
- Protocol `< 3.0.0`: `packet_length` field absent; update_type at byte 8, not byte 12.
- Feature flags by version (client-side):
  - `supportsConditionalBreakpoints`: set if version >= threshold (exact value not yet extracted; see §7 item 1)
  - `supportsBreakpointVerification`: set if version >= threshold (exact value not yet extracted; see §7 item 1)

### 3.3 Version-scheme assumption (D2)

**Actual scheme (from T1 source study):** The BDP handshake carries a **semver triple** -- three independent `UInt32LE` fields (`major`, `minor`, `patch`) -- not a single integer. This contradicts the plan's default assumption of "integer protocol version". The truth from `roku-debug` @ `2a5249edee59221b48895441b4046b6f7f76921d` (tag `v0.23.6`) is the three-field layout documented in §1.2.

**Rationale for the original assumption:** The plan note "integer protocol version" was the default-if-unanswered prior. T1's study of `DebugProtocolClient.ts` and `Constants.ts` confirmed the triple structure. No non-triple scheme has been observed.

**Corrected `BdpVersionRange` type:**

The range must represent a semver triple at both ends, not a bare `number`. The type and constant are:

```typescript
/** A semver triple used to express a protocol version bound. */
export type BdpVersion = { major: number; minor: number; patch: number };

/** Inclusive range of BDP protocol versions this client supports. */
export type BdpVersionRange = { min: BdpVersion; max: BdpVersion };

/** Supported protocol versions as of @rokudev/device-client v1. */
export const SUPPORTED_BDP_VERSIONS: BdpVersionRange = {
  min: { major: 1, minor: 0, patch: 0 },
  max: { major: 3, minor: 2, patch: 0 },
};
```

The `max` bound `3.2.0` is taken directly from `roku-debug`'s `supportedVersionRange = '<=3.2.0'` (§3.1 item 5).

**Version comparison rule:** Compare `major` first, then `minor`, then `patch` (standard semver precedence). A device version is within range when `version >= min && version <= max` under this ordering.

**Implication for framing:** Protocol `>= 3.0.0` activates `watchPacketLength` mode (§3.2). The `BdpVersion` struct makes this threshold check unambiguous: `major >= 3`.

**Verification gate:** T27 runs the real-device handshake smoke test. If the device returns unexpected fields (e.g., a fourth version component, or a string-encoded version), the types and codec are revised before the v1 tag. The `SUPPORTED_BDP_VERSIONS` constant is also subject to revision if T27 reveals the device firmware has moved beyond `3.2.0`.

---

## 4. Stop reasons enum

### StopReasonCode (used in AllThreadsStopped, ThreadAttached, Threads response, Execute response)

| Name               | Code | Description                               |
| ------------------ | ---- | ----------------------------------------- |
| Undefined          | 0    | Unknown / unset                           |
| NotStopped         | 1    | Thread is currently running (not stopped) |
| NormalExit         | 2    | Thread exited normally                    |
| StopStatement      | 3    | Hit a `STOP` statement in BrightScript    |
| Break              | 4    | Hit a breakpoint                          |
| RuntimeError       | 5    | Uncaught runtime error                    |
| CaughtRuntimeError | 6    | Runtime error caught by try/catch         |

### ErrorCode (used in response and update headers)

| Name              | Code | Description                                          |
| ----------------- | ---- | ---------------------------------------------------- |
| OK                | 0    | Success                                              |
| OTHER_ERR         | 1    | Unclassified error                                   |
| UNDEFINED_COMMAND | 2    | Unknown command code                                 |
| CANT_CONTINUE     | 3    | Cannot continue (e.g., channel has exited)           |
| NOT_STOPPED       | 4    | Command requires stopped state but thread is running |
| INVALID_ARGS      | 5    | Invalid argument(s) in request                       |
| THREAD_DETACHED   | 6    | Thread has detached                                  |
| EXECUTION_TIMEOUT | 7    | Execute command timed out                            |

### CommandCode

| Name                      | Code |
| ------------------------- | ---- |
| Stop                      | 1    |
| Continue                  | 2    |
| Threads                   | 3    |
| StackTrace                | 4    |
| Variables                 | 5    |
| Step                      | 6    |
| AddBreakpoints            | 7    |
| ListBreakpoints           | 8    |
| RemoveBreakpoints         | 9    |
| Execute                   | 10   |
| AddConditionalBreakpoints | 11   |
| SetExceptionBreakpoints   | 12   |
| ExitChannel               | 122  |

### StepTypeCode

| Name | Code |
| ---- | ---- |
| None | 0    |
| Line | 1    |
| Out  | 2    |
| Over | 3    |

---

## 5. Variable serialization

Variable data is carried in **VariablesResponse** (response to CommandCode 5).

### 5.1 Top-level response payload

| Field         | Width | Type     | Description                |
| ------------- | ----- | -------- | -------------------------- |
| num_variables | 4     | UInt32LE | Number of variable entries |

Followed by `num_variables` variable entries (see §5.2).

### 5.2 Per-variable encoding

Each variable starts with:

| Field              | Width | Type  | Description                 |
| ------------------ | ----- | ----- | --------------------------- |
| flags              | 1     | UInt8 | Bitfield (see §5.3)         |
| variable_type_code | 1     | UInt8 | VariableTypeCode (see §5.4) |

Then conditionally:

| Field         | Width | Type     | Condition                  | Description                    |
| ------------- | ----- | -------- | -------------------------- | ------------------------------ |
| name          | var   | UTF-8Z   | if `isNameHere` flag set   | Variable name                  |
| ref_count     | 4     | UInt32LE | if `isRefCounted` flag set | Reference count                |
| key_type_code | 1     | UInt8    | if `isContainer` flag set  | VariableTypeCode of key type   |
| child_count   | 4     | UInt32LE | if `isContainer` flag set  | Number of children             |
| value         | var   | see §5.5 | if `isValueHere` flag set  | Encoded value (type-dependent) |

### 5.3 Variable flags (UInt8 bitfield)

| Flag                | Bit mask | Description                                                    |
| ------------------- | -------- | -------------------------------------------------------------- |
| isChildKey          | 0x01     | This entry is a child of the preceding non-child variable      |
| isConst             | 0x02     | Variable is constant/immutable                                 |
| isContainer         | 0x04     | Container type; key_type_code and child_count fields follow    |
| isNameHere          | 0x08     | Name field follows in the stream                               |
| isRefCounted        | 0x10     | ref_count field follows in the stream                          |
| isValueHere         | 0x20     | Value field follows (encoding depends on variable_type_code)   |
| isKeysCaseSensitive | 0x40     | Container keys are case-sensitive                              |
| isVirtual           | 0x80     | Virtual variable (synthetic, not a real BrightScript variable) |

**Expandable indication:** There is no separate `expandable` flag. A variable is expandable when `isContainer` is set AND `child_count > 0`. The caller can request child variables by issuing a new `VariablesRequest` with the variable's name appended to the path.

**Child ordering:** Variables are delivered in parent-then-children order. When `isChildKey = 0`, the entry is a new top-level (or requested-scope) variable. When `isChildKey = 1`, the entry is a child of the most recently seen entry with `isChildKey = 0`.

### 5.4 VariableTypeCode

| Type name        | Code | Notes                                 |
| ---------------- | ---- | ------------------------------------- |
| AssociativeArray | 1    | Container; key_type_code = String(13) |
| Array            | 2    | Container; key_type_code = Integer(7) |
| Boolean          | 3    |                                       |
| Double           | 4    |                                       |
| Float            | 5    |                                       |
| Function         | 6    |                                       |
| Integer          | 7    |                                       |
| Interface        | 8    |                                       |
| Invalid          | 9    | BrightScript `invalid`                |
| List             | 10   | Container                             |
| LongInteger      | 11   |                                       |
| Object           | 12   |                                       |
| String           | 13   |                                       |
| Subroutine       | 14   |                                       |
| SubtypedObject   | 15   | Two UTF-8Z strings joined by `"; "`   |
| Uninitialized    | 16   | No value                              |
| Unknown          | 17   | No value                              |

### 5.5 Value encoding by type

| VariableType(s)                                                | Width | Type       | Notes                                                               |
| -------------------------------------------------------------- | ----- | ---------- | ------------------------------------------------------------------- |
| String                                                         | var   | UTF-8Z     | Null-terminated string                                              |
| Object                                                         | var   | UTF-8Z     | Type/object identifier string                                       |
| Function                                                       | var   | UTF-8Z     | Function name string                                                |
| Interface                                                      | var   | UTF-8Z     | Interface name string                                               |
| Subroutine                                                     | var   | UTF-8Z     | Subroutine name string                                              |
| SubtypedObject                                                 | var   | UTF-8Z x 2 | Two sequential null-terminated strings (typename, subtype)          |
| Boolean                                                        | 1     | UInt8      | 0 = false, non-zero = true                                          |
| Integer                                                        | 4     | Int32LE    | Signed 32-bit integer                                               |
| LongInteger                                                    | 8     | BigInt64LE | Signed 64-bit integer                                               |
| Float                                                          | 4     | FloatLE    | IEEE 754 single-precision float                                     |
| Double                                                         | 8     | DoubleLE   | IEEE 754 double-precision float                                     |
| Array, AssociativeArray, List, Uninitialized, Unknown, Invalid | 0     | -          | No value bytes; presence indicated by `isValueHere` never being set |

### 5.6 roSGNode

`roSGNode` objects do not have a dedicated VariableTypeCode in the current protocol; they appear as `Object` (code 12) or `SubtypedObject` (code 15) with the subtype string carrying the node type name (e.g., `"roSGNode; ContentNode"`). The key_type_code for their child fields is typically `String` (13).

### 5.7 roFunction

BrightScript function references appear as `Function` (code 6) or `Subroutine` (code 14) with a UTF-8Z value holding the function name.

---

## 6. Verification log

### Run 1 (2026-05-08, outcome=PASS)

**Hardware:** Roku Ultra (model 4850X, region US), software 15.2.4 build 3442
**Test channel:** `FlappyBat` v2.3.0 (FlappyBird-Game-Roku, MD5 `8afd51be170e25a8b9d83b2a931be9d0`)
**Tester:** automated via `scripts/manual-bdp-smoke.mjs` driving `dist/index.js`

**Procedure**

1. Sideload `FlappyBird.zip` via `/plugin_install` with multipart `mysubmit=Install` and `archive=...`. The `remotedebug=1` form-field had no observable effect on whether port 8081 opens.
2. Launch the dev channel via ECP `POST /launch/dev?bs_debug_protocol=1`. **This deep-link query parameter is what causes the device to open BDP listener on TCP 8081.** Without it, port 8081 stays refused even with a dev channel running.
3. Run smoke test: `debug_attach` -> `debug_threads` -> `debug_detach`.

**Observations**

- Direct probe with python (`socket.create_connection` + write `b'bsdebug\x00'`, recv 64 bytes) confirms the device responds with a HandshakeV3Response. Bytes captured (hex):

  ```
  62736465627567 00          // "bsdebug\0"
  03 00 00 00                // major = 3
  05 00 00 00                // minor = 5
  00 00 00 00                // patch = 0
  0c 00 00 00                // remaining_packet_length = 12
  9a 2f 3f 24 9c 01 00 00    // revision_timestamp (BigUInt64LE) = 1764737912218
  00 00 00 00                // 4 trailing bytes inside remaining_packet_length
  14 00 00 00 ...            // begins next standard frame (likely IOPortOpened)
  ```

- Device speaks **BDP v3.5.0**. `roku-debug` v0.23.6 documents `<=3.2.0` but Roku has shipped newer minors. `SUPPORTED_BDP_VERSIONS.max` was raised from 3.2.0 to 3.5.0 to accept it. Pre-bump runs hit `BDP_VERSION_UNSUPPORTED` on 8081 and then fell back to 8086 (which is not BDP), surfacing as a confusing "handshake to :8086 timed out" error.
- BDP on port 8081 is **single-shot**: after one TCP client disconnects, port 8081 closes and a fresh `?bs_debug_protocol=1` launch is required to re-open it. Probing with `nc` is enough to consume the listener.
- Port 8086 was reachable on this device but did not serve BDP (handshake timed out at 5000ms). The port-fallback path (spec §4.5.1) is therefore present-but-not-useful on this firmware. Whether other firmwares serve BDP on 8086 was not retested.

**Smoke-test results**

```
debug_attach  -> ok=true, session_id=bdp-1778254114842-i2fyj6, bdp_version={3,5,0}
debug_threads -> ok=true, threads=[{id:0, is_primary:true, stop_reason:"break",
                                    file:"pkg:/source/main.brs", line:6,
                                    function_name:"main"}]
debug_detach  -> ok=true, session_id=bdp-1778254114842-i2fyj6
```

The BDP server pauses execution at the first BrightScript line (`main.brs:6`) on attach, consistent with the protocol's break-on-attach behaviour. End-to-end roundtrip including handshake validation, request/response correlation, source-map handling for the (already pkg-rooted) file, and clean teardown all functioned.

**Open follow-ups (not blocking T27 PASS)**

- Investigate whether the BDP listener can be made multi-shot per launch (would simplify reattach flows). Current understanding: the listener accepts exactly one connection per channel start.
- Determine the spectrum of firmwares that serve BDP on port 8086. The fallback exists in code (`connectWithFallback`) but was not exercised during this run.
- The 4 trailing bytes inside `remaining_packet_length` after the 8-byte timestamp are not yet decoded. They may be reserved/zero on this firmware. Spec §1.2 only documents the timestamp.

### Run 2 (2026-05-20, outcome=NEGATIVE — TV-class hardware does not serve BDP)

**Hardware:** TCL Roku TV 55S527-RF (model `A105X`, region US, panel-id 1), software **15.2.4 build 3442** (ui-build `88G.24E03442A`), `developer-enabled=true`, `brightscript-debugger-version=3.5.0` advertised in `/query/device-info`.
**Test channel:** `FlappyBat` v2.4.0 (FlappyBat-game-Roku, prebuilt `FlappyBat.zip`, 1.89 MB). Also tried with a brs-gen-generated `stub_hello` channel; same negative result.
**Tester:** ad-hoc via rokudev-tools plugin v0.1.1 + @rokudev/device-client v0.3.1, driven from a Claude Code session.

**Procedure**

1. Sideload `FlappyBat.zip` via `mcp__rokudev-device__sideload` (multipart `mysubmit=Install`). 200 OK, channel installs.
2. Launch via `mcp__rokudev-device__ecp_launch(app_id="dev", params={"bs_debug_protocol": "1"})`. 200 OK; channel boots and renders.
3. `mcp__rokudev-device__debug_attach`. Times out after 5000 ms.
4. Manual TCP probe `nc -z -v -w 2 <host> 8081` immediately before/after launch.
5. Repeated the sequence with three independent gating variables flipped (see table below). Each variable ruled out in isolation.

**Variables tested and ruled out**

| Gate hypothesis | State during test | BDP listener on 8081? |
|---|---|---|
| Firmware out of date | Latest available; "All software is up to date" dialog at 5/20/26 3:34pm. Last updated 5/8/26 2:31am. No newer build offered for model `A105X`. | refused |
| `bs_debug_protocol=1` launch param missing | Param now in `ECP_LAUNCH_KEYS` allowlist (device-client v0.3.1); confirmed sent (no `ECP_PARAM_DISALLOWED`) | refused |
| ECP mobile-control mode too strict | Flipped Settings → System → Advanced system settings → Control by mobile apps → Network access from `Enabled` to `Permissive`; verified via `ecp_device_info` (`ecp-setting-mode` field changed `enabled` -> `permissive`) | refused |
| All three above, applied together | Latest firmware + `bs_debug_protocol=1` + Permissive | refused |

**Observations**

- TCP **8081**: `ECONNREFUSED` at every probe (immediately post-launch and several seconds later). The BDP control port never opens on this hardware regardless of launch params or ECP mode.
- TCP **8086**: open at the TCP layer, but the BDP handshake (`bsdebug\0`) times out with no response. Same behaviour Run 1 saw on the Ultra. So 8086 on this device is *not* a hidden alternate BDP port either.
- TCP **8085** (telnet log): works fine. Channel boots, compiles cleanly, runs. So `developer-enabled=true` is fully effective for the non-BDP dev surface (sideload, logs, ECP, screenshot, dev-portal endpoints).
- `brightscript-debugger-version=3.5.0` is advertised in `/query/device-info` on this device, but advertisement is **decoupled from the listener actually being available**. This field reports what the system-image debugger library version *would* be if BDP were active; it does not imply the listener is reachable.

**Conclusion**

The BDP control port is **gated off at the firmware/hardware layer on TCL Roku TV (model `A105X`, software 15.2.4 build 3442)** independent of any client-side configuration. Three confirmed-orthogonal gates have been ruled out. Most likely explanation: BDP is not part of the TV-class product surface; the listener-init code path is either compiled out or wrapped in an `is_tv` / `model_family` check on this firmware. Run 1's PASS was on a Roku Ultra (4850X) -- a stick/box product line -- and is currently the only verified-working hardware class.

**Implications for rokudev-tools**

- The 13 active BDP tools (`debug_set_breakpoint`, `debug_threads`, `debug_stack_trace`, `debug_variables`, `debug_eval`, `debug_continue`, `debug_step`/`_over`/`_out`, `debug_pause`, `debug_list_breakpoints`, `debug_clear_breakpoint`, `debug_attach`) are unreachable against any Roku TV. They work against Ultra-class hardware per Run 1.
- `debug_attach` could be sharpened: on `BDP_ATTACH_FAILED` with `cause_code: "ECONNREFUSED"` after a fresh `bs_debug_protocol=1` launch, **and** when `ecp_device_info` reports `is-tv=true`, surface a clear hint that BDP is not supported on Roku TV hardware rather than the generic 5-second timeout. This would save the same investigation in future.

**Open follow-ups**

- Test at least one more TV model (Hisense, Onn, other TCL revisions) to confirm the gate is TV-class-wide and not TCL-specific.
- Test a Roku Express or Streaming Stick to confirm BDP works across the entire non-TV product line, not just Ultra.
- If a newer firmware ships for TVs, retest -- it's possible (though unlikely) that a future TV firmware exposes BDP.

---

## 7. Open questions

The following items were not fully verified from the source and require follow-up or will be resolved in subsequent tasks:

1. **Exact feature-flag version thresholds** (§3.2 placeholder): The precise semver values at which `supportsConditionalBreakpoints` and `supportsBreakpointVerification` are gated were not extracted. These are embedded in `DebugProtocolClient.ts` version comparisons. Resolve in T2.

2. **ProtocolError update payload**: `UpdateTypeCode 7` (ProtocolError) has no documented payload structure in the source files studied. It may carry only the common update header. Verify in T7 (mock server) or against a live device.

3. **Pre-v3 response framing for Threads/StackTrace/Variables**: The `GenericResponse` (pre-v3) carries only 8 bytes (`requestId` + `errorCode`). It is not clear whether Threads, StackTrace, and Variables responses also use a truncated header before v3.0.0, or whether the `packet_length` is simply absent but the rest of the payload follows normally. The `loadCommonResponseFields` code strongly implies the latter (packet_length absent, payload otherwise unchanged), but this was not verified against a pre-v3 device.

4. **Stack frame ordering for v1/v2 vs. v3**: StackTraceResponse and StackTraceV3Response appear to have the same wire layout (line_number, file_path, function_name), with the only confirmed difference being the presence of the standard `packet_length` header. The comment about reversed field order ("device sends filePath before functionName") applies to both. Confirm whether any additional fields were added in v3.

5. **IO port framing**: The IO port (received via `IOPortOpened` update) delivers stdout/stderr as a raw byte stream. The framing protocol on that port (if any) is not covered in this document. The `brs-debug-mcp` prototype consumed it as a raw newline-delimited text stream; this should be verified.

6. **Conditional breakpoint ignore_count semantics**: For `AddConditionalBreakpointsRequest`, the ignore_count is documented to decrement "only if the conditional expression evaluates to true". Whether this is device-enforced or a client-side concern is not confirmed from source inspection alone.

7. **ExceptionBreakpointError vs. BreakpointError**: `ExceptionBreakpointErrorUpdate` (UpdateTypeCode 8) has a `filter_id` and `line_number`/`file_path` tail; `BreakpointErrorUpdate` (UpdateTypeCode 4) has a `breakpoint_id` and no line/file tail. The distinction is clear in structure but the exact scenarios that trigger each were not verified.

8. **GenericResponse use before v3**: It is assumed `Stop`, `Continue`, `ExitChannel`, `Step`, `ListBreakpoints`, `RemoveBreakpoints` all return `GenericResponse` (8-byte pre-v3, 12-byte v3+). The `ExecuteV3Response` name implies that `Execute` may return a different structure pre-v3. The pre-v3 Execute response structure was not located.
