import { describe, it, expect } from 'vitest';
import { promoteV1ToV2 } from './promote.js';

describe('promoteV1ToV2', () => {
  it('converts v1 shape to v2 with empty modules', () => {
    const v1 = {
      spec_version: 1 as const,
      template: 'x',
      app: { name: 'N', major_version: 0, minor_version: 0, build_version: 0 },
    };
    const out = promoteV1ToV2(v1);
    expect(out.spec).toEqual({ ...v1, spec_version: 2, modules: [] });
    expect(out.warning?.code).toBe('SPEC_AUTO_PROMOTED');
  });
  it('leaves v2 unchanged and returns no warning', () => {
    const v2 = {
      spec_version: 2 as const,
      template: 'x',
      modules: [],
      app: { name: 'N', major_version: 0, minor_version: 0, build_version: 0 },
    };
    const out = promoteV1ToV2(v2);
    expect(out.spec).toEqual(v2);
    expect(out.warning).toBeUndefined();
  });
});
