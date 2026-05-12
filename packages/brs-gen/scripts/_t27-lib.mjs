// packages/brs-gen/scripts/_t27-lib.mjs
//
// Shared helpers for T27-class real-device verification drivers (video_grid,
// and Plans 4a-4e templates). ESM, no TypeScript. Consumes
// @rokudev/device-client for sideload + authenticated dev-portal calls and
// ECP control.
//
// Convention: every exported function throws on failure. Drivers catch and
// print a summary before exiting non-zero.

import { DevPortal, DevPortalInspect, EcpClient, EcpControl } from '@rokudev/device-client';
import { writeFile } from 'node:fs/promises';

/** Error-overlay heuristic: crash overlays serialize smaller than this. */
export const ERROR_OVERLAY_MAX_BYTES = 15 * 1024;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sideload the given zip, launch the dev app with optional ECP params, and
 * wait (up to 30s) until /query/active-app reports app id = 'dev'.
 * Throws on any non-2xx or timeout.
 */
export async function sideloadAndLaunch(zipPath, host, password, launchParams = {}) {
  const portal = new DevPortal(host, password);
  await portal.sideload(zipPath);

  const control = new EcpControl(host);
  await control.launch('dev', launchParams);

  const client = new EcpClient(host);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const a = await client.activeApp();
    if (a.id === 'dev') return;
    await sleep(500);
  }
  throw new Error('active-app never became "dev" within 30s');
}

export async function keypress(host, key) {
  const control = new EcpControl(host);
  await control.keypress(key);
}

export async function keypressRepeat(host, key, times, gapMs = 300) {
  const control = new EcpControl(host);
  for (let i = 0; i < times; i++) {
    await control.keypress(key);
    if (i + 1 < times) await sleep(gapMs);
  }
}

/**
 * Assert that the foregrounded app on the Roku is our sideloaded channel
 * (active-app id === 'dev'). Throws otherwise. Retries once after 250ms
 * to absorb transient ECP flakes (per spec D9).
 *
 * Used by screenshotNoError (default-on) so a screenshot is never accepted
 * when our channel was popped to background (e.g. by an accidental Home,
 * a stale Back into Roku home, or another app being launched).
 */
async function assertActiveAppIsOurs(host) {
  const client = new EcpClient(host);
  let lastSeen = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await client.activeApp();
    lastSeen = a;
    if (a.id === 'dev') return;
    if (attempt === 0) await sleep(250);
  }
  throw new Error(
    `active-app is not 'dev' (got id='${lastSeen?.id ?? ''}', ` +
      `name='${lastSeen?.name ?? ''}'); screenshot would not be from our channel`,
  );
}

/**
 * Take a screenshot, write the PNG/JPEG bytes to outPath, and return
 * { bytes, mime, path }. Decodes base64 from DevPortalInspect.screenshot().
 */
export async function screenshot(host, password, outPath) {
  const inspect = new DevPortalInspect(host, password);
  const s = await inspect.screenshot();
  const bytes = Buffer.from(s.base64, 'base64');
  await writeFile(outPath, bytes);
  return { bytes: bytes.byteLength, mime: s.mime, path: outPath };
}

/**
 * Like screenshot(), but throws if either:
 *   1. opts.assertForeground (default true) and active-app id !== 'dev'
 *      (caller can opt out for genuine transition steps, e.g. mid-relaunch)
 *   2. saved file is too small to plausibly be a healthy rendered frame
 *      (heuristic per spec D11). An error overlay on 1280x720 serializes
 *      to ~8-12 KB; healthy UIs are typically 40 KB+.
 *
 * Per spec 4b.1 D2 the foreground check is the primary defense against
 * Plan 4b's false-positive class (Roku home / Debug overlay /
 * wrong-app sail through the byte-size heuristic but now fail loudly
 * on the active-app check.
 */
export async function screenshotNoError(host, password, outPath, opts = {}) {
  const { assertForeground = true } = opts;
  if (assertForeground) await assertActiveAppIsOurs(host);
  const s = await screenshot(host, password, outPath);
  if (s.bytes <= ERROR_OVERLAY_MAX_BYTES) {
    throw new Error(
      `screenshot ${outPath} is ${s.bytes} bytes (<= ${ERROR_OVERLAY_MAX_BYTES}) — error overlay heuristic tripped`,
    );
  }
  return s;
}

/**
 * Poll /query/media-player until state reaches 'play', up to timeoutMs.
 * Returns { reached, at, startPosition }.
 */
export async function assertPlaybackStarts(host, timeoutMs) {
  const client = new EcpClient(host);
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    const mp = await client.mediaPlayer();
    lastState = mp.state;
    if (mp.state === 'play') {
      const startPosition = Number(mp.position ?? 0);
      return { reached: 'play', at: Date.now(), startPosition };
    }
    await sleep(500);
  }
  throw new Error(
    `media-player never reached state 'play' within ${timeoutMs}ms (last: ${lastState})`,
  );
}

/**
 * Optionally sleep windowMs first (pass 0 to skip), then sample /query/media-player
 * and assert state is still 'play' + position advanced past startPosition.
 */
export async function assertPositionAdvanced(host, startPosition, windowMs) {
  if (windowMs > 0) await sleep(windowMs);
  const client = new EcpClient(host);
  const mp = await client.mediaPlayer();
  if (mp.state !== 'play') {
    throw new Error(`media-player no longer in 'play' after ${windowMs}ms (now: ${mp.state})`);
  }
  const position = Number(mp.position ?? 0);
  if (position <= startPosition) {
    throw new Error(
      `media-player position did not advance: start=${startPosition}, now=${position}`,
    );
  }
  return { finalPosition: position };
}
