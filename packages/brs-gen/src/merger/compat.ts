import semver from 'semver';
import { fail, type Failure } from '@rokudev/device-client';

type R = { ok: true } | { ok: false; failure: Failure };

export function checkSpecCompat(specVersion: number, range: string, labelFor?: string): R {
  const coerced = `${specVersion}.0.0`;
  if (semver.satisfies(coerced, range)) return { ok: true };
  return {
    ok: false,
    failure: fail('SPEC_VERSION_INCOMPATIBLE',
      `${labelFor ?? 'spec_compat'} range ${range} does not accept spec_version ${specVersion}`,
      { stage: 'compat', spec_version: specVersion, range, rejected_by: labelFor ?? null }),
  };
}
