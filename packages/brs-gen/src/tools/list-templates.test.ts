import { describe, it, expect, beforeEach } from 'vitest';
import { registerAllTools, type ToolDef } from './_register.js';
import './list-templates.js';

describe('list_templates tool', () => {
  let handler: ToolDef['handler'];
  beforeEach(() => {
    const tools = new Map<string, ToolDef>();
    registerAllTools(tools);
    const t = tools.get('list_templates');
    if (!t) throw new Error('not registered');
    handler = t.handler;
  });

  it('returns entries sorted by id with id/version/description', async () => {
    const { setCatalogForTests } = await import('./_catalog-singleton.js');
    setCatalogForTests({
      templates: new Map([
        [
          'zeta',
          {
            template: { id: 'zeta', version: '0.1.0', spec_compat: '>=1', description: 'z' },
            template_exports: { init_hooks: [], scene_nodes: [] },
            template_manifest_defaults: {},
          },
        ],
        [
          'alpha',
          {
            template: { id: 'alpha', version: '0.1.0', spec_compat: '>=1', description: 'a' },
            template_exports: { init_hooks: [], scene_nodes: [] },
            template_manifest_defaults: {},
          },
        ],
      ]) as any,
      modules: new Map(),
      warnings: [],
    });

    const result = (await handler({})) as {
      templates: Array<{ id: string; version: string; description: string }>;
    };
    expect(result.templates.map((t) => t.id)).toEqual(['alpha', 'zeta']);
    expect(result.templates[0]).toEqual({ id: 'alpha', version: '0.1.0', description: 'a' });
  });
});
