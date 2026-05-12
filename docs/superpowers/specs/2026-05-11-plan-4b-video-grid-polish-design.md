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
| D5 | Rotation logic stays in `MainScene.bs` (already there: `onRotateTick` + `m.rotateTimer`). The existing implementation is REPLACED with a capped + input-sensitive version. HeroUnit's existing `content`/`onContentChanged` field binding is preserved unchanged. |
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

- `HeroUnit.xml` — add focusable `<Button id="playButton">` child overlaid on the lower-left of the poster. Keep existing `<interface><field id="content" type="node" onChange="onContentChanged" /></interface>` unchanged.
- `MainScene.xml` — change existing `<Timer id="rotateTimer" duration="6" repeat="true" />` to `duration="5"`. No new Timer node added.
- `MainScene.bs` — replace existing `onRotateTick` body with a capped, input-sensitive variant; add `onKeyEvent` to route Up/Down between RowList row-0 ↔ hero button; observe hero button's `buttonSelected` field to open Details.

`HeroUnit.bs` is NOT modified — its existing `content`/`onContentChanged` pattern continues to work; MainScene continues to set `m.hero.content = node` to drive hero updates.

No `Main.bs`, `Feed.bs`, `HttpTask.{xml,bs}`, `DetailsScene.{xml,bs}`, or `PlayerScene.{xml,bs}` changes.

## 5. Component-level changes

### 5.1 `HeroUnit.xml`

Add a focusable Button child between the existing `<Label id="synopsis">` and the closing `</children>`:

```xml
<Button
  id="playButton"
  text="▶ Play Now"
  translation="[40, 388]"
  minWidth="220"
/>
```

Position: lower-left of the 1800×450 hero composite, slightly below the synopsis Label (which sits at translation `[40, 390]`) so the focus ring lifts cleanly above the scrim. Adjust translation if synopsis text overlap occurs in practice.

Keep the existing `<interface><field id="content" type="node" onChange="onContentChanged" /></interface>` block UNCHANGED. No new interface fields are needed — MainScene reads hero state from its own `m.heroIdx` + `m.rowList.content`.

### 5.2 `HeroUnit.bs` — UNCHANGED

`HeroUnit.bs` is NOT modified by this patch. The existing `init()` (which finds `m.poster`, `m.title`, `m.synopsis`) and `onContentChanged()` (which reads `m.top.content` and updates the three children) continue to work unchanged.

The new `playButton` child is reachable from MainScene via `m.hero.findNode("playButton")`. HeroUnit.bs does not need to do anything with it — Roku Button has built-in focus handling and emits `buttonSelected` natively.

### 5.3 `MainScene.bs`

The existing file (per v0.4.2) already has: `init()`, `onFeedState()`, `onRotateTick()`, `onItemSelected()`, `onDetailsClose()`. New code is **additive** to `init()` and replaces the body of `onRotateTick`; new functions added at the bottom.

**State additions on `m`** (initialized in `init()`):
- `m.userHasInteracted` (boolean, default `false`).
- `m.heroAutoCount` (integer, default `0`) — number of timer-driven transitions so far.
- (`m.heroIdx` already exists — initialized to 0 in `onFeedState` after feed loads.)

**`init()` — append after the existing `m.detailsRef = invalid` line:**
```brightscript
m.userHasInteracted = false
m.heroAutoCount = 0
```
(Do NOT register the playButton observer here — `m.hero` is found but `playButton` may not be reachable until the scene tree settles. Register inside `onFeedState` after `m.hero.content` is first set, OR use `m.hero.findNode("playButton").observeField("buttonSelected", "onHeroButtonSelected")` immediately after `m.hero = m.top.findNode("hero")` since findNode walks the static XML tree at init time. The latter is simpler — register in init.)

Concretely, in `init()` after `m.hero = m.top.findNode("hero")`:
```brightscript
m.heroPlayButton = m.hero.findNode("playButton")
m.heroPlayButton.observeField("buttonSelected", "onHeroButtonSelected")
```

**Replace existing `onRotateTick` body** with the capped + input-sensitive version:
```brightscript
sub onRotateTick()
  if m.userHasInteracted then return
  root = m.rowList.content
  if root = invalid or root.getChildCount() = 0 then return
  firstRow = root.getChild(0)
  n = firstRow.getChildCount()
  if n = 0 then return
  m.heroIdx = (m.heroIdx + 1) mod n
  m.hero.content = firstRow.getChild(m.heroIdx)
  m.heroAutoCount = m.heroAutoCount + 1
  if m.heroAutoCount >= 3 then m.rotateTimer.control = "stop"
end sub
```
(Note: rotation continues to use `m.hero.content = firstRow.getChild(...)` — the existing pattern. No `setHeroItem` callFunc.)

**Add new function `onKeyEvent`:**
```brightscript
function onKeyEvent(key as string, press as boolean) as boolean
  if not press then return false

  ' First-input lifecycle: stop auto-rotation permanently.
  if not m.userHasInteracted then
    m.userHasInteracted = true
    m.rotateTimer.control = "stop"
  end if

  ' Up from row 0 of RowList -> focus hero playButton.
  if key = "up" and m.rowList.hasFocus() then
    focused = m.rowList.itemFocused
    if focused <> invalid and focused[0] = 0 then
      m.heroPlayButton.setFocus(true)
      return true
    end if
  end if

  ' Down from playButton -> focus RowList (returns to row 0).
  if key = "down" and m.heroPlayButton.hasFocus() then
    m.rowList.setFocus(true)
    return true
  end if

  return false
end function
```

**Add new function `onHeroButtonSelected`:**
```brightscript
sub onHeroButtonSelected()
  root = m.rowList.content
  if root = invalid or root.getChildCount() = 0 then return
  firstRow = root.getChild(0)
  if firstRow.getChildCount() = 0 then return
  item = firstRow.getChild(m.heroIdx)

  ' Mirrors onItemSelected: createChild + cache ref + observe close.
  details = m.top.createChild("DetailsScene")
  details.observeField("close", "onDetailsClose")
  details.content = item
  details.setFocus(true)
  m.detailsRef = details
end sub
```

(Existing `onDetailsClose` already does `m.rowList.setFocus(true)` after removing the Details child. From hero-button-Select → Back, this routes focus back to the RowList instead of the hero button. That matches Roku conventions for a content-browsing channel; if user wants focus to return to the hero button instead, this is a small follow-up for a later patch — out of scope for v0.5.1.)

### 5.4 `MainScene.xml`

ONE change: existing `<Timer id="rotateTimer" duration="6" repeat="true" />` becomes `<Timer id="rotateTimer" duration="5" repeat="true" />`. No new Timer added; no rename.

All other XML structure (`background`, `hero`, `rowList`, `loadingLabel`, `errorLabel`, the script tags, the Scene-extending root) remains unchanged.

## 6. Data flow

```
Boot:
  Main.bs creates Scene
  → MainScene.init() runs
    → m.userHasInteracted = false; m.heroAutoCount = 0
    → m.heroPlayButton observer registered
    → Modules_OnMainSceneBeforeContentLoad(m)
    → m.feedTask started

Feed loads:
  onFeedState (existing)
  → m.rowList.content = parsed root
  → Modules_OnMainSceneAfterContentLoad(m)
  → m.hero.content = firstRow.getChild(0)   ' seeds hero
  → Modules_OnMainSceneAfterHeroLoad(m)
  → m.loadingLabel.visible = false
  → m.rotateTimer.observeField("fire", "onRotateTick")
  → m.rotateTimer.control = "start"
  → m.heroIdx = 0
  → m.rowList.setFocus(true)

Auto-rotation (no user input yet):
  m.rotateTimer.fire (every 5s)
  → onRotateTick (new body)
  → if m.userHasInteracted: return
  → idx = (idx + 1) mod n
  → m.hero.content = firstRow.getChild(idx)   ' triggers HeroUnit.onContentChanged
  → m.heroAutoCount++; if >= 3: m.rotateTimer.control = "stop"

User presses any key (first input):
  onKeyEvent (any key, press=true)
  → m.userHasInteracted = true; m.rotateTimer.control = "stop"
  → (continue routing logic for the specific key)

User presses Up while on RowList row 0:
  onKeyEvent (key="up", m.rowList.hasFocus(), itemFocused[0]=0)
  → m.heroPlayButton.setFocus(true); return true

User presses Down while on playButton:
  onKeyEvent (key="down", m.heroPlayButton.hasFocus())
  → m.rowList.setFocus(true); return true

User presses Select on playButton:
  Roku Button fires buttonSelected
  → onHeroButtonSelected
  → createChild DetailsScene; cache as m.detailsRef
  → details.content = firstRow.getChild(m.heroIdx)
  → details.setFocus(true)
  → user presses Back → DetailsScene close → onDetailsClose
  → m.top.removeChild(m.detailsRef); m.detailsRef = invalid
  → m.rowList.setFocus(true)   ' (existing behavior; not playButton)
```

## 7. Error handling

- Empty feed (`m.rowList.content.getChildCount() == 0`): existing behavior — error label shows "Feed load failed" or stays in loading. Hero is never seeded; rotateTimer never starts (existing onFeedState gates this). New code is unchanged here.
- First row empty (`firstRow.getChildCount() == 0`): existing onRotateTick guards this with early return; new body preserves the guard.
- Hero button selected before feed loads: guarded inside `onHeroButtonSelected` via `root = invalid or root.getChildCount() = 0` early return. Up/Down routing also tolerates this — `hasFocus()` checks return false until focus is established.
- `m.rowList.itemFocused` may be `invalid` before first row is rendered: guarded with `if focused <> invalid` inside `onKeyEvent`.
- Roku Button has built-in focus styling; no manual focus-ring code needed.
- `m.heroPlayButton` registered in init() — at init time the static XML tree is fully resolved, so `findNode("playButton")` always succeeds. No nil-check needed at registration; if it ever did fail, `observeField` would crash and the bug would be loud.

## 8. Testing

### 8.1 Snapshot tests
Existing snapshot files at `packages/brs-gen/tests/__snapshots__/video-grid/` (note the **hyphen** in `video-grid/`, not `video_grid_channel`) will change:
- `HeroUnit.xml.snap.txt` — adds the new `<Button id="playButton">` child.
- `MainScene.xml.snap.txt` — Timer duration changes from `"6"` to `"5"`.

There are NO `.brs` snapshots in the existing harness — only XML snapshots. The new `onKeyEvent` / `onHeroButtonSelected` / replaced `onRotateTick` logic in `MainScene.bs` is NOT directly snapshot-tested; coverage comes from the string-presence integration test in §8.3 + the e2e golden zip diff (which captures compiled `.brs` bytes).

Update snapshots via vitest's `-u` flag: `pnpm -C packages/brs-gen test -u tests/snapshots.test.ts`.

### 8.2 Golden zip + provenance
`tests/__golden__/video-grid.zip` + `tests/__golden__/video-grid.provenance.json` will change. Regen under TZ=UTC via `TZ=UTC node packages/brs-gen/scripts/regen-golden.mjs`.

### 8.3 Unit-style integration test
Add one small test to `src/tools/generate-app.test.ts` (or `tests/snapshots.test.ts`) that asserts the generated `MainScene.brs` (post-compile) contains:
- The substring `m.userHasInteracted` (proves first-input lifecycle is emitted).
- The substring `m.heroAutoCount` (proves transition-cap is emitted).
- The substring `onHeroButtonSelected` (proves new handler is emitted).
- The substring `m.heroPlayButton.setFocus` OR `findNode("playButton")` (proves Up-routing is emitted).
- The substring `Modules_OnMainSceneBeforeContentLoad` (regression: existing init hook still emitted alongside new logic).
- The substring `Modules_OnMainSceneAfterContentLoad` (regression: existing post-feed hook).
- The substring `Modules_OnMainSceneAfterHeroLoad` (regression: existing post-hero hook).

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
| R1 | Implement template-file changes (5.1, 5.3, 5.4). HeroUnit.bs is unchanged (5.2). |
| R2 | Run `pnpm -C packages/brs-gen test -u tests/snapshots.test.ts` to update snapshots in `tests/__snapshots__/video-grid/`. |
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
