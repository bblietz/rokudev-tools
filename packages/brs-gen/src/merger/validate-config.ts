import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { fail, type Failure } from '@rokudev/device-client';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

type R = { ok: true } | { ok: false; failure: Failure };

export function validateModuleConfig(moduleId: string, schema: unknown, config: unknown): R {
  let validate;
  try {
    validate = ajv.compile(schema as object);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      failure: fail(
        'MODULE_CONFIG_INVALID',
        `config for module ${moduleId} has an invalid schema: ${message}`,
        { stage: 'config-validate', module_id: moduleId, reason: 'schema_compile_failed' },
      ),
    };
  }
  if (validate(config)) return { ok: true };
  const err = validate.errors?.[0];
  return {
    ok: false,
    failure: fail(
      'MODULE_CONFIG_INVALID',
      `config for module ${moduleId} failed validation: ${err?.message ?? 'unknown'}`,
      {
        stage: 'config-validate',
        module_id: moduleId,
        pointer: err?.instancePath ?? '',
        keyword: err?.keyword,
        params: err?.params,
      },
    ),
  };
}
