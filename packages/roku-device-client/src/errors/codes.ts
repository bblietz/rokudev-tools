// All error codes from spec §4.6. Each maps to exactly one stage.

export const STAGES = [
  'validate',
  'render',
  'write',
  'package',
  'sideload',
  'device',
  'debug',
  'merge',
  'freeform',
  'registry',
  'lint',
  'bootstrap',
] as const;
export type Stage = (typeof STAGES)[number];

// Failure codes. Add to this map as new codes are introduced.
export const FAILURE_CODES = {
  // device
  DEVICE_NOT_FOUND: 'device',
  DEVICE_NOT_RESOLVED: 'device',
  DEVICE_NO_PASSWORD: 'device',
  DEVICE_UNREACHABLE: 'device',
  DEVICE_NOT_DEV_MODE: 'device',
  DEVICE_AUTH_FAILED: 'device',
  NETWORK_UNREACHABLE: 'device',
  ECP_PARAM_DISALLOWED: 'device',
  ECP_KEY_DISALLOWED: 'device',
  LOG_TAIL_BUSY: 'device',
  LOG_STREAM_TIMED_OUT: 'device',
  SCREENSHOT_FAILED: 'device',
  GENKEY_FAILED: 'device',
  REKEY_FAILED: 'device',
  SIGNING_PASSWORD_REJECTED: 'device',
  PACKAGE_FAILED: 'device',
  DEV_PKG_UNAVAILABLE: 'device',
  // sideload
  SIDELOAD_REJECTED: 'sideload',
  SIDELOAD_TIMEOUT: 'sideload',
  ZIP_NOT_FOUND: 'sideload',
  // registry
  REGISTRY_BUSY: 'registry',
  INVALID_DEVICE_NAME: 'registry',
  // bootstrap
  CROSS_PACKAGE_VERSION_MISMATCH: 'bootstrap',
  // debug
  BDP_ATTACH_FAILED: 'debug',
  BDP_ATTACH_BUSY: 'debug',
  BDP_VERSION_UNSUPPORTED: 'debug',
  BDP_BREAKPOINT_INVALID: 'debug',
  BDP_NO_SOURCE_MAP: 'debug',
  BDP_THREAD_LOST: 'debug',
  // merge / validate
  UNKNOWN_TEMPLATE: 'validate',
  UNKNOWN_MODULE: 'validate',
  APP_SPEC_INVALID: 'validate',
  SPEC_VERSION_INCOMPATIBLE: 'validate',
  MODULE_CONFIG_INVALID: 'validate',
  MODULE_VERSION_UNAVAILABLE: 'validate',
  MODULE_CONFLICT: 'merge',
  FILE_COLLISION: 'merge',
  INIT_ORDER_CYCLE: 'merge',
  WIRING_CONTRACT_VIOLATION: 'merge',
  MANIFEST_KEY_CONFLICT: 'merge',
  UNKNOWN_MANIFEST_KEY: 'merge',
  CATALOG_INVALID: 'validate',
  CATALOG_INTEGRITY: 'merge',
  // write / package / compile
  OUTPUT_DIR_NOT_EMPTY: 'write',
  LINT_FAILED: 'lint',
  COMPILE_FAILED: 'lint',
  ASSET_VALIDATION_FAILED: 'validate',
  MANIFEST_VALIDATION_FAILED: 'validate',
  // tool-surface
  NOT_IMPLEMENTED: 'validate',
} as const;
export type FailureCode = keyof typeof FAILURE_CODES;

// In-band warning codes (returned on ok:true responses).
export const WARNING_CODES = [
  'LOG_STREAM_OVERFLOW',
  'APPSPEC_PROMOTED',
  'BDP_FALLBACK_TO_TELNET',
  'CROSS_PACKAGE_VERSION_MISMATCH',
  // brs-gen (Plan 3)
  'ASYMMETRIC_CONFLICT',
  'MODULE_VERSION_UNPINNED',
  'BSC_LINT_WARNING',
  'SPEC_AUTO_PROMOTED',
  'HOOK_DISPATCH_NOT_INVOKED',
  'MANIFEST_DRIFT',
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];
