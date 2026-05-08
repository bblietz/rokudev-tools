/**
 * BDP frame codec.
 *
 * Implements the low-level framing layer for the BrightScript Debug Protocol.
 * Wire format reference: docs/refs/bdp-wire-format.md §1.
 *
 * There are two distinct frame shapes:
 *
 * 1. Standard frames (v3+ length-prefixed framing, §1.3 / §1.4 / §1.5)
 *    Used for all requests, responses, and update events after the handshake.
 *    Layout: [packet_length:4LE] [packetType:4LE] [payload...]
 *    - packet_length is UInt32LE and counts itself (equals total buffer size).
 *    - At this codec layer "packetType" is the first UInt32LE after packet_length.
 *      In BDP requests that slot holds request_id; in responses/updates it also
 *      holds request_id (the command/error_code follows at bytes 8-11). The
 *      higher-level message codec (T5/T6) interprets these fields properly.
 *    - Pre-v3 response framing (no packet_length) is out of v1 scope per §3.2.
 *      The client targets protocol 3.x (SUPPORTED_BDP_VERSIONS max = 3.2.0).
 *
 * 2. Handshake frames (special, §1.2)
 *    Used only during the initial connect exchange. No length prefix.
 *    - HandshakeRequest: "bsdebug\0" (8 bytes, NUL-terminated magic string).
 *    - HandshakeResponse (pre-v3): magic\0 + major:4 + minor:4 + patch:4.
 *    - HandshakeV3Response (v3+):  magic\0 + major:4 + minor:4 + patch:4
 *                                  + remaining_packet_length:4 + revision_timestamp:8.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The magic string sent in the handshake request (doc §1.2).
 * The constant is the ASCII encoding of the 8-byte sequence b'bsdebug\0'.
 */
export const HANDSHAKE_MAGIC = 'bsdebug' as const;

/**
 * Sentinel request_id used during the handshake exchange (doc §1.2).
 * Value 0xFFFFFFFF (max UInt32) identifies the packet as part of the handshake.
 * The disambiguator in §1.6 uses this value.
 */
export const HANDSHAKE_SENTINEL_REQUEST_ID = 0xffffffff as const;

// Pre-allocated magic buffer (NUL-terminated) — used by encodeHandshakeRequest.
const MAGIC_BUF = Buffer.from(`${HANDSHAKE_MAGIC}\0`, 'utf8'); // 8 bytes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a successful standard-frame decode. */
export interface DecodedFrame {
  /** First UInt32LE after packet_length. In BDP requests this is request_id. */
  packetType: number;
  /** Bytes after the packetType field (may be empty). */
  payload: Buffer;
  /** Total bytes consumed from the input buffer (= packet_length value). */
  consumed: number;
}

/** Result of a successful handshake-response decode. */
export interface DecodedHandshakeResponse {
  /** Echo of the magic string (without NUL). */
  magic: string;
  major: number;
  minor: number;
  patch: number;
  /** True when the response is a HandshakeV3Response (major >= 3). */
  isV3: boolean;
  /**
   * Device firmware build timestamp in milliseconds since Unix epoch.
   * Present only in HandshakeV3Response (isV3 = true), doc §1.2.
   */
  revisionTimestamp?: bigint;
  /** Total bytes consumed from the input buffer. */
  consumed: number;
}

// ---------------------------------------------------------------------------
// Standard frame codec (v3+ packet_length-prefixed)
// ---------------------------------------------------------------------------

/**
 * Encode a standard BDP frame.
 *
 * Layout produced (doc §1.3 / §1.4):
 *   [packet_length:4LE] [packetType:4LE] [payload...]
 *
 * packet_length counts itself per §1.3:
 *   "The packet_length value equals the final write offset plus 4
 *    (the field itself is counted in the total)."
 *
 * @param packetType - First UInt32LE discriminator after the length field.
 *   For requests this is request_id; the message-layer codec (T5/T6) provides
 *   the full request/response structure.
 * @param payload - Command-specific bytes that follow packetType.
 */
export function encodeFrame(packetType: number, payload: Buffer): Buffer {
  const totalLength = 4 + 4 + payload.length; // packet_length + packetType + payload
  const buf = Buffer.allocUnsafe(totalLength);
  buf.writeUInt32LE(totalLength, 0); // packet_length (includes itself)
  buf.writeUInt32LE(packetType, 4);
  payload.copy(buf, 8);
  return buf;
}

/**
 * Attempt to decode one standard BDP frame from the front of `buf`.
 *
 * Returns null when `buf` does not yet contain a complete frame (the caller
 * should buffer more data from the TCP stream and retry).
 *
 * Per doc §1.6 (v3+ receive algorithm):
 *   "The receiver reads 4 bytes (packet_length) at offset 0, waits until
 *    buffer.length >= packet_length, then parses the full message."
 *
 * @param buf - Accumulated receive buffer (may contain multiple frames or a partial frame).
 */
export function decodeFrame(buf: Buffer): DecodedFrame | null {
  // Need at least 4 bytes to read packet_length.
  if (buf.length < 4) return null;

  const packetLength = buf.readUInt32LE(0);

  // packet_length includes itself, so minimum meaningful value is 8
  // (4 bytes length + 4 bytes packetType, zero payload).
  // If the buffer does not yet hold the full packet, signal incomplete.
  if (buf.length < packetLength) return null;

  // Guard against degenerate packet_length values (< 8 would mean the
  // packetType field is truncated).
  if (packetLength < 8) return null;

  const packetType = buf.readUInt32LE(4);
  // payload is everything after [packet_length:4][packetType:4] up to packetLength
  const payload = buf.subarray(8, packetLength);

  return {
    packetType,
    // Return a copy so the caller can release the receive buffer.
    payload: Buffer.from(payload),
    consumed: packetLength,
  };
}

// ---------------------------------------------------------------------------
// Handshake frame codec (special, no length prefix — doc §1.2)
// ---------------------------------------------------------------------------

/**
 * Encode a HandshakeRequest frame.
 *
 * Layout (doc §1.2, client -> device):
 *   [magic_string] [NUL]   (8 bytes total: "bsdebug\0")
 */
export function encodeHandshakeRequest(): Buffer {
  return Buffer.from(MAGIC_BUF); // return a copy each time
}

/**
 * Attempt to decode a HandshakeResponse or HandshakeV3Response from `buf`.
 *
 * Returns null when:
 * - The buffer is too short to hold the minimum response.
 * - The magic string does not match.
 *
 * The function distinguishes pre-v3 from v3 based on the major version field
 * (doc §3.1, §3.2):
 * - major >= 3: HandshakeV3Response — additional remaining_packet_length and
 *   revision_timestamp fields follow (doc §1.2).
 * - major < 3: HandshakeResponse — ends after the version triple.
 *
 * Layout — common prefix (both versions):
 *   "bsdebug\0"          (8 bytes, NUL-terminated magic)
 *   [major:4LE]
 *   [minor:4LE]
 *   [patch:4LE]
 *   ... (20 bytes minimum)
 *
 * Additional fields for v3+:
 *   [remaining_packet_length:4LE]   byte count from this field's end to end of packet
 *   [revision_timestamp:8LE]        BigUInt64LE, ms since Unix epoch
 *
 * @param buf - Raw bytes received from the device TCP socket.
 */
export function decodeHandshakeResponse(buf: Buffer): DecodedHandshakeResponse | null {
  // Minimum for pre-v3: 8 (magic+NUL) + 4+4+4 (version triple) = 20 bytes.
  const MIN_PRECONNECT = 20;
  if (buf.length < MIN_PRECONNECT) return null;

  // Verify magic (first 7 bytes) and NUL terminator (byte 7).
  const magicEnd = buf.indexOf(0x00);
  if (magicEnd !== 7) return null; // magic must be exactly 7 chars + NUL
  const magic = buf.toString('utf8', 0, 7);
  if (magic !== HANDSHAKE_MAGIC) return null;

  // Offset 8: version triple.
  const major = buf.readUInt32LE(8);
  const minor = buf.readUInt32LE(12);
  const patch = buf.readUInt32LE(16);
  // Offset after version triple: 20.

  if (major >= 3) {
    // HandshakeV3Response: need remaining_packet_length (4 bytes) at offset 20,
    // then remaining_packet_length more bytes (the revision_timestamp is 8 bytes).
    // Total required: 20 + 4 (remaining_packet_length field) + remaining_packet_length.
    if (buf.length < 24) return null; // not enough to read remaining_packet_length

    const remainingPacketLength = buf.readUInt32LE(20);
    // Total consumed = 20 (common prefix) + 4 (remaining_packet_length field) + remainingPacketLength
    const consumed = 20 + 4 + remainingPacketLength;
    if (buf.length < consumed) return null;

    // revision_timestamp is the first 8 bytes of the remaining payload (doc §1.2).
    if (remainingPacketLength < 8) return null; // malformed: not enough room for timestamp
    const revisionTimestamp = buf.readBigUInt64LE(24);

    return { magic, major, minor, patch, isV3: true, revisionTimestamp, consumed };
  }

  // Pre-v3: HandshakeResponse ends at offset 20.
  return { magic, major, minor, patch, isV3: false, consumed: 20 };
}
