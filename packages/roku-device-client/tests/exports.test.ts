import { describe, it, expect } from 'vitest';
import pkg from '../package.json' with { type: 'json' };

describe('package exports', () => {
  it('does not expose _internal', () => {
    const exports = pkg.exports as Record<string, unknown>;
    for (const key of Object.keys(exports)) {
      expect(key).not.toMatch(/_internal/);
    }
  });
  it('exports the public surface', () => {
    const exports = pkg.exports as Record<string, unknown>;
    for (const k of [
      '.',
      './errors',
      './registry',
      './ecp',
      './devportal',
      './telnet',
      './discovery',
      './network',
    ]) {
      expect(exports).toHaveProperty(k);
    }
  });
});
