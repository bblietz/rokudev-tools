# Plan 5: `analytics.event_pipe` — Design

**Date:** 2026-05-18
**Status:** Design — approved by user 2026-05-18; pending spec-review loop.
**Target version:** v0.6.0 (first MODULE release; first MINOR bump since v0.5.6).
**Authors:** Claude (Opus 4.7) with user direction.
**Reviewers:** spec-document-reviewer subagent (loop); user (final gate).

## 1. Context

`analytics.event_pipe` is the first of 10 v1 feature modules for the rokudev-tools `brs-gen` MCP. It provides a pluggable telemetry layer that any composed channel can emit events into and any consumer (vendor SDK adapter, custom HTTP backend, local debug log) can drain events out of.

Per the work-order directive (MEMORY.md, revised 2026-05-16), block 1 (real feature modules) is now NEXT. `analytics.event_pipe` is the natural first module because every other v1 module (Roku Pay, RAF, auth, deep_link, accessibility.captions) will want to emit events through it.

## 2. Goals

- **G1.** Public BrightScript API for emitting events: `Analytics_Track(name, props)`.
- **G2.** Pluggable sink registry: `Analytics_AddSink(handlerName)` / `Analytics_RemoveSink(handle)`. Deferred vendor adapters (Adobe Video, Conviva) ship as separate modules that register their own sinks.
- **G3.** Auto-emit a small standard event vocabulary from template hooks where possible: `channel_start`, `screen_view`, `content_start`. Manual: `channel_exit`, `content_end`, `content_error`, `error`.
- **G4.** Ship two default sinks: `ConsoleSink` (BrightScript `print` per event; enabled by default) and `HttpSink` (`roUrlTransfer.AsyncPostFromString`; batched flush; enabled when config has an endpoint).
- **G5.** Honor Roku channel-store privacy policy: `roDeviceInfo.IsRIDADisabled()` is respected; `GetChannelClientId()` is always sent (per-channel persistent, explicitly allowed).
- **G6.** Compose with all 6 v1 templates via opportunistic wiring; do not fail composition on heterogeneous hook surfaces.
- **G7.** On-device T27 verification: console sink + BrightScript log tail proves event flow on Roku Native 2910X for the 4 user-navigable templates.

## 3. Non-goals (deferred to v1.x or vendor modules)

- Vendor-specific event transforms (Adobe Video Heartbeat, Conviva). Deferred per PRD.
- GDPR-style in-channel consent UI. Roku OS handles platform-level opt-out.
- Persistent queue across channel exit (no reliable Roku exit callback in v1).
- Per-event schema validation. The dispatcher is permissive; vendor sinks reshape on receive.
- Retry beyond a single attempt (best-effort delivery; channel-store cert does not require durability).
- Auto-emit at `Main.before_scene_show` (no SceneGraph context yet; deferred to first scene-mount hook).
- `content_end` / `content_error` auto-emission (requires PlayerScene observer wiring per-template; manual in v1).
- Conditional event sampling. All emitted events flow to all sinks.

## 4. Locked decisions (brainstorming round)

| # | Decision | Picked |
|---|---|---|
| Q1 | Scope | Plumbing + standard vocab + 2 sinks |
| Q2 | Sink model | Runtime sink registry |
| Q3 | HTTP delivery | Batched flush (timer + threshold) |
| Q4 | Event vocabulary | Roku-conventional 7 events |
| Q5 | Wiring strategy | Engine extension: `optional_init_calls` |
| Q6 | Privacy | Honor RIDA opt-out, send `channel_client_id` |
| Q7 | T27 verification | Console sink + BrightScript log tail |

Approach 1 chosen: single Plan 5 ships engine extension + module + T27 + v0.6.0 release.

## 5. Architecture

Two affected surfaces:

### 5.1 `brs-gen` engine extension

One additive field on `module_wiring.optional_init_calls`:

```toml
[module.wiring]
init_calls = [ ... ]            # existing: strict — module fails if hook missing
optional_init_calls = [ ... ]   # NEW: opportunistic — skipped silently if hook missing
```

Affected source files:

- `packages/brs-gen/src/catalog/module-toml.ts` — extend Zod schema with `optional_init_calls: z.array(...).default([])`.
- `packages/brs-gen/src/merger/wiring.ts` — validate optional-call hook *shape* (scope+phase strings), but allow missing template export. Hook signature mismatches still error.
- `packages/brs-gen/src/merger/emit-init-hooks.ts` — extend dispatch generator to include optional calls for matched hooks; sort deterministically by (hook, init_order) like existing strict calls.
- `packages/brs-gen/tests/catalog/module-toml-optional.test.ts` (new) — schema accept/reject.
- `packages/brs-gen/tests/merger/optional-init-calls.test.ts` (new) — synthetic two-hook fixture proving both branches.

### 5.2 The `analytics.event_pipe` module

New directory `packages/brs-gen/modules/analytics.event_pipe/`:

```
analytics.event_pipe/
├── module.toml
└── files/source/_modules/analytics_event_pipe/
    ├── Dispatcher.bs          # singleton init, queue, flush timer, sink registry
    ├── Hooks.bs               # 4 hook-handler entry points
    └── sinks/
        ├── ConsoleSink.bs     # one-line per event via `print`
        └── HttpSink.bs        # roUrlTransfer.AsyncPostFromString, JSON batch body
```

**Module boundary contract:** the module is the only writer to the event queue. Sinks are the only readers. Hook handlers are tiny adapters between SceneGraph context and the dispatcher API. Other modules and channel code interact ONLY through `Analytics_*` BrightScript functions.

**Internal lattice:** Dispatcher is the central state owner. Hooks call into Dispatcher. Sinks are called BY Dispatcher (during flush). No sink calls Dispatcher.

## 6. Event schema & vocabulary

### 6.1 Envelope

Every event emitted:

```text
{
  name: "channel_start",            ' string, snake_case lowercase
  ts:   "2026-05-18T12:34:56.789Z", ' ISO 8601 UTC, ms-precision
  props: { ... }                    ' AA, event-specific + auto-props + identity + default_props
}
```

`name` is normalized to lowercase snake_case at `Analytics_Track` entry (warn if input differs; never drop).

### 6.2 Auto-attached props (every event)

| Key | Source | Notes |
|---|---|---|
| `channel_client_id` | `roDeviceInfo.GetChannelClientId()` | per-channel persistent; allowed by Roku policy |
| `rida` | `roDeviceInfo.GetRIDA()` or omitted | omitted if `IsRIDADisabled()=true` |
| `session_id` | UUID at dispatcher init | rotates per channel launch |
| `channel_version` | `<major>.<minor>.<build>` from manifest | for funnel cohorting |
| `roku_model` | `roDeviceInfo.GetModel()` | device-class slicing |
| `roku_fw` | `roDeviceInfo.GetVersion()` | firmware slicing |
| `ts_epoch_ms` | `CreateObject("roDateTime").AsSeconds() * 1000` | numeric ts redundant with ISO |

### 6.3 Standard event vocabulary (7 events)

| Event | Auto-emitted from | Standard props |
|---|---|---|
| `channel_start` | dispatcher lazy-init (first scene hook fires it) | `cold_start: bool` (true on first emission per session) |
| `channel_exit` | none (no reliable hook) — manual | reserved props for v1.x |
| `screen_view` | any `<Scene>.after_scene_show` or `MainScene.after_content_load` | `screen_name`, `previous_screen` (last emitted, may be omitted on first) |
| `content_start` | `PlayerScene.before_play` | `content_id`, `content_title`, `content_kind` ("video"\|"audio"), `is_live: bool` |
| `content_end` | manual | `content_id`, `position_ms`, `duration_ms`, `completion_pct` |
| `content_error` | manual | `content_id`, `error_code`, `error_message` |
| `error` | manual | `error_code`, `error_message`, `stack` (optional) |

Custom events: `Analytics_Track("any_name", { ... })` works identically.

## 7. Sink interface contract

### 7.1 Signature

```brightscript
function MySink_handler(events as object) as boolean
  ' events: roArray of event envelopes (Section 6.1)
  ' return: true = success; false = retry on next flush (one retry only, then drop)
end function
```

Sinks are registered by **function name string** because BrightScript can't pass function pointers cleanly across components. The dispatcher resolves names via `Function(name)` lookup at flush time.

### 7.2 Public API

```brightscript
handle = Analytics_AddSink("MyAdobeSink_handler")     ' returns int handle (>= 1)
Analytics_RemoveSink(handle)                          ' returns true if removed
Analytics_Track(name as string, props as object)      ' enqueue an event
Analytics_Flush()                                     ' force flush queue to all sinks
Analytics_SetIdentity(props as object)                ' merge into auto-props
```

### 7.3 Registration semantics

- Same function name registered twice → returns the same handle; not duplicated in registry.
- Handle is stable for the dispatcher lifetime. After channel exit, handles invalid.
- Removal: `Analytics_RemoveSink(unknown_handle)` returns false. No exception.
- Default sinks: `ConsoleSink_handler` always registered at init (if `console_sink: true`); `HttpSink_handler` registered if `http_endpoint != ""`.

## 8. Dispatcher lifecycle

### 8.1 Singleton via SceneGraph

State lives on a hidden `roSGNode` of type `"Node"` with `id="AnalyticsEventPipe"`, attached as a child of `m.global`. Fields on the node:

| Field | Type | Purpose |
|---|---|---|
| `queue` | string | JSON-serialized event array (nested AA on SG nodes is flaky) |
| `retryBuffer` | string | JSON-serialized failed-batch (held one cycle) |
| `sinks` | roArray | function-name strings in registration order |
| `nextHandle` | integer | monotonic handle generator |
| `sinkHandles` | AA | { handle: sinkName } reverse map |
| `config` | AA | module config snapshot |
| `identity` | AA | overlay props from `Analytics_SetIdentity` |
| `sessionId` | string | generated once at init |
| `manifestVersion` | string | manifest `<major>.<minor>.<build>` |
| `flushTimer` | Timer (child node) | `repeat=true`, `duration` from config |
| `previousScreen` | string | last `screen_view` `screen_name` |
| `coldStartFired` | bool | first emission only |

### 8.2 Lazy init

Every `Analytics_*` function starts with:

```brightscript
node = m.global.findNode("AnalyticsEventPipe")
if node = invalid then
  node = AnalyticsEventPipe_Init()
end if
```

`AnalyticsEventPipe_Init()` creates the node + child Timer, reads module config (via auto-generated `ModuleConfig_analytics_event_pipe()`), generates session UUID, builds initial auto-props, registers default sinks, starts timer, returns the node. Idempotent (second concurrent caller returns the existing node).

### 8.3 channel_start emission

The `Analytics_Track` entry point checks `coldStartFired`. If false, it synthesizes a `channel_start` event with `cold_start=true`, enqueues it, sets `coldStartFired=true`, THEN enqueues the user-requested event. So the first `screen_view` or `content_start` from a template hook always emits `channel_start` first.

### 8.4 Flush mechanics

Triggers:
1. Timer tick (every `batch_interval_ms`, default 10000).
2. Queue length ≥ `batch_max_events` (default 50).
3. Explicit `Analytics_Flush()` call.

Drain procedure:
1. Atomically pop all events from `queue` into local `batch`.
2. Merge `retryBuffer` (if non-empty) into front of `batch`. Clear `retryBuffer`.
3. For each registered sink: call `Function(sinkName)(batch)`. On `false` or exception, push `batch` into `retryBuffer` (overwriting; only one cycle of retry).
4. If both attempts failed: drop the batch; emit a `[Analytics] DROP batch=<n> reason=<sink failure>` to ConsoleSink (which has no network dependency).

### 8.5 Cross-thread safety

SceneGraph node field reads/writes are atomic per-field. Queue mutations use field-level read-modify-write inside short critical sections (acceptable for the throughput envelope: tens to hundreds of events per minute).

`Analytics_Track` calls from a Task thread (e.g. `HttpTask`) work the same way: `m.global` is shared across all SG-spawned tasks.

### 8.6 channel_exit best-effort

No reliable Roku channel-exit callback in v1. Channels can call `Analytics_Flush()` from any code path they know triggers exit. Final-batch loss accepted; documented in module README.

## 9. Per-template wiring map

### 9.1 Module `module.toml` wiring (excerpt)

```toml
[module.wiring]
exports = []
requires = []
init_calls = []                                     # strict: none

optional_init_calls = [
  # screen_view
  { hook = "MainScene.after_scene_show",         statement = "AnalyticsEventPipe_OnScreenView(m, \"MainScene\")" },
  { hook = "MainScene.after_content_load",       statement = "AnalyticsEventPipe_OnScreenView(m, \"MainScene\")" },
  { hook = "CategoryGridScene.after_scene_show", statement = "AnalyticsEventPipe_OnScreenView(m, \"CategoryGridScene\")" },
  { hook = "NowPlayingScene.after_scene_show",   statement = "AnalyticsEventPipe_OnScreenView(m, \"NowPlayingScene\")" },
  { hook = "GameScene.after_scene_show",         statement = "AnalyticsEventPipe_OnScreenView(m, \"GameScene\")" },
  { hook = "Screensaver.after_scene_show",       statement = "AnalyticsEventPipe_OnScreenView(m, \"Screensaver\")" },
  # content_start
  { hook = "PlayerScene.before_play",            statement = "AnalyticsEventPipe_OnContentStart(m)" },
  # game lifecycle (custom events)
  { hook = "GameScene.after_game_start",         statement = "AnalyticsEventPipe_OnGameStart(m)" },
  { hook = "GameScene.after_game_over",          statement = "AnalyticsEventPipe_OnGameOver(m)" },
]
```

### 9.2 Auto-emission per template

| Template | `channel_start` | `screen_view` | `content_start` | Custom |
|---|---|---|---|---|
| `video_grid_channel` | on first hook (MainScene.after_content_load) | MainScene | yes (PlayerScene) | — |
| `news_channel` | on first hook (MainScene.after_scene_show) | MainScene, CategoryGridScene | yes (PlayerScene) | — |
| `music_player` | on first hook (MainScene.after_scene_show) | MainScene, NowPlayingScene | manual† | — |
| `game_shell` | on first hook (GameScene.after_scene_show) | GameScene | — | `game_start`, `game_over` |
| `screensaver` | on first hook (Screensaver.after_scene_show) | Screensaver | — | — |
| `blank_scenegraph` | on first hook (MainScene.after_scene_show) | MainScene | — | — |

†`music_player` has no PlayerScene-shaped hook. v1 ships a documented `Analytics_Track("content_start", song_meta)` pattern for music; v1.x can promote it via a new hook.

### 9.3 Polish callouts (v1.x backlog; NOT this plan)

- `music_player` would benefit from a `NowPlayingScene.before_play` hook so `content_start` can auto-emit for audio (parallel to `PlayerScene.before_play` for video).
- `video_grid_channel` lacks `MainScene.after_scene_show`; uses `after_content_load` instead. Acceptable for v1; documented.

## 10. Configuration & privacy

### 10.1 Module config schema

```toml
[module.config_schema]
type = "object"
additionalProperties = false
  [module.config_schema.properties]
  http_endpoint     = { type = "string", format = "uri", default = "" }
  http_app_key      = { type = "string", default = "" }
  console_sink      = { type = "boolean", default = true }
  batch_interval_ms = { type = "integer", minimum = 1000, maximum = 300000, default = 10000 }
  batch_max_events  = { type = "integer", minimum = 1, maximum = 1000, default = 50 }
  default_props     = { type = "object", additionalProperties = { type = "string" }, default = {} }
```

`respect_rida_optout` is **not** configurable — hardcoded to `true` (channel-store cert requirement).

### 10.2 Channel author wiring (AppSpec)

```yaml
modules:
  - id: analytics.event_pipe
    config:
      http_endpoint: "https://analytics.example.com/v1/events"
      http_app_key: "channel_xyz_prod_key"
      default_props:
        environment: "prod"
        channel_name: "my_news_app"
```

Bare `{ id: "analytics.event_pipe" }` (no config): console sink only, no HTTP, 10s/50-event batching.

### 10.3 Privacy implementation

```brightscript
sub AnalyticsEventPipe_BuildAutoProps()
  di = CreateObject("roDeviceInfo")
  props = {
    channel_client_id: di.GetChannelClientId(),
    session_id:        m.sessionId,
    channel_version:   m.manifestVersion,
    roku_model:        di.GetModel(),
    roku_fw:           di.GetVersion(),
    ts_epoch_ms:       CreateObject("roDateTime").AsSeconds() * 1000
  }
  if NOT di.IsRIDADisabled() then
    props.rida = di.GetRIDA()
  end if
  for each k in m.config.default_props.Keys()
    props[k] = m.config.default_props[k]
  end for
  for each k in m.identity.Keys()
    props[k] = m.identity[k]
  end for
  return props
end sub
```

### 10.4 Identity API

```brightscript
Analytics_SetIdentity({ user_id: "u_abc123", subscription_tier: "premium" })
```

Auth modules typically call this from their `Main.before_scene_show` hook after sign-in completes. Persists for dispatcher lifetime. Nil values delete keys. Overwrites with same key replace value.

### 10.5 Module ordering

```toml
[module.ordering]
before = []                                  # nothing must init before us
after  = ["auth.device_link_code",           # let auth set identity first if present
          "auth.oauth_device_grant",
          "auth.roku_os_signin"]
[module.conflicts]
exclusive_with = []                          # vendor analytics modules register sinks alongside us
```

`after` is soft: dispatcher inits regardless of which auth modules are present.

## 11. Error handling

| Failure mode | Behavior |
|---|---|
| `Analytics_Track` called before any SG context exists (e.g. from Main.brs) | Document as unsupported in v1; channel author should defer to first scene-mount hook. Function returns silently without enqueueing. |
| Sink function name unresolvable via `Function(name)` at flush time | Drop sink from registry; log `[Analytics] sink_unresolvable name=<name>` via ConsoleSink. |
| Sink throws exception | Treat as `false` return; one retry on next flush; then drop. |
| `roUrlTransfer.AsyncPostFromString` returns -1 (no port available) | Treat as failure; one retry. |
| HTTP sink: 4xx/5xx response | Treat as failure; one retry. (No status-code-specific behavior in v1.) |
| HTTP sink: timeout (5s default) | Treat as failure; one retry. |
| Queue overflow (`>2 * batch_max_events`) | Force-flush regardless of timer; ConsoleSink logs warning. |
| Invalid event name (non-string, empty) | Drop event; ConsoleSink logs `[Analytics] reject name=<repr>`. |
| Invalid props (not AA) | Drop event; ConsoleSink logs reject. |

ConsoleSink is the "safety net": it never depends on network or other modules, so it can always log dispatcher errors.

## 12. Testing strategy

### 12.1 Layer 1: engine extension unit tests

- `tests/catalog/module-toml-optional.test.ts` — schema accept/reject for `optional_init_calls`.
- `tests/merger/optional-init-calls.test.ts` — synthetic 2-hook fixture (one matched, one missing); asserts emitted dispatch includes matched, omits missing; init-order tie-breaking preserved.

### 12.2 Layer 2: module-internal unit tests (TS shim of pure dispatcher logic)

The dispatcher's pure functions (queue normalization, identity merge, RIDA-conditional props build, name-normalization regex) are mirrored in TS for unit testing, like the `pong-helpers.ts` shim in `game_shell`:

- `tests/analytics-dispatcher.test.ts` — `Analytics_Track` name normalization (snake_case enforcement, lowercase coercion).
- `tests/analytics-sinks.test.ts` — `Analytics_AddSink` / `Analytics_RemoveSink` handle uniqueness; duplicate registration returns same handle.
- `tests/analytics-flush.test.ts` — drain, retry-once, drop after second failure; queue overflow force-flush.
- `tests/analytics-privacy.test.ts` — `IsRIDADisabled=true` omits `rida`; `=false` includes it; `channel_client_id` always present.
- `tests/analytics-identity.test.ts` — `SetIdentity` merge / overwrite / delete-on-nil.
- `tests/analytics-const-parity.test.ts` — regex parse Dispatcher.bs config defaults, assert numeric equality with TS shim (precedent: `pong-const-parity.test.ts`).

### 12.3 Layer 3: composition matrix e2e

`tests/e2e/analytics-event-pipe.test.ts`:

- For each of 6 templates: compose `template + analytics.event_pipe`; snapshot `source/_modules/__init_hooks.brs`; assert expected optional hooks matched per §9.2.
- One canonical composition (`news_channel + analytics.event_pipe`) gets a golden zip byte-equality test under `TZ=UTC`.
- Snapshot files: `tests/__snapshots__/analytics_event_pipe/{Dispatcher,Hooks,ConsoleSink,HttpSink}.brs.snap.txt`.

### 12.4 Layer 4: T27 on-device

`packages/brs-gen/scripts/t27-analytics-event-pipe.mjs`:

- Target device: Roku Native 2910X (10.128.160.39 if reachable; fall back to user-supplied IP).
- Loop 4 templates: `video_grid_channel`, `news_channel`, `music_player`, `game_shell`. (Skip `screensaver` — no user navigation; skip `blank_scenegraph` — sample-only.)
- Per template:
  1. Compose `template + analytics.event_pipe` (console sink only, no HTTP).
  2. Sideload + launch via `sideloadAndLaunch`.
  3. Standard navigation sequence (4 keypresses tailored per template):
     - `video_grid_channel`: Right, Right, Select (enter Details), Select (play) → expect screen_view, screen_view, content_start.
     - `news_channel`: Right (CategoryGrid), Select (play) → expect screen_view, content_start.
     - `music_player`: Right, Select → expect screen_view (NowPlaying); content_start manual (skip assertion).
     - `game_shell`: Select (start) → expect screen_view, game_start.
  4. Tail BrightScript log (port 8085) for 8s after each keypress sequence.
  5. Grep `[Analytics]` lines.
  6. Assert: `channel_start` appears exactly once at the start with `cold_start=true`; subsequent events appear in expected order with expected props.
- T27 evidence file: `docs/t27-evidence/2026-MM-DD-analytics-event-pipe.md` with PASS rows per template.

## 13. File structure

```
packages/brs-gen/
├── modules/analytics.event_pipe/
│   ├── module.toml
│   └── files/source/_modules/analytics_event_pipe/
│       ├── Dispatcher.bs
│       ├── Hooks.bs
│       └── sinks/
│           ├── ConsoleSink.bs
│           └── HttpSink.bs
├── src/
│   ├── catalog/module-toml.ts                       (MODIFY)
│   ├── merger/wiring.ts                             (MODIFY)
│   └── merger/emit-init-hooks.ts                    (MODIFY)
├── tests/
│   ├── catalog/module-toml-optional.test.ts         (NEW)
│   ├── merger/optional-init-calls.test.ts           (NEW)
│   ├── analytics-dispatcher.test.ts                 (NEW)
│   ├── analytics-sinks.test.ts                      (NEW)
│   ├── analytics-flush.test.ts                      (NEW)
│   ├── analytics-privacy.test.ts                    (NEW)
│   ├── analytics-identity.test.ts                   (NEW)
│   ├── analytics-const-parity.test.ts               (NEW)
│   ├── analytics-helpers.ts                         (NEW: TS shim of pure dispatcher fns)
│   ├── e2e/analytics-event-pipe.test.ts             (NEW: 6-template composition matrix)
│   ├── __golden__/analytics-event-pipe-news.zip     (NEW)
│   └── __snapshots__/analytics_event_pipe/
│       ├── Dispatcher.brs.snap.txt
│       ├── Hooks.brs.snap.txt
│       ├── ConsoleSink.brs.snap.txt
│       └── HttpSink.brs.snap.txt
└── scripts/
    ├── t27-analytics-event-pipe.mjs                 (NEW)
    └── regen-golden.mjs                             (MODIFY: extend with regenAnalyticsEventPipe)
```

Estimated total: ~25 files (3 modified, ~22 new).

## 14. Release plan

- **Version:** v0.6.0 (MINOR bump — first MODULE; additive engine surface).
- **Regen:** `BRS_GEN_VERSION` in provenance JSON changes; all template + module goldens regenerate via `pnpm run regen-golden`. Required before tag.
- **Release notes:** appended to `README.md` in chronological order (per established pattern).
- **MEMORY:**
  - New topic file: `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/plan-5-analytics-event-pipe.md`.
  - MEMORY.md status line updated.
  - Any new latent traps discovered during implementation appended to the cross-cutting list.
- **Push:** confirm-before-push, single `git push origin main && git push origin v0.6.0`.

## 15. Reference-app polish-insistence callouts

Per MEMORY directive (2026-05-11), surfacing template polish gaps BEFORE composing modules on them:

- `video_grid_channel`: D8 (Back-from-Details refocus playButton), demo feeds on corp network, hero auto-rotation, Up-from-first-row dead. None block analytics composition.
- `news_channel`: Phase B HLS live verification, per-item thumbnail bundling, FHD label sizing. None block analytics composition.
- `music_player`: per-track art, shuffle/repeat, search, lyrics, HLS audio, Phase B feed T27. **The missing `NowPlayingScene.before_play`-equivalent hook means `content_start` is manual for music in v1.** Documented as §9.3 v1.x backlog.
- `screensaver`: per-photo caption, random shuffle, schedule, memory-pressure-free-cache, wrapper-schema. None block analytics composition.
- `game_shell`: audio (SFX), gamepad, multiplayer, more games, AI scaling, pause overlay, leaderboard. None block analytics composition.

**Conclusion:** Plan 5 proceeds without fix-first work on any template. The one design accommodation (music `content_start` manual) is captured as a v1.x follow-up.

## 16. Cross-plan invariants this work must preserve

- Same `AppSpec` → same bytes out (deterministic generation; goldens enforce this).
- `dev_password`, `http_app_key` never logged or echoed.
- `_internal/` paths in `@rokudev/device-client` not exported.
- Templates and modules hand-authored, device-tested, deterministic. No LLM-written code ships in deterministic path.
- All Roku-touching code in `rokudev-device` + `@rokudev/device-client` (T27 uses these; no direct device calls from `brs-gen`).
- `yazl 2.5.x` zip determinism requires `TZ=UTC`; golden regen script sets this.

## 17. Open questions / explicit deferrals to v1.x

1. **HTTP sink durability across channel exit.** No reliable exit callback; final-batch loss accepted. v1.x could add a `Main.brs` shutdown hook to the templates AND wire a `Roku Channel Quit` observer.
2. **Music_player `content_start` auto-emission.** Needs a `NowPlayingScene.before_play`-equivalent hook in the template. v1.x patch.
3. **Vendor sinks: `analytics.adobe_video`, `analytics.conviva`.** Each ships as a separate module that registers a sink. Out of scope for v1.
4. **Conditional event sampling.** All events flow to all sinks in v1. v1.x can add per-sink filters.
5. **Per-event schema validation.** Permissive in v1; vendor sinks reshape on receive.
6. **Channel-exit shutdown flush.** Best-effort manual `Analytics_Flush()` in v1; v1.x with exit hook.

## 18. Success criteria

Plan 5 ships when:

1. All ~25 files exist as per §13.
2. `pnpm -r test` passes (917 → ~960+ tests).
3. `pnpm build` clean across all packages (TS typecheck gate).
4. Engine extension covered by ≥2 unit tests (matched + unmatched optional hook).
5. Module covered by ≥7 unit tests (dispatcher, sinks, flush, privacy, identity, const-parity, name normalization).
6. Composition matrix e2e passes for 6 templates.
7. Golden zip byte-equality passes for `news_channel + analytics.event_pipe`.
8. T27 driver passes 4-of-4 navigable templates on Roku Native 2910X.
9. `v0.6.0` tag published with release notes in README and topic file in MEMORY.
10. User-explicit `Yes, push` confirmation obtained before any push to origin.
