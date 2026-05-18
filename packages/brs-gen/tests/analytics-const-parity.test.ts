import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shim from './analytics-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DISPATCHER_BS_PATH = join(
  __dirname,
  '../modules/analytics.event_pipe/files/source/_modules/analytics_event_pipe/Dispatcher.bs',
);

function parseConst(src: string, name: string): number {
  // matches: const NAME% = 123  OR  const NAME = 123  OR  const NAME! = 1.5
  const re = new RegExp(`^const\\s+${name}[%!]?\\s*=\\s*([-+]?\\d+(?:\\.\\d+)?)`, 'm');
  const m = src.match(re);
  if (!m) throw new Error(`const ${name} not found in Dispatcher.bs`);
  return Number(m[1]);
}

describe('analytics const parity (Dispatcher.bs <-> analytics-helpers.ts)', () => {
  const src = readFileSync(DISPATCHER_BS_PATH, 'utf8');

  it('ANALYTICS_DEFAULT_BATCH_INTERVAL_MS', () => {
    expect(parseConst(src, 'ANALYTICS_DEFAULT_BATCH_INTERVAL_MS')).toBe(shim.ANALYTICS_DEFAULT_BATCH_INTERVAL_MS);
  });
  it('ANALYTICS_DEFAULT_BATCH_MAX_EVENTS', () => {
    expect(parseConst(src, 'ANALYTICS_DEFAULT_BATCH_MAX_EVENTS')).toBe(shim.ANALYTICS_DEFAULT_BATCH_MAX_EVENTS);
  });
  it('ANALYTICS_SINK_HTTP_TIMEOUT_S', () => {
    expect(parseConst(src, 'ANALYTICS_SINK_HTTP_TIMEOUT_S')).toBe(shim.ANALYTICS_SINK_HTTP_TIMEOUT_S);
  });
  it('ANALYTICS_QUEUE_OVERFLOW_MULTIPLIER', () => {
    expect(parseConst(src, 'ANALYTICS_QUEUE_OVERFLOW_MULTIPLIER')).toBe(shim.ANALYTICS_QUEUE_OVERFLOW_MULTIPLIER);
  });
});
