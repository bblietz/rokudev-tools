# Plan 4b — `video_grid_channel` Polish Patch (Design)

**Date:** 2026-05-11
**Target release:** v0.5.1
**Status:** approved (brainstorming complete)

## 1. Goal

Polish `video_grid_channel` (the canonical "rich" v1 template) so it can be safely used as the basis for plans 4c–4e (news_channel, game_shell, music_player). Two surgical fixes; no engine changes; no API surface changes.

The polish-insistence rule (MEMORY.md, locked 2026-05-11) requires this work BEFORE any new template scaffolds from `video_grid_channel` patterns.

## 2. Locked decisions

| ID | Decision |
|---|---|
| D1 | Up-from-row-0 routes focus to a new focusable `<Button id="playButton">` child of HeroUnit. |
| D2 | Select on the hero button opens `DetailsScene` for the current hero item (pattern parity with RowList tile select). |
| D3 | Hero rotation interval = 5 seconds. |
| D4 | Hero rotation cap = 3 transitions (4 hero items shown over ~15 seconds), OR first user input — whichever comes first. |
| D5 | Rotation logic moves OUT of `HeroUnit.bs` into `MainScene.bs`. HeroUnit becomes a pure renderer with a `setHeroItem(node)` ifc func. |
| D6 | No new modules, no engine changes, no manifest changes. Polish stays inside the template files. |
| D7 | Release as v0.5.1 patch. `@rokudev/device-client` unchanged at 0.3.0. |

## 3. Non-goals

- Hero "live preview" mode (mirror currently-focused tile). Could land later as opt-in via template config.
- Configurable rotation interval / max transitions. Hardcoded for now; can be lifted later.
- Refactoring the broader scene composition (ContentNode shape, Feed.bs, RowList structure) — not in scope.
- Any new T27 driver assertions beyond Phase B (the new Up-from-row-0 + hero-button-Select paths).
- Promoting `video_grid_channel`'s polish-state into `blank_scenegraph` or any other template (each template is self-contained).

## 4. Architecture

Modify three template files:

- `HeroUnit.xml` — add focusable `<Button id="playButton">` child overlaid on the lower-left of the poster.
- `HeroUnit.bs` — strip rotation logic; add `setHeroItem(node)` interface function; add `currentItem` interface field.
- `MainScene.bs` — own rotation state; route Up/Down between RowList row-0 ↔ hero button via `onKeyEvent`; observe hero button's `buttonSelected` field to open Details.
- `MainScene.xml` — add `<Timer id="heroTimer" duration="5" repeat="true" />` to children; declare any needed `<interface>` fields on HeroUnit.

No `Main.bs`, `Feed.bs`, `HttpTask.{xml,bs}`, `DetailsScene.{xml,bs}`, or `PlayerScene.{xml,bs}` changes.

## 5. Component-level changes

### 5.1 `HeroUnit.xml`

Add a focusable Button child:

```xml
<Button
  id="playButton"
  text="▶ Play Now"
  translation="[60, 380]"
  minWidth="180"
/>
```

Position: lower-left of the 1800×450 hero composite, sitting on top of the existing scrim Rectangle so the focus ring is visible against any poster.

Declare an interface field exposing the current item so MainScene can read it:

```xml
<interface>
  <field id="currentItem" type="node" />
</interface>
```

(If HeroUnit's existing XML already has an `<interface>`, append the new field; do not duplicate the section.)

### 5.2 `HeroUnit.bs`

Remove:
- Any existing rotation timer setup or observer.
- Any code that mutates `m.titleLabel.text`, `m.descLabel.text`, `m.posterNode.uri` based on a timer-driven index.

Add:
```brightscript
sub setHeroItem(node as object) as void
  if node = invalid then return
  m.top.currentItem = node
  m.titleLabel.text = node.title
  m.descLabel.text = node.description
  m.posterNode.uri = node.HDPosterUrl
end sub
```

(Field names `titleLabel`/`descLabel`/`posterNode` are placeholders — match the existing names from the v0.4.2 HeroUnit.xml.)

The init() function does NOT call setHeroItem — the binding is driven by MainScene.

### 5.3 `MainScene.bs`

New module-level state on `m`:
- `m.heroItems` (roArray of ContentNode) — populated when feed loads.
- `m.heroIdx` (integer, default 0) — current hero index.
- `m.heroAutoCount` (integer, default 0) — number of timer-driven transitions so far.
- `m.userHasInteracted` (boolean, default false).

In existing `onFeedLoaded` (or equivalent) handler:
- Populate `m.heroItems` from feed data (slice of top-row items, length 4–6 per existing pattern).
- Set `m.heroIdx = 0`.
- Call `m.hero.callFunc("setHeroItem", m.heroItems[0])`.
- If `m.heroItems.count() >= 2 and not m.userHasInteracted`: `m.heroTimer.control = "start"`.

New `onHeroTimer` (observes `m.heroTimer.fire`):
```
if m.userHasInteracted then return
m.heroIdx = (m.heroIdx + 1) mod m.heroItems.count()
m.hero.callFunc("setHeroItem", m.heroItems[m.heroIdx])
m.heroAutoCount = m.heroAutoCount + 1
if m.heroAutoCount >= 3 then m.heroTimer.control = "stop"
```

Modify or add `onKeyEvent(key as string, press as boolean) as boolean`:
- On any keypress (`press = true`):
  - If not `m.userHasInteracted`: set `m.userHasInteracted = true`, `m.heroTimer.control = "stop"`.
- If `key = "up"` AND `press` AND focus is currently on RowList row 0:
  - Call `m.hero.findNode("playButton").setFocus(true)`.
  - Return true (consume key).
- If `key = "down"` AND `press` AND focus is currently on hero's playButton:
  - Call `m.rowList.setFocus(true)` (RowList re-enters at last-focused position; for a freshly-loaded scene that's row 0 col 0).
  - Return true.
- Default: return false (let SceneGraph handle the rest).

Determining "focus on row 0 of RowList": observe `m.rowList.itemFocused` (which is a `[row, col]` vector2d on RowList) and stash `m.rowListRow` for cheap check; OR call `m.rowList.itemFocused` directly inside `onKeyEvent`. Simpler: just check `m.rowList.itemFocused[0] = 0`.

Determining "focus on playButton": call `m.hero.findNode("playButton").hasFocus()`.

New observer on hero button's `buttonSelected` field (registered in init() after `m.hero` is found):
```
m.hero.findNode("playButton").observeField("buttonSelected", "onHeroButtonSelected")
```

`onHeroButtonSelected`:
```
if m.heroItems = invalid or m.heroItems.count() = 0 then return
openDetails(m.heroItems[m.heroIdx])
```

Where `openDetails(item)` is either an existing helper from v0.4.2 (preferred — DRY) or a small new helper that mirrors what `onItemSelected` does for RowList tile selection: createChild DetailsScene, cache the ref in `m.detailsRef`, observe close → remove via cached ref.

### 5.4 `MainScene.xml`

Add to children:

```xml
<Timer id="heroTimer" duration="5" repeat="true" />
```

The existing `<HeroUnit id="hero" />` reference is unchanged.

If MainScene.xml already declares observable interface fields for things like `focusedRow`, leave them as-is; we don't need new MainScene-level interface fields.

## 6. Data flow

```
Boot:
  Main.bs creates Scene
  → MainScene.init() runs
  → m.feedTask starts (existing)
  → eventually onFeedLoaded fires
    → populate m.heroItems
    → setHeroItem(m.heroItems[0])
    → if items.count() >= 2: m.heroTimer.control = "start"

Auto-rotation (no user input yet):
  m.heroTimer.fire (every 5s)
  → onHeroTimer
  → idx = (idx + 1) mod N
  → setHeroItem(items[idx])
  → m.heroAutoCount++; if >= 3: stop timer

User presses any key (first input):
  onKeyEvent
  → m.userHasInteracted = true; m.heroTimer.control = "stop"
  → (continue routing logic for the specific key)

User presses Up while on RowList row 0:
  onKeyEvent (key="up", row=0)
  → setFocus(playButton); return true

User presses Down while on playButton:
  onKeyEvent (key="down", focus=playButton)
  → setFocus(m.rowList); return true

User presses Select on playButton:
  Roku Button fires buttonSelected
  → onHeroButtonSelected
  → openDetails(items[heroIdx])
  → DetailsScene appears (existing path)
  → user presses Back → DetailsScene removed via cached m.detailsRef
  → focus returns to playButton (Roku default focus restoration)
```

## 7. Error handling

- `m.heroItems.count() == 0`: hide hero (`m.hero.visible = false`); skip timer start. Existing v0.4.2 hides the hero on empty feed already; preserve.
- `m.heroItems.count() == 1`: skip timer start (rotation pointless); hero shows the single item; Up-from-row-0 still routes to playButton (single item is still selectable).
- `m.heroItems.count() >= 2`: timer starts; auto-rotation runs ≤3 transitions or until first input.
- Hero button selected before feed loads: `m.heroItems = invalid` → guarded with `if m.heroItems <> invalid and m.heroItems.count() > 0` in `onHeroButtonSelected`.
- Roku Button has built-in focus styling; no manual focus-ring code needed.
- `m.rowList.itemFocused` may be `invalid` before first row is rendered; guard with `if m.rowList.itemFocused <> invalid`.

## 8. Testing

### 8.1 Snapshot tests
Existing `tests/__snapshots__/video_grid_channel/` files will change:
- `HeroUnit.xml.snap.txt` — adds `<Button>` and `<interface>` (if not previously declared).
- `MainScene.xml.snap.txt` — adds `<Timer>`.
- `MainScene.brs.snap.txt` — adds rotation/key handling logic.

Update via vitest's snapshot update flow (`pnpm -C packages/brs-gen test -u tests/snapshots.test.ts`).

### 8.2 Golden zip + provenance
`tests/__golden__/video-grid.zip` + `tests/__golden__/video-grid.provenance.json` will change. Regen under TZ=UTC via `TZ=UTC node packages/brs-gen/scripts/regen-golden.mjs`.

### 8.3 Unit-style integration test
Add one small test to `src/tools/generate-app.test.ts` (or `tests/snapshots.test.ts`) that asserts the generated `MainScene.brs` contains:
- The substring `m.heroTimer.control` (proves timer wiring is emitted).
- The substring `m.userHasInteracted` (proves first-input lifecycle).
- The substring `Modules_OnMainSceneAfterSceneShow` (regression: existing init hook still emitted alongside new logic).

This is a string-presence check, not a structural assertion. Cheap to maintain.

### 8.4 T27 driver — Phase B
Extend `packages/brs-gen/scripts/t27-video-grid.mjs` with a Phase B (Phase A is the existing 11-step happy path). Phase B steps:

1. After Phase A boot, send `Down` once → focus moves to row 1 tile.
2. Send `Up` once → focus returns to row 0 tile (default RowList behavior).
3. Send `Up` again → focus moves to hero playButton.
4. Take screenshot `b-01-hero-button-focused.png`. Assert no error overlay.
5. Send `Select` → DetailsScene opens.
6. Take screenshot `b-02-details-from-hero.png`. Assert no error overlay.
7. Send `Back` → DetailsScene removed; focus returns to hero playButton.
8. Take screenshot `b-03-back-to-hero.png`. Assert no error overlay.
9. Send `Down` → focus returns to RowList row 0.
10. Send `Home` → channel exits cleanly.

Operator-run; failure on any step exits non-zero. Existing `assertStep` helper from `_t27-lib.mjs` covers the pattern.

## 9. Release plan

| Step | Action |
|---|---|
| R1 | Implement template-file changes (5.1–5.4). |
| R2 | Run `pnpm -C packages/brs-gen test -u tests/snapshots.test.ts` to regenerate snapshots. |
| R3 | Run `TZ=UTC node packages/brs-gen/scripts/regen-golden.mjs` to regenerate goldens. |
| R4 | Add the small string-presence integration test (§8.3). |
| R5 | Add T27 Phase B (§8.4). |
| R6 | `pnpm -C packages/brs-gen build` — clean. |
| R7 | `TZ=UTC pnpm test` — all 759+ tests pass. |
| R8 | Operator runs `T27 video-grid` (Phase A regression + Phase B new). PASS gate before tag. |
| R9 | Bump root + brs-gen package.json 0.5.0 → 0.5.1. |
| R10 | Commit. Tag `v0.5.1`. Push. `gh release create`. |
| R11 | Update MEMORY.md: mark Plan 4b complete; record polish-now-clean state of video_grid_channel; capture any new patterns for plans 4c+. |

## 10. Verification gate (before tagging)

1. `TZ=UTC pnpm test` (monorepo) — all 759+ green.
2. `pnpm -C packages/brs-gen build` — clean compile.
3. T27 video-grid Phase A — 11/11 steps PASS (regression: existing flow unbroken).
4. T27 video-grid Phase B — new 10-ish steps PASS (Up-from-row-0 + hero-button-Select + Back round-trip + rotation visually paused after first input).
5. `git tag -a v0.5.1 -m "..."`; push tag + main; `gh release create v0.5.1`.

## 11. Open questions

None at design-approval time. Implementation may surface micro-questions (exact field names from v0.4.2 HeroUnit.bs, whether `openDetails` already exists as a helper or needs extraction); those land in the writing-plans phase.

## 12. Pointers

- Brainstorm session: `.superpowers/brainstorm/12309-1778547207/`
- Memory snapshot referenced: `MEMORY.md` (Plan 4 + 4a entries; reference-app polish insistence rule)
- Current video_grid_channel files: `packages/brs-gen/templates/video_grid_channel/files/components/{HeroUnit,MainScene}.{xml,bs}`
- T27 driver to extend: `packages/brs-gen/scripts/t27-video-grid.mjs`
- Goldens to regenerate: `packages/brs-gen/tests/__golden__/video-grid.{zip,provenance.json}`
