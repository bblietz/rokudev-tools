// All error codes from spec §4.6. Each maps to exactly one stage.

export const STAGES = [
  'validate', 'render', 'write', 'package', 'sideload',
  'device', 'debug', 'merge', 'freeform', 'registry', 'lint', 'bootstrap',
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
  // (merge, debug, freeform, lint codes added by Plans 2-4)
} as const;
export type FailureCode = keyof typeof FAILURE_CODES;

// In-band warning codes (returned on ok:true responses).
export const WARNING_CODES = [
  'LOG_STREAM_OVERFLOW',
  'APPSPEC_PROMOTED',
  'BDP_FALLBACK_TO_TELNET',
  'CROSS_PACKAGE_VERSION_MISMATCH',
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];
