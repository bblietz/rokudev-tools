import { FAILURE_CODES, WARNING_CODES, STAGES } from './codes.js';
import { describe, it, expect } from 'vitest';

describe('BDP error codes', () => {
  it('STAGES includes "debug"', () => {
    expect(STAGES).toContain('debug');
  });

  it.each([
    'BDP_ATTACH_FAILED',
    'BDP_ATTACH_BUSY',
    'BDP_VERSION_UNSUPPORTED',
    'BDP_BREAKPOINT_INVALID',
    'BDP_NO_SOURCE_MAP',
    'BDP_THREAD_LOST',
  ])('registers %s as a debug-stage failure', (code) => {
    expect(FAILURE_CODES[code as keyof typeof FAILURE_CODES]).toBe('debug');
  });

  it('BDP_FALLBACK_TO_TELNET is a warning code', () => {
    expect(WARNING_CODES).toContain('BDP_FALLBACK_TO_TELNET');
  });
});
