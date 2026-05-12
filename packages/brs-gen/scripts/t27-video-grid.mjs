// packages/brs-gen/scripts/t27-video-grid.mjs
//
// Operator-run T27 real-device verification for video_grid_channel.
//
// Requires env:
//   ROKUDEV_HOST         IP of a dev-mode Roku on the operator's LAN
//   ROKUDEV_DEV_PASSWORD dev password (default: 1234)
//
// Requires state:
//   - `pnpm -C packages/brs-gen build` succeeded
//   - Fixtures at scripts/fixtures/t27-*-uhd.png exist
//   - Sample feed URL is reachable from the Roku
//
// Usage:
//   node packages/brs-gen/scripts/t27-video-grid.mjs
//
// Exit code 0 on PASS, non-zero on FAIL.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  sideloadAndLaunch,
  keypress,
  keypressRepeat,
  screenshotNoError,
  assertPlaybackStarts,
  assertPositionAdvanced,
  sleep,
} from './_t27-lib.mjs';
import { generateAppForRegen } from './regen-helper.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);

const host = process.env.ROKUDEV_HOST;
const password = process.env.ROKUDEV_DEV_PASSWORD || '1234';
if (!host) {
  console.error('T27: ROKUDEV_HOST env var is required (Roku IP).');
  process.exit(2);
}

const iso = new Date().toISOString().replace(/[:.]/g, '-');
const screensDir = join(PKG_ROOT, 'scripts', 't27-screenshots', iso);
const logsDir = join(PKG_ROOT, 'scripts', 't27-logs');
await mkdir(screensDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const work = await mkdtemp(join(tmpdir(), 'brs-gen-t27-vg-'));
const outputDir = join(work, 'project');
const outputZip = join(work, 'project.zip');

const canonicalSpec = {
  spec_version: 2,
  template: 'video_grid_channel',
  modules: [],
  app: { name: 'T27 Video Grid', major_version: 0, minor_version: 1, build_version: 0 },
  branding: {
    primary_color: '#0A0F2D',
    icon: join(PKG_ROOT, 'scripts', 'fixtures', 't27-icon-uhd.png'),
    splash: join(PKG_ROOT, 'scripts', 'fixtures', 't27-splash-uhd.png'),
  },
  content: {
    // Pinned 2026-05-10; keep in sync with templates/video_grid_channel/schema.ts Example.
    feed_url: 'https://demo.avideo.com/roku.json',
    feed_format: 'roku_direct_publisher_json',
  },
};

const specPath = join(work, 'spec.json');
await writeFile(specPath, JSON.stringify(canonicalSpec));

const summary = { passed: [], failed: [] };
function assertStep(name, thunk) {
  return thunk()
    .then((v) => {
      summary.passed.push(name);
      return v;
    })
    .catch((e) => {
      summary.failed.push({ name, message: String(e && e.message ? e.message : e) });
      throw e;
    });
}

try {
  // Step 1: generate + zip.
  await assertStep('generate_app', () =>
    generateAppForRegen({ outputDir, spec: specPath, outputZip }),
  );

  // Step 2: sideload + launch.
  // No launch params: EcpControl's allowlist (Plan 1 isAllowedLaunchParamKey)
  // rejects bs_debug_protocol; omitting it is equivalent to passing '0'.
  await assertStep('sideload + launch', () => sideloadAndLaunch(outputZip, host, password));

  // Allow feed fetch + hero hydration.
  await sleep(5000);

  // Step 3: screenshot home, assert no error overlay.
  await assertStep('home screenshot (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, '01-home.png')),
  );

  // Step 4: navigate to second tile of first row (Down -> Right x 2).
  await assertStep('navigate to first row', () => keypress(host, 'Down'));
  await sleep(400);
  await assertStep('navigate right×2', () => keypressRepeat(host, 'Right', 2));
  await sleep(400);
  await assertStep('row screenshot (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, '02-row.png')),
  );

  // Step 5: enter details.
  await assertStep('select (enter details)', () => keypress(host, 'Select'));
  await sleep(1200);
  await assertStep('details screenshot (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, '03-details.png')),
  );

  // Step 6: best-effort playback. The pinned sample feed (demo.avideo.com)
  // doesn't expose RDP-spec content.videos[0].url, so PlayerScene shows the
  // "no stream URL" overlay rather than starting a media-player session.
  // We exercise the Select keypress + screenshot the resulting overlay (still
  // a meaningful render assertion: error overlay heuristic must NOT trip on
  // the >15 KB scrim+text composite). Future feed bumps that include real
  // stream URLs will let us re-enable assertPlaybackStarts here.
  await assertStep('select (play)', () => keypress(host, 'Select'));
  await sleep(1500);
  await assertStep('post-play screenshot (no crash overlay)', () =>
    screenshotNoError(host, password, join(screensDir, '04-post-play.png')),
  );

  // ============================================================
  // Phase B (Plan 4b): Up-from-row-0 + hero playButton + Back.
  // ============================================================
  // After Phase A's "select (play)" we're inside the PlayerScene-or-overlay.
  // Press Back twice to unwind to MainScene with focus on RowList row 0.
  // (PlayerScene Back -> DetailsScene; DetailsScene Back fires close ->
  // MainScene.onDetailsClose -> m.rowList.setFocus(true).)
  //
  // OPERATOR NOTE: if `b-01-hero-button-focused.png` does NOT show the
  // playButton focused, the unwind landed somewhere else (e.g. PlayerScene
  // swallowed Back). Re-run the driver with `Home` + relaunch in place of
  // these two Back presses, then `Up` immediately. Track this as a Phase B
  // preamble bug separate from the Up-routing being verified.
  await assertStep('back to row (Phase B setup)', () => keypressRepeat(host, 'Back', 2));
  await sleep(800);

  // Step B1: Up from RowList row 0 -> focuses hero playButton.
  await assertStep('up to hero playButton', () => keypress(host, 'Up'));
  await sleep(500);
  await assertStep('b-01 hero button focused (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'b-01-hero-button-focused.png')),
  );

  // Step B2: Select on hero playButton -> opens DetailsScene.
  await assertStep('select on hero playButton', () => keypress(host, 'Select'));
  await sleep(1200);
  await assertStep('b-02 details from hero (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'b-02-details-from-hero.png')),
  );

  // Step B3: Back -> DetailsScene removed; focus returns to RowList row 0
  // (per spec D8 / existing onDetailsClose; NOT playButton).
  await assertStep('back from details', () => keypress(host, 'Back'));
  await sleep(800);
  await assertStep('b-03 back from details (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'b-03-back-from-details.png')),
  );

  // Step B4: Up again -> focus moves back to hero playButton (proves
  // Up-routing still works after Details round-trip).
  await assertStep('up to hero playButton again', () => keypress(host, 'Up'));
  await sleep(500);
  await assertStep('b-04 hero button refocused (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'b-04-hero-button-refocused.png')),
  );

  // Step B5: Down -> focus returns to RowList row 0 (proves Down-routing
  // from playButton).
  await assertStep('down to row list', () => keypress(host, 'Down'));
  await sleep(500);
  await assertStep('b-05 back on row list (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'b-05-back-on-row-list.png')),
  );

  // Step 7: Home.
  await assertStep('press Home', () => keypress(host, 'Home'));

  console.log('\nT27 PASS. Screenshots:', screensDir);
  console.log('Steps:', summary.passed.length, 'passed,', summary.failed.length, 'failed.');
  process.exit(0);
} catch (err) {
  console.error('\nT27 FAIL:', err && err.stack ? err.stack : err);
  console.error('Passed steps:', summary.passed);
  console.error('Failed steps:', summary.failed);
  try {
    // {assertForeground: false}: at this point we know the test already
    // failed; capture whatever the device shows even if the channel was
    // backgrounded (e.g. by the very failure class this driver detects).
    await screenshotNoError(host, password, join(screensDir, 'zz-failure.png'), {
      assertForeground: false,
    }).catch(() => {});
  } catch {}
  process.exit(1);
}
