import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerAllTools, type ToolDef } from './_register.js';
import { setCatalogForTests, _resetCatalog } from './_catalog-singleton.js';
import './get-module-schema.js';

describe('get_module_schema tool', () => {
  let handler: ToolDef['handler'];
  beforeEach(() => {
    setCatalogForTests({
      templates: new Map(),
      modules: new Map([
        [
          'stub_label',
          {
            module: {
              id: 'stub_label',
              version: '0.1.0',
              spec_compat: '>=1',
              description: 'Stub label',
            },
            module_config_schema: {
              type: 'object',
              additionalProperties: false,
              required: ['text'],
              properties: { text: { type: 'string' } },
            },
            module_files: { add: [] },
            module_wiring: {
              exports: [{ kind: 'scene_node', name: 'StubLabel' }],
              requires: [],
              init_calls: [],
            },
            module_ordering: { before: [], after: [] },
            module_conflicts: { exclusive_with: [] },
          },
        ],
      ]) as any,
      warnings: [],
    });
    const tools = new Map<string, ToolDef>();
    registerAllTools(tools);
    const t = tools.get('get_module_schema');
    if (!t) throw new Error('get_module_schema not registered');
    handler = t.handler;
  });
  afterEach(() => _resetCatalog());

  it('returns id, version, spec_compat, config_schema, example_config, and wiring', async () => {
    const result = await handler({ id: 'stub_label' });
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.id).toBe('stub_label');
    expect(parsed.version).toBe('0.1.0');
    expect(parsed.spec_compat).toBe('>=1');
    expect(parsed.config_schema).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string' } },
    });
    expect(parsed.example_config).toEqual({ text: 'hello' });
    expect(parsed.wiring.exports).toEqual([{ kind: 'scene_node', name: 'StubLabel' }]);
    expect(parsed.wiring.requires).toEqual([]);
  });

  it('throws UNKNOWN_MODULE on missing id', async () => {
    await expect(handler({ id: 'does_not_exist' })).rejects.toMatchObject({
      code: 'UNKNOWN_MODULE',
    });
  });

  it('synthesizes example for type-array (nullable) string', async () => {
    setCatalogForTests({
      templates: new Map(),
      modules: new Map([
        [
          'nullable_mod',
          {
            module: { id: 'nullable_mod', version: '0.1.0', spec_compat: '>=1', description: 'n' },
            module_config_schema: {
              type: 'object',
              required: ['label'],
              properties: { label: { type: ['string', 'null'] } },
            },
            module_files: { add: [] },
            module_wiring: { exports: [], requires: [], init_calls: [] },
            module_ordering: { before: [], after: [] },
            module_conflicts: { exclusive_with: [] },
          } as any,
        ],
      ]),
      warnings: [],
    });
    const tools = new Map<string, ToolDef>();
    registerAllTools(tools);
    const tool = tools.get('get_module_schema')!;
    const raw = await tool.handler({ id: 'nullable_mod' });
    const result = JSON.parse((raw as any).content[0].text);
    expect(result.example_config).toEqual({ label: 'hello' });
  });
});
