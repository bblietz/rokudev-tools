import { describe, it, expect, beforeEach } from 'vitest';
import { registerAllTools, type ToolDef } from './_register.js';
import './get-template-schema.js';
import { setCatalogForTests } from './_catalog-singleton.js';

describe('get_template_schema tool', () => {
  let handler: ToolDef['handler'];
  beforeEach(() => {
    const tools = new Map<string, ToolDef>();
    registerAllTools(tools);
    const t = tools.get('get_template_schema');
    if (!t) throw new Error('not registered');
    handler = t.handler;
  });

  it('returns schema + example for known template', async () => {
    setCatalogForTests({
      templates: new Map([
        [
          'stub_hello',
          {
            template: { id: 'stub_hello', version: '0.1.0', spec_compat: '>=1', description: 'd' },
            template_exports: { init_hooks: [], scene_nodes: [] },
            template_manifest_defaults: {},
          },
        ],
      ]) as any,
      modules: new Map(),
      warnings: [],
    });
    const parsed = (await handler({ id: 'stub_hello' })) as {
      id: string;
      schema: { $schema: string };
      example_spec: unknown;
    };
    expect(parsed.id).toBe('stub_hello');
    expect(parsed.schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(parsed.example_spec).toBeDefined();
  });

  it('throws UNKNOWN_TEMPLATE for unknown id', async () => {
    setCatalogForTests({ templates: new Map(), modules: new Map(), warnings: [] });
    await expect(handler({ id: 'nope' })).rejects.toMatchObject({ code: 'UNKNOWN_TEMPLATE' });
  });
});
