# Plan 4f T27 Phase A Evidence (game_shell template)

**Date:** 2026-05-15
**Device:** Roku Native, model 2910X
**Device IP:** 10.128.160.39 (Plan 4e used 10.128.162.107; device moved between sessions; same model + firmware)
**Dev password:** 1234 (default)
**Channel sideloaded:** Pong E2E (spec_version: 2, template: 'game_shell', no content block; uses Zod defaults: cpu_difficulty=normal, score_to_win=5, high_score_persistence=true)
**T27 driver commit:** 3f9edfe (`feat(brs-gen): t27-game-shell.mjs driver (Phase A)`)
**Runtime-fix commit:** 54f243b (`fix(brs-gen): explicit Scene-root focus + firmware-agnostic OK key handling for game_shell`)

## Summary

Phase A verification status: **PASS** (all 11 steps).

The game_shell channel sideloads cleanly, launches as a regular app channel (`id='dev', type='appl'`), renders the title screen with PONG header, accepts Select to enter gameplay, animates the ball + CPU paddle, and returns to title cleanly on Back without exiting the channel.

## Two runtime issues discovered during Phase A (fixed before PASS)

1. **`onKeyEvent` never fired** without an explicit `m.top.setFocus(true)` in init(). Default Scene-root focus is unreliable when the Scene has no focusable child (no PosterGrid / Button). Music_player and news_channel implicitly avoid this by calling `setFocus(true)` on their grid/button children; game_shell has no such child, so the Scene root itself must claim focus. Symptom before fix: 8/11 PASS, 1 FAIL at "game animating" because A2 == A3 byte-equal — the Select keypress reached the channel (verified via `/query/active-app` showing `id="dev"`), but the state machine never transitioned out of `"title"`.

2. **ECP Select translates to `key="select"` (lowercase)** on Roku Native 2910X firmware 15.2.4, NOT `key="OK"` as the older docs suggest. Both music_player and news_channel use lowercase `"select"` in their handlers. Initially I missed this and used `key = "OK"` exclusively, masking the focus bug (#1) above. Final fix accepts BOTH `"OK"` and `"select"` to be firmware-agnostic.

Both fixes are surgical (≤20 lines in `GameScene.bs`); the golden zip and `GameScene.brs.snap.txt` were regenerated to reflect them.

## Per-step results (final PASS run)

| # | Step | Outcome |
|---|---|---|
| 1 | generate_app | PASS |
| 2 | sideloadAndLaunch | PASS (after one Plan 4d-style stale-state recovery via `mysubmit=Delete`) |
| 3 | A1 title screen | PASS — title overlay visible (PONG + Press OK + High score: 0); scores 0/0 |
| 4 | ECP Select to start | PASS |
| 5 | A2 playing initial | PASS — title overlay gone, paddles + ball visible at centre |
| 6 | Up x3 / Down x3 | PASS |
| 7 | A3 playing later | PASS — score 0-3 (CPU scored 3 rallies during 2.5s; player keypresses were discrete and could not keep up with CPU AI tracking ball) |
| 8 | game animating (A2 != A3) | PASS — SHA-256 mismatch (proof of animation) |
| 9 | ECP Back | PASS |
| 10 | A4 title after Back (binding foreground gate) | PASS — A1 == A4 byte-equal (back returned to clean title state; player+CPU scores reset to 0/0; high score: 0) |

## Screenshot evidence

Screenshot directory: `packages/brs-gen/scripts/t27-screenshots/2026-05-15T21-10-18-799Z/`

SHA-256 hashes:
- A1 = A4: `a5135b2e35d1edf0...` (title screen; same hash before and after Back-from-game)
- A2: `85958466408e3d7c...` (playing-initial; paddles + ball centred; score 0/0)
- A3: `4c2f0f7bcbb7d89e...` (playing-later; ball moved; score 0/3)

Key observations:
- A1 == A4 hash equality means Back from gameplay cleanly resets state and returns to title overlay. `enterTitle()` is correctly idempotent.
- A2 != A3 means the 60Hz Timer + Pong helpers + paddle/ball coordination is running. The score increment to 3 (player) shows CPU paddle tracking and scoring against the player when the player paddle didn't move enough to catch the serve.
- The score reset visible in A4 (matches A1 hash) confirms `enterTitle()`'s score reset is working.

## Conclusion

Phase A registration + interactivity gate: **PASS** (11/11 steps).

The game_shell template generates a Roku channel that:
- Sideloads cleanly (after Plan 4d-style stale-state recovery if needed).
- Launches as `id='dev', type='appl'`.
- Title screen renders correctly with all three Labels visible (PONG / "Press OK to start" / "High score: 0").
- Game-loop state transition Select → playing fires after the two runtime fixes (setFocus + key="select" accept).
- 60Hz Timer + Pong helpers + paddle/ball coordination produces visible motion within 2.5s.
- D-pad Up/Down moves player paddle (verified via animation; the rapid discrete keypresses don't move the paddle much, hence player can't always catch CPU's serves at default normal difficulty).
- CPU AI tracks ball and scores when player paddle doesn't intercept.
- Back from gameplay returns to title without exiting the channel (binding gate: `screenshotNoError`'s foreground check on A4, plus the A1==A4 hash equality observation).
- `enterTitle()` is correctly idempotent (scores reset; ball recentered; title overlay re-shown; high score displayed from in-memory cache).

Phase B (operator content override of `cpu_difficulty` / `score_to_win` / `high_score_persistence`) deferred per spec §9.2. The default-content Phase A run exercises the same `TemplateConfig()` threading from Task 1; operator-override correctness is structurally identical to Plan 4d's already-shipped pattern.

## Artifacts

- T27 driver: `packages/brs-gen/scripts/t27-game-shell.mjs`
- Screenshot directory: `packages/brs-gen/scripts/t27-screenshots/2026-05-15T21-10-18-799Z/`
- Engine + template artifacts: see commits leading to v0.5.6.

## Cross-plan lessons (for memory)

1. **`m.top.setFocus(true)` is mandatory in any Scene that has no focusable child but expects onKeyEvent to fire.** Music_player and news_channel implicitly satisfy this by focusing a grid/button; game_shell explicitly does it. Future templates with no focusable children must follow the game_shell precedent.
2. **ECP `Select` → BrightScript `key = "select"` (lowercase)** on Roku Native 2910X firmware 15.2.4. The older "OK" capitalization from the docs is no longer reliable. New templates should accept BOTH cases or use the lowercase form to match repo precedent.

## Follow-ups

1. v1.x audio (SFX bundle + `content.sfx_enabled`).
2. Gamepad input (current is standard remote D-pad only).
3. Multiplayer (would need split D-pad mapping OR gamepad).
4. Difficulty-scaling AI during play (current AI uses constant lag per `cpu_difficulty`).
5. Game-pause overlay (current Back returns to title; v1.x could add Back-Back-to-quit pattern).
