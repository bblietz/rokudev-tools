# Plan 4b.1 — T27 honesty + HeroUnit Y-overlap (design)

**Status:** Approved 2026-05-12
**Releases:** `v0.5.2` (rokudev-tools), `@rokudev/device-client` unchanged
**Predecessor:** Plan 4b (`v0.5.1`)
**Successor:** Plan 4c (`news_channel` template) — unblocked by this patch

---

## 1. Goal

Land two follow-ups from the v0.5.1 release notes before scaffolding `news_channel`:

1. **Stronger T27 render-completeness check.** Today's `screenshotNoError` heuristic is "screenshot bytes > 15 KB", which trivially matches Roku home, the Debug overlay, or any other foregrounded app. Plan 4b's T27 PASS for `video_grid_channel` was a false positive: Phase B preamble pressed `Back` twice, popped the channel out to Roku home, and every subsequent screenshot of system UI passed the size check.
2. **Fix `HeroUnit` Y-overlap in `video_grid_channel`.** Title bottom (~Y=388), synopsis top (Y=390), and `playButton` Y (388) overlap inside the bottom scrim band. Visible on-device. Risk of propagation if `news_channel` copies the HeroUnit composite pattern.

Both ship together as `v0.5.2`. The combined patch is small enough that one release cycle is correct.

## 2. Non-goals

- `assertChannelMarkerInLog(marker)` template-opt-in helper. Deferred until a template (e.g. paywall, auth) needs an assertion stronger than active-app foregrounding.
- D8 follow-up: re-route Back-from-Details to refocus `playButton` instead of `RowList`. Out of scope; tracked as deferred.
- Demo feed poster corp-network issue. Environmental, not code.
- Bumping `@rokudev/device-client`. No API surface changes.

## 3. Decisions locked

| ID | Decision | Rationale |
|----|----------|-----------|
| **D1** | Detection mechanism: ECP `/query/active-app == 'dev'` (always-on) + size > 15 KB (existing) | Cheapest, generic, no template changes required. Catches Roku home / Debug / wrong-app cases. Existing `EcpClient.activeApp()` already imported in `_t27-lib.mjs`. |
| **D2** | API surface: wrap into `screenshotNoError(host, pw, outPath, opts={assertForeground: true})`, default-on with override | Hardest-to-forget. All 22 existing call sites continue to work unchanged. Override flag exists for genuine transition steps. |
| **D3** | `assertChannelMarkerInLog` deferred (YAGNI) | Adds template-side burden (every template emits a marker). Defer until a template demonstrably needs it. |
| **D4** | HeroUnit layout: vertical stack with gaps inside scrim band 280-450 | title Y=290, synopsis Y=345, playButton Y=395. Vertical rhythm 50/45/50, no overlaps. Closest to current layout. |
| **D5** | Phase B preamble in `t27-video-grid.mjs`: replace `keypressRepeat('Back', 2)` with `sideloadAndLaunch(zipPath, ...)` | Deterministic reset to MainScene/RowList row 0. Eliminates the v0.5.1 false-positive root cause (Back x2 popping the channel). +5s wall clock; acceptable. |
| **D6** | Bundle into single `v0.5.2` patch (vs split into two patches) | Both are small (~30 LOC code + 1 snapshot regen + 1 golden regen). One release cycle, one set of release notes. |
| **D7** | No new unit tests for `_t27-lib.mjs` | It's a real-device driver helper (no Roku in CI). Coverage is via on-device runs of `t27-blank.mjs` + `t27-video-grid.mjs`. |
| **D8** | No template-side changes to `blank_scenegraph` | Its T27 driver has no transition steps and active-app == 'dev' throughout. Helper upgrade benefits it for free with no driver changes. |
| **D9** | `assertActiveAppIsOurs` retries once after 250ms before failing | ECP transient flakes are observed in the wild; cost is minimal (~250ms worst case) and prevents driver flake on otherwise-healthy runs. |

## 4. Architecture

### 4.1 Test infra (`packages/brs-gen/scripts/_t27-lib.mjs`)

Add private helper:

```js
async function assertActiveAppIsOurs(host) {
  const a = await new EcpClient(host).activeApp();
  if (a.id !== 'dev') {
    throw new Error(
      `active-app is not 'dev' (got id='${a.id}', name='${a.name ?? ''}'); ` +
      `screenshot would not be from our channel`,
    );
  }
}
```

Modify `screenshotNoError`:

```js
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

JSDoc updated to mention the foreground precondition + override flag.

### 4.2 Template (`packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml`)

Three Y-coordinate edits inside the existing `<children>` block:

```xml
<Label id="title"      translation="[40, 290]" .../>   <!-- was 340 -->
<Label id="synopsis"   translation="[40, 345]" .../>   <!-- was 390 -->
<Button id="playButton" translation="[40, 395]" .../>  <!-- was 388 -->
```

`scrim` (Y=280, height=170) is unchanged. `poster` is unchanged. All three repositioned children remain inside the scrim band 280-450. Vertical rhythm: 50px (title) → 45px (synopsis) → 50px (button). Self-check: title font is `LargeBoldSystemFont` ≈ 50px tall, so title bottom ≈ 290+50 = 340 < synopsis Y=345 (5px gap). Synopsis is single-line ≈ 38px tall (default font), bottom ≈ 345+38 = 383 < button Y=395 (12px gap). Button height ≈ 64px (Roku Button default), bottom ≈ 395+64 = 459 — note: 9px past scrim bottom Y=450, but Button has its own focus-bitmap background so it remains legible against the bottom poster edge.

### 4.3 Driver migration (`packages/brs-gen/scripts/t27-video-grid.mjs`)

Replace exactly one line in Phase B preamble (currently line 148):

```diff
-await assertStep('back to row (Phase B setup)', () => keypressRepeat(host, 'Back', 2));
+await assertStep('reset to MainScene (Phase B setup)', () =>
+  sideloadAndLaunch(zipPath, host, password));
```

Comment block above the line is updated to reflect the new approach (the existing comment about "swallowed Back" / "Home + relaunch fallback" is replaced with a one-line description of the deterministic re-sideload reset).

`zipPath` is already in scope (used in Phase A's `sideloadAndLaunch` at line ~95).

### 4.4 Snapshot + golden regen

| Artifact | Reason | Command |
|---|---|---|
| `packages/brs-gen/tests/__snapshots__/video-grid/HeroUnit.xml.snap.txt` | 3-line diff from XML edit | `pnpm --filter brs-gen test -u` |
| `packages/brs-gen/tests/__golden__/video-grid.zip` | HeroUnit.xml bytes change → zip bytes change | `TZ=UTC node packages/brs-gen/scripts/regen-golden.mjs` |
| `packages/brs-gen/tests/__golden__/video-grid.provenance.json` | File hash list + `brs_gen_version=0.5.2` | Same regen script |

Other snapshots (`MainScene.xml.snap.txt`, `template-config.brs.snap.txt`, `manifest.snap.txt`, `files-listing.snap.txt`) unaffected because file count and other file bytes don't change.

`stub.zip` and `blank.zip` goldens unaffected (template version bump is in `brs_gen_version` field of provenance only — but this DOES change those goldens too, so all three goldens regen).

**Wait — version bump effect on all goldens.** `provenance.json` includes `brs_gen_version` read from `package.json` at catalog-load. Bumping 0.5.1 → 0.5.2 changes `brs_gen_version` in **every** generated provenance, which means **all three** golden zips (`stub.zip`, `blank.zip`, `video-grid.zip`) get a different `provenance.json` inside them. Per memory lesson "regen goldens AFTER the final version bump", the regen step covers all three.

## 5. Implementation plan ordering

1. Branch `plan-4b1-t27-honesty` from `main` at `2960c5e` (v0.5.1 release commit).
2. Helper change: edit `_t27-lib.mjs` — add `assertActiveAppIsOurs` + extend `screenshotNoError` signature. Commit.
3. Template change: edit `HeroUnit.xml` Y values. Commit.
4. Driver migration: edit `t27-video-grid.mjs` Phase B preamble. Commit.
5. Bump `package.json` 0.5.1 → 0.5.2 (root + `packages/brs-gen`). Commit.
6. Regen snapshots: `pnpm --filter brs-gen test -u`. Commit.
7. Regen goldens: `TZ=UTC node packages/brs-gen/scripts/regen-golden.mjs`. Before committing, diff `stub.provenance.json` and `blank.provenance.json` (use `git diff --no-index` against the prior commit) to confirm the only delta in those two is `brs_gen_version` — catches accidental contamination from unrelated working-tree drift. Commit.
8. `pnpm release-prep` must be green. Fix any drift.
9. Tag `v0.5.2`, push, create GH release.
10. **On-device verification:** re-run `t27-video-grid.mjs` against a Roku in dev mode + Default ECP. Both Phase A (11 steps) and Phase B (5 steps) must PASS. Capture evidence in release notes appendix.

Order matters: version bump (step 5) **before** golden regen (step 7) so `brs_gen_version` in provenance is correct.

## 6. Verification

### 6.1 Automated (CI surface)

- `pnpm --filter brs-gen test`: all snapshot tests pass after `-u` regen.
- `pnpm --filter brs-gen test:e2e` (or whatever the e2e gate is): byte-equal golden comparison passes after regen.
- `pnpm release-prep`: format + lint + typecheck + test + build all green.

### 6.2 On-device

| Run | Expected |
|-----|----------|
| `node scripts/t27-video-grid.mjs <ip> 1234` against Roku at Default ECP | All 16 steps PASS. Phase B preamble takes ~5s longer (re-sideload) but is deterministic. |
| Same driver, but mid-run press Home on the physical remote (or trigger a different app via ECP) before next screenshot | Driver fails loudly: `active-app is not 'dev' (got id='Roku', ...)`. Confirms the new check is doing its job. |
| `node scripts/t27-blank.mjs <ip> 1234` against Roku | Phase A 4/4 PASS unchanged (no transition steps; helper upgrade is transparent). |

### 6.3 Visual on-device sanity (HeroUnit fix)

Capture before/after screenshots of the `MainScene` initial render. Assert by eye:
- Title fully visible above synopsis (no character clipping)
- Synopsis fully visible above button (no character clipping)
- Play Now button below synopsis with visible gap
- All three children inside scrim band

## 7. Risks + mitigations

| Risk | Mitigation |
|------|------------|
| `EcpClient.activeApp()` itself flakes (network blip during the 1-shot poll) | Wrap with one retry after 250ms before failing. **Decision:** YES, retry once. Cost is minimal; transient ECP flakes are observed in the wild. |
| Existing `sideloadAndLaunch` already polls active-app for 30s post-launch; double-checking it from `screenshotNoError` immediately after is redundant | Acceptable redundancy. The screenshot check protects against drift across **subsequent** keypresses, not the initial launch. |
| `t27-video-grid.mjs` Phase B re-sideload inflates wall-clock by ~5s | Acceptable; T27 is a manual/CI gate, not on a critical path. Plan 4b's full driver runs in ~60s; +5s is +8%. |
| Snapshot regen produces unexpected diff (e.g. EJS rendering regressed) | Manual diff review of `HeroUnit.xml.snap.txt` before commit; expected diff is exactly 3 Y-value lines. |
| Golden regen produces extra diff in unrelated files | `regen-golden.mjs` rewrites all three goldens; expected diff: provenance `brs_gen_version` 0.5.1 → 0.5.2 in all three, plus 3-line HeroUnit byte change in `video-grid.zip` only. |

## 8. Documentation updates

- Release notes for `v0.5.2` in README (or wherever `v0.5.1` notes live):
  - Test infra: stronger T27 render-completeness check
  - Template: HeroUnit Y-overlap fix
  - Caveat: Plan 4b's `t27-video-grid.mjs` PASS was a false positive; this patch corrects it
- `MEMORY.md` Plan 4b.1 COMPLETE block with the 2-3 lessons that emerge during implementation
- No PRD spec changes (active-app foreground check is a test-infra refinement, not a product surface)

## 9. Open questions

None at design freeze. All resolved during brainstorm:
- Q1 detection mechanism → D1 (active-app + existing size check)
- Q2 HeroUnit layout → D4 (vertical stack)
- Q3 API placement → D2 (wrap into screenshotNoError, opt-out flag)

## 10. Appendix: source-of-truth references

- `packages/brs-gen/scripts/_t27-lib.mjs` (helper module)
- `packages/brs-gen/scripts/t27-video-grid.mjs` lines 95-205 (driver)
- `packages/brs-gen/scripts/t27-blank.mjs` (no changes; sanity-check beneficiary)
- `packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml` (template)
- `packages/brs-gen/tests/__snapshots__/video-grid/HeroUnit.xml.snap.txt` (snapshot)
- `packages/brs-gen/tests/__golden__/video-grid.{zip,provenance.json}` (golden)
- `packages/brs-gen/scripts/regen-golden.mjs` (regen tool)
- v0.5.1 release notes (predecessor; documents the false-positive being fixed here)
- `MEMORY.md` Plan 4b COMPLETE block (lessons that motivated this patch)
