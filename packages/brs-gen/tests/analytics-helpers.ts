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

export function mergeIdentity(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
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

export interface DeviceInfoLike {
  GetChannelClientId(): string;
  GetRIDA(): string;
  IsRIDADisabled(): boolean;
  GetModel(): string;
  GetVersion(): string;
}

export function buildAutoProps(args: {
  di: DeviceInfoLike;
  sessionId: string;
  manifestVersion: string;
  defaultProps: Record<string, string>;
  identity: Record<string, unknown>;
  nowMs: number;
}): Record<string, unknown> {
  const props: Record<string, unknown> = {
    channel_client_id: args.di.GetChannelClientId(),
    session_id:        args.sessionId,
    channel_version:   args.manifestVersion,
    roku_model:        args.di.GetModel(),
    roku_fw:           args.di.GetVersion(),
    ts_epoch_ms:       args.nowMs,
  };
  if (!args.di.IsRIDADisabled()) props.rida = args.di.GetRIDA();
  for (const [k, v] of Object.entries(args.defaultProps)) props[k] = v;
  for (const [k, v] of Object.entries(args.identity)) props[k] = v;
  return props;
}
