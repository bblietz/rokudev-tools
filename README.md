# rokudev-tools

Unified Roku BrightScript developer toolkit. Three MCP servers, one shared library, one Claude Code plugin.

See `docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md` for the full design.

## Manual smoke against a real Roku

Set `ROKUDEV_DEFAULT_ROKU_HOST` and `ROKUDEV_ROKU_DEV_PASSWORD`, then run:

    pnpm build && node scripts/manual-smoke.mjs

## Manual BDP smoke against a real Roku

Set `ROKUDEV_DEFAULT_ROKU_HOST` and `ROKUDEV_ROKU_DEV_PASSWORD`, sideload a channel that's currently running in dev mode, then run:

    pnpm build && node scripts/manual-bdp-smoke.mjs

Exercises `debug_attach`, `debug_threads`, `debug_detach` against the active dev channel. Prints each tool result. Exits cleanly if BDP is reachable; surfaces `BDP_ATTACH_FAILED` if not.

## What's in v0.1 (Plan 1)

- `@rokudev/device-client` (TS library): RFC 2617 Digest auth, ECP HTTP, dev portal, telnet, SSDP discovery, registry, error taxonomy.
- `rokudev-device` (MCP, stdio): registry tools, ECP read/control, dev-portal sideload/unload/screenshot/genkey/rekey/sign/diff/registry/profiler/crashlog, telnet log_tail/log_stream, composite dev_loop, cross-package version check.

Not in this release: BDP debugger (Plan 2), generator + module merger (Plan 3), freeform/LSP (Plan 4), brs-docs (Plan 5), skills + plugin (Plan 6).

## What's in v0.2 (Plan 2)

- BDP debugger client in `@rokudev/device-client`: TCP framing, version negotiation, port fallback (8081 -> 8086), session lifecycle with state guard, BrighterScript `.brs.map` source-map handling, explicit dispose on resolvers.
- 15 new MCP tools in `rokudev-device`: `debug_attach`, `debug_detach`, `debug_session_state`, `debug_set_breakpoint`, `debug_clear_breakpoint`, `debug_list_breakpoints`, `debug_continue`, `debug_step`, `debug_step_over`, `debug_step_out`, `debug_pause`, `debug_stack_trace`, `debug_threads`, `debug_variables`, `debug_eval`.
- `debug_attach` surfaces `details.invalidated_breakpoints` for breakpoints carried over from a previous session that has since detached/exited (per spec §4.5.4).

Out of v0.2: conditional breakpoints, watch expressions, hot-reload (deferred per spec §4.5).

## What's in v0.3 (Plan 3)

- `brs-gen` MCP server (new): generates Roku channels from an `AppSpec` plus bundled templates and composable feature modules. Deterministic, byte-reproducible output; mandatory in-process `bsc` compile via `brighterscript`.
- 10 MCP tools: `list_templates`, `get_template_schema`, `list_modules`, `get_module_schema`, `generate_app`, `package_app`, `validate_manifest`, `validate_assets`, `spec_upgrade`, `lint`.
- 1 stub template: `stub_hello` (deliberately minimal; exercises the pipeline end-to-end).
- 1 stub module: `stub_label` (exercises every merger feature - file overlay, manifest patching, component patching, dependency injection).

Out of v0.3: real templates (Plan 4), real feature modules (Plan 5), freeform LLM path (Plan 6), LSP tools (Plan 7), `brs-docs` MCP (later plan), skills + plugin (later plan). No real-device verification gate in this plan - the stub channel is deliberately uninteresting; Plan 4 will add the first T27-style gate when real templates land.

## What's in v0.4 (Plan 4)

- First production-reference template: `video_grid_channel`. Hero + category rows + details + player. Consumes a Roku Direct Publisher JSON feed; plays via SceneGraph's `Video` node.
- `AppSpec` gains optional `branding.{icon, splash, primary_color}` and `content.{feed_url, feed_format}` fields.
- New `sharp`-based asset pipeline. User supplies one high-res PNG; brs-gen buckets it into Roku's HD/FHD/UHD sizes and injects the manifest keys.
- New `TemplateConfig()` BrightScript emitter at `source/_template/config.brs` exposes template-level AppSpec fields to runtime code.
- T27 real-device verification gate established (sideload, launch, navigate, playback). PASS evidence in spec Appendix A. Plans 4a-4e reuse the shared helpers in `scripts/_t27-lib.mjs`.

Out of v0.4: remaining v1 templates (`screensaver`, `news_channel`, `game_shell`, `blank_scenegraph`, `music_player`, each a follow-up plan); feature modules (Plan 5); freeform LLM path (Plan 6); LSP tools (Plan 7); `brs-docs` MCP (later plan).

## What's in v0.5.2 (Plan 4b.1)

Polish patch on `video_grid_channel` and the T27 real-device verification harness. Lands before scaffolding `news_channel` (Plan 4c) so the reference template's UX and test infra are honest.

- **Test infra: `screenshotNoError` now asserts `/query/active-app == 'dev'`** before its existing size heuristic. Catches the v0.5.1 false-positive class where Roku home, Debug overlay, or another foregrounded app sailed through the byte-size heuristic. Default-on with a `{assertForeground: false}` opt-out for failure-capture call sites.
- **Template: `video_grid_channel` HeroUnit Y-overlap fixed.** New layout inside the bottom scrim band (Y=280, height=170): title Y=290, synopsis Y=345, playButton Y=386. Button bottom sits exactly at scrim bottom (no overshoot).
- **Driver: `t27-video-grid.mjs` Phase B preamble** does a deterministic `sideloadAndLaunch` reset instead of `keypressRepeat('Back', 2)` (which could pop the channel out to Roku home).

Caveat: Plan 4b's reported T27 PASS for `video_grid_channel` was a false positive (Phase B preamble unwound to Roku home; system-UI screenshots passed the size heuristic). v0.5.2 corrects both the heuristic and the preamble.

No API changes to `@rokudev/device-client`, `rokudev-device`, or the `brs-gen` MCP tool surface.

(README has not been updated for v0.5.0 or v0.5.1; see GitHub release notes for those.)

## What's in v0.5.3 (Plan 4c)

Third v1 catalog template: `news_channel`. Hybrid live + on-demand news experience. Live HLS hero on the left, vertical category rail on the right, 3-column PosterGrid sub-screen per category.

- **Template: `news_channel`** with five SceneGraph components (MainScene, LiveHero, CategoryRail, CategoryGridScene, PlayerScene). No DetailsScene; Select on a clip plays it directly.
- **Bundled feed** at `pkg:/data/news-feed.json`: 5 categories x 21 demo clips cycling 3 AVideo demo URLs, plus a NASA TV public HLS endpoint for the live tile. Operator can override via `spec.content.feed_url`.
- **`AppSpec` content extension**: `content.live_label` (optional 1-12 char string; default "LIVE") for the LIVE-badge text. Threaded into runtime via `TemplateConfig().live_label`.
- **New init-hook export**: `CategoryGridScene/after_scene_show`. Modules can decorate the category grid header, inject overlays, etc.
- **Engine change**: one additive line in `generate-app.ts` propagates `content.live_label` into the emitted `TemplateConfig()`. No behavior change for existing templates.
- **Cross-component focus routing pattern** documented in `MainScene.bs`: directional keys at the Scene level + `findNode("list")` to focus the CategoryRail's inner `LabelList` (Group `setFocus` does not propagate to focusable descendants reliably). Mirrors the established `video_grid_channel` pattern.
- **T27 driver `t27-news.mjs`** with Phase A (bundled feed) and Phase B (live stream). Phase A PASS on Roku TV Native Build 2910X firmware 15.2.4. Phase B is environmentally constrained (NASA TV HLS handshake + state reset behavior on this firmware) and is documented as deferred per spec section 14.

Out of v0.5.3: shared component extraction across templates (Plan 5+); EPG/schedule overlays; multi-source live; per-category branding; real per-item thumbnail bundling.

## What's in v0.5.4 (Plan 4d)

Fourth v1 catalog template: `music_player`. A production-shaped audio channel with persistent playback across nav. Browse screen presents a 3-column PosterGrid of playlists; selecting a playlist opens a NowPlayingScene with album art, scrubber, and a 5-button transport row, starts playback at queue index 0, and queues the rest of the playlist's tracks. A persistent MiniBar on MainScene shows the current track + a play/pause toggle; backing out of NowPlaying does NOT stop playback.

- **Template: `music_player`** with four SceneGraph components (MainScene, NowPlayingScene, MiniBar, HttpTask).
- **Bundled feed** at `pkg:/data/music-feed.json`: 3 playlists x 6 tracks = 18 entries cycling 9 SoundHelix public-domain MP3s. Operator can override via `spec.content.feed_url`.
- **`AppSpec` content extension**: `content.service_name` (optional 1-20 char string; default = `spec.app.name`) for the "FROM <name>" header line on NowPlayingScene. Threaded into runtime via `TemplateConfig().service_name`.
- **New init-hook export**: `NowPlayingScene/after_scene_show`. Modules can hook here for track-played analytics events in Plan 5+.
- **Engine change**: one additive line in `generate-app.ts` propagates `content.service_name` into the emitted `TemplateConfig()`. No behavior change for existing templates.
- **Audio architecture**: MainScene owns the SceneGraph `Audio` node. NowPlayingScene receives the audioRef via a `node`-typed interface field at create time; observes state and position; writes control. Back from NowPlaying preserves playback (sticky MiniBar reads MainScene's state).
- **15 new PNG assets** generated deterministically via `gen-music-thumb.mjs` (3 playlist art + 12 transport bitmap icons). play-icon-{light,dark}.png are sha256-equal across all three image-using templates.
- **T27 driver `t27-music.mjs`** (Phase A: bundled feed). Phase B (operator feed-URL override) is deferred per spec section 9.

Out of v0.5.4: HLS audio / live radio; search; categories above playlists; shuffle/repeat; lyrics/equalizer; per-track art; library/favorites; sleep timer; multi-room cast; component sharing across templates (Plan 5+ concern).

## What's in v0.5.5 (Plan 4e)

Fifth v1 catalog template: `screensaver`. A pure-screensaver Roku channel (NOT a launchable app) that displays a deterministic 8-photo slideshow with Ken Burns motion + crossfade transitions. Manifest discipline is the load-bearing correctness invariant: the template emits ONLY the screensaver-registration keys (`screensaver_title`, `rsg_version=1.3`, `ui_resolutions`, version) and rigorously excludes every app-only key (`splash_color`, `splash_screen_*`, `mm_icon_focus_*`); presence of any of those would cause `/query/apps` to register the channel as `type=appl` instead of registering in `/query/screensavers`. The reference implementation at `/Users/bblietz/Work/ClaudeProjects/DevSummit-Screensaver-RokuTV` paid for this lesson at build 23 of its own iteration.

- **Template: `screensaver`** with three SceneGraph components (Screensaver, PhotoCycle, HttpTask).
- **Bundled feed** at `pkg:/data/screensaver-feed.json`: 8 entries pointing at `pkg:/images/sample-photo-{1..8}.jpg`. Operator can override via `spec.content.feed_url` (JSON list of photo URLs in `rokudev_screensaver_v1` format).
- **`AppSpec` content extension**: `content.feed_url` (optional URL), `content.feed_format` (literal `"rokudev_screensaver_v1"`), `content.transition_seconds` (int 4..30, default 7), `content.motion` (`'ken_burns' | 'crossfade_only' | 'none'`, default `'ken_burns'`). `transition_seconds` and `motion` are threaded into runtime via `TemplateConfig()`.
- **New init-hook export**: `Screensaver/after_scene_show`. Modules can hook here for photo-shown analytics events (observe `m.top.currentPhotoIndex`).
- **Engine changes**: two additive lines in `generate-app.ts` propagate `content.transition_seconds` and `content.motion` into emitted `TemplateConfig()`. New post-zip cert validator `SCREENSAVER_ZIP_TOO_LARGE` (template-conditional; only fires when manifest has `screensaver_title=`); fails > 4 MB, warns > 3.5 MB. New schema-side validator `SCREENSAVER_TITLE_CONTAINS_ROKU` rejects `spec.app.name` containing "roku" case-insensitive (cert rule). New engine behavior: `appSpec` now uses the strict-template-schema's parsed result downstream when the template ships a `schema.ts`, so per-template Zod defaults (like screensaver's `content` defaults) flow into TemplateConfig emission.
- **Entry point**: `sub RunScreenSaver()` (NOT `Main()`); includes `roAppMemoryMonitor` + `roDeviceInfo.EnableLowGeneralMemoryEvent` boilerplate per cert requirement effective 2026-10-01.
- **Anti-burn-in pixel-shift Animation**: +/-8px X, +/-5px Y, 90s `inOutQuad` loop on the photo Group (mined from reference repo's CountdownScreensaver.xml).
- **Two-poster pingpong + crossfade + Ken Burns**: PhotoCycle has 2 Posters (A/B), 4 Animations (crossfade, kenBurnsA, kenBurnsB, pixelShift), 1 Timer. Ken Burns Animation duration is locked to `transitionSeconds` so the pan completes exactly when the swap happens (prevents low-`transitionSeconds` pan-truncation bug).
- **8 deterministic 1920x1080 JPEGs** generated via `gen-screensaver-photos.mjs` (gradient + "Sample Photo N" text overlay). Sharp 0.34.5 with `mozjpeg: false` for byte-equality across runs. Total bundled image weight: ~288 KB.
- **T27 driver `t27-screensaver.mjs`** (Phase A: bundled feed). Verified on Roku Native 2910X firmware: registration via `/query/screensavers` passes (channel reports `id="dev"`). Option A (dev-portal HTTP trigger) is NOT available on this firmware; the T27 driver falls back to Option B (manual operator trigger) per spec section 10, D-impl-1. Visual activation verified manually (deferred per spec policy; same as `news_channel` Phase B).

Out of v0.5.5: per-photo metadata caption overlay (needs custom font work; deferred); schedule-aware screensavers; random shuffle (sequential cycle in v1); `screensaver_thumbnail_*` keys (status verified NOT required per `/query/screensavers` test); operator-configurable anti-burn-in shift parameters (locked at +/-8x, +/-5y, 90s); memory-pressure response (log-only in v1; v1.x will free texture caches).

## What's in v0.5.6 (Plan 4f)

Sixth and final v1 catalog template: `game_shell`. A regular Roku channel demonstrating the canonical state machine + Timer-driven game loop + D-pad input + registry-backed high-score pattern, composed of `Rectangle` + `Label` SceneGraph nodes only (zero bitmap sprites). Bundled reference game is **Pong**: classic 2-paddle table tennis with a CPU-controlled right paddle, deterministic AI lag, and per-difficulty handicap. Manifest is a standard app manifest (NOT pure-screensaver), with `screen_saver_private=1` to opt out of the OS screensaver during gameplay and `requires_audio_guide=0` declared explicitly. **v1 catalog COMPLETE: 6 of 6 templates shipped.**

- **Template: `game_shell`** with three SceneGraph components (`GameScene`, `Paddle`, `Ball`).
- **Pure-math collision/AI helpers** at `pkg:/source/lib/pong.bs` (5 functions: `Pong_StepCpu`, `Pong_StepBall`, `Pong_CollidePaddle`, `Pong_CollideWall`, `Pong_DifficultyToLagPx`) plus a module-level constant table (logical canvas = 1920x1080, top-left origin). Off-device Vitest coverage via TS shim at `tests/pong-helpers.ts`; constant parity asserted by `tests/pong-const-parity.test.ts`.
- **`AppSpec` content extension**: three new fields, all Zod-defaulted: `content.cpu_difficulty` (`'easy' | 'normal' | 'hard'`, default `'normal'`; CPU paddle tracking error: 60/25/5 px), `content.score_to_win` (int 1..21, default `5`), `content.high_score_persistence` (boolean, default `true`; gates `roRegistrySection("GameShell")` read/write).
- **New init-hook exports**: three at scope `GameScene`: `after_scene_show` (fires once from `init()` per Plan 4d's `NowPlayingScene/after_scene_show` pattern; NOT from `enterTitle()`), `after_game_start` (fires every transition into `playing`), `after_game_over` (fires every transition into `gameover` with `m.playerScore`/`m.cpuScore`/`m.highScore` available). Matches PRD §6.4 `game_shell` + `analytics.event_pipe` default module pairing.
- **Engine change**: three additive lines in `generate-app.ts` propagate `content.cpu_difficulty`, `content.score_to_win`, and `content.high_score_persistence` into the emitted `TemplateConfig()`. The local TypeScript `content` cast extended with the three new optional fields. No new validators, no new error or warning codes, no new shared engine surface. Zero behavior change for existing templates.
- **Manifest discipline**: standard app manifest (`screen_saver_private=1`, `requires_audio_guide=0`, standard icons/splash/splash_color/splash_min_time). Does NOT include `screensaver_title=`, so Plan 4e's template-conditional `SCREENSAVER_ZIP_TOO_LARGE` validator skips this template (verified in conflict-matrix tests).
- **Zero bundled bitmap assets**: gameplay scene is `Rectangle` + `Label` only. Eliminates Sharp/byte-equality concerns. Branding (icon + splash) reuses the existing `branding.{icon,splash}` AppSpec wrapper.
- **Runtime invariants discovered during T27**: `m.top.setFocus(true)` is mandatory in `init()` for Scenes with no focusable child (default-focus is unreliable on Roku Native 2910X firmware 15.2.4); ECP Select maps to `key="select"` (lowercase) on this firmware, not `key="OK"`. Both fixes are documented in `docs/t27-evidence/2026-05-15-game-shell-phase-a.md` and applied in the shipped template.
- **T27 driver `t27-game-shell.mjs`** (Phase A: bundled defaults). Verified on Roku Native 2910X firmware (10.128.160.39): sideload + launch + title render + Select-to-play + D-pad input + ball/paddle animation (SHA-256 differ proof) + Back-to-title (binding foreground gate). 11/11 steps PASS. Phase B (operator content override) deferred per spec §9.2.

Out of v0.5.6: audio (SFX bundle + `content.sfx_enabled`); gamepad input; multiplayer; additional bundled games (Snake, Memory, etc.); background music; difficulty-scaling AI during play; game-pause overlay; network leaderboard; Roku Pay integration in shell.
