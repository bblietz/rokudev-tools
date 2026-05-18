// packages/brs-gen/tests/analytics-helpers.ts
// TS shim mirroring pure logic in modules/analytics.event_pipe/files/source/_modules/analytics_event_pipe/Dispatcher.bs.
// Keep the constants below in sync (covered by analytics-const-parity.test.ts).

export const ANALYTICS_DEFAULT_BATCH_INTERVAL_MS = 10000;
export const ANALYTICS_DEFAULT_BATCH_MAX_EVENTS = 50;
export const ANALYTICS_SINK_HTTP_TIMEOUT_S = 5;
export const ANALYTICS_QUEUE_OVERFLOW_MULTIPLIER = 2;  // >2x batch_max triggers force-flush

export function normalizeEventName(input: string): { name: string; warning?: string } {
  const lowered = input.toLowerCase();
  const replaced = lowered.replace(/[\s-]+/g, '_');
  const stripped = replaced.replace(/[^a-z0-9_]/g, '');
  if (stripped === '') return { name: '', warning: `name "${input}" empty after normalization` };
  if (stripped !== input) return { name: stripped, warning: `name "${input}" normalized to "${stripped}"` };
  return { name: stripped };
}

export class SinkRegistry {
  private byHandle = new Map<number, string>();
  private byName = new Map<string, number>();
  private nextHandle = 1;
  add(name: string): number {
    const existing = this.byName.get(name);
    if (existing !== undefined) return existing;
    const h = this.nextHandle++;
    this.byHandle.set(h, name);
    this.byName.set(name, h);
    return h;
  }
  remove(handle: number): boolean {
    const name = this.byHandle.get(handle);
    if (name === undefined) return false;
    this.byHandle.delete(handle);
    this.byName.delete(name);
    return true;
  }
  list(): string[] {
    return Array.from(this.byHandle.values());
  }
}
