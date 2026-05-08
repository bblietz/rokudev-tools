import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export function zodToJsonSchemaDraft7(schema: ZodTypeAny, name: string): Record<string, unknown> {
  const out = zodToJsonSchema(schema, { name, target: 'jsonSchema7' }) as Record<string, unknown>;
  const defs = (out.definitions ?? {}) as Record<string, unknown>;
  const inner = (defs[name] as Record<string, unknown> | undefined) ?? out;
  return { $schema: 'http://json-schema.org/draft-07/schema#', ...inner };
}
