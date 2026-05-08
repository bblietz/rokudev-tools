import { fail } from '@rokudev/device-client';
import { registerToolsModule } from './_register.js';
import { getCatalog } from './_catalog-singleton.js';

/**
 * Synthesize a minimal example object that satisfies the JSON Schema `required` set.
 * Walks `required` and picks a canonical value per property type:
 *   string -> 'hello', number/integer -> 0, boolean -> false, array -> [], object -> {}.
 * Nested objects recurse. Used so MCP clients can show a runnable example config.
 */
function synthesizeExample(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!schema || typeof schema !== 'object') return out;
  const required: string[] = Array.isArray(schema['required']) ? (schema['required'] as string[]) : [];
  const props = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>;
  for (const key of required) {
    const prop = props[key];
    if (!prop || typeof prop !== 'object') { out[key] = null; continue; }
    const t = prop['type'];
    if (t === 'string') out[key] = 'hello';
    else if (t === 'integer' || t === 'number') out[key] = 0;
    else if (t === 'boolean') out[key] = false;
    else if (t === 'array') out[key] = [];
    else if (t === 'object') out[key] = synthesizeExample(prop);
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
      required: ['module_id'],
      properties: { module_id: { type: 'string' } },
    },
    handler: async (args) => {
      const cat = getCatalog();
      const id = String(args['module_id'] ?? '');
      const m = cat.modules.get(id);
      if (!m) {
        throw fail('UNKNOWN_MODULE', `No module with id '${id}'`,
          { stage: 'validate', module_id: id, available: [...cat.modules.keys()].sort() });
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id: m.module.id,
            version: m.module.version,
            schema: m.module_config_schema,
            example_config: synthesizeExample(m.module_config_schema as Record<string, unknown>),
            exports: m.module_wiring.exports,
            requires: m.module_wiring.requires,
          }),
        }],
      };
    },
  });
});
