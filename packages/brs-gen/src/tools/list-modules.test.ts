import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerAllTools, type ToolDef } from './_register.js';
import { setCatalogForTests, _resetCatalog } from './_catalog-singleton.js';
import './list-modules.js';

describe('list_modules tool', () => {
  let handler: ToolDef['handler'];
  beforeEach(() => {
    setCatalogForTests({
      templates: new Map(),
      modules: new Map([
        [
          'zebra',
          {
            module: { id: 'zebra', version: '1.0.0', spec_compat: '>=1', description: 'z' },
            module_config_schema: { type: 'object' },
            module_files: { add: [] },
            module_wiring: { exports: [], requires: [], init_calls: [] },
            module_ordering: { before: [], after: [] },
            module_conflicts: { exclusive_with: [] },
          },
        ],
        [
          'alpha',
          {
            module: { id: 'alpha', version: '0.1.0', spec_compat: '>=1', description: 'a' },
            module_config_schema: { type: 'object' },
            module_files: { add: [] },
            module_wiring: { exports: [], requires: [], init_calls: [] },
            module_ordering: { before: [], after: [] },
            module_conflicts: { exclusive_with: [] },
          },
        ],
      ]) as any,
      warnings: [],
    });
    const tools = new Map<string, ToolDef>();
    registerAllTools(tools);
    const t = tools.get('list_modules');
    if (!t) throw new Error('list_modules not registered');
    handler = t.handler;
  });
  afterEach(() => _resetCatalog());

  it('returns modules sorted by id with id/version/spec_compat/description', async () => {
    const result = await handler({});
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.modules.map((m: any) => m.id)).toEqual(['alpha', 'zebra']);
    expect(parsed.modules[0]).toEqual({
      id: 'alpha',
      version: '0.1.0',
      spec_compat: '>=1',
      description: 'a',
    });
    expect(parsed.modules[1]).toEqual({
      id: 'zebra',
      version: '1.0.0',
      spec_compat: '>=1',
      description: 'z',
    });
  });
});
