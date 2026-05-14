// packages/brs-gen/scripts/t27-music.mjs
//
// Operator-run real-device driver for music_player (Plan 4d §9).
//
// Phase A: bundled feed, zero-branding spec.
//   1.  generate_app
//   2.  sideload + launch
//   3.  /query/active-app == dev (asserted inside screenshotNoError)
//   4.  screenshotNoError               (clean MainScene, PosterGrid visible)
//   5.  Select                          -> NowPlayingScene push, audio starts
//   6.  sleep 3s for audio buffer
//   7.  /query/media-player state in [playing, buffering] (best-effort)
//   8.  screenshotNoError               (clean NowPlayingScene)
//   9.  Back                            -> NowPlayingScene close, MiniBar appears
//   10. sleep 1.5s for MiniBar animation
//   11. screenshotNoError               (MiniBar visible in MainScene)
//   12. Down                            -> focus moves from PosterGrid to MiniBar
//   13. sleep 300ms
//   14. Select (via MiniBar playPause)  -> toggle pause
//   15. sleep 800ms
//   16. /query/media-player state == paused (best-effort)
//   17. Select                          -> toggle play
//   18. sleep 800ms
//   19. Up                              -> focus returns to PosterGrid
//   20. sleep 300ms
//   21. screenshotNoError               (final clean state, PosterGrid focused)
//
// Phase B (operator feed-URL override) is deferred per Plan 4d spec section 9.
//
// Usage:
//   ROKUDEV_HOST=10.x.x.x ROKUDEV_DEV_PASSWORD=... \
//     node packages/brs-gen/scripts/t27-music.mjs
//
// Failure capture: forensic screenshots use {assertForeground:false} so
// the active-app check does not shadow the original failure.
//
// Inline helpers not exported from _t27-lib.mjs (ecpQueryMediaPlayer) are
// defined at the bottom of this file to avoid modifying the shared lib.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  sideloadAndLaunch,
  screenshotNoError,
  keypress,
  sleep,
} from './_t27-lib.mjs';
import { generateAppForRegen } from './regen-helper.mjs';
import { EcpClient } from '@rokudev/device-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);

const host = process.env.ROKUDEV_HOST || process.env.ROKUDEV_DEFAULT_ROKU_HOST;
const password =
  process.env.ROKUDEV_DEV_PASSWORD || process.env.ROKUDEV_ROKU_DEV_PASSWORD || '1234';

if (!host) {
  console.error('T27 music: ROKUDEV_HOST env var is required (Roku IP).');
  process.exit(2);
}

const iso = new Date().toISOString().replace(/[:.]/g, '-');
const screensDir = join(PKG_ROOT, 'scripts', 't27-screenshots', iso);
const logsDir = join(PKG_ROOT, 'scripts', 't27-logs');
await mkdir(screensDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const work = await mkdtemp(join(tmpdir(), 'brs-gen-t27-music-'));
const outputDir = join(work, 'project');
const outputZip = join(work, 'project.zip');

const canonicalSpec = {
  spec_version: 2,
  template: 'music_player',
  modules: [],
  app: { name: 'T27 Music', major_version: 0, minor_version: 1, build_version: 0 },
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
  await assertStep('sideload + launch', () => sideloadAndLaunch(outputZip, host, password));

  // Allow bundled feed parse + grid hydration.
  await sleep(3000);

  // Step 3: /query/active-app == dev (asserted inside screenshotNoError).
  // Step 4: screenshotNoError (clean MainScene, PosterGrid focused).
  await assertStep('clean MainScene (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'A4-mainscene.png')),
  );

  // Step 5: Select on PosterGrid item [0] -> NowPlayingScene push, audio starts.
  await assertStep('select (open NowPlayingScene)', () => keypress(host, 'Select'));

  // Step 6: allow audio buffer.
  await sleep(3000);

  // Step 7: best-effort media-player query; bundled feed audio may or may not
  // reach the device so this step never fails the driver.
  await assertStep('media-player query (best-effort)', async () => {
    try {
      const mp = await ecpQueryMediaPlayer(host);
      console.log('  [step 7] media-player state:', mp.state ?? '(unknown)');
    } catch (e) {
      console.warn('  [step 7] media-player query failed (best-effort):', e.message);
    }
  });

  // Step 8: screenshotNoError (clean NowPlayingScene).
  await assertStep('clean NowPlayingScene (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'A8-nowplaying.png')),
  );

  // Step 9: Back -> NowPlayingScene close; MiniBar should become visible.
  await assertStep('back (NowPlayingScene -> MainScene)', () => keypress(host, 'Back'));

  // Step 10: allow MiniBar animation + state flush.
  await sleep(1500);

  // Step 11: screenshotNoError (MiniBar visible in MainScene).
  await assertStep('MiniBar visible in MainScene (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'A11-minibar.png')),
  );

  // Step 12: Down -> focus moves from PosterGrid to MiniBar playPause button.
  await assertStep('down (PosterGrid -> MiniBar)', () => keypress(host, 'Down'));
  await sleep(300);

  // Step 13 (driver step numbering from comment header):
  // Step 14: Select via MiniBar -> toggle pause.
  await assertStep('select (MiniBar pause toggle)', () => keypress(host, 'Select'));
  await sleep(800);

  // Step 16: best-effort media-player paused check.
  await assertStep('media-player query paused (best-effort)', async () => {
    try {
      const mp = await ecpQueryMediaPlayer(host);
      console.log('  [step 16] media-player state:', mp.state ?? '(unknown)');
    } catch (e) {
      console.warn('  [step 16] media-player query failed (best-effort):', e.message);
    }
  });

  // Step 17: Select again -> toggle play.
  await assertStep('select (MiniBar play toggle)', () => keypress(host, 'Select'));
  await sleep(800);

  // Step 19: Up -> focus returns to PosterGrid.
  await assertStep('up (MiniBar -> PosterGrid)', () => keypress(host, 'Up'));
  await sleep(300);

  // Step 21: screenshotNoError (final clean state, PosterGrid focused).
  await assertStep('final clean state (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'A21-final.png')),
  );

  console.log('\nT27 music PASS (Phase A). Phase B (operator feed-URL override) deferred per spec §9.');
  console.log('Screenshots:', screensDir);
  console.log('Steps:', summary.passed.length, 'passed,', summary.failed.length, 'failed.');
  process.exit(0);
} catch (err) {
  console.error('\nT27 music FAIL:', err && err.stack ? err.stack : err);
  console.error('Passed steps:', summary.passed);
  console.error('Failed steps:', summary.failed);
  try {
    // {assertForeground: false}: at failure time we may have exited the channel;
    // capture whatever the device shows so the cause is diagnosable.
    await screenshotNoError(host, password, join(screensDir, 'zz-failure.png'), {
      assertForeground: false,
    }).catch(() => {});
  } catch {}
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Inline helpers not exported from _t27-lib.mjs.
// ---------------------------------------------------------------------------

/**
 * Query /query/media-player and return the media-player state object.
 * Not exported from _t27-lib.mjs; defined here to avoid modifying shared lib.
 */
async function ecpQueryMediaPlayer(host) {
  const client = new EcpClient(host);
  return client.mediaPlayer();
}
