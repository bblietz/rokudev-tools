import { describe, it, expect } from 'vitest';
import { moduleIdToBsId } from './module-id.js';

describe('moduleIdToBsId', () => {
  it('replaces every dot with an underscore in dotted-namespace ids', () => {
    expect(moduleIdToBsId('foo.bar.baz')).toBe('foo_bar_baz');
  });
  it('leaves plain identifiers untouched', () => {
    expect(moduleIdToBsId('plain')).toBe('plain');
    expect(moduleIdToBsId('stub_label')).toBe('stub_label');
  });
});
