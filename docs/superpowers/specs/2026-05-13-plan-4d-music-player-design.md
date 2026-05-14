# Plan 4d: `music_player` template design

> Status: draft for spec review, 2026-05-13.
> Parent spec: `docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md` (PRD).
> Related plans: Plan 3 (brs-gen engine), Plan 4 (`video_grid_channel` template), Plan 4a (`blank_scenegraph` template + branding-defaults engine), Plan 4b/4b.1 (`video_grid_channel` polish + T27 honesty), Plan 4c (`news_channel` template + `content.live_label` engine thread).

## 1. Goal

Ship the fourth base template in the v1 catalog: `music_player`. A production-shaped audio channel with persistent playback across nav. Browse screen presents a 3-column `PosterGrid` of playlists; selecting a playlist opens a NowPlayingScene with album art, scrubber, and a 5-button transport row, starts playback at queue index 0, and queues the rest of the playlist's tracks. A persistent MiniBar on MainScene shows the current track and a play/pause toggle, so backing out of NowPlaying does not stop playback.

Bundled content is a small hand-authored JSON feed at `pkg:/data/music-feed.json` referencing public-domain demo MP3s (SoundHelix). Operators override the feed URL via `spec.content.feed_url`.

Plan 4d builds on, but does not regress, the load-bearing patterns from prior templates: cross-component focus routing via Scene-level `onKeyEvent` + `findNode("<id>")` + `setFocus(true)` (Plan 4c), cached `createChild` references for removable overlays (v0.4.2), `iconUri` / `focusedIconUri` PNG icons on Buttons (v0.5.1, no Unicode glyphs), `vector2dArray` for per-row attributes if any RowList appears (v0.4.1), foreground-checked `screenshotNoError` in T27 (Plan 4b.1), and Home + relaunch (NOT re-sideload) for any in-driver state-reset preamble on this firmware (Plan 4c).

## 2. Locked decisions (from brainstorming)

| # | Decision | Value | Source |
|---|---|---|---|
| D1 | Template choice | `music_player` (one of the three remaining v1 catalog templates: `screensaver`, `game_shell`, `music_player`) | Q1 |
| D2 | Scope | Browse + NowPlaying (two-scene pattern, mirrors `video_grid_channel`) | Q2 |
| D3 | Browse layout | 3-column `PosterGrid` of playlists/albums | Q3 |
| D4 | Transport surface | 5 actions: Play/Pause + Next/Prev + Scrubber. NO shuffle/repeat. | Q4 |
| D5 | Audio source for bundled feed | SoundHelix public MP3s (https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3 .. SoundHelix-Song-9.mp3). Fix-forward policy per PRD D4/D12 if 404. | Q5 |
| D6 | Audio node placement | MainScene owns `Audio` node; NowPlayingScene reads/writes via field reference. Back from NowPlaying preserves playback. | Q6 |
| D7 | Versioning | v0.5.4 patch (consistent with 4a/4b/4b.1/4c cadence) | derived from cadence |
| D8 | Schema additions | `content.service_name` (optional 1-20 char string; default = `spec.app.name`) for the "FROM &lt;name&gt;" header line on NowPlayingScene. No other new fields. | derived from D2 |
| D9 | Engine change | One additive line in `src/tools/generate-app.ts` propagates `content.service_name` into the emitted `TemplateConfig()`. Parallel to Plan 4c's `live_label` thread. No behavior change for existing templates. | derived from D8 |
| D10 | MiniBar visibility policy | Hidden until first track plays. Once `m.audio.state` enters `playing|buffering`, MiniBar persists for the rest of the session (visible even on `paused` and `stopped`). Resets on channel relaunch. | derived from D6 |
| D11 | Init-hook surface | `Main/before_scene_show`, `MainScene/after_scene_show`, **NEW** `NowPlayingScene/after_scene_show` (analytics modules will hook here for `track-played` events in Plan 5+) | derived from §4 architecture |

## 3. Non-goals

- **No HLS audio / live radio.** All playback is HTTP-progressive MP3 (or operator-supplied URLs of any Roku-supported audio format; channel does not enforce). No streaming-radio surface, no `TimedMetadata` observer, no track-change announcements from a server.
- **No search.** No `SearchScene`, no Roku voice-search hookup, no string-filter on the playlist grid.
- **No category browsing above playlists.** Flat list of playlists at the top level; no Genre / Mood / Decade categorization. (Categories above playlists is a Plan 5+ enhancement; matches the `video_grid_channel` "rows of rows" approach which we are not copying here.)
- **No shuffle / no repeat.** 5-button transport, not 7. Operator can ship a module that adds these in Plan 5+.
- **No lyric display, no equalizer visualizer, no spectrum analyzer.**
- **No per-track art.** All tracks in a playlist render the playlist art on NowPlayingScene's left pane. (Per-track art is a Plan 5+ enhancement.)
- **No library / favorites / playback history / recently-played.** No m.global persistence, no registry I/O, no per-user state.
- **No sleep timer, no cast / multi-room audio, no voice control.**
- **No reuse of components from `video_grid_channel` or `news_channel`.** `MainScene`, `HttpTask`, and `Feed.bs` are re-authored for `music_player` even though they are structurally similar. Sharing components across templates is a Plan 5+ concern (component-extraction once two templates demonstrably need the same code path).
- **No default modules shipped in Plan 4d.** PRD §6 dispatch table lists `music_player` defaults as `auth.device_link_code`, `analytics.event_pipe`, `deep_link.global`. These modules do not yet exist; Plan 5+ ships them. Plan 4d ships the template only, with the init-hook export points where those modules will compose.

## 4. Architecture

Four SceneGraph components. MainScene is the entry point, owns the `Audio` node and the browse `PosterGrid`, and inline-mounts the `MiniBar` composite. NowPlayingScene is an overlay opened via `createChild` on Select. HttpTask is the now-canonical pattern (`<interface><field id="url"...>` + `<field id="result"...>`) re-authored per template.

```
Scene
└── MainScene  (root; owns Audio node + PosterGrid + MiniBar; loads feed)
    ├── PosterGrid       (3 cols x N rows of square playlist art + title)
    ├── MiniBar          (Group composite at bottom; hidden until first play)
    │   ├── art Poster (40x40)
    │   ├── title Label
    │   ├── artist Label
    │   └── playPause Button (focusable; iconUri PNG icons)
    ├── Audio  (m.audio; SceneGraph Audio node; non-rendering)
    ├── feedTask HttpTask (createObject, NOT script-included)
    ├── loadingLabel Label
    └── errorLabel Label

NowPlayingScene  (overlay child of MainScene's Scene; opened on createChild)
└── (composite Group)
    ├── albumArt Poster (large; left pane)
    ├── serviceLine Label  ("FROM <service_name>")
    ├── trackTitle Label
    ├── trackArtist Label
    ├── scrubber ProgressBar  (focusable; Left/Right seeks; Up/Down moves focus)
    └── transport Group
        ├── prev Button       (iconUri)
        ├── rew15 Button      (iconUri)
        ├── playPause Button  (iconUri; default focus on open)
        ├── fwd15 Button      (iconUri)
        └── next Button       (iconUri)
```

**Component files:**

| File | Purpose |
|---|---|
| `source/Main.bs` | Entry; constructs Scene + MainScene; calls `Modules_OnMainBeforeSceneShow(args)` init hook. |
| `source/Feed.bs` | `MusicFeed_LoadBundled`, `MusicFeed_BuildContentNode`, `MusicFeed_TracksForPlaylist`. |
| `source/HttpTask.bs` | Task implementation (separate from the component XML). |
| `components/MainScene.{xml,bs}` | Owns Audio + PosterGrid + MiniBar; cross-component focus routing via `onKeyEvent`. |
| `components/NowPlayingScene.{xml,bs}` | Overlay; reads m.audio state via shared field reference passed at createChild. |
| `components/MiniBar.{xml,bs}` | Composite Group; one focusable child (playPause Button). |
| `components/HttpTask.{xml,bs}` | Subclass of Task with `<interface><field id="url" .../><field id="result" .../>`. |
| `data/music-feed.json` | Bundled feed; 3 playlists x 6 tracks. |
| `images/playlist-1.png`, `playlist-2.png`, `playlist-3.png` | Playlist art (600x600 deterministic placeholder PNGs from `gen-music-thumb.mjs`). |
| `images/icon-{prev,next,rew15,fwd15,play,pause}-{light,dark}.png` | Transport bitmap icons (deterministic PNGs from the same author script). 12 PNGs total: 6 actions x 2 themes (light = unfocused, dark = focused). |

**Audio reference passing across scenes:**

The Audio node is created in MainScene's `init()` (`m.audio = m.top.createChild("Audio")`). NowPlayingScene needs to write to `m.audio.control` and observe `m.audio.state` and `m.audio.position`. The cleanest SceneGraph pattern is to pass the node via a field on NowPlayingScene at create time:

```brs
' MainScene.bs:onItemSelected
nowPlaying = m.top.createChild("NowPlayingScene")
nowPlaying.audioRef = m.audio    ' field of type "node"
nowPlaying.queue = queue          ' field of type "array"
nowPlaying.queueIndex = 0         ' field of type "integer"
m.nowPlayingRef = nowPlaying
nowPlaying.setFocus(true)
```

NowPlayingScene's `<interface>` declares matching fields and observes its own `audioRef` field once on init to start the state/position observers. Cached `m.nowPlayingRef` follows the v0.4.2 lesson (never `findNode` for removal).

## 5. AppSpec extensions

```ts
// packages/brs-gen/templates/music_player/schema.ts
import { z } from 'zod';

const NonNegInt = z.number().int().min(0);
const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

const MusicContentSchema = z.object({
  feed_url:     z.string().url().optional(),
  feed_format:  z.enum(['music_player_json']).optional(),
  service_name: z.string().min(1).max(20).optional(),
}).strict();

export const Schema = z.object({
  spec_version: z.literal(2),
  template:     z.literal('music_player'),
  modules:      z.array(z.record(z.unknown())),
  app: z.object({
    name:           z.string().min(1),
    major_version:  NonNegInt,
    minor_version:  NonNegInt,
    build_version:  NonNegInt,
  }).strict(),
  branding: z.object({
    primary_color: Hex.optional(),
    icon:   z.string().min(1).optional(),
    splash: z.string().min(1).optional(),
  }).strict().optional(),
  content: MusicContentSchema.optional(),
}).strict();

export const Example = {
  spec_version: 2 as const,
  template: 'music_player' as const,
  modules: [],
  app: { name: 'Music Demo', major_version: 0, minor_version: 1, build_version: 0 },
  content: { service_name: 'Music Demo' },
};
```

`AppSpecV2Wrapper.content` (set in Plan 4c to `ContentSchema.partial().passthrough().optional()`) already accepts arbitrary template-specific content fields. Template-side schema tightens via `.strict()` as above.

## 6. Engine change

Single additive line in `src/tools/generate-app.ts`. The TemplateConfig emission gate (set to `if (brandingSpec.primary_color || content || effectivePrimaryColor)` in Plan 4c) is unchanged. The emitted `TemplateConfig()` BrightScript function gains a `service_name` key when `spec.content.service_name` is present:

```ts
// src/tools/generate-app.ts (pseudocode)
if (content?.service_name) {
  templateConfigEntries.push(['service_name', content.service_name]);
}
```

Parallel to Plan 4c's `live_label` thread. No behavior change for templates that do not read `TemplateConfig().service_name`. No cascade on other templates' goldens beyond the version bump (which is captured by the standard regen-ordering rule).

## 7. Bundled feed shape

`packages/brs-gen/templates/music_player/files/data/music-feed.json`:

```json
{
  "playlists": [
    {
      "id": "p1",
      "title": "Workout Mix",
      "art":   "pkg:/images/playlist-1.png",
      "tracks": [
        { "id": "t1", "title": "Energy 1",  "artist": "SoundHelix",
          "art":  "pkg:/images/playlist-1.png",
          "audio_url":     "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
          "stream_format": "mp3", "duration": 372 },
        { "id": "t2", "title": "Energy 2",  "artist": "SoundHelix",
          "art":  "pkg:/images/playlist-1.png",
          "audio_url":     "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
          "stream_format": "mp3", "duration": 425 },
        ...6 tracks total cycling Songs 1-3 + 7-9 within this playlist
      ]
    },
    { "id": "p2", "title": "Chill",  "art": "pkg:/images/playlist-2.png", "tracks": [...] },
    { "id": "p3", "title": "Latest", "art": "pkg:/images/playlist-3.png", "tracks": [...] }
  ]
}
```

3 playlists × 6 tracks each = 18 tracks. Each playlist's track list cycles a different sub-set of SoundHelix-Song-1 through SoundHelix-Song-9 so collectively all 9 URLs are exercised at least once across playlists. Within a single playlist, no track URL repeats. `duration` values are approximate (taken from SoundHelix metadata) and used by NowPlayingScene's scrubber to compute progress when `m.audio.duration` is not yet populated by the buffer.

Ellipses in the snippet above (`...6 tracks total cycling...` and `[...]` for playlists 2 and 3) are illustrative shorthand. The implementation plan materializes the full 18-row table deterministically from the constraints stated in this section; no field is left for the implementer to invent.

## 8. Focus routing + nav stack

**MainScene focus tree** (no NowPlaying open):

- Default focus: `PosterGrid` item [0,0] after feed loads.
- Once the user has played any track in this session, `MiniBar` is reachable. Down from PosterGrid bottom row → MiniBar. Up from MiniBar → PosterGrid (last-focused item).

**MainScene.onKeyEvent** handles cross-component routing (Plan 4c pattern):

| Pre-state | Key | Action |
|---|---|---|
| PosterGrid focused | `Select` | Open NowPlayingScene with `queue = MusicFeed_TracksForPlaylist(feed, item.id)`, `queueIndex = 0`. Audio control = `play`. |
| PosterGrid focused, MiniBar visible | `Down` (from any bottom-row item) | `m.miniBarPlayBtn.setFocus(true)` |
| MiniBar focused | `Up` | `m.posterGrid.setFocus(true)` |
| MiniBar focused | `Select` / `Play` | Toggle `m.audio.control` between `play` and `pause` |
| MiniBar focused | `Right` | Open NowPlayingScene WITHOUT changing the queue (resume current) |
| MiniBar focused | `Back` | Return focus to PosterGrid (don't exit) |
| PosterGrid focused | `Back` | Return false (let Roku exit channel) |

MiniBar is unfocusable until first play (D10's visibility policy); the "MiniBar focused" rows above are unreachable until `m.miniBarVisibleSticky` flips to `true`. Pre-first-play, Down from PosterGrid bottom row is a no-op (returns false from `onKeyEvent`, default Roku no-target behavior).

**NowPlayingScene focus tree:**

- Default focus on open: `playPause` button in transport row.
- Up from any transport button → `scrubber`.
- Down from `scrubber` → returns to last-focused transport button (default playPause).
- Left/Right within transport row navigate among `[prev, rew15, playPause, fwd15, next]` Buttons.

**Select-targets in NowPlayingScene:**

| Focused | Key | Action |
|---|---|---|
| `playPause` | `Select` / `Play` | Toggle `m.audio.control` between `play` and `pause` |
| `prev` | `Select` | `queueIndex = max(0, queueIndex - 1)`; load track at new index; `control = play` |
| `next` | `Select` | `queueIndex = min(queue.Count() - 1, queueIndex + 1)`; load track at new index; `control = play` |
| `rew15` | `Select` / `InstantReplay` | `m.audio.seek = max(0, m.audio.position - 15)` (no-op if `state = buffering`) |
| `fwd15` | `Select` | `m.audio.seek = min(duration - 1, m.audio.position + 15)` (no-op if `state = buffering`) |
| `scrubber` | `Left` / `Right` | `m.audio.seek = clamp(m.audio.position +/- 5, 0, duration)` |
| (any) | `Rev` (remote) | Same as `prev` |
| (any) | `Fwd` (remote) | Same as `next` |

**Back-nav stack:**

- Back from NowPlayingScene → close overlay via cached `m.nowPlayingRef` (NOT findNode), restore focus to MiniBar play-pause button on MainScene. MiniBar is now visible.
- Back from MainScene with PosterGrid focused → return false (Roku exits channel).
- Back from MainScene with MiniBar focused → return focus to PosterGrid (don't exit on first Back from MiniBar).

**Audio state observers on MainScene:**

```brs
m.audio.observeField("state", "onAudioStateChange")
```

`onAudioStateChange` handles three transitions:

1. First transition into `playing|buffering` → set `m.miniBarVisibleSticky = true`, show MiniBar.
2. Transitions between `playing` and `paused` → update MiniBar's playPause button icon.
3. `finished` → auto-advance: if `queueIndex < queue.Count() - 1`, `queueIndex++`, load next track, `control = play`. If at end of queue, `state = stopped` (no replay).

NowPlayingScene observes its own copy of `audioRef.state` (set once on init via the passed field reference). Position updates: a 1Hz Timer on NowPlayingScene reads `m.audioRef.position` and `m.audioRef.duration` to update the scrubber percentage.

## 9. T27 verification

`packages/brs-gen/scripts/t27-music.mjs`. Mirrors `t27-news.mjs` structure. Two phases.

**Phase A — bundled feed (deterministic gate):**

1. `generate_app` from spec → zip
2. sideload + launch (active-app foreground assertion via `_t27-lib.mjs`)
3. home screenshot (`screenshotNoError`)
4. `keypress(Right)` → focus PosterGrid item [0,1]
5. row screenshot
6. `keypress(Select)` → NowPlayingScene opens; playback starts on `playlist-1[0]`
7. `sleep(3000)` for HTTP fetch + Audio buffering window
8. `ecpQueryMediaPlayer` → assert `state in ['playing', 'buffering']` (best-effort: SoundHelix can be slow on cold connections; only fail on `error`)
9. NowPlaying screenshot
10. `keypress(Back)` → NowPlaying closes; MiniBar visible on MainScene; focus on MiniBar play-pause
11. miniBar screenshot
12. `keypress(Select)` → toggles `paused`; `ecpQueryMediaPlayer` → assert `state = paused`
13. `keypress(Select)` → toggles back to `playing`
14. `keypress(Up)` → focus returns to PosterGrid (default item)
15. final screenshot
16. forensic-screenshot at `zz-failure.png` with `{assertForeground: false}` opt-out (Plan 4c lesson)

**Phase B — operator feed-URL override (deferred):**

The operator-feed-override codepath (HTTP fetch instead of `ReadAsciiFile`) is exercised in unit tests against the existing HttpTask pattern but not in T27 at v1. Bringing up a local HTTP server inside the T27 driver to re-host the bundled feed adds non-trivial driver complexity for a codepath that is structurally identical to the one verified in `t27-news.mjs`. Plan 4d ships Phase A only; Phase B is deferred fix-forward to a later patch.

**Re-sideload preamble forbidden** (Plan 4c lesson): if a future Plan 4d.x patch adds a Phase B with state-reset between phases, the preamble MUST be `Home` keypress + `EcpControl.launch('dev')`, NOT `sideloadAndLaunch`. The re-sideload pattern from Plan 4b.1 does not fully reset BrightScript m globals on Roku TV Native Build 2910X firmware 15.2.4.

## 10. Asset pipeline + author scripts

`scripts/gen-music-thumb.mjs` (parallel to `gen-news-thumb.mjs`, `gen-plan4-fixtures.mjs`):

- Inputs: none (deterministic from a hard-coded constants table).
- Outputs:
  - `templates/music_player/files/images/playlist-1.png` (600x600, solid color #1a3a8a, glyph "1")
  - `templates/music_player/files/images/playlist-2.png` (600x600, solid color #2a8a3a, glyph "2")
  - `templates/music_player/files/images/playlist-3.png` (600x600, solid color #8a3a2a, glyph "3")
  - 12 transport icon PNGs at 48x48 (icon-prev-light, icon-prev-dark, icon-next-light, icon-next-dark, icon-rew15-light, icon-rew15-dark, icon-fwd15-light, icon-fwd15-dark, icon-play-light, icon-play-dark, icon-pause-light, icon-pause-dark). Light = unfocused (light-on-dark), dark = focused (dark-on-light, against Roku's default focus bitmap).

Note: §4's transport row enumerates 5 Buttons (`prev`, `rew15`, `playPause`, `fwd15`, `next`), not 6. The 12 icon PNGs cover 6 logical actions because the single `playPause` Button swaps its `iconUri` / `focusedIconUri` between the play and pause glyph pair based on `m.audio.state` (the play/pause icon swap is wired in MainScene's `onAudioStateChange` and NowPlayingScene's same observer; the swap is for both MiniBar and NowPlaying transport).
- Deterministic via `sharp` inline SVG with pinned `compressionLevel: 9`, `palette: false`, `kernel: 'lanczos3'`. Same author-tool pattern as Plan 4 + Plan 4c.

**Branding fixtures** for unit + T27 tests live under `packages/brs-gen/tests/fixtures/music_player/`:

- `icon-source.png` 336x218 (per `ICON_SOURCE_MIN`)
- `splash-source.png` 3840x2160 (per `SPLASH_SOURCE_MIN`)

Generated alongside the playlist art by `gen-music-thumb.mjs`.

## 11. Conflict-matrix + determinism entries

`tests/conflict-matrix.test.ts` and `tests/determinism.test.ts` already iterate over the `templates/` directory and exercise each template against the empty-modules-list baseline. The new template is picked up automatically.

`tests/snapshots.test.ts` gains a `music_player` block:

- Snapshot `manifest`
- Snapshot `MainScene.brs` (post-compile; asserts `Modules_OnMainSceneAfterSceneShow` invocation + `m.audio` creation + `m.miniBarVisibleSticky` state var name).
- Snapshot `NowPlayingScene.brs` (post-compile; asserts `Modules_OnNowPlayingSceneAfterSceneShow` invocation + transport key handlers).
- Snapshot `Feed.brs` (post-compile).
- Snapshot full file listing.

Per Plan 4b lesson, each snapshot also asserts presence of all three `Modules_*` extension-point invocations to catch accidental deletion of the init-hook surface.

`tests/asset-reuse.test.ts` (or equivalent sha256-equality test) gains a music_player entry for the playlist-1 PNG asset to confirm the deterministic asset pipeline.

`tests/e2e.test.ts` gains a music_player block:

- `generate_app` byte-equal vs `tests/__golden__/music.zip`
- `validate_manifest` reports `ok: true`
- `lint` reports `ok: true` with no errors

## 12. Init-hook surface

| Scope | Phase | File | Signature |
|---|---|---|---|
| `Main` | `before_scene_show` | `source/Main.bs` | `(args as dynamic) as void` |
| `MainScene` | `after_scene_show` | `components/MainScene.bs` | `(m as object) as void` |
| `NowPlayingScene` | `after_scene_show` | `components/NowPlayingScene.bs` | `(m as object) as void` |

`NowPlayingScene/after_scene_show` is **new**. Plan 5+ analytics modules will hook here for `track-played` events: the module reads `m.audioRef.content.title`, observes `m.audioRef.state` for transitions into `playing` / `finished`, and emits.

## 13. Final verification gate (must all be GREEN before claiming Plan 4d complete)

1. `pnpm build` clean.
2. `pnpm -C packages/roku-device-client test` — 296 PASS (no expected change).
3. `pnpm -C packages/rokudev-device test` — 184 PASS (no expected change).
4. `pnpm -C packages/brs-gen test` — ~325-335 PASS (305 baseline + ~20-30 new from snapshots + e2e + conflict + asset-reuse).
5. `TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs` is idempotent (re-run leaves goldens byte-equal).
6. `pnpm -C packages/brs-gen test` again — still all PASS (determinism check).
7. T27 Phase A `t27-music.mjs` PASS on real Roku at 10.128.160.241 (or operator-supplied IP).
8. T27 Phase B `t27-music.mjs` documented as deferred (operator-feed-override codepath verified via unit tests only at v1).
9. T27 `t27-video-grid.mjs` still PASS (regression).
10. T27 `t27-blank.mjs` still PASS (regression).
11. T27 `t27-news.mjs` Phase A still PASS (regression).
12. Secret-leak invariant: no new code path reads or echoes `dev_password` / `signing_password`.
13. README has "What's in v0.5.4 (Plan 4d)" section in chronological order.
14. MEMORY.md has Plan 4d COMPLETE block + pointer.

## 14. Risk surface + mitigations

| Risk | Mitigation |
|---|---|
| SoundHelix MP3 fetch over corp WiFi can hit 5-10s buffering on cold start | T27 step 8 allows `state in ['playing', 'buffering']` as a passing state; only fail on `error`. |
| `m.audio.seek` is silently a no-op while `state = buffering` | Defer scrubber actions to focus only when `state in ['playing', 'paused']`. UI: scrubber reads-only during buffering. |
| MiniBar-first-show race (channel restart mid-playback) | `m.miniBarVisibleSticky` is per-channel-process (resets on relaunch). Correct by design; T27 doesn't assert otherwise. |
| Auto-advance double-fire on `position` ticks | SceneGraph `observeField` only fires on value change; `state=finished` fires once per track end. Structurally safe. |
| Cross-component focus routing | Same risks as `news_channel`. PosterGrid is `MarkupGrid` (focusable directly via `setFocus`). MiniBar is a Group composite; focus its inner `playPause` Button via `findNode("playPause")`, not the Group. Documented in MainScene.bs comments. |
| ContentNode field name confusion (`url` vs `stream` vs `streamUrl`) | Per the v0.4 lesson: ContentNode has `url` (string) + `streamFormat` (string), no `stream`. NowPlayingScene loads tracks via `m.audioRef.content.url = track.audio_url` + `streamFormat = track.stream_format`. |
| HttpTask field-declaration trap | Per the v0.4 lesson: `<interface><field id="url"...>` is mandatory or the write is a silent no-op. HttpTask.xml declares both `url` and `result` fields. |
| Audio node lifecycle vs scene transitions | MainScene owns Audio. NowPlayingScene receives a node-typed reference at create time. On NowPlayingScene close, the reference goes out of scope but MainScene's `m.audio` retains the node, so playback continues. |
| Operator override of `feed_url` to a non-music-feed-shaped JSON | Schema-level: `MusicContentSchema` validates the spec; runtime: `MusicFeed_LoadBundled` returns invalid on parse error; MainScene shows `errorLabel`. No crash. |
| Cascade from D9 engine change | `service_name` is the only new content key threaded into TemplateConfig. The TemplateConfig emission gate is unchanged from Plan 4c, so no other templates' goldens cascade beyond the version-bump cascade (captured by the standard regen-ordering rule). |

## 15. Versioning + release notes

v0.5.4. Bump `package.json` (root) and `packages/brs-gen/package.json` from `0.5.3` to `0.5.4` BEFORE regenerating goldens (per the regen-ordering MEMORY rule). README appends "What's in v0.5.4 (Plan 4d)" section after "What's in v0.5.3 (Plan 4c)" in chronological order.

GitHub release notes summarize: new template, new init-hook export `NowPlayingScene/after_scene_show`, new content key `service_name`, T27 Phase A PASS evidence, Phase B deferred, regression status of prior templates.

## 16. Out of scope (deferred fix-forward to v0.5.4.x or later)

- Per-track art (currently shares playlist art across all tracks in queue)
- Categories above playlists
- Search, library / favorites, history
- Shuffle / repeat
- Lyric display / equalizer / spectrum
- Live HLS audio / streaming radio
- TimedMetadata observer (track-change announcements from server)
- Multi-room cast / Roku Audio Receiver integration
- Sleep timer
- Voice control
- Component sharing across templates (the `HttpTask` and `Feed` patterns are still re-authored per template at v1; extraction is a Plan 5+ concern)
- Phase B T27 (operator-feed-URL override on-device verification)

## 17. References

- Roku SceneGraph `Audio` node: https://developer.roku.com/docs/references/scenegraph/media-playback-nodes/audio.md
- Roku SceneGraph `MarkupGrid` (PosterGrid is a `MarkupGrid` skin in practice): https://developer.roku.com/docs/references/scenegraph/list-and-grid-nodes/markupgrid.md
- SoundHelix demo MP3s: https://www.soundhelix.com/audio-examples
- Prior plan 4 specs (load-bearing patterns inherited): `2026-05-09-plan-4-video-grid-template-design.md`, `2026-05-12-plan-4c-news-channel-design.md`
