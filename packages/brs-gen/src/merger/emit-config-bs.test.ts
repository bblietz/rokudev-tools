import { describe, it, expect } from 'vitest';
import { emitModuleConfigBs } from './emit-config-bs.js';

describe('emitModuleConfigBs', () => {
  it('emits a deterministic function returning the config AA', () => {
    const out = emitModuleConfigBs('stub_label', { text: 'hi', n: 3, flag: true });
    expect(out).toContain('function ModuleConfig_stub_label() as object');
    expect(out).toContain('return { flag: true, n: 3, text: "hi" }');
    expect(out).toContain('end function');
  });
  it('emits a stable byte output for same input', () => {
    const a = emitModuleConfigBs('m', { b: 1, a: 2 });
    const b = emitModuleConfigBs('m', { a: 2, b: 1 });
    expect(a).toBe(b);
  });
  it('handles empty config', () => {
    const out = emitModuleConfigBs('m', {});
    expect(out).toContain('return {  }');
  });
  it('normalizes dotted module id to underscores in BrightScript function name', () => {
    const out = emitModuleConfigBs('analytics.event_pipe', { console_sink: true });
    expect(out).toContain('function ModuleConfig_analytics_event_pipe() as object');
    // No dots may leak into the BrightScript identifier.
    expect(out).not.toContain('ModuleConfig_analytics.event_pipe');
  });
});
