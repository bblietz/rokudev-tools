# Plan 4b.1: T27 honesty + HeroUnit Y-overlap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land two follow-ups from the v0.5.1 release notes (stronger T27 render-completeness check + `video_grid_channel` HeroUnit Y-overlap fix) so `news_channel` (Plan 4c) can be scaffolded without inheriting known UX/test bugs.

**Architecture:** Test-infra change — extend `_t27-lib.mjs` so `screenshotNoError` calls a new `assertActiveAppIsOurs(host)` foreground check before its existing size heuristic. Template change — restack `HeroUnit.xml` children inside the bottom scrim with no overlaps. Driver migration — replace `t27-video-grid.mjs` Phase B preamble's `keypressRepeat('Back', 2)` (which can pop the channel) with a deterministic `sideloadAndLaunch` reset.

**Tech Stack:** TypeScript / Node 20 monorepo (pnpm workspaces, Turbo), Vitest (file-based snapshots + byte-equal goldens via yazl 2.5.x with `TZ=UTC`), brighterscript (`bsc`) compile, `@rokudev/device-client` (ECP + dev-portal HTTP).

**Spec:** `docs/superpowers/specs/2026-05-12-plan-4b1-t27-honesty-and-hero-overlap-design.md`

**Predecessor commit:** `2960c5e` (release v0.5.1)
**Target release:** `v0.5.2`

---

## File map

| Path | Change | Reason |
|---|---|---|
| `packages/brs-gen/scripts/_t27-lib.mjs` | Modify | Add `assertActiveAppIsOurs` + extend `screenshotNoError` signature |
| `packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml` | Modify (3 Y-coord lines) | Eliminate title↔synopsis and synopsis↔playButton overlaps |
| `packages/brs-gen/scripts/t27-video-grid.mjs` | Modify (Phase B preamble + comment) | Deterministic reset replaces flaky `Back x2` |
| `packages/brs-gen/tests/__snapshots__/video-grid/HeroUnit.xml.snap.txt` | Regen | Captures the new XML literal |
| `packages/brs-gen/tests/__golden__/video-grid.zip` | Regen | HeroUnit bytes change → zip bytes change |
| `packages/brs-gen/tests/__golden__/video-grid.provenance.json` | Regen | HeroUnit hash + `brs_gen_version` change |
| `packages/brs-gen/tests/__golden__/stub.provenance.json` | Regen | Only `brs_gen_version` delta |
| `packages/brs-gen/tests/__golden__/blank.provenance.json` | Regen | Only `brs_gen_version` delta |
| `packages/brs-gen/tests/__golden__/stub.zip` | Regen | Provenance inside zip differs (`brs_gen_version`) |
| `packages/brs-gen/tests/__golden__/blank.zip` | Regen | Provenance inside zip differs (`brs_gen_version`) |
| `package.json` (root) | Bump | `0.5.1 → 0.5.2` |
| `packages/brs-gen/package.json` | Bump | `0.5.1 → 0.5.2` (provenance reads this) |
| `README.md` | Append | v0.5.2 release notes |
| `MEMORY.md` | Append | Plan 4b.1 COMPLETE block |

**No changes** to: `_t27-lib.mjs` callers other than the one driver line (default-on opts param keeps every existing call site working unchanged), `blank_scenegraph` template, `stub_hello` template, any module, any non-`video-grid` snapshot, BDP / device-client packages.

---

## Task ordering rationale

Per spec §5: source edits → version bump → snapshot regen → golden regen. Two reasons the bump goes BEFORE the regens:
- Provenance reads `brs_gen_version` from `package.json` at catalog-load time. Regen first then bump → goldens drift from package metadata.
- Single dedicated commit for the bump keeps the release-engineering signal clean.

---

## Task 1: Establish clean baseline at v0.5.1

**Files:** none modified.

- [ ] **Step 1.1: Confirm working tree is clean and at the v0.5.1 release commit**

```bash
git status
git log -1 --oneline
```

Expected:
- `git status` → "nothing to commit, working tree clean"
- `git log -1 --oneline` → starts with `2960c5e chore(release): bump rokudev-tools to 0.5.1`

If not at `2960c5e` (e.g. spec docs were committed after), confirm the only intermediate commits are spec/plan docs and not source. Run `git log --oneline 2960c5e..HEAD` — every line should be a `docs(plan-4b1):` commit.

- [ ] **Step 1.2: Verify baseline release-prep is green**

```bash
pnpm release-prep
```

Expected: all stages (format:check + lint + typecheck + test + build) green. If any stage fails at this baseline, STOP and surface — Plan 4b.1 changes are not the cause.

- [ ] **Step 1.3: Note baseline test count**

```bash
pnpm --filter brs-gen test 2>&1 | grep -E "(Test Files|Tests)"
```

Expected: `Test Files  N passed (N)` and `Tests  281 passed (281)` (or current actual count). Record the number; this is what we expect to still pass after the patch (no new tests added per D7).

---

## Task 2: T27 helper — `assertActiveAppIsOurs` + `screenshotNoError` opts param

**Files:**
- Modify: `packages/brs-gen/scripts/_t27-lib.mjs`

Per spec D1 + D2 + D9: add a private `assertActiveAppIsOurs(host)` helper with one retry after 250ms, and extend `screenshotNoError(host, password, outPath, opts={assertForeground: true})` to call it before the existing size check. No unit tests added (D7 — `_t27-lib.mjs` is a real-device driver helper; coverage is on-device).

- [ ] **Step 2.1: Add `assertActiveAppIsOurs` private helper**

In `packages/brs-gen/scripts/_t27-lib.mjs`, immediately after the `keypressRepeat` function (currently ends at line 54) and before the `screenshot` function (currently starts at line 60), insert:

```js
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
```

- [ ] **Step 2.2: Extend `screenshotNoError` with `opts.assertForeground` (default true)**

Replace the existing `screenshotNoError` (currently lines 73-81) with:

```js
/**
 * Like screenshot(), but throws if either:
 *   1. opts.assertForeground (default true) and active-app id !== 'dev'
 *      (caller can opt out for genuine transition steps, e.g. mid-relaunch)
 *   2. saved file is too small to plausibly be a healthy rendered frame
 *      (heuristic per spec D11). An error overlay on 1280x720 serializes
 *      to ~8-12 KB; healthy UIs are typically 40 KB+.
 *
 * Per spec 4b.1 D2 the foreground check is the primary defense against
 * Plan 4b's false-positive class (Roku home / Debug menu / wrong app
 * passing the byte-size heuristic).
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
```

- [ ] **Step 2.3: Smoke-check the file imports cleanly**

```bash
node --input-type=module -e "import('./packages/brs-gen/scripts/_t27-lib.mjs').then(m => { console.log('exports:', Object.keys(m).sort().join(',')); console.log('screenshotNoError arity:', m.screenshotNoError.length); })"
```

Expected output (exact):
```
exports: ERROR_OVERLAY_MAX_BYTES,assertPlaybackStarts,assertPositionAdvanced,keypress,keypressRepeat,screenshot,screenshotNoError,sideloadAndLaunch,sleep
screenshotNoError arity: 3
```

(`arity` is 3 because the optional `opts` parameter has a default value — JS `function.length` excludes parameters with defaults. This is correct behavior.)

If the import throws a SyntaxError, fix the syntax and re-run.

- [ ] **Step 2.4: Run brs-gen tests to confirm no regression**

```bash
pnpm --filter brs-gen test
```

Expected: all 281 tests still pass (the helper is not exercised by any unit test). If any tests fail, the helper modification has a syntax/import error — fix and re-run.

- [ ] **Step 2.5: Commit**

```bash
git add packages/brs-gen/scripts/_t27-lib.mjs
git commit -m "$(cat <<'EOF'
feat(brs-gen/t27): active-app foreground assertion in screenshotNoError

Per spec 4b.1 D1+D2+D9:
- New private assertActiveAppIsOurs(host) helper with 1-retry @250ms
- screenshotNoError(..., opts={assertForeground: true}) calls it before size check
- Default-on; existing call sites unchanged
- Caller can opt out via {assertForeground: false} for transition steps

Catches Plan 4b's false-positive class: Roku home / Debug overlay /
wrong-app sail through the byte-size heuristic but now fail loudly
on the active-app check.

No unit tests added (D7: _t27-lib.mjs is real-device driver helper).

EOF
)"
```

---

## Task 3: HeroUnit Y-coord fix (template source)

**Files:**
- Modify: `packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml`

Per spec D4: title Y=290, synopsis Y=345, playButton Y=386. Vertical rhythm 50/41/64; button bottom 386+64 = 450 sits exactly at scrim bottom Y=450 (no overshoot).

- [ ] **Step 3.1: Edit title Y from 340 to 290**

In `packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml` line 11, change:

```xml
<Label id="title" translation="[40, 340]" width="1100" font="font:LargeBoldSystemFont" color="0xFFFFFFFF" />
```

to:

```xml
<Label id="title" translation="[40, 290]" width="1100" font="font:LargeBoldSystemFont" color="0xFFFFFFFF" />
```

- [ ] **Step 3.2: Edit synopsis Y from 390 to 345**

Line 12, change:

```xml
<Label id="synopsis" translation="[40, 390]" width="1100" color="0xCCCCCCFF" wrap="true" />
```

to:

```xml
<Label id="synopsis" translation="[40, 345]" width="1100" color="0xCCCCCCFF" wrap="true" />
```

- [ ] **Step 3.3: Edit playButton translation Y from 388 to 386**

Line 18, change:

```xml
      translation="[40, 388]"
```

to:

```xml
      translation="[40, 386]"
```

- [ ] **Step 3.4: Run snapshot test, EXPECT FAILURE on HeroUnit.xml.snap.txt**

```bash
pnpm --filter brs-gen test snapshots
```

Expected: 1 (or 2) snapshot failure(s) referencing `HeroUnit.xml.snap.txt`. Vitest output should show the diff with three lines changed (Y values 340→290, 390→345, 388→386). If the diff shows ANYTHING ELSE, STOP and investigate — the EJS render or compile step may have regressed.

- [ ] **Step 3.5: Run all brs-gen tests for full damage report**

```bash
pnpm --filter brs-gen test 2>&1 | tail -30
```

Expected failures: only the HeroUnit snapshot AND the e2e golden-zip byte-equal test (because video-grid.zip's HeroUnit bytes changed). Other tests should still pass. Note the failure list — these are the tests that Tasks 6 + 7 will fix via regen.

- [ ] **Step 3.6: Commit (source change only — no snapshot/golden regen yet)**

```bash
git add packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml
git commit -m "$(cat <<'EOF'
fix(template/video_grid): HeroUnit Y-overlap (title/synopsis/playButton)

Per spec 4b.1 D4: vertical stack inside scrim band 280-450:
  - title    Y=290 (was 340)
  - synopsis Y=345 (was 390)
  - playButton translation [40, 386] (was [40, 388])

Vertical rhythm 50/41/64. Button bottom 386+64=450 sits exactly at
scrim bottom Y=450 — no scrim overshoot. Synopsis-button gap is 3px
(tight but preserved) per user direction.

Snapshot + golden regen in follow-up commits.

EOF
)"
```

---

## Task 4: Driver migration — Phase B preamble

**Files:**
- Modify: `packages/brs-gen/scripts/t27-video-grid.mjs`

Per spec D5: replace the `keypressRepeat('Back', 2)` preamble (which can pop the channel out to Roku home, the Plan 4b false-positive root cause) with a deterministic `sideloadAndLaunch` reset to MainScene/RowList row 0.

- [ ] **Step 4.1: Replace Phase B preamble lines 135-149**

In `packages/brs-gen/scripts/t27-video-grid.mjs`, replace lines 135-149 (currently the Phase B comment block + `await assertStep('back to row (Phase B setup)', () => keypressRepeat(host, 'Back', 2));`) with:

```js
  // ============================================================
  // Phase B (Plan 4b): Up-from-row-0 + hero playButton + Back.
  // ============================================================
  // Per spec 4b.1 D5: re-sideload + launch to deterministically reset
  // to MainScene with focus on RowList row 0. Replaces the v0.5.1
  // `keypressRepeat('Back', 2)` preamble, which could pop the channel
  // out to Roku home if PlayerScene swallowed Back (caused the v0.5.1
  // T27 false-positive: every subsequent screenshot was Roku home,
  // not our channel). screenshotNoError's new active-app check would
  // catch this now anyway, but a deterministic reset is the proper
  // fix.
  await assertStep('reset to MainScene (Phase B setup)', () =>
    sideloadAndLaunch(outputZip, host, password),
  );
  await sleep(5000); // match Phase A's post-launch hydration window
```

(`outputZip` is already in scope from line 52.)

- [ ] **Step 4.2: Confirm the file still parses as ESM**

```bash
node --check packages/brs-gen/scripts/t27-video-grid.mjs
```

Expected: no output (success). If a SyntaxError appears, fix it.

- [ ] **Step 4.3: Run brs-gen tests to confirm no regression from this driver edit**

```bash
pnpm --filter brs-gen test
```

Expected: same set of failures as Step 3.5 (HeroUnit snapshot + golden) — driver edit doesn't add new failures (drivers are not unit-tested).

- [ ] **Step 4.4: Commit**

```bash
git add packages/brs-gen/scripts/t27-video-grid.mjs
git commit -m "$(cat <<'EOF'
fix(brs-gen/t27): Phase B preamble re-sideloads instead of Back×2

Per spec 4b.1 D5: replace keypressRepeat('Back', 2) with
sideloadAndLaunch(outputZip, ...) for a deterministic reset to
MainScene/RowList row 0. Eliminates the v0.5.1 false-positive root
cause where Back×2 could pop the channel out to Roku home (then
every subsequent screenshot captured system UI but passed the size
heuristic).

Wall-clock cost: +5s (re-sideload + 5s hydration sleep). Acceptable
for a manual/CI verification gate.

EOF
)"
```

---

## Task 5: Version bump 0.5.1 → 0.5.2

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/brs-gen/package.json`

Done as a separate commit so the release-engineering signal is clean. MUST happen before golden regen because provenance reads `brs_gen_version` from `package.json` at catalog-load time.

- [ ] **Step 5.1: Bump root package.json**

In `/Users/bblietz/Work/ClaudeProjects/rokudev-tools/package.json` line 4, change:

```json
"version": "0.5.1",
```

to:

```json
"version": "0.5.2",
```

- [ ] **Step 5.2: Bump brs-gen package.json**

In `packages/brs-gen/package.json` line 3, change:

```json
"version": "0.5.1",
```

to:

```json
"version": "0.5.2",
```

- [ ] **Step 5.3: Confirm version is read correctly**

```bash
node -e "console.log(require('./package.json').version, require('./packages/brs-gen/package.json').version)"
```

Expected: `0.5.2 0.5.2`

- [ ] **Step 5.4: Commit**

```bash
git add package.json packages/brs-gen/package.json
git commit -m "$(cat <<'EOF'
chore(release): bump rokudev-tools to 0.5.2

Plan 4b.1: T27 honesty + HeroUnit Y-overlap.

Snapshot + golden regen in follow-up commits (provenance reads
brs_gen_version from package.json so version bump must precede regen
per memory lesson).

EOF
)"
```

---

## Task 6: Snapshot regen for HeroUnit.xml.snap.txt

**Files:**
- Modify (regen): `packages/brs-gen/tests/__snapshots__/video-grid/HeroUnit.xml.snap.txt`

Snapshot file does NOT include `brs_gen_version`, so version bump alone wouldn't change it; only the HeroUnit.xml source change does.

- [ ] **Step 6.1: Confirm snapshot is currently failing**

```bash
pnpm --filter brs-gen test snapshots 2>&1 | grep -A 3 "HeroUnit.xml"
```

Expected: a snapshot mismatch reporting the three Y-value lines as the diff. If anything other than the three Y-value lines appears in the diff, STOP and investigate.

- [ ] **Step 6.2: Regenerate snapshots in update mode**

```bash
pnpm --filter brs-gen test snapshots -u
```

Expected: PASS, snapshot files updated.

- [ ] **Step 6.3: Verify the snapshot file's diff is exactly 3 lines**

```bash
git diff --stat packages/brs-gen/tests/__snapshots__/
git diff packages/brs-gen/tests/__snapshots__/video-grid/HeroUnit.xml.snap.txt
```

Expected: only `HeroUnit.xml.snap.txt` modified. The diff should show exactly three changed lines: title `340→290`, synopsis `390→345`, playButton `388→386`. Any other modified snapshot file is a red flag — investigate before committing.

- [ ] **Step 6.4: Run all brs-gen tests, expect golden e2e to STILL fail (regen comes in Task 7)**

```bash
pnpm --filter brs-gen test 2>&1 | tail -15
```

Expected: snapshots all pass; e2e golden test still fails (`video-grid.zip` byte mismatch). This is correct intermediate state.

- [ ] **Step 6.5: Commit**

```bash
git add packages/brs-gen/tests/__snapshots__/video-grid/HeroUnit.xml.snap.txt
git commit -m "$(cat <<'EOF'
test(brs-gen): regen HeroUnit.xml snapshot for Plan 4b.1

Captures the three Y-value edits from Task 3:
  title Y=290 (was 340), synopsis Y=345 (was 390),
  playButton Y=386 (was 388).

EOF
)"
```

---

## Task 7: Golden regen (zip + provenance for stub, blank, video-grid)

**Files:**
- Modify (regen): `packages/brs-gen/tests/__golden__/{stub,blank,video-grid}.zip`
- Modify (regen): `packages/brs-gen/tests/__golden__/{stub,blank,video-grid}.provenance.json`

All three goldens regen because provenance includes `brs_gen_version` (now 0.5.2) — `stub.zip` and `blank.zip` deltas are provenance-only; `video-grid.zip` also has the HeroUnit.xml byte change.

- [ ] **Step 7.1: Build brs-gen (regen-golden requires populated `dist/`)**

```bash
pnpm -C packages/brs-gen build
```

Expected: `tsc -p tsconfig.json` exits 0; `packages/brs-gen/dist/index.js` exists.

- [ ] **Step 7.2: Run the regen script with TZ=UTC (REQUIRED for byte equality)**

```bash
TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs
```

Expected output: ends with the "Golden files regenerated" banner listing all six paths. If `TZ=UTC` is omitted, generated zips will not byte-match an e2e run that uses `TZ=UTC`.

- [ ] **Step 7.3: Diff stub + blank provenance — only delta should be `brs_gen_version`**

```bash
git diff packages/brs-gen/tests/__golden__/stub.provenance.json
git diff packages/brs-gen/tests/__golden__/blank.provenance.json
```

Expected for each: a single field changes from `"brs_gen_version":"0.5.1"` to `"brs_gen_version":"0.5.2"`. If ANY OTHER field differs (file hash, file count, manifest content), STOP — that indicates accidental contamination from unrelated working-tree drift (per spec §5 step 7 sanity check).

- [ ] **Step 7.4: Diff video-grid provenance — expected delta is `brs_gen_version` + HeroUnit.xml hash**

```bash
git diff packages/brs-gen/tests/__golden__/video-grid.provenance.json
```

Expected diff: `brs_gen_version` field changes 0.5.1 → 0.5.2, AND the file-hash entry for `components/HeroUnit.xml` changes. No other deltas. If other file hashes change, investigate (e.g. did the EJS render of another file leak a side-effect?).

- [ ] **Step 7.5: Spot-check video-grid.zip — only HeroUnit.xml content should differ**

```bash
mkdir -p /tmp/4b1-zip-check && cd /tmp/4b1-zip-check
unzip -o "$OLDPWD/packages/brs-gen/tests/__golden__/video-grid.zip" -d new >/dev/null
git -C "$OLDPWD" show HEAD~6:packages/brs-gen/tests/__golden__/video-grid.zip > old.zip
unzip -o old.zip -d old >/dev/null
diff -r old new
cd "$OLDPWD"
rm -rf /tmp/4b1-zip-check
```

(Adjust `HEAD~6` to whatever points to the v0.5.1 video-grid.zip — typically the bump commit's parent. Use `git log --oneline -- packages/brs-gen/tests/__golden__/video-grid.zip | head -2` to find the prior version commit.)

Expected diff output: exactly two files differ:
- `components/HeroUnit.xml` (the 3 Y values)
- `.rokudev-tools/provenance.json` (brs_gen_version + HeroUnit hash)

If any other file differs, STOP — there's contamination.

- [ ] **Step 7.6: Run all brs-gen tests — should now be FULLY GREEN**

```bash
pnpm --filter brs-gen test
```

Expected: all 281 tests pass (no count change — D7 added no new tests). If any test fails, the golden regen is incomplete or contaminated.

- [ ] **Step 7.7: Commit**

```bash
git add packages/brs-gen/tests/__golden__/
git commit -m "$(cat <<'EOF'
test(brs-gen): regen goldens for Plan 4b.1 (video_grid HeroUnit + 0.5.2)

Three goldens regen because provenance reads brs_gen_version from
package.json (bumped 0.5.1 -> 0.5.2 in prior commit):
  - stub.{zip,provenance.json}        provenance brs_gen_version delta only
  - blank.{zip,provenance.json}       provenance brs_gen_version delta only
  - video-grid.{zip,provenance.json}  provenance + HeroUnit.xml bytes delta

Verified via spec §5 step 7 sanity diff: stub + blank provenance
only delta is brs_gen_version; video-grid.zip diff is exactly
HeroUnit.xml + provenance.

Regen requires TZ=UTC (yazl 2.5.x DOS-mtime encoding).

EOF
)"
```

---

## Task 8: release-prep verification

**Files:** none modified (unless drift discovered).

- [ ] **Step 8.1: Run release-prep**

```bash
pnpm release-prep
```

Expected: every stage green:
- `format:check` (prettier)
- `lint` (turbo lint = typecheck via tsc --noEmit)
- `typecheck`
- `test` (281 brs-gen + 296 device-client + 184 rokudev-device = 761 tests, matching v0.5.1)
- `build` (turbo build, all packages)

- [ ] **Step 8.2: If `format:check` complains, apply prettier and commit separately**

```bash
pnpm format
git diff --stat
```

If non-empty, commit as `chore(format): prettier housekeeping`. (Per the v0.5.1 lesson, drift in unrelated files can block release-prep; treat as a separate housekeeping commit, NOT bundled into this patch's substantive commits.)

- [ ] **Step 8.3: Re-run release-prep to confirm fully green**

```bash
pnpm release-prep
```

Expected: green.

---

## Task 9: README + MEMORY.md updates

**Files:**
- Modify: `README.md` (release notes section)
- Modify: `MEMORY.md` (auto-memory)

- [ ] **Step 9.1: Append v0.5.2 release notes to README**

Locate the v0.5.1 release notes section in `README.md` (search for `v0.5.1` or `0.5.1`). Insert a new v0.5.2 section ABOVE it with this content:

```markdown
### v0.5.2 (2026-05-12) — T27 honesty + HeroUnit Y-overlap (Plan 4b.1)

**Test infra:**
- `screenshotNoError` now asserts `/query/active-app == 'dev'` before its existing size heuristic. Catches the v0.5.1 false-positive class where Roku home / Debug overlay / wrong-app sailed through the byte-size check. Default-on with a `{assertForeground: false}` opt-out for genuine transition steps.

**Template:**
- `video_grid_channel` HeroUnit Y-overlap fixed. New layout inside scrim band (280-450): title Y=290, synopsis Y=345, playButton Y=386. Button bottom sits exactly at scrim bottom — no overshoot.

**Driver:**
- `t27-video-grid.mjs` Phase B preamble now does a deterministic `sideloadAndLaunch` reset instead of `keypressRepeat('Back', 2)` (which could pop the channel out to Roku home).

**Caveat:**
- Plan 4b's reported T27 PASS for `video_grid_channel` was a false positive (Phase B preamble unwound to Roku home; system-UI screenshots passed the size heuristic). v0.5.2 corrects both the heuristic and the preamble; on-device verification via Task 11 of this plan is the new source of truth.

**No API changes** to `@rokudev/device-client`, `rokudev-device`, or the `brs-gen` MCP tool surface.
```

- [ ] **Step 9.2: Append Plan 4b.1 COMPLETE block to MEMORY.md**

In `/Users/bblietz/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md`, append a new section under the existing implementation status (after the Plan 4b COMPLETE block):

```markdown
- **Plan 4b.1 COMPLETE 2026-05-12**. Tag `v0.5.2` on `origin`. 761 tests passing (281 brs-gen + 296 device-client + 184 rokudev-device).
  - **Test infra: T27 active-app foreground assertion.** `_t27-lib.mjs` adds private `assertActiveAppIsOurs(host)` (one retry @250ms per D9). `screenshotNoError(host, pw, outPath, opts={assertForeground: true})` calls it before the existing size check. All 22 existing call sites unchanged (default-on opts param). `{assertForeground: false}` opt-out exists for genuine transition steps but no caller uses it today.
  - **Template: HeroUnit Y-overlap fix.** `video_grid_channel/files/components/HeroUnit.xml`: title Y=290 (was 340), synopsis Y=345 (was 390), playButton Y=386 (was 388). Button bottom 386+64=450 sits exactly at scrim bottom (no overshoot). Synopsis-button gap is 3px — tight but preserved per user direction (alternative was Y=395 with 12px gap but 9px scrim overshoot).
  - **Driver migration.** `t27-video-grid.mjs` Phase B preamble: `keypressRepeat('Back', 2)` (line 148 in v0.5.1) → `sideloadAndLaunch(outputZip, ...)` deterministic reset + 5s hydration sleep. +5s wall-clock acceptable.
  - **Lesson: Plan 4b's T27 PASS for video_grid was a false positive.** Phase B's `Back × 2` could pop the channel out to Roku home if PlayerScene swallowed the first Back; subsequent screenshots captured Roku system UI but passed the >15KB heuristic. The active-app check + deterministic preamble reset together close this hole. **Rule for future T27 drivers**: any state-reset preamble should be a `sideloadAndLaunch` (deterministic, 1 known-good state) rather than a sequence of remote keypresses that depend on inferring the current focus stack.
  - **Lesson: provenance regen ordering.** All three goldens regen on a version bump because provenance includes `brs_gen_version`. Order: source edits → version bump → snapshot regen → golden regen. Per the existing memory rule, regen MUST happen after version bump.
  - **Lesson: vitest `function.length` excludes default-valued params.** `screenshotNoError(host, password, outPath, opts={assertForeground: true})` reports `arity: 3` not `4`. Useful for runtime introspection sanity checks but a footgun if you assert exact arities.
  - **Polish-insistence rule update.** `video_grid_channel`'s outstanding polish items as of v0.5.2: Back-from-Details refocus playButton (D8 deferred), demo feed posters on corp network (environmental). The T27 honesty work and HeroUnit overlap both resolved. Plan 4c (`news_channel`) can now scaffold from `video_grid_channel` patterns without inheriting test-infra or hero-layout bugs.
```

- [ ] **Step 9.3: Commit README + MEMORY.md**

```bash
git add README.md
git commit -m "docs(readme): v0.5.2 release notes (Plan 4b.1)"
```

(MEMORY.md lives outside the repo at `~/.claude/projects/.../memory/MEMORY.md` — not a tracked file. The MEMORY.md update is local agent state, no git commit needed.)

---

## Task 10: Tag v0.5.2 + GH release

**Files:** none modified (git tag is metadata).

- [ ] **Step 10.1: Confirm release-prep is still green**

```bash
pnpm release-prep
```

Expected: green. (Sanity re-check before tagging.)

- [ ] **Step 10.2: Show the diff log since v0.5.1**

```bash
git log --oneline v0.5.1..HEAD
```

Expected: ~7-8 commits — the spec docs, the helper, the HeroUnit, the driver, the bump, the snapshot regen, the golden regen, the README. Confirm there's nothing surprising.

- [ ] **Step 10.3: Create the annotated tag**

```bash
git tag -a v0.5.2 -m "$(cat <<'EOF'
Plan 4b.1: T27 honesty + HeroUnit Y-overlap

Test infra: screenshotNoError now asserts /query/active-app == 'dev'
before the existing size heuristic. Catches the v0.5.1 false-positive
class.

Template: video_grid_channel HeroUnit restacked inside scrim band:
title Y=290, synopsis Y=345, playButton Y=386.

Driver: t27-video-grid.mjs Phase B preamble uses sideloadAndLaunch
deterministic reset instead of Back x 2.

EOF
)"
```

- [ ] **Step 10.4: Push commits + tag**

```bash
git push origin main
git push origin v0.5.2
```

Expected: both push successfully.

- [ ] **Step 10.5: Create GitHub release**

```bash
gh release create v0.5.2 --title "v0.5.2 — Plan 4b.1: T27 honesty + HeroUnit Y-overlap" --notes "$(cat <<'EOF'
## Test infra
- `screenshotNoError` now asserts `/query/active-app == 'dev'` before its size heuristic. Catches v0.5.1's false-positive class (Roku home / Debug overlay sailing through the byte-size check). Default-on with `{assertForeground: false}` opt-out.

## Template
- `video_grid_channel` HeroUnit Y-overlap fixed. Title Y=290, synopsis Y=345, playButton Y=386. Button bottom sits exactly at scrim bottom; no overshoot.

## Driver
- `t27-video-grid.mjs` Phase B preamble does a deterministic `sideloadAndLaunch` reset instead of `keypressRepeat('Back', 2)`.

## Caveat
- Plan 4b's reported T27 PASS for `video_grid_channel` was a false positive. v0.5.2 corrects both the heuristic and the preamble. On-device verification (Task 11 of the plan) is the new source of truth.

## Spec
- `docs/superpowers/specs/2026-05-12-plan-4b1-t27-honesty-and-hero-overlap-design.md`

## Plan
- `docs/superpowers/plans/2026-05-12-plan-4b1-t27-honesty-and-hero-overlap.md`
EOF
)"
```

- [ ] **Step 10.6: Confirm release URL**

```bash
gh release view v0.5.2 --json url -q .url
```

Expected: prints `https://github.com/bblietz/rokudev-tools/releases/tag/v0.5.2`. Capture this URL for the next step.

---

## Task 11: On-device T27 verification (operator step)

**Files:** none modified (verification only). Captures evidence appended to the GH release.

- [ ] **Step 11.1: Confirm a Roku is reachable in Default ECP mode**

Operator: power on a Roku TV / box in dev mode. Confirm Settings → System → Advanced → Control by mobile apps == Default or Enabled (Limited blocks ECP per the existing memory trap).

```bash
ROKUDEV_HOST=<ip> node -e "import('./packages/rokudev-device/dist/util/ecp.js').catch(()=>{}); fetch('http://'+process.env.ROKUDEV_HOST+':8060/query/device-info').then(r=>r.text()).then(t=>console.log(t.slice(0,200)))"
```

Expected: prints the first 200 chars of the device-info XML. If non-2xx or `403`, ECP is in Limited mode — fix on the device first.

- [ ] **Step 11.2: Run the T27 video-grid driver**

```bash
ROKUDEV_HOST=<ip> ROKUDEV_DEV_PASSWORD=1234 node packages/brs-gen/scripts/t27-video-grid.mjs
```

Expected: terminates with `T27 PASS. Screenshots: <path>`, exit code 0. All 16 steps (Phase A 11 + Phase B 5) pass. Phase B preamble takes ~5-10s longer than v0.5.1 (re-sideload).

If FAIL on any step: capture the error message and `passed`/`failed` arrays printed on stderr. The most informative failure mode is `active-app is not 'dev' (got id='...')` — that proves the new check is doing its job and isolates which step lost focus on our channel.

- [ ] **Step 11.3: Sanity-check the new helper actually fires (negative test)**

While the T27 driver is NOT running, manually press Home on the physical remote OR run:

```bash
curl -s -X POST "http://<ip>:8060/keypress/Home"
```

Then re-run the driver:

```bash
ROKUDEV_HOST=<ip> node packages/brs-gen/scripts/t27-video-grid.mjs
```

Wait until Phase A starts. After `sideload + launch` succeeds, immediately press Home on the physical remote (window: ~5s before next screenshot). Expected: driver fails with `active-app is not 'dev' (got id='Roku', name='Roku')` on the next `screenshotNoError` call. This proves the foreground check is wired correctly.

(If you can't time the manual interrupt, this step is best-effort — skip if not feasible.)

- [ ] **Step 11.4: Run the T27 blank driver to confirm the helper upgrade is transparent**

```bash
ROKUDEV_HOST=<ip> ROKUDEV_DEV_PASSWORD=1234 node packages/brs-gen/scripts/t27-blank.mjs
```

Expected: 4/4 PASS. `blank_scenegraph` has no transition steps so the new check is invisible to its driver.

- [ ] **Step 11.5: Append T27 evidence to the GH release**

Capture the run summary (stdout from Step 11.2 + 11.4). Edit the GH release notes to add a verification appendix:

```bash
gh release edit v0.5.2 --notes-file -
```

(Then paste the existing release notes + a new "## On-device verification" section with the date, Roku model + firmware, and the PASS summaries from Steps 11.2 and 11.4.)

---

## Done criteria

- All 11 tasks above checked off
- Tag `v0.5.2` exists on `origin` and matches the commit on `main`
- GH release v0.5.2 created with on-device verification evidence appended
- `pnpm release-prep` green at HEAD
- 761 tests passing (no test count change vs v0.5.1)
- T27 video-grid PASS on a real Roku, with the negative-test evidence (Step 11.3) showing the new check fails loudly when the channel is backgrounded
- MEMORY.md Plan 4b.1 COMPLETE block appended

## Out of scope (do NOT include in this patch)

- `assertChannelMarkerInLog` template-opt-in helper (deferred per spec D3)
- Re-route Back-from-Details to refocus `playButton` (D8 follow-up; deferred)
- Demo feed poster corp-network issue (environmental)
- Any change to `news_channel` (doesn't exist — this patch unblocks Plan 4c to scaffold it)
- Any unit test for `_t27-lib.mjs` (D7 — real-device driver helper; coverage is on-device)

If any of the above tempt you mid-implementation, STOP and surface — they're separate work items.
