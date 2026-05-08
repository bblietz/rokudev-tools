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

describe('FAILURE_CODES brs-gen coverage', () => {
  it('includes every brs-gen failure code', () => {
    for (const c of ['UNKNOWN_TEMPLATE', 'UNKNOWN_MODULE', 'APP_SPEC_INVALID',
                     'SPEC_VERSION_INCOMPATIBLE', 'MODULE_CONFIG_INVALID',
                     'MODULE_VERSION_UNAVAILABLE', 'MODULE_CONFLICT',
                     'FILE_COLLISION', 'INIT_ORDER_CYCLE',
                     'WIRING_CONTRACT_VIOLATION', 'MANIFEST_KEY_CONFLICT',
                     'UNKNOWN_MANIFEST_KEY', 'CATALOG_INVALID',
                     'CATALOG_INTEGRITY', 'OUTPUT_DIR_NOT_EMPTY',
                     'LINT_FAILED', 'COMPILE_FAILED',
                     'ASSET_VALIDATION_FAILED', 'MANIFEST_VALIDATION_FAILED',
                     'NOT_IMPLEMENTED']) {
      expect(FAILURE_CODES).toHaveProperty(c);
    }
  });
});
