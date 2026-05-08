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
      './bdp',
    ]) {
      expect(exports).toHaveProperty(k);
    }
  });
  it('BDP exports are accessible at the package root', async () => {
    const root = await import('../src/index.js');
    expect(root).toHaveProperty('BdpClient');
    expect(root).toHaveProperty('BdpSession');
    expect(root).toHaveProperty('SourceMapResolver');
    expect(root).toHaveProperty('findSourceMap');
    expect(root).toHaveProperty('HANDSHAKE_TIMEOUT_MS');
    expect(root).toHaveProperty('DEFAULT_REQUEST_TIMEOUT_MS');
    expect(root).toHaveProperty('SUPPORTED_BDP_VERSIONS');
  });
});
