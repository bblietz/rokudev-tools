# Plan 4b — `video_grid_channel` Polish Patch (v0.5.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the `video_grid_channel` reference template so Up-from-row-0 routes to a focusable hero "Play Now" Button (which Selects into Details), and so hero auto-rotation pauses on first user input and after at most 3 timer transitions. Ship as v0.5.1.

**Architecture:** Surgical, template-only patch. Three template files change: `HeroUnit.xml` adds a `<Button id="playButton">` child; `MainScene.xml` bumps `<Timer id="rotateTimer">` duration from `"6"` to `"5"`; `MainScene.bs` replaces `onRotateTick` body and adds `onKeyEvent` + `onHeroButtonSelected`. `HeroUnit.bs` is unchanged. No engine code, no module work, no `@rokudev/device-client` change. Snapshots + goldens regenerate.

**Tech Stack:** TypeScript (Vitest), BrightScript / SceneGraph (template files), `pnpm`, `yazl`-based deterministic zip pipeline, T27 real-device verification driver via `@rokudev/device-client`.

**Spec:** `docs/superpowers/specs/2026-05-11-plan-4b-video-grid-polish-design.md` (commit `d1ff4c5`).

**Polish-insistence rule (MEMORY.md, locked 2026-05-11):** This plan must complete BEFORE any new template (4c news_channel, 4d game_shell, 4e music_player) scaffolds from `video_grid_channel` patterns. Do not skip the operator T27 verification gate.

---

## File Structure

| File | Action | Purpose |
|---|---|---|
| `packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml` | Modify | Add `<Button id="playButton">` child between `<Label id="synopsis">` and `</children>`. |
| `packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.bs` | UNCHANGED | Existing `init()` + `onContentChanged()` continue to drive title/synopsis/poster. |
| `packages/brs-gen/templates/video_grid_channel/files/components/MainScene.xml` | Modify | One-attribute change: `<Timer id="rotateTimer" duration="6" />` → `duration="5"`. |
| `packages/brs-gen/templates/video_grid_channel/files/components/MainScene.bs` | Modify | Add state init in `init()`, register playButton observer, replace `onRotateTick` body, add `onKeyEvent` + `onHeroButtonSelected`. |
| `packages/brs-gen/tests/snapshots.test.ts` | Modify | Add a string-presence regression test inside the existing `describe('video_grid_channel snapshots', ...)` block. |
| `packages/brs-gen/tests/__snapshots__/video-grid/HeroUnit.xml.snap.txt` | Regenerate | Reflects the new Button child. |
| `packages/brs-gen/tests/__snapshots__/video-grid/MainScene.xml.snap.txt` | Regenerate | Reflects the new Timer duration. |
| `packages/brs-gen/tests/__golden__/video-grid.zip` | Regenerate | Byte-equal golden under `TZ=UTC`. |
| `packages/brs-gen/tests/__golden__/video-grid.provenance.json` | Regenerate | Provenance updates for the new template content bytes. |
| `packages/brs-gen/scripts/t27-video-grid.mjs` | Modify | Add Phase B (Up-routing + hero-button-Select + Back round-trip + Down-routing). |
| `packages/brs-gen/package.json` | Modify | Bump `version` from `0.5.0` → `0.5.1`. |
| `package.json` (root) | Modify | Bump `version` from `0.5.0` → `0.5.1`. |
| `MEMORY.md` (`~/.claude/projects/.../memory/`) | Append | Record Plan 4b complete; note any new traps observed. |

**No new files. No deletions. No engine changes.**

---

## Pre-flight (verify clean baseline)

- [ ] **Step 0.1: Confirm clean working tree**

Run: `git -C /Users/bblietz/Work/ClaudeProjects/rokudev-tools status --short`
Expected: empty output (no uncommitted changes).

- [ ] **Step 0.2: Confirm baseline tests are green**

Run: `cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools && TZ=UTC pnpm -C packages/brs-gen test`
Expected: all suites green (`Test Files  N passed (N)`). Note the count for later sanity checks (current baseline ≈ 279 tests in brs-gen).

- [ ] **Step 0.3: Confirm baseline build is clean**

Run: `pnpm -C packages/brs-gen build`
Expected: `tsc` exits 0, no errors. (Required because `regen-golden.mjs` consumes `dist/`.)

---

## Task 1: Add the failing regression test

**Files:**
- Modify: `packages/brs-gen/tests/snapshots.test.ts` (extend the existing `describe('video_grid_channel snapshots', ...)` block, currently lines 198–269)

This test asserts post-compile `MainScene.brs` contains the new behavior's signature substrings AND preserves the three existing `Modules_OnMainScene*` init-hook firings. It also asserts post-compile `HeroUnit.xml` contains the new Button child.

The test will FAIL before any template changes — that proves it's wired correctly. Then the implementation tasks below take it green.

- [ ] **Step 1.1: Add the failing test**

In `packages/brs-gen/tests/snapshots.test.ts`, inside the existing `describe('video_grid_channel snapshots', ...)` block (alongside the existing `it('manifest matches saved snapshot', ...)` etc., near the bottom of the block — after the `it('files listing ...', ...)` test), append:

```typescript
  it('MainScene.brs contains Plan 4b polish behavior + preserves init hooks', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.brs'), 'utf8');

    // Plan 4b additions: first-input lifecycle + transition cap.
    expect(s).toContain('m.userHasInteracted');
    expect(s).toContain('m.heroAutoCount');

    // Plan 4b additions: hero-button Select handler + Up-routing wiring.
    expect(s).toContain('onHeroButtonSelected');
    expect(s).toContain('m.heroPlayButton');

    // Regression: existing module-opt init-hook firings must still emit.
    expect(s).toContain('Modules_OnMainSceneBeforeContentLoad');
    expect(s).toContain('Modules_OnMainSceneAfterContentLoad');
    expect(s).toContain('Modules_OnMainSceneAfterHeroLoad');
  });

  it('HeroUnit.xml contains the playButton child (Plan 4b)', async () => {
    const s = await readFile(join(projectDir, 'components/HeroUnit.xml'), 'utf8');
    expect(s).toContain('id="playButton"');
  });
```

- [ ] **Step 1.2: Run the new tests, verify they FAIL**

Run: `cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools && TZ=UTC pnpm -C packages/brs-gen test tests/snapshots.test.ts -t "Plan 4b"`
Expected: 2 failing tests. The error messages should mention the missing substrings (`m.userHasInteracted`, `id="playButton"`, etc.). If they pass, the test is wired wrong (or you accidentally already changed templates). Stop and re-verify.

- [ ] **Step 1.3: Commit the failing test**

Note: snapshots.test.ts is the only changed file at this point. Existing snapshots and other tests are unchanged.

```bash
cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools
git add packages/brs-gen/tests/snapshots.test.ts
git commit -m "test(brs-gen): add Plan 4b regression test (failing) for video_grid_channel polish

Asserts post-compile MainScene.brs contains the new state vars
(m.userHasInteracted, m.heroAutoCount), the new handler
(onHeroButtonSelected), and the Up-routing wiring (m.heroPlayButton),
while still emitting the three existing Modules_OnMainScene* init
hook firings. Also asserts HeroUnit.xml contains id=\"playButton\".

These tests will fail until Tasks 2–4 land the template changes."
```

---

## Task 2: HeroUnit.xml — add focusable Button child

**Files:**
- Modify: `packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml`

The synopsis Label sits at `translation="[40, 390]"`. The new Button overlays slightly below it at `[40, 388]` with `minWidth="220"`. Roku's built-in Button has native focus styling — no manual ring code needed.

- [ ] **Step 2.1: Add the Button child**

Open `packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml`. Between the existing `<Label id="synopsis" ... />` (line 12) and `</children>` (line 13), insert:

```xml
    <Button
      id="playButton"
      text="▶ Play Now"
      translation="[40, 388]"
      minWidth="220"
    />
```

Indent with 4 spaces (matching the surrounding `<Poster>`, `<Rectangle>`, and `<Label>` siblings). Do NOT modify the `<interface>` block, the `<script>` tag, or any existing child.

- [ ] **Step 2.2: Verify the file shape**

Run: `cat /Users/bblietz/Work/ClaudeProjects/rokudev-tools/packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml`
Expected: 13 lines became 19; new Button block is between `<Label id="synopsis"...>` and `</children>`. The `<interface>` block is unchanged. The `<script type="text/brightscript" uri="HeroUnit.bs" />` line is unchanged.

- [ ] **Step 2.3: Run the HeroUnit Plan 4b test, verify it now PASSES**

Run: `cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools && TZ=UTC pnpm -C packages/brs-gen test tests/snapshots.test.ts -t "playButton"`
Expected: the `HeroUnit.xml contains the playButton child` test passes. The MainScene.brs Plan 4b test still fails (Task 4 fixes that). Many *other* snapshot tests in the same file will now fail because the HeroUnit.xml.snap.txt no longer matches — that's expected; Task 5 regenerates snapshots.

---

## Task 3: MainScene.xml — bump rotation interval

**Files:**
- Modify: `packages/brs-gen/templates/video_grid_channel/files/components/MainScene.xml:21`

One attribute change. No new node, no rename.

- [ ] **Step 3.1: Change Timer duration**

Open `packages/brs-gen/templates/video_grid_channel/files/components/MainScene.xml`. On line 21, change:

```xml
    <Timer id="rotateTimer" duration="6" repeat="true" />
```

to:

```xml
    <Timer id="rotateTimer" duration="5" repeat="true" />
```

Do NOT change the `id`, the `repeat` attribute, or any other element.

- [ ] **Step 3.2: Verify the change**

Run: `grep -n rotateTimer /Users/bblietz/Work/ClaudeProjects/rokudev-tools/packages/brs-gen/templates/video_grid_channel/files/components/MainScene.xml`
Expected: exactly one line with `<Timer id="rotateTimer" duration="5" repeat="true" />`.

(There is no test assertion for this duration alone; coverage comes from the snapshot in Task 5 + the regenerated golden in Task 6.)

---

## Task 4: MainScene.bs — state, observer, rotation cap, key handler, button handler

**Files:**
- Modify: `packages/brs-gen/templates/video_grid_channel/files/components/MainScene.bs`

Four edits to the same file. After all four, the Plan 4b string-presence test from Task 1 should go green.

The current file (90 lines) has: `init()`, `onFeedState()`, `onRotateTick()`, `onItemSelected()`, `onDetailsClose()`. We extend `init()`, replace the body of `onRotateTick`, and append two new functions.

**Why register `m.heroPlayButton` in `init()` (not in `onFeedState`)**: HeroUnit's static XML tree is fully resolved by the time `init()` runs, so `m.hero.findNode("playButton")` succeeds. Keeping observer registration alongside the other findNode wiring keeps related setup grouped.

- [ ] **Step 4.1: Extend `init()` with state vars + playButton observer**

In `MainScene.bs`, locate the `init()` sub (lines 1–17). Insert after line 6 (`m.errorLabel = m.top.findNode("errorLabel")`) and before line 7 (`m.detailsRef = invalid`):

```brightscript
  m.heroPlayButton = m.hero.findNode("playButton")
  m.heroPlayButton.observeField("buttonSelected", "onHeroButtonSelected")
```

Then, after the existing `m.detailsRef = invalid` line, insert:

```brightscript
  m.userHasInteracted = false
  m.heroAutoCount = 0
```

After this step, `init()` reads (in order): `m.hero`, `m.rowList`, `m.rotateTimer`, `m.loadingLabel`, `m.errorLabel`, `m.heroPlayButton` + observe, `m.detailsRef = invalid`, `m.userHasInteracted = false`, `m.heroAutoCount = 0`, then the existing `Modules_OnMainSceneBeforeContentLoad(m)` and feedTask kickoff.

- [ ] **Step 4.2: Replace `onRotateTick` body**

Locate the existing `onRotateTick` sub (lines 56–64 of the pre-Plan-4b file). Replace ITS BODY ONLY with the capped + input-sensitive variant. The `sub onRotateTick()` / `end sub` framing stays. Resulting function:

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

(Compared to the existing body: adds `if m.userHasInteracted then return` at the top, adds the `m.heroAutoCount` increment + stop-at-3 at the bottom. Middle lines are identical.)

- [ ] **Step 4.3: Append `onKeyEvent`**

At the end of the file (after `end sub` of `onDetailsClose`), append a blank line and:

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

(Note: `onKeyEvent` on a Scene fires for every keypress before the focused child handles it. Returning `true` consumes the event; `false` bubbles through. Roku Button's native Up/Down behavior will not move focus by itself, so our `false` returns are safe.)

- [ ] **Step 4.4: Append `onHeroButtonSelected`**

Immediately after `end function` of `onKeyEvent`, append a blank line and:

```brightscript
sub onHeroButtonSelected()
  root = m.rowList.content
  if root = invalid or root.getChildCount() = 0 then return
  firstRow = root.getChild(0)
  if firstRow.getChildCount() = 0 then return
  item = firstRow.getChild(m.heroIdx)

  ' Mirrors onItemSelected: createChild + cache ref + observe close.
  ' findNode is id-only (memory.md trap); always cache the createChild
  ' return so onDetailsClose can remove the correct instance.
  details = m.top.createChild("DetailsScene")
  details.observeField("close", "onDetailsClose")
  details.content = item
  details.setFocus(true)
  m.detailsRef = details
end sub
```

- [ ] **Step 4.5: Verify the file shape**

Run: `wc -l /Users/bblietz/Work/ClaudeProjects/rokudev-tools/packages/brs-gen/templates/video_grid_channel/files/components/MainScene.bs`
Expected: ~120-ish lines (90 baseline + ~28 new + a few blank-line separators).

Run: `grep -nE "^(sub|function) " /Users/bblietz/Work/ClaudeProjects/rokudev-tools/packages/brs-gen/templates/video_grid_channel/files/components/MainScene.bs`
Expected: 7 entries — `init`, `onFeedState`, `onRotateTick`, `onItemSelected`, `onDetailsClose`, `onKeyEvent`, `onHeroButtonSelected`.

- [ ] **Step 4.6: Run the Plan 4b regression test, verify all assertions PASS**

Run: `cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools && TZ=UTC pnpm -C packages/brs-gen test tests/snapshots.test.ts -t "Plan 4b"`
Expected: both Plan 4b tests pass:
- `MainScene.brs contains Plan 4b polish behavior + preserves init hooks` ✓
- `HeroUnit.xml contains the playButton child (Plan 4b)` ✓

If a substring assertion fails, re-check that the corresponding sub-step landed verbatim — string-presence is exact. Common gotcha: if `m.heroPlayButton.setFocus` got transpiled to a different shape, the `m.heroPlayButton` substring still appears (no nested mangling), so the assertion is robust.

The other video_grid_channel snapshot tests (manifest, MainScene.xml, HeroUnit.xml, files-listing, template-config.brs) WILL still fail at this point because their `.snap.txt` files don't match the new content. Task 5 fixes that.

- [ ] **Step 4.7: Commit Tasks 2–4 together**

```bash
cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools
git add packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml \
        packages/brs-gen/templates/video_grid_channel/files/components/MainScene.xml \
        packages/brs-gen/templates/video_grid_channel/files/components/MainScene.bs
git commit -m "feat(template/video_grid): focusable hero playButton + capped rotation

HeroUnit.xml: add Button id=\"playButton\" child overlaying lower-left
of the poster (translation [40, 388]). Roku Button is natively
focusable + emits buttonSelected.

MainScene.xml: rotateTimer duration 6 -> 5 (per spec D3).

MainScene.bs:
- init: cache m.heroPlayButton + register buttonSelected observer;
  add m.userHasInteracted = false, m.heroAutoCount = 0.
- onRotateTick: bail if user interacted; cap at 3 transitions then
  stop the timer (per spec D4).
- onKeyEvent: any keypress sets m.userHasInteracted = true and
  stops the timer; Up from RowList row 0 focuses playButton; Down
  from playButton returns focus to RowList.
- onHeroButtonSelected: opens DetailsScene for the current hero item
  using the same createChild + cache-ref pattern as onItemSelected
  (avoids the v0.4.2 findNode-by-id trap for removal).

HeroUnit.bs unchanged (existing content/onContentChanged binding
continues to drive title/synopsis/poster).

After Back from Details opened via hero button, focus returns to
RowList row 0 (existing onDetailsClose), per spec D8.

Refs spec d1ff4c5."
```

---

## Task 5: Regenerate snapshots

**Files:**
- Regenerate: `packages/brs-gen/tests/__snapshots__/video-grid/HeroUnit.xml.snap.txt`
- Regenerate: `packages/brs-gen/tests/__snapshots__/video-grid/MainScene.xml.snap.txt`
- (Possibly): `files-listing.snap.txt`, `template-config.brs.snap.txt`, `manifest.snap.txt` — none should change in content; verify.

Vitest's `-u` flag rewrites file snapshots in place. We run only the snapshots test file to limit blast radius, then diff to confirm only the expected files changed.

- [ ] **Step 5.1: Capture pre-regen state**

Run: `git -C /Users/bblietz/Work/ClaudeProjects/rokudev-tools status --short packages/brs-gen/tests/__snapshots__/`
Expected: empty (no uncommitted changes inside snapshots after Task 4 commit).

- [ ] **Step 5.2: Update snapshots**

Run: `cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools && TZ=UTC pnpm -C packages/brs-gen test tests/snapshots.test.ts -u`
Expected: all snapshot tests pass; vitest reports `N snapshots updated` (typically 2).

- [ ] **Step 5.3: Verify only the expected snapshots changed**

Run: `git -C /Users/bblietz/Work/ClaudeProjects/rokudev-tools status --short packages/brs-gen/tests/__snapshots__/`
Expected: ONLY `HeroUnit.xml.snap.txt` and `MainScene.xml.snap.txt` are modified (under `video-grid/`). If `manifest.snap.txt`, `files-listing.snap.txt`, or `template-config.brs.snap.txt` shows up as modified, STOP — that means an unintended side-effect crept in (e.g., a new file got emitted, or branding output changed). Investigate before continuing.

- [ ] **Step 5.4: Eyeball the new HeroUnit snapshot**

Run: `cat /Users/bblietz/Work/ClaudeProjects/rokudev-tools/packages/brs-gen/tests/__snapshots__/video-grid/HeroUnit.xml.snap.txt`
Expected: contains `<script type="text/brightscript" uri="HeroUnit.brs" />` (post-compile sweep, intentional), the existing `<interface>`, the four existing children (Poster, scrim Rectangle, title Label, synopsis Label), AND the new `<Button id="playButton" ... />` child between synopsis and `</children>`.

- [ ] **Step 5.5: Eyeball the new MainScene snapshot**

Run: `grep -n rotateTimer /Users/bblietz/Work/ClaudeProjects/rokudev-tools/packages/brs-gen/tests/__snapshots__/video-grid/MainScene.xml.snap.txt`
Expected: exactly one line with `duration="5"`.

- [ ] **Step 5.6: Commit the snapshot updates**

```bash
cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools
git add packages/brs-gen/tests/__snapshots__/video-grid/
git commit -m "test(brs-gen): regen video-grid snapshots for Plan 4b template changes

HeroUnit.xml.snap.txt: adds <Button id=\"playButton\" ... /> child.
MainScene.xml.snap.txt: rotateTimer duration 6 -> 5.

No other snapshot files changed (manifest, files-listing,
template-config.brs are content-stable across this patch)."
```

---

## Task 6: Regenerate goldens

**Files:**
- Regenerate: `packages/brs-gen/tests/__golden__/video-grid.zip`
- Regenerate: `packages/brs-gen/tests/__golden__/video-grid.provenance.json`

`regen-golden.mjs` consumes the built `dist/`, so we rebuild first. The script forces `TZ=UTC` internally (line 28) but we set it on the command line too as belt-and-suspenders — yazl 2.5.x's local-time DOS mtime encoding is the load-bearing reason.

`stub.zip` and `blank.zip` should NOT change (Plan 4b only touches video_grid_channel files); verify with diff.

- [ ] **Step 6.1: Rebuild brs-gen**

Run: `cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools && pnpm -C packages/brs-gen build`
Expected: `tsc` exits 0; no errors.

- [ ] **Step 6.2: Capture pre-regen state**

Run: `git -C /Users/bblietz/Work/ClaudeProjects/rokudev-tools status --short packages/brs-gen/tests/__golden__/`
Expected: empty.

- [ ] **Step 6.3: Regenerate**

Run: `cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools && TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs`
Expected: `Golden files regenerated: ... (six files listed)`. The script always rewrites all six (stub, video-grid, blank ×2 each).

- [ ] **Step 6.4: Verify only video-grid goldens changed**

Run: `git -C /Users/bblietz/Work/ClaudeProjects/rokudev-tools status --short packages/brs-gen/tests/__golden__/`
Expected: ONLY `video-grid.zip` and `video-grid.provenance.json` are modified. `stub.*` and `blank.*` should be unchanged on disk (regen rewrites them but with byte-identical content). If they show modified, the regen ran in a non-UTC TZ (sanity-check `echo $TZ` in your shell) OR an unrelated file change drifted into the merger; investigate.

- [ ] **Step 6.5: Eyeball the new provenance**

Run: `cat /Users/bblietz/Work/ClaudeProjects/rokudev-tools/packages/brs-gen/tests/__golden__/video-grid.provenance.json | head -c 400`
Expected: starts with `{"brs_gen_version":"0.3.0-dev.0",...}` — note the in-tree dev version constant, not the package.json version. (Provenance brs_gen_version is hardcoded in `regen-helper.mjs`; bumping package.json to 0.5.1 in Task 9 will NOT change provenance bytes.)

- [ ] **Step 6.6: Run the e2e test, verify byte-equal goldens**

Run: `cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools && TZ=UTC pnpm -C packages/brs-gen test tests/e2e.test.ts -t "video_grid_channel produces byte-equal"`
Expected: passes. (This is the canonical byte-equality assertion: spec D9 / §11.5.)

- [ ] **Step 6.7: Commit the golden updates**

```bash
cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools
git add packages/brs-gen/tests/__golden__/video-grid.zip \
        packages/brs-gen/tests/__golden__/video-grid.provenance.json
git commit -m "test(brs-gen): regen video-grid goldens for Plan 4b

Cause: HeroUnit.xml gains <Button id=\"playButton\" ... /> child;
MainScene.xml rotateTimer duration 6 -> 5; MainScene.bs gains
onKeyEvent + onHeroButtonSelected + capped onRotateTick. Compiled
.brs bytes shift accordingly.

stub.{zip,provenance.json} and blank.{zip,provenance.json}
unchanged (Plan 4b only touches video_grid_channel files).

Regen command: TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs"
```

---

## Task 7: Full test sweep

- [ ] **Step 7.1: Run the entire monorepo test suite**

Run: `cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools && TZ=UTC pnpm test`
Expected: all 761+ tests across `@rokudev/device-client` + `rokudev-device` + `brs-gen` pass. New baseline = baseline + 2 (the two Plan 4b tests added in Task 1).

If anything fails:
- Conflict-matrix or determinism tests: indicates the merger inputs shifted unexpectedly. Re-check Tasks 2–4 didn't introduce trailing whitespace or BOM changes.
- e2e Plan 4 byte-equal goldens: indicates the regen step (Task 6) ran in a non-UTC TZ.
- snapshots: indicates Task 5 missed a file or Task 4 introduced unexpected output.

- [ ] **Step 7.2: Run the build cleanly**

Run: `cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools && pnpm -C packages/brs-gen build`
Expected: clean compile.

- [ ] **Step 7.3: Run prettier check**

Run: `cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools && pnpm format:check`
Expected: clean. (If snapshot files trip prettier, they should already be in `.prettierignore` — investigate, do NOT add them silently.)

(No commit yet — Task 8 adds T27 Phase B; we want the next commit to bundle the driver change with it.)

---

## Task 8: T27 driver — add Phase B

**Files:**
- Modify: `packages/brs-gen/scripts/t27-video-grid.mjs`

The existing driver runs Phase A (sideload + nav + Details + post-play screenshot + Home). We add Phase B BEFORE the existing `Step 7: Home` block. Phase B exercises Up-from-row-0 → playButton focus → Select → Details → Back → RowList → Up again → playButton → Down → RowList. Then the existing Home step closes out.

After this change there's only one Home step at the end of the script — Phase B replaces what was step 7.

- [ ] **Step 8.1: Locate the insertion point**

In `packages/brs-gen/scripts/t27-video-grid.mjs`, find the existing block (around line 134–137):

```javascript
  // Step 7: Home.
  await assertStep('press Home', () => keypress(host, 'Home'));

  console.log('\nT27 PASS. Screenshots:', screensDir);
```

The new Phase B steps go BEFORE the `// Step 7: Home.` comment.

- [ ] **Step 8.2: Insert Phase B steps**

Insert this block immediately before `// Step 7: Home.`:

```javascript
  // ============================================================
  // Phase B (Plan 4b): Up-from-row-0 + hero playButton + Back.
  // ============================================================
  // After Phase A's "select (play)" we're inside the PlayerScene-or-overlay.
  // Press Back twice to unwind to MainScene with focus on RowList row 0.
  // (PlayerScene Back -> DetailsScene; DetailsScene Back fires close ->
  // MainScene.onDetailsClose -> m.rowList.setFocus(true).)
  //
  // OPERATOR NOTE: if `b-01-hero-button-focused.png` does NOT show the
  // playButton focused, the unwind landed somewhere else (e.g. PlayerScene
  // swallowed Back). Re-run the driver with `Home` + relaunch in place of
  // these two Back presses, then `Up` immediately. Track this as a Phase B
  // preamble bug separate from the Up-routing being verified.
  await assertStep('back to row (Phase B setup)', () => keypressRepeat(host, 'Back', 2));
  await sleep(800);

  // Step B1: Up from RowList row 0 -> focuses hero playButton.
  await assertStep('up to hero playButton', () => keypress(host, 'Up'));
  await sleep(500);
  await assertStep('b-01 hero button focused (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'b-01-hero-button-focused.png')),
  );

  // Step B2: Select on hero playButton -> opens DetailsScene.
  await assertStep('select on hero playButton', () => keypress(host, 'Select'));
  await sleep(1200);
  await assertStep('b-02 details from hero (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'b-02-details-from-hero.png')),
  );

  // Step B3: Back -> DetailsScene removed; focus returns to RowList row 0
  // (per spec D8 / existing onDetailsClose; NOT playButton).
  await assertStep('back from details', () => keypress(host, 'Back'));
  await sleep(800);
  await assertStep('b-03 back from details (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'b-03-back-from-details.png')),
  );

  // Step B4: Up again -> focus moves back to hero playButton (proves
  // Up-routing still works after Details round-trip).
  await assertStep('up to hero playButton again', () => keypress(host, 'Up'));
  await sleep(500);
  await assertStep('b-04 hero button refocused (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'b-04-hero-button-refocused.png')),
  );

  // Step B5: Down -> focus returns to RowList row 0 (proves Down-routing
  // from playButton).
  await assertStep('down to row list', () => keypress(host, 'Down'));
  await sleep(500);
  await assertStep('b-05 back on row list (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'b-05-back-on-row-list.png')),
  );
```

The existing `// Step 7: Home.` block stays unchanged below this insertion.

- [ ] **Step 8.3: Verify the driver still parses**

Run: `node --check /Users/bblietz/Work/ClaudeProjects/rokudev-tools/packages/brs-gen/scripts/t27-video-grid.mjs`
Expected: exits 0 with no output. (Pure syntax check — no Roku required.)

- [ ] **Step 8.4: Commit the driver change**

```bash
cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools
git add packages/brs-gen/scripts/t27-video-grid.mjs
git commit -m "test(brs-gen): T27 Phase B for Plan 4b — Up-routing + hero button

After Phase A's nav + Details + post-play, presses Back x2 to return
to MainScene with focus on RowList row 0, then exercises:

  B1: Up           -> focus moves to hero playButton (NEW)
  B2: Select       -> DetailsScene opens (NEW path)
  B3: Back         -> Details removed; focus returns to RowList row 0
                      (per spec D8, NOT playButton)
  B4: Up again     -> focus back to playButton (regression: Up-routing
                      still works after a Details round-trip)
  B5: Down         -> focus returns to RowList (Down-routing from button)

Each step screenshots and asserts the error-overlay heuristic.
Existing Home step unchanged.

Operator-run; ROKUDEV_HOST + ROKUDEV_DEV_PASSWORD env required."
```

---

## Task 9: Operator T27 verification gate (PAUSE for human)

This task cannot be completed by an automated subagent. The operator (a human with a real Roku in dev mode on the same LAN) runs the T27 driver and confirms PASS before we tag.

If you (the subagent / Claude) reach this task, output the instructions below and STOP. The user runs them and reports back.

- [ ] **Step 9.1: Operator pre-flight**

The operator confirms:
- Roku is in developer mode at a known IP, dev password = `1234` (or noted otherwise).
- Roku is on the same LAN as the workstation.
- "Settings → System → Advanced system settings → Control by mobile apps" is set to Default or Enabled. (Limited mode 403s on `/keypress/*` per memory.md.)

- [ ] **Step 9.2: Operator runs T27**

Operator runs:

```bash
cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools
ROKUDEV_HOST=<roku-ip> ROKUDEV_DEV_PASSWORD=1234 \
  node packages/brs-gen/scripts/t27-video-grid.mjs
```

Expected: `T27 PASS.` with the screenshots dir printed. All Phase A + Phase B steps log as `passed`. Operator exit code = 0.

- [ ] **Step 9.3: Operator inspects screenshots**

Operator opens the printed screenshots directory and visually confirms:
- `01-home.png` — hero unit + RowList visible; no error overlay.
- `02-row.png` — RowList tile focused (purple/white outline).
- `03-details.png` — DetailsScene overlay visible.
- `04-post-play.png` — PlayerScene OR "no stream URL" overlay (acceptable per existing T27 caveat).
- `b-01-hero-button-focused.png` — `▶ Play Now` button visible with focus styling.
- `b-02-details-from-hero.png` — DetailsScene overlay (same as `03-details.png` but reached from hero).
- `b-03-back-from-details.png` — back to MainScene; RowList row 0 has focus (NOT playButton).
- `b-04-hero-button-refocused.png` — playButton focused again after Up.
- `b-05-back-on-row-list.png` — RowList row 0 has focus after Down.

If any visual check fails, the operator reports the discrepancy + screenshot before tagging. Common micro-issues: Button overlaps synopsis text → adjust translation in HeroUnit.xml, re-snapshot, re-regen, re-T27.

- [ ] **Step 9.4: Auto-rotation visual confirmation (manual observation)**

Without pressing any key, operator watches the hero unit for ~20 seconds AFTER initial render BUT BEFORE the driver's first keypress. Confirms:
- Hero unit content rotates ~3 times (every 5s ish) then STOPS.
- Once a single keypress is sent (driver's `Down` in step 4), rotation does NOT resume.

(This isn't an assertion the driver can make — `screenshotNoError` doesn't compare frames over time. Pure operator eyeballing.)

- [ ] **Step 9.5: Operator confirms PASS to proceed**

Operator says "T27 PASS, proceed with release" (or equivalent). Until then, do NOT proceed to Task 10.

---

## Task 10: Version bump + release

Once the operator has confirmed Step 9.5, ship.

- [ ] **Step 10.1: Bump root + brs-gen package versions**

In `package.json` (root): change `"version": "0.5.0"` → `"version": "0.5.1"`.
In `packages/brs-gen/package.json`: change `"version": "0.5.0"` → `"version": "0.5.1"`.

Do NOT bump `packages/roku-device-client/` or `packages/rokudev-device/` (per spec D7).

- [ ] **Step 10.2: Re-run release-prep**

Run: `cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools && TZ=UTC pnpm release-prep`
Expected: format-check + lint + typecheck + test + build all green. (No new tests added; just confirms the version bump didn't drift anything.)

- [ ] **Step 10.3: Commit version bump**

```bash
cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools
git add package.json packages/brs-gen/package.json
git commit -m "chore(release): bump rokudev-tools to 0.5.1 (Plan 4b video_grid polish)

@rokudev/device-client (0.3.0) and rokudev-device (0.2.0) unchanged.
brs-gen 0.5.0 -> 0.5.1; root 0.5.0 -> 0.5.1.

Plan 4b ships:
- HeroUnit gains focusable Button id=\"playButton\" (▶ Play Now).
- Up from RowList row 0 routes focus to playButton.
- Down from playButton returns focus to RowList.
- Select on playButton opens DetailsScene for current hero item.
- Hero auto-rotation interval bumped 6s -> 5s.
- Auto-rotation stops permanently on first user input AND caps at
  3 transitions, whichever comes first.
- T27 driver gains Phase B (5 new keypress steps + 5 new screenshots).

T27 video-grid Phase A + Phase B PASS on operator hardware
(Roku Ultra firmware 15.x).

Refs spec docs/superpowers/specs/2026-05-11-plan-4b-video-grid-polish-design.md
(commit d1ff4c5)."
```

- [ ] **Step 10.4: Tag and push**

```bash
cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools
git tag -a v0.5.1 -m "v0.5.1 — Plan 4b video_grid_channel polish patch"
git push origin main
git push origin v0.5.1
```

- [ ] **Step 10.5: Create GitHub release**

```bash
cd /Users/bblietz/Work/ClaudeProjects/rokudev-tools
gh release create v0.5.1 --title "v0.5.1 — Plan 4b video_grid polish" --notes "$(cat <<'EOF'
## Plan 4b — `video_grid_channel` polish patch

Surgical polish of the canonical "rich" v1 template so it can serve as the basis for plans 4c–4e (news_channel, game_shell, music_player) without propagating UX gaps. Template-only patch; no engine, no API surface, no `@rokudev/device-client` change.

### Changes

- `HeroUnit` gains a focusable `<Button id="playButton">` child (`▶ Play Now`, lower-left of the poster).
- `MainScene` `onKeyEvent` routes Up from RowList row 0 to the hero playButton, and Down from playButton back to the RowList.
- Select on the playButton opens DetailsScene for the current hero item (mirrors RowList tile select).
- Hero auto-rotation interval: 6s → 5s.
- Auto-rotation stops permanently on first user input AND caps at 3 timer-driven transitions (whichever comes first).
- T27 driver gains Phase B (5 new keypress steps + 5 new screenshots) verifying Up-routing, hero-button-Select, Back round-trip, and Down-routing.

### Behavior preserved

- After Back from a Details overlay opened via the hero button, focus returns to RowList row 0 (existing `onDetailsClose` behavior). Re-routing Back to playButton is a follow-up for a later patch.
- HeroUnit's existing `content` / `onContentChanged` field binding is unchanged.
- Three `Modules_OnMainScene*` init-hook firings preserved (regression-tested in `snapshots.test.ts`).

### Verification

- `pnpm test` — all 761+ tests green (baseline + 2 new Plan 4b regression tests).
- `pnpm -C packages/brs-gen build` — clean.
- T27 video-grid Phase A (regression: 11 steps) + Phase B (5 new steps) — PASS on Roku Ultra firmware 15.x.

### Versions

- `rokudev-tools` (root): 0.5.0 → 0.5.1
- `brs-gen`: 0.5.0 → 0.5.1
- `@rokudev/device-client`: 0.3.0 (unchanged)
- `rokudev-device`: 0.2.0 (unchanged)

Spec: `docs/superpowers/specs/2026-05-11-plan-4b-video-grid-polish-design.md`.
EOF
)"
```

- [ ] **Step 10.6: Confirm release URL**

Run: `gh release view v0.5.1 --json url -q .url`
Expected: prints the release URL (e.g. `https://github.com/.../releases/tag/v0.5.1`).

---

## Task 11: Update MEMORY.md

**Files:**
- Append to: `/Users/bblietz/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md`

Capture the Plan 4b completion in the "Implementation status" section, parallel to the Plan 4 / Plan 4a entries. Note any new traps observed during implementation.

- [ ] **Step 11.1: Add Plan 4b entry to MEMORY.md**

Read the current MEMORY.md and locate the `**Plan 4a COMPLETE 2026-05-11**` block. Insert a new block immediately after it, following the same shape:

```markdown
- **Plan 4b COMPLETE <YYYY-MM-DD>**. Tag `v0.5.1` on `origin`. 761+ tests passing. Plan 4b shipped the `video_grid_channel` polish patch (focusable hero playButton + capped auto-rotation).
  - **Template changes only** — HeroUnit.xml gains `<Button id="playButton">`; MainScene.xml `rotateTimer duration` 6→5; MainScene.bs gains state vars (`m.userHasInteracted`, `m.heroAutoCount`, `m.heroPlayButton`), replaces `onRotateTick` body with capped + input-sensitive variant, adds `onKeyEvent` (Up/Down routing between RowList row 0 and playButton; first-input lifecycle stops the timer), adds `onHeroButtonSelected` (opens DetailsScene mirroring `onItemSelected` createChild + cache-ref + observe-close pattern).
  - **HeroUnit.bs unchanged** — existing `content`/`onContentChanged` field binding still drives title/synopsis/poster. MainScene continues to set `m.hero.content = node`.
  - **Focus-return-from-Details policy locked**: after Back from Details opened via playButton-Select, focus returns to RowList row 0 (existing `onDetailsClose` does `m.rowList.setFocus(true)`), NOT playButton. Re-routing Back to playButton is a deferred follow-up; out of scope for v0.5.1.
  - **Roku Button is natively focusable + emits `buttonSelected`** — no manual focus-ring code, no manual key-handling. `m.heroPlayButton.observeField("buttonSelected", "onHeroButtonSelected")` wires Select.
  - **`onKeyEvent` on a Scene fires for every keypress before the focused child handles it.** Returning `true` consumes; `false` bubbles. Roku Button's native Up/Down behavior doesn't move focus on its own, so returning `false` from our handler is safe.
  - **String-presence regression test pattern** (added to `snapshots.test.ts` `video_grid_channel snapshots` block): assert post-compile `MainScene.brs` contains the new state-var names + handler names, AND preserves the three `Modules_OnMainScene*` init-hook firings. Cheap to maintain; catches accidental deletion of either the new behavior or the existing module-opt extension points.
  - **T27 Phase B added** to `t27-video-grid.mjs`: 5 new keypress steps (Up→playButton, Select→Details, Back→RowList, Up→playButton, Down→RowList) with 5 screenshots (`b-01..b-05`). Phase A (existing 11-step happy path) still gates regression. Operator runs `Back x2` between Phase A and Phase B to unwind from PlayerScene/overlay back to MainScene.
  - The polish-insistence rule (locked 2026-05-11) is now SATISFIED for video_grid_channel. Plan 4c (news_channel) can scaffold from this template's patterns without propagating known UX gaps.
```

(Replace `<YYYY-MM-DD>` with today's date when the operator confirms PASS.)

- [ ] **Step 11.2: If new traps were observed during implementation, append them**

If Tasks 4–10 surfaced any unexpected behavior (e.g., `onKeyEvent` doesn't fire as expected, Button focus styling is wrong on certain firmwares, snapshot regen produced surprising output, etc.), append a bullet to the existing "Plan 4 latent traps + load-bearing discoveries" section in MEMORY.md. Match the existing tone: name the trap, give the diagnostic signal, give the fix.

If nothing new surfaced, no bullets to add.

- [ ] **Step 11.3: Save (no commit — MEMORY.md is outside the repo)**

The MEMORY.md edit doesn't go through git. The Write tool persists it directly.

---

## Verification gate (final, before declaring Plan 4b complete)

All five must be true:

1. `git status --short` is empty inside `/Users/bblietz/Work/ClaudeProjects/rokudev-tools` (no leftover changes).
2. `git tag --list v0.5.1` lists the tag.
3. `gh release view v0.5.1` succeeds.
4. `TZ=UTC pnpm test` is green.
5. Operator confirmed T27 video-grid Phase A + Phase B PASS.

If all five hold, Plan 4b is done. Recommend the user start the brainstorming cycle for Plan 4c (news_channel).

---

## Open questions / known deferrals

None at plan-write time. Spec §11 lists none open. Implementation may surface micro-questions (e.g., exact Button text rendering on a specific firmware, focus-ring offset tuning); those land as inline tweaks during Task 4 or Task 9 visual review.

Deferred follow-ups (NOT in v0.5.1):
- Re-routing Back-from-Details (when opened via playButton) to focus playButton instead of RowList. Spec D8.
- Configurable rotation interval / max transitions in spec.content.
- Hero "live preview" mode (mirror currently-focused tile).

These are tracked in spec §3 (Non-goals) and §11 (Open questions); pick up in a future patch if the user requests.
