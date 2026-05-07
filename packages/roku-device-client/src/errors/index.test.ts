import { describe, it, expect } from 'vitest';
import { fail, warn, FAILURE_CODES, STAGES } from './index.js';

describe('errors', () => {
  it('fail() sets stage from code map', () => {
    const f = fail('NETWORK_UNREACHABLE', 'home not reachable from corp');
    expect(f.ok).toBe(false);
    expect(f.stage).toBe('device');
    expect(f.code).toBe('NETWORK_UNREACHABLE');
  });

  it('fail() omits details when none given', () => {
    const f = fail('DEVICE_NOT_FOUND', 'no such device');
    expect(f.details).toBeUndefined();
  });

  it('fail() carries details when given', () => {
    const f = fail('REGISTRY_BUSY', 'lock held', { holder_pid: 123 });
    expect(f.details).toEqual({ holder_pid: 123 });
  });

  it('warn() returns correct code and extras', () => {
    const w = warn('LOG_STREAM_OVERFLOW', 'dropped lines', { dropped_lines: 17 });
    expect(w.code).toBe('LOG_STREAM_OVERFLOW');
    expect(w.dropped_lines).toBe(17);
  });

  it('every FAILURE_CODES value is a known stage', () => {
    const knownStages: ReadonlySet<string> = new Set(STAGES);
    for (const stage of Object.values(FAILURE_CODES)) {
      expect(knownStages.has(stage)).toBe(true);
    }
  });
});
