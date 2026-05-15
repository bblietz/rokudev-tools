import { describe, it, expect } from 'vitest';
import {
  BRS_GEN_ERROR_CODES,
  BRS_GEN_WARNING_CODES,
  assertErrorCode,
  assertWarningCode,
} from './error-codes.js';

describe('error-codes registry', () => {
  it('enumerates every spec error code', () => {
    for (const c of [
      'UNKNOWN_TEMPLATE',
      'UNKNOWN_MODULE',
      'APP_SPEC_INVALID',
      'SPEC_VERSION_INCOMPATIBLE',
      'MODULE_CONFIG_INVALID',
      'MODULE_VERSION_UNAVAILABLE',
      'MODULE_CONFLICT',
      'FILE_COLLISION',
      'INIT_ORDER_CYCLE',
      'WIRING_CONTRACT_VIOLATION',
      'MANIFEST_KEY_CONFLICT',
      'UNKNOWN_MANIFEST_KEY',
      'OUTPUT_DIR_NOT_EMPTY',
      'LINT_FAILED',
      'COMPILE_FAILED',
      'ASSET_VALIDATION_FAILED',
      'MANIFEST_VALIDATION_FAILED',
      'CATALOG_INVALID',
      'CROSS_PACKAGE_VERSION_MISMATCH',
      'NOT_IMPLEMENTED',
      'DEVICE_NO_PASSWORD',
      'CATALOG_INTEGRITY',
      'SCREENSAVER_ZIP_TOO_LARGE',
    ]) {
      expect(BRS_GEN_ERROR_CODES).toContain(c);
    }
  });

  it('enumerates every spec warning code', () => {
    for (const c of [
      'ASYMMETRIC_CONFLICT',
      'MODULE_VERSION_UNPINNED',
      'BSC_LINT_WARNING',
      'SPEC_AUTO_PROMOTED',
      'HOOK_DISPATCH_NOT_INVOKED',
      'MANIFEST_DRIFT',
      'SCREENSAVER_ZIP_NEAR_LIMIT',
    ]) {
      expect(BRS_GEN_WARNING_CODES).toContain(c);
    }
  });

  it('assertErrorCode accepts registered codes and rejects unknown', () => {
    expect(() => assertErrorCode('UNKNOWN_TEMPLATE')).not.toThrow();
    expect(() => assertErrorCode('NOT_A_REAL_CODE')).toThrow();
  });

  it('assertWarningCode accepts registered codes and rejects unknown', () => {
    expect(() => assertWarningCode('BSC_LINT_WARNING')).not.toThrow();
    expect(() => assertWarningCode('FAKE')).toThrow();
  });
});
