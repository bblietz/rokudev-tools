import { fail, type Failure } from '@rokudev/device-client';

type Result = { ok: true } | { ok: false; failure: Failure };

export function preflightTemplate(given: string, known: ReadonlySet<string>): Result {
  if (known.has(given)) return { ok: true };
  return {
    ok: false,
    failure: fail('UNKNOWN_TEMPLATE', `template not in catalog: ${given}`, {
      stage: 'preflight', given, known: [...known].sort(),
    }),
  };
}
