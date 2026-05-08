import { BdpSession, fail } from '@rokudev/device-client';

const sessions = new Map<string, BdpSession>();
const sessionsByHost = new Map<string, string>(); // host -> session_id (or '<pending>' during reserveHost)
const lastBreakpointsByHost = new Map<string, Array<{ file: string; line: number }>>();
const detachedIds = new Map<string, number>(); // id -> detach timestamp; bounded by DETACHED_MAX
const DETACHED_MAX = 256; // FIFO eviction when this many detached ids are tracked

export function registerSession(s: BdpSession): string {
  const id = `bdp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  sessions.set(id, s);
  return id;
}

export function getSession(id: string): BdpSession {
  const s = sessions.get(id);
  if (!s)
    throw fail('BDP_THREAD_LOST', `unknown session_id ${id}`, { session_state: 'connection_lost' });
  return s;
}

// Non-throwing read helpers used by debug_detach (idempotent) and debug_session_state (introspection).
export function tryGetSession(id: string): BdpSession | null {
  return sessions.get(id) ?? null;
}
export function hasSession(id: string): boolean {
  return sessions.has(id);
}

export function dropSession(id: string): boolean {
  const existed = sessions.delete(id);
  if (existed) {
    detachedIds.set(id, Date.now());
    if (detachedIds.size > DETACHED_MAX) {
      // FIFO evict oldest entry
      const oldest = detachedIds.keys().next().value;
      if (oldest !== undefined) detachedIds.delete(oldest);
    }
  }
  return existed;
}

export function isKnownDetached(id: string): boolean {
  return detachedIds.has(id);
}

export function reserveHost(host: string): void {
  if (sessionsByHost.has(host)) {
    throw fail('BDP_ATTACH_BUSY', `host ${host} already has an active BDP session`, { host });
  }
  sessionsByHost.set(host, '<pending>');
}

export function bindHost(host: string, sessionId: string): void {
  sessionsByHost.set(host, sessionId);
}

export function releaseHost(host: string): void {
  sessionsByHost.delete(host);
}

// Reverse lookup so debug_detach can find the host for a given session_id.
export function getHostForSession(sessionId: string): string | null {
  for (const [host, id] of sessionsByHost.entries()) {
    if (id === sessionId) return host;
  }
  return null;
}

export function rememberBreakpoints(
  host: string,
  bps: Array<{ file: string; line: number }>,
): void {
  if (bps.length > 0) lastBreakpointsByHost.set(host, bps);
}

export function consumeInvalidatedBreakpoints(
  host: string,
): Array<{ file: string; line: number; reason: 'channel_exited' | 'line_no_longer_present' }> {
  const list = lastBreakpointsByHost.get(host) ?? [];
  lastBreakpointsByHost.delete(host);
  // v1 only surfaces 'channel_exited'; 'line_no_longer_present' requires server confirmation (deferred).
  return list.map((b) => ({ ...b, reason: 'channel_exited' as const }));
}

// Test-only export. Clears all four maps.
export function _resetSessions(): void {
  sessions.clear();
  sessionsByHost.clear();
  lastBreakpointsByHost.clear();
  detachedIds.clear();
}
