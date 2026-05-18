import { describe, it, expect, vi } from 'vitest';
import { drainQueue } from './analytics-helpers.js';

const ev = (name: string) => ({ name, ts: '2026-05-18T00:00:00.000Z', props: {} });

describe('drainQueue', () => {
  it('calls each sink with the batch', () => {
    const sinkA = vi.fn().mockReturnValue(true);
    const sinkB = vi.fn().mockReturnValue(true);
    const out = drainQueue({ queue: [ev('a')], retryBuffer: [], sinks: [sinkA, sinkB] });
    expect(sinkA).toHaveBeenCalledOnce();
    expect(sinkB).toHaveBeenCalledOnce();
    expect(out.nextQueue).toEqual([]);
    expect(out.nextRetryBuffer).toEqual([]);
  });
  it('merges retryBuffer to FRONT of batch', () => {
    const sink = vi.fn().mockReturnValue(true);
    drainQueue({ queue: [ev('new')], retryBuffer: [ev('old')], sinks: [sink] });
    const batch = sink.mock.calls[0][0] as Array<{ name: string }>;
    expect(batch.map((e) => e.name)).toEqual(['old', 'new']);
  });
  it('pushes failed batch into nextRetryBuffer', () => {
    const sink = vi.fn().mockReturnValue(false);
    const out = drainQueue({ queue: [ev('a')], retryBuffer: [], sinks: [sink] });
    expect(out.nextRetryBuffer.map((e) => e.name)).toEqual(['a']);
  });
  it('drops the batch when retry also fails (no third attempt)', () => {
    const sink = vi.fn().mockReturnValue(false);
    const out = drainQueue({ queue: [], retryBuffer: [ev('a')], sinks: [sink] });
    expect(out.nextRetryBuffer).toEqual([]);
    expect(out.droppedCount).toBe(1);
  });
  it('treats sink throw as failure', () => {
    const sink = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const out = drainQueue({ queue: [ev('a')], retryBuffer: [], sinks: [sink] });
    expect(out.nextRetryBuffer.map((e) => e.name)).toEqual(['a']);
  });
});
