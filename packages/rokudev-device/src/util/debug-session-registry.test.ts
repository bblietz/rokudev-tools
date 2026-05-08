import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSession, getSession, tryGetSession, hasSession, dropSession, isKnownDetached,
  reserveHost, bindHost, releaseHost, getHostForSession,
  rememberBreakpoints, consumeInvalidatedBreakpoints, _resetSessions,
} from './debug-session-registry.js';

beforeEach(() => { _resetSessions(); });

describe('DebugSessionRegistry', () => {
  // Use a fake BdpSession placeholder; the registry only stores the reference.
  const fakeSession = {} as any;

  it('registerSession returns a unique id and getSession retrieves the session', () => {
    const id = registerSession(fakeSession);
    expect(id).toMatch(/^bdp-\d+-[a-z0-9]+$/);
    expect(getSession(id)).toBe(fakeSession);
  });

  it('getSession throws BDP_THREAD_LOST for unknown id', () => {
    try {
      getSession('not-a-real-id');
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e).toMatchObject({ ok: false, code: 'BDP_THREAD_LOST', details: { session_state: 'connection_lost' } });
    }
  });

  it('tryGetSession returns the session or null', () => {
    const id = registerSession(fakeSession);
    expect(tryGetSession(id)).toBe(fakeSession);
    expect(tryGetSession('unknown')).toBeNull();
  });

  it('hasSession mirrors as boolean', () => {
    const id = registerSession(fakeSession);
    expect(hasSession(id)).toBe(true);
    expect(hasSession('unknown')).toBe(false);
  });

  it('dropSession removes from sessions and records in detachedIds', () => {
    const id = registerSession(fakeSession);
    expect(dropSession(id)).toBe(true);
    expect(hasSession(id)).toBe(false);
    expect(isKnownDetached(id)).toBe(true);
  });

  it('dropSession returns false for unknown id and does not record it', () => {
    expect(dropSession('unknown')).toBe(false);
    expect(isKnownDetached('unknown')).toBe(false);
  });

  it('isKnownDetached returns true for recently-dropped id, false for never-issued', () => {
    const id = registerSession(fakeSession);
    expect(isKnownDetached(id)).toBe(false);   // not yet dropped
    dropSession(id);
    expect(isKnownDetached(id)).toBe(true);
    expect(isKnownDetached('never-existed')).toBe(false);
  });

  it('detachedIds FIFO-evicts at DETACHED_MAX + 1 entries', () => {
    // Register and drop 257 sessions; verify the first one is no longer in detachedIds
    const ids: string[] = [];
    for (let i = 0; i < 257; i++) {
      const id = registerSession(fakeSession);
      ids.push(id);
      dropSession(id);
    }
    expect(isKnownDetached(ids[0]!)).toBe(false);   // oldest evicted
    expect(isKnownDetached(ids[256]!)).toBe(true);  // newest still present
  });

  it('reserveHost stores host->pending; second reservation throws BDP_ATTACH_BUSY', () => {
    reserveHost('1.2.3.4');
    try {
      reserveHost('1.2.3.4');
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e).toMatchObject({ ok: false, code: 'BDP_ATTACH_BUSY', details: { host: '1.2.3.4' } });
    }
  });

  it('bindHost replaces pending with session_id; getHostForSession reverse-lookup works', () => {
    reserveHost('1.2.3.4');
    const id = 'bdp-abc-xyz';
    bindHost('1.2.3.4', id);
    expect(getHostForSession(id)).toBe('1.2.3.4');
    expect(getHostForSession('not-bound')).toBeNull();
  });

  it('releaseHost removes the binding', () => {
    reserveHost('1.2.3.4');
    bindHost('1.2.3.4', 'id1');
    releaseHost('1.2.3.4');
    expect(getHostForSession('id1')).toBeNull();
    // After release, host is reservable again
    expect(() => reserveHost('1.2.3.4')).not.toThrow();
  });

  it('rememberBreakpoints + consumeInvalidatedBreakpoints round-trip', () => {
    rememberBreakpoints('1.2.3.4', [
      { file: '/main.brs', line: 10 },
      { file: '/lib.brs', line: 20 },
    ]);
    const result = consumeInvalidatedBreakpoints('1.2.3.4');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ file: '/main.brs', line: 10, reason: 'channel_exited' });
    // After consume, the map is cleared
    expect(consumeInvalidatedBreakpoints('1.2.3.4')).toEqual([]);
  });

  it('rememberBreakpoints with empty array is a no-op', () => {
    rememberBreakpoints('1.2.3.4', []);
    expect(consumeInvalidatedBreakpoints('1.2.3.4')).toEqual([]);
  });

  it('_resetSessions clears all four maps', () => {
    const id = registerSession(fakeSession);
    reserveHost('1.2.3.4');
    rememberBreakpoints('1.2.3.4', [{ file: '/x', line: 1 }]);
    dropSession(id);
    _resetSessions();
    expect(hasSession(id)).toBe(false);
    expect(isKnownDetached(id)).toBe(false);
    expect(getHostForSession(id)).toBeNull();
    expect(consumeInvalidatedBreakpoints('1.2.3.4')).toEqual([]);
  });
});
