import { registerToolsModule } from './_register.js';
import { getCatalog } from './_catalog-singleton.js';

registerToolsModule((tools) => {
  tools.set('list_modules', {
    name: 'list_modules',
    description: 'List all bundled feature modules with id, version, description.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const cat = getCatalog();
      const modules = [...cat.modules.values()]
        .map((m) => ({ id: m.module.id, version: m.module.version, spec_compat: m.module.spec_compat, description: m.module.description }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { content: [{ type: 'text', text: JSON.stringify({ modules }) }] };
    },
  });
});
