import { describe, it, expect } from 'vitest';
import { buildProvenance } from './provenance.js';

describe('buildProvenance', () => {
  it('produces a deterministic sorted record', () => {
    const p = buildProvenance({
      spec_version: 2,
      template: { id: 't', version: '0.1.0' },
      modules: [
        { id: 'b', version: '0.2.0', files: ['b1.bs', 'b0.bs'] },
        { id: 'a', version: '0.1.0', files: ['a.bs'] },
      ],
      init_order: ['b', 'a'],
      manifest_keys: ['title', 'bs_const'],
      brs_gen_version: '0.3.0',
    });
    const parsed = JSON.parse(p);
    expect(parsed.modules.map((m: any) => m.id)).toEqual(['a', 'b']); // sorted
    expect(parsed.modules[1].files).toEqual(['b0.bs', 'b1.bs']); // sorted
    expect(parsed.manifest_keys).toEqual(['bs_const', 'title']); // sorted
    expect(parsed.init_order).toEqual(['b', 'a']); // preserved
  });

  it('produces byte-equal output across re-invocations', () => {
    const input = {
      spec_version: 2 as const,
      template: { id: 't', version: '0.1.0' },
      modules: [],
      init_order: [],
      manifest_keys: [],
      brs_gen_version: '0.3.0',
    };
    expect(buildProvenance(input)).toBe(buildProvenance(input));
  });
});
