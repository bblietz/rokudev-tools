import { fail } from '@rokudev/device-client';
import { registerToolsModule } from './_register.js';
import { getCatalog } from './_catalog-singleton.js';

/**
 * Synthesize a minimal example object that satisfies the JSON Schema `required` set.
 * Walks `required` and picks a canonical value per property type:
 *   string -> 'hello', integer/number -> 0, boolean -> false, array -> [], object -> {}.
 * For type arrays (e.g. ['string','null']), picks the first non-'null' type.
 * Nested object properties recurse into their own `required`/`properties`.
 */
function synthesizeExample(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!schema || typeof schema !== 'object') return out;
  const required: string[] = Array.isArray(schema['required'])
    ? (schema['required'] as string[])
    : [];
  const props = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>;
  for (const key of required) {
    const prop = props[key];
    if (!prop || typeof prop !== 'object') {
      out[key] = null;
      continue;
    }
    const rawT = prop['type'];
    const types: unknown[] = Array.isArray(rawT) ? rawT : [rawT];
    const primary = types.find((x) => x !== 'null') ?? types[0];
    if (primary === 'string') out[key] = 'hello';
    else if (primary === 'integer' || primary === 'number') out[key] = 0;
    else if (primary === 'boolean') out[key] = false;
    else if (primary === 'array') out[key] = [];
    else if (primary === 'object') out[key] = synthesizeExample(prop);
    else out[key] = null;
  }
  return out;
}

registerToolsModule((tools) => {
  tools.set('get_module_schema', {
    name: 'get_module_schema',
    description: 'Return JSON Schema + example_config + exports/requires wiring for a module.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string', minLength: 1 } },
    },
    handler: async (args) => {
      const cat = getCatalog();
      const id = String(args['id'] ?? '');
      const m = cat.modules.get(id);
      if (!m) {
        throw fail('UNKNOWN_MODULE', `No module with id '${id}'`, {
          stage: 'validate',
          id,
          available: [...cat.modules.keys()].sort(),
        });
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: m.module.id,
              version: m.module.version,
              spec_compat: m.module.spec_compat,
              config_schema: m.module_config_schema,
              example_config: synthesizeExample(m.module_config_schema as Record<string, unknown>),
              wiring: { exports: m.module_wiring.exports, requires: m.module_wiring.requires },
            }),
          },
        ],
      };
    },
  });
});
