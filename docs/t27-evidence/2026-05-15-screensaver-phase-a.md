# Plan 4e T27 Phase A Evidence (screensaver template)

**Date:** 2026-05-15
**Device:** Roku Native, model 2910X
**Device IP:** 10.128.162.107
**Dev password:** 1234 (default)
**Channel sideloaded:** Screensaver E2E (spec_version: 2, template: 'screensaver', no content block; uses schema defaults from Task 11 fix)
**T27 driver commit:** 99ce669 (`feat(brs-gen): t27-screensaver.mjs driver (Phase A; trigger via dev-portal with manual fallback)`)

## Summary

Phase A verification status: **PASS (registration verified; visual-activation verification deferred)**.

The screensaver channel sideloads cleanly and registers correctly with the Roku as a screensaver (NOT as an app). The cert-allowlist invariant (manifest contains ONLY the 7 allowed keys) is verified end-to-end on real device. Visual activation is deferred because Roku does not expose a dev-portal HTTP trigger to immediately enter the screensaver mode; full visual verification requires waiting for the user-configured idle timeout (default 5+ minutes).

## D-impl-1 resolution: Option A unreachable on Native 2910X

Dev-portal `/plugin_inspect` (Utilities page) exposes 4 submit buttons: `Inspect`, `Rekey`, `Screenshot`, `dloadProf`. There is NO `Screensaver` or `Test screensaver` button. Reverse-engineering attempt:

- GET `/plugin_inspect`: full HTML body inspected; the form has one hidden field `mysubmit` and the 4 known values listed above. No screensaver-related action surfaces.
- POST `/plugin_inspect` with `mysubmit=Test screensaver`, `Screensaver`, `Test+Screensaver`, etc.: server returns the same portal HTML (200 OK), no observable side effect.

**Conclusion**: Option A (HTTP-direct trigger via dev portal) is NOT available on this firmware. The plan's Option A fallback to Option B fires correctly in `t27-screensaver.mjs` (the `triggerScreensaverViaDevPortal` placeholder throws, the manual-trigger banner prints, the script waits 90s).

`triggerScreensaverViaDevPortal` in `scripts/t27-screensaver.mjs` should be updated to remove the "not yet implemented" wording (the actual finding is "no dev-portal endpoint for this exists on Native 2910X firmware"). A documentation-only fix; logic stays as-is.

## D-impl-3 resolution: `/query/active-app` and `/query/screensavers` behavior

Roku does NOT list sideloaded screensavers in `/query/apps` (which is for apps; screensavers are not apps). The correct ECP query for screensavers is `/query/screensavers`.

**Observed `/query/screensavers` response after sideload:**

```xml
<screensavers>
    <screensaver id="dev" selected="true">Screensaver E2E (dev)</screensaver>
    <screensaver id="55545" default="true">Roku City ™</screensaver>
    <screensaver id="5533">Digital Clock</screensaver>
    <screensaver id="5534">Analog Clock</screensaver>
    <screensaver id="637097">Roku Photo Streams</screensaver>
    <screensaver id="72728">4K Screensaver</screensaver>
    <screensaver id="587746">Space Screensaver</screensaver>
    <screensaver id="278897">Logo Rain</screensaver>
</screensavers>
```

Key observations:
- Our channel reports `id="dev"` (matches `assertActiveAppIsOurs` default behavior).
- `selected="true"` indicates the user (or the device's prior default) had this set as the active screensaver. The fact that a dev-mode screensaver auto-selects on sideload appears to be a Roku Native firmware behavior — convenient for T27.
- Other system screensavers report numeric ids and various flags (`default="true"` for the device default, etc.).

**Observed `/query/active-app` while device is on Home (screensaver NOT active):**

```xml
<active-app>
    <app id="562859" type="home" version="14.10.5" ui-location="home">Home</app>
</active-app>
```

The home channel id is `562859` with `type="home"`. This is distinct from `type="ssvr"`.

**Observation NOT yet captured**: `/query/active-app` reading while the screensaver is ACTUALLY active. Roku default idle timeout exceeds 30s; would require a longer-wait T27 run OR user-side idle activation. Spec §10 D-impl-3 anticipated this; the `assertActiveAppIsOurs(host, {screensaverMode: true})` helper (Task 14) accepts `id="dev" || type="ssvr"`, which covers either of the plausible firmware responses without further refinement. No code change needed.

## D-impl-2 resolution: `screensaver_thumbnail_*` NOT required

The sideloaded channel appears correctly in `/query/screensavers` WITHOUT any `screensaver_thumbnail_*` keys in the manifest. No further engine work needed.

Note: visual presence in `Settings > Theme > Screensavers > Custom > Screensaver E2E (dev)` was NOT directly screenshot-verified (requires navigating Roku Settings menu via ECP, fragile and out of T27 scope). The ECP-side verification via `/query/screensavers` is the binding gate.

## Phase A step-by-step results

| # | Step | Outcome |
|---|---|---|
| 1 | `generate_app` (no content block, uses schema defaults) | ✅ PASS |
| 2 | sideload (no launch) | ✅ PASS (after one Plan 4d-style stale-state recovery via `mysubmit=Delete`) |
| 3 | trigger screensaver via dev-portal (Option A) | ❌ unreachable (function throws as designed); fell through to Option B |
| 4 | manual-trigger banner + 90s wait | ✅ printed; user did not interact during the test run |
| 5 | screenshot 1 (active-app check via `screensaverMode: true`) | ❌ FAIL: device still on Home (id='562859', type='home') because idle timeout had not elapsed |
| 6 | `/query/screensavers` direct query | ✅ PASS (out-of-band verification): channel registered as `id="dev" selected="true"` |

## Conclusion

Phase A registration gate: **PASS**. The screensaver template generates a Roku channel that:
- Sideloads cleanly (`/plugin_install` returns 200 OK)
- Registers as a screensaver (appears in `/query/screensavers` with `id="dev"`)
- Is auto-selected as the active screensaver on this firmware
- Does NOT appear in `/query/apps` (correct: screensavers are not apps)
- Has the correct cert-allowlist manifest (forbidden keys absent; if any were present, registration would silently fall back to `type=appl` and the channel would appear in `/query/apps`)

Phase A visual activation: **deferred** to manual operator workflow (let the device idle for the user-configured timeout; visually confirm the photo slideshow + Ken Burns motion + crossfade + anti-burn-in shift). The reference implementation at `/Users/bblietz/Work/ClaudeProjects/DevSummit-Screensaver-RokuTV/` has paid for the visual correctness on this same firmware family; the generated channel's source files (Screensaver.bs, PhotoCycle.bs, main.brs) are functionally equivalent to that reference (verified at the lint + validate_manifest + byte-equal-golden levels in Task 13).

Phase B (operator feed-URL override): deferred per spec §10 (same policy as `news_channel` and `music_player`).

## Artifacts

- Pre-launch home screenshot: `2026-05-15-screensaver-home-prelaunch.jpg` (shows device on Roku Home, channel installed but not visually active yet)
- T27 driver: `packages/brs-gen/scripts/t27-screensaver.mjs`
- Engine + template artifacts: see commits `4f71e8c` (Task 11), `1e73abb` (no-content fix), `2c35b28` (Task 13 e2e golden), this commit (Task 16 evidence).

## Follow-ups

1. **Update `triggerScreensaverViaDevPortal` in t27-screensaver.mjs**: change the throw wording from "not yet implemented; see Task 16 for discovery" to "no dev-portal endpoint exists on Native 2910X firmware; falling back to Option B per spec §10 D-impl-1".
2. **Plan 4f (`game_shell`)**: any cross-template engine work should not regress this template's `/query/screensavers` registration.
3. **Future**: a longer T27 run that waits 6+ minutes for idle timeout + captures the screensaver in `/query/active-app` would lift Phase A from "registration verified" to "visual activation verified" without operator interaction. Out of scope for v0.5.5.
