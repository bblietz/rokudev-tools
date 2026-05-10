import { describe, it, expect } from 'vitest';
import { ContentSchema } from './content.js';

describe('ContentSchema', () => {
  it('accepts valid https URL + rdp enum', () => {
    const r = ContentSchema.safeParse({
      feed_url: 'https://example.com/feed.json',
      feed_format: 'roku_direct_publisher_json',
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-URL feed_url', () => {
    const r = ContentSchema.safeParse({
      feed_url: 'not a url',
      feed_format: 'roku_direct_publisher_json',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown feed_format', () => {
    const r = ContentSchema.safeParse({
      feed_url: 'https://example.com/f.json',
      feed_format: 'mrss',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown fields via .strict()', () => {
    const r = ContentSchema.safeParse({
      feed_url: 'https://example.com/f.json',
      feed_format: 'roku_direct_publisher_json',
      bogus: 1,
    });
    expect(r.success).toBe(false);
  });
});
