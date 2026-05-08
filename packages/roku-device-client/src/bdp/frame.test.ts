/**
 * Tests for the BDP frame codec.
 *
 * Wire format reference: docs/refs/bdp-wire-format.md §1.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeFrame,
  decodeFrame,
  encodeHandshakeRequest,
  decodeHandshakeResponse,
  HANDSHAKE_MAGIC,
  HANDSHAKE_SENTINEL_REQUEST_ID,
} from './frame.js';

// ---------------------------------------------------------------------------
// Standard frame (v3+ length-prefixed framing)
// ---------------------------------------------------------------------------

describe('BDP standard frame codec', () => {
  it('round-trips a frame', () => {
    const payload = Buffer.from([0x01, 0x02, 0x03]);
    const encoded = encodeFrame(0x01, payload);
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

  it('returns null when buffer has length header but not the full body', () => {
    // Encode a frame with 3-byte payload, then slice off last byte.
    const full = encodeFrame(0x02, Buffer.from([0xaa, 0xbb, 0xcc]));
    const partial = full.subarray(0, full.length - 1);
    expect(decodeFrame(partial)).toBeNull();
  });

  it('decodes back-to-back frames in one buffer', () => {
    const a = encodeFrame(0x01, Buffer.from([0xaa]));
    const b = encodeFrame(0x02, Buffer.from([0xbb]));
    const combined = Buffer.concat([a, b]);
    const first = decodeFrame(combined)!;
    expect(first.packetType).toBe(0x01);
    expect(first.payload).toEqual(Buffer.from([0xaa]));
    const second = decodeFrame(combined.subarray(first.consumed))!;
    expect(second.packetType).toBe(0x02);
    expect(second.payload).toEqual(Buffer.from([0xbb]));
  });

  it('encodes a zero-payload frame with correct packet_length', () => {
    // packet_length = 4 (length field itself) + 4 (packetType) + 0 (payload) = 8
    const encoded = encodeFrame(0x03, Buffer.alloc(0));
    expect(encoded).toHaveLength(8);
    expect(encoded.readUInt32LE(0)).toBe(8); // packet_length
    expect(encoded.readUInt32LE(4)).toBe(0x03); // packetType
  });

  it('packet_length field counts itself (doc §1.3: total packet size including the field)', () => {
    // For a payload of N bytes: packet_length = 4 (length) + 4 (packetType) + N
    const payload = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55]);
    const encoded = encodeFrame(0xab, payload);
    const declaredLength = encoded.readUInt32LE(0);
    expect(declaredLength).toBe(encoded.length);
    expect(declaredLength).toBe(4 + 4 + 5); // 13
  });

  it('all multi-byte integers are little-endian', () => {
    // packetType = 0x01020304, verify LE encoding
    const packetType = 0x01020304;
    const encoded = encodeFrame(packetType, Buffer.alloc(0));
    // LE: bytes are [04, 03, 02, 01]
    expect(encoded[4]).toBe(0x04);
    expect(encoded[5]).toBe(0x03);
    expect(encoded[6]).toBe(0x02);
    expect(encoded[7]).toBe(0x01);
  });

  it('decodeFrame returns null for an exact 4-byte buffer (length only, no body)', () => {
    // A 4-byte buffer with packet_length=8 means body is 4 bytes, but we have 0 body bytes.
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(8, 0);
    expect(decodeFrame(buf)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Handshake frames (special, no length prefix — doc §1.2)
// ---------------------------------------------------------------------------

describe('BDP handshake codec', () => {
  it('HANDSHAKE_MAGIC is the expected ASCII string', () => {
    expect(HANDSHAKE_MAGIC).toBe('bsdebug');
  });

  it('HANDSHAKE_SENTINEL_REQUEST_ID is 0xFFFFFFFF', () => {
    expect(HANDSHAKE_SENTINEL_REQUEST_ID).toBe(0xffffffff);
  });

  it('encodeHandshakeRequest produces the magic string followed by a NUL byte', () => {
    const buf = encodeHandshakeRequest();
    // "bsdebug\0"
    expect(buf).toHaveLength(8);
    expect(buf.toString('utf8', 0, 7)).toBe('bsdebug');
    expect(buf[7]).toBe(0x00);
  });

  it('encodeHandshakeRequest is idempotent (same bytes every call)', () => {
    const a = encodeHandshakeRequest();
    const b = encodeHandshakeRequest();
    expect(a).toEqual(b);
  });

  it('decodeHandshakeResponse parses a pre-v3 response (magic + NUL + major + minor + patch)', () => {
    // Construct a synthetic pre-v3 handshake response.
    // Layout: "bsdebug\0" [major:4LE] [minor:4LE] [patch:4LE]
    const magic = Buffer.from('bsdebug\0', 'utf8');
    const rest = Buffer.alloc(12);
    rest.writeUInt32LE(2, 0); // major
    rest.writeUInt32LE(1, 4); // minor
    rest.writeUInt32LE(3, 8); // patch
    const raw = Buffer.concat([magic, rest]);

    const result = decodeHandshakeResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.magic).toBe('bsdebug');
    expect(result!.major).toBe(2);
    expect(result!.minor).toBe(1);
    expect(result!.patch).toBe(3);
    expect(result!.isV3).toBe(false);
    expect(result!.revisionTimestamp).toBeUndefined();
    // consumed = 8 (magic+NUL) + 12 = 20
    expect(result!.consumed).toBe(20);
  });

  it('decodeHandshakeResponse parses a v3 response (magic + NUL + major + minor + patch + remaining_packet_length + revision_timestamp)', () => {
    // Layout: "bsdebug\0" [major:4LE] [minor:4LE] [patch:4LE]
    //         [remaining_packet_length:4LE] [revision_timestamp:8LE]
    // remaining_packet_length counts from its end to end of packet = 8 (just the timestamp).
    const magic = Buffer.from('bsdebug\0', 'utf8');
    const header = Buffer.alloc(12); // major + minor + patch
    header.writeUInt32LE(3, 0); // major = 3 (v3)
    header.writeUInt32LE(0, 4); // minor
    header.writeUInt32LE(0, 8); // patch
    const tail = Buffer.alloc(12); // remaining_packet_length + timestamp
    tail.writeUInt32LE(8, 0); // remaining_packet_length = 8 (just revision_timestamp)
    tail.writeBigUInt64LE(1714900000000n, 4); // revision_timestamp (ms epoch)
    const raw = Buffer.concat([magic, header, tail]);

    const result = decodeHandshakeResponse(raw);
    expect(result).not.toBeNull();
    expect(result!.major).toBe(3);
    expect(result!.minor).toBe(0);
    expect(result!.patch).toBe(0);
    expect(result!.isV3).toBe(true);
    expect(result!.revisionTimestamp).toBe(1714900000000n);
    // consumed = 8 + 12 + 12 = 32
    expect(result!.consumed).toBe(32);
  });

  it('decodeHandshakeResponse returns null when buffer is too short for a pre-v3 response', () => {
    // Need at least magic(8) + major(4) + minor(4) + patch(4) = 20 bytes.
    const buf = Buffer.from('bsdebug\0', 'utf8'); // only 8 bytes
    expect(decodeHandshakeResponse(buf)).toBeNull();
  });

  it('decodeHandshakeResponse returns null when the magic does not match', () => {
    const buf = Buffer.alloc(20);
    buf.write('wrongmag\0', 0, 'utf8');
    expect(decodeHandshakeResponse(buf)).toBeNull();
  });

  it('decodeHandshakeResponse returns null when buffer is too short for a v3 tail', () => {
    // Valid magic + v3 version (major=3) but truncated before remaining_packet_length.
    const magic = Buffer.from('bsdebug\0', 'utf8');
    const header = Buffer.alloc(12);
    header.writeUInt32LE(3, 0); // major = 3
    const partial = Buffer.concat([magic, header]); // missing tail
    expect(decodeHandshakeResponse(partial)).toBeNull();
  });

  it('decodeHandshakeResponse returns null when v3 tail is truncated (remaining_packet_length present but data missing)', () => {
    const magic = Buffer.from('bsdebug\0', 'utf8');
    const header = Buffer.alloc(12);
    header.writeUInt32LE(3, 0); // major = 3
    const tail = Buffer.alloc(4); // only remaining_packet_length, no timestamp
    tail.writeUInt32LE(8, 0); // says 8 more bytes follow, but they don't
    const partial = Buffer.concat([magic, header, tail]);
    expect(decodeHandshakeResponse(partial)).toBeNull();
  });
});
