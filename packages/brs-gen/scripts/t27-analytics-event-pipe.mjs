#!/usr/bin/env node
// T27 driver for analytics.event_pipe. Spec section 12.4.
import { generateAppForRegen } from './regen-helper.mjs';
import { sideloadAndLaunch, keypress, keypressRepeat, tailLog, sleep } from './_t27-lib.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, '..', 'tests', '__fixtures__');

const DEVICE_IP = process.env.ROKUDEV_DEFAULT_ROKU_HOST || '10.128.160.39';
const DEV_PASSWORD = process.env.ROKUDEV_ROKU_DEV_PASSWORD || '1234';

const T27_CONFIG = {
  http_endpoint: '',
  http_app_key: '',
  console_sink: true,
  // batch_max_events: 1 causes immediate threshold flush on each Analytics_Track
  // call: channel_start synth + each tracked event prints to console individually.
  // This avoids dependency on the timer-based flush (which fails on TCL 15.2.4
  // because m.global.findNode returns Invalid in observeField timer callbacks).
  batch_interval_ms: 10000,
  batch_max_events: 1,
  default_props: { environment: 't27' },
};

const TEMPLATES = [
  {
    id: 'video_grid_channel',
    extraSpec: {
      branding: {
        primary_color: '#E50914',
        icon: join(FIXTURES_DIR, 'icon-uhd.png'),
        splash: join(FIXTURES_DIR, 'splash-uhd.png'),
      },
      content: {
        feed_url: 'https://demo.avideo.com/roku.json',
        feed_format: 'roku_direct_publisher_json',
      },
    },
    sequence: async (ip) => {
      await keypressRepeat(ip, 'Right', 2, 200);
      await keypress(ip, 'Select');
      await keypress(ip, 'Down');
      await keypress(ip, 'Select');
    },
    expectedEvents: ['channel_start', 'screen_view', 'content_start'],
  },
  {
    id: 'news_channel',
    sequence: async (ip) => {
      await keypress(ip, 'Right');
      await keypress(ip, 'Select');
      await keypress(ip, 'Select');
    },
    expectedEvents: ['channel_start', 'screen_view', 'screen_view', 'content_start'],
  },
  {
    id: 'music_player',
    sequence: async (ip) => {
      await keypress(ip, 'Right');
      await keypress(ip, 'Select');
    },
    expectedEvents: ['channel_start', 'screen_view', 'screen_view'],
  },
  {
    id: 'game_shell',
    sequence: async (ip) => {
      await keypress(ip, 'Select');
    },
    // game_over fires within the 8s wait window: Pong AI vs AI at score_to_win=5
    // ends the match quickly with no human input. game_over is reliably emitted.
    expectedEvents: ['channel_start', 'screen_view', 'game_start', 'game_over'],
  },
];

function parseAnalyticsLines(logText) {
  // Strip \r from telnet output (lines may end with \r\n; split('\n') leaves \r).
  const allEvents = logText.split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.includes('[Analytics] name='))
    .map((l) => {
      const nameMatch = l.match(/name=([a-z0-9_]+)/);
      const propsMatch = l.match(/props=(\{.*\})$/);
      let props = {};
      if (propsMatch) { try { props = JSON.parse(propsMatch[1]); } catch { /* ignore */ } }
      return { name: nameMatch ? nameMatch[1] : '', props };
    });
  // Anchor to the LAST channel_start that has cold_start=true. The 90s tail
  // window may capture events from a prior channel session still running on
  // the device (the previous template's channel is replaced by sideload, but
  // its final events can appear before the new channel's events). The most
  // recent channel_start(cold_start=true) is the anchor for THIS channel session.
  let anchorIdx = -1;
  for (let i = 0; i < allEvents.length; i++) {
    if (allEvents[i].name === 'channel_start' && allEvents[i].props.cold_start === true) {
      anchorIdx = i;
    }
  }
  // Fall back to the last channel_start if cold_start prop is not parseable.
  if (anchorIdx < 0) {
    for (let i = 0; i < allEvents.length; i++) {
      if (allEvents[i].name === 'channel_start') anchorIdx = i;
    }
  }
  return anchorIdx >= 0 ? allEvents.slice(anchorIdx) : allEvents;
}

async function runOne(template) {
  // spec.json must live in a separate dir from outDir; generate_app rejects a
  // non-empty output directory. mkdtempSync creates the spec dir; outDir is a
  // fresh path that generate_app will create itself.
  const workRoot = mkdtempSync(join(tmpdir(), 't27-analytics-' + template.id + '-'));
  const specPath = join(workRoot, 'spec.json');
  const outDir = join(workRoot, 'project');
  const outZip = join(workRoot, 'out.zip');
  writeFileSync(specPath, JSON.stringify({
    spec_version: 2,
    template: template.id,
    modules: [{ id: 'analytics.event_pipe', config: T27_CONFIG }],
    app: { name: 'T27 Analytics ' + template.id, major_version: 0, minor_version: 1, build_version: 0 },
    ...(template.extraSpec ?? {}),
  }));
  await generateAppForRegen({ outputDir: outDir, spec: specPath, outputZip: outZip });

  console.log(`\n=== ${template.id} ===`);
  // Retry sideloadAndLaunch on ECONNRESET (TCL Roku TV 15.2.4 firmware instability).
  for (let sl = 0; sl < 3; sl++) {
    try { await sideloadAndLaunch(outZip, DEVICE_IP, DEV_PASSWORD); break; }
    catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (sl >= 2 || !msg.includes('ECONNRESET')) throw e;
      console.log(`[${template.id}] sideload ECONNRESET retry ${sl + 1}/2`);
      await sleep(2000);
    }
  }

  // Tail strategy for TCL Roku TV 15.2.4 (Native 2910X) firmware:
  //   - ECP active-app='dev' fires immediately after sideload, but BrightScript
  //     runtime takes ~45s to actually start on this firmware (observed).
  //   - Debug port 8085 resets during channel boot; tailLog retries on ECONNRESET.
  //   - We open a 90s tail window, wait 50s for BS runtime to start, then send
  //     keypresses. The flush timer fires 5s after channel start (at ~t+55s).
  //   - Total window (90s) covers boot (45s) + keypress + flush (5s) + margin.
  const tailPromise = tailLog({ host: DEVICE_IP, seconds: 90 });
  await sleep(50000);  // wait for BrightScript runtime to start
  await template.sequence(DEVICE_IP);
  await sleep(8000);  // wait for events to batch and flush (5s timer + margin)
  const fullLog = await tailPromise;

  const events = parseAnalyticsLines(fullLog);
  console.log(`[${template.id}] captured ${events.length} events:`, events.map((e) => e.name));

  const failures = [];
  if (events.length === 0 || events[0].name !== 'channel_start' || events[0].props.cold_start !== true) {
    failures.push(`expected first event channel_start cold_start=true; got ${events[0]?.name}`);
  }
  const csCount = events.filter((e) => e.name === 'channel_start').length;
  if (csCount !== 1) failures.push(`expected exactly 1 channel_start; got ${csCount}`);
  const actualNames = events.map((e) => e.name);
  if (JSON.stringify(actualNames) !== JSON.stringify(template.expectedEvents)) {
    failures.push(`expected events [${template.expectedEvents.join(',')}]; got [${actualNames.join(',')}]`);
  }
  for (const ev of events) {
    for (const k of ['channel_client_id', 'session_id', 'channel_version', 'roku_model', 'roku_fw', 'ts_epoch_ms']) {
      if (ev.props[k] === undefined) {
        failures.push(`event ${ev.name} missing auto-prop ${k}`);
      }
    }
  }
  return { template: template.id, pass: failures.length === 0, failures, events };
}

async function main() {
  const results = [];
  for (const t of TEMPLATES) {
    try { results.push(await runOne(t)); }
    catch (e) { results.push({ template: t.id, pass: false, failures: [String(e)], events: [] }); }
  }
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.template}${r.pass ? '' : ': ' + r.failures.join('; ')}`);
  }
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}
main();
