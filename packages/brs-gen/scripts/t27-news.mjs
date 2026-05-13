// packages/brs-gen/scripts/t27-news.mjs
//
// Operator-run real-device driver for news_channel (Plan 4c §10).
//
// Phase A: bundled feed, zero-branding spec.
//   1. generate_app
//   2. sideload + launch
//   3. /query/active-app == dev
//   4. screenshotNoError (clean MainScene)
//   5. Right                       -> focus moves to CategoryRail first item
//   6. Down x2                     -> focus on third category
//   7. Select                      -> CategoryGridScene push
//   8. screenshotNoError           (clean grid)
//   9. Select                      -> PlayerScene push
//   10. sleep 3s; query/media-player ~= playing (best-effort, AVideo demo)
//   11. screenshot {assertForeground:false} (capture player screenshot)
//   12. Back x2 with active-app check between Backs (PlayerScene -> Grid -> Main)
//   13. screenshotNoError (final clean state, focus on hero playButton)
//
// Phase B: live stream.
//   14. re-sideload + launch (deterministic preamble per Plan 4b.1 lesson)
//   15. Select on LiveHero playButton (focus default)
//   16. sleep 5s for HLS handshake
//   17. /query/media-player ~= playing (best-effort; NASA TV usually OK)
//   18. screenshot {assertForeground:false} (capture live screenshot)
//   19. Back -> MainScene
//   20. screenshotNoError (final clean state)
//
// Usage:
//   ROKUDEV_HOST=10.x.x.x ROKUDEV_DEV_PASSWORD=... \
//     node packages/brs-gen/scripts/t27-news.mjs
//
// Failure capture: forensic screenshots use {assertForeground:false} so
// the active-app check doesn't shadow the original failure.
//
// Missing from _t27-lib.mjs: ecpQueryActiveApp, ecpQueryMediaPlayer.
// Both are defined inline at the bottom of this file. generateAppForRegen
// lives in regen-helper.mjs (not _t27-lib.mjs).

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  sideloadAndLaunch,
  screenshotNoError,
  keypress,
  keypressRepeat,
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
  console.error('T27 news: ROKUDEV_HOST env var is required (Roku IP).');
  process.exit(2);
}

const iso = new Date().toISOString().replace(/[:.]/g, '-');
const screensDir = join(PKG_ROOT, 'scripts', 't27-screenshots', iso);
const logsDir = join(PKG_ROOT, 'scripts', 't27-logs');
await mkdir(screensDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const work = await mkdtemp(join(tmpdir(), 'brs-gen-t27-news-'));
const outputDir = join(work, 'project');
const outputZip = join(work, 'project.zip');

const canonicalSpec = {
  spec_version: 2,
  template: 'news_channel',
  modules: [],
  app: { name: 'T27 News', major_version: 0, minor_version: 1, build_version: 0 },
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

  // Allow feed fetch + hero hydration.
  await sleep(3000);

  // Step 3: /query/active-app == dev (asserted inside screenshotNoError).
  // Step 4: screenshotNoError (clean MainScene).
  await assertStep('clean MainScene (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'A4-mainscene.png')),
  );

  // Step 5: Right -> CategoryRail first item.
  await assertStep('right to CategoryRail', () => keypress(host, 'Right'));
  await sleep(500);

  // Step 6: Down x2 -> third category.
  await assertStep('down x2 (third category)', () => keypressRepeat(host, 'Down', 2));
  await sleep(500);

  // Step 7: Select -> CategoryGridScene push.
  await assertStep('select (open CategoryGridScene)', () => keypress(host, 'Select'));
  await sleep(1500);

  // Step 8: screenshotNoError (clean grid).
  await assertStep('clean CategoryGridScene (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'A8-grid.png')),
  );

  // Step 9: Select -> PlayerScene push.
  await assertStep('select (open PlayerScene)', () => keypress(host, 'Select'));
  await sleep(3000);

  // Step 10: best-effort media-player query.
  await assertStep('media-player query (best-effort)', async () => {
    try {
      const mp = await ecpQueryMediaPlayer(host);
      console.log('  [step 10] media-player state:', mp.state ?? '(unknown)');
    } catch (e) {
      console.warn('  [step 10] media-player query failed (best-effort):', e.message);
    }
  });

  // Step 11: screenshot {assertForeground:false} (capture player screenshot).
  // assertForeground:false because PlayerScene may open a URL that transitions
  // the active-app state briefly, and this is a best-effort capture.
  await assertStep('player screenshot (forensic)', () =>
    screenshotNoError(host, password, join(screensDir, 'A11-player.png'), {
      assertForeground: false,
    }),
  );

  // Step 12: Back x2 with active-app check between Backs.
  //   First Back: PlayerScene -> CategoryGridScene.
  //   Second Back: CategoryGridScene -> MainScene.
  await assertStep('back (PlayerScene -> grid)', () => keypress(host, 'Back'));
  await sleep(800);
  await assertStep('active-app check after first Back', async () => {
    const aa = await ecpQueryActiveApp(host);
    if (aa.id !== 'dev') {
      throw new Error(
        `after first Back, active-app is '${aa.id}' not 'dev'`,
      );
    }
  });

  await assertStep('back (grid -> MainScene)', () => keypress(host, 'Back'));
  await sleep(800);
  await assertStep('active-app check after second Back', async () => {
    const aa = await ecpQueryActiveApp(host);
    if (aa.id !== 'dev') {
      throw new Error(
        `after second Back, active-app is '${aa.id}' not 'dev'`,
      );
    }
  });

  // Step 13: screenshotNoError (final clean state).
  await assertStep('MainScene restored (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'A13-main-restored.png')),
  );

  // ============================================================
  // Phase B: live stream. Deterministic re-sideload preamble.
  // Per Plan 4b.1 lesson: re-sideload + launch rather than Back-spam,
  // so we land in a known-good state regardless of where Phase A left off.
  // ============================================================
  await assertStep('re-sideload + launch (Phase B setup)', () =>
    sideloadAndLaunch(outputZip, host, password),
  );
  await sleep(3000);

  // Step 15: Select on LiveHero playButton (focus default after launch).
  await assertStep('select (open live PlayerScene)', () => keypress(host, 'Select'));
  await sleep(5000); // HLS handshake window.

  // Step 17: best-effort media-player query.
  await assertStep('live media-player query (best-effort)', async () => {
    try {
      const mp = await ecpQueryMediaPlayer(host);
      console.log('  [step 17] media-player state:', mp.state ?? '(unknown)');
    } catch (e) {
      console.warn('  [step 17] media-player query failed (best-effort):', e.message);
    }
  });

  // Step 18: screenshot {assertForeground:false} (capture live screenshot).
  await assertStep('live screenshot (forensic)', () =>
    screenshotNoError(host, password, join(screensDir, 'B18-live.png'), {
      assertForeground: false,
    }),
  );

  // Step 19: Back -> MainScene.
  await assertStep('back (live -> MainScene)', () => keypress(host, 'Back'));
  await sleep(800);

  // Step 20: screenshotNoError (final clean state).
  await assertStep('MainScene restored after live (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'B20-main-restored.png')),
  );

  console.log('\nT27 news PASS. Screenshots:', screensDir);
  console.log('Steps:', summary.passed.length, 'passed,', summary.failed.length, 'failed.');
  process.exit(0);
} catch (err) {
  console.error('\nT27 news FAIL:', err && err.stack ? err.stack : err);
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
 * Query /query/active-app and return { id, name }.
 * Not exported from _t27-lib.mjs; defined here to avoid modifying shared lib.
 */
async function ecpQueryActiveApp(host) {
  const client = new EcpClient(host);
  return client.activeApp();
}

/**
 * Query /query/media-player and return the media-player state object.
 * Not exported from _t27-lib.mjs; defined here to avoid modifying shared lib.
 */
async function ecpQueryMediaPlayer(host) {
  const client = new EcpClient(host);
  return client.mediaPlayer();
}
