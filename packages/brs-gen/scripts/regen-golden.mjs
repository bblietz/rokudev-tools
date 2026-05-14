// packages/brs-gen/scripts/regen-golden.mjs
//
// Manual regenerator for the golden fixtures consumed by tests/e2e.test.ts:
//
//   tests/__golden__/stub.zip
//   tests/__golden__/stub.provenance.json
//   tests/__golden__/video-grid.zip
//   tests/__golden__/video-grid.provenance.json
//
// Run this by hand whenever a load-bearing change to the deterministic
// pipeline (template files, module files, manifest-key strategies, zip
// layout, etc.) is made. CI does NOT auto-regen (per spec §11.5); a human
// must stage both files along with a clear cause in the commit message.
//
// Prerequisites:
//   - pnpm -C packages/brs-gen build    # populates dist/
//
// Usage:
//   TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs
//
// WHY TZ=UTC:
//   yazl 2.5.x encodes the DOS mtime via Date#getFullYear() (local time),
//   not getUTCFullYear(). A regen on a host in a non-UTC timezone will
//   produce zip bytes that differ from a UTC-pinned e2e run, breaking the
//   byte-equality assertion. We force UTC here so the golden zip is stable
//   across contributors. The e2e test spawns node with TZ=UTC too.

process.env.TZ = 'UTC';

import { generateAppForRegen } from './regen-helper.mjs';
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..');
const GOLDEN_DIR = join(PKG_ROOT, 'tests', '__golden__');

const CANONICAL_SPEC = {
  spec_version: 2,
  template: 'stub_hello',
  modules: [{ id: 'stub_label', version_range: '^0.1.0', config: { text: 'hello world' } }],
  app: { name: 'Stub Channel', major_version: 1, minor_version: 0, build_version: 0 },
};

async function main() {
  await mkdir(GOLDEN_DIR, { recursive: true });

  // Regen stub goldens.
  const work = join(tmpdir(), `brs-gen-regen-${randomUUID()}`);
  const outputDir = join(work, 'project');
  const outputZip = join(work, 'project.zip');
  await mkdir(work, { recursive: true });

  try {
    const { zip_path, output_dir } = await generateAppForRegen({
      outputDir,
      spec: CANONICAL_SPEC,
      outputZip,
    });

    // Golden zip.
    await copyFile(zip_path, join(GOLDEN_DIR, 'stub.zip'));

    // Golden provenance.json: pulled from the generated project tree. The
    // provenance file is what buildEmittedProject emits to
    // .rokudev-tools/provenance.json; we keep it as its raw bytes so the
    // e2e test can do a byte-equal compare.
    const provenance = await readFile(join(output_dir, '.rokudev-tools', 'provenance.json'));
    await writeFile(join(GOLDEN_DIR, 'stub.provenance.json'), provenance);
  } finally {
    await rm(work, { recursive: true, force: true });
  }

  // Regen video-grid goldens.
  await regenVideoGrid();

  // Regen blank goldens.
  await regenBlank();

  // Regen news goldens.
  await regenNews();

  // Regen music goldens.
  await regenMusic();

  process.stdout.write(
    '\n========================================================================\n' +
      'Golden files regenerated:\n' +
      `  ${join(GOLDEN_DIR, 'stub.zip')}\n` +
      `  ${join(GOLDEN_DIR, 'stub.provenance.json')}\n` +
      `  ${join(GOLDEN_DIR, 'video-grid.zip')}\n` +
      `  ${join(GOLDEN_DIR, 'video-grid.provenance.json')}\n` +
      `  ${join(GOLDEN_DIR, 'blank.zip')}\n` +
      `  ${join(GOLDEN_DIR, 'blank.provenance.json')}\n` +
      `  ${join(GOLDEN_DIR, 'news.zip')}\n` +
      `  ${join(GOLDEN_DIR, 'news.provenance.json')}\n` +
      `  ${join(GOLDEN_DIR, 'music.zip')}\n` +
      `  ${join(GOLDEN_DIR, 'music.provenance.json')}\n` +
      'Please commit all ten files with a clear cause in the commit message\n' +
      '(e.g. "regen goldens: add music_player goldens").\n' +
      '========================================================================\n',
  );
}

async function regenVideoGrid() {
  // Use the persistent unit fixtures as branding sources.
  const spec = {
    spec_version: 2,
    template: 'video_grid_channel',
    modules: [],
    app: { name: 'Acme TV', major_version: 0, minor_version: 1, build_version: 0 },
    branding: {
      primary_color: '#E50914',
      icon: '../__fixtures__/icon-uhd.png',
      splash: '../__fixtures__/splash-uhd.png',
    },
    content: {
      // Pinned 2026-05-10; keep in sync with templates/video_grid_channel/schema.ts Example.
      feed_url: 'https://demo.avideo.com/roku.json',
      feed_format: 'roku_direct_publisher_json',
    },
  };
  // Write spec to a tmpdir INSIDE tests/ so the relative branding paths
  // (../__fixtures__/...) resolve against tests/__fixtures__/.
  const tmpSpecDir = join(PKG_ROOT, 'tests', '__tmp_regen__');
  await mkdir(tmpSpecDir, { recursive: true });
  try {
    const specPath = join(tmpSpecDir, 'video-grid-spec.json');
    await writeFile(specPath, JSON.stringify(spec));

    const work = join(tmpdir(), `brs-gen-regen-vg-${randomUUID()}`);
    const outputDir = join(work, 'project');
    const outputZip = join(work, 'project.zip');
    await mkdir(work, { recursive: true });

    try {
      const { zip_path, output_dir } = await generateAppForRegen({
        outputDir,
        spec: specPath,
        outputZip,
      });
      await copyFile(zip_path, join(GOLDEN_DIR, 'video-grid.zip'));
      const provenance = await readFile(join(output_dir, '.rokudev-tools', 'provenance.json'));
      await writeFile(join(GOLDEN_DIR, 'video-grid.provenance.json'), provenance);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  } finally {
    await rm(tmpSpecDir, { recursive: true, force: true });
  }
}

async function regenBlank() {
  const CANONICAL_BLANK_SPEC = {
    spec_version: 2,
    template: 'blank_scenegraph',
    modules: [],
    app: { name: 'Blank E2E', major_version: 0, minor_version: 1, build_version: 0 },
  };

  const work = join(tmpdir(), `brs-gen-regen-blank-${randomUUID()}`);
  const outputDir = join(work, 'project');
  const outputZip = join(work, 'project.zip');
  await mkdir(work, { recursive: true });

  try {
    const { zip_path, output_dir } = await generateAppForRegen({
      outputDir,
      spec: CANONICAL_BLANK_SPEC,
      outputZip,
    });
    await copyFile(zip_path, join(GOLDEN_DIR, 'blank.zip'));
    const provenance = await readFile(join(output_dir, '.rokudev-tools', 'provenance.json'));
    await writeFile(join(GOLDEN_DIR, 'blank.provenance.json'), provenance);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function regenNews() {
  const CANONICAL_NEWS_SPEC = {
    spec_version: 2,
    template: 'news_channel',
    modules: [],
    app: { name: 'News E2E', major_version: 0, minor_version: 1, build_version: 0 },
  };

  const work = join(tmpdir(), `brs-gen-regen-news-${randomUUID()}`);
  const outputDir = join(work, 'project');
  const outputZip = join(work, 'project.zip');
  await mkdir(work, { recursive: true });

  try {
    const { zip_path, output_dir } = await generateAppForRegen({
      outputDir,
      spec: CANONICAL_NEWS_SPEC,
      outputZip,
    });
    await copyFile(zip_path, join(GOLDEN_DIR, 'news.zip'));
    const provenance = await readFile(join(output_dir, '.rokudev-tools', 'provenance.json'));
    await writeFile(join(GOLDEN_DIR, 'news.provenance.json'), provenance);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function regenMusic() {
  const CANONICAL_MUSIC_SPEC = {
    spec_version: 2,
    template: 'music_player',
    modules: [],
    app: { name: 'Music E2E', major_version: 0, minor_version: 1, build_version: 0 },
  };

  const work = join(tmpdir(), `brs-gen-regen-music-${randomUUID()}`);
  const outputDir = join(work, 'project');
  const outputZip = join(work, 'project.zip');
  await mkdir(work, { recursive: true });

  try {
    const { zip_path, output_dir } = await generateAppForRegen({
      outputDir,
      spec: CANONICAL_MUSIC_SPEC,
      outputZip,
    });
    await copyFile(zip_path, join(GOLDEN_DIR, 'music.zip'));
    const provenance = await readFile(join(output_dir, '.rokudev-tools', 'provenance.json'));
    await writeFile(join(GOLDEN_DIR, 'music.provenance.json'), provenance);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((err) => {
  process.stderr.write(`regen-golden failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
