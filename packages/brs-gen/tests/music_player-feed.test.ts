import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FEED_PATH = join(
  __dirname,
  '..',
  'templates',
  'music_player',
  'files',
  'data',
  'music-feed.json',
);

describe('music_player bundled feed shape', () => {
  // Note: data/music-feed.json is created in Task 9. Until then these tests
  // FAIL with ENOENT. After Task 9 they pass.
  it('parses as JSON', () => {
    const raw = readFileSync(FEED_PATH, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('has 3 playlists', () => {
    const feed = JSON.parse(readFileSync(FEED_PATH, 'utf8'));
    expect(Array.isArray(feed.playlists)).toBe(true);
    expect(feed.playlists.length).toBe(3);
  });

  it('each playlist has id, title, art, and 6 tracks', () => {
    const feed = JSON.parse(readFileSync(FEED_PATH, 'utf8'));
    for (const pl of feed.playlists) {
      expect(typeof pl.id).toBe('string');
      expect(typeof pl.title).toBe('string');
      expect(pl.art).toMatch(/^pkg:\/images\/playlist-\d\.png$/);
      expect(Array.isArray(pl.tracks)).toBe(true);
      expect(pl.tracks.length).toBe(6);
    }
  });

  it('each track has id, title, artist, art, audio_url (https), stream_format', () => {
    const feed = JSON.parse(readFileSync(FEED_PATH, 'utf8'));
    for (const pl of feed.playlists) {
      for (const t of pl.tracks) {
        expect(typeof t.id).toBe('string');
        expect(typeof t.title).toBe('string');
        expect(typeof t.artist).toBe('string');
        expect(t.art).toMatch(/^pkg:\/images\/playlist-\d\.png$/);
        expect(t.audio_url).toMatch(/^https:\/\/www\.soundhelix\.com\//);
        expect(t.stream_format).toBe('mp3');
        expect(typeof t.duration).toBe('number');
        expect(t.duration).toBeGreaterThan(0);
      }
    }
  });

  it('within each playlist, no audio_url repeats', () => {
    const feed = JSON.parse(readFileSync(FEED_PATH, 'utf8'));
    for (const pl of feed.playlists) {
      const urls = pl.tracks.map((t: { audio_url: string }) => t.audio_url);
      expect(new Set(urls).size).toBe(urls.length);
    }
  });
});
