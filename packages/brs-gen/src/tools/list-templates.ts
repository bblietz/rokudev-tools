import { registerToolsModule } from './_register.js';
import { getCatalog } from './_catalog-singleton.js';

registerToolsModule((tools) => {
  tools.set('list_templates', {
    name: 'list_templates',
    description: 'List bundled base templates available for generate_app. Sorted by id ascending.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const cat = getCatalog();
      const templates = [...cat.templates.values()]
        .map((t) => ({ id: t.template.id, version: t.template.version, description: t.template.description }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { content: [{ type: 'text', text: JSON.stringify({ templates }) }] };
    },
  });
});
