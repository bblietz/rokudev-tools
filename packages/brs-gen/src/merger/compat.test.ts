import { describe, it, expect } from 'vitest';
import { checkSpecCompat } from './compat.js';

describe('checkSpecCompat', () => {
  it('passes when spec_version satisfies range', () => {
    expect(checkSpecCompat(2, '>=1').ok).toBe(true);
    expect(checkSpecCompat(2, '>=2').ok).toBe(true);
    expect(checkSpecCompat(2, '>=1 <3').ok).toBe(true);
  });
  it('fails SPEC_VERSION_INCOMPATIBLE when spec_version outside range', () => {
    const r = checkSpecCompat(1, '>=2');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('SPEC_VERSION_INCOMPATIBLE');
  });
});
