import { describe, it, expect } from 'vitest';
import { normalizeEventName } from './analytics-helpers.js';

describe('normalizeEventName', () => {
  it('lowercases ASCII letters', () => {
    expect(normalizeEventName('ChannelStart').name).toBe('channelstart');
  });
  it('preserves valid snake_case input verbatim, no warning', () => {
    const r = normalizeEventName('channel_start');
    expect(r.name).toBe('channel_start');
    expect(r.warning).toBeUndefined();
  });
  it('warns when input differed from normalized output', () => {
    const r = normalizeEventName('ChannelStart');
    expect(r.warning).toContain('normalized');
  });
  it('replaces dash and space with underscore', () => {
    expect(normalizeEventName('content-end now').name).toBe('content_end_now');
  });
  it('strips chars outside [a-z0-9_]', () => {
    expect(normalizeEventName('foo!bar@1').name).toBe('foobar1');
  });
  it('returns empty name + warning when input empty after normalization', () => {
    const r = normalizeEventName('!@#$');
    expect(r.name).toBe('');
    expect(r.warning).toBeDefined();
  });
});
