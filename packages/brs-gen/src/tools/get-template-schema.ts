import { registerToolsModule } from './_register.js';
import { getCatalog } from './_catalog-singleton.js';
import { zodToJsonSchemaDraft7 } from '../spec/to-json-schema.js';
import { fail } from '@rokudev/device-client';

registerToolsModule((tools) => {
  tools.set('get_template_schema', {
    name: 'get_template_schema',
    description: 'Return JSON Schema Draft 7 and a minimal example AppSpec for the named template.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1 } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const id = String(args.id);
      const cat = getCatalog();
      const t = cat.templates.get(id);
      if (!t) {
        throw fail('UNKNOWN_TEMPLATE', `template not in catalog: ${id}`,
          { stage: 'catalog', given: id, known: [...cat.templates.keys()].sort() });
      }
      const url = new URL(`../../templates/${id}/schema.ts`, import.meta.url);
      const mod = (await import(url.href)) as { Schema?: unknown; Example?: unknown };
      if (!mod.Schema || !mod.Example) {
        throw fail('CATALOG_INVALID',
          `template ${id}'s schema.ts must export both 'Schema' and 'Example'`,
          { stage: 'catalog', template_id: id });
      }
      const jsonSchema = zodToJsonSchemaDraft7(mod.Schema as any, `${id}Schema`);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id,
            version: t.template.version,
            spec_compat: t.template.spec_compat,
            schema: jsonSchema,
            example_spec: mod.Example,
          }),
        }],
      };
    },
  });
});
