# Plan 4f: `game_shell` template design

> Status: draft for spec review, 2026-05-15.
> Parent spec: `docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md` (PRD).
> Related plans: Plan 3 (brs-gen engine), Plan 4 / 4b / 4b.1 (`video_grid_channel`), Plan 4a (`blank_scenegraph` + branding-defaults engine), Plan 4c (`news_channel` + cross-component focus routing pattern + Home + relaunch T27 preamble), Plan 4d (`music_player` + `content.service_name` engine thread), Plan 4e (`screensaver` + strict-template-schema downstream-data flow + template-conditional cert validators).
> Reference repo consulted (NOT mined for code; hand-authored Flappy-Bird-clone is informative only): `/Users/bblietz/Work/ClaudeProjects/FlappyBat-game-Roku/`. The reference repo's `CLAUDE.md` explicitly says "Do NOT use brs-mcp.generate_app... this channel is hand-authored" and FlappyBird IP is murky for a template; therefore Plan 4f ships a different (Pong) game.

## 1. Goal

Ship the sixth and final base template in the v1 catalog: `game_shell`. A regular Roku channel (NOT a screensaver) that demonstrates the canonical state machine (Title -> Playing -> Game-Over), real-time game loop (Timer-driven physics tick), input handling (D-pad continuous-while-held), score persistence (registry-backed high score), and AI opponent for any single-player casual game. The bundled reference game is **Pong**: classic 2-paddle table tennis with a CPU-controlled right paddle, composed of `Rectangle` and `Label` SceneGraph nodes only (zero bitmap sprites).

The template exists as the canonical scaffolding for any "casual game on Roku" use case: arcade ports, puzzle games, simple action games, party mini-games. The Pong implementation is the demo content (parallel to `screensaver`'s 8 photos and `music_player`'s 18 tracks); a developer who wants to ship Snake or Memory-Match keeps the shell (state machine, score persistence, input pattern) and replaces the gameplay-tick logic in `pong.brs` plus the `Ball`/`Paddle` components.

Plan 4f closes the v1 catalog (6 of 6 templates). It introduces no new shared engine surface beyond additive `TemplateConfig()` threading for three new `content` fields, and its manifest discipline is fully orthogonal to `screensaver`'s template-conditional validators.

## 2. Locked decisions (from brainstorming)

| # | Decision | Value | Source |
|---|---|---|---|
| D1 | Template choice | `game_shell` (the last v1 catalog template). | PRD §8.1 |
| D2 | Game archetype | **Pong**. Classic 2-paddle table tennis. Rationale: smallest possible asset set (zero bitmap sprites; pure `Rectangle` + `Label` nodes); no IP concerns; symmetric and broadly understood; demonstrates the full game-shell pattern (state machine + real-time tick + input + scoring + persistence + AI) in minimal LOC. | Q2 |
| D3 | Resolutions | `ui_resolutions=hd,fhd`. 1920x1080 logical canvas; HD scaling free via Roku. Mirrors all other v1 templates. | Q-auto-pick |
| D4 | Visual style | Minimalist arcade. Black background, white paddles (Rectangle 20x140), white ball (Rectangle 24x24), white dashed center line (10 short Rectangles), white score Labels (top-third, large mono-spaced via SystemFont). Zero PNG assets in the gameplay scene. | Q-auto-pick |
| D5 | Audio | NONE in v1. SFX (paddle/wall/score bounces) deferred to v1.x via future `content.sfx_enabled`. Sharp cannot generate audio; WAV asset pipeline is a separate plan. | Q-auto-pick |
| D6 | Input | Standard remote only. `Up`/`Down` (continuous while held; `keypress`/`keyup`); `OK`/`Select` to start; `Back` returns to title from gameplay (idempotent reset). No gamepad requirement. | Q-auto-pick |
| D7 | High-score persistence | Yes. `roRegistrySection("GameShell")`, key `"highScore"`. Read on title-screen `init`, written on game-over when player score > stored. Gated by `content.high_score_persistence` (default `true`). | Q-auto-pick |
| D8 | AppSpec `content` extensions | Three: `content.cpu_difficulty` (`'easy' \| 'normal' \| 'hard'`, default `'normal'`); `content.score_to_win` (int 1..21, default `5`); `content.high_score_persistence` (boolean, default `true`). All threaded via `TemplateConfig()`. | derived from D2-D7 |
| D9 | Manifest | Standard app manifest. Includes `screen_saver_private=1` (opts out of OS screensaver during gameplay) and `requires_audio_guide=0` (explicit no-audio-guide). | Q-auto-pick |
| D10 | SceneGraph components | Three: `GameScene` (root; state machine; Timer-driven game loop; key handler; high-score I/O); `Paddle` (player + CPU; `paddleY` + `side` interface fields); `Ball` (`ballX/ballY/vx/vy` interface fields). Pure-math collision in `source/lib/pong.brs` (testable off-device, mirrors FlappyBat's `physics.brs` pattern). No `HttpTask`. | Q-auto-pick |
| D11 | Bundled feed / data | None. Game is fully self-contained; no `data/` directory. | derived from D2 |
| D12 | Init-hook exports | Three, scope `GameScene`: `after_scene_show` (analytics: title shown), `after_game_start` (analytics: game started; `cpu_difficulty` from `m.top.cpuDifficulty`), `after_game_over` (analytics: game ended; `m.playerScore`, `m.cpuScore`, `m.highScore` available via observer). Matches PRD §6.4 default module pairing (`game_shell` + `analytics.event_pipe`). | derived from §5 architecture |
| D13 | Asset pipeline | Reuses existing `branding.{icon,splash}` AppSpec wrapper. User supplies one source PNG per asset; sharp buckets to HD/FHD. No new asset surface. | derived from D4 |
| D14 | Engine change | Three additive lines in `src/tools/generate-app.ts` propagate `content.cpu_difficulty`, `content.score_to_win`, `content.high_score_persistence` into the emitted `TemplateConfig()`. Existing `if (branding.primary_color || content || effectivePrimaryColor)` emission gate (widened in v0.5.3) already covers any `content` field. No behavior change for existing templates. | derived from D8 |
| D15 | Cert validators in brs-gen | NONE NEW. Plan 4e's `SCREENSAVER_*` validators are template-conditional and do not affect `game_shell`. Pong is small (no bitmap sprites; estimated < 200 KB zip including icon + splash); a generic `APP_ZIP_TOO_LARGE` validator is left for a future plan if/when cert size limits for non-screensaver apps become binding. | analysis (no cert rule violated by minimal scope) |
| D16 | Memory monitoring | Standard `Main()` entry point in `source/main.brs` with the standard message-pump loop. NOT the screensaver-specific `RunScreenSaver()` form. Memory monitoring boilerplate is OPTIONAL for app-style channels (cert requirement effective 2026-10-01 is screensaver-specific); we omit it for the shell to keep the demo minimal. Documented as a v1.x cookbook addition. | analysis (cert delta is screensaver-specific) |
| D17 | T27 strategy | Phase A: bundled defaults game, sideload + launch + key sequence + screenshot diff. Phase B (operator override of `cpu_difficulty` / `score_to_win`) deferred per spec policy (same as music_player + screensaver). | Q-auto-pick |
| D18 | Versioning | v0.5.6 (per-template patch convention; v1.0.0 reserved for full v1 release per PRD §8). | derived from cadence |

## 3. Non-goals

- **No audio.** SFX deferred to v1.x. Bundled audio would require a deterministic WAV pipeline (Sharp has no audio surface); separate plan.
- **No gamepad input.** Standard remote D-pad only. `roSGNode("Input")` + gamepad button translation deferred to v1.x.
- **No multiplayer.** Single-player vs. CPU only. Local 2-player would either need split D-pad mapping (awkward on a single remote) or gamepad (deferred).
- **No bitmap sprites.** All visual elements are `Rectangle` + `Label` nodes. Eliminates Sharp byte-equality concerns entirely (no `gen-game-assets.mjs` script; no `images/sample-*` payload).
- **No background music.** Same rationale as D5 audio.
- **No additional games (Snake, Memory, Tetris, etc.).** Pong is the demo content. Future games are either separate templates or cookbook examples.
- **No difficulty ramp during play.** CPU lag is a constant per `cpu_difficulty` setting. v1.x could ramp by score.
- **No game-pause overlay.** Back from gameplay returns to title (idempotent reset). v1.x could add explicit pause-on-Back with Back-Back-to-quit.
- **No remote-feed leaderboard.** High score is local-device-only via `roRegistrySection`. Network-backed leaderboards are out of scope (would require auth + analytics + network module composition).
- **No telemetry from the template itself.** Per PRD §8.5; `analytics.event_pipe` module subscribers add their own telemetry via the init-hook surface.
- **No Roku Pay integration in the shell.** `monetization.roku_pay.*` modules can be composed onto `game_shell` later; the shell itself ships no purchase flow.
- **No `RunScreenSaver()` entry.** This is an app, not a screensaver; standard `Main()` entry. (Trivially: the screensaver template's `RunScreenSaver` boilerplate is in `templates/screensaver/`; `game_shell` does not import or share that path.)

## 4. Manifest (template-emitted)

```
title=<%= spec.app.name %>
major_version=<%= spec.app.major_version %>
minor_version=<%= spec.app.minor_version %>
build_version=<%= spec.app.build_version %>
ui_resolutions=hd,fhd
mm_icon_focus_hd=pkg:/images/icon_hd.png
mm_icon_focus_fhd=pkg:/images/icon_fhd.png
splash_screen_hd=pkg:/images/splash_hd.png
splash_screen_fhd=pkg:/images/splash_fhd.png
splash_color=#000000
splash_min_time=1500
screen_saver_private=1
requires_audio_guide=0
```

**Notes on each key:**
- `title` / `major_version` / `minor_version` / `build_version`: standard, EJS-interpolated from `spec.app.*`.
- `ui_resolutions=hd,fhd`: matches all v1 templates.
- `mm_icon_focus_*` / `splash_screen_*`: standard app-channel icon + splash. NOT forbidden (game_shell is an app, not a screensaver).
- `splash_color=#000000`: matches the in-game black background.
- `splash_min_time=1500`: short splash to bridge boot to title screen.
- `screen_saver_private=1`: opts out of OS-level screensaver during gameplay (cert recommendation for active-input apps).
- `requires_audio_guide=0`: explicit no-audio-guide declaration.

**No `screensaver_title=` key.** This is the load-bearing distinction from Plan 4e: the absence of `screensaver_title` ensures `SCREENSAVER_ZIP_TOO_LARGE` validator does not fire (per Plan 4e §14 template-conditional check). The channel registers as `type=appl` in `/query/apps` (correct for an app).

**Validators:** None new. The schema-side `app.name` length limit (1..50) inherited from the wrapper schema is sufficient.

## 5. Components

### 5.1 Layout

```
templates/game_shell/
  template.toml
  schema.ts
  files/
    manifest.ejs
    source/
      main.brs                          # sub Main() + standard message pump
      lib/
        pong.brs                        # pure-math collision + AI helpers (testable off-device)
    components/
      GameScene.xml                     # extends Scene; root; state machine; game loop
      GameScene.bs                      # init, key handler, Timer callback, score I/O
      Paddle.xml                        # extends Group; inner pipeColumn-style Rectangle
      Paddle.bs                         # init, paddleY interface field mirror
      Ball.xml                          # extends Group; inner Rectangle
      Ball.bs                           # init, position interface field mirror
```

### 5.2 `GameScene` (root scene)

- Extends `Scene`.
- Children: 1 `Rectangle` (background, full-screen, fill `#000000`); 10 `Rectangle`s (dashed center line, 4x18 each, vertically distributed); 1 `Paddle` (player, side="left", id `playerPaddle`); 1 `Paddle` (CPU, side="right", id `cpuPaddle`); 1 `Ball` (id `ball`); 2 `Label`s (player score, CPU score; mono-spaced; top quarter); 1 `Group` for the title-screen overlay (1 Label "PONG", 1 Label "Press OK to start", 1 Label "High score: <N>", visible iff `m.state = "title"`); 1 `Group` for game-over overlay (1 Label "GAME OVER", 1 Label "Press OK for new game", visible iff `m.state = "gameover"`); 1 `Timer` (id `tick`, repeat=true, duration=1.0/60.0, control="stop" until game starts).
- Public interface fields (read-only from outside): `cpuDifficulty as string` (mirrors AppSpec `content.cpu_difficulty`), `scoreToWin as integer` (mirrors `content.score_to_win`), `highScorePersistence as boolean` (mirrors `content.high_score_persistence`).
- Internal state on `m`: `m.state as string` in `{"title", "playing", "gameover"}`; `m.playerScore as integer`; `m.cpuScore as integer`; `m.highScore as integer`; `m.upHeld as boolean`; `m.downHeld as boolean`; `m.cpuLagPx as integer` (derived from `cpuDifficulty`).
- `init()` reads `TemplateConfig()` to populate the public iface fields; reads high score from registry if `highScorePersistence`; calls `enterTitle()`; THEN calls `Modules_OnGameSceneAfterSceneShow(m)` (the hook fires from `init()`, NOT from `enterTitle()` -- this matches Plan 4d's `NowPlayingScene/after_scene_show` pattern of "hook fires once on scene init, not on every state transition into title").
- `enterTitle()`: idempotent. Stops `m.tick`. Resets scores. Centers ball + paddles. Shows title overlay; hides game-over overlay. Sets `m.state = "title"`. Does NOT call `after_scene_show` (that's `init()`'s responsibility per the line above).
- `enterPlaying()`: idempotent. Hides title + game-over overlays. Resets ball position; randomizes initial `vx` direction (toward player or CPU based on a deterministic-looking seed: `m.servesPlayed` parity). Starts `m.tick`. Sets `m.state = "playing"`. Calls `Modules_OnGameSceneAfterGameStart(m)`.
- `enterGameOver()`: idempotent. Stops `m.tick`. Hides title; shows game-over overlay. Computes high-score update and writes to registry if `highScorePersistence` and `m.playerScore > m.highScore`. Sets `m.state = "gameover"`. Calls `Modules_OnGameSceneAfterGameOver(m)`.
- `onKeyEvent(key, press)`: state-guarded.
  - `m.state = "title"`: `OK` press -> `enterPlaying()`. `Back` returns false (Roku exits channel).
  - `m.state = "playing"`: `Up` press -> `m.upHeld = true`. `Up` release -> `m.upHeld = false`. Same for `Down`. `Back` press -> `enterTitle()`. `OK` ignored.
  - `m.state = "gameover"`: `OK` press -> `enterTitle()`. `Back` press -> `enterTitle()`.
  - All other keys ignored.
- `onTick()` (fires at 60 Hz when `m.state = "playing"`):
  - State-guard: if `m.state <> "playing"` return immediately (defense-in-depth against late-firing Timer events; mirrors FlappyBat's `enterGameOver` ordering pattern).
  - Read player input: if `m.upHeld` move `m.playerPaddle.paddleY -= PADDLE_SPEED_PX_PER_TICK`; if `m.downHeld` move down. Clamp to bounds.
  - Update CPU: `Pong_StepCpu(m.cpuPaddle.paddleY, m.ball.ballY, m.cpuLagPx)` returns the new `paddleY`.
  - Update ball: `Pong_StepBall(m.ball.ballX, m.ball.ballY, m.ball.vx, m.ball.vy)` returns `{ballX, ballY, vx, vy, scored: ""}`. The `scored` string is `""` (no score this tick), `"player"` (player wall scored), or `"cpu"` (cpu wall scored).
  - Apply collisions with paddles: `Pong_CollidePaddle(ball, paddle)` returns updated `vx`/`vy` if collision detected this tick (and only on the moving-toward-paddle frame to prevent stick-collision bugs).
  - Apply collisions with top/bottom walls: `Pong_CollideWall(ball)` flips `vy`.
  - Write back to interface fields: `m.ball.ballX/ballY/vx/vy`, `m.cpuPaddle.paddleY`, `m.playerPaddle.paddleY`.
  - If `scored = "player"`: `m.playerScore += 1`; reserve ball; if `m.playerScore >= m.scoreToWin` -> `enterGameOver()`; else continue.
  - If `scored = "cpu"`: same with `m.cpuScore`.
  - Update score Labels.

### 5.3 `Paddle`

- Extends `Group`.
- Public iface fields: `paddleY as float` (vertical position; observed by GameScene only for read-back consistency, written by GameScene as the source of truth; mirrors FlappyBat `pipeX` pattern); `side as string` (`"left"` or `"right"`; set once at create-time by GameScene's children, then immutable).
- Internal: 1 `Rectangle` (id `paddleRect`, width=20, height=140, fill `#FFFFFF`).
- `init()` sets `m.paddleRect = m.top.findNode("paddleRect")`; observes `m.top.paddleY` to mirror onto `m.paddleRect.translation`.
- `onPaddleY()` callback: `m.paddleRect.translation = [<sideX>, m.top.paddleY]`. The `sideX` is computed once at init from `m.top.side`: `40` for left, `1860` for right (paddle is 20 wide; 20px margin from screen edge).

### 5.4 `Ball`

- Extends `Group`.
- Public iface fields: `ballX as float`, `ballY as float`, `vx as float`, `vy as float`. GameScene writes; Ball mirrors `ballX`/`ballY` onto inner Rectangle translation.
- Internal: 1 `Rectangle` (id `ballRect`, width=24, height=24, fill `#FFFFFF`).
- `init()`: caches `m.ballRect`; observes `ballX` and `ballY` (single coalesced callback `onBallPos` updates both axes).

### 5.5 `pong.brs` (pure helpers; lib)

Pure-math, no SG references, no `m.*`. Unit-testable off-device via TS shim (see §10 + §14 R7).

**Coordinate system contract (load-bearing for all five helpers):**
- Origin: top-left of the 1920x1080 logical canvas. `+x` is rightward, `+y` is downward (matches SceneGraph translation semantics).
- All `*X`/`*Y` parameters are positions of the node's top-left corner (NOT centroid).
- Logical canvas constants live IN `pong.brs` as module-level constants:
  - `PONG_SCREEN_W% = 1920`, `PONG_SCREEN_H% = 1080`
  - `PONG_PADDLE_W% = 20`, `PONG_PADDLE_H% = 140`
  - `PONG_BALL_SIZE% = 24`
  - `PONG_PADDLE_SPEED_PX% = 12` (per-tick player paddle delta; CPU is capped at 1.2x per R1)
  - `PONG_BALL_VX_INITIAL! = 9.0`, `PONG_BALL_VY_INITIAL! = 4.5`
- These constants are mirrored verbatim into the TS shim at `tests/templates/pong-helpers.ts` (sidecar; reviewed in same PR per R7).

**Function signatures and contracts:**

```brightscript
' Returns updated paddleY for CPU side. Tracks ballY toward paddle centre, lagged by lagPx.
' CPU paddle delta is capped at 1.2 * PONG_PADDLE_SPEED_PX per tick (R1 mitigation).
function Pong_StepCpu(currentPaddleY as float, ballY as float, lagPx as integer) as float

' Advances ball position by (vx, vy). DOES NOT perform wall or paddle collision -- caller
' invokes Pong_CollideWall and Pong_CollidePaddle separately. Tests left/right SCREEN edges
' for scoring; returns scored="player" if ball passed left edge (CPU scored on player wall),
' "cpu" if passed right edge, "" otherwise. Returns assocArray:
'   { ballX as float, ballY as float, vx as float, vy as float, scored as string }
function Pong_StepBall(ballX as float, ballY as float, vx as float, vy as float) as object

' Detects rect-vs-rect overlap. Returns updated {vx, vy} ONLY on the moving-toward-paddle
' frame (i.e., paddleX > ballX and vx > 0 means ball is approaching right paddle and may
' have entered it; reflect vx). Returns vy nudged by (ballCentreY - paddleCentreY) / (PADDLE_H/2)
' to give "english". Returns the SAME {vx, vy} unchanged when (a) no overlap, OR (b) overlap
' but ball is moving away from paddle (prevents stick-collision: if ball is inside the paddle
' for >1 tick, only the first frame reflects). Returns assocArray { vx as float, vy as float }.
function Pong_CollidePaddle(ballX as float, ballY as float, vx as float, vy as float, paddleX as float, paddleY as float) as object

' Detects ball-vs-wall (top OR bottom). If ballY <= 0 or ballY + PONG_BALL_SIZE >= screenH,
' returns -vy (flipped). Otherwise returns vy unchanged.
function Pong_CollideWall(ballY as float, vy as float, screenH as integer) as float

' Maps 'easy' -> 60, 'normal' -> 25, 'hard' -> 5. Unknown values fall back to 25.
function Pong_DifficultyToLagPx(difficulty as string) as integer
```

All five functions are deterministic (no `Rnd()`, no time reads). Initial serve direction in `enterPlaying()` uses parity of `m.servesPlayed` (deterministic; even = serve toward CPU, odd = serve toward player).

**Stick-collision invariant (also restated in `Pong_CollidePaddle` comment above):** the helper -- not the caller -- owns the "only reflect on approaching-frame" check. Caller can invoke `Pong_CollidePaddle` every tick without disciplining. This keeps `onTick` orchestration simple.

### 5.6 Init-hook exports

Three exports, scope `GameScene`. Signature `(m as object) as void`. Module authors read `m.top.cpuDifficulty`, `m.playerScore`, `m.cpuScore`, `m.highScore` as needed.

- `after_scene_show` (file `components/GameScene.bs`): fires once on boot after `init()` completes the first `enterTitle()`. Module use case: emit a "channel opened" analytics event.
- `after_game_start` (file `components/GameScene.bs`): fires every time `enterPlaying()` runs. Module use case: emit "game started" with `cpu_difficulty` and `score_to_win` context.
- `after_game_over` (file `components/GameScene.bs`): fires every time `enterGameOver()` runs. Module use case: emit "game over" with `m.playerScore`, `m.cpuScore`, `m.highScore`, `winner` (player vs cpu).

The `after_scene_show` hook fires ONCE per channel boot (NOT every Back-to-title) to match analytics-pipe expectations (Sessions vs. Page Views). `after_game_start` and `after_game_over` fire every transition.

## 6. AppSpec content extension

`templates/game_shell/schema.ts` (new file). Strict template schema with Zod defaults so they flow downstream per Plan 4e Task 11 fix.

```typescript
import { z } from 'zod';
import { AppSpecBaseSchema } from '../../src/spec/wrapper.js';

const GameShellContentSchema = z.object({
  cpu_difficulty: z.enum(['easy', 'normal', 'hard']).default('normal'),
  score_to_win: z.number().int().min(1).max(21).default(5),
  high_score_persistence: z.boolean().default(true),
}).strict().default({});

export const GameShellSpecSchema = AppSpecBaseSchema.extend({
  template: z.literal('game_shell'),
  content: GameShellContentSchema,
}).strict();
```

Three fields, all defaulted; `content` itself defaults to `{}` so a bare-spec generate works.

## 7. Engine changes

Three additive lines in `src/tools/generate-app.ts`, mirroring Plan 4d's pattern:

```typescript
if (content?.cpu_difficulty) cfg['cpu_difficulty'] = String(content.cpu_difficulty);
if (content?.score_to_win !== undefined) cfg['score_to_win'] = String(content.score_to_win);
if (content?.high_score_persistence !== undefined) cfg['high_score_persistence'] = String(content.high_score_persistence);
```

The `String(<number/bool>)` conversion is consistent with how `transition_seconds` is threaded in Plan 4e. The runtime `TemplateConfig()` returns associative-array entries as strings; `GameScene.bs` parses with `CreateObject("roInt", ...)` / boolean checks as needed.

The existing emission gate `if (branding.primary_color || content || effectivePrimaryColor)` (widened in v0.5.3 to fire on any `content` field) already covers all three. No new emission gate needed.

**Always-emitted property:** because §6's schema declares `.default(...)` for all three fields AND because Plan 4e's strict-template-schema downstream-data flow (`appSpec = strict.data`) populates them post-parse, all three fields will ALWAYS be defined when the engine reaches the threading lines. This means `cpu_difficulty=normal`, `score_to_win=5`, `high_score_persistence=true` will appear in `TemplateConfig()` for every `game_shell` channel -- even on a bare spec with no `content` block. The e2e golden zip's `config.brs` will therefore be non-trivial even on the canonical no-content spec. This is desired (defaults are explicit at runtime) but worth knowing for snapshot test authors.

The implementation also requires extending the local TypeScript `content` cast in `generate-app.ts` (currently spans `feed_url`, `feed_format`, `live_label`, `service_name`, `transition_seconds`, `motion`) to include the three new fields. This is a mechanical edit alongside the 3 threading lines; not a separate engine surface.

**No new validators, no new error codes, no new warning codes.**

## 8. Bundled assets

- **No bitmap sprites.** Gameplay scene is `Rectangle` + `Label` only.
- **No data/ feed.** Game is fully self-contained.
- **App icon (`mm_icon_focus_hd/fhd`)** and **splash (`splash_screen_hd/fhd`)** come from the standard `branding.{icon,splash}` AppSpec wrapper. If user does not provide them, the existing branding-defaults engine (Plan 4a) emits a black placeholder. No new asset surface.

This is a deliberate scope reduction relative to Plans 4a/4c/4d/4e (which ship bundled assets); it makes Plan 4f the smallest template by far in terms of payload size and lint surface.

## 9. T27 strategy

`scripts/t27-game-shell.mjs` (new file).

### 9.1 Phase A: bundled defaults

Canonical spec: `template: 'game_shell'`, no `content` block (uses Zod defaults: `cpu_difficulty='normal'`, `score_to_win=5`, `high_score_persistence=true`).

Steps:
1. `generate_app` (uses `regen-helper.mjs` for parity with other T27 drivers).
2. `sideloadAndLaunch` (game launches as a regular app channel; `id='dev'`, `type='appl'`).
3. `assertActiveAppIsOurs(host)` (default mode; no `screensaverMode` opt).
4. `screenshotNoError` -> `A1-title.png` (title screen showing "PONG" + "Press OK to start" + "High score: 0").
5. ECP `keypress('Select')` to start; `sleep(1500)` for state transition.
6. `screenshotNoError` -> `A2-playing-initial.png` (paddles + ball at center; scores 0-0).
7. ECP `keypress('Up')` x3 with `delay_ms=100` between (move player paddle up); `sleep(500)`.
8. ECP `keypress('Down')` x3 with `delay_ms=100`; `sleep(500)`.
9. `sleep(2500)` to let ball travel + bounce + potentially score a few times.
10. `screenshotNoError` -> `A3-playing-later.png`.
11. SHA-256 compare A2 vs A3; assert different (game is animating).
12. ECP `keypress('Back')` to return to title; `sleep(1000)`.
13. `screenshotNoError` -> `A4-title-after-back.png` (title overlay shown again). The `screenshotNoError` call is itself the binding "Back returns to title without exiting channel" gate -- its built-in `assertActiveAppIsOurs` foreground check fails if Back accidentally exited the channel to Roku Home. We do NOT byte-compare A1 vs A4 because the high-score Label may have updated mid-game; the foreground-check + size heuristic inside `screenshotNoError` is the binding gate. (Step 13 is therefore load-bearing, not redundant.)

### 9.2 Phase B: operator-override of `cpu_difficulty` / `score_to_win`

DEFERRED per spec policy (matches `news_channel`, `music_player`, `screensaver` Phase B deferrals). The Phase A `cpu_difficulty='normal'` + `score_to_win=5` defaults exercise the same `TemplateConfig()` thread; operator-override correctness is structurally identical to Plan 4d's already-shipped pattern.

### 9.3 Failure-capture screenshot

If any Phase A step throws, the `catch` block calls `screenshotNoError(host, password, 'zz-failure.png', { assertForeground: false })` to capture device state without the foreground check shadowing the original failure. Mirrors Plan 4e's pattern.

## 10. Tests

All under `packages/brs-gen/`.

- **Snapshot tests** (`tests/__golden__/game_shell/`): EJS-rendered manifest snapshot; rendered `GameScene.xml`/`GameScene.bs`; rendered `Paddle.xml`/`Paddle.bs`; rendered `Ball.xml`/`Ball.bs`; rendered `pong.brs` (verbatim). Pattern matches Plan 4e Task 4 (full-pipeline snapshot per file).
- **e2e golden zip** (`tests/e2e/game-shell.test.ts`): canonical spec -> generate -> zip -> assert byte-equal against checked-in golden zip; assert `bsc` lint clean; assert `validate_manifest` passes; assert `validate_assets` passes for the branding placeholders.
- **Schema tests** (`tests/templates/game-shell-schema.test.ts`): default content; explicit content with each `cpu_difficulty` value; `score_to_win` boundary (1, 21, reject 0, reject 22); `high_score_persistence` boolean coercion.
- **Engine tests** (`tests/tools/generate-app.test.ts`): add 3 game_shell coverage entries to the existing test matrix:
  - bare spec (no content) -> generates clean (uses defaults).
  - `content.cpu_difficulty='hard'` -> emits `cpu_difficulty=hard` in `TemplateConfig()`.
  - `content.score_to_win=10` -> emits `score_to_win=10` in `TemplateConfig()`.
  - `content.high_score_persistence=false` -> emits `high_score_persistence=false` in `TemplateConfig()`.
- **Conflict-matrix entry** (`tests/build/conflict-matrix.test.ts`): add `game_shell` row to verify file-overlay, manifest-patching, component-patching cross-template no-conflicts (mirrors Plan 4e Task 13).
- **Determinism entry** (`tests/build/determinism.test.ts`): two consecutive generates produce byte-equal zips.
- **Pure helpers unit tests** (`tests/templates/pong-helpers.test.ts`): off-device Vitest tests of `Pong_StepCpu`, `Pong_StepBall`, `Pong_CollidePaddle`, `Pong_CollideWall`, `Pong_DifficultyToLagPx`, executed against the TS shim at `tests/templates/pong-helpers.ts` (verbatim translation of `pong.brs`; smallest dependency surface; matches the project's existing pattern of "pure-math helpers tested in TS, BRS-side covered by snapshot + lint + e2e").
- **Const parity test** (`tests/templates/pong-const-parity.test.ts`): parses the BRS const block at the top of `templates/game_shell/files/source/lib/pong.brs` (regex extraction of `PONG_*% = N` and `PONG_*! = N.M` lines) and asserts numeric equality with the TS shim's exported constants. Catches the most common R7 drift class.

## 11. File layout summary (new files)

```
packages/brs-gen/templates/game_shell/
  template.toml                                   # template metadata + manifest_defaults + exports
  schema.ts                                       # GameShellSpecSchema (Zod, strict)
  files/
    manifest.ejs                                  # standard app manifest per §4
    source/
      main.brs                                    # sub Main() + standard message pump
      lib/
        pong.brs                                  # 5 pure helpers per §5.5
    components/
      GameScene.xml                               # 17-children scene (paddles, ball, scores, overlays, timer)
      GameScene.bs                                # state machine, key handler, tick callback, registry I/O
      Paddle.xml                                  # 1-Rectangle inner
      Paddle.bs                                   # paddleY mirror
      Ball.xml                                    # 1-Rectangle inner
      Ball.bs                                     # ballX/ballY mirror

packages/brs-gen/scripts/
  t27-game-shell.mjs                              # T27 driver per §9

packages/brs-gen/tests/__golden__/game_shell/
  game-shell.zip                                  # byte-equal e2e golden
  manifest.snap                                   # rendered manifest
  GameScene.xml.snap, GameScene.bs.snap           # rendered scene
  Paddle.xml.snap, Paddle.bs.snap                 # rendered paddle
  Ball.xml.snap, Ball.bs.snap                     # rendered ball
  pong.brs.snap                                   # verbatim pong helpers
  main.brs.snap                                   # verbatim main

packages/brs-gen/tests/templates/
  game-shell-schema.test.ts                       # Zod schema coverage
  pong-helpers.ts                                 # TS shim (verbatim translation of pong.brs)
  pong-helpers.test.ts                            # pure-helper unit tests against the TS shim
  pong-const-parity.test.ts                       # parses pong.brs const block; asserts shim parity

packages/brs-gen/tests/e2e/
  game-shell.test.ts                              # generate + zip + lint + validate

docs/t27-evidence/
  2026-05-15-game-shell-phase-a.md                # T27 evidence per §9 (created post-run)
```

Modifications to existing files:
- `packages/brs-gen/src/tools/generate-app.ts`: 3 additive `TemplateConfig()` threading lines per §7.
- `packages/brs-gen/tests/tools/generate-app.test.ts`: 4 new coverage entries per §10.
- `packages/brs-gen/tests/build/conflict-matrix.test.ts`: 1 new row per §10.
- `packages/brs-gen/tests/build/determinism.test.ts`: 1 new entry per §10.
- `README.md`: v0.5.6 release notes appended at END (ASCENDING order; per Plan 4e lesson).
- `package.json` files (root + `packages/brs-gen/package.json`): version bump to `0.5.6`.
- `MEMORY.md` topic-file pointer + status block update; new `plan-4f-game-shell.md` topic file.

## 12. Cert checklist

Roku Channel Store cert (from public docs and reference repo's `CERT_CHECKLIST.md`-style enumeration):

- ✓ `screen_saver_private=1` (opts out of OS screensaver during gameplay; cert recommendation for active-input apps).
- ✓ `requires_audio_guide=0` (declares no audio guide; cert wants explicit value).
- ✓ Splash screen present (`splash_screen_hd/fhd` + `splash_color` + `splash_min_time`).
- ✓ Channel icon present (`mm_icon_focus_hd/fhd`).
- ✓ Back from gameplay returns to title (no "Are you sure?" dialog needed; cert allows direct return-to-title for casual games).
- ✓ Pause-on-blur is automatic via SceneGraph (Scene's `Application.suspend` event handles foreground/background transitions; we do NOT need explicit code because `m.tick` is owned by the Scene and pauses with it).
- ✓ No external network calls (game is fully self-contained); no ToS consent flow needed.
- ✓ No PII collected (high score is a single integer in `roRegistrySection("GameShell")`).
- ✓ No animated content during boot (splash is static color).
- ✓ Game responds to D-pad + Select within 100 ms of input (state machine is synchronous; `onTick` fires every 16 ms; input handlers run on the Scene thread).

NOT shipped in v1 (deferred to v1.x):
- Cert-required memory monitoring (`roAppMemoryMonitor`): per D16, this is screensaver-specific in the 2026-10-01 cert update. App-style channels can opt in but it is not required. Document in topic file as a v1.x cookbook addition.
- `CERT_CHECKLIST.md.ejs` per-channel emission: tracked as cross-template polish; benefits all templates (carried over from Plan 4e).

## 13. Engine surface to lock for future template / module coexistence

Per Plan 4e §14 pattern, document what this template introduces and confirm no cross-template regression risk:

- **`SCREENSAVER_ZIP_TOO_LARGE`** (Plan 4e validator): template-conditional (probes manifest for `screensaver_title=`). `game_shell` manifest has no `screensaver_title`, validator skips. ✓ No regression.
- **`SCREENSAVER_TITLE_CONTAINS_ROKU`** (Plan 4e validator): lives in `templates/screensaver/schema.ts`; never sees `game_shell`. ✓ No regression.
- **Strict-template-schema downstream-data flow** (Plan 4e Task 11 fix): `templates/game_shell/schema.ts` declares `content.default(...)` for all three fields; engine's `appSpec = strict.data` means defaults flow into `TemplateConfig()` for the bare-spec case (no `content` block). Beneficial. ✓
- **`TemplateConfig()` threading**: 3 additive lines for `cpu_difficulty`, `score_to_win`, `high_score_persistence`. Existing emission gate covers any `content` field. ✓ No regression for other templates.
- **Wrapper-schema `content.feed_format` enum** (Plan 4c, Plan 4e narrowness): `game_shell` does not use `content.feed_format` (no remote feed), so the enum narrowness is irrelevant here. The wrapper schema's passthrough for `content` is sufficient. ✓
- **Init-hook scope `GameScene`**: net-new scope. Module merger's hook wiring is generic over scope name; no shared registry needs updating. ✓

**No new shared engine surface introduced.** No new validators. No new error codes. No new warning codes. No new shared modules touched. No new `src/spec/` fields.

This makes Plan 4f the most surgically-minimal of the v1 catalog template plans.

## 14. Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Pong's CPU AI may feel "rubber-band" on hard difficulty (5px lag is near-perfect; ball wraps faster than paddle can keep up at high `vx`). | Cap CPU paddle speed at 1.2x player paddle speed; document as "hard is meant to be a fair challenge, not unbeatable." Out of plan-test scope; v1.x cookbook item if testers flag. |
| R2 | Initial serve direction is parity-based (deterministic) -- predictable from frame 0 may feel "rigged" to repeat players. | Document as "demo-grade determinism." V1.x can swap to `Rnd()`-seeded once we add a `roRandom`-style helper; out of v0.5.6. |
| R3 | Continuous-while-held key tracking via `keypress`/`keyup` may have OS-specific behavior on older RokuOS firmwares (key auto-repeat semantics changed across versions). | Phase A T27 verifies on Native 2910X firmware (current target device). Document any observed firmware-specific behavior in T27 evidence. Fallback: poll `roDeviceInfo` keyboard state per tick (slower but more portable). |
| R4 | `Rectangle` rendering performance at 60 Hz Timer + 17 children may surface frame-drop on lower-tier Rokus (e.g., Express 4K). | The scene has 17 nodes + 1 ball move per tick. SceneGraph compositing handles this trivially on FHD-capable Rokus. Phase A T27 captures real-device behavior; if frame-drop observed, the fix is to reduce Timer frequency to 30 Hz (no scope change). |
| R5 | High-score registry write may fail silently if storage is full (rare). | Use `try`/`catch` around `roRegistry.Flush()`; on failure, keep `m.highScore` in memory only. No user-visible regression. |
| R6 | `screen_saver_private=1` may conflict with parent Roku UX expectations (e.g., user expects Roku to screensaver after 5 min of paused game on title screen). | This is a deliberate cert recommendation for active-input apps, not a universal best practice. Game on title screen is user-paused, not active gameplay. Acceptable trade-off; future v1.x could time-out to OS screensaver after N minutes on title (out of scope). |
| R7 | Pong helpers in `pong.brs` are duplicated as TS shims for off-device unit testing (per §10). Drift risk between BRS and TS implementations. | All numeric constants (paddle/ball dimensions, speeds, screen size, lag-px-per-difficulty mapping) are declared as module-level constants in `pong.brs` per §5.5; the TS shim at `tests/templates/pong-helpers.ts` mirrors them verbatim and is reviewed in the same PR. Snapshot test `pong.brs.snap` catches BRS-side drift; the TS shim's unit tests catch TS-side drift; an additional const-parity test (`pong-const-parity.test.ts`) parses the BRS const block and asserts numeric equality with the TS shim's exported constants. Acceptable for v1; v1.x could use `roca` or `bs-runner` for true BRS unit tests. |
| R8 | The reference repo (`FlappyBat-game-Roku`) is hand-authored, not template-driven; consulted but NOT mined for code. Risk that we miss a battle-tested pattern (e.g., the FlappyBat `state` machine + `enterX` triplet, the `m.lastAnimState` debounce). | Plan 4f's GameScene state machine + enterX triplet IS modeled on FlappyBat's pattern (best practice; common to game architecture). The Animation-debounce pattern is FlappyBat-specific (PipePair animations); Pong has no such Animation -- collision is Timer-driven. No transferable risk surface. |

## 15. PRD obligations

- PRD §3.1 templates: this plan adds the sixth and final v1 template. Closes the `templates/` v1 deliverable.
- PRD §3.6 mandatory `bsc` lint: applies. e2e golden test asserts lint clean.
- PRD §3.7 brs-gen tool surface: no new tools; uses existing `generate_app`, `package_app`, `lint`, `validate_manifest`, `validate_assets`.
- PRD §6.4 `roku-vibe` disambiguation table: row "game" -> `game_shell` + `analytics.event_pipe` becomes a real path. Currently fails because the template does not exist; this plan resolves that for that row.
- PRD §8.1 v1 shipping list: ticks "game_shell" off the 6-template requirement. **6 of 6 after this plan; v1 catalog COMPLETE.**
- PRD §8.5 stated guarantees: telemetry: none; plaintext password storage unaffected; public export surface of `roku-device-client` unaffected.

## 16. Out of v0.5.6 (deferred to v1.x or later)

- **Audio (SFX bundle + `content.sfx_enabled` field)**: requires deterministic WAV pipeline; separate plan.
- **Multiplayer (2-player local)**: needs gamepad or split-D-pad input scheme.
- **Gamepad input (`roSGNode("Input")` + button translation)**: separate input-pattern story.
- **Additional games (Snake, Memory, Tetris, etc.)**: cookbook examples or future template variants.
- **Background music + per-game theme**: same blocker as SFX.
- **Difficulty-scaling AI during play**: current AI uses constant lag; ramp by score is a v1.x polish.
- **Game-pause overlay (Back -> pause; Back-Back -> quit)**: current Back returns to title. v1.x could add explicit pause.
- **Network leaderboard**: requires auth + analytics + network module composition.
- **Roku Pay integration in shell**: composed via `monetization.roku_pay.*` modules later; shell ships no purchase flow.
- **`roAppMemoryMonitor` boilerplate** (cert-recommended for memory-heavy apps; not required for the game_shell scope): cookbook addition.
- **`CERT_CHECKLIST.md.ejs` per-channel emission**: cross-template polish; tracked since Plan 4e.

---

## Appendix A: Comparison table -- v1 catalog completion

| Template | Plan | Version | Bundled content | New `content.*` fields | New init-hook scopes | New cert validators |
|---|---|---|---|---|---|---|
| `video_grid_channel` | 4 / 4b / 4b.1 | 0.4.0 -> 0.5.2 | Roku Direct Publisher feed, hero | `feed_url`, `feed_format`, `primary_color` | DetailsScene, PlayerScene | (none) |
| `blank_scenegraph` | 4a | 0.5.0 | (none) | (none) | MainScene | (none) |
| `news_channel` | 4c | 0.5.3 | bundled news-feed.json (5 cats x 21 clips), NASA TV HLS | `live_label` | CategoryGridScene | (none) |
| `music_player` | 4d | 0.5.4 | bundled music-feed.json (3 playlists x 6 tracks), 15 PNG icons | `service_name` | NowPlayingScene | (none) |
| `screensaver` | 4e | 0.5.5 | bundled screensaver-feed.json + 8 JPEGs | `transition_seconds`, `motion`, `feed_format='rokudev_screensaver_v1'` | Screensaver | `SCREENSAVER_TITLE_CONTAINS_ROKU`, `SCREENSAVER_ZIP_TOO_LARGE` (template-conditional) |
| `game_shell` | **4f** | **0.5.6** | (none; rectangles only) | `cpu_difficulty`, `score_to_win`, `high_score_persistence` | GameScene | (none) |

`game_shell` is the smallest delta of any v1 template plan: zero bundled assets, zero new validators, three additive engine threading lines. The architectural precedent is fully established by Plans 4-4e; this plan mostly composes those patterns into a game-shaped use case.
