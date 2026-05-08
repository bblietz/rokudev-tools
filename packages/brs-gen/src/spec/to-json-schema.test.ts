import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchemaDraft7 } from './to-json-schema.js';

describe('zodToJsonSchemaDraft7', () => {
  it('produces Draft 7 object for a Zod object', () => {
    const js = zodToJsonSchemaDraft7(z.object({ name: z.string().min(1) }).strict(), 'S');
    expect(js.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(js.type).toBe('object');
    expect(js.properties).toHaveProperty('name');
  });
  it('is JSON-serializable', () => {
    const js = zodToJsonSchemaDraft7(z.object({ n: z.number() }), 'S');
    expect(() => JSON.stringify(js)).not.toThrow();
  });
});
