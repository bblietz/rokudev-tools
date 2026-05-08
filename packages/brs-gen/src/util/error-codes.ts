export const BRS_GEN_ERROR_CODES = [
  'UNKNOWN_TEMPLATE', 'UNKNOWN_MODULE', 'APP_SPEC_INVALID', 'SPEC_VERSION_INCOMPATIBLE',
  'MODULE_CONFIG_INVALID', 'MODULE_VERSION_UNAVAILABLE', 'MODULE_CONFLICT', 'FILE_COLLISION',
  'INIT_ORDER_CYCLE', 'WIRING_CONTRACT_VIOLATION', 'MANIFEST_KEY_CONFLICT',
  'UNKNOWN_MANIFEST_KEY', 'OUTPUT_DIR_NOT_EMPTY', 'LINT_FAILED', 'COMPILE_FAILED',
  'ASSET_VALIDATION_FAILED', 'MANIFEST_VALIDATION_FAILED', 'CATALOG_INVALID',
  'CROSS_PACKAGE_VERSION_MISMATCH', 'NOT_IMPLEMENTED',
  // DEVICE_NO_PASSWORD is defined by @rokudev/device-client but may be re-raised
  // by generate_app's sideload path; listing it here keeps assertErrorCode()
  // satisfied when tool handlers pass through device-client failures.
  'DEVICE_NO_PASSWORD',
  // CATALOG_INTEGRITY is raised by T13 buildEmittedProject when a module
  // declares a file that was not loaded. Defensive guard kept distinct from
  // FILE_COLLISION.
  'CATALOG_INTEGRITY',
] as const;

export const BRS_GEN_WARNING_CODES = [
  'ASYMMETRIC_CONFLICT', 'MODULE_VERSION_UNPINNED', 'BSC_LINT_WARNING',
  'SPEC_AUTO_PROMOTED', 'HOOK_DISPATCH_NOT_INVOKED', 'MANIFEST_DRIFT',
] as const;

export type BrsGenErrorCode = (typeof BRS_GEN_ERROR_CODES)[number];
export type BrsGenWarningCode = (typeof BRS_GEN_WARNING_CODES)[number];

export function assertErrorCode(c: string): asserts c is BrsGenErrorCode {
  if (!(BRS_GEN_ERROR_CODES as readonly string[]).includes(c)) {
    throw new Error(`Unknown brs-gen error code: ${c}`);
  }
}
export function assertWarningCode(c: string): asserts c is BrsGenWarningCode {
  if (!(BRS_GEN_WARNING_CODES as readonly string[]).includes(c)) {
    throw new Error(`Unknown brs-gen warning code: ${c}`);
  }
}
