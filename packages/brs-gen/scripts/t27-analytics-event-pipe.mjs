#!/usr/bin/env node
// T27 driver for analytics.event_pipe. Spec section 12.4.
import { generateAppForRegen } from './regen-helper.mjs';
import { sideloadAndLaunch, keypress, keypressRepeat, tailLog, sleep } from './_t27-lib.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEVICE_IP = process.env.ROKUDEV_DEFAULT_ROKU_HOST || '10.128.160.39';
const DEV_PASSWORD = process.env.ROKUDEV_ROKU_DEV_PASSWORD || '1234';

const T27_CONFIG = {
  http_endpoint: '',
  http_app_key: '',
  console_sink: true,
  batch_interval_ms: 1500,
  batch_max_events: 5,
  default_props: { environment: 't27' },
};

const TEMPLATES = [
  {
    id: 'video_grid_channel',
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
    expectedEvents: ['channel_start', 'screen_view', 'game_start'],
  },
];

function parseAnalyticsLines(logText) {
  return logText.split('\n')
    .filter((l) => l.includes('[Analytics] name='))
    .map((l) => {
      const nameMatch = l.match(/name=([a-z0-9_]+)/);
      const propsMatch = l.match(/props=(\{.*\})$/);
      let props = {};
      if (propsMatch) { try { props = JSON.parse(propsMatch[1]); } catch { /* ignore */ } }
      return { name: nameMatch ? nameMatch[1] : '', props };
    });
}

async function runOne(template) {
  const outDir = mkdtempSync(join(tmpdir(), 't27-analytics-' + template.id + '-'));
  const specPath = join(outDir, 'spec.json');
  writeFileSync(specPath, JSON.stringify({
    spec_version: 2,
    template: template.id,
    modules: [{ id: 'analytics.event_pipe', config: T27_CONFIG }],
    app: { name: 'T27 Analytics ' + template.id, major_version: 0, minor_version: 1, build_version: 0 },
  }));
  await generateAppForRegen({ outputDir: outDir, spec: specPath, outputZip: join(outDir, 'out.zip') });

  console.log(`\n=== ${template.id} ===`);
  await sideloadAndLaunch(join(outDir, 'out.zip'), DEVICE_IP, DEV_PASSWORD);

  const tailPromise = tailLog({ host: DEVICE_IP, seconds: 10 });
  await sleep(2500);
  await template.sequence(DEVICE_IP);
  await sleep(2000);
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
