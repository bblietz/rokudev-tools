import {
  FAILURE_CODES,
  WARNING_CODES,
  STAGES,
  type FailureCode,
  type Stage,
  type WarningCode,
} from './codes.js';

export type Failure = {
  ok: false;
  stage: Stage;
  code: FailureCode;
  message: string;
  details?: Record<string, unknown>;
};

export type Warning = {
  code: WarningCode;
  message: string;
  [k: string]: unknown;
};

export function fail(
  code: FailureCode,
  message: string,
  details?: Record<string, unknown>,
): Failure {
  return { ok: false, stage: FAILURE_CODES[code], code, message, ...(details ? { details } : {}) };
}

export function warn(code: WarningCode, message: string, extra?: Record<string, unknown>): Warning {
  return { code, message, ...(extra ?? {}) };
}

export { FAILURE_CODES, WARNING_CODES, STAGES };
export type { FailureCode, WarningCode, Stage };
