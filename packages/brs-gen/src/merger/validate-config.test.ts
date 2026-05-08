import { describe, it, expect } from 'vitest';
import { validateModuleConfig } from './validate-config.js';

describe('validateModuleConfig', () => {
  const schema = {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', minLength: 1 } },
    additionalProperties: false,
  };

  it('passes when config matches schema', () => {
    expect(validateModuleConfig('m', schema, { text: 'hi' }).ok).toBe(true);
  });
  it('fails MODULE_CONFIG_INVALID on missing required', () => {
    const r = validateModuleConfig('m', schema, {});
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('MODULE_CONFIG_INVALID');
    expect(r.failure.details?.pointer).toBeDefined();
  });
  it('fails on additional property', () => {
    const r = validateModuleConfig('m', schema, { text: 'x', other: 1 });
    expect(r.ok).toBe(false);
  });
});
