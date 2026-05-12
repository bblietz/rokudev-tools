# Plan 4c: `news_channel` Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the third base template in the v1 catalog: `news_channel`. A hybrid live + on-demand news channel with a left-hand live HLS hero, a vertical category rail on the right, and a 3-column PosterGrid sub-screen per category. Selecting a clip plays it directly via PlayerScene; selecting Watch Live launches the live stream with Roku's default LIVE chrome.

**Architecture:** New template at `packages/brs-gen/templates/news_channel/` with five SceneGraph components (MainScene, LiveHero, CategoryRail, CategoryGridScene, PlayerScene), a bundled synthetic JSON feed at `pkg:/data/news-feed.json`, and 21 demo clips citing AVideo demo URLs + a NASA TV public HLS endpoint for the live tile. The only engine change is one additive line in `generate-app.ts` to thread `content.live_label` into the emitted `TemplateConfig()`.

**Tech Stack:** TypeScript + Zod + sharp (0.34.5 pinned) + yazl + brighterscript (bsc) + smol-toml + vitest + SceneGraph (Roku Video / PosterGrid / LabelList / Button). All already in `packages/brs-gen`.

**Spec:** `docs/superpowers/specs/2026-05-12-plan-4c-news-channel-design.md` (commit `f2a81f9`).

**Prereqs you must have read:**

- The spec above. Especially §2 (locked decisions), §4 (architecture), §5 (template files), §6 (engine changes), §9 (testing), §10 (T27).
- `packages/brs-gen/templates/video_grid_channel/template.toml` — canonical template TOML shape.
- `packages/brs-gen/templates/video_grid_channel/files/components/PlayerScene.bs` — the existing Roku Video bootstrap; we mirror its structure and add the `content.live` flag.
- `packages/brs-gen/templates/video_grid_channel/files/source/Feed.bs` — the existing JSON feed parser pattern we'll mirror for `Feed.bs`.
- `packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml` — the existing scrim + Button-with-iconUri pattern; LiveHero copies its structure.
- `packages/brs-gen/scripts/_t27-lib.mjs` and `packages/brs-gen/scripts/t27-video-grid.mjs` — T27 helper library and a complete driver to mirror for `t27-news.mjs`.
- `packages/brs-gen/src/tools/generate-app.ts` lines ~340-370 — the `TemplateConfig()` emission block we extend in Task 1.
- `packages/brs-gen/scripts/regen-golden.mjs` — golden regeneration script to extend in Task 14.
- `MEMORY.md` (under `~/.claude/projects/.../memory/`) — load-bearing lessons. Especially:
  - "RowList per-row attributes are vector2dArray" — N/A here (we use LabelList + PosterGrid), but worth knowing.
  - "HeroUnit / plain Group composites are not focusable" — applies to LiveHero. Focus the inner `playButton`, not the LiveHero Group.
  - "findNode is id-only" — every overlay we `createChild` must be cached in `m.<x>Ref` for later removal.
  - "bs_const must use KEY=false/true" — we set `DEBUG=false`.
  - "screenshotNoError foreground check" — default-on; `{assertForeground: false}` opt-out for transition / failure-capture sites.
  - "T27 preamble must be a sideloadAndLaunch reset, not a Back-spam" — Phase B in Task 15 starts with a re-sideload.
  - "Provenance regen ordering: bump version FIRST, then regen goldens" — Task 14 ordering matters.
  - "yazl 2.5.x DOS mtime is local-time; TZ=UTC required for byte-equal goldens" — applies to all golden ops.
  - "Em-dashes are forbidden in user-facing prose per global preference" — applies to commit messages and comments.

**Authoritative Roku-doc verifications used in this plan:**

- **`<interface><field alias="...">` IS a real Roku attribute.** Verified via Roku official docs (`<interface>` reference, `alias` attribute row): "Allows a top-level component field to be declared as an alias of a field in one of the component child nodes... format `node.field`, where `node` is the ID of a SceneGraph child element, and `field` is the name of one of the node fields. The type of the component child node field must match the type attribute." We use this in CategoryRail and CategoryGridScene to forward `itemSelected` from inner LabelList / PosterGrid up to the component's own interface.
- **Roku ContentNode has a `Live` field** (Boolean, "Optional flag indicating video is live. Replaces time remaining in progress bar to display 'Live'. Default is false"). BrightScript field setters are case-insensitive, so `c.live = true` and `c.Live = true` are equivalent. We use lowercase `c.live` for consistency with the rest of the codebase.

---

## File Structure

**New files (relative to repo root):**

| Path | Responsibility |
|---|---|
| `packages/brs-gen/templates/news_channel/template.toml` | Template metadata, manifest defaults, exports, branding defaults |
| `packages/brs-gen/templates/news_channel/schema.ts` | Per-template Zod schema + Example AppSpec |
| `packages/brs-gen/templates/news_channel/files/manifest.ejs` | Placeholder (see spec §5.3 of Plan 4a; merger emits the real manifest) |
| `packages/brs-gen/templates/news_channel/files/data/news-feed.json` | Bundled synthetic feed (5 categories, 21 demo clips, NASA TV live URL) |
| `packages/brs-gen/templates/news_channel/files/images/play-icon-light.png` | 48×48 light glyph (byte-equal to video_grid's copy) |
| `packages/brs-gen/templates/news_channel/files/images/play-icon-dark.png` | 48×48 dark glyph (byte-equal to video_grid's copy) |
| `packages/brs-gen/templates/news_channel/files/images/live-thumb-placeholder.png` | 1280×720 dark gradient PNG, used as live tile poster + every clip thumb in v1 |
| `packages/brs-gen/templates/news_channel/files/source/Main.bs` | SceneGraph bootstrap; fires `Main/before_scene_show` hook |
| `packages/brs-gen/templates/news_channel/files/source/Feed.bs` | `NewsFeed_LoadBundled`, `NewsFeed_BuildContentNode`, `NewsFeed_ItemsForCategory` |
| `packages/brs-gen/templates/news_channel/files/source/HttpTask.bs` | HTTP fetch (only used when `spec.content.feed_url` is `http(s)://`) |
| `packages/brs-gen/templates/news_channel/files/components/HttpTask.xml` | HttpTask gating component (mirrors video_grid) |
| `packages/brs-gen/templates/news_channel/files/components/MainScene.xml` | Root: two-column layout (LiveHero left, CategoryRail right, loading label) |
| `packages/brs-gen/templates/news_channel/files/components/MainScene.bs` | Feed load, focus routing, overlay create/remove, init hook fires |
| `packages/brs-gen/templates/news_channel/files/components/LiveHero.xml` | Group composite: poster + scrim + LIVE badge + title + summary + Watch Live Button |
| `packages/brs-gen/templates/news_channel/files/components/LiveHero.bs` | `onContentChange` → bind labels + poster; reads `TemplateConfig().live_label` |
| `packages/brs-gen/templates/news_channel/files/components/CategoryRail.xml` | Vertical LabelList; aliases `itemSelected` from inner list |
| `packages/brs-gen/templates/news_channel/files/components/CategoryRail.bs` | `onContentChange` → bind list content, focus list |
| `packages/brs-gen/templates/news_channel/files/components/CategoryGridScene.xml` | Full-screen overlay: PosterGrid 3×N; aliases `itemSelected` from inner grid |
| `packages/brs-gen/templates/news_channel/files/components/CategoryGridScene.bs` | `onItemsChange` → wrap items in root ContentNode, set focus, fire `after_scene_show` hook |
| `packages/brs-gen/templates/news_channel/files/components/PlayerScene.xml` | Roku Video node, error overlay |
| `packages/brs-gen/templates/news_channel/files/components/PlayerScene.bs` | `onContentSet` → propagate `c.live` flag, `play`; fires `before_play` hook |
| `packages/brs-gen/tests/__snapshots__/news_channel/manifest.snap.txt` | Snapshot (auto-written) |
| `packages/brs-gen/tests/__snapshots__/news_channel/MainScene.xml.snap.txt` | Snapshot |
| `packages/brs-gen/tests/__snapshots__/news_channel/MainScene.brs.snap.txt` | Snapshot (post-compile) |
| `packages/brs-gen/tests/__snapshots__/news_channel/LiveHero.xml.snap.txt` | Snapshot |
| `packages/brs-gen/tests/__snapshots__/news_channel/CategoryRail.xml.snap.txt` | Snapshot |
| `packages/brs-gen/tests/__snapshots__/news_channel/CategoryGridScene.xml.snap.txt` | Snapshot |
| `packages/brs-gen/tests/__snapshots__/news_channel/CategoryGridScene.brs.snap.txt` | Snapshot (post-compile) |
| `packages/brs-gen/tests/__snapshots__/news_channel/PlayerScene.xml.snap.txt` | Snapshot |
| `packages/brs-gen/tests/__snapshots__/news_channel/PlayerScene.brs.snap.txt` | Snapshot (post-compile) |
| `packages/brs-gen/tests/__snapshots__/news_channel/news-feed.json.snap.txt` | Snapshot (asserts bundled feed shape) |
| `packages/brs-gen/tests/__golden__/news.zip` | Golden zip (auto-regenerated under TZ=UTC) |
| `packages/brs-gen/tests/__golden__/news.provenance.json` | Golden provenance |
| `packages/brs-gen/scripts/t27-news.mjs` | Operator-run real-device driver (Phase A bundled feed + Phase B live) |
| `packages/brs-gen/tests/asset-reuse.test.ts` | sha256-equality between video_grid + news copies of `play-icon-*.png` |

**Modified files:**

| Path | Change |
|---|---|
| `packages/brs-gen/src/tools/generate-app.ts` | Thread `content.live_label` into `TemplateConfig()` (Task 1) |
| `packages/brs-gen/src/tools/generate-app.test.ts` | New tests for `live_label` threading |
| `packages/brs-gen/tests/snapshots.test.ts` | New `news_channel snapshots` describe block |
| `packages/brs-gen/tests/e2e.test.ts` | New `news_channel` describe block (golden zip + provenance) |
| `packages/brs-gen/tests/conflict-matrix.test.ts` | 2 news_channel entries (empty + stub_label) |
| `packages/brs-gen/tests/determinism.test.ts` | news_channel full-pipeline byte-equality test |
| `packages/brs-gen/scripts/regen-golden.mjs` | New `regenNews()` block + final newline of regen summary |
| `packages/brs-gen/package.json` | Bump `version` 0.5.2 → 0.5.3 |
| `package.json` (root) | Bump `version` 0.5.2 → 0.5.3 |
| `README.md` | Append "What's in v0.5.3 (Plan 4c)" section |

**Auto-touched goldens (regenerated; included in commits but not authored):**

- `packages/brs-gen/tests/__golden__/stub.zip` + `.provenance.json` — version-bump cascade.
- `packages/brs-gen/tests/__golden__/blank.zip` + `.provenance.json` — version-bump cascade.
- `packages/brs-gen/tests/__golden__/video-grid.zip` + `.provenance.json` — version-bump cascade.

---

## Errata vs. Spec

Three minor corrections made during plan authoring:

1. Spec §5.5 lists `MainScene.bs` responsibilities as ~60-80 lines of pseudocode; this plan emits the actual code (Tasks 5 + 7). The behavior is identical to what the spec describes.
2. Spec §5.7 / §5.8 use `<field alias="list.itemSelected">` — verified-supported per the official `<interface>` Roku doc; no fallback path needed in this plan. The fallback path the spec hedged on is no longer carried as an open item.
3. Spec §10 Phase A step 12 says "Press Back 2x" with an active-app check between Backs; this plan implements that as `keypressBetweenActiveAppCheck` helper inline (one helper local to `t27-news.mjs`, not promoted to `_t27-lib.mjs` until a second driver demands it).

No locked decisions changed.

---

## Task 1: Thread `content.live_label` into `TemplateConfig()`

**Why first:** every template-side reader of `TemplateConfig().live_label` needs this in place; engine change is the smallest unblocker.

**Files:**

- Modify: `packages/brs-gen/src/tools/generate-app.ts` (around line 360 inside the `TemplateConfig()` block)
- Test: `packages/brs-gen/src/tools/generate-app.test.ts` (extend)

- [ ] **Step 1: Read the existing TemplateConfig block to understand the conditional pattern**

Read lines 350-370 of `packages/brs-gen/src/tools/generate-app.ts`. Note the pattern: a single block that conditionally adds keys to `cfg` based on what's in `appSpec.content` / `brandingSpec`. You're adding one more `if` branch in that block.

- [ ] **Step 2: Find existing test cases for TemplateConfig in `generate-app.test.ts`**

Run: `grep -n "TemplateConfig\|template_config\|live_label\|feed_url" packages/brs-gen/src/tools/generate-app.test.ts`

Look for tests that exercise the TemplateConfig emit path. You'll add one alongside.

- [ ] **Step 3: Write a failing test for `live_label` propagation**

The existing test file uses a local `getHandler()` helper (lines 55-60 of `generate-app.test.ts`):

```ts
function getHandler(): ToolDef['handler'] {
  const tools = new Map<string, ToolDef>();
  registerAllTools(tools);
  const def = tools.get('generate_app');
  if (!def) throw new Error('generate_app not registered');
  return def.handler;
}
```

Reuse this. Append to `packages/brs-gen/src/tools/generate-app.test.ts`:

```ts
describe('TemplateConfig live_label threading', () => {
  // Note: news_channel template is created in Task 2. Until then these tests
  // fail with "Unknown template: news_channel". After Task 2's first commit
  // they proceed to fail with file-not-found errors against the component
  // XMLs (which Tasks 5-9 populate). After Task 9 both should pass.
  it('threads spec.content.live_label into emitted TemplateConfig() body', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'brs-gen-live-label-'));
    try {
      const handler = getHandler();
      const result = await handler({
        spec: {
          spec_version: 2,
          template: 'news_channel',
          modules: [],
          app: { name: 'NewsTest', major_version: 0, minor_version: 1, build_version: 0 },
          content: { live_label: 'AO VIVO' },
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
      expect(configBs).toContain('"live_label"');
      expect(configBs).toContain('"AO VIVO"');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('omits live_label key when spec.content.live_label is absent', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'brs-gen-live-label-absent-'));
    try {
      const handler = getHandler();
      const result = await handler({
        spec: {
          spec_version: 2,
          template: 'news_channel',
          modules: [],
          app: { name: 'NewsTest', major_version: 0, minor_version: 1, build_version: 0 },
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
      expect(configBs).not.toContain('"live_label"');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
```

If `getHandler` is not visible from the appended block (it may be inside an inner describe), hoist your describe so it's a sibling of the file-level describes that already use `getHandler()`. Confirm with `grep -n "function getHandler" packages/brs-gen/src/tools/generate-app.test.ts` before writing the new block.

- [ ] **Step 4: Run the new tests and verify they fail with "template not found"**

Run: `pnpm -C packages/brs-gen test src/tools/generate-app.test.ts -t "live_label"`

Expected: FAIL with "Unknown template: news_channel" or similar (catalog rejects the unknown id).

- [ ] **Step 5: Add the `live_label` propagation in `generate-app.ts`**

Locate the existing block (around line 357-368):

```ts
if (brandingSpec.primary_color || content) {
  const cfg: Record<string, string> = {
    channel_name: appSpec.app.name,
  };
  if (brandingSpec.primary_color) cfg['primary_color'] = brandingSpec.primary_color;
  if (content?.feed_url) cfg['feed_url'] = content.feed_url;
  if (content?.feed_format) cfg['feed_format'] = content.feed_format;
  templateConfigBrs = emitTemplateConfigBs(cfg);
}
```

Update the type-narrowing for `content` to include `live_label`, and add the conditional set. Replace with:

```ts
const content = (
  appSpec as { content?: { feed_url?: string; feed_format?: string; live_label?: string } }
).content;
if (brandingSpec.primary_color || content) {
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

(Match the surrounding indentation: 4 spaces of leading indent inside the function body, then 2 inside the `if` block.)

- [ ] **Step 6: Verify the existing `generate-app.test.ts` suite still passes (engine-side regression)**

Run: `pnpm -C packages/brs-gen test src/tools/generate-app.test.ts`

Expected: every pre-existing test PASS. The two new `live_label` tests still FAIL ("template not found"); that is correct and expected until Task 2.

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/src/tools/generate-app.ts \
        packages/brs-gen/src/tools/generate-app.test.ts
git commit -m "$(cat <<'EOF'
feat(brs-gen): thread content.live_label into TemplateConfig()

Additive change to the TemplateConfig emitter so news_channel can read
spec.content.live_label from BrightScript via TemplateConfig().live_label.
Existing templates' goldens are byte-equal pre/post (the new key only
appears when live_label is set, which only news_channel allows in its
schema).

Test blocks for the new behavior are present but pending news_channel
template scaffold (Task 2). Pre-existing generate-app tests pass.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Scaffold the `news_channel` template skeleton (TOML + schema + manifest placeholder)

**Why second:** unblocks every subsequent task. After this lands, Task 1's tests will start failing with file-not-found errors against the actual template files (LiveHero.xml etc.), which is the expected next failure mode.

**Files:**

- Create: `packages/brs-gen/templates/news_channel/template.toml`
- Create: `packages/brs-gen/templates/news_channel/schema.ts`
- Create: `packages/brs-gen/templates/news_channel/files/manifest.ejs`
- Test: `packages/brs-gen/src/tools/generate-app.test.ts` (re-run; expect different error)

- [ ] **Step 1: Create the template directory tree**

Run:

```bash
mkdir -p packages/brs-gen/templates/news_channel/files/data
mkdir -p packages/brs-gen/templates/news_channel/files/images
mkdir -p packages/brs-gen/templates/news_channel/files/source
mkdir -p packages/brs-gen/templates/news_channel/files/components
```

- [ ] **Step 2: Write `template.toml`**

Create `packages/brs-gen/templates/news_channel/template.toml`:

```toml
[template]
id = "news_channel"
version = "0.1.0"
spec_compat = ">=2"
description = "Hybrid live + on-demand news template. Live HLS hero (left), vertical category rail (right), 3-column PosterGrid sub-screen per category. Bundled synthetic feed; operator can override via spec.content.feed_url."

[template.manifest_defaults]
title           = "<%= spec.app.name %>"
major_version   = "<%= spec.app.major_version %>"
minor_version   = "<%= spec.app.minor_version %>"
build_version   = "<%= spec.app.build_version %>"
splash_color    = "<%= spec.branding.primary_color %>"
ui_resolutions  = "fhd,hd"
bs_const        = "DEBUG=false"

[template.exports]
init_hooks = [
  { scope = "Main",              phase = "before_scene_show",  file = "source/Main.bs",                  signature = "(args as dynamic) as void" },
  { scope = "MainScene",         phase = "after_scene_show",   file = "components/MainScene.bs",         signature = "(m as object) as void" },
  { scope = "CategoryGridScene", phase = "after_scene_show",   file = "components/CategoryGridScene.bs", signature = "(m as object) as void" },
  { scope = "PlayerScene",       phase = "before_play",        file = "components/PlayerScene.bs",       signature = "(m as object) as void" },
]
scene_nodes = [
  { name = "MainScene",         file = "components/MainScene.xml" },
  { name = "LiveHero",          file = "components/LiveHero.xml" },
  { name = "CategoryRail",      file = "components/CategoryRail.xml" },
  { name = "CategoryGridScene", file = "components/CategoryGridScene.xml" },
  { name = "PlayerScene",       file = "components/PlayerScene.xml" },
]

[template.branding_defaults]
primary_color = "#0c1320"
```

- [ ] **Step 3: Write `schema.ts`**

Create `packages/brs-gen/templates/news_channel/schema.ts`:

```ts
import { z } from 'zod';
import { AppSpecBase } from '../../src/spec/app-spec.js';
import { BrandingSchema } from '../../src/spec/branding.js';
import { ContentSchema } from '../../src/spec/content.js';

// news_channel-specific content extension. live_label is the LIVE-badge
// text (default "LIVE", applied at runtime in LiveHero.bs). Capped at 12
// chars because the badge layout is small; longer strings overflow.
const NewsContentSchema = ContentSchema.extend({
  live_label: z.string().min(1).max(12).optional(),
}).strict();

export const Schema = AppSpecBase.extend({
  template: z.literal('news_channel'),
  branding: BrandingSchema.partial().optional(),
  content: NewsContentSchema.optional(),
}).strict();

export const Example = {
  spec_version: 2,
  template: 'news_channel',
  modules: [],
  app: { name: 'News Channel Demo', major_version: 0, minor_version: 1, build_version: 0 },
};
```

- [ ] **Step 4: Write `files/manifest.ejs` placeholder**

Create `packages/brs-gen/templates/news_channel/files/manifest.ejs`:

```
<%# This file is present only because git does not track empty directories.
    The actual manifest is emitted by the merger from template_manifest_defaults
    + asset entries + module contributions. This file is not read.
-%>
placeholder
```

- [ ] **Step 5: Run Task 1's tests; expect a different failure**

Run: `pnpm -C packages/brs-gen test src/tools/generate-app.test.ts -t "live_label"`

Expected: FAIL, but the error has changed. Now it should fail with a missing-component-file error (e.g. `cannot read file LiveHero.xml`) because the catalog can resolve the template but the merger can't find the declared component XMLs. This confirms Task 2 worked and validates that subsequent tasks (3-9) are necessary to populate `files/`.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/templates/news_channel/template.toml \
        packages/brs-gen/templates/news_channel/schema.ts \
        packages/brs-gen/templates/news_channel/files/manifest.ejs
git commit -m "$(cat <<'EOF'
feat(brs-gen): scaffold news_channel template (TOML + schema + manifest placeholder)

Catalog-loadable skeleton for Plan 4c. No component files yet; subsequent
tasks populate source/, components/, data/, images/. Schema accepts
content.live_label (1-12 chars) and forbids unknown fields.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `source/Feed.bs` — feed parser

**Files:**

- Create: `packages/brs-gen/templates/news_channel/files/source/Feed.bs`

This file ships verbatim (no EJS template tokens). It exposes three functions that MainScene + CategoryGridScene + PlayerScene call.

- [ ] **Step 1: Read the existing `video_grid_channel/files/source/Feed.bs` for pattern reference**

Run: `cat packages/brs-gen/templates/video_grid_channel/files/source/Feed.bs | head -80`

Note: it uses `ParseJson`, builds a tree of ContentNodes, tolerates `invalid` inputs without crashing. We mirror those conventions.

- [ ] **Step 2: Create `Feed.bs`**

Create `packages/brs-gen/templates/news_channel/files/source/Feed.bs`:

```brs
' news_channel Feed.bs
'
' Loads + parses the bundled JSON feed at pkg:/data/news-feed.json (or an
' operator-overridden URL when spec.content.feed_url is set). Returns
' BrightScript associative arrays / arrays directly; ContentNode construction
' happens in NewsFeed_BuildContentNode for callers that need them.
'
' The bundled JSON shape is documented in docs/superpowers/specs/2026-05-12-plan-4c-news-channel-design.md
' under §5.3 (custom-named fields: live, categories, items).

' Reads the bundled feed file synchronously. Returns invalid on any failure;
' caller should treat that as "no feed" and surface a loading or error state.
function NewsFeed_LoadBundled(path as dynamic) as object
  if path = invalid or Type(path) <> "roString" and Type(path) <> "String" then
    path = "pkg:/data/news-feed.json"
  end if
  txt = ReadAsciiFile(path)
  if txt = invalid or Len(txt) = 0 then
    print "[news] feed file not found or empty: " ; path
    return invalid
  end if
  parsed = ParseJson(txt)
  if parsed = invalid then
    print "[news] feed parse failed: " ; path
    return invalid
  end if
  return parsed
end function

' Builds a Roku ContentNode for a single feed item. isLive controls the
' Live boolean field (default false). Returns invalid only on a missing item.
function NewsFeed_BuildContentNode(item as dynamic, isLive as boolean) as object
  if item = invalid then return invalid
  c = createObject("roSGNode", "ContentNode")
  if item.title <> invalid then c.title = item.title
  if item.summary <> invalid then c.shortDescriptionLine1 = item.summary
  if item.thumbnail_url <> invalid then c.HDPosterUrl = item.thumbnail_url
  if item.url <> invalid then c.url = item.url
  if item.stream_format <> invalid then c.streamFormat = item.stream_format
  ' Roku ContentNode supports the Live boolean (case-insensitive); we use
  ' lowercase for consistency.
  c.live = isLive
  return c
end function

' Looks up the items for one category id, returns a BrightScript array of
' ContentNodes (one per item). Empty array if the category has no items
' or doesn't exist.
function NewsFeed_ItemsForCategory(feed as dynamic, categoryId as dynamic) as object
  out = []
  if feed = invalid or feed.categories = invalid or feed.items = invalid then return out
  if categoryId = invalid then return out
  for each cat in feed.categories
    if cat.id = categoryId
      for each itemId in cat.item_ids
        for each item in feed.items
          if item.id = itemId
            node = NewsFeed_BuildContentNode(item, false)
            if node <> invalid then out.Push(node)
            exit for
          end if
        end for
      end for
      exit for
    end if
  end for
  return out
end function
```

- [ ] **Step 3: Verify file is well-formed BrightScript by running the brs-gen lint pipeline against a partial template**

The template can't be fully linted yet (other components don't exist). Skip explicit lint verification at this step; Task 13's full e2e + lint will catch any syntax errors.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/templates/news_channel/files/source/Feed.bs
git commit -m "$(cat <<'EOF'
feat(brs-gen): news_channel Feed.bs (load + parse + build ContentNode)

Three exported functions: NewsFeed_LoadBundled (synchronous pkg:/ read +
ParseJson), NewsFeed_BuildContentNode (single item -> Roku ContentNode
with optional Live flag), NewsFeed_ItemsForCategory (list lookup by id).

Tolerates invalid inputs without crashing; logs to 8085 on parse / load
failures so triage can identify operator misconfiguration.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `source/Main.bs` + `source/HttpTask.bs` + `components/HttpTask.xml`

**Files:**

- Create: `packages/brs-gen/templates/news_channel/files/source/Main.bs`
- Create: `packages/brs-gen/templates/news_channel/files/source/HttpTask.bs`
- Create: `packages/brs-gen/templates/news_channel/files/components/HttpTask.xml`

HttpTask is byte-equal to `video_grid_channel`'s copy. We don't deduplicate at the file system level (Plan 5+ concern); we just copy the bytes.

- [ ] **Step 1: Copy `HttpTask.bs` byte-for-byte from `video_grid_channel`**

Run:

```bash
cp packages/brs-gen/templates/video_grid_channel/files/source/HttpTask.bs \
   packages/brs-gen/templates/news_channel/files/source/HttpTask.bs

diff packages/brs-gen/templates/video_grid_channel/files/source/HttpTask.bs \
     packages/brs-gen/templates/news_channel/files/source/HttpTask.bs
```

Expected: no diff output.

- [ ] **Step 2: Copy `HttpTask.xml` byte-for-byte from `video_grid_channel`**

Run:

```bash
cp packages/brs-gen/templates/video_grid_channel/files/components/HttpTask.xml \
   packages/brs-gen/templates/news_channel/files/components/HttpTask.xml

diff packages/brs-gen/templates/video_grid_channel/files/components/HttpTask.xml \
     packages/brs-gen/templates/news_channel/files/components/HttpTask.xml
```

Expected: no diff output.

- [ ] **Step 3: Write `Main.bs`**

Create `packages/brs-gen/templates/news_channel/files/source/Main.bs`:

```brs
' Entry point for the news_channel template.
sub Main(args as dynamic) as void
  ' Merger-emitted init dispatch: fires "Main/before_scene_show" hooks.
  Modules_OnMainBeforeSceneShow(args)

  screen = CreateObject("roSGScreen")
  m.port = CreateObject("roMessagePort")
  screen.SetMessagePort(m.port)
  scene = screen.CreateScene("MainScene")
  screen.Show()

  while true
    msg = Wait(0, m.port)
    msgType = Type(msg)
    if msgType = "roSGScreenEvent"
      if msg.isScreenClosed() then return
    end if
  end while
end sub
```

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/templates/news_channel/files/source/Main.bs \
        packages/brs-gen/templates/news_channel/files/source/HttpTask.bs \
        packages/brs-gen/templates/news_channel/files/components/HttpTask.xml
git commit -m "feat(brs-gen): news_channel Main + HttpTask (byte-equal to video_grid copies)

Main.bs fires Main/before_scene_show then standard SceneGraph bootstrap.
HttpTask.bs / HttpTask.xml copied verbatim from video_grid_channel for
operator-supplied http(s):// feed URLs.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: `components/MainScene.xml` + `components/MainScene.bs`

**Files:**

- Create: `packages/brs-gen/templates/news_channel/files/components/MainScene.xml`
- Create: `packages/brs-gen/templates/news_channel/files/components/MainScene.bs`

MainScene owns the two-column layout, feed loading, focus routing between LiveHero and CategoryRail, and overlay create/remove for CategoryGridScene + PlayerScene.

- [ ] **Step 1: Write `MainScene.xml`**

Create `packages/brs-gen/templates/news_channel/files/components/MainScene.xml`:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MainScene" extends="Scene">
  <script type="text/brightscript" uri="MainScene.bs" />
  <script type="text/brightscript" uri="pkg:/source/Feed.bs" />
  <script type="text/brightscript" uri="pkg:/source/HttpTask.bs" />
  <script type="text/brightscript" uri="pkg:/source/_template/config.bs" />
  <script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />
  <children>
    <Rectangle id="bgFill" width="1920" height="1080" color="0x0c1320FF" />
    <LiveHero       id="liveHero"     translation="[0, 0]"     width="1152" height="1080" />
    <CategoryRail   id="categoryRail" translation="[1152, 0]"  width="768"  height="1080" />
    <Label          id="loadingLabel" translation="[940, 530]" text="Loading..." color="0xFFFFFFFF" font="font:LargeBoldSystemFont" horizAlign="center" />
    <Label          id="errorLabel"   translation="[60, 1020]" width="1800" text="" color="0xFF6666FF" font="font:SmallSystemFont" visible="false" />
  </children>
</component>
```

- [ ] **Step 2: Write `MainScene.bs`**

Create `packages/brs-gen/templates/news_channel/files/components/MainScene.bs`:

```brs
' news_channel MainScene.bs
'
' Owns layout (LiveHero + CategoryRail + loading/error labels), feed
' loading (bundled or HTTP), focus routing between hero and rail, and
' overlay create/remove for CategoryGridScene + PlayerScene.
'
' Cached overlay refs: m.gridSceneRef, m.playerSceneRef. Per the engine
' MEMORY rule, never use findNode for removal; always go through the ref.

sub init()
  m.liveHero      = m.top.findNode("liveHero")
  m.categoryRail  = m.top.findNode("categoryRail")
  m.loadingLabel  = m.top.findNode("loadingLabel")
  m.errorLabel    = m.top.findNode("errorLabel")
  m.heroPlayButton = m.liveHero.findNode("playButton")

  m.gridSceneRef   = invalid
  m.playerSceneRef = invalid
  m.lastPlayerOriginatedFromLive = false

  m.heroPlayButton.observeField("buttonSelected", "onLiveSelected")
  m.categoryRail.observeField("itemSelected", "onCategorySelected")

  LoadFeed()

  Modules_OnMainSceneAfterSceneShow(m)
end sub

sub LoadFeed()
  config = TemplateConfig()
  feedUrl = config.feed_url
  if feedUrl = invalid or feedUrl = "" then feedUrl = "pkg:/data/news-feed.json"

  if Left(feedUrl, 7) = "http://" or Left(feedUrl, 8) = "https://"
    m.feedTask = createObject("roSGNode", "HttpTask")
    m.feedTask.observeField("state", "onFeedFetchState")
    m.feedTask.url = feedUrl
    m.feedTask.control = "run"
  else
    feed = NewsFeed_LoadBundled(feedUrl)
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
  if feed = invalid
    m.errorLabel.text = "Feed parse failed."
    m.errorLabel.visible = true
    return
  end if

  if feed.live <> invalid
    liveNode = NewsFeed_BuildContentNode(feed.live, true)
    if liveNode <> invalid then m.liveHero.content = liveNode
  end if

  if feed.categories <> invalid
    railContent = createObject("roSGNode", "ContentNode")
    for each cat in feed.categories
      child = railContent.createChild("ContentNode")
      child.title = cat.name
    end for
    m.categoryRail.content = railContent
  end if

  m.feed = feed
  m.loadingLabel.visible = false
  m.heroPlayButton.setFocus(true)
end sub

sub onLiveSelected()
  if m.feed = invalid or m.feed.live = invalid then return
  liveNode = NewsFeed_BuildContentNode(m.feed.live, true)
  if liveNode = invalid then return
  m.lastPlayerOriginatedFromLive = true
  OpenPlayerScene(liveNode)
end sub

sub onCategorySelected()
  idx = m.categoryRail.itemSelected
  if idx = invalid then return
  if m.feed = invalid or m.feed.categories = invalid then return
  if idx < 0 or idx >= m.feed.categories.Count() then return
  cat = m.feed.categories[idx]
  items = NewsFeed_ItemsForCategory(m.feed, cat.id)

  grid = m.top.createChild("CategoryGridScene")
  grid.categoryName = cat.name
  grid.categoryItems = items
  grid.observeField("itemSelected", "onGridItemSelected")
  grid.observeField("close", "onGridClose")
  m.gridSceneRef = grid
  grid.setFocus(true)
end sub

sub onGridItemSelected()
  if m.gridSceneRef = invalid then return
  idx = m.gridSceneRef.itemSelected
  items = m.gridSceneRef.categoryItems
  if idx = invalid or items = invalid or idx < 0 or idx >= items.Count() then return
  m.lastPlayerOriginatedFromLive = false
  OpenPlayerScene(items[idx])
end sub

sub onGridClose()
  if m.gridSceneRef = invalid then return
  m.top.removeChild(m.gridSceneRef)
  m.gridSceneRef = invalid
  m.categoryRail.setFocus(true)
end sub

sub OpenPlayerScene(content as object)
  player = m.top.createChild("PlayerScene")
  player.observeField("close", "onPlayerClose")
  player.content = content
  m.playerSceneRef = player
  player.setFocus(true)
end sub

sub onPlayerClose()
  if m.playerSceneRef = invalid then return
  m.top.removeChild(m.playerSceneRef)
  m.playerSceneRef = invalid

  if m.lastPlayerOriginatedFromLive
    m.heroPlayButton.setFocus(true)
  else if m.gridSceneRef <> invalid
    m.gridSceneRef.setFocus(true)
  else
    m.heroPlayButton.setFocus(true)
  end if
end sub
```

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/templates/news_channel/files/components/MainScene.xml \
        packages/brs-gen/templates/news_channel/files/components/MainScene.bs
git commit -m "feat(brs-gen): news_channel MainScene (layout + feed load + overlays)

XML: bg Rectangle + LiveHero (left 1152) + CategoryRail (right 768) +
loading/error labels.

BS: feed load (bundled pkg:/ or HTTP via HttpTask), focus routing between
hero playButton and rail, cached refs (m.gridSceneRef / m.playerSceneRef)
for overlay create/remove. Origin-aware focus restore on PlayerScene close.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: `components/LiveHero.xml` + `components/LiveHero.bs`

**Files:**

- Create: `packages/brs-gen/templates/news_channel/files/components/LiveHero.xml`
- Create: `packages/brs-gen/templates/news_channel/files/components/LiveHero.bs`

Group composite (NOT focusable; per post-v0.4.1 rule). Focus belongs on inner `playButton`.

- [ ] **Step 1: Write `LiveHero.xml`**

Create `packages/brs-gen/templates/news_channel/files/components/LiveHero.xml`:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="LiveHero" extends="Group">
  <script type="text/brightscript" uri="LiveHero.bs" />
  <script type="text/brightscript" uri="pkg:/source/_template/config.bs" />
  <interface>
    <field id="content" type="node" onChange="onContentChange" />
  </interface>
  <children>
    <Rectangle id="bgGrad"     width="1152" height="1080" color="0x1d2a4aFF" />
    <Poster    id="livePoster" translation="[100, 100]" width="952" height="535" loadDisplayMode="scaleToFill" />
    <Rectangle id="scrim"      translation="[100, 605]" width="952" height="375" color="0x000000AA" />
    <Rectangle id="badgeBg"    translation="[100, 625]" width="80"  height="32"  color="0xe50914FF" />
    <Label     id="badgeText"  translation="[110, 629]" text="LIVE" color="0xFFFFFFFF" font="font:MediumBoldSystemFont" />
    <Label     id="title"      translation="[100, 670]" width="952" text="" color="0xFFFFFFFF" font="font:LargeBoldSystemFont" />
    <Label     id="summary"    translation="[100, 750]" width="952" wrap="true" maxLines="3" text="" color="0xCCCCCCFF" font="font:MediumSystemFont" />
    <Button    id="playButton" translation="[100, 880]" minWidth="220" text="Watch Live" iconUri="pkg:/images/play-icon-light.png" focusedIconUri="pkg:/images/play-icon-dark.png" />
  </children>
</component>
```

- [ ] **Step 2: Write `LiveHero.bs`**

Create `packages/brs-gen/templates/news_channel/files/components/LiveHero.bs`:

```brs
' news_channel LiveHero.bs
'
' Composite Group, NOT focusable (focus belongs on inner playButton).
' Updates poster + title + summary when content is bound. Reads
' TemplateConfig().live_label to override badge text.

sub init()
  m.poster      = m.top.findNode("livePoster")
  m.title       = m.top.findNode("title")
  m.summary     = m.top.findNode("summary")
  m.badgeText   = m.top.findNode("badgeText")
  m.playButton  = m.top.findNode("playButton")

  config = TemplateConfig()
  if config.live_label <> invalid and Len(config.live_label) > 0
    m.badgeText.text = config.live_label
  end if
end sub

sub onContentChange()
  c = m.top.content
  if c = invalid then return
  if c.title <> invalid then m.title.text = c.title
  if c.shortDescriptionLine1 <> invalid then m.summary.text = c.shortDescriptionLine1
  if c.HDPosterUrl <> invalid then m.poster.uri = c.HDPosterUrl
end sub
```

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/templates/news_channel/files/components/LiveHero.xml \
        packages/brs-gen/templates/news_channel/files/components/LiveHero.bs
git commit -m "feat(brs-gen): news_channel LiveHero (poster + scrim + LIVE badge + Watch Live)

Group composite, not focusable (focus belongs on inner playButton per the
post-v0.4.1 rule). Reads TemplateConfig().live_label to override badge text
(default 'LIVE'). Button uses iconUri/focusedIconUri pointing at bundled
PNGs to avoid the U+25B6 missing-glyph trap from v0.5.1.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: `components/CategoryRail.xml` + `components/CategoryRail.bs`

**Files:**

- Create: `packages/brs-gen/templates/news_channel/files/components/CategoryRail.xml`
- Create: `packages/brs-gen/templates/news_channel/files/components/CategoryRail.bs`

Vertical LabelList showing category names. Aliases inner list's `itemSelected` up to the parent component's interface so MainScene can observe a single field.

- [ ] **Step 1: Write `CategoryRail.xml`**

Create `packages/brs-gen/templates/news_channel/files/components/CategoryRail.xml`:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="CategoryRail" extends="Group">
  <script type="text/brightscript" uri="CategoryRail.bs" />
  <interface>
    <field id="content"      type="node"    onChange="onContentChange" />
    <field id="itemSelected" type="integer" alias="list.itemSelected" />
  </interface>
  <children>
    <Rectangle id="railBg"  width="768" height="1080" color="0x0a0f1cFF" />
    <Label     id="header"  translation="[60, 80]"  text="CATEGORIES" color="0x999999FF" font="font:SmallBoldSystemFont" />
    <LabelList id="list"    translation="[60, 130]" itemSize="[640, 60]" numRows="10" drawFocusFeedback="true" />
  </children>
</component>
```

`numRows="10"` is a generous upper bound. Bundled feed has 5 categories; LabelList scrolls internally if an operator's feed has more. The `alias` attribute is verified-supported per the official Roku `<interface>` doc.

- [ ] **Step 2: Write `CategoryRail.bs`**

Create `packages/brs-gen/templates/news_channel/files/components/CategoryRail.bs`:

```brs
sub init()
  m.list = m.top.findNode("list")
end sub

sub onContentChange()
  c = m.top.content
  if c = invalid then return
  m.list.content = c
end sub
```

CategoryRail does NOT call `setFocus(true)` itself; MainScene drives focus via `m.categoryRail.setFocus(true)` (which propagates to the inner LabelList because LabelList is the only focusable child).

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/templates/news_channel/files/components/CategoryRail.xml \
        packages/brs-gen/templates/news_channel/files/components/CategoryRail.bs
git commit -m "feat(brs-gen): news_channel CategoryRail (LabelList + aliased itemSelected)

Group + LabelList. Aliases inner list.itemSelected up to the parent's
own interface field per the official Roku <interface> doc. MainScene
observes m.categoryRail.itemSelected without reaching inside.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: `components/CategoryGridScene.xml` + `components/CategoryGridScene.bs`

**Files:**

- Create: `packages/brs-gen/templates/news_channel/files/components/CategoryGridScene.xml`
- Create: `packages/brs-gen/templates/news_channel/files/components/CategoryGridScene.bs`

Full-screen overlay. PosterGrid 3 columns. Fires `CategoryGridScene/after_scene_show` hook (new export surface in Plan 4c).

- [ ] **Step 1: Write `CategoryGridScene.xml`**

Create `packages/brs-gen/templates/news_channel/files/components/CategoryGridScene.xml`:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="CategoryGridScene" extends="Group">
  <script type="text/brightscript" uri="CategoryGridScene.bs" />
  <script type="text/brightscript" uri="pkg:/source/Feed.bs" />
  <script type="text/brightscript" uri="pkg:/source/_template/config.bs" />
  <script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />
  <interface>
    <field id="categoryName"  type="string"    onChange="onNameChange" />
    <field id="categoryItems" type="nodeArray" onChange="onItemsChange" />
    <field id="itemSelected"  type="integer"   alias="grid.itemSelected" />
    <field id="close"         type="boolean" />
  </interface>
  <children>
    <Rectangle id="bg"             width="1920" height="1080" color="0x0c1320FF" />
    <Label     id="categoryHeader" translation="[120, 60]"  text="" color="0xFFFFFFFF" font="font:LargeBoldSystemFont" />
    <Label     id="countLabel"     translation="[120, 105]" text="" color="0x888888FF" font="font:SmallSystemFont" />
    <PosterGrid id="grid"
                translation="[120, 160]"
                basePosterSize="[440, 248]"
                numColumns="3"
                numRows="3"
                itemSpacing="[24, 32]"
                drawFocusFeedback="true" />
  </children>
</component>
```

- [ ] **Step 2: Write `CategoryGridScene.bs`**

Create `packages/brs-gen/templates/news_channel/files/components/CategoryGridScene.bs`:

```brs
' news_channel CategoryGridScene.bs
'
' Full-screen overlay. PosterGrid 3 columns x N rows. Back closes the
' overlay (parent observes the close field). Fires
' CategoryGridScene/after_scene_show hook for module composition.

sub init()
  m.grid           = m.top.findNode("grid")
  m.categoryHeader = m.top.findNode("categoryHeader")
  m.countLabel     = m.top.findNode("countLabel")

  Modules_OnCategoryGridSceneAfterSceneShow(m)
end sub

sub onNameChange()
  m.categoryHeader.text = m.top.categoryName
end sub

sub onItemsChange()
  items = m.top.categoryItems
  if items = invalid then return

  root = createObject("roSGNode", "ContentNode")
  for each item in items
    root.appendChild(item)
  end for
  m.grid.content = root
  m.countLabel.text = items.Count().ToStr() + " clips"
  m.grid.setFocus(true)
end sub

function onKeyEvent(key as string, press as boolean) as boolean
  if not press then return false
  if key = "back"
    m.top.close = true
    return true
  end if
  return false
end function
```

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/templates/news_channel/files/components/CategoryGridScene.xml \
        packages/brs-gen/templates/news_channel/files/components/CategoryGridScene.bs
git commit -m "feat(brs-gen): news_channel CategoryGridScene (3-column PosterGrid overlay)

Full-screen Group + PosterGrid. Aliases inner grid.itemSelected. Back
closes (parent observes close field). Fires
CategoryGridScene/after_scene_show hook for module composition (new
export surface in Plan 4c).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: `components/PlayerScene.xml` + `components/PlayerScene.bs`

**Files:**

- Create: `packages/brs-gen/templates/news_channel/files/components/PlayerScene.xml`
- Create: `packages/brs-gen/templates/news_channel/files/components/PlayerScene.bs`

Roku Video node. Same shape as `video_grid_channel/PlayerScene` plus the `content.live` flag propagation (spec D9).

- [ ] **Step 1: Read the existing video_grid PlayerScene for reference**

```bash
cat packages/brs-gen/templates/video_grid_channel/files/components/PlayerScene.xml
cat packages/brs-gen/templates/video_grid_channel/files/components/PlayerScene.bs
```

- [ ] **Step 2: Write `PlayerScene.xml`**

Create `packages/brs-gen/templates/news_channel/files/components/PlayerScene.xml`:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="PlayerScene" extends="Group">
  <script type="text/brightscript" uri="PlayerScene.bs" />
  <script type="text/brightscript" uri="pkg:/source/_template/config.bs" />
  <script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />
  <interface>
    <field id="content" type="node"    onChange="onContentSet" />
    <field id="state"   type="string"  value="idle" />
    <field id="close"   type="boolean" />
  </interface>
  <children>
    <Rectangle id="bg"           width="1920" height="1080" color="0x000000FF" />
    <Video     id="video"        width="1920" height="1080" />
    <Label     id="errorOverlay" translation="[60, 1000]" width="1800" text="" color="0xFF6666FF" font="font:MediumSystemFont" visible="false" />
  </children>
</component>
```

- [ ] **Step 3: Write `PlayerScene.bs`**

Create `packages/brs-gen/templates/news_channel/files/components/PlayerScene.bs`:

```brs
' news_channel PlayerScene.bs
'
' Roku Video node bootstrap. Mirrors video_grid_channel's pattern; rebuilds
' a fresh inner ContentNode and adds .live flag propagation so Roku default
' chrome shows LIVE on live streams.

sub init()
  m.video = m.top.findNode("video")
  m.error = m.top.findNode("errorOverlay")
  m.video.observeField("state", "onVideoState")
end sub

sub onContentSet()
  startPlayback()
end sub

function onKeyEvent(key as string, press as boolean) as boolean
  if press and key = "back"
    m.video.control = "stop"
    m.top.close = true
    return true
  end if
  return false
end function

sub startPlayback()
  c = m.top.content
  if c = invalid or c.url = invalid or c.url = ""
    m.error.text = "No stream URL for this content."
    m.error.visible = true
    return
  end if

  Modules_OnPlayerSceneBeforePlay(m)

  content = createObject("roSGNode", "ContentNode")
  content.title = c.title
  content.url = c.url
  if c.streamFormat <> invalid then content.streamFormat = c.streamFormat
  if c.live <> invalid then content.live = c.live

  m.video.content = content
  m.video.control = "play"
end sub

sub onVideoState()
  s = m.video.state
  if s = "error"
    m.error.text = "Playback error: " + m.video.errorCode.ToStr() + " " + m.video.errorMsg
    m.error.visible = true
    m.top.state = "error"
  else if s = "finished"
    m.top.state = "done"
  else
    m.top.state = s
  end if
end sub
```

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/templates/news_channel/files/components/PlayerScene.xml \
        packages/brs-gen/templates/news_channel/files/components/PlayerScene.bs
git commit -m "feat(brs-gen): news_channel PlayerScene (Video node + live flag propagation)

Mirrors video_grid_channel PlayerScene. Adds content.live propagation
per spec D9 (Roku default chrome shows LIVE in place of time-remaining
when true). Fires before_play hook before play.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Bundled feed JSON + image assets

**Files:**

- Create: `packages/brs-gen/templates/news_channel/files/data/news-feed.json`
- Create: `packages/brs-gen/templates/news_channel/files/images/play-icon-light.png` (byte-equal to video_grid copy)
- Create: `packages/brs-gen/templates/news_channel/files/images/play-icon-dark.png` (byte-equal to video_grid copy)
- Create: `packages/brs-gen/templates/news_channel/files/images/live-thumb-placeholder.png` (deterministic 1280×720 dark gradient)
- Modify: `packages/brs-gen/scripts/gen-stub-pngs.mjs` OR add a new `scripts/gen-news-thumb.mjs` script for reproducible regen of `live-thumb-placeholder.png`

YAGNI: this task copies pre-existing PNGs and authors a static JSON. No new tooling unless `live-thumb-placeholder.png` regen needs to be reproducible — and it does (the file ships in goldens, so regenerating it must be deterministic).

- [ ] **Step 1: Copy `play-icon-*.png` byte-for-byte from video_grid**

```bash
cp packages/brs-gen/templates/video_grid_channel/files/images/play-icon-light.png \
   packages/brs-gen/templates/news_channel/files/images/play-icon-light.png

cp packages/brs-gen/templates/video_grid_channel/files/images/play-icon-dark.png \
   packages/brs-gen/templates/news_channel/files/images/play-icon-dark.png

shasum -a 256 packages/brs-gen/templates/{video_grid_channel,news_channel}/files/images/play-icon-light.png
shasum -a 256 packages/brs-gen/templates/{video_grid_channel,news_channel}/files/images/play-icon-dark.png
```

Expected: each pair of sha256s match. (Task 11 makes this an automated test.)

- [ ] **Step 2: Create `scripts/gen-news-thumb.mjs` for reproducible PNG generation**

Create `packages/brs-gen/scripts/gen-news-thumb.mjs`:

```js
// Generates the deterministic 1280x720 dark gradient PNG used as
// templates/news_channel/files/images/live-thumb-placeholder.png.
//
// Deterministic on the same OS/arch (sharp 0.34.5 + libvips lanczos3 +
// PNG compressionLevel 9 + adaptiveFiltering false). Run once during
// implementation to author the asset; thereafter the file is checked
// into git. Re-run only if the gradient design intentionally changes.
//
// Usage:
//   node packages/brs-gen/scripts/gen-news-thumb.mjs

import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(
  HERE,
  '..',
  'templates',
  'news_channel',
  'files',
  'images',
  'live-thumb-placeholder.png',
);

const W = 1280;
const H = 720;

// Pre-compute pixel buffer: vertical gradient from #1d2a4a (top) to #0c1320 (bottom).
const buf = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  const r = Math.round(0x1d * (1 - t) + 0x0c * t);
  const g = Math.round(0x2a * (1 - t) + 0x13 * t);
  const b = Math.round(0x4a * (1 - t) + 0x20 * t);
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
  }
}

const png = await sharp(buf, { raw: { width: W, height: H, channels: 4 } })
  .png({ compressionLevel: 9, palette: false, adaptiveFiltering: false })
  .toBuffer();

await writeFile(OUT, png);
console.log(`Wrote ${png.length} bytes -> ${OUT}`);
```

- [ ] **Step 3: Run the generator and check the output in**

```bash
node packages/brs-gen/scripts/gen-news-thumb.mjs
shasum -a 256 packages/brs-gen/templates/news_channel/files/images/live-thumb-placeholder.png
```

Record the sha256 from this run; it will be referenced by Task 11's reproducibility test.

- [ ] **Step 4: Author `data/news-feed.json`**

Create `packages/brs-gen/templates/news_channel/files/data/news-feed.json`:

```json
{
  "live": {
    "title": "NASA TV Live",
    "summary": "Continuous coverage from Kennedy Space Center, mission control, and crewed spaceflight operations.",
    "url": "https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8",
    "stream_format": "hls",
    "thumbnail_url": "pkg:/images/live-thumb-placeholder.png"
  },
  "categories": [
    { "id": "politics", "name": "Politics",   "item_ids": ["clip-pol-1", "clip-pol-2", "clip-pol-3", "clip-pol-4", "clip-pol-5"] },
    { "id": "tech",     "name": "Technology", "item_ids": ["clip-tec-1", "clip-tec-2", "clip-tec-3", "clip-tec-4"] },
    { "id": "business", "name": "Business",   "item_ids": ["clip-bus-1", "clip-bus-2", "clip-bus-3"] },
    { "id": "world",    "name": "World",      "item_ids": ["clip-wor-1", "clip-wor-2", "clip-wor-3", "clip-wor-4"] },
    { "id": "sports",   "name": "Sports",     "item_ids": ["clip-spo-1", "clip-spo-2", "clip-spo-3", "clip-spo-4", "clip-spo-5"] }
  ],
  "items": [
    { "id": "clip-pol-1", "title": "Election update Q4 polling cycle",     "summary": "Latest data from key swing states ahead of the next primary.", "url": "https://demo.avideo.com/videos/sample-1.mp4", "stream_format": "mp4", "duration_s": 154, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-pol-2", "title": "Senate hearing on infrastructure",      "summary": "Committee testimony on the proposed bridge program.",         "url": "https://demo.avideo.com/videos/sample-2.mp4", "stream_format": "mp4", "duration_s": 312, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-pol-3", "title": "State of the union address",            "summary": "Full address and post-speech analysis.",                       "url": "https://demo.avideo.com/videos/sample-3.mp4", "stream_format": "mp4", "duration_s": 2538,"thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-pol-4", "title": "Climate accord signing ceremony",       "summary": "Heads of state convene for treaty signing.",                   "url": "https://demo.avideo.com/videos/sample-1.mp4", "stream_format": "mp4", "duration_s": 525, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-pol-5", "title": "Foreign policy briefing",                "summary": "Press secretary on overnight diplomatic developments.",       "url": "https://demo.avideo.com/videos/sample-2.mp4", "stream_format": "mp4", "duration_s": 408, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },

    { "id": "clip-tec-1", "title": "AI regulation summit recap",             "summary": "Highlights from the cross-jurisdictional working group.",     "url": "https://demo.avideo.com/videos/sample-1.mp4", "stream_format": "mp4", "duration_s": 233, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-tec-2", "title": "Quantum chip demo on stage",              "summary": "Vendor demos error-corrected operations live.",                "url": "https://demo.avideo.com/videos/sample-2.mp4", "stream_format": "mp4", "duration_s": 187, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-tec-3", "title": "Open-source kernel release",              "summary": "Maintainers walk through the new memory subsystem.",            "url": "https://demo.avideo.com/videos/sample-3.mp4", "stream_format": "mp4", "duration_s": 612, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-tec-4", "title": "Datacenter cooling breakthrough",         "summary": "Lab announces immersion cooling field test results.",          "url": "https://demo.avideo.com/videos/sample-1.mp4", "stream_format": "mp4", "duration_s": 295, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },

    { "id": "clip-bus-1", "title": "Markets close: tech leads gainers",       "summary": "Closing bell wrap and after-hours futures.",                   "url": "https://demo.avideo.com/videos/sample-2.mp4", "stream_format": "mp4", "duration_s": 178, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-bus-2", "title": "Major merger announcement",                "summary": "Two industry leaders announce all-stock combination.",         "url": "https://demo.avideo.com/videos/sample-3.mp4", "stream_format": "mp4", "duration_s": 244, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-bus-3", "title": "Quarterly earnings briefing",              "summary": "CEO and CFO walk through quarterly results.",                  "url": "https://demo.avideo.com/videos/sample-1.mp4", "stream_format": "mp4", "duration_s": 503, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },

    { "id": "clip-wor-1", "title": "International summit opens",               "summary": "Day-one keynote and observer briefing.",                       "url": "https://demo.avideo.com/videos/sample-2.mp4", "stream_format": "mp4", "duration_s": 421, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-wor-2", "title": "Refugee aid corridor expanded",            "summary": "Aid agencies coordinate cross-border supply lines.",            "url": "https://demo.avideo.com/videos/sample-3.mp4", "stream_format": "mp4", "duration_s": 265, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-wor-3", "title": "Election results from abroad",             "summary": "Live returns and analysis from the regional vote.",            "url": "https://demo.avideo.com/videos/sample-1.mp4", "stream_format": "mp4", "duration_s": 358, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-wor-4", "title": "Cross-border treaty ratification",         "summary": "Ratification vote and joint press conference.",                "url": "https://demo.avideo.com/videos/sample-2.mp4", "stream_format": "mp4", "duration_s": 481, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },

    { "id": "clip-spo-1", "title": "Championship final recap",                 "summary": "Game-winning play, post-game interviews, and analysis.",       "url": "https://demo.avideo.com/videos/sample-3.mp4", "stream_format": "mp4", "duration_s": 376, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-spo-2", "title": "Trade deadline winners and losers",        "summary": "Beat-writer roundtable on day-of moves.",                      "url": "https://demo.avideo.com/videos/sample-1.mp4", "stream_format": "mp4", "duration_s": 218, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-spo-3", "title": "Olympic qualifier highlights",              "summary": "Top-10 plays from regional qualifiers.",                       "url": "https://demo.avideo.com/videos/sample-2.mp4", "stream_format": "mp4", "duration_s": 196, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-spo-4", "title": "Coaches show post-game",                    "summary": "Press conference and player adjustments.",                     "url": "https://demo.avideo.com/videos/sample-3.mp4", "stream_format": "mp4", "duration_s": 301, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" },
    { "id": "clip-spo-5", "title": "Off-season acquisition tracker",            "summary": "Cap implications and roster fits.",                            "url": "https://demo.avideo.com/videos/sample-1.mp4", "stream_format": "mp4", "duration_s": 252, "thumbnail_url": "pkg:/images/live-thumb-placeholder.png" }
  ]
}
```

This is 21 items across 5 categories, cycling 3 distinct AVideo demo URLs (`sample-1.mp4`, `sample-2.mp4`, `sample-3.mp4`) per the spec §14 plan-decomposition default. Total file ~7 KB.

- [ ] **Step 5: Verify the JSON is well-formed**

Run: `cat packages/brs-gen/templates/news_channel/files/data/news-feed.json | python3 -m json.tool > /dev/null && echo OK`

Expected: `OK` (no parse errors).

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/templates/news_channel/files/data/news-feed.json \
        packages/brs-gen/templates/news_channel/files/images/play-icon-light.png \
        packages/brs-gen/templates/news_channel/files/images/play-icon-dark.png \
        packages/brs-gen/templates/news_channel/files/images/live-thumb-placeholder.png \
        packages/brs-gen/scripts/gen-news-thumb.mjs
git commit -m "feat(brs-gen): news_channel bundled feed + image assets

Bundled JSON feed: 5 categories x 21 items, cycling 3 AVideo demo URLs
+ NASA TV public HLS for the live tile. ~7 KB.

Images: play-icon-light/dark.png copied byte-equal from video_grid;
live-thumb-placeholder.png is a deterministic 1280x720 dark gradient
generated via scripts/gen-news-thumb.mjs (sharp 0.34.5 pinned).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 11: Asset reuse sha256 equality test

**Files:**

- Create: `packages/brs-gen/tests/asset-reuse.test.ts`

Cheap regression guard: if a future patch drifts `play-icon-*.png` in one template but not the other, this test fails. Spec §9.6.

- [ ] **Step 1: Write the failing test**

Create `packages/brs-gen/tests/asset-reuse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function sha256OfFile(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  return createHash('sha256').update(buf).digest('hex');
}

describe('asset reuse: video_grid_channel <-> news_channel', () => {
  for (const filename of ['play-icon-light.png', 'play-icon-dark.png']) {
    it(`${filename} is byte-equal across both templates`, async () => {
      const vg = join(PKG_ROOT, 'templates/video_grid_channel/files/images', filename);
      const nc = join(PKG_ROOT, 'templates/news_channel/files/images', filename);
      const [a, b] = await Promise.all([sha256OfFile(vg), sha256OfFile(nc)]);
      expect(a).toEqual(b);
    });
  }
});
```

- [ ] **Step 2: Run the test and verify PASS**

Run: `pnpm -C packages/brs-gen test tests/asset-reuse.test.ts`

Expected: 2 PASS (we copied the bytes in Task 10).

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/tests/asset-reuse.test.ts
git commit -m "test(brs-gen): assert play-icon-*.png byte-equality across templates

Catches future drift if a patch updates one template's icon without the
other. Per spec §9.6.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 12: `news_channel` snapshot tests

**Files:**

- Modify: `packages/brs-gen/tests/snapshots.test.ts` (append `news_channel snapshots` describe block)
- Auto-create on first pass: `packages/brs-gen/tests/__snapshots__/news_channel/*.snap.txt`

This task verifies the full generate-pipeline emits the expected post-compile shapes for the new template. Mirrors the existing `video_grid_channel snapshots` block at line 198 (and `blank_scenegraph snapshots` at line 302).

- [ ] **Step 1: Read the existing block at line 198 of `tests/snapshots.test.ts`**

```bash
sed -n '195,295p' packages/brs-gen/tests/snapshots.test.ts
```

Note the structure: `beforeAll` runs `generate_app` once; each `it` reads one file from `projectDir` and compares to a saved snapshot.

- [ ] **Step 2: Append the `news_channel` describe block**

Append to `packages/brs-gen/tests/snapshots.test.ts` (after the `blank_scenegraph snapshots` block):

```ts
// ---------------------------------------------------------------------------
// news_channel snapshots (Plan 4c)
// ---------------------------------------------------------------------------
describe('news_channel snapshots', () => {
  let parentDir: string;
  let projectDir: string;

  beforeAll(async () => {
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);

    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-news-'));
    projectDir = join(parentDir, 'project');

    const handler = getGenerateAppHandler();
    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'news_channel',
        modules: [],
        app: { name: 'News Demo', major_version: 0, minor_version: 1, build_version: 0 },
      },
      output_dir: projectDir,
    });
    const payload = result as Record<string, unknown>;
    if (!payload['ok']) {
      throw new Error(`generate_app failed in beforeAll: ${JSON.stringify(payload)}`);
    }
  });

  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('manifest matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'manifest'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/manifest.snap.txt');
  });

  it('MainScene.xml (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/MainScene.xml.snap.txt');
  });

  it('MainScene.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/MainScene.brs.snap.txt');
  });

  it('LiveHero.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/LiveHero.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/LiveHero.xml.snap.txt');
  });

  it('CategoryRail.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/CategoryRail.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/CategoryRail.xml.snap.txt');
  });

  it('CategoryGridScene.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/CategoryGridScene.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot(
      '__snapshots__/news_channel/CategoryGridScene.xml.snap.txt',
    );
  });

  it('CategoryGridScene.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/CategoryGridScene.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot(
      '__snapshots__/news_channel/CategoryGridScene.brs.snap.txt',
    );
  });

  it('PlayerScene.xml matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/PlayerScene.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/PlayerScene.xml.snap.txt');
  });

  it('PlayerScene.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/PlayerScene.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/PlayerScene.brs.snap.txt');
  });

  it('news-feed.json matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'data/news-feed.json'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/news_channel/news-feed.json.snap.txt');
  });

  it('files listing (sorted) matches saved snapshot', async () => {
    const paths = await sortedRelPaths(projectDir);
    await expect(paths.join('\n') + '\n').toMatchFileSnapshot(
      '__snapshots__/news_channel/files-listing.snap.txt',
    );
  });

  // Regression markers (cheap to maintain; catch deletions of new behavior or
  // existing module-opt extension points).
  it('MainScene.brs contains Plan 4c overlay refs + init hook', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.brs'), 'utf8');
    expect(s).toContain('m.gridSceneRef');
    expect(s).toContain('m.playerSceneRef');
    expect(s).toContain('Modules_OnMainSceneAfterSceneShow');
  });

  it('CategoryGridScene.brs contains the new init-hook firing site', async () => {
    const s = await readFile(join(projectDir, 'components/CategoryGridScene.brs'), 'utf8');
    expect(s).toContain('Modules_OnCategoryGridSceneAfterSceneShow');
  });

  it('PlayerScene.brs propagates content.live flag', async () => {
    const s = await readFile(join(projectDir, 'components/PlayerScene.brs'), 'utf8');
    // Use a relaxed regex (allowing any whitespace around the assignment)
    // because the brighterscript .bs -> .brs compile step may normalize
    // the spacing of the original `content.live = c.live` assignment.
    // Both `content.live` (lhs) and `c.live` (rhs) must appear; the
    // intermediate "= " is allowed to be any whitespace run.
    expect(s).toMatch(/content\.live\s*=\s*c\.live/);
  });
});
```

- [ ] **Step 3: Run the new tests with `--update` to capture initial snapshots**

Run:

```bash
pnpm -C packages/brs-gen test tests/snapshots.test.ts -t "news_channel" --update
```

Expected: PASS with new files written under `tests/__snapshots__/news_channel/`.

- [ ] **Step 4: Inspect the newly written snapshots; sanity-check shape**

Run:

```bash
ls -la packages/brs-gen/tests/__snapshots__/news_channel/
head -30 packages/brs-gen/tests/__snapshots__/news_channel/manifest.snap.txt
head -30 packages/brs-gen/tests/__snapshots__/news_channel/MainScene.brs.snap.txt
```

Expected: manifest contains `mm_icon_focus_*` + `splash_screen_*` keys (from synthesized branding via `template_branding_defaults.primary_color = "#0c1320"`); MainScene.brs contains the cached overlay refs.

- [ ] **Step 5: Run without `--update` to confirm stability**

Run: `pnpm -C packages/brs-gen test tests/snapshots.test.ts -t "news_channel"`

Expected: all PASS.

- [ ] **Step 6: Run the full brs-gen test suite to catch regressions**

Run: `pnpm -C packages/brs-gen test`

Expected: 281 baseline + ~14 news_channel snapshot tests + 2 asset-reuse + 2 live_label = ~299 PASS. No FAIL.

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/tests/snapshots.test.ts \
        packages/brs-gen/tests/__snapshots__/news_channel/
git commit -m "test(brs-gen): news_channel snapshots (manifest + components + feed + listing)

11 file snapshots covering manifest, all 5 components (XML + key BRS),
bundled news-feed.json, and the sorted files listing. Plus 3 regression
markers asserting cached overlay refs, the new
CategoryGridScene/after_scene_show init-hook firing, and content.live
propagation in PlayerScene.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 13: `news_channel` golden e2e test

**Files:**

- Modify: `packages/brs-gen/tests/e2e.test.ts` (append `news_channel` describe block)
- Modify: `packages/brs-gen/scripts/regen-golden.mjs` (add `regenNews()`)
- Auto-created during regen: `packages/brs-gen/tests/__golden__/news.zip` + `news.provenance.json`

End-to-end MCP smoke test mirroring the existing `video_grid_channel` and `blank_scenegraph` describe blocks at e2e.test.ts:303 and ~402.

- [ ] **Step 1: Read existing video_grid e2e block for pattern**

```bash
sed -n '300,400p' packages/brs-gen/tests/e2e.test.ts
```

Note: the block spawns `dist/index.js` via the existing harness, calls `tools/call generate_app`, and asserts `fs.readFile(produced.zip).toEqual(fs.readFile(GOLDEN_DIR/video-grid.zip))`.

- [ ] **Step 2: Add `regenNews()` to `scripts/regen-golden.mjs`**

Edit `packages/brs-gen/scripts/regen-golden.mjs`. Find the `regenBlank` function and add an analogous `regenNews()` after it. Also update `main()` to call it and update the summary banner. Add this function near `regenBlank`:

```js
async function regenNews() {
  const CANONICAL_NEWS_SPEC = {
    spec_version: 2,
    template: 'news_channel',
    modules: [],
    app: { name: 'News E2E', major_version: 0, minor_version: 1, build_version: 0 },
  };

  const work = join(tmpdir(), `brs-gen-regen-news-${randomUUID()}`);
  const outputDir = join(work, 'project');
  const outputZip = join(work, 'project.zip');
  await mkdir(work, { recursive: true });

  try {
    const { zip_path, output_dir } = await generateAppForRegen({
      outputDir,
      spec: CANONICAL_NEWS_SPEC,
      outputZip,
    });
    await copyFile(zip_path, join(GOLDEN_DIR, 'news.zip'));
    const provenance = await readFile(join(output_dir, '.rokudev-tools', 'provenance.json'));
    await writeFile(join(GOLDEN_DIR, 'news.provenance.json'), provenance);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
```

In `main()`, after the existing `await regenBlank();` line, add `await regenNews();`. Update the closing `process.stdout.write` block to also list `news.zip` and `news.provenance.json`.

- [ ] **Step 3: Run the regen script under TZ=UTC**

```bash
pnpm -C packages/brs-gen build
TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs
ls -la packages/brs-gen/tests/__golden__/news.*
```

Expected: `news.zip` and `news.provenance.json` exist.

- [ ] **Step 4: Append news describe block to `tests/e2e.test.ts`**

Append after the existing `blank_scenegraph` describe block:

```ts
describe('news_channel', () => {
  let parentDir: string;
  let projectDir: string;
  let producedZipPath: string;

  beforeAll(async () => {
    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-e2e-news-'));
    projectDir = join(parentDir, 'project');
    producedZipPath = join(parentDir, 'project.zip');

    const result = await callTool('generate_app', {
      spec: {
        spec_version: 2,
        template: 'news_channel',
        modules: [],
        app: { name: 'News E2E', major_version: 0, minor_version: 1, build_version: 0 },
      },
      output_dir: projectDir,
      output_zip: producedZipPath,
    });
    const payload = JSON.parse(result.content[0].text);
    if (!payload.ok) throw new Error(`generate_app failed: ${JSON.stringify(payload)}`);
  });

  afterAll(async () => {
    if (parentDir) await rm(parentDir, { recursive: true, force: true });
  });

  it('produced zip is byte-equal to tests/__golden__/news.zip', async () => {
    const golden = await readFile(join(GOLDEN_DIR, 'news.zip'));
    const produced = await readFile(producedZipPath);
    expect(produced.equals(golden)).toBe(true);
  });

  it('provenance.json is byte-equal to golden', async () => {
    const golden = await readFile(join(GOLDEN_DIR, 'news.provenance.json'));
    const produced = await readFile(join(projectDir, '.rokudev-tools/provenance.json'));
    expect(produced.equals(golden)).toBe(true);
  });

  it('lint reports zero errors on the generated project', async () => {
    const r = await callTool('lint', { project_dir: projectDir });
    const payload = JSON.parse(r.content[0].text);
    expect(payload.ok).toBe(true);
    expect(payload.errors ?? []).toEqual([]);
  });
});
```

(Replace `callTool` with whatever the existing harness names the tool-call helper at the top of e2e.test.ts.)

- [ ] **Step 5: Run e2e tests**

Run: `pnpm -C packages/brs-gen test tests/e2e.test.ts`

Expected: all PASS, including the 3 news entries.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/tests/e2e.test.ts \
        packages/brs-gen/scripts/regen-golden.mjs \
        packages/brs-gen/tests/__golden__/news.zip \
        packages/brs-gen/tests/__golden__/news.provenance.json
git commit -m "test(brs-gen): news_channel e2e golden + regen integration

Goldens regenerated under TZ=UTC. e2e block asserts byte-equal zip +
provenance + lint clean. Goldens regenerate automatically with
regen-golden.mjs.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 14: Conflict-matrix + determinism entries

**Files:**

- Modify: `packages/brs-gen/tests/conflict-matrix.test.ts`
- Modify: `packages/brs-gen/tests/determinism.test.ts`

- [ ] **Step 1: Inspect existing matrix structure**

Run:

```bash
sed -n '253,310p' packages/brs-gen/tests/conflict-matrix.test.ts
sed -n '200,330p' packages/brs-gen/tests/determinism.test.ts
```

Note the existing `blank_scenegraph` describe and the `video_grid_channel` determinism `it` for shape reference.

- [ ] **Step 2: Append `news_channel` matrix block**

Append to `packages/brs-gen/tests/conflict-matrix.test.ts`:

```ts
describe('conflict-matrix: news_channel entries', () => {
  it('news_channel + no modules: merges, compiles, zips', async () => {
    const r = await runMatrixEntry({
      template: 'news_channel',
      modules: [],
      appName: 'News Matrix Empty',
    });
    expect(r.ok).toBe(true);
  });

  it('news_channel + stub_label: merges, compiles, zips, dispatches stub_label', async () => {
    const r = await runMatrixEntry({
      template: 'news_channel',
      modules: [{ id: 'stub_label', config: { text: 'matrix-news' } }],
      appName: 'News Matrix Stub',
    });
    expect(r.ok).toBe(true);
    // stub_label exports Main/before_scene_show, which news_channel exports.
    // Confirm dispatcher fires it.
    const dispatcher = await readFile(
      join(r.projectDir, 'source/_modules/__init_hooks.brs'),
      'utf8',
    );
    expect(dispatcher).toContain('Modules_OnMainBeforeSceneShow');
    expect(dispatcher).toContain('stub_label');
  });
});
```

(Adjust `runMatrixEntry` / locals to match the existing helper names in `conflict-matrix.test.ts`.)

- [ ] **Step 3: Append `news_channel` determinism `it`**

Append a new `it` inside the existing top-level `describe('determinism', ...)` (around line 200) of `tests/determinism.test.ts`, modeled on the `video_grid_channel` entry:

```ts
it('news_channel full-pipeline byte equality across two in-process runs', async () => {
  process.env.TZ = 'UTC';
  const cat = await loadCatalog(PKG_ROOT);
  setCatalogForTests(cat);

  const spec = {
    spec_version: 2,
    template: 'news_channel',
    modules: [],
    app: { name: 'News Determinism', major_version: 0, minor_version: 1, build_version: 0 },
  };

  const [first, second] = await Promise.all([runOnce(spec), runOnce(spec)]);

  // Walk both projectDirs and compare every file pair byte-for-byte.
  const aPaths = await sortedRelPaths(first.projectDir);
  const bPaths = await sortedRelPaths(second.projectDir);
  expect(aPaths).toEqual(bPaths);
  for (const p of aPaths) {
    const aBuf = await readFile(join(first.projectDir, p));
    const bBuf = await readFile(join(second.projectDir, p));
    expect(aBuf.equals(bBuf)).toBe(true);
  }
});
```

(Match the helper names — `runOnce`, `sortedRelPaths` — to the existing `video_grid_channel` block; copy paste and adjust the spec.)

- [ ] **Step 4: Run the new tests**

Run:

```bash
pnpm -C packages/brs-gen test tests/conflict-matrix.test.ts -t "news_channel"
pnpm -C packages/brs-gen test tests/determinism.test.ts -t "news_channel"
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/tests/conflict-matrix.test.ts \
        packages/brs-gen/tests/determinism.test.ts
git commit -m "test(brs-gen): news_channel conflict-matrix + determinism entries

Two matrix entries (empty + stub_label dispatch verification) and one
full-pipeline byte-equality determinism check under TZ=UTC.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 15: T27 real-device driver `scripts/t27-news.mjs`

**Files:**

- Create: `packages/brs-gen/scripts/t27-news.mjs`

Operator-run real-device driver. Two phases per spec §10. Mirrors the structure of `scripts/t27-video-grid.mjs` and `scripts/t27-blank.mjs`.

- [ ] **Step 1: Read the existing t27-video-grid.mjs to copy the harness shape**

```bash
sed -n '1,80p' packages/brs-gen/scripts/t27-video-grid.mjs
sed -n '120,220p' packages/brs-gen/scripts/t27-video-grid.mjs
cat packages/brs-gen/scripts/_t27-lib.mjs | head -120
```

Note the helpers used: `sideloadAndLaunch`, `screenshotNoError`, `keypress`, `keypressRepeat`, `assertPlaybackStarts`. Also note the failure-capture pattern (catch block with `{assertForeground: false}`).

- [ ] **Step 2: Write `scripts/t27-news.mjs`**

Create `packages/brs-gen/scripts/t27-news.mjs`:

```js
// packages/brs-gen/scripts/t27-news.mjs
//
// Operator-run real-device driver for news_channel (Plan 4c §10).
//
// Phase A: bundled feed, zero-branding spec.
//   1. generate_app
//   2. sideload + launch
//   3. /query/active-app == dev
//   4. screenshotNoError (clean MainScene)
//   5. Right                       -> focus moves to CategoryRail first item
//   6. Down x2                     -> focus on third category
//   7. Select                      -> CategoryGridScene push
//   8. screenshotNoError           (clean grid)
//   9. Select                      -> PlayerScene push
//   10. sleep 3s; query/media-player ~= playing (best-effort, AVideo demo)
//   11. screenshot {assertForeground:false} (capture player screenshot)
//   12. Back x2 with active-app check between Backs (PlayerScene -> Grid -> Main)
//   13. screenshotNoError (final clean state, focus on hero playButton)
//
// Phase B: live stream.
//   14. re-sideload + launch (deterministic preamble per Plan 4b.1 lesson)
//   15. Select on LiveHero playButton (focus default)
//   16. sleep 5s for HLS handshake
//   17. /query/media-player ~= playing (best-effort; NASA TV usually OK)
//   18. screenshot {assertForeground:false} (capture live screenshot)
//   19. Back -> MainScene
//   20. screenshotNoError (final clean state)
//
// Usage:
//   ROKUDEV_HOST=10.x.x.x ROKUDEV_DEV_PASSWORD=... \
//     node packages/brs-gen/scripts/t27-news.mjs
//
// Failure capture: forensic screenshots use {assertForeground:false} so
// the active-app check doesn't shadow the original failure.

import {
  sideloadAndLaunch,
  screenshotNoError,
  keypress,
  keypressRepeat,
  sleep,
  generateAppForT27,
  ecpQueryActiveApp,
  ecpQueryMediaPlayer,
} from './_t27-lib.mjs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);
const SHOTS = join(PKG_ROOT, 'scripts/t27-screenshots');
const HOST = process.env['ROKUDEV_HOST'] || process.env['ROKUDEV_DEFAULT_ROKU_HOST'];
const PW = process.env['ROKUDEV_DEV_PASSWORD'] || process.env['ROKUDEV_ROKU_DEV_PASSWORD'];

if (!HOST || !PW) {
  console.error('Missing ROKUDEV_HOST or ROKUDEV_DEV_PASSWORD; aborting.');
  process.exit(2);
}

await mkdir(SHOTS, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const shotPath = (n) => join(SHOTS, `t27-news-${STAMP}-${n}.png`);

async function run() {
  // Phase A: bundled feed.
  const { outputZip } = await generateAppForT27({
    spec: {
      spec_version: 2,
      template: 'news_channel',
      modules: [],
      app: { name: 'News T27', major_version: 0, minor_version: 1, build_version: 0 },
    },
  });

  console.log('[Phase A] sideloadAndLaunch');
  await sideloadAndLaunch(outputZip, HOST, PW);
  await sleep(3000);

  await screenshotNoError(HOST, PW, shotPath('A4-mainscene'));
  console.log('[Phase A] step 4 OK: clean MainScene');

  await keypress(HOST, 'Right');
  await sleep(500);
  await keypressRepeat(HOST, 'Down', 2);
  await sleep(500);
  await keypress(HOST, 'Select');
  await sleep(1500);

  await screenshotNoError(HOST, PW, shotPath('A8-grid'));
  console.log('[Phase A] step 8 OK: clean CategoryGridScene');

  await keypress(HOST, 'Select');
  await sleep(3000);
  try {
    const mp = await ecpQueryMediaPlayer(HOST);
    console.log('[Phase A] step 10 media-player state:', mp.state ?? '(unknown)');
  } catch (e) {
    console.warn('[Phase A] step 10 media-player query failed (best-effort):', e.message);
  }
  await screenshotNoError(HOST, PW, shotPath('A11-player'), { assertForeground: false });
  console.log('[Phase A] step 11 OK: player screenshot captured');

  // Step 12: Back x2 with active-app check between Backs.
  await keypress(HOST, 'Back');
  await sleep(800);
  let aa = await ecpQueryActiveApp(HOST);
  if (aa.id !== 'dev') {
    throw new Error(
      `[Phase A] step 12 failed: after first Back, active-app is '${aa.id}' not 'dev'`,
    );
  }
  await keypress(HOST, 'Back');
  await sleep(800);
  aa = await ecpQueryActiveApp(HOST);
  if (aa.id !== 'dev') {
    throw new Error(
      `[Phase A] step 12 failed: after second Back, active-app is '${aa.id}' not 'dev'`,
    );
  }
  await screenshotNoError(HOST, PW, shotPath('A13-main-restored'));
  console.log('[Phase A] step 13 OK: restored to MainScene');

  // Phase B: live stream. Deterministic re-sideload preamble.
  console.log('[Phase B] re-sideload + launch');
  await sideloadAndLaunch(outputZip, HOST, PW);
  await sleep(3000);

  await keypress(HOST, 'Select');
  await sleep(5000);
  try {
    const mp = await ecpQueryMediaPlayer(HOST);
    console.log('[Phase B] step 17 media-player state:', mp.state ?? '(unknown)');
  } catch (e) {
    console.warn('[Phase B] step 17 media-player query failed (best-effort):', e.message);
  }
  await screenshotNoError(HOST, PW, shotPath('B18-live'), { assertForeground: false });
  console.log('[Phase B] step 18 OK: live screenshot captured');

  await keypress(HOST, 'Back');
  await sleep(800);
  await screenshotNoError(HOST, PW, shotPath('B20-main-restored'));
  console.log('[Phase B] step 20 OK: restored to MainScene');

  console.log('\n[T27 news] PASS');
}

try {
  await run();
} catch (err) {
  console.error('\n[T27 news] FAIL:', err.message);
  // Forensic screenshot, foreground check disabled (we may have exited the
  // channel; capture whatever the device shows).
  try {
    await screenshotNoError(HOST, PW, shotPath('zz-failure'), { assertForeground: false });
    console.error('  forensic screenshot:', shotPath('zz-failure'));
  } catch (e2) {
    console.error('  forensic screenshot also failed:', e2.message);
  }
  process.exit(1);
}
```

(If `generateAppForT27`, `ecpQueryActiveApp`, `ecpQueryMediaPlayer`, or `keypressRepeat` differ in name in the existing `_t27-lib.mjs`, adjust imports to match. Worst case, write the helpers inline in this file; do NOT promote them to the shared lib unless a second driver demands them.)

- [ ] **Step 3: Smoke-check the script's syntax (parse-only)**

Run: `node --check packages/brs-gen/scripts/t27-news.mjs`

Expected: no output (clean parse).

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/scripts/t27-news.mjs
git commit -m "test(brs-gen): t27-news.mjs (Phase A bundled feed + Phase B live)

13-step Phase A (bundled feed, full nav A->grid->player->Back path) and
7-step Phase B (live, re-sideload preamble per Plan 4b.1). Failure-capture
screenshot uses {assertForeground:false}. Best-effort media-player polls.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 5: Operator runs T27 against real Roku and records evidence**

Operator step (NOT automated). Once a Roku IP + dev password are available, run:

```bash
ROKUDEV_HOST=<IP> ROKUDEV_DEV_PASSWORD=<PW> node packages/brs-gen/scripts/t27-news.mjs
```

Record: model, firmware, the printed step-OK lines, and screenshot file paths. Update spec Appendix A + this plan task with the evidence on success.

If Phase A fails: fix the channel, re-run.
If Phase A passes but Phase B fails on the live URL specifically: use the network/firewall escape valve from spec §14 (swap `live.url` to a different known-good HLS endpoint OR document the limitation in release notes if NASA TV is geo-restricted on the operator's network).

Do NOT proceed to Task 16 until Phase A is GREEN. Phase B is allowed to be DEFERRED with a clear release-notes entry if the operator's network blocks the live URL.

---

## Task 16: Version bump + golden cascade regen + README + final verification gate

**Files:**

- Modify: `package.json` (root) and `packages/brs-gen/package.json` (bump 0.5.2 → 0.5.3)
- Modify: `README.md` (append "What's in v0.5.3 (Plan 4c)" section)
- Auto-touched (regenerated under TZ=UTC): all 4 templates' goldens (stub, blank, video-grid, news)

Per the regen-ordering MEMORY lesson: **bump version FIRST, then regen goldens.** `provenance.json` includes `brs_gen_version` from `package.json`; bumping after regen produces a stale-version mismatch.

- [ ] **Step 1: Bump version in both package manifests**

```bash
sed -i.bak 's/"version": "0.5.2"/"version": "0.5.3"/' package.json packages/brs-gen/package.json
rm package.json.bak packages/brs-gen/package.json.bak
grep '"version"' package.json packages/brs-gen/package.json
```

Expected: both files report `"version": "0.5.3"`.

- [ ] **Step 2: Rebuild brs-gen so the new version is in `dist/`**

Run: `pnpm -C packages/brs-gen build`

Expected: clean build (no TS errors).

- [ ] **Step 3: Regen ALL goldens under TZ=UTC**

Run:

```bash
TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs
```

Expected: stdout reports "Golden files regenerated:" with 8 paths (stub, blank, video-grid, news × .zip + .provenance.json each).

- [ ] **Step 4: Run the full brs-gen suite to confirm goldens are byte-equal**

Run: `pnpm -C packages/brs-gen test`

Expected: all PASS. Target: ~299-305 tests (281 baseline + Task 1's +2 + Task 11's +2 + Task 12's +14 + Task 13's +3 + Task 14's +3 = ~305).

- [ ] **Step 5: Run all package suites + workspace build**

Run:

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
- brs-gen: ~305 PASS.

- [ ] **Step 6: Append "What's in v0.5.3" section to README**

Open `README.md`. After the existing "What's in v0.5.2 (Plan 4b.1)" section (at end of file), append:

```markdown

## What's in v0.5.3 (Plan 4c)

Third v1 catalog template: `news_channel`. Hybrid live + on-demand news experience. Live HLS hero on the left, vertical category rail on the right, 3-column PosterGrid sub-screen per category.

- **Template: `news_channel`** with five SceneGraph components (MainScene, LiveHero, CategoryRail, CategoryGridScene, PlayerScene). No DetailsScene — Select on a clip plays it directly.
- **Bundled feed** at `pkg:/data/news-feed.json`: 5 categories × 21 demo clips cycling 3 AVideo demo URLs, plus a NASA TV public HLS endpoint for the live tile. Operator can override via `spec.content.feed_url`.
- **`AppSpec` content extension**: `content.live_label` (optional 1-12 char string; default "LIVE") for the LIVE-badge text. Threaded into runtime via `TemplateConfig().live_label`.
- **New init-hook export**: `CategoryGridScene/after_scene_show`. Modules can decorate the category grid header, inject overlays, etc.
- **Engine change**: one additive line in `generate-app.ts` propagates `content.live_label` into the emitted `TemplateConfig()`. No behavior change for existing templates.
- **T27 driver `t27-news.mjs`** with Phase A (bundled feed) and Phase B (live stream).

Out of v0.5.3: shared component extraction across templates (Plan 5+); EPG/schedule overlays; multi-source live; per-category branding; real per-item thumbnail bundling.
```

- [ ] **Step 7: Commit version bump + goldens + README**

```bash
git add package.json packages/brs-gen/package.json README.md \
        packages/brs-gen/tests/__golden__/
git commit -m "chore(release): bump rokudev-tools to 0.5.3 (Plan 4c news_channel)

Goldens regenerated under TZ=UTC per the regen-ordering rule (version
bump cascades brs_gen_version into all 4 templates' provenance.json).

README appends 'What's in v0.5.3' section in chronological order.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 8: Update `MEMORY.md` with Plan 4c COMPLETE entry**

Edit `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md`. After the Plan 4b.1 COMPLETE block, append a Plan 4c COMPLETE block summarizing:

- Tag `v0.5.3`.
- Test totals (final number from Step 4).
- New template (5 components, no DetailsScene), new init-hook export `CategoryGridScene/after_scene_show`, new engine surface (`content.live_label` thread).
- T27 PASS evidence (model, firmware, IP, date).
- Any new lessons surfaced during implementation. Especially worth recording if any of these arise:
  - PosterGrid `basePosterSize` adjusted from drafted `[440, 248]` to a different value during on-device validation.
  - LabelList `numRows="10"` interaction with LabelList's internal scroll behavior.
  - Roku `<interface><field alias="...">` in practice (any quirks vs the doc).
  - NASA TV HLS handshake latency or geo-restriction on the operator's network (record if Phase B was deferred).
  - ContentNode case-sensitivity confirmation (`c.live` vs `c.Live`).

- [ ] **Step 9: Tag and push**

DO NOT push or tag without explicit user OK. Confirm with the user before running:

```bash
git tag v0.5.3 -m "Plan 4c news_channel template + content.live_label engine thread"
git push origin main
git push origin v0.5.3
gh release create v0.5.3 --title "v0.5.3 - news_channel template" --notes-from-tag
```

After user approval, run the above. Otherwise, leave the release-and-push step as a manual operator action.

---

## Final verification gate (must all be GREEN before claiming Plan 4c complete)

1. `pnpm build` clean.
2. `pnpm -C packages/roku-device-client test` — 296 PASS.
3. `pnpm -C packages/rokudev-device test` — 184 PASS.
4. `pnpm -C packages/brs-gen test` — ~299-305 PASS.
5. `TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs` (idempotent — re-run leaves goldens byte-equal).
6. `pnpm -C packages/brs-gen test` again — still all PASS (determinism check).
7. T27 Phase A `t27-news.mjs` PASS on real Roku.
8. T27 Phase B `t27-news.mjs` PASS or DEFERRED (with clear release-notes entry if deferred).
9. T27 `t27-video-grid.mjs` still PASS (regression).
10. T27 `t27-blank.mjs` still PASS (regression).
11. Secret-leak invariant: no new code path reads or echoes dev_password / signing_password.
12. README has "What's in v0.5.3 (Plan 4c)" section.
13. MEMORY.md has Plan 4c COMPLETE block.

---

## Notes for the executing agent

- Tasks 1-2 are sequential (Task 2 unblocks Task 1's tests).
- Tasks 3-9 each touch independent template files; can be done in any order, but the order here matches the data flow (source → MainScene → child components).
- Task 10's `gen-news-thumb.mjs` is a one-shot author tool; the resulting PNG is committed to git.
- Tasks 11-14 are test-only; they can be reordered without consequence as long as Tasks 1-10 are done first.
- Task 15 (T27 driver) requires real-device access; it can be authored alongside earlier tasks but cannot be VERIFIED until a Roku IP is supplied.
- Task 16 must be LAST (version bump cascades to all goldens).
- The brainstorm spec at `docs/superpowers/specs/2026-05-12-plan-4c-news-channel-design.md` is the source of truth. If a step here disagrees with the spec on a locked decision (D1-D11), follow the spec. If it disagrees on something the spec marked as "OPEN — to resolve in plan decomposition," follow this plan.
- Subagent-driven development is the recommended execution mode. Each task has clear acceptance criteria (test PASS, file exists, golden byte-equality) suitable for the spec-then-quality two-stage review pattern.


