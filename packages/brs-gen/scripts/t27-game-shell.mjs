// packages/brs-gen/scripts/t27-game-shell.mjs
//
// Operator-run real-device driver for game_shell template (Plan 4f §9.1).
//
// Phase A: bundled defaults (cpu_difficulty=normal, score_to_win=5,
//   high_score_persistence=true).
//   1.  generate_app
//   2.  sideloadAndLaunch
//   3.  screenshot title screen
//   4.  ECP Select to start
//   5.  screenshot playing-initial
//   6.  ECP Up x3, Down x3 to move paddle
//   7.  sleep 2.5s for ball to travel + bounce
//   8.  screenshot playing-later
//   9.  SHA-256 compare playing screenshots; assert different (game animating)
//   10. ECP Back to return to title
//   11. screenshot title-after-back (binding "Back returns to title" gate
//       via screenshotNoError's foreground check)
//
// Phase B (operator override of cpu_difficulty / score_to_win) deferred
// per spec §9.2.
//
// Usage:
//   ROKUDEV_HOST=10.x.x.x ROKUDEV_DEV_PASSWORD=... \
//     node packages/brs-gen/scripts/t27-game-shell.mjs
//
// Failure capture: forensic screenshots use {assertForeground: false}
// so the active-app check does not shadow the original failure.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  sideloadAndLaunch,
  screenshotNoError,
  sleep,
  keypress,
  keypressRepeat,
} from './_t27-lib.mjs';
import { generateAppForRegen } from './regen-helper.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);

const host = process.env.ROKUDEV_HOST || process.env.ROKUDEV_DEFAULT_ROKU_HOST;
const password =
  process.env.ROKUDEV_DEV_PASSWORD || process.env.ROKUDEV_ROKU_DEV_PASSWORD || '1234';

if (!host) {
  console.error('T27 game_shell: ROKUDEV_HOST env var is required (Roku IP).');
  process.exit(2);
}

const iso = new Date().toISOString().replace(/[:.]/g, '-');
const screensDir = join(PKG_ROOT, 'scripts', 't27-screenshots', iso);
await mkdir(screensDir, { recursive: true });

const work = await mkdtemp(join(tmpdir(), 'brs-gen-t27-game-shell-'));
const outputDir = join(work, 'project');
const outputZip = join(work, 'project.zip');

const canonicalSpec = {
  spec_version: 2,
  template: 'game_shell',
  modules: [],
  app: { name: 'Pong E2E', major_version: 0, minor_version: 1, build_version: 0 },
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
  await assertStep('sideloadAndLaunch', () => sideloadAndLaunch(outputZip, host, password));

  // Allow title screen to fully render.
  await sleep(1500);

  // Step 3: screenshot title screen.
  await assertStep('A1: title screen', () =>
    screenshotNoError(host, password, join(screensDir, 'A1-title.png')),
  );

  // Step 4: Select to start game.
  await assertStep('ECP Select to start', () => keypress(host, 'Select'));
  await sleep(1500);

  // Step 5: screenshot playing-initial.
  await assertStep('A2: playing initial', () =>
    screenshotNoError(host, password, join(screensDir, 'A2-playing-initial.png')),
  );

  // Step 6: move paddle up then down.
  await assertStep('ECP Up x3', () => keypressRepeat(host, 'Up', 3, 100));
  await sleep(500);
  await assertStep('ECP Down x3', () => keypressRepeat(host, 'Down', 3, 100));
  await sleep(500);

  // Step 7-8: sleep for ball travel + bounce, then screenshot playing-later.
  await sleep(2500);
  await assertStep('A3: playing later', () =>
    screenshotNoError(host, password, join(screensDir, 'A3-playing-later.png')),
  );

  // Step 9: SHA-256 compare A2 vs A3; assert different (game is animating).
  await assertStep('game animating (A2 != A3)', async () => {
    const h2 = createHash('sha256')
      .update(readFileSync(join(screensDir, 'A2-playing-initial.png')))
      .digest('hex');
    const h3 = createHash('sha256')
      .update(readFileSync(join(screensDir, 'A3-playing-later.png')))
      .digest('hex');
    if (h2 === h3) throw new Error('game did not animate: A2 and A3 are byte-equal');
  });

  // Step 10: Back to return to title screen.
  await assertStep('ECP Back to title', () => keypress(host, 'Back'));
  await sleep(1000);

  // Step 11: screenshot title-after-back.
  // screenshotNoError's foreground check is the binding
  // "Back returns to title without exiting channel" gate.
  await assertStep('A4: title after Back (binding foreground gate)', () =>
    screenshotNoError(host, password, join(screensDir, 'A4-title-after-back.png')),
  );

  console.log(
    '\nT27 game_shell PASS (Phase A). Phase B (operator content override) deferred per spec §9.2.',
  );
  console.log('Screenshots:', screensDir);
  console.log('Steps:', summary.passed.length, 'passed,', summary.failed.length, 'failed.');
  process.exit(0);
} catch (err) {
  console.error('\nT27 game_shell FAIL:', err && err.stack ? err.stack : err);
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
