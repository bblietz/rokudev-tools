// packages/brs-gen/tests/e2e/analytics-event-pipe.test.ts
import { describe, it, expect } from 'vitest';
import { generateAppForRegen } from '../../scripts/regen-helper.mjs';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(__dirname, '../__snapshots__/analytics_event_pipe');

// Fixture images shared by existing e2e tests (already in repo).
const FIXTURES_DIR = join(__dirname, '../__fixtures__');
const ICON_PATH = join(FIXTURES_DIR, 'icon-uhd.png');
const SPLASH_PATH = join(FIXTURES_DIR, 'splash-uhd.png');

// Extra spec fields required by templates with strict schemas.
const TEMPLATE_EXTRA_FIELDS: Record<string, Record<string, unknown>> = {
  video_grid_channel: {
    branding: {
      primary_color: '#E50914',
      icon: ICON_PATH,
      splash: SPLASH_PATH,
    },
    content: {
      feed_url: 'https://demo.avideo.com/roku.json',
      feed_format: 'roku_direct_publisher_json',
    },
  },
};

const TEMPLATES = [
  { id: 'video_grid_channel', expects: ['MainScene'] },
  { id: 'news_channel',       expects: ['MainScene', 'CategoryGridScene'] },
  { id: 'music_player',       expects: ['MainScene', 'NowPlayingScene'] },
  { id: 'game_shell',         expects: ['GameScene'] },
  { id: 'screensaver',        expects: ['Screensaver'] },
  { id: 'blank_scenegraph',   expects: ['MainScene'] },
];

async function compose(templateId: string): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), 'analytics-' + templateId + '-'));
  const specPath = join(outDir, 'spec.json');
  writeFileSync(specPath, JSON.stringify({
    spec_version: 2,
    template: templateId,
    modules: [{ id: 'analytics.event_pipe' }],
    app: { name: 'A ' + templateId, major_version: 0, minor_version: 1, build_version: 0 },
    ...(TEMPLATE_EXTRA_FIELDS[templateId] ?? {}),
  }));
  await generateAppForRegen({ outputDir: outDir + '/project', spec: specPath, outputZip: join(outDir, 'out.zip') });
  return readFileSync(join(outDir, 'project/source/_modules/__init_hooks.brs'), 'utf8');
}

async function composeAndRead(templateId: string, relPath: string): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), 'snap-' + templateId + '-'));
  const specPath = join(outDir, 'spec.json');
  writeFileSync(specPath, JSON.stringify({
    spec_version: 2, template: templateId, modules: [{ id: 'analytics.event_pipe' }],
    app: { name: 'S', major_version: 0, minor_version: 1, build_version: 0 },
  }));
  await generateAppForRegen({ outputDir: outDir + '/project', spec: specPath, outputZip: join(outDir, 'out.zip') });
  return readFileSync(join(outDir, 'project/' + relPath), 'utf8');
}

describe('analytics.event_pipe composition matrix', () => {
  for (const t of TEMPLATES) {
    it('composes with ' + t.id + ' and emits expected screen_view init calls', async () => {
      const src = await compose(t.id);
      for (const scope of t.expects) {
        expect(src).toContain('AnalyticsEventPipe_OnScreenView(m, "' + scope + '")');
      }
    });
  }
  it('video_grid_channel + news_channel emit content_start at PlayerScene.before_play', async () => {
    for (const id of ['video_grid_channel', 'news_channel']) {
      const src = await compose(id);
      expect(src).toContain('AnalyticsEventPipe_OnContentStart(m)');
    }
  });
  it('game_shell emits game_start + game_over at GameScene hooks', async () => {
    const src = await compose('game_shell');
    expect(src).toContain('AnalyticsEventPipe_OnGameStart(m)');
    expect(src).toContain('AnalyticsEventPipe_OnGameOver(m)');
  });
});

describe('analytics.event_pipe BS file snapshots', () => {
  it('snapshots Dispatcher.brs', async () => {
    const src = await composeAndRead('blank_scenegraph', 'source/_modules/analytics_event_pipe/Dispatcher.brs');
    await expect(src).toMatchFileSnapshot(join(SNAP_DIR, 'Dispatcher.brs.snap.txt'));
  });
  it('snapshots Hooks.brs', async () => {
    const src = await composeAndRead('blank_scenegraph', 'source/_modules/analytics_event_pipe/Hooks.brs');
    await expect(src).toMatchFileSnapshot(join(SNAP_DIR, 'Hooks.brs.snap.txt'));
  });
  it('snapshots ConsoleSink.brs', async () => {
    const src = await composeAndRead('blank_scenegraph', 'source/_modules/analytics_event_pipe/sinks/ConsoleSink.brs');
    await expect(src).toMatchFileSnapshot(join(SNAP_DIR, 'ConsoleSink.brs.snap.txt'));
  });
  it('snapshots HttpSink.brs', async () => {
    const src = await composeAndRead('blank_scenegraph', 'source/_modules/analytics_event_pipe/sinks/HttpSink.brs');
    await expect(src).toMatchFileSnapshot(join(SNAP_DIR, 'HttpSink.brs.snap.txt'));
  });
});
