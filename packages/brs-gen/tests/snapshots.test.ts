import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { loadCatalog } from '../src/catalog/loader.js';
import { buildEmittedProject } from '../src/merger/build.js';
import { renderTemplateFiles } from '../src/render/ejs.js';
import { writeProject } from '../src/build/write.js';
import { setCatalogForTests } from '../src/tools/_catalog-singleton.js';
import { registerAllTools, type ToolDef } from '../src/tools/_register.js';
import '../src/tools/generate-app.js';

// Package root = packages/brs-gen/. This file lives at
// packages/brs-gen/tests/snapshots.test.ts, so `..` from its URL is the
// package root in both vite-node (source tree) and any future dist layout.
const PKG_ROOT = dirname(fileURLToPath(new URL('.', import.meta.url)));
const BRS_GEN_VERSION = '0.3.0-dev.0';

const sharedSpec = {
  spec_version: 2 as const,
  template: 'stub_hello',
  modules: [{ id: 'stub_label', config: { text: 'hello world' } }],
  app: { name: 'Stub Channel', major_version: 1, minor_version: 0, build_version: 0 },
};

// Walk a directory, returning every file as { path, bytes } where path is
// relative to `root` and uses forward slashes on every OS. Sorted by path to
// keep the EJS render pass deterministic.
async function walkTemplateFiles(root: string): Promise<Array<{ path: string; bytes: Buffer }>> {
  const out: Array<{ path: string; bytes: Buffer }> = [];
  async function walk(current: string): Promise<void> {
    for (const e of await readdir(current, { withFileTypes: true })) {
      const full = join(current, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const rel = relative(root, full).split(/[\\/]/).join('/');
        out.push({ path: rel, bytes: await readFile(full) });
      }
    }
  }
  await walk(root);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

async function loadModuleFileBytes(
  pkgRoot: string,
  modules: ReadonlyArray<{ module: { id: string }; module_files: { add: string[] } }>,
): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const m of modules) {
    for (const rel of m.module_files.add) {
      const onDisk = join(pkgRoot, 'modules', m.module.id, 'files', rel);
      out.set(rel, await readFile(onDisk));
    }
  }
  return out;
}

// Runs the merger + writeProject and STOPS BEFORE compileProject. The .bs
// sources on disk are therefore still .bs (not .brs). Rationale (spec §10.3):
// post-compile bytes depend on the brighterscript version; pre-compile state
// is what we author and reason about. T28 covers post-compile byte equality.
async function generateStubProjectPreCompile(parentDir: string): Promise<string> {
  const cat = await loadCatalog(PKG_ROOT);
  const template = cat.templates.get('stub_hello')!;
  const modules = [cat.modules.get('stub_label')!];
  const templateFiles = await walkTemplateFiles(join(PKG_ROOT, 'templates', 'stub_hello', 'files'));
  const renderedTemplateFiles = await renderTemplateFiles(templateFiles, sharedSpec, {
    brs_gen_version: BRS_GEN_VERSION,
    template_version: template.template.version,
  });
  const moduleFileBytes = await loadModuleFileBytes(PKG_ROOT, modules);
  const project = await buildEmittedProject({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spec: sharedSpec as any,
    template,
    modules,
    renderedTemplateFiles,
    moduleFileBytes,
    brsGenVersion: BRS_GEN_VERSION,
  });

  // writeProject refuses to clobber a non-empty directory unless overwrite:true,
  // so point at a not-yet-existing child of the tmpdir that beforeAll created.
  const outputDir = join(parentDir, 'project');
  await writeProject({ outputDir, files: project.files, overwrite: false });
  return outputDir;
}

// Recursive walk returning sorted [{path, size}] for every file under root.
// Paths use forward slashes for cross-OS stable snapshots.
async function sortedPathSizeList(root: string): Promise<Array<{ path: string; size: number }>> {
  const out: Array<{ path: string; size: number }> = [];
  async function walk(current: string): Promise<void> {
    for (const e of await readdir(current, { withFileTypes: true })) {
      const full = join(current, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const rel = relative(root, full).split(/[\\/]/).join('/');
        const st = await stat(full);
        out.push({ path: rel, size: st.size });
      }
    }
  }
  await walk(root);
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

describe('stub catalog snapshot', () => {
  // Snapshots are taken at the PRE-COMPILE state (the EmittedProject that
  // the merger produces), not the post-compile state. Rationale: the .bs
  // source is what we author and reason about; the .brs is a byproduct of
  // the brighterscript compiler version, and its exact bytes are already
  // covered by T28's bsc-byte-equality test. This decision keeps snapshots
  // stable across brighterscript upgrades.
  let parentDir: string;
  let projectDir: string;
  beforeAll(async () => {
    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-snap-'));
    projectDir = await generateStubProjectPreCompile(parentDir);
  });
  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('emitted manifest matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'manifest'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/manifest.snap');
  });
  it('__init_hooks.bs matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'source/_modules/__init_hooks.bs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/init_hooks.bs.snap');
  });
  it('config.bs for stub_label matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'source/_modules/stub_label/config.bs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/stub_label-config.bs.snap');
  });
  it('provenance.json matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, '.rokudev-tools/provenance.json'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/provenance.json.snap');
  });
  it('file listing matches saved snapshot', async () => {
    const sortedList = await sortedPathSizeList(projectDir);
    await expect(JSON.stringify(sortedList, null, 2) + '\n').toMatchFileSnapshot(
      '__snapshots__/files.snap',
    );
  });
});

// ---------------------------------------------------------------------------
// video_grid_channel snapshots (T20)
// ---------------------------------------------------------------------------
// Runs the FULL generate_app pipeline (merger + compileProject) once in
// beforeAll, then each test snapshots a single post-compile output file.
// The post-compile state is used because: (a) the XML uri sweep rewrites
// .bs -> .brs references, (b) TemplateConfig emits to .brs after bsc
// transpile, and (c) .bs sources are removed. Snapshots therefore reflect
// the channel exactly as it would be sideloaded.
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(PKG_ROOT, 'tests/__fixtures__');

function getGenerateAppHandler(): ToolDef['handler'] {
  const tools = new Map<string, ToolDef>();
  registerAllTools(tools);
  const def = tools.get('generate_app');
  if (!def) throw new Error('generate_app tool not registered');
  return def.handler;
}

// Walk projectDir recursively, return sorted forward-slash relative paths,
// excluding entries under `.rokudev-tools/staging` and `.rokudev-tools/sourcemaps`.
async function sortedRelPaths(root: string): Promise<string[]> {
  const out: string[] = [];
  const EXCLUDES = ['.rokudev-tools/staging', '.rokudev-tools/sourcemaps'];
  async function walk(current: string): Promise<void> {
    for (const e of await readdir(current, { withFileTypes: true })) {
      const full = join(current, e.name);
      const rel = relative(root, full).split(/[\\/]/).join('/');
      if (EXCLUDES.some((ex) => rel === ex || rel.startsWith(`${ex}/`))) continue;
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        out.push(rel);
      }
    }
  }
  await walk(root);
  out.sort();
  return out;
}

describe('video_grid_channel snapshots', () => {
  let parentDir: string;
  let projectDir: string;

  beforeAll(async () => {
    // Load catalog and inject into the singleton so the handler can pick it up.
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);

    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-t20-'));
    projectDir = join(parentDir, 'project');

    const handler = getGenerateAppHandler();
    const iconPath = join(FIXTURES_DIR, 'icon-uhd.png');
    const splashPath = join(FIXTURES_DIR, 'splash-uhd.png');

    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'video_grid_channel',
        modules: [],
        app: { name: 'Acme TV', major_version: 0, minor_version: 1, build_version: 0 },
        branding: {
          primary_color: '#E50914',
          icon: iconPath,
          splash: splashPath,
        },
        content: {
          feed_url: 'https://demo.avideo.com/roku.json',
          feed_format: 'roku_direct_publisher_json',
        },
      },
      output_dir: projectDir,
    });

    const payload = result as Record<string, unknown>;
    if (!payload['ok']) {
      throw new Error(`generate_app failed in beforeAll: ${JSON.stringify(payload)}`);
    }
  });

  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('manifest matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'manifest'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/video-grid/manifest.snap.txt');
  });

  it('MainScene.xml (post-compile, .brs refs) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/video-grid/MainScene.xml.snap.txt');
  });

  it('HeroUnit.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/HeroUnit.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/video-grid/HeroUnit.xml.snap.txt');
  });

  it('template-config.brs matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'source/_template/config.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/video-grid/template-config.brs.snap.txt');
  });

  it('files listing (sorted, excl staging+sourcemaps) matches saved snapshot', async () => {
    const paths = await sortedRelPaths(projectDir);
    await expect(paths.join('\n') + '\n').toMatchFileSnapshot(
      '__snapshots__/video-grid/files-listing.snap.txt',
    );
  });

  it('MainScene.brs contains Plan 4b polish behavior + preserves init hooks', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.brs'), 'utf8');

    // Plan 4b additions: first-input lifecycle + transition cap.
    expect(s).toContain('m.userHasInteracted');
    expect(s).toContain('m.heroAutoCount');

    // Plan 4b additions: hero-button Select handler + Up-routing wiring.
    expect(s).toContain('onHeroButtonSelected');
    expect(s).toContain('m.heroPlayButton');

    // Regression: existing module-opt init-hook firings must still emit.
    expect(s).toContain('Modules_OnMainSceneBeforeContentLoad');
    expect(s).toContain('Modules_OnMainSceneAfterContentLoad');
    expect(s).toContain('Modules_OnMainSceneAfterHeroLoad');
  });

  it('HeroUnit.xml contains the playButton child (Plan 4b)', async () => {
    const s = await readFile(join(projectDir, 'components/HeroUnit.xml'), 'utf8');
    expect(s).toContain('id="playButton"');
  });
});

// ---------------------------------------------------------------------------
// blank_scenegraph snapshots (T7 of Plan 4a)
// ---------------------------------------------------------------------------
// Runs the FULL generate_app pipeline (merger + compileProject) once in
// beforeAll, then each test snapshots a single post-compile output file.
// The post-compile state is used so the XML uri sweep (.bs -> .brs) is
// reflected in the snapshot, matching exactly what would be sideloaded.
// ---------------------------------------------------------------------------

describe('blank_scenegraph snapshots', () => {
  let parentDir: string;
  let projectDir: string;

  beforeAll(async () => {
    // Load catalog and inject into the singleton so the handler can pick it up.
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);

    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-blank-snap-'));
    projectDir = join(parentDir, 'project');

    const handler = getGenerateAppHandler();

    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'blank_scenegraph',
        modules: [],
        app: { name: 'Blank Snap', major_version: 0, minor_version: 1, build_version: 0 },
      },
      output_dir: projectDir,
    });

    const payload = result as Record<string, unknown>;
    if (!payload['ok']) {
      throw new Error(`generate_app failed in beforeAll: ${JSON.stringify(payload)}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('manifest matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'manifest'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/blank_scenegraph/manifest.snap.txt');
  });

  it('MainScene.xml (post-compile, .brs refs) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/blank_scenegraph/MainScene.xml.snap.txt');
  });

  it('MainScene.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/blank_scenegraph/MainScene.brs.snap.txt');
  });
});

// ---------------------------------------------------------------------------
// news_channel snapshots (Plan 4c)
// ---------------------------------------------------------------------------
describe('news_channel snapshots', () => {
  let parentDir: string;
  let projectDir: string;

  beforeAll(async () => {
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);

    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-news-'));
    projectDir = join(parentDir, 'project');

    const handler = getGenerateAppHandler();
    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'news_channel',
        modules: [],
        app: { name: 'News Demo', major_version: 0, minor_version: 1, build_version: 0 },
      },
      output_dir: projectDir,
    });
    const payload = result as Record<string, unknown>;
    if (!payload['ok']) {
      throw new Error(`generate_app failed in beforeAll: ${JSON.stringify(payload)}`);
    }
  });

  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('manifest matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'manifest'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/manifest.snap.txt');
  });

  it('MainScene.xml (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/MainScene.xml.snap.txt');
  });

  it('MainScene.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/MainScene.brs.snap.txt');
  });

  it('LiveHero.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/LiveHero.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/LiveHero.xml.snap.txt');
  });

  it('CategoryRail.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/CategoryRail.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/CategoryRail.xml.snap.txt');
  });

  it('CategoryGridScene.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/CategoryGridScene.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot(
      '__snapshots__/news_channel/CategoryGridScene.xml.snap.txt',
    );
  });

  it('CategoryGridScene.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/CategoryGridScene.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot(
      '__snapshots__/news_channel/CategoryGridScene.brs.snap.txt',
    );
  });

  it('PlayerScene.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/PlayerScene.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/PlayerScene.xml.snap.txt');
  });

  it('PlayerScene.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/PlayerScene.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/PlayerScene.brs.snap.txt');
  });

  it('news-feed.json matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'data/news-feed.json'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/news-feed.json.snap.txt');
  });

  it('files listing (sorted) matches saved snapshot', async () => {
    const paths = await sortedRelPaths(projectDir);
    await expect(paths.join('\n') + '\n').toMatchFileSnapshot(
      '__snapshots__/news_channel/files-listing.snap.txt',
    );
  });

  // Regression markers (cheap to maintain; catch deletions of new behavior or
  // existing module-opt extension points).
  it('MainScene.brs contains Plan 4c overlay refs + init hook', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.brs'), 'utf8');
    expect(s).toContain('m.gridSceneRef');
    expect(s).toContain('m.playerSceneRef');
    expect(s).toContain('Modules_OnMainSceneAfterSceneShow');
  });

  it('CategoryGridScene.brs contains the new init-hook firing site', async () => {
    const s = await readFile(join(projectDir, 'components/CategoryGridScene.brs'), 'utf8');
    expect(s).toContain('Modules_OnCategoryGridSceneAfterSceneShow');
  });

  it('PlayerScene.brs propagates content.live flag', async () => {
    const s = await readFile(join(projectDir, 'components/PlayerScene.brs'), 'utf8');
    // Use a relaxed regex (allowing any whitespace around the assignment)
    // because the brighterscript .bs -> .brs compile step may normalize
    // the spacing of the original `content.live = c.live` assignment.
    // Both `content.live` (lhs) and `c.live` (rhs) must appear; the
    // intermediate "= " is allowed to be any whitespace run.
    expect(s).toMatch(/content\.live\s*=\s*c\.live/);
  });
});

// music_player snapshots (Plan 4d)
// ---------------------------------------------------------------------------
describe('music_player snapshots', () => {
  let parentDir: string;
  let projectDir: string;

  beforeAll(async () => {
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);

    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-music-'));
    projectDir = join(parentDir, 'project');

    const handler = getGenerateAppHandler();
    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'music_player',
        modules: [],
        app: { name: 'Music Demo', major_version: 0, minor_version: 1, build_version: 0 },
      },
      output_dir: projectDir,
    });
    const payload = result as Record<string, unknown>;
    if (!payload['ok']) {
      throw new Error(`generate_app failed in beforeAll: ${JSON.stringify(payload)}`);
    }
  });

  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('manifest matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'manifest'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/music_player/manifest.snap.txt');
  });

  it('MainScene.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/music_player/MainScene.xml.snap.txt');
  });

  it('MainScene.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/music_player/MainScene.brs.snap.txt');
  });

  it('NowPlayingScene.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/NowPlayingScene.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot(
      '__snapshots__/music_player/NowPlayingScene.xml.snap.txt',
    );
  });

  it('NowPlayingScene.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/NowPlayingScene.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot(
      '__snapshots__/music_player/NowPlayingScene.brs.snap.txt',
    );
  });

  it('MiniBar.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/MiniBar.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/music_player/MiniBar.xml.snap.txt');
  });

  it('Feed.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'source/Feed.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/music_player/Feed.brs.snap.txt');
  });

  it('music-feed.json matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'data/music-feed.json'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/music_player/music-feed.json.snap.txt');
  });

  it('files listing (sorted) matches saved snapshot', async () => {
    const paths = await sortedRelPaths(projectDir);
    await expect(paths.join('\n') + '\n').toMatchFileSnapshot(
      '__snapshots__/music_player/files-listing.snap.txt',
    );
  });

  // Regression markers: confirm key vars, init-hook firings, and handler
  // presence survive bsc compile + post-compile sweep.
  it('MainScene.brs contains audio node ref + miniBar state + nowPlayingRef + init hook', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.brs'), 'utf8');
    // Use relaxed regex to tolerate bsc whitespace normalization around assignments.
    expect(s).toMatch(/m\.audio\s*=\s*m\.top\.findNode\(["']audio["']\)/);
    expect(s).toContain('m.miniBarVisibleSticky');
    expect(s).toContain('m.nowPlayingRef');
    expect(s).toContain('Modules_OnMainSceneAfterSceneShow');
  });

  it('NowPlayingScene.brs contains init hook + posTimer handler + playPause handler', async () => {
    const s = await readFile(join(projectDir, 'components/NowPlayingScene.brs'), 'utf8');
    expect(s).toContain('Modules_OnNowPlayingSceneAfterSceneShow');
    expect(s).toContain('onPosTimerTick');
    expect(s).toContain('onPlayPauseSelected');
  });
});

describe('screensaver snapshots', () => {
  let parentDir: string;
  let projectDir: string;

  beforeAll(async () => {
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);

    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-ssvr-'));
    projectDir = join(parentDir, 'project');

    const handler = getGenerateAppHandler();
    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'screensaver',
        modules: [],
        app: { name: 'Demo Photos', major_version: 0, minor_version: 1, build_version: 0 },
        // No content block: the screensaver strict schema applies defaults
        // (transition_seconds=7, motion=ken_burns, feed_format=rokudev_screensaver_v1)
        // and the engine uses those defaults to emit source/_template/config.brs.
        // This exercises the fix for the no-content bug found in Task 11 review.
      },
      output_dir: projectDir,
    });
    const payload = result as Record<string, unknown>;
    if (!payload['ok']) {
      throw new Error(`generate_app failed in beforeAll: ${JSON.stringify(payload)}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('manifest matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'manifest'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/manifest.snap.txt');
  });

  it('manifest key set is EXACTLY the cert-allowed allowlist (defense-in-depth)', async () => {
    const s = await readFile(join(projectDir, 'manifest'), 'utf8');
    const keys = new Set(
      s
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith('#'))
        .map((l) => l.split('=')[0]!.trim()),
    );
    const allowed = new Set([
      'title',
      'major_version',
      'minor_version',
      'build_version',
      'rsg_version',
      'ui_resolutions',
      'screensaver_title',
    ]);
    const extras = [...keys].filter((k) => !allowed.has(k));
    const missing = [...allowed].filter((k) => !keys.has(k));
    expect({ extras, missing }).toEqual({ extras: [], missing: [] });
  });

  it('source/main.brs matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'source', 'main.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/main.brs.snap.txt');
  });

  it('source/main.brs uses RunScreenSaver entry point and includes memory monitoring', async () => {
    const s = await readFile(join(projectDir, 'source', 'main.brs'), 'utf8');
    expect(s).toMatch(/^sub\s+RunScreenSaver\s*\(\s*\)/m);
    expect(s).not.toMatch(/^sub\s+Main\s*\(/m);
    expect(s).not.toMatch(/^function\s+Main\s*\(/m);
    expect(s).toContain('roAppMemoryMonitor');
    expect(s).toContain('EnableLowGeneralMemoryEvent');
    expect(s).toContain('roSGScreenEvent');
  });

  it('source/lib/Feed.brs matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'source', 'lib', 'Feed.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/Feed.brs.snap.txt');
  });

  it('Feed.brs exports the 3 helpers used by Screensaver.bs', async () => {
    const s = await readFile(join(projectDir, 'source', 'lib', 'Feed.brs'), 'utf8');
    expect(s).toMatch(/function\s+ScreensaverFeed_LoadBundled/);
    expect(s).toMatch(/function\s+ScreensaverFeed_LoadOperator/);
    expect(s).toMatch(/function\s+ScreensaverFeed_BuildContentNodes/);
    // Guard against the Plan 4d anti-pattern: field-write to node.SecondaryTitle.
    // The regex targets the assignment form so mentions in comments are allowed.
    expect(s).not.toMatch(/node\.SecondaryTitle/);
    expect(s).toContain('ShortDescriptionLine2');
  });

  it('data/screensaver-feed.json matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'data', 'screensaver-feed.json'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/screensaver-feed.json.snap.txt');
  });

  it('screensaver-feed.json contains exactly 8 sequential entries with stable ids', async () => {
    const raw = await readFile(join(projectDir, 'data', 'screensaver-feed.json'), 'utf8');
    const feed = JSON.parse(raw) as { version: number; photos: Array<{ id: string; url: string }> };
    expect(feed.version).toBe(1);
    expect(feed.photos).toHaveLength(8);
    feed.photos.forEach((p, i) => {
      expect(p.id).toBe(`p${i + 1}`);
      expect(p.url).toBe(`pkg:/images/sample-photo-${i + 1}.jpg`);
    });
  });

  it('HttpTask.xml (source) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components', 'HttpTask.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/HttpTask.xml.snap.txt');
  });

  it('HttpTask.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components', 'HttpTask.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/HttpTask.brs.snap.txt');
  });

  it('HttpTask.brs declares the doRequest task entry and cert-setup boilerplate', async () => {
    const s = await readFile(join(projectDir, 'components', 'HttpTask.brs'), 'utf8');
    expect(s).toMatch(/m\.top\.functionName\s*=\s*"doRequest"/);
    expect(s).toContain('SetCertificatesFile');
    expect(s).toContain('InitClientCertificates');
    expect(s).toContain('EnablePeerVerification');
    expect(s).toContain('EnableHostVerification');
  });

  // Plan 4e Task 11: post-compile sweep rewrites HttpTask.xml's <script uri>
  // from .bs to .brs.
  it('HttpTask.xml has script URI rewritten to .brs (post-compile sweep)', async () => {
    const s = await readFile(join(projectDir, 'components', 'HttpTask.xml'), 'utf8');
    expect(s).toMatch(/uri="pkg:\/components\/HttpTask\.brs"/);
    expect(s).not.toMatch(/uri="pkg:\/components\/HttpTask\.bs"/);
  });

  it('PhotoCycle.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components', 'PhotoCycle.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/PhotoCycle.xml.snap.txt');
  });

  it('PhotoCycle.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components', 'PhotoCycle.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/PhotoCycle.brs.snap.txt');
  });

  // The test name reflects 4 Animation nodes + 1 Timer = 5 named animation-related
  // elements. The regex assertions check exactly the 4 Animation ids present in the XML.
  it('PhotoCycle.xml declares the 4 named animations, 1 Timer, and 4 interface fields', async () => {
    const s = await readFile(join(projectDir, 'components', 'PhotoCycle.xml'), 'utf8');
    for (const animId of ['crossfade', 'kenBurnsA', 'kenBurnsB', 'pixelShift']) {
      expect(s).toMatch(new RegExp(`<Animation\\s+id="${animId}"`));
    }
    for (const field of ['photos', 'transitionSeconds', 'motion', 'currentIndex']) {
      expect(s).toMatch(new RegExp(`<field\\s+id="${field}"`));
    }
    expect(s).toMatch(/<Timer\s+id="cycleTimer"/);
  });

  it('PhotoCycle.brs locks kenBurns duration to transitionSeconds and uses programmatic control=start', async () => {
    const s = await readFile(join(projectDir, 'components', 'PhotoCycle.brs'), 'utf8');
    expect(s).toMatch(/m\.kenBurnsAAnim\.duration\s*=\s*m\.top\.transitionSeconds/);
    expect(s).toMatch(/m\.kenBurnsBAnim\.duration\s*=\s*m\.top\.transitionSeconds/);
    expect(s).toMatch(/m\.pixelShiftAnim\.control\s*=\s*"start"/);
  });

  // ---------------------------------------------------------------------------
  // Plan 4e Task 11: Screensaver root scene + full-pipeline collapse tests.
  // ---------------------------------------------------------------------------

  it('Screensaver.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components', 'Screensaver.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/Screensaver.xml.snap.txt');
  });

  it('Screensaver.brs matches saved snapshot (post-compile)', async () => {
    const s = await readFile(join(projectDir, 'components', 'Screensaver.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/Screensaver.brs.snap.txt');
  });

  it('Screensaver.xml has explicit <script> for source/lib/Feed.brs (Plan 4c invariant)', async () => {
    const s = await readFile(join(projectDir, 'components', 'Screensaver.xml'), 'utf8');
    expect(s).toMatch(/<script\s+type="text\/brightscript"\s+uri="pkg:\/source\/lib\/Feed\.brs"\s*\/>/);
  });

  it('Screensaver.brs fires the after_scene_show init hook', async () => {
    const s = await readFile(join(projectDir, 'components', 'Screensaver.brs'), 'utf8');
    expect(s).toContain('Modules_OnScreensaverAfterSceneShow(m)');
  });

  it('__init_hooks declares Modules_OnScreensaverAfterSceneShow', async () => {
    // Verify whether merger emits .bs or .brs for __init_hooks; try both.
    let s: string;
    try {
      s = await readFile(join(projectDir, 'source', '_modules', '__init_hooks.brs'), 'utf8');
    } catch {
      s = await readFile(join(projectDir, 'source', '_modules', '__init_hooks.bs'), 'utf8');
    }
    expect(s).toMatch(/sub\s+Modules_OnScreensaverAfterSceneShow\s*\(\s*m\s+as\s+object\s*\)\s+as\s+void/);
  });

  it('full files listing matches saved snapshot', async () => {
    const paths = await sortedRelPaths(projectDir);
    await expect(paths.join('\n') + '\n').toMatchFileSnapshot(
      '__snapshots__/screensaver/files-listing.snap.txt',
    );
  });

  it('__init_hooks post-compile matches saved snapshot', async () => {
    // Try both extensions; merger may emit .bs or .brs depending on compile sweep.
    let s: string;
    let ext = 'brs';
    try {
      s = await readFile(join(projectDir, 'source', '_modules', `__init_hooks.brs`), 'utf8');
    } catch {
      ext = 'bs';
      s = await readFile(join(projectDir, 'source', '_modules', '__init_hooks.bs'), 'utf8');
    }
    await expect(s).toMatchFileSnapshot(`__snapshots__/screensaver/__init_hooks.${ext}.snap.txt`);
  });
});

// ---------------------------------------------------------------------------
// game_shell snapshots (Plan 4f Tasks 3-5)
// ---------------------------------------------------------------------------

describe('game_shell snapshots', () => {
  let parentDir: string;
  let projectDir: string;

  beforeAll(async () => {
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);

    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-game-'));
    projectDir = join(parentDir, 'project');

    const handler = getGenerateAppHandler();
    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'game_shell',
        modules: [],
        app: { name: 'Pong', major_version: 1, minor_version: 0, build_version: 0 },
      },
      output_dir: projectDir,
    });
    const payload = result as Record<string, unknown>;
    if (!payload['ok']) {
      throw new Error(`generate_app failed in beforeAll: ${JSON.stringify(payload)}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('manifest matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'manifest'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/game_shell/manifest.snap.txt');
  });
});
