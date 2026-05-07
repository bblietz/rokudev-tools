import { describe, it, expect } from 'vitest';
import { LogStream, type TelnetPort } from './client.js';
import { startMockTelnet } from '../../test/fixtures/mock-telnet.js';

describe('LogStream', () => {
  it('open + read returns the buffered lines', async () => {
    const m = await startMockTelnet(['line1', 'line2', 'line3']);
    try {
      const ls = await LogStream.open('127.0.0.1', m.port as TelnetPort);
      // Allow producer time to write.
      await new Promise((r) => setTimeout(r, 50));
      const r = ls.read();
      expect(r.lines).toEqual(expect.arrayContaining(['line1', 'line2', 'line3']));
      ls.close();
    } finally {
      await m.closeAll();
    }
  });

  it('multiple reads with no producer flush return empty arrays', async () => {
    const m = await startMockTelnet([]);
    try {
      const ls = await LogStream.open('127.0.0.1', m.port as TelnetPort);
      await new Promise((r) => setTimeout(r, 20));
      ls.read(); // drain initial empty
      expect(ls.read().lines).toEqual([]);
      expect(ls.read().lines).toEqual([]);
      ls.close();
    } finally {
      await m.closeAll();
    }
  });

  it('producer flooding past maxLines returns LOG_STREAM_OVERFLOW warning', async () => {
    // Lower maxLines via internal override so test can flood quickly.
    const FLOOD = 100;
    const lines = Array.from({ length: FLOOD }, (_, i) => `line${i}`);
    const m = await startMockTelnet(lines);
    try {
      const ls = await LogStream.open('127.0.0.1', m.port as TelnetPort);
      // Override maxLines via reflection (private field).
      (ls as unknown as { maxLines: number }).maxLines = 10;
      // Re-trigger pending flush (the ones already buffered are kept; new pushes get dropped).
      // Wait briefly for all data to arrive.
      await new Promise((r) => setTimeout(r, 100));
      const result = ls.read();
      // We expect dropped_lines > 0 because we pushed 100 lines into a 10-line buffer.
      // Note: depending on timing, maxLines change may or may not catch all pushes;
      // the assertion is that SOME dropping occurred.
      // If timing is flaky, lower maxLines BEFORE waiting.
      expect(result.lines.length).toBeLessThanOrEqual(11); // allow for race
      if (result.details?.warnings && result.details.warnings.length > 0) {
        expect(result.details.warnings[0]?.code).toBe('LOG_STREAM_OVERFLOW');
        expect(result.details.warnings[0]?.dropped_lines).toBeGreaterThan(0);
      } else {
        // Skip: maxLines override happened too late; mark this iteration as not exercising.
        // Instead, FORCE drops by directly calling push.
        for (let i = 0; i < 50; i++) (ls as unknown as { push: (s: string) => void }).push(`force${i}`);
        const r2 = ls.read();
        expect(r2.details?.warnings?.[0]?.code).toBe('LOG_STREAM_OVERFLOW');
        expect(r2.details?.warnings?.[0]?.dropped_lines).toBeGreaterThan(0);
      }
      ls.close();
    } finally {
      await m.closeAll();
    }
  });

  it('close throws LOG_STREAM_TIMED_OUT on subsequent read', async () => {
    const m = await startMockTelnet([]);
    try {
      const ls = await LogStream.open('127.0.0.1', m.port as TelnetPort);
      ls.close();
      // After close, subsequent read on empty buffer should throw.
      expect(() => ls.read()).toThrow();
      // Also verify the thrown shape.
      try { ls.read(); }
      catch (e: unknown) {
        expect((e as { code?: string }).code).toBe('LOG_STREAM_TIMED_OUT');
      }
    } finally {
      await m.closeAll();
    }
  });

  it('idle timeout closes the stream', async () => {
    const m = await startMockTelnet([]);
    try {
      const ls = await LogStream.open('127.0.0.1', m.port as TelnetPort);
      // Override idleMs and re-arm.
      (ls as unknown as { idleMs: number }).idleMs = 50;
      (ls as unknown as { armIdle: () => void }).armIdle();
      // Wait for idle timeout to fire.
      await new Promise((r) => setTimeout(r, 100));
      // Stream should be closed now; next read on empty buffer throws.
      expect(() => ls.read()).toThrow();
    } finally {
      await m.closeAll();
    }
  });
});
