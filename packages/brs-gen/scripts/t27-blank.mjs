// packages/brs-gen/scripts/t27-blank.mjs
//
// Operator-run T27 real-device verification for blank_scenegraph.
//
// Requires env:
//   ROKUDEV_HOST         IP of a dev-mode Roku
//   ROKUDEV_DEV_PASSWORD dev password (default: 1234)
//
// Requires state:
//   - `pnpm -C packages/brs-gen build` succeeded
//
// Usage:
//   node packages/brs-gen/scripts/t27-blank.mjs
//
// Exit 0 on PASS, non-zero on FAIL. Screenshots written to
// scripts/t27-screenshots/blank-<iso>/.
//
// Phase A: zero-branding spec (synthesized icon + splash via generate_app defaults)
// Phase B: DEFERRED — stub_label requires { scope: 'Main', phase: 'before_scene_show' }
//          but blank_scenegraph only exports { scope: 'MainScene', phase: 'after_scene_show' }.
//          They are incompatible. Will land once a compatible module exists that targets
//          MainScene/after_scene_show.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { sideloadAndLaunch, keypress, screenshotNoError, sleep } from './_t27-lib.mjs';
import { generateAppForRegen } from './regen-helper.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);

const host = process.env.ROKUDEV_HOST;
const password = process.env.ROKUDEV_DEV_PASSWORD || '1234';
if (!host) {
  console.error('T27 blank: ROKUDEV_HOST env var is required (Roku IP).');
  process.exit(2);
}

const iso = new Date().toISOString().replace(/[:.]/g, '-');
const screensDir = join(PKG_ROOT, 'scripts', 't27-screenshots', `blank-${iso}`);
await mkdir(screensDir, { recursive: true });

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

// ---------- Phase A: zero-branding spec ----------
async function runPhaseA() {
  console.log('=== Phase A: zero-branding spec ===');
  const work = await mkdtemp(join(tmpdir(), 'brs-gen-t27-blank-a-'));
  const outputDir = join(work, 'project');
  const outputZip = join(work, 'project.zip');

  const spec = {
    spec_version: 2,
    template: 'blank_scenegraph',
    modules: [],
    app: {
      name: 'T27 Blank Phase A',
      major_version: 0,
      minor_version: 1,
      build_version: 0,
    },
  };
  const specPath = join(work, 'spec.json');
  await writeFile(specPath, JSON.stringify(spec));

  await assertStep('A: generate_app', () =>
    generateAppForRegen({ outputDir, spec: specPath, outputZip }),
  );

  await assertStep('A: sideload + launch', () => sideloadAndLaunch(outputZip, host, password));

  // Allow channel init to complete.
  await sleep(3000);

  await assertStep('A: home screenshot (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'a-01-home.png')),
  );

  await assertStep('A: Home exits channel', () => keypress(host, 'Home'));
}

// ---------- Phase B: DEFERRED ----------
// stub_label requires { kind: 'init_hook', scope: 'Main', phase: 'before_scene_show' }.
// blank_scenegraph only exports { scope: 'MainScene', phase: 'after_scene_show' }.
// They cannot compose. When a module exists that targets MainScene/after_scene_show,
// add Phase B here that injects the module via spec.modules and asserts the
// module-rendered label appears in the screenshot (positional or pixel-variance check).

try {
  await runPhaseA();
  console.log('\nT27 BLANK PASS (Phase A only — Phase B deferred).');
  console.log('Screenshots:', screensDir);
  console.log('Passed:', summary.passed.length, 'Failed:', summary.failed.length);
  process.exit(0);
} catch (err) {
  console.error('\nT27 BLANK FAIL:', err && err.stack ? err.stack : err);
  console.error('Passed steps:', summary.passed);
  console.error('Failed steps:', summary.failed);
  try {
    await screenshotNoError(host, password, join(screensDir, 'zz-failure.png')).catch(() => {});
  } catch {}
  process.exit(1);
}
