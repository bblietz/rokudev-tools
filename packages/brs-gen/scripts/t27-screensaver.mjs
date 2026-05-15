// packages/brs-gen/scripts/t27-screensaver.mjs
//
// Operator-run real-device driver for screensaver (Plan 4e §10).
//
// Phase A: bundled feed, zero-branding spec.
//   1.  generate_app
//   2.  sideload (no ECP launch — screensavers activate via OS idle-timer)
//   3.  trigger screensaver (Option A: dev-portal form-POST)
//        If Option A throws, fall back to Option B (manual operator instruction + 90s wait)
//   4.  sleep 9s for first photo to render (transition_seconds=7 + 2s margin)
//   5.  screenshotNoError { screensaverMode: true } (screenshot 1, no error overlay)
//   6.  sleep 9s for cycle to advance (transition_seconds=7 + 2s margin)
//   7.  screenshotNoError { screensaverMode: true } (screenshot 2)
//   8.  assert screenshot 1 != screenshot 2 (cycle is running; byte-compare via SHA-256)
//   9.  document /query/active-app (informational; ssvr type expected on some firmwares)
//
// Phase B (operator feed-URL override) is deferred per Plan 4e spec §10.
//
// Usage:
//   ROKUDEV_HOST=10.x.x.x ROKUDEV_DEV_PASSWORD=... \
//     node packages/brs-gen/scripts/t27-screensaver.mjs
//
// Option A trigger (triggerScreensaverViaDevPortal) is a documented no-op:
// Task 16 (2026-05-15) verified that the Roku dev portal on Native 2910X
// firmware does NOT expose a "Test screensaver" HTTP endpoint; the
// `/plugin_inspect` form only offers Inspect / Rekey / Screenshot /
// dloadProf. The function throws to signal "fall back to Option B (manual
// operator trigger)" per spec §10 D-impl-1. Registration is verified
// out-of-band via `/query/screensavers` (which returns the sideloaded
// channel as `id="dev"`); see docs/t27-evidence/2026-05-15-screensaver-phase-a.md.
//
// Failure capture: forensic screenshots use {assertForeground:false} so
// the active-app check does not shadow the original failure.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  sideload,
  screenshotNoError,
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
  console.error('T27 screensaver: ROKUDEV_HOST env var is required (Roku IP).');
  process.exit(2);
}

const iso = new Date().toISOString().replace(/[:.]/g, '-');
const screensDir = join(PKG_ROOT, 'scripts', 't27-screenshots', iso);
const logsDir = join(PKG_ROOT, 'scripts', 't27-logs');
await mkdir(screensDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const work = await mkdtemp(join(tmpdir(), 'brs-gen-t27-screensaver-'));
const outputDir = join(work, 'project');
const outputZip = join(work, 'project.zip');

const canonicalSpec = {
  spec_version: 2,
  template: 'screensaver',
  modules: [],
  app: { name: 'Screensaver E2E', major_version: 0, minor_version: 1, build_version: 0 },
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

// ---------------------------------------------------------------------------
// Option A: dev-portal form-POST trigger.
//
// The Roku dev portal exposes a "Test Screensaver" or equivalent button on
// /plugin_inspect for installed screensaver channels. The exact mysubmit
// value is discovered by GETting /plugin_inspect and inspecting the HTML
// for input[type=submit] elements.
//
// Task 16 (2026-05-15) verified on Roku Native 2910X firmware that the dev
// portal does NOT expose a screensaver-trigger HTTP endpoint. `/plugin_inspect`
// offers only Inspect / Rekey / Screenshot / dloadProf submit buttons. There
// is no documented ECP keypress that immediately activates a screensaver
// either; activation happens only when the OS idle-timer elapses (default 5+
// minutes) AND the channel is set as the active screensaver in Settings >
// Theme > Screensavers > Custom. Registration correctness is verified
// out-of-band by querying `/query/screensavers` (the sideloaded channel
// appears with `id="dev"`).
//
// This function therefore always throws to drive the script into the Option
// B (manual operator) fallback path. See docs/t27-evidence/
// 2026-05-15-screensaver-phase-a.md for the full investigation.
// ---------------------------------------------------------------------------
async function triggerScreensaverViaDevPortal(_host, _password) {
  throw new Error(
    'no dev-portal endpoint exists on Native 2910X firmware; falling back to Option B per spec §10 D-impl-1',
  );
}

try {
  // Step 1: generate + zip.
  await assertStep('generate_app', () =>
    generateAppForRegen({ outputDir, spec: specPath, outputZip }),
  );

  // Step 2: sideload (no ECP launch — screensavers activate via OS idle-timer or
  // dev-portal trigger; EcpControl.launch('dev') would open it as a foreground channel).
  await assertStep('sideload (no launch)', () => sideload(outputZip, host, password));

  // Step 3: trigger screensaver.
  // Try Option A (dev-portal form-POST); if it throws fall back to Option B (manual).
  let triggerPath = 'A';
  try {
    await assertStep('trigger screensaver (dev-portal Option A)', () =>
      triggerScreensaverViaDevPortal(host, password),
    );
  } catch (e) {
    // Option A failed (expected — placeholder throw). Remove from failed list;
    // this is not a hard failure for Phase A, only a path decision.
    summary.failed.pop();
    triggerPath = 'B';
    console.log(`[t27-screensaver] Option A not yet implemented: ${e.message}`);
    console.log('[t27-screensaver] FALLBACK (Option B): manual operator trigger.');
    console.log('[t27-screensaver]   1. On the Roku, open Settings > Theme > Screensavers.');
    console.log('[t27-screensaver]   2. Set the active screensaver to "Screensaver E2E".');
    console.log('[t27-screensaver]   3. Leave the device idle. Waiting 90s for activation...');
    await sleep(90_000);
  }

  // Step 4: wait for first photo to render.
  // transition_seconds default = 7; allow 2s margin for OS to process.
  await sleep(9_000);

  // Step 5: screenshotNoError (screenshot 1, no error overlay, screensaverMode).
  await assertStep('clean screensaver render (screenshot 1)', () =>
    screenshotNoError(host, password, join(screensDir, 'A5-screen1.png'), {
      screensaverMode: true,
    }),
  );

  // Step 6: wait for cycle to advance.
  await sleep(9_000);

  // Steps 7-8: screenshot 2 + assert it differs from screenshot 1 (cycle running).
  await assertStep('cycle advanced (screenshot 2 differs from 1)', async () => {
    await screenshotNoError(host, password, join(screensDir, 'A7-screen2.png'), {
      screensaverMode: true,
    });
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const h1 = createHash('sha256')
      .update(readFileSync(join(screensDir, 'A5-screen1.png')))
      .digest('hex');
    const h2 = createHash('sha256')
      .update(readFileSync(join(screensDir, 'A7-screen2.png')))
      .digest('hex');
    if (h1 === h2) throw new Error('cycle did not advance: screenshots are byte-equal');
  });

  // Step 9: document /query/active-app (informational; ssvr type expected on some firmwares).
  await assertStep('document /query/active-app (informational)', async () => {
    const ecp = new EcpClient(host);
    const a = await ecp.activeApp();
    console.log(`[t27-screensaver] /query/active-app: ${JSON.stringify(a)}`);
  });

  console.log(`\nT27 screensaver PASS (Phase A; trigger path: ${triggerPath}). Phase B (operator feed-URL override) deferred per spec §10.`);
  console.log('Screenshots:', screensDir);
  console.log('Steps:', summary.passed.length, 'passed,', summary.failed.length, 'failed.');
  process.exit(0);
} catch (err) {
  console.error('\nT27 screensaver FAIL:', err && err.stack ? err.stack : err);
  console.error('Passed steps:', summary.passed);
  console.error('Failed steps:', summary.failed);
  try {
    // {assertForeground: false}: at failure time the screensaver may have been
    // dismissed; capture whatever the device shows so the cause is diagnosable.
    await screenshotNoError(host, password, join(screensDir, 'zz-failure.png'), {
      assertForeground: false,
    }).catch(() => {});
  } catch {}
  process.exit(1);
}
