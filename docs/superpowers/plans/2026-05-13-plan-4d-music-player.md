# Plan 4d: `music_player` Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the fourth base template in the v1 catalog: `music_player`. A production-shaped audio channel with persistent playback across nav. Browse screen presents a 3-column PosterGrid of playlists; selecting a playlist opens a NowPlayingScene with album art, scrubber, and a 5-button transport row, starts playback at queue index 0, and queues the rest of the playlist's tracks. A persistent MiniBar on MainScene shows the current track + a play/pause toggle, so backing out of NowPlaying does not stop playback.

**Architecture:** New template at `packages/brs-gen/templates/music_player/` with four SceneGraph components (MainScene, NowPlayingScene, MiniBar, HttpTask), a bundled JSON feed at `pkg:/data/music-feed.json` referencing 9 SoundHelix public-domain MP3s across 3 playlists × 6 tracks (18 entries), and 15 deterministic PNG assets (3 playlist art + 12 transport bitmap icons). The only engine change is one additive line in `generate-app.ts` to thread `content.service_name` into the emitted `TemplateConfig()`.

**Tech Stack:** TypeScript + Zod + sharp (0.34.5 pinned) + yazl + brighterscript (bsc) + smol-toml + vitest + SceneGraph (Roku Audio / PosterGrid / Button / ProgressBar). All already in `packages/brs-gen`.

**Spec:** `docs/superpowers/specs/2026-05-13-plan-4d-music-player-design.md` (commit `3b804ed`).

**Prereqs you must have read:**

- The spec above. Especially §2 (locked decisions), §4 (architecture), §5 (schema), §7 (bundled feed shape), §8 (focus routing), §9 (T27), §10 (asset pipeline).
- `packages/brs-gen/templates/news_channel/template.toml` — most recent template TOML shape; mirror this structure.
- `packages/brs-gen/templates/news_channel/files/source/Feed.bs` — JSON feed parser pattern; mirror for `Feed.bs`.
- `packages/brs-gen/templates/news_channel/files/components/HttpTask.{xml,bs}` — Task subclass with `<interface><field id="url"/><field id="result"/>`; copy pattern.
- `packages/brs-gen/templates/news_channel/files/components/MainScene.bs` — cross-component focus routing pattern via `onKeyEvent` + `findNode("<id>")` + `setFocus`. We mirror this for MainScene ↔ MiniBar ↔ NowPlayingScene routing.
- `packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml` — `iconUri` / `focusedIconUri` Button bitmap icon pattern. Apply to MiniBar's playPause and to all 5 NowPlaying transport Buttons.
- `packages/brs-gen/scripts/_t27-lib.mjs` and `packages/brs-gen/scripts/t27-news.mjs` — T27 helper library + a complete driver to mirror for `t27-music.mjs`. **Especially the Phase B preamble:** Home keypress + ECP `launch('dev')`, NOT re-sideload (Plan 4c lesson).
- `packages/brs-gen/src/tools/generate-app.ts` lines 353-370 — the `TemplateConfig()` emission block. We add one line in Task 1.
- `packages/brs-gen/scripts/regen-golden.mjs` — golden regeneration script. We add `regenMusic()` in Task 12.
- `MEMORY.md` (under `~/.claude/projects/.../memory/`) — load-bearing lessons. Especially:
  - "findNode is id-only" — every overlay we `createChild` must be cached in `m.<x>Ref`.
  - "Group composites are not focusable" — applies to MiniBar (a Group). Focus the inner `playPause` Button via `findNode("playPause")`, not the MiniBar Group.
  - "screenshotNoError foreground check" — default-on; `{assertForeground: false}` opt-out for transition + zz-failure capture sites.
  - "Re-sideload preamble doesn't reset m globals on this firmware" — Phase B preamble (if any) MUST be Home + relaunch, NOT sideloadAndLaunch.
  - "Provenance regen ordering: bump version FIRST, then regen goldens" — Task 15 ordering matters.
  - "yazl 2.5.x DOS mtime is local-time; TZ=UTC required for byte-equal goldens" — applies to all golden ops.
  - "Em-dashes are forbidden in user-facing prose per global preference" — applies to commit messages and comments.
  - "ContentNode.url, NOT .stream" — applies to Audio node content. Tracks load via `m.audio.content.url = track.audio_url`.
  - "HttpTask `<interface><field id='url'>` is mandatory" — silent no-op write otherwise. HttpTask.xml declares both `url` and `result` fields.

**Authoritative Roku-doc verifications used in this plan:**

- **SceneGraph `Audio` node fields used:** `content` (ContentNode child with `url` + `streamFormat`), `state` (read-only string: `none|playing|paused|stopped|buffering|finished|error`), `position` (read-only integer seconds), `duration` (read-only integer seconds), `control` (write string: `play|pause|stop|none`), `seek` (write integer seconds). Verified via Roku official docs (`Audio` node reference). The same `content.url + streamFormat` pattern as Video applies (no separate Audio-content schema).
- **`<interface><field alias="...">` IS a real Roku attribute.** Verified via Roku official docs (used in news_channel CategoryRail). We use this in NowPlayingScene to forward `audioRef.state` to a top-level field if needed (deferred unless required during impl).
- **PosterGrid renders ContentNode children** with `HDPosterUrl` for the image + `title` for caption. `basePosterSize=[w,h]`, `itemSize=[w,h+caption-band]`, `itemSpacing=[x,y]`, `numColumns=N`, `caption1NumLines=1`. Verified via Roku official PosterGrid doc.

---

## File Structure

**New files (relative to repo root):**

| Path | Responsibility |
|---|---|
| `packages/brs-gen/templates/music_player/template.toml` | Template metadata, manifest defaults, exports, branding defaults |
| `packages/brs-gen/templates/music_player/schema.ts` | Per-template Zod schema + Example AppSpec |
| `packages/brs-gen/templates/music_player/files/manifest.ejs` | Placeholder (merger emits the real manifest from template.toml) |
| `packages/brs-gen/templates/music_player/files/data/music-feed.json` | Bundled feed: 3 playlists × 6 tracks = 18 entries |
| `packages/brs-gen/templates/music_player/files/images/playlist-1.png` | 600×600 deterministic placeholder (color #1a3a8a + glyph "1") |
| `packages/brs-gen/templates/music_player/files/images/playlist-2.png` | 600×600 deterministic placeholder (color #2a8a3a + glyph "2") |
| `packages/brs-gen/templates/music_player/files/images/playlist-3.png` | 600×600 deterministic placeholder (color #8a3a2a + glyph "3") |
| `packages/brs-gen/templates/music_player/files/images/play-icon-light.png` | 48×48 light glyph (byte-equal to video_grid_channel + news_channel copies) |
| `packages/brs-gen/templates/music_player/files/images/play-icon-dark.png` | 48×48 dark glyph (byte-equal to video_grid_channel + news_channel copies) |
| `packages/brs-gen/templates/music_player/files/images/pause-icon-light.png` | 48×48 pause glyph, light theme |
| `packages/brs-gen/templates/music_player/files/images/pause-icon-dark.png` | 48×48 pause glyph, dark theme |
| `packages/brs-gen/templates/music_player/files/images/prev-icon-light.png` | 48×48 prev (skip-back) glyph, light theme |
| `packages/brs-gen/templates/music_player/files/images/prev-icon-dark.png` | 48×48 prev glyph, dark theme |
| `packages/brs-gen/templates/music_player/files/images/next-icon-light.png` | 48×48 next (skip-forward) glyph, light theme |
| `packages/brs-gen/templates/music_player/files/images/next-icon-dark.png` | 48×48 next glyph, dark theme |
| `packages/brs-gen/templates/music_player/files/images/rew15-icon-light.png` | 48×48 rewind-15s glyph, light theme |
| `packages/brs-gen/templates/music_player/files/images/rew15-icon-dark.png` | 48×48 rewind-15s glyph, dark theme |
| `packages/brs-gen/templates/music_player/files/images/fwd15-icon-light.png` | 48×48 forward-15s glyph, light theme |
| `packages/brs-gen/templates/music_player/files/images/fwd15-icon-dark.png` | 48×48 forward-15s glyph, dark theme |
| `packages/brs-gen/templates/music_player/files/source/Main.bs` | SceneGraph bootstrap; fires `Main/before_scene_show` hook |
| `packages/brs-gen/templates/music_player/files/source/Feed.bs` | `MusicFeed_LoadBundled`, `MusicFeed_BuildContentNode`, `MusicFeed_TracksForPlaylist` |
| `packages/brs-gen/templates/music_player/files/source/HttpTask.bs` | HTTP fetch (only used when `spec.content.feed_url` is `http(s)://`) |
| `packages/brs-gen/templates/music_player/files/components/HttpTask.xml` | HttpTask gating component |
| `packages/brs-gen/templates/music_player/files/components/MainScene.xml` | Root: header + PosterGrid + MiniBar + Audio + loading/error labels |
| `packages/brs-gen/templates/music_player/files/components/MainScene.bs` | Feed load, Audio ownership, focus routing, NowPlaying create/remove, MiniBar visibility, init hook fires |
| `packages/brs-gen/templates/music_player/files/components/MiniBar.xml` | Group composite: art + title + artist + playPause Button |
| `packages/brs-gen/templates/music_player/files/components/MiniBar.bs` | `onContentChange` → bind labels + poster; `onAudioStateChange` → swap playPause icon |
| `packages/brs-gen/templates/music_player/files/components/NowPlayingScene.xml` | Overlay: large art + service line + title + artist + scrubber + 5-button transport row |
| `packages/brs-gen/templates/music_player/files/components/NowPlayingScene.bs` | Reads audioRef + queue + queueIndex; observes state; 1Hz Timer for scrubber; transport handlers |
| `packages/brs-gen/tests/__snapshots__/music_player/manifest.snap.txt` | Snapshot (auto-written) |
| `packages/brs-gen/tests/__snapshots__/music_player/MainScene.xml.snap.txt` | Snapshot |
| `packages/brs-gen/tests/__snapshots__/music_player/MainScene.brs.snap.txt` | Snapshot (post-compile) |
| `packages/brs-gen/tests/__snapshots__/music_player/NowPlayingScene.xml.snap.txt` | Snapshot |
| `packages/brs-gen/tests/__snapshots__/music_player/NowPlayingScene.brs.snap.txt` | Snapshot (post-compile) |
| `packages/brs-gen/tests/__snapshots__/music_player/MiniBar.xml.snap.txt` | Snapshot |
| `packages/brs-gen/tests/__snapshots__/music_player/Feed.brs.snap.txt` | Snapshot (post-compile) |
| `packages/brs-gen/tests/__snapshots__/music_player/music-feed.json.snap.txt` | Snapshot (asserts bundled feed shape) |
| `packages/brs-gen/tests/__snapshots__/music_player/file-listing.snap.txt` | Snapshot (full file listing of generated project) |
| `packages/brs-gen/tests/__golden__/music.zip` | Golden zip (auto-regenerated under TZ=UTC) |
| `packages/brs-gen/tests/__golden__/music.provenance.json` | Golden provenance |
| `packages/brs-gen/scripts/gen-music-thumb.mjs` | Author-time PNG generator (15 PNGs deterministic via sharp) |
| `packages/brs-gen/scripts/t27-music.mjs` | Operator-run real-device driver (Phase A bundled feed; Phase B deferred per spec §9) |

**Modified files:**

| Path | Change |
|---|---|
| `packages/brs-gen/src/tools/generate-app.ts` | Thread `content.service_name` into `TemplateConfig()` (Task 1) |
| `packages/brs-gen/src/tools/generate-app.test.ts` | New tests for `service_name` threading (Task 1) |
| `packages/brs-gen/src/spec/content.ts` | Allow optional `service_name` field on content (Task 2 if needed) |
| `packages/brs-gen/tests/snapshots.test.ts` | New `music_player snapshots` describe block (Task 11) |
| `packages/brs-gen/tests/e2e.test.ts` | New `music_player` describe block (golden zip + provenance) (Task 12) |
| `packages/brs-gen/tests/conflict-matrix.test.ts` | 1 music_player baseline entry (Task 13) |
| `packages/brs-gen/tests/determinism.test.ts` | music_player full-pipeline byte-equality test (Task 13) |
| `packages/brs-gen/tests/asset-reuse.test.ts` | Asserts music_player's `play-icon-light.png` + `play-icon-dark.png` are sha256-equal to video_grid_channel + news_channel copies (Task 10) |
| `packages/brs-gen/scripts/regen-golden.mjs` | New `regenMusic()` block + main() invocation + summary line (Task 12) |
| `packages/brs-gen/package.json` | Bump `version` 0.5.3 → 0.5.4 (Task 15) |
| `package.json` (root) | Bump `version` 0.5.3 → 0.5.4 (Task 15) |
| `README.md` | Append "What's in v0.5.4 (Plan 4d)" section (Task 15) |

**Auto-touched goldens (regenerated; included in commits but not authored):**

- `packages/brs-gen/tests/__golden__/stub.zip` + `.provenance.json` — version-bump cascade.
- `packages/brs-gen/tests/__golden__/blank.zip` + `.provenance.json` — version-bump cascade.
- `packages/brs-gen/tests/__golden__/video-grid.zip` + `.provenance.json` — version-bump cascade.
- `packages/brs-gen/tests/__golden__/news.zip` + `.provenance.json` — version-bump cascade.

---

## Errata vs. Spec

Two minor corrections made during plan authoring:

1. **Icon naming convention.** Spec §10 lists icons as `icon-prev-light.png`, `icon-next-light.png`, etc. Prior templates (`video_grid_channel`, `news_channel`) use `<action>-icon-<theme>.png` (e.g. `play-icon-light.png`). For consistency with prior templates and to make `play-icon-light.png` byte-equal across all three template image directories (enabling the asset-reuse test), this plan adopts the prior convention: `play-icon-light.png`, `pause-icon-light.png`, `prev-icon-light.png`, etc. No locked-decision change.
2. **Spec §13 Final verification gate test count.** Spec estimates "~325-335 PASS" against a "305 baseline." Confirmed baseline at the time of writing is exactly 305 (Plan 4c v0.5.3). Plan 4d adds approximately 25-30 new tests across snapshots (10) + e2e (3) + conflict-matrix (1) + determinism (1) + asset-reuse (2) + generate-app TemplateConfig service_name (2) + Feed.bs unit tests (5) = ~24. Target: ~329 brs-gen tests after Plan 4d. Re-reconcile in Task 15.

No locked decisions changed.

---

## Task 1: Thread `content.service_name` into `TemplateConfig()`

**Why first:** every template-side reader of `TemplateConfig().service_name` (NowPlayingScene's "FROM &lt;service_name&gt;" header line) needs this in place; engine change is the smallest unblocker. Mirrors Plan 4c's Task 1 exactly.

**Files:**

- Modify: `packages/brs-gen/src/tools/generate-app.ts` (around line 359-368 inside the `TemplateConfig()` block)
- Test: `packages/brs-gen/src/tools/generate-app.test.ts` (extend)

- [ ] **Step 1: Read the existing TemplateConfig block to confirm the conditional pattern**

Read lines 350-385 of `packages/brs-gen/src/tools/generate-app.ts`. Note the existing pattern: a single block that conditionally adds keys to `cfg` based on what's in `appSpec.content` / `brandingSpec`. You're adding one more `if` branch alongside the `live_label` branch (line 368).

- [ ] **Step 2: Find existing test cases for TemplateConfig in `generate-app.test.ts`**

Run: `grep -n "TemplateConfig\|template_config\|live_label\|feed_url\|service_name" packages/brs-gen/src/tools/generate-app.test.ts`

Look for the `live_label threading` describe block from Plan 4c. You'll add a parallel `service_name threading` block.

- [ ] **Step 3: Write a failing test for `service_name` propagation**

Append to `packages/brs-gen/src/tools/generate-app.test.ts` (after the existing `live_label threading` describe block):

```ts
describe('TemplateConfig service_name threading', () => {
  // Note: music_player template is created in Task 2. Until then these tests
  // fail with "Unknown template: music_player". After Task 2's first commit
  // they proceed to fail with file-not-found errors against the component
  // XMLs (which Tasks 5-9 populate). After Task 9 both should pass.
  it('threads spec.content.service_name into emitted TemplateConfig() body', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'brs-gen-service-name-'));
    try {
      const handler = getHandler();
      const result = await handler({
        spec: {
          spec_version: 2,
          template: 'music_player',
          modules: [],
          app: { name: 'MusicTest', major_version: 0, minor_version: 1, build_version: 0 },
          content: { service_name: 'My Radio' },
        },
        output_dir: join(tmpDir, 'out'),
        overwrite: true,
      });
      const payload = result as Record<string, unknown>;
      expect(payload['ok']).toBe(true);
      const configBs = await readFile(
        join(tmpDir, 'out', 'source', '_template', 'config.bs'),
        'utf8',
      );
      expect(configBs).toContain('"service_name"');
      expect(configBs).toContain('"My Radio"');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('omits service_name key when spec.content.service_name is absent', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'brs-gen-service-name-absent-'));
    try {
      const handler = getHandler();
      const result = await handler({
        spec: {
          spec_version: 2,
          template: 'music_player',
          modules: [],
          app: { name: 'MusicTest', major_version: 0, minor_version: 1, build_version: 0 },
        },
        output_dir: join(tmpDir, 'out'),
        overwrite: true,
      });
      const payload = result as Record<string, unknown>;
      expect(payload['ok']).toBe(true);
      const configBs = await readFile(
        join(tmpDir, 'out', 'source', '_template', 'config.bs'),
        'utf8',
      );
      expect(configBs).not.toContain('"service_name"');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4: Run the new tests to confirm they fail**

Run: `pnpm -C packages/brs-gen test -- --run --reporter=verbose -t "service_name threading"`

Expected: 2 FAIL with `Unknown template: music_player` (or similar). This is the correct failure state pre-Task 2.

- [ ] **Step 5: Add the additive engine line**

Edit `packages/brs-gen/src/tools/generate-app.ts` lines 358-368. The existing code:

```ts
const content = (
  appSpec as { content?: { feed_url?: string; feed_format?: string; live_label?: string } }
).content;
if (brandingSpec.primary_color || content || effectivePrimaryColor) {
  const cfg: Record<string, string> = {
    channel_name: appSpec.app.name,
  };
  if (brandingSpec.primary_color) cfg['primary_color'] = brandingSpec.primary_color;
  if (content?.feed_url) cfg['feed_url'] = content.feed_url;
  if (content?.feed_format) cfg['feed_format'] = content.feed_format;
  if (content?.live_label) cfg['live_label'] = content.live_label;
  templateConfigBrs = emitTemplateConfigBs(cfg);
}
```

Becomes (add `service_name` to the type narrowing AND the conditional):

```ts
const content = (
  appSpec as {
    content?: {
      feed_url?: string;
      feed_format?: string;
      live_label?: string;
      service_name?: string;
    };
  }
).content;
if (brandingSpec.primary_color || content || effectivePrimaryColor) {
  const cfg: Record<string, string> = {
    channel_name: appSpec.app.name,
  };
  if (brandingSpec.primary_color) cfg['primary_color'] = brandingSpec.primary_color;
  if (content?.feed_url) cfg['feed_url'] = content.feed_url;
  if (content?.feed_format) cfg['feed_format'] = content.feed_format;
  if (content?.live_label) cfg['live_label'] = content.live_label;
  if (content?.service_name) cfg['service_name'] = content.service_name;
  templateConfigBrs = emitTemplateConfigBs(cfg);
}
```

- [ ] **Step 6: Verify no other test regressions**

Run: `pnpm -C packages/brs-gen test 2>&1 | tail -10`

Expected: 305 existing tests still PASS; 2 new `service_name` tests FAIL with `Unknown template: music_player` (expected pre-Task 2). All 4 existing template golden tests still PASS (the engine change is additive, no key-absent template gets a new key).

- [ ] **Step 7: Confirm typecheck + build are clean**

Run: `pnpm -C packages/brs-gen build`

Expected: clean compile (no TS errors).

- [ ] **Step 8: Commit**

```bash
git add packages/brs-gen/src/tools/generate-app.ts packages/brs-gen/src/tools/generate-app.test.ts
git commit -m "$(cat <<'EOF'
feat(brs-gen): thread spec.content.service_name into TemplateConfig

Additive engine change for Plan 4d. music_player templates read
TemplateConfig().service_name to render the 'FROM <service_name>' header
line on NowPlayingScene. Default behavior unchanged when content.service_name
is absent (no key emitted into TemplateConfig).

Two new test cases in generate-app.test.ts FAIL until music_player template
exists (Task 2+). Existing template goldens still byte-equal: this engine
change emits no key into cfg unless service_name is set, and no existing
template sets it.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Scaffold `music_player` template (TOML + schema + manifest.ejs)

**Why second:** unblocks Task 1's tests once they advance from "Unknown template" to "missing component" failures, and unblocks all subsequent file-tasks.

**Files:**

- Create: `packages/brs-gen/templates/music_player/template.toml`
- Create: `packages/brs-gen/templates/music_player/schema.ts`
- Create: `packages/brs-gen/templates/music_player/files/manifest.ejs`

- [ ] **Step 1: Read news_channel's template.toml as the canonical pattern**

```bash
cat packages/brs-gen/templates/news_channel/template.toml
```

Note the structure: `[template]`, `[template.manifest_defaults]`, `[template.exports]` (with `init_hooks` + `scene_nodes`), `[template.branding_defaults]`. Mirror this for music_player.

- [ ] **Step 2: Create `templates/music_player/template.toml`**

```toml
[template]
id = "music_player"
version = "0.1.0"
spec_compat = ">=2"
description = "Browse + Now Playing audio template. 3-column PosterGrid of playlists, full transport on NowPlayingScene, persistent MiniBar so Back from Now Playing keeps playback alive."

[template.manifest_defaults]
title           = "<%= spec.app.name %>"
major_version   = "<%= spec.app.major_version %>"
minor_version   = "<%= spec.app.minor_version %>"
build_version   = "<%= spec.app.build_version %>"
# splash_color guard mirrors news_channel: spec.branding is optional, EJS
# context exposes only `spec` not effectivePrimaryColor. Fallback must
# match [template.branding_defaults] below.
splash_color    = "<%= (spec.branding && spec.branding.primary_color) ? spec.branding.primary_color : '#181028' %>"
ui_resolutions  = "fhd,hd"
bs_const        = "DEBUG=false"

[template.exports]
init_hooks = [
  { scope = "Main",             phase = "before_scene_show", file = "source/Main.bs",                 signature = "(args as dynamic) as void" },
  { scope = "MainScene",        phase = "after_scene_show",  file = "components/MainScene.bs",        signature = "(m as object) as void" },
  { scope = "NowPlayingScene",  phase = "after_scene_show",  file = "components/NowPlayingScene.bs",  signature = "(m as object) as void" },
]
scene_nodes = [
  { name = "MainScene",        file = "components/MainScene.xml" },
  { name = "NowPlayingScene",  file = "components/NowPlayingScene.xml" },
  { name = "MiniBar",          file = "components/MiniBar.xml" },
  { name = "HttpTask",         file = "components/HttpTask.xml" },
]

[template.branding_defaults]
primary_color = "#181028"
```

- [ ] **Step 3: Create `templates/music_player/schema.ts`**

```ts
// packages/brs-gen/templates/music_player/schema.ts
import { z } from 'zod';

const NonNegInt = z.number().int().min(0);
const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

// music_player-specific content block. feed_url / feed_format are optional;
// when absent the template uses the bundled music-feed.json. service_name is
// the "FROM <name>" header line on NowPlayingScene (default = spec.app.name,
// resolved at runtime). Capped at 20 chars because the header band is small;
// longer strings overflow.
const MusicContentSchema = z
  .object({
    feed_url: z.string().url().optional(),
    feed_format: z.enum(['music_player_json']).optional(),
    service_name: z.string().min(1).max(20).optional(),
  })
  .strict();

export const Schema = z
  .object({
    spec_version: z.literal(2),
    template: z.literal('music_player'),
    modules: z.array(z.record(z.unknown())),
    app: z
      .object({
        name: z.string().min(1),
        major_version: NonNegInt,
        minor_version: NonNegInt,
        build_version: NonNegInt,
      })
      .strict(),
    branding: z
      .object({
        primary_color: Hex.optional(),
        icon: z.string().min(1).optional(),
        splash: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    content: MusicContentSchema.optional(),
  })
  .strict();

export const Example = {
  spec_version: 2 as const,
  template: 'music_player' as const,
  modules: [],
  app: { name: 'Music Demo', major_version: 0, minor_version: 1, build_version: 0 },
  content: { service_name: 'Music Demo' },
};
```

- [ ] **Step 4: Create placeholder `templates/music_player/files/manifest.ejs`**

The merger emits the real manifest from `[template.manifest_defaults]`. The `manifest.ejs` file must exist for the file-walk to find it but its body is unused. Mirror news_channel's placeholder (one comment line).

```ejs
# placeholder; merger emits the real manifest from template.toml
```

- [ ] **Step 5: Smoke test — list_templates includes music_player**

Run: `pnpm -C packages/brs-gen build && pnpm -C packages/brs-gen exec node -e "
import('./dist/index.js').then(async () => {
  const { setCatalog, getCatalog } = await import('./dist/tools/_catalog-singleton.js');
  const { loadCatalog } = await import('./dist/catalog/load.js');
  const cat = await loadCatalog();
  console.log('Templates:', Object.keys(cat.templates));
});
"`

Expected: `Templates: [ 'blank_scenegraph', 'music_player', 'news_channel', 'stub_hello', 'video_grid_channel' ]`.

- [ ] **Step 6: Re-run Task 1's tests; confirm advance from "Unknown template" to file-not-found**

Run: `pnpm -C packages/brs-gen test -- --run -t "service_name threading" 2>&1 | tail -20`

Expected: 2 FAIL but with errors mentioning missing `components/MainScene.xml` or similar. NOT "Unknown template" anymore. This means Task 2 unblocked Task 1's tests; they'll pass once Tasks 5-8 (components) are written.

- [ ] **Step 7: Run full brs-gen suite to confirm no regressions**

Run: `pnpm -C packages/brs-gen test 2>&1 | grep -E "Tests " | head -3`

Expected: 305 PASS (existing tests untouched; Task 1's 2 new tests still FAIL with file-not-found).

- [ ] **Step 8: Commit**

```bash
git add packages/brs-gen/templates/music_player/
git commit -m "$(cat <<'EOF'
feat(brs-gen): scaffold music_player template (TOML + schema + manifest)

Plan 4d Task 2. Empty file body for manifest.ejs (merger emits manifest
from template.toml). Schema is strict on app + branding + content; the
template-specific MusicContentSchema admits feed_url + feed_format +
service_name (1-20 chars).

Three init-hook exports: Main/before_scene_show, MainScene/after_scene_show,
and NEW NowPlayingScene/after_scene_show. The new export point is where
Plan 5+ analytics modules will hook for track-played events.

Four scene_nodes registered: MainScene, NowPlayingScene, MiniBar, HttpTask.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Author script `gen-music-thumb.mjs` + generate the 15 PNGs

**Why third:** every component XML / template asset references these files. Producing them up-front lets the rest of the plan reference exact paths without "this PNG comes later."

**Files:**

- Create: `packages/brs-gen/scripts/gen-music-thumb.mjs`
- Create (via the script): 15 PNGs under `packages/brs-gen/templates/music_player/files/images/`

- [ ] **Step 1: Read prior author script as a pattern**

```bash
cat packages/brs-gen/scripts/gen-news-thumb.mjs
```

Note: `sharp` inline-SVG strategy with pinned `compressionLevel: 9`, `palette: false`, `kernel: 'lanczos3'` for determinism. Same pattern applies here.

- [ ] **Step 2: Write `gen-music-thumb.mjs`**

```js
#!/usr/bin/env node
// packages/brs-gen/scripts/gen-music-thumb.mjs
//
// Deterministic generator for music_player template's 15 PNG assets:
//   - 3 playlist art (600x600, solid color + glyph)
//   - 12 transport icons (48x48, monochrome glyphs in light + dark themes)
//
// Run via: node packages/brs-gen/scripts/gen-music-thumb.mjs
// Idempotent: re-running produces byte-equal output.
//
// Determinism: sharp 0.34.5 (pinned in package.json), inline SVG (no font
// dependencies that could vary across hosts), explicit { compressionLevel: 9,
// palette: false, kernel: 'lanczos3' } on every PNG emit.

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);
const IMAGES = join(PKG_ROOT, 'templates', 'music_player', 'files', 'images');

const PLAYLISTS = [
  { file: 'playlist-1.png', bg: '#1a3a8a', glyph: '1' },
  { file: 'playlist-2.png', bg: '#2a8a3a', glyph: '2' },
  { file: 'playlist-3.png', bg: '#8a3a2a', glyph: '3' },
];

// Each transport icon is one path glyph. Light theme = white-on-transparent
// (renders well against the dark scrubber band). Dark theme = black-on-
// transparent (renders well against Roku's default focus bitmap which is
// near-white). Both 48x48.
const ICONS = [
  // [base_name, svg_path_d (48x48 viewBox)]
  ['play',  'M12 8 L40 24 L12 40 Z'],
  ['pause', 'M14 8 H22 V40 H14 Z M26 8 H34 V40 H26 Z'],
  ['prev',  'M10 8 H14 V40 H10 Z M40 8 L18 24 L40 40 Z'],
  ['next',  'M34 8 H38 V40 H34 Z M8 8 L30 24 L8 40 Z'],
  ['rew15', 'M28 8 A16 16 0 1 0 28 40 L28 36 A12 12 0 1 1 28 12 Z M28 4 L20 12 L28 20 Z'],
  ['fwd15', 'M20 8 A16 16 0 1 1 20 40 L20 36 A12 12 0 1 0 20 12 Z M20 4 L28 12 L20 20 Z'],
];

async function main() {
  await mkdir(IMAGES, { recursive: true });

  for (const p of PLAYLISTS) {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="600" height="600" viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
  <rect width="600" height="600" fill="${p.bg}" />
  <text x="300" y="380" text-anchor="middle" font-family="sans-serif" font-size="280" font-weight="700" fill="#FFFFFF">${p.glyph}</text>
</svg>`;
    await sharp(Buffer.from(svg))
      .png({ compressionLevel: 9, palette: false })
      .toFile(join(IMAGES, p.file));
    process.stdout.write(`wrote ${p.file}\n`);
  }

  for (const [base, d] of ICONS) {
    for (const theme of ['light', 'dark']) {
      const fill = theme === 'light' ? '#FFFFFF' : '#000000';
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
  <path d="${d}" fill="${fill}" />
</svg>`;
      const file = `${base}-icon-${theme}.png`;
      await sharp(Buffer.from(svg))
        .png({ compressionLevel: 9, palette: false })
        .toFile(join(IMAGES, file));
      process.stdout.write(`wrote ${file}\n`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`gen-music-thumb failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
```

- [ ] **Step 3: Run the script to generate the 15 PNGs**

```bash
node packages/brs-gen/scripts/gen-music-thumb.mjs
```

Expected: 15 lines of "wrote ..." output. 15 PNG files exist under `packages/brs-gen/templates/music_player/files/images/`.

- [ ] **Step 4: Verify the 15 files exist with expected sizes**

```bash
ls -la packages/brs-gen/templates/music_player/files/images/ | wc -l
```

Expected: 17 (15 files + `.` + `..`). All PNGs should be 1-3 KB except playlist art (5-15 KB).

- [ ] **Step 5: Verify determinism (re-run produces byte-equal output)**

```bash
sha256sum packages/brs-gen/templates/music_player/files/images/*.png > /tmp/music-pngs-1.sha
node packages/brs-gen/scripts/gen-music-thumb.mjs
sha256sum packages/brs-gen/templates/music_player/files/images/*.png > /tmp/music-pngs-2.sha
diff /tmp/music-pngs-1.sha /tmp/music-pngs-2.sha
```

Expected: empty diff (identical hashes).

- [ ] **Step 6: Verify play-icon-light/dark byte-equality with prior templates**

```bash
sha256sum packages/brs-gen/templates/{music_player,news_channel,video_grid_channel}/files/images/play-icon-light.png
sha256sum packages/brs-gen/templates/{music_player,news_channel,video_grid_channel}/files/images/play-icon-dark.png
```

Expected: all three rows of each match (one sha256 per `play-icon-light.png`, one for `play-icon-dark.png`). If they don't match, the SVG path data in `gen-music-thumb.mjs`'s `ICONS[0]` (`'play'`) needs to match the SVG in `gen-news-thumb.mjs` (or whichever script created the existing PNGs). Reconcile by either (a) copying the existing PNG bytes verbatim into music_player's images dir (no change to gen-music-thumb.mjs), or (b) updating gen-music-thumb.mjs's `play` SVG to match. Option (b) is preferred because it keeps a single source of truth for music_player's icons.

If reconciliation isn't possible and play-icon-light differs across templates, **stop and surface to the user**: the asset-reuse test (Task 10) depends on this byte-equality.

- [ ] **Step 7: Commit (script + 15 PNGs together as one atomic asset bundle)**

```bash
git add packages/brs-gen/scripts/gen-music-thumb.mjs \
        packages/brs-gen/templates/music_player/files/images/
git commit -m "$(cat <<'EOF'
feat(brs-gen): gen-music-thumb.mjs + 15 PNG assets for music_player

3 playlist art (600x600 solid-color + numeric glyph 1/2/3) and 12 transport
icons (48x48 monochrome path glyphs in light + dark themes for play, pause,
prev, next, rew15, fwd15). Deterministic via sharp 0.34.5 inline-SVG
pipeline with pinned PNG params.

play-icon-light.png and play-icon-dark.png are byte-equal to the
video_grid_channel and news_channel copies; the asset-reuse test in
Task 10 enforces this.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `source/Feed.bs` + Feed unit tests

**Why fourth:** every component that touches feed data (MainScene, NowPlayingScene) imports these helpers. Pure data-shaping code with no Roku runtime dependency, so it's easily TDD'd in isolation via the existing brs-gen JSON-shape unit-test pattern.

**Files:**

- Create: `packages/brs-gen/templates/music_player/files/source/Feed.bs`
- Create: `packages/brs-gen/templates/music_player/files/source/__feed-shape.test.ts` (TS-side test that imports the JSON and asserts shape; defers BrightScript-runtime testing of Feed.bs to T27)

- [ ] **Step 1: Read news_channel's Feed.bs as the canonical pattern**

```bash
cat packages/brs-gen/templates/news_channel/files/source/Feed.bs
```

Note: three top-level functions, all pure (no `m.` state, no I/O except `ReadAsciiFile` in `LoadBundled`). Each returns a clearly-shaped value (object, ContentNode, array). Mirror this.

- [ ] **Step 2: Write `source/Feed.bs`**

Create `packages/brs-gen/templates/music_player/files/source/Feed.bs`:

```brs
' music_player Feed.bs
'
' Pure data-shaping helpers for the music_player feed.
'
' MusicFeed_LoadBundled: reads pkg:/data/music-feed.json (or the operator's
' override path) and returns the parsed associative array, or invalid on
' parse error.
'
' MusicFeed_BuildContentNode: turns one feed track into a ContentNode with
' the fields the SceneGraph Audio node expects (url + streamFormat) plus
' display fields (title, artist, art).
'
' MusicFeed_TracksForPlaylist: returns the array of track objects for a
' given playlist id, or [] if the id is not found.

function MusicFeed_LoadBundled(path as string) as dynamic
  raw = ReadAsciiFile(path)
  if raw = invalid or raw = "" then return invalid
  feed = ParseJson(raw)
  if feed = invalid then return invalid
  return feed
end function

function MusicFeed_BuildContentNode(track as object) as object
  if track = invalid then return invalid
  node = createObject("roSGNode", "ContentNode")
  if track.title <> invalid then node.title = track.title
  if track.artist <> invalid then node.SecondaryTitle = track.artist
  if track.art <> invalid then node.HDPosterUrl = track.art
  if track.audio_url <> invalid then node.url = track.audio_url
  if track.stream_format <> invalid then node.streamFormat = track.stream_format
  return node
end function

function MusicFeed_TracksForPlaylist(feed as dynamic, playlistId as string) as object
  if feed = invalid or feed.playlists = invalid then return []
  for each pl in feed.playlists
    if pl.id = playlistId then
      if pl.tracks = invalid then return []
      return pl.tracks
    end if
  end for
  return []
end function
```

- [ ] **Step 3: Add a TS-side shape test that validates the bundled feed JSON**

Create `packages/brs-gen/tests/music_player-feed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FEED_PATH = join(
  __dirname,
  '..',
  'templates',
  'music_player',
  'files',
  'data',
  'music-feed.json',
);

describe('music_player bundled feed shape', () => {
  // Note: data/music-feed.json is created in Task 9. Until then these tests
  // FAIL with ENOENT. After Task 9 they pass.
  it('parses as JSON', () => {
    const raw = readFileSync(FEED_PATH, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('has 3 playlists', () => {
    const feed = JSON.parse(readFileSync(FEED_PATH, 'utf8'));
    expect(Array.isArray(feed.playlists)).toBe(true);
    expect(feed.playlists.length).toBe(3);
  });

  it('each playlist has id, title, art, and 6 tracks', () => {
    const feed = JSON.parse(readFileSync(FEED_PATH, 'utf8'));
    for (const pl of feed.playlists) {
      expect(typeof pl.id).toBe('string');
      expect(typeof pl.title).toBe('string');
      expect(pl.art).toMatch(/^pkg:\/images\/playlist-\d\.png$/);
      expect(Array.isArray(pl.tracks)).toBe(true);
      expect(pl.tracks.length).toBe(6);
    }
  });

  it('each track has id, title, artist, art, audio_url (https), stream_format', () => {
    const feed = JSON.parse(readFileSync(FEED_PATH, 'utf8'));
    for (const pl of feed.playlists) {
      for (const t of pl.tracks) {
        expect(typeof t.id).toBe('string');
        expect(typeof t.title).toBe('string');
        expect(typeof t.artist).toBe('string');
        expect(t.art).toMatch(/^pkg:\/images\/playlist-\d\.png$/);
        expect(t.audio_url).toMatch(/^https:\/\/www\.soundhelix\.com\//);
        expect(t.stream_format).toBe('mp3');
        expect(typeof t.duration).toBe('number');
        expect(t.duration).toBeGreaterThan(0);
      }
    }
  });

  it('within each playlist, no audio_url repeats', () => {
    const feed = JSON.parse(readFileSync(FEED_PATH, 'utf8'));
    for (const pl of feed.playlists) {
      const urls = pl.tracks.map((t: { audio_url: string }) => t.audio_url);
      expect(new Set(urls).size).toBe(urls.length);
    }
  });
});
```

- [ ] **Step 4: Run the tests; confirm they fail (data file not yet authored)**

Run: `pnpm -C packages/brs-gen test -- --run music_player-feed`

Expected: 5 FAIL with ENOENT (file not found). This is correct: Task 9 creates the JSON.

- [ ] **Step 5: Commit Feed.bs + the test file**

```bash
git add packages/brs-gen/templates/music_player/files/source/Feed.bs \
        packages/brs-gen/tests/music_player-feed.test.ts
git commit -m "$(cat <<'EOF'
feat(brs-gen): music_player Feed.bs + bundled-feed shape tests

Three pure helpers: MusicFeed_LoadBundled, MusicFeed_BuildContentNode,
MusicFeed_TracksForPlaylist. Shape mirrors news_channel's Feed.bs;
returns invalid on parse error, [] on missing playlist.

The companion music_player-feed.test.ts asserts the bundled feed shape:
3 playlists, 6 tracks each, SoundHelix URLs, no per-playlist URL
repeats. Tests FAIL until Task 9 authors data/music-feed.json.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `source/Main.bs` + `source/HttpTask.bs` + `components/HttpTask.xml`

**Why fifth:** smallest leaf component bundle. MainScene (Task 6) calls `createObject("roSGNode", "HttpTask")` so HttpTask must exist before MainScene's onFeedFetchState observer can do anything meaningful in T27.

**Files:**

- Create: `packages/brs-gen/templates/music_player/files/source/Main.bs`
- Create: `packages/brs-gen/templates/music_player/files/source/HttpTask.bs`
- Create: `packages/brs-gen/templates/music_player/files/components/HttpTask.xml`

- [ ] **Step 1: Read news_channel's Main.bs and HttpTask as patterns**

```bash
cat packages/brs-gen/templates/news_channel/files/source/Main.bs
cat packages/brs-gen/templates/news_channel/files/source/HttpTask.bs
cat packages/brs-gen/templates/news_channel/files/components/HttpTask.xml
```

Note `Main.bs`: creates Scene, registers MainScene, calls `Modules_OnMainBeforeSceneShow(args)`, then `screen.show()`, then waits on the message port. Identical for music_player except MainScene name is the same `MainScene`.

- [ ] **Step 2: Write `source/Main.bs`**

```brs
' music_player Main.bs
'
' SceneGraph entry point. Constructs the screen + Scene, fires the
' Main/before_scene_show init hook, and shows the scene.

sub Main(args as dynamic)
  screen = createObject("roSGScreen")
  port = createObject("roMessagePort")
  screen.setMessagePort(port)
  scene = screen.createScene("MainScene")

  Modules_OnMainBeforeSceneShow(args)

  screen.show()

  while true
    msg = wait(0, port)
    msgType = type(msg)
    if msgType = "roSGScreenEvent"
      if msg.isScreenClosed() then return
    end if
  end while
end sub
```

- [ ] **Step 3: Write `source/HttpTask.bs`**

```brs
' music_player HttpTask.bs
'
' Background HTTP fetch for the operator's feed_url override (only used
' when spec.content.feed_url is an http(s):// URL). Bundled feed loads
' synchronously in MainScene via ReadAsciiFile.

sub init()
  m.top.functionName = "fetch"
end sub

sub fetch()
  if m.top.url = invalid or m.top.url = "" then
    m.top.error = "no url set"
    return
  end if
  ut = createObject("roUrlTransfer")
  ut.setUrl(m.top.url)
  ut.setRequest("GET")
  ut.setMessagePort(createObject("roMessagePort"))
  resp = ut.getToString()
  if resp = invalid or resp = "" then
    m.top.error = "empty response or transport failure"
    return
  end if
  m.top.result = resp
end sub
```

- [ ] **Step 4: Write `components/HttpTask.xml`**

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="HttpTask" extends="Task">
  <script type="text/brightscript" uri="pkg:/source/HttpTask.bs" />
  <interface>
    <field id="url"    type="string"  />
    <field id="result" type="string"  />
    <field id="error"  type="string"  />
  </interface>
</component>
```

- [ ] **Step 5: Re-run Task 1's tests; confirm advance from "missing HttpTask" to "missing MainScene"**

Run: `pnpm -C packages/brs-gen test -- --run -t "service_name threading" 2>&1 | tail -20`

Expected: still 2 FAIL but the error now mentions missing `components/MainScene.xml` (since HttpTask exists). Confirms task ordering is correct.

- [ ] **Step 6: Run full brs-gen suite**

Run: `pnpm -C packages/brs-gen test 2>&1 | grep -E "Tests " | head -3`

Expected: 305 PASS (the 7 new failing tests from Tasks 1+4 are scoped to the new template only and don't affect the 305 existing-template tests).

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/templates/music_player/files/source/Main.bs \
        packages/brs-gen/templates/music_player/files/source/HttpTask.bs \
        packages/brs-gen/templates/music_player/files/components/HttpTask.xml
git commit -m "$(cat <<'EOF'
feat(brs-gen): music_player Main.bs + HttpTask (xml + bs)

Main.bs is the SceneGraph bootstrap: creates Scene, fires
Main/before_scene_show init hook, shows scene, waits on message port.

HttpTask is the now-canonical Task subclass with mandatory
<interface><field id='url'/> + <field id='result'/> + <field id='error'/>
declarations (silent no-op writes otherwise per the v0.4 lesson). Used
only when spec.content.feed_url is http(s)://; bundled feed loads
synchronously in MainScene via ReadAsciiFile.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `components/MainScene.{xml,bs}`

**Why sixth:** owns the Audio node, the PosterGrid, and the MiniBar mount point. Largest single file in the template.

**Files:**

- Create: `packages/brs-gen/templates/music_player/files/components/MainScene.xml`
- Create: `packages/brs-gen/templates/music_player/files/components/MainScene.bs`

- [ ] **Step 1: Write MainScene.xml**

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MainScene" extends="Scene">
  <script type="text/brightscript" uri="MainScene.bs" />
  <script type="text/brightscript" uri="pkg:/source/Feed.bs" />
  <script type="text/brightscript" uri="pkg:/source/_template/config.bs" />
  <script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />
  <children>
    <Rectangle id="bg" width="1920" height="1080" color="0x0c0820FF" />
    <Label id="header" translation="[100, 60]" width="1720" height="60" text="" color="0xFFFFFFFF" font="font:LargeBoldSystemFont" />
    <Label id="loadingLabel" translation="[100, 500]" width="1720" height="60" text="Loading..." color="0xCCCCCCFF" font="font:MediumSystemFont" horizAlign="center" />
    <Label id="errorLabel" translation="[100, 500]" width="1720" height="60" text="" color="0xFF6666FF" visible="false" font="font:MediumSystemFont" horizAlign="center" />
    <PosterGrid id="grid" translation="[100, 200]" numColumns="3" basePosterSize="[560, 560]" itemSize="[560, 660]" itemSpacing="[20, 30]" caption1NumLines="1" captionPosterGap="20" />
    <MiniBar id="miniBar" translation="[0, 1000]" visible="false" />
    <Audio id="audio" />
  </children>
</component>
```

(The Audio node is declared in XML rather than created at runtime via `m.top.createChild("Audio")`. Spec section 4 prose mentions the runtime approach; both are valid SceneGraph patterns. The XML declaration is preferred here because it makes the node tree visible from one file and `findNode("audio")` is unambiguous.)

- [ ] **Step 2: Write MainScene.bs**

```brs
sub init()
  m.bg            = m.top.findNode("bg")
  m.header        = m.top.findNode("header")
  m.loadingLabel  = m.top.findNode("loadingLabel")
  m.errorLabel    = m.top.findNode("errorLabel")
  m.grid          = m.top.findNode("grid")
  m.miniBar       = m.top.findNode("miniBar")
  m.audio         = m.top.findNode("audio")

  m.nowPlayingRef = invalid
  m.miniBarVisibleSticky = false
  m.lastFocusedGridIndex = 0

  cfg = TemplateConfig()
  serviceName = cfg.service_name
  if serviceName = invalid or serviceName = "" then serviceName = cfg.channel_name
  m.header.text = serviceName

  m.grid.observeField("itemSelected", "onPosterSelected")
  m.grid.observeField("itemFocused",  "onPosterFocused")
  m.audio.observeField("state",       "onAudioStateChange")

  LoadFeed()

  Modules_OnMainSceneAfterSceneShow(m)
end sub

sub LoadFeed()
  cfg = TemplateConfig()
  feedUrl = cfg.feed_url
  if feedUrl = invalid or feedUrl = "" then feedUrl = "pkg:/data/music-feed.json"

  if Left(feedUrl, 7) = "http://" or Left(feedUrl, 8) = "https://"
    m.feedTask = createObject("roSGNode", "HttpTask")
    m.feedTask.observeField("state", "onFeedFetchState")
    m.feedTask.url = feedUrl
    m.feedTask.control = "run"
  else
    feed = MusicFeed_LoadBundled(feedUrl)
    BindFeed(feed)
  end if
end sub

sub onFeedFetchState()
  if m.feedTask.state <> "stop" then return
  if m.feedTask.error <> invalid and m.feedTask.error <> ""
    m.loadingLabel.visible = false
    m.errorLabel.text = "Feed load failed: " + m.feedTask.error
    m.errorLabel.visible = true
    return
  end if
  feed = ParseJson(m.feedTask.result)
  BindFeed(feed)
end sub

sub BindFeed(feed as dynamic)
  if feed = invalid or feed.playlists = invalid
    m.loadingLabel.visible = false
    m.errorLabel.text = "Feed parse failed."
    m.errorLabel.visible = true
    return
  end if

  root = createObject("roSGNode", "ContentNode")
  for each pl in feed.playlists
    item = root.createChild("ContentNode")
    item.title = pl.title
    if pl.art <> invalid then item.HDPosterUrl = pl.art
  end for
  m.grid.content = root

  m.feed = feed
  m.loadingLabel.visible = false
  m.grid.setFocus(true)
end sub

' Cross-component focus routing per news_channel pattern.
function onKeyEvent(key as string, press as boolean) as boolean
  if not press then return false

  ' Down -> MiniBar from anywhere on the PosterGrid. With 3 playlists in
  ' a single row this is OK; if a future expansion adds rows beyond the
  ' first, restrict this to the bottom row by inspecting m.grid.itemFocused
  ' against (totalItems - numColumns).
  if key = "down" and m.grid.hasFocus() and m.miniBar.visible then
    inner = m.miniBar.findNode("playPause")
    if inner <> invalid then inner.setFocus(true) else m.miniBar.setFocus(true)
    return true
  end if

  if key = "up" and m.miniBar.isInFocusChain() then
    m.grid.setFocus(true)
    if m.lastFocusedGridIndex <> invalid then m.grid.jumpToItem = m.lastFocusedGridIndex
    return true
  end if

  if key = "select" and m.miniBar.isInFocusChain() then
    if m.audio.state = "playing"
      m.audio.control = "pause"
    else
      m.audio.control = "play"
    end if
    return true
  end if

  if key = "right" and m.miniBar.isInFocusChain() then
    if m.queue <> invalid and m.queueIndex <> invalid then OpenNowPlaying(m.queue, m.queueIndex, false)
    return true
  end if

  if key = "back" and m.miniBar.isInFocusChain() then
    m.grid.setFocus(true)
    return true
  end if

  return false
end function

sub onPosterFocused()
  if m.grid.itemFocused <> invalid then m.lastFocusedGridIndex = m.grid.itemFocused
end sub

sub onPosterSelected()
  idx = m.grid.itemSelected
  if idx = invalid then return
  if m.feed = invalid or m.feed.playlists = invalid then return
  if idx < 0 or idx >= m.feed.playlists.Count() then return
  pl = m.feed.playlists[idx]
  tracks = MusicFeed_TracksForPlaylist(m.feed, pl.id)
  if tracks.Count() = 0 then return
  OpenNowPlaying(tracks, 0, true)
end sub

sub OpenNowPlaying(queue as object, queueIndex as integer, startPlayback as boolean)
  m.queue = queue
  m.queueIndex = queueIndex

  track = queue[queueIndex]
  if startPlayback or m.audio.content = invalid
    m.audio.content = MusicFeed_BuildContentNode(track)
    m.audio.control = "play"
  end if

  np = m.top.createChild("NowPlayingScene")
  np.audioRef    = m.audio
  np.queue       = queue
  np.queueIndex  = queueIndex
  np.observeField("close",          "onNowPlayingClose")
  np.observeField("queueIndexOut",  "onNowPlayingQueueIndexChange")
  m.nowPlayingRef = np
  np.setFocus(true)

  UpdateMiniBarFromTrack(track)
end sub

sub onNowPlayingClose()
  if m.nowPlayingRef = invalid then return
  m.top.removeChild(m.nowPlayingRef)
  m.nowPlayingRef = invalid

  if m.miniBarVisibleSticky and m.miniBar.visible
    inner = m.miniBar.findNode("playPause")
    if inner <> invalid then inner.setFocus(true) else m.miniBar.setFocus(true)
  else
    m.grid.setFocus(true)
  end if
end sub

sub onNowPlayingQueueIndexChange()
  if m.nowPlayingRef = invalid then return
  newIdx = m.nowPlayingRef.queueIndexOut
  if newIdx = invalid then return
  if m.queue = invalid then return
  if newIdx < 0 or newIdx >= m.queue.Count() then return
  m.queueIndex = newIdx
  track = m.queue[newIdx]
  m.audio.content = MusicFeed_BuildContentNode(track)
  m.audio.control = "play"
  UpdateMiniBarFromTrack(track)
end sub

sub onAudioStateChange()
  s = m.audio.state

  if (s = "playing" or s = "buffering") and not m.miniBarVisibleSticky
    m.miniBarVisibleSticky = true
    m.miniBar.visible = true
  end if

  if m.miniBar.visible then m.miniBar.audioState = s

  if s = "finished" and m.queue <> invalid and m.queueIndex <> invalid
    if m.queueIndex < m.queue.Count() - 1
      m.queueIndex = m.queueIndex + 1
      track = m.queue[m.queueIndex]
      m.audio.content = MusicFeed_BuildContentNode(track)
      m.audio.control = "play"
      UpdateMiniBarFromTrack(track)
      if m.nowPlayingRef <> invalid then m.nowPlayingRef.queueIndex = m.queueIndex
    end if
  end if
end sub

sub UpdateMiniBarFromTrack(track as object)
  if track = invalid then return
  m.miniBar.title  = track.title
  m.miniBar.artist = track.artist
  if track.art <> invalid then m.miniBar.art = track.art
end sub
```

- [ ] **Step 3: Re-run Task 1's tests; expect advance to "missing MiniBar"**

Run: `pnpm -C packages/brs-gen test -- --run -t "service_name threading" 2>&1 | tail -20`

Expected: errors mention missing `components/MiniBar.xml`.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/templates/music_player/files/components/MainScene.xml \
        packages/brs-gen/templates/music_player/files/components/MainScene.bs
git commit -m "feat(brs-gen): music_player MainScene (xml + bs)"
```

---

## Task 7: `components/MiniBar.{xml,bs}`

**Why seventh:** small leaf composite; one focusable child (`playPause` Button) plus three display fields (art, title, artist). Receives `audioState` from MainScene to drive icon swapping.

**Files:**

- Create: `packages/brs-gen/templates/music_player/files/components/MiniBar.xml`
- Create: `packages/brs-gen/templates/music_player/files/components/MiniBar.bs`

- [ ] **Step 1: Write MiniBar.xml**

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MiniBar" extends="Group">
  <script type="text/brightscript" uri="MiniBar.bs" />
  <interface>
    <field id="art"        type="string" onChange="onArtChange" />
    <field id="title"      type="string" onChange="onTitleChange" />
    <field id="artist"     type="string" onChange="onArtistChange" />
    <field id="audioState" type="string" onChange="onAudioStateChange" />
  </interface>
  <children>
    <Rectangle id="bg"        width="1920" height="80" color="0x000000DD" />
    <Poster    id="art"       translation="[20, 20]" width="40" height="40" loadDisplayMode="scaleToFill" />
    <Label     id="title"     translation="[80, 18]" width="900" height="22" text="" color="0xFFFFFFFF" font="font:MediumBoldSystemFont" />
    <Label     id="artist"    translation="[80, 44]" width="900" height="20" text="" color="0xCCCCCCFF" font="font:SmallSystemFont" />
    <Button    id="playPause" translation="[1700, 16]" minWidth="200" text="Play"
               iconUri="pkg:/images/play-icon-light.png"
               focusedIconUri="pkg:/images/play-icon-dark.png" />
  </children>
</component>
```

- [ ] **Step 2: Write MiniBar.bs**

```brs
sub init()
  m.artNode    = m.top.findNode("art")
  m.titleLbl   = m.top.findNode("title")
  m.artistLbl  = m.top.findNode("artist")
  m.playBtn    = m.top.findNode("playPause")
end sub

sub onArtChange()
  m.artNode.uri = m.top.art
end sub

sub onTitleChange()
  m.titleLbl.text = m.top.title
end sub

sub onArtistChange()
  m.artistLbl.text = m.top.artist
end sub

sub onAudioStateChange()
  if m.top.audioState = "playing"
    m.playBtn.text           = "Pause"
    m.playBtn.iconUri        = "pkg:/images/pause-icon-light.png"
    m.playBtn.focusedIconUri = "pkg:/images/pause-icon-dark.png"
  else
    m.playBtn.text           = "Play"
    m.playBtn.iconUri        = "pkg:/images/play-icon-light.png"
    m.playBtn.focusedIconUri = "pkg:/images/play-icon-dark.png"
  end if
end sub
```

- [ ] **Step 3: Re-run Task 1's tests; expect advance to "missing NowPlayingScene"**

Run: `pnpm -C packages/brs-gen test -- --run -t "service_name threading" 2>&1 | tail -20`

Expected: errors mention missing `components/NowPlayingScene.xml`.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/templates/music_player/files/components/MiniBar.xml \
        packages/brs-gen/templates/music_player/files/components/MiniBar.bs
git commit -m "feat(brs-gen): music_player MiniBar (xml + bs)"
```

---

## Task 8: `components/NowPlayingScene.{xml,bs}`

**Why eighth:** the largest single component apart from MainScene. Reads audioRef + queue passed at create time, drives 1Hz Timer for scrubber, observes audio state for icon swaps.

**Files:**

- Create: `packages/brs-gen/templates/music_player/files/components/NowPlayingScene.xml`
- Create: `packages/brs-gen/templates/music_player/files/components/NowPlayingScene.bs`

- [ ] **Step 1: Write NowPlayingScene.xml**

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="NowPlayingScene" extends="Group">
  <script type="text/brightscript" uri="NowPlayingScene.bs" />
  <script type="text/brightscript" uri="pkg:/source/_template/config.bs" />
  <script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />
  <interface>
    <field id="audioRef"      type="node"    onChange="onAudioRefChange" />
    <field id="queue"         type="array" />
    <field id="queueIndex"    type="integer" onChange="onQueueIndexInChange" />
    <field id="queueIndexOut" type="integer" alwaysNotify="true" />
    <field id="close"         type="boolean" alwaysNotify="true" />
  </interface>
  <children>
    <Rectangle id="overlayBg" width="1920" height="1080" color="0x080418F0" />
    <Poster id="albumArt" translation="[120, 140]" width="640" height="640" loadDisplayMode="scaleToFill" />
    <Label id="serviceLine" translation="[820, 200]" width="980" height="32" text="" color="0xCCCCCCFF" font="font:SmallSystemFont" />
    <Label id="trackTitle" translation="[820, 240]" width="980" height="60" text="" color="0xFFFFFFFF" font="font:LargeBoldSystemFont" />
    <Label id="trackArtist" translation="[820, 310]" width="980" height="36" text="" color="0xCCCCCCFF" font="font:MediumSystemFont" />
    <ProgressBar id="scrubber" translation="[820, 600]" width="980" height="20" minValue="0" maxValue="100" value="0" />
    <Label id="positionLabel" translation="[820, 630]" width="490" height="28" text="0:00" color="0xCCCCCCFF" font="font:SmallSystemFont" />
    <Label id="durationLabel" translation="[820, 630]" width="980" height="28" text="0:00" color="0xCCCCCCFF" font="font:SmallSystemFont" horizAlign="right" />
    <Button id="prev"      translation="[820, 720]"  minWidth="160" text="Prev" iconUri="pkg:/images/prev-icon-light.png"  focusedIconUri="pkg:/images/prev-icon-dark.png" />
    <Button id="rew15"     translation="[990, 720]"  minWidth="160" text="-15s" iconUri="pkg:/images/rew15-icon-light.png" focusedIconUri="pkg:/images/rew15-icon-dark.png" />
    <Button id="playPause" translation="[1160, 720]" minWidth="160" text="Play" iconUri="pkg:/images/play-icon-light.png"  focusedIconUri="pkg:/images/play-icon-dark.png" />
    <Button id="fwd15"     translation="[1330, 720]" minWidth="160" text="+15s" iconUri="pkg:/images/fwd15-icon-light.png" focusedIconUri="pkg:/images/fwd15-icon-dark.png" />
    <Button id="next"      translation="[1500, 720]" minWidth="160" text="Next" iconUri="pkg:/images/next-icon-light.png"  focusedIconUri="pkg:/images/next-icon-dark.png" />
    <Timer id="posTimer" duration="1.0" repeat="true" />
  </children>
</component>
```

- [ ] **Step 2: Write NowPlayingScene.bs**

```brs
sub init()
  m.albumArt      = m.top.findNode("albumArt")
  m.serviceLine   = m.top.findNode("serviceLine")
  m.trackTitle    = m.top.findNode("trackTitle")
  m.trackArtist   = m.top.findNode("trackArtist")
  m.scrubber      = m.top.findNode("scrubber")
  m.posLabel      = m.top.findNode("positionLabel")
  m.durLabel      = m.top.findNode("durationLabel")
  m.prevBtn       = m.top.findNode("prev")
  m.rew15Btn      = m.top.findNode("rew15")
  m.playBtn       = m.top.findNode("playPause")
  m.fwd15Btn      = m.top.findNode("fwd15")
  m.nextBtn       = m.top.findNode("next")
  m.posTimer      = m.top.findNode("posTimer")

  cfg = TemplateConfig()
  serviceName = cfg.service_name
  if serviceName = invalid or serviceName = "" then serviceName = cfg.channel_name
  m.serviceLine.text = "FROM " + UCase(serviceName)

  m.prevBtn.observeField("buttonSelected",  "onPrevSelected")
  m.rew15Btn.observeField("buttonSelected", "onRew15Selected")
  m.playBtn.observeField("buttonSelected",  "onPlayPauseSelected")
  m.fwd15Btn.observeField("buttonSelected", "onFwd15Selected")
  m.nextBtn.observeField("buttonSelected",  "onNextSelected")
  m.posTimer.observeField("fire",           "onPosTimerTick")

  Modules_OnNowPlayingSceneAfterSceneShow(m)
end sub

sub onAudioRefChange()
  if m.top.audioRef = invalid then return
  m.top.audioRef.observeField("state", "onAudioStateChange")
  BindCurrentTrack()
  m.posTimer.control = "start"
  m.playBtn.setFocus(true)
end sub

sub onQueueIndexInChange()
  BindCurrentTrack()
end sub

sub BindCurrentTrack()
  if m.top.queue = invalid or m.top.queueIndex = invalid then return
  if m.top.queueIndex < 0 or m.top.queueIndex >= m.top.queue.Count() then return
  t = m.top.queue[m.top.queueIndex]
  m.trackTitle.text  = t.title
  m.trackArtist.text = t.artist
  if t.art <> invalid then m.albumArt.uri = t.art
  if t.duration <> invalid
    m.scrubber.maxValue = t.duration
    m.durLabel.text = FormatTime(t.duration)
  end if
  RefreshPlayPauseIcon()
end sub

sub onAudioStateChange()
  RefreshPlayPauseIcon()
end sub

sub RefreshPlayPauseIcon()
  if m.top.audioRef = invalid then return
  if m.top.audioRef.state = "playing"
    m.playBtn.text           = "Pause"
    m.playBtn.iconUri        = "pkg:/images/pause-icon-light.png"
    m.playBtn.focusedIconUri = "pkg:/images/pause-icon-dark.png"
  else
    m.playBtn.text           = "Play"
    m.playBtn.iconUri        = "pkg:/images/play-icon-light.png"
    m.playBtn.focusedIconUri = "pkg:/images/play-icon-dark.png"
  end if
end sub

sub onPosTimerTick()
  if m.top.audioRef = invalid then return
  pos = m.top.audioRef.position
  dur = m.top.audioRef.duration
  if pos = invalid then pos = 0
  if dur = invalid or dur = 0
    if m.top.queue <> invalid and m.top.queueIndex <> invalid and m.top.queueIndex >= 0 and m.top.queueIndex < m.top.queue.Count()
      d = m.top.queue[m.top.queueIndex].duration
      if d <> invalid then dur = d
    end if
  end if
  if dur > 0
    m.scrubber.maxValue = dur
    m.scrubber.value    = pos
    m.posLabel.text     = FormatTime(pos)
    m.durLabel.text     = FormatTime(dur)
  end if
end sub

function FormatTime(secs as integer) as string
  if secs < 0 then secs = 0
  m_min = secs \ 60
  s_sec = secs - (m_min * 60)
  s_str = s_sec.toStr()
  if Len(s_str) = 1 then s_str = "0" + s_str
  return m_min.toStr() + ":" + s_str
end function

sub onPrevSelected()
  if m.top.queueIndex <= 0 then return
  m.top.queueIndexOut = m.top.queueIndex - 1
end sub

sub onNextSelected()
  if m.top.queue = invalid then return
  if m.top.queueIndex >= m.top.queue.Count() - 1 then return
  m.top.queueIndexOut = m.top.queueIndex + 1
end sub

sub onPlayPauseSelected()
  if m.top.audioRef = invalid then return
  if m.top.audioRef.state = "playing"
    m.top.audioRef.control = "pause"
  else
    m.top.audioRef.control = "play"
  end if
end sub

sub onRew15Selected()
  if m.top.audioRef = invalid then return
  if m.top.audioRef.state = "buffering" then return
  newPos = m.top.audioRef.position - 15
  if newPos < 0 then newPos = 0
  m.top.audioRef.seek = newPos
end sub

sub onFwd15Selected()
  if m.top.audioRef = invalid then return
  if m.top.audioRef.state = "buffering" then return
  newPos = m.top.audioRef.position + 15
  dur = m.top.audioRef.duration
  if dur <> invalid and dur > 0 and newPos > dur - 1 then newPos = dur - 1
  m.top.audioRef.seek = newPos
end sub

function onKeyEvent(key as string, press as boolean) as boolean
  if not press then return false
  if key = "back"
    m.posTimer.control = "stop"
    m.top.close = true
    return true
  end if
  if key = "play"
    onPlayPauseSelected()
    return true
  end if
  if key = "rev"
    onPrevSelected()
    return true
  end if
  if key = "fwd"
    onNextSelected()
    return true
  end if
  if key = "instantreplay"
    onRew15Selected()
    return true
  end if
  return false
end function
```

- [ ] **Step 3: Re-run Task 1's tests; confirm they NOW PASS**

Run: `pnpm -C packages/brs-gen test -- --run -t "service_name threading" 2>&1 | tail -10`

Expected: 2 PASS.

- [ ] **Step 4: Smoke-generate end-to-end**

```bash
pnpm -C packages/brs-gen build
mkdir -p /tmp/music-smoke && rm -rf /tmp/music-smoke/out
pnpm -C packages/brs-gen exec node -e "
import('./dist/index.js').then(async () => {
  const tools = new Map();
  const { registerAllTools } = await import('./dist/tools/all.js');
  registerAllTools(tools);
  const def = tools.get('generate_app');
  const r = await def.handler({
    spec: { spec_version: 2, template: 'music_player', modules: [],
            app: { name: 'Smoke', major_version: 0, minor_version: 1, build_version: 0 } },
    output_dir: '/tmp/music-smoke/out', overwrite: true,
  });
  console.log('ok:', r.ok);
});
"
```

Expected: `ok: true`. Files exist under `/tmp/music-smoke/out/components/`.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/templates/music_player/files/components/NowPlayingScene.xml \
        packages/brs-gen/templates/music_player/files/components/NowPlayingScene.bs
git commit -m "feat(brs-gen): music_player NowPlayingScene (xml + bs)"
```

---

## Task 9: Bundled feed `data/music-feed.json`

**Files:**

- Create: `packages/brs-gen/templates/music_player/files/data/music-feed.json`

- [ ] **Step 1: Author the file deterministically per spec section 7**

3 playlists x 6 tracks = 18 tracks. SoundHelix-Song-1..9 cycled across playlists with no within-playlist repeats. The full JSON content:

```json
{
  "playlists": [
    {
      "id": "p1",
      "title": "Workout Mix",
      "art": "pkg:/images/playlist-1.png",
      "tracks": [
        { "id": "p1t1", "title": "Energy 1",     "artist": "SoundHelix", "art": "pkg:/images/playlist-1.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", "stream_format": "mp3", "duration": 372 },
        { "id": "p1t2", "title": "Energy 2",     "artist": "SoundHelix", "art": "pkg:/images/playlist-1.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", "stream_format": "mp3", "duration": 425 },
        { "id": "p1t3", "title": "Energy 3",     "artist": "SoundHelix", "art": "pkg:/images/playlist-1.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", "stream_format": "mp3", "duration": 397 },
        { "id": "p1t4", "title": "Power Up",     "artist": "SoundHelix", "art": "pkg:/images/playlist-1.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3", "stream_format": "mp3", "duration": 365 },
        { "id": "p1t5", "title": "Cardio Blast", "artist": "SoundHelix", "art": "pkg:/images/playlist-1.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3", "stream_format": "mp3", "duration": 410 },
        { "id": "p1t6", "title": "Sprint",       "artist": "SoundHelix", "art": "pkg:/images/playlist-1.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3", "stream_format": "mp3", "duration": 388 }
      ]
    },
    {
      "id": "p2",
      "title": "Chill",
      "art": "pkg:/images/playlist-2.png",
      "tracks": [
        { "id": "p2t1", "title": "Calm 1",     "artist": "SoundHelix", "art": "pkg:/images/playlist-2.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3", "stream_format": "mp3", "duration": 354 },
        { "id": "p2t2", "title": "Calm 2",     "artist": "SoundHelix", "art": "pkg:/images/playlist-2.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3", "stream_format": "mp3", "duration": 402 },
        { "id": "p2t3", "title": "Calm 3",     "artist": "SoundHelix", "art": "pkg:/images/playlist-2.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3", "stream_format": "mp3", "duration": 391 },
        { "id": "p2t4", "title": "Drift",      "artist": "SoundHelix", "art": "pkg:/images/playlist-2.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", "stream_format": "mp3", "duration": 372 },
        { "id": "p2t5", "title": "Reflect",    "artist": "SoundHelix", "art": "pkg:/images/playlist-2.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", "stream_format": "mp3", "duration": 425 },
        { "id": "p2t6", "title": "Wind Down",  "artist": "SoundHelix", "art": "pkg:/images/playlist-2.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", "stream_format": "mp3", "duration": 397 }
      ]
    },
    {
      "id": "p3",
      "title": "Latest",
      "art": "pkg:/images/playlist-3.png",
      "tracks": [
        { "id": "p3t1", "title": "New Track 1", "artist": "SoundHelix", "art": "pkg:/images/playlist-3.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-9.mp3", "stream_format": "mp3", "duration": 388 },
        { "id": "p3t2", "title": "New Track 2", "artist": "SoundHelix", "art": "pkg:/images/playlist-3.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3", "stream_format": "mp3", "duration": 410 },
        { "id": "p3t3", "title": "New Track 3", "artist": "SoundHelix", "art": "pkg:/images/playlist-3.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-7.mp3", "stream_format": "mp3", "duration": 365 },
        { "id": "p3t4", "title": "Fresh Cut",   "artist": "SoundHelix", "art": "pkg:/images/playlist-3.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3", "stream_format": "mp3", "duration": 391 },
        { "id": "p3t5", "title": "Hot Off",     "artist": "SoundHelix", "art": "pkg:/images/playlist-3.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3", "stream_format": "mp3", "duration": 402 },
        { "id": "p3t6", "title": "Brand New",   "artist": "SoundHelix", "art": "pkg:/images/playlist-3.png", "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3", "stream_format": "mp3", "duration": 354 }
      ]
    }
  ]
}
```

- [ ] **Step 2: Run Task 4's feed-shape tests**

Run: `pnpm -C packages/brs-gen test -- --run music_player-feed`

Expected: 5 PASS.

- [ ] **Step 3: Run full brs-gen suite**

Expected: 312 PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/templates/music_player/files/data/music-feed.json
git commit -m "feat(brs-gen): music_player bundled feed (3 playlists x 6 tracks)"
```

---

## Task 10: `tests/asset-reuse.test.ts` entry for music_player

**Files:**

- Modify: `packages/brs-gen/tests/asset-reuse.test.ts`

- [ ] **Step 1: Read existing pattern**

```bash
cat packages/brs-gen/tests/asset-reuse.test.ts
```

- [ ] **Step 2: Extend tests to include music_player paths**

For each existing test asserting byte-equality between video_grid_channel + news_channel, add a third assertion for music_player. Pattern:

```ts
const c = sha256OfFile(join(TEMPLATES, 'music_player', 'files', 'images', 'play-icon-light.png'));
expect(c).toBe(a);
```

(and similar for `play-icon-dark.png`).

- [ ] **Step 3: Run asset-reuse tests**

Run: `pnpm -C packages/brs-gen test -- --run asset-reuse`

Expected: PASS. If FAIL, reconcile per Task 3 Step 6 guidance.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/tests/asset-reuse.test.ts
git commit -m "test(brs-gen): assert music_player play-icon byte-equal across templates"
```

---

## Task 11: `snapshots.test.ts` music_player block

**Why eleventh:** snapshot tests are written AFTER all artifacts exist (Tasks 2-9). They lock the post-compile output of every component, the manifest, the feed, and the file listing.

**Files:**

- Modify: `packages/brs-gen/tests/snapshots.test.ts` (extend with new describe block)
- Auto-create on first run: `tests/__snapshots__/music_player/*.snap.txt` (9 snapshots)

- [ ] **Step 1: Read the existing news_channel snapshot block as a pattern**

```bash
grep -n "news_channel\|describe\|snapshot" packages/brs-gen/tests/snapshots.test.ts | head -30
```

Note: each template has its own describe block with one `it()` per snapshot file. The block uses a shared `snapshotFile()` helper that reads the snapshot path, compares against generated output, and writes (with `expect.fail()`) on first run.

- [ ] **Step 2: Extend `snapshots.test.ts` with the music_player describe block**

Append after the news_channel describe block:

```ts
describe('music_player snapshots', () => {
  // 9 snapshots: manifest, MainScene.{xml,brs}, NowPlayingScene.{xml,brs},
  // MiniBar.xml, Feed.brs (post-compile), music-feed.json, file-listing.

  let outDir: string;
  beforeAll(async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'music-snap-'));
    const handler = getGenerateAppHandler();
    const result = await handler({
      spec: {
        spec_version: 2, template: 'music_player', modules: [],
        app: { name: 'MusicSnap', major_version: 0, minor_version: 1, build_version: 0 },
      },
      output_dir: join(tmp, 'out'), overwrite: true,
    });
    expect((result as Record<string, unknown>)['ok']).toBe(true);
    outDir = join(tmp, 'out');
  });

  it('manifest snapshot', async () => {
    const got = await readFile(join(outDir, 'manifest'), 'utf8');
    await expectMatchesSnapshot('music_player/manifest.snap.txt', got);
  });

  it('MainScene.xml snapshot', async () => {
    const got = await readFile(join(outDir, 'components', 'MainScene.xml'), 'utf8');
    await expectMatchesSnapshot('music_player/MainScene.xml.snap.txt', got);
  });

  it('MainScene.brs (post-compile) snapshot', async () => {
    const got = await readFile(join(outDir, 'components', 'MainScene.brs'), 'utf8');
    await expectMatchesSnapshot('music_player/MainScene.brs.snap.txt', got);

    // Regression: assert post-compile MainScene.brs preserves all init-hook
    // call sites + key state-var names so they don't get accidentally
    // deleted in a future template edit.
    expect(got).toContain('Modules_OnMainSceneAfterSceneShow');
    // The next three assertions are sensitive to bsc transpile reformatting
    // (whitespace, quote style). If they FAIL on first regen even though the
    // source is correct, loosen to a regex such as
    //   /m\.audio\s*=\s*m\.top\.findNode\(['"]audio['"]\)/
    // before assuming the source is wrong.
    expect(got).toContain('m.audio = m.top.findNode("audio")');
    expect(got).toContain('m.miniBarVisibleSticky');
    expect(got).toContain('m.nowPlayingRef');
  });

  it('NowPlayingScene.xml snapshot', async () => {
    const got = await readFile(join(outDir, 'components', 'NowPlayingScene.xml'), 'utf8');
    await expectMatchesSnapshot('music_player/NowPlayingScene.xml.snap.txt', got);
  });

  it('NowPlayingScene.brs (post-compile) snapshot', async () => {
    const got = await readFile(join(outDir, 'components', 'NowPlayingScene.brs'), 'utf8');
    await expectMatchesSnapshot('music_player/NowPlayingScene.brs.snap.txt', got);
    expect(got).toContain('Modules_OnNowPlayingSceneAfterSceneShow');
    expect(got).toContain('onPosTimerTick');
    expect(got).toContain('onPlayPauseSelected');
  });

  it('MiniBar.xml snapshot', async () => {
    const got = await readFile(join(outDir, 'components', 'MiniBar.xml'), 'utf8');
    await expectMatchesSnapshot('music_player/MiniBar.xml.snap.txt', got);
  });

  it('Feed.brs (post-compile) snapshot', async () => {
    const got = await readFile(join(outDir, 'source', 'Feed.brs'), 'utf8');
    await expectMatchesSnapshot('music_player/Feed.brs.snap.txt', got);
  });

  it('music-feed.json snapshot', async () => {
    const got = await readFile(join(outDir, 'data', 'music-feed.json'), 'utf8');
    await expectMatchesSnapshot('music_player/music-feed.json.snap.txt', got);
  });

  it('file-listing snapshot', async () => {
    const listing = await listFilesRecursive(outDir);
    await expectMatchesSnapshot('music_player/file-listing.snap.txt', listing.sort().join('\n') + '\n');
  });
});
```

(Reuse the existing `getGenerateAppHandler`, `expectMatchesSnapshot`, and `listFilesRecursive` helpers from the file's top imports; if they don't exist as named, mirror the helper functions used by news_channel's describe block.)

- [ ] **Step 3: Run snapshot tests; first run AUTO-WRITES the .snap.txt files**

Run: `pnpm -C packages/brs-gen test -- --run snapshots 2>&1 | tail -30`

Expected on first run: 9 FAIL ("snapshot file not found; written for review"). Re-run; second pass: 9 PASS.

- [ ] **Step 4: Sanity-review the auto-written snapshots**

```bash
ls packages/brs-gen/tests/__snapshots__/music_player/
```

Expected: 9 files. Inspect `MainScene.brs.snap.txt` to confirm `m.audio.observeField` + `Modules_OnMainSceneAfterSceneShow` lines exist.

- [ ] **Step 5: Run full brs-gen suite**

Run: `pnpm -C packages/brs-gen test 2>&1 | grep -E "Tests " | head -3`

Expected: ~321 PASS (312 + 9 new snapshot tests).

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/tests/snapshots.test.ts packages/brs-gen/tests/__snapshots__/music_player/
git commit -m "test(brs-gen): music_player snapshots (manifest + components + feed + listing)"
```

---

## Task 12: `e2e.test.ts` golden + `regen-golden.mjs` regenMusic()

**Why twelfth:** the byte-equal golden zip + provenance test is the single strongest determinism gate. Authored after components + snapshots so the golden won't churn during component edits.

**Files:**

- Modify: `packages/brs-gen/tests/e2e.test.ts` (extend with new describe block)
- Modify: `packages/brs-gen/scripts/regen-golden.mjs` (add `regenMusic()` + main() call + summary entry)
- Auto-create: `packages/brs-gen/tests/__golden__/music.zip`
- Auto-create: `packages/brs-gen/tests/__golden__/music.provenance.json`

- [ ] **Step 1: Read existing e2e block + regen-golden function for news_channel as patterns**

```bash
grep -n "news_channel\|regenNews\|describe" packages/brs-gen/tests/e2e.test.ts packages/brs-gen/scripts/regen-golden.mjs | head -20
```

- [ ] **Step 2: Add `regenMusic()` to `regen-golden.mjs`**

Append the function (mirror `regenNews()` exactly with `music_player` substitutions):

```js
async function regenMusic() {
  const CANONICAL_MUSIC_SPEC = {
    spec_version: 2,
    template: 'music_player',
    modules: [],
    app: { name: 'Music E2E', major_version: 0, minor_version: 1, build_version: 0 },
  };

  const work = join(tmpdir(), `brs-gen-regen-music-${randomUUID()}`);
  const outputDir = join(work, 'project');
  const outputZip = join(work, 'project.zip');
  await mkdir(work, { recursive: true });

  try {
    const { zip_path, output_dir } = await generateAppForRegen({
      outputDir,
      spec: CANONICAL_MUSIC_SPEC,
      outputZip,
    });
    await copyFile(zip_path, join(GOLDEN_DIR, 'music.zip'));
    const provenance = await readFile(join(output_dir, '.rokudev-tools', 'provenance.json'));
    await writeFile(join(GOLDEN_DIR, 'music.provenance.json'), provenance);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
```

Add `await regenMusic();` to the `main()` function alongside the existing `await regenNews();` call. Add the two music golden paths to the summary block at end of `main()`.

- [ ] **Step 3: Add the e2e describe block to `e2e.test.ts`**

Mirror the news_channel block exactly:

```ts
describe('music_player', () => {
  it('generate_app on music_player produces byte-equal golden zip + provenance', async () => {
    // ... see news_channel pattern in same file
  });

  it('validate_manifest returns ok:true on the music_player project', async () => {
    // ... mirror
  });

  it('lint reports no errors on the music_player project', async () => {
    // ... mirror
  });
});
```

- [ ] **Step 4: Generate the goldens under TZ=UTC**

```bash
TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs 2>&1 | tail -15
```

Expected: stdout reports 10 paths (5 templates x 2 files each: stub, blank, video-grid, news, music).

- [ ] **Step 5: Run e2e tests; expect all PASS**

Run: `pnpm -C packages/brs-gen test -- --run e2e 2>&1 | tail -30`

Expected: all e2e PASS, including the new 3 music_player tests.

- [ ] **Step 6: Run full brs-gen suite**

Expected: ~324 PASS (321 + 3).

- [ ] **Step 7: Commit (golden files + scripts + tests together)**

```bash
git add packages/brs-gen/scripts/regen-golden.mjs \
        packages/brs-gen/tests/e2e.test.ts \
        packages/brs-gen/tests/__golden__/music.zip \
        packages/brs-gen/tests/__golden__/music.provenance.json
git commit -m "test(brs-gen): music_player e2e golden + regen-golden.mjs regenMusic"
```

---

## Task 13: `conflict-matrix.test.ts` + `determinism.test.ts` entries

**Files:**

- Modify: `packages/brs-gen/tests/conflict-matrix.test.ts`
- Modify: `packages/brs-gen/tests/determinism.test.ts`

- [ ] **Step 1: Read both files to find the per-template entry pattern**

```bash
grep -n "news_channel\|video_grid_channel\|TEMPLATES" packages/brs-gen/tests/conflict-matrix.test.ts packages/brs-gen/tests/determinism.test.ts | head -20
```

Note: both files iterate over a `TEMPLATES` array of `{ template: string, modules: object[] }` shapes. We add one entry per file.

- [ ] **Step 2: Add music_player entries**

In `conflict-matrix.test.ts`, add (in the TEMPLATES array):

```ts
{ template: 'music_player', modules: [] },
```

In `determinism.test.ts`, add (in the TEMPLATES array, with the canonical app metadata used by other entries):

```ts
{
  template: 'music_player',
  modules: [],
  app: { name: 'Music Determinism', major_version: 0, minor_version: 1, build_version: 0 },
},
```

- [ ] **Step 3: Run both test files**

```bash
pnpm -C packages/brs-gen test -- --run conflict-matrix
pnpm -C packages/brs-gen test -- --run determinism
```

Expected: both PASS, including the new music_player entries.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/tests/conflict-matrix.test.ts packages/brs-gen/tests/determinism.test.ts
git commit -m "test(brs-gen): music_player conflict-matrix + determinism entries"
```

---

## Task 14: `scripts/t27-music.mjs` operator-run real-device driver

**Why fourteenth:** authored last among the test suite because it depends on the full template + golden path being green. Phase A only per spec section 9 (Phase B operator-feed-URL override is deferred).

**Files:**

- Create: `packages/brs-gen/scripts/t27-music.mjs`

- [ ] **Step 1: Read t27-news.mjs as the canonical pattern**

```bash
cat packages/brs-gen/scripts/t27-news.mjs
```

Note: imports `_t27-lib.mjs` helpers (sideloadAndLaunch, screenshotNoError, keypress, keypressRepeat, sleep) + `regen-helper.mjs` (generateAppForRegen) + EcpClient/EcpControl. Phase A is 13 steps. We mirror with music-specific keys + assertions.

- [ ] **Step 2: Author t27-music.mjs**

```js
#!/usr/bin/env node
// packages/brs-gen/scripts/t27-music.mjs
//
// T27 driver for music_player: Phase A (bundled feed) + Phase B placeholder.
// Phase B (operator feed-URL override) is documented as deferred per spec
// section 9; this driver implements Phase A only.
//
// Usage:
//   ROKUDEV_HOST=10.128.160.241 ROKUDEV_DEV_PASSWORD=1234 \
//     node packages/brs-gen/scripts/t27-music.mjs
//
// Required env: ROKUDEV_HOST (or ROKUDEV_DEFAULT_ROKU_HOST). Default
// password 1234 unless ROKUDEV_DEV_PASSWORD is set.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  sideloadAndLaunch, screenshotNoError, keypress, keypressRepeat, sleep,
} from './_t27-lib.mjs';
import { generateAppForRegen } from './regen-helper.mjs';
import { EcpControl } from '@rokudev/device-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);

const host = process.env.ROKUDEV_HOST || process.env.ROKUDEV_DEFAULT_ROKU_HOST;
const password = process.env.ROKUDEV_DEV_PASSWORD || process.env.ROKUDEV_ROKU_DEV_PASSWORD || '1234';
if (!host) {
  process.stderr.write('ROKUDEV_HOST not set\n');
  process.exit(2);
}

const SHOTS_DIR = join(PKG_ROOT, 'scripts', 't27-screenshots',
  `music-${new Date().toISOString().replace(/[:.]/g, '-')}`);

const passed = [];
const failed = [];

async function assertStep(name, fn) {
  try { await fn(); passed.push(name); }
  catch (e) { failed.push({ name, message: e?.message ?? String(e) }); throw e; }
}

async function ecpQueryActiveApp(host) {
  const r = await fetch(`http://${host}:8060/query/active-app`);
  const text = await r.text();
  const id = text.match(/<app[^>]*id="([^"]+)"/)?.[1] ?? '';
  const name = text.match(/<app[^>]*>([^<]*)<\/app>/)?.[1] ?? '';
  return { id, name };
}

async function ecpQueryMediaPlayer(host) {
  const r = await fetch(`http://${host}:8060/query/media-player`);
  const text = await r.text();
  return {
    state: text.match(/<player[^>]*state="([^"]+)"/)?.[1] ?? '',
    raw: text,
  };
}

async function main() {
  await mkdir(SHOTS_DIR, { recursive: true });

  const work = await mkdtemp(join(tmpdir(), 't27-music-'));
  const outputDir = join(work, 'project');
  const outputZip = join(work, 'project.zip');

  await assertStep('generate_app', async () => {
    const { zip_path } = await generateAppForRegen({
      outputDir,
      outputZip,
      spec: {
        spec_version: 2, template: 'music_player', modules: [],
        app: { name: 'Music T27', major_version: 0, minor_version: 1, build_version: 0 },
      },
    });
    if (zip_path !== outputZip) throw new Error(`zip_path mismatch: ${zip_path}`);
  });

  // ============================================================
  // Phase A: bundled feed.
  // ============================================================
  await assertStep('sideload + launch', () => sideloadAndLaunch(outputZip, host, password));
  await sleep(3000);

  await assertStep('home screenshot (no error overlay)', () =>
    screenshotNoError(host, password, join(SHOTS_DIR, '01-home.png'))
  );

  await assertStep('keypress Right (focus playlist [0,1])', () => keypress(host, 'Right'));
  await sleep(500);

  await assertStep('row screenshot', () =>
    screenshotNoError(host, password, join(SHOTS_DIR, '02-row.png'))
  );

  await assertStep('keypress Select (open NowPlaying, start playback)', () => keypress(host, 'Select'));
  await sleep(3000); // HTTP fetch + audio buffering window

  await assertStep('media-player query: state in [playing, buffering]', async () => {
    const mp = await ecpQueryMediaPlayer(host);
    if (!['playing', 'buffering'].includes(mp.state)) {
      throw new Error(`unexpected media-player state: ${mp.state}; raw: ${mp.raw.slice(0, 400)}`);
    }
    process.stdout.write(`  media-player state: ${mp.state}\n`);
  });

  await assertStep('NowPlaying screenshot', () =>
    screenshotNoError(host, password, join(SHOTS_DIR, '03-nowplaying.png'))
  );

  await assertStep('keypress Back (close NowPlaying, MiniBar visible)', () => keypress(host, 'Back'));
  await sleep(1500);

  await assertStep('miniBar screenshot', () =>
    screenshotNoError(host, password, join(SHOTS_DIR, '04-minibar.png'))
  );

  await assertStep('keypress Select (toggle pause via mini-bar)', () => keypress(host, 'Select'));
  await sleep(800);

  await assertStep('media-player query: state == paused', async () => {
    const mp = await ecpQueryMediaPlayer(host);
    if (mp.state !== 'paused') {
      throw new Error(`expected paused, got: ${mp.state}`);
    }
  });

  await assertStep('keypress Select (toggle play again)', () => keypress(host, 'Select'));
  await sleep(800);

  await assertStep('keypress Up (focus returns to PosterGrid)', () => keypress(host, 'Up'));
  await sleep(500);

  await assertStep('final screenshot', () =>
    screenshotNoError(host, password, join(SHOTS_DIR, '05-final.png'))
  );

  // Phase B is documented as deferred per spec section 9.
  process.stdout.write('Phase B (operator feed-URL override) is deferred per spec section 9.\n');
}

main()
  .then(() => {
    process.stdout.write(`T27 MUSIC PASS (Phase A only, Phase B deferred).\n`);
    process.stdout.write(`Screenshots: ${SHOTS_DIR}\n`);
    process.stdout.write(`Passed: ${passed.length} Failed: ${failed.length}\n`);
  })
  .catch(async (err) => {
    try {
      await screenshotNoError(host, password, join(SHOTS_DIR, 'zz-failure.png'),
        { assertForeground: false });
    } catch {}
    process.stderr.write(`T27 FAIL: ${err.stack ?? err}\n`);
    process.stderr.write(`Passed steps: ${JSON.stringify(passed, null, 2)}\n`);
    process.stderr.write(`Failed steps: ${JSON.stringify(failed, null, 2)}\n`);
    process.exit(1);
  });
```

- [ ] **Step 3: Smoke-test the driver compiles + has the right shape**

```bash
node --check packages/brs-gen/scripts/t27-music.mjs
```

Expected: no syntax errors.

- [ ] **Step 4: Commit (do NOT run the driver yet; that's Step 7 of Task 15)**

```bash
git add packages/brs-gen/scripts/t27-music.mjs
git commit -m "test(brs-gen): t27-music.mjs (Phase A bundled feed; Phase B deferred)"
```

---

## Task 15: Version bump 0.5.3 -> 0.5.4 + golden cascade regen + README + final verification gate

**Why last:** version bump cascades `brs_gen_version` into ALL templates' provenance.json (so all 5 golden zips regenerate). Per the regen-ordering MEMORY rule: bump version FIRST, then regen.

**Files:**

- Modify: `package.json` (root) and `packages/brs-gen/package.json` (bump 0.5.3 -> 0.5.4)
- Modify: `README.md` (append "What's in v0.5.4 (Plan 4d)" section)
- Auto-touched (regenerated under TZ=UTC): all 5 templates' goldens (stub, blank, video-grid, news, music)

- [ ] **Step 1: Bump version in both package manifests**

```bash
sed -i.bak 's/"version": "0.5.3"/"version": "0.5.4"/' package.json packages/brs-gen/package.json
rm package.json.bak packages/brs-gen/package.json.bak
grep '"version"' package.json packages/brs-gen/package.json
```

Expected: both files report `"version": "0.5.4"`.

- [ ] **Step 2: Rebuild brs-gen so the new version is in `dist/`**

Run: `pnpm -C packages/brs-gen build`

Expected: clean compile.

- [ ] **Step 3: Regen ALL goldens under TZ=UTC**

```bash
TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs
```

Expected: stdout reports 10 paths (5 templates x 2 files each).

- [ ] **Step 4: Run the brs-gen suite to confirm goldens are byte-equal**

Run: `pnpm -C packages/brs-gen test 2>&1 | grep -E "Tests " | head -3`

Expected: ~329 PASS (312 + 9 snapshots + 3 e2e + 5 conflict/determinism = approximately 329 brs-gen tests).

- [ ] **Step 5: Run all package suites + workspace build**

```bash
pnpm build
pnpm -C packages/roku-device-client test
pnpm -C packages/rokudev-device test
pnpm -C packages/brs-gen test
```

Expected:
- `pnpm build` clean.
- device-client: 296 PASS.
- rokudev-device: 184 PASS.
- brs-gen: ~329 PASS.

- [ ] **Step 6: Append "What's in v0.5.4" section to README**

After the "What's in v0.5.3 (Plan 4c)" section at end of file:

```markdown

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
```

- [ ] **Step 7: Operator T27 run on a real Roku (Phase A)**

Run on the device at the address provided by the user (10.128.160.241 unless changed):

```bash
ROKUDEV_HOST=10.128.160.241 ROKUDEV_DEV_PASSWORD=1234 \
  pnpm -C packages/brs-gen exec node scripts/t27-music.mjs
```

Expected: `T27 MUSIC PASS (Phase A only, Phase B deferred).` with 15 PASS / 0 FAIL (the driver above implements 15 assertSteps: generate_app + sideload + 5 screenshots + 4 keypresses + 2 media-player queries + 2 select-toggles + final).

If the SoundHelix audio_url cold-start buffer takes longer than 3s, expect `media-player query: state in [playing, buffering]` to PASS on `buffering`. The next steps (toggle pause, then play) drive the audio out of buffering.

- [ ] **Step 8: T27 regression on prior templates**

Per the verification gate, also confirm:

```bash
ROKUDEV_HOST=10.128.160.241 ROKUDEV_DEV_PASSWORD=1234 \
  pnpm -C packages/brs-gen exec node scripts/t27-news.mjs

ROKUDEV_HOST=10.128.160.241 ROKUDEV_DEV_PASSWORD=1234 \
  pnpm -C packages/brs-gen exec node scripts/t27-video-grid.mjs

ROKUDEV_HOST=10.128.160.241 ROKUDEV_DEV_PASSWORD=1234 \
  pnpm -C packages/brs-gen exec node scripts/t27-blank.mjs
```

Expected: each PASS at its established step count (news Phase A 13/13, video-grid 22/22, blank 4/4).

If a driver fails with ECONNRESET on the first sideload, run a manual delete first (Plan 4c lesson; see MEMORY.md):

```bash
curl -s --max-time 10 -u rokudev:1234 --digest http://10.128.160.241/plugin_install \
  -X POST -F "mysubmit=Delete" -F "archive="
sleep 3
# then retry
```

- [ ] **Step 9: Commit version bump + goldens + README**

```bash
git add package.json packages/brs-gen/package.json README.md \
        packages/brs-gen/tests/__golden__/
git commit -m "$(cat <<'EOF'
chore(release): bump rokudev-tools to 0.5.4 (Plan 4d music_player)

Goldens regenerated under TZ=UTC per the regen-ordering rule (version
bump cascades brs_gen_version into all 5 templates' provenance.json).

README appends 'What's in v0.5.4' section in chronological order.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10: Update `MEMORY.md` with Plan 4d COMPLETE entry**

Edit `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md`. After the Plan 4c COMPLETE block, append a Plan 4d COMPLETE block summarizing:

- Tag `v0.5.4`.
- Test totals (final number from Step 5).
- New template (4 components: MainScene + NowPlayingScene + MiniBar + HttpTask), new init-hook export `NowPlayingScene/after_scene_show`, new engine surface (`content.service_name` thread).
- T27 PASS evidence (model, firmware, IP, date) for music + regression results for video-grid + news + blank.
- Any new lessons surfaced during implementation. Especially worth recording if any of these arise:
  - Audio node state-machine timing on SoundHelix MP3 cold-start (Phase A robustness).
  - PosterGrid `basePosterSize` adjustment if the rendered tile is unreadable at 560x560.
  - MiniBar `audioState` field-set timing race (does icon swap visibly land before NowPlaying re-opens?).
  - Cross-component `m.audio` node-reference passing across `createChild` (does the field-set fire before NowPlayingScene's `init`?).
  - Any new ContentNode field name (`SecondaryTitle` for artist? Or do we use `description`?).

- [ ] **Step 11: Tag and push (gated on user OK per project policy)**

DO NOT push or tag without explicit user OK. Confirm with the user before running:

```bash
git tag v0.5.4 -m "Plan 4d music_player template + content.service_name engine thread"
git push origin main
git push origin v0.5.4
gh release create v0.5.4 --title "v0.5.4 - music_player template" --notes-from-tag
```

After user approval, run the above. Otherwise, leave the release-and-push step as a manual operator action.

---

## Final verification gate (must all be GREEN before claiming Plan 4d complete)

1. `pnpm build` clean.
2. `pnpm -C packages/roku-device-client test` - 296 PASS.
3. `pnpm -C packages/rokudev-device test` - 184 PASS.
4. `pnpm -C packages/brs-gen test` - approximately 329 PASS (305 baseline + 24 new from Plan 4d).
5. `TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs` (idempotent; re-run leaves goldens byte-equal).
6. `pnpm -C packages/brs-gen test` again - still all PASS (determinism check).
7. T27 Phase A `t27-music.mjs` PASS on real Roku.
8. T27 Phase B `t27-music.mjs` documented as deferred (operator-feed-override codepath verified via unit tests only at v1).
9. T27 `t27-video-grid.mjs` still PASS (regression).
10. T27 `t27-blank.mjs` still PASS (regression).
11. T27 `t27-news.mjs` Phase A still PASS (regression).
12. Secret-leak invariant: no new code path reads or echoes `dev_password` / `signing_password`.
13. README has "What's in v0.5.4 (Plan 4d)" section.
14. MEMORY.md has Plan 4d COMPLETE block.

---

## Notes for the executing agent

- Tasks 1-2 are sequential (Task 2 unblocks Task 1's tests).
- Tasks 3-9 each touch independent template files; can be done in any order, but the order here matches the data flow (assets first, then source, then components, then data).
- Task 10 is test-only; can be reordered.
- Task 11 (snapshots) requires Tasks 2-9 done first.
- Task 12 (e2e + regen) requires Task 11.
- Task 13 (conflict + determinism) can run anytime after Task 9.
- Task 14 (T27 driver) can be authored alongside earlier tasks but cannot be VERIFIED until Tasks 1-13 are done + a Roku IP is supplied.
- Task 15 must be LAST (version bump cascades to all goldens).
- The brainstorm spec at `docs/superpowers/specs/2026-05-13-plan-4d-music-player-design.md` is the source of truth. If a step here disagrees with the spec on a locked decision (D1-D11), follow the spec. If it disagrees on something the spec marked as "OPEN," follow this plan.
- Subagent-driven development is the recommended execution mode. Each task has clear acceptance criteria (test PASS, file exists, golden byte-equality, T27 step count) suitable for the spec-then-quality two-stage review pattern.

