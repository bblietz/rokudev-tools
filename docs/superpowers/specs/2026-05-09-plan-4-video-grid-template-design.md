# Plan 4: video_grid_channel (first real template) — design spec

**Status:** approved for planning, 2026-05-09.
**Release target:** `v0.4.0`.
**Scope owner:** `brs-gen` (no changes to `rokudev-device` or `@rokudev/device-client`).

## 1. Goals

- Ship the first production-reference Roku template: `video_grid_channel`. Hero unit above category rows; consumes a Roku Direct Publisher JSON feed; plays video via the SceneGraph `Video` node.
- Establish real-device verification (T27) as a repeatable gate for every future real template. The flow, helpers, and log format land in Plan 4 so Plans 4a-4e reuse them.
- Extend `brs-gen`'s AppSpec with the two standardized fields the PRD assumes but stub_hello did not exercise: `branding` (icon, splash, primary_color) and `content` (feed_url, feed_format).
- Add an asset pipeline that converts a single user-supplied high-resolution PNG into the HD/FHD/UHD buckets Roku's manifest requires. Deterministic; run inside `generate_app`.
- Add a `TemplateConfig()` BrightScript emitter that exposes template-level AppSpec fields to runtime code (parallel to the per-module `ModuleConfig_<id>()` emitter from Plan 3).

## 2. Non-goals

- No other v1 templates (`screensaver`, `news_channel`, `game_shell`, `blank_scenegraph`, `music_player` — each lands in a follow-up plan).
- No feature modules — Plan 5.
- No freeform LLM path — Plan 6.
- No LSP tools — Plan 7.
- No `brs-docs` MCP.
- No Channel Store precheck, captions, deep-link, auth, ads, accessibility labels — all module or skill territory in later plans.
- No localization. `en_US` only. Deferred per PRD §8.2.
- No DRM. Deferred per PRD §8.2.
- No visual-regression testing or headless Roku emulator — real-device gate suffices.

## 3. Design decisions locked during brainstorming

Recorded so they do not re-open during implementation.

| # | Decision | Rationale |
|---|---|---|
| D1 | One real template in Plan 4 (`video_grid_channel`), not the full v1 set of six. | Smaller, lower-risk plan; proves the T27 gate and shared infrastructure. Plans 4a-4e reuse the gate for remaining templates. |
| D2 | Quality bar = "reference-quality". Feed-driven, category rows, details screen, basic Video-node playback. No ads/auth/captions/a11y labels (those are Plan 5 modules). | The template is the base that Plan 5 modules compose on top of; richer branches of scope belong in modules. |
| D3 | T27 verification gate: launch + navigate + playback check via ECP. Not launch-only smoke; not full deep-link + trick-play scripted e2e. | Covers feed parse, focus navigation, player integration — the integrations most likely to regress. |
| D4 | Sample feed: public Roku sample URL (defaulted in the canonical AppSpec). Concrete URL pinned at implementation time. | The PRD's canonical example already assumes a URL-driven feed. Drift risk accepted; fix-forward if the URL ever 404s. |
| D5 | Asset bucketing done inside `brs-gen` via `sharp`. User supplies one high-res source. | The "author once" affordance is core to the product promise. The alternative (user produces three files) contradicts the product narrative. |
| D6 | Home layout: Hero + Rows (auto-rotating hero). | Premium OTT pattern; works cleanly with the Plan 5 "Featured/Continue Watching" modules we anticipate. |
| D7 | Hero auto-rotates every 6s while focused elsewhere; stops when user focuses the hero itself. | Common Roku pattern; deterministic timing; no module needed for v0.4. |
| D8 | Introduce `TemplateConfig()` emitter in Plan 4 (not deferred). | `feed_url` and `primary_color` must reach BrightScript runtime somehow; reusing the existing `ModuleConfig` emitter doesn't fit because this is template-level, not module-level. Emitter is ~80 LOC; acceptable to land now. |
| D9 | Use SceneGraph's built-in Video-node controls. No authored trick-play overlay. | The built-in overlay is what almost every real Roku channel ships with. Authoring custom overlays is Plan 5+ module territory. |
| D10 | Assets merged into the manifest via `set-if-unset` strategy; user or module can override. | Consistent with the existing manifest-merge contract (Plan 3 T5/T10). Preserves the "user has the final say" invariant. |
| D11 | Error-overlay detection in T27 uses a file-size heuristic (crash overlays are near-solid black; functional screens are 50-200 KB PNGs of rendered tiles). No OCR. | T27 is operator-reviewed anyway; a precise heuristic doesn't earn the tesseract dep. |
| D12 | No Roku sample-feed fallback / local HTTP fixture server. T27 uses the live URL. | User chose D4. Flakiness mitigation is fix-forward, not a local fixture server. |

## 4. Architecture

Plan 4 extends Plan 3's generator pipeline with two new horizontal layers — asset resolution and template-config emission — that slot between existing stages without changing their contracts.

```
AppSpec (existing + new branding/content fields)
        │
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ spec parse (existing)                                    │
  │   + new: branding.ts / content.ts Zod fragments          │
  │   + new: path-resolver (relative to spec file or CWD)    │
  └──────────────────────────────────────────────────────────┘
        │
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ asset pipeline (new: src/assets/)                        │
  │   - validates user-supplied high-res PNG                 │
  │   - generates HD/FHD/UHD buckets via sharp               │
  │   - returns assetBuckets + assetManifestEntries          │
  └──────────────────────────────────────────────────────────┘
        │
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ EJS render of template files (existing)                  │
  │   + new: TemplateConfig() emitter writes                 │
  │          source/_template/config.brs                     │
  └──────────────────────────────────────────────────────────┘
        │
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ merger (existing)                                        │
  │   + assetBuckets merged into project.files verbatim      │
  │   + assetManifestEntries feed into manifest merge        │
  │     at set-if-unset priority                             │
  └──────────────────────────────────────────────────────────┘
        │
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ compile + zip + sideload (existing, unchanged)           │
  └──────────────────────────────────────────────────────────┘
        │
        ▼
  emitted project tree + zip
        │
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ T27 verification (new, manual, real device)              │
  │   scripts/t27-video-grid.mjs                             │
  │   sideload → launch → nav → playback poll → tear down    │
  └──────────────────────────────────────────────────────────┘
```

### 4.1 New files and modules

| Location | Purpose |
|---|---|
| `packages/brs-gen/src/spec/branding.ts` | Zod fragment: `primary_color` (#RRGGBB), `icon` (path), `splash` (path) |
| `packages/brs-gen/src/spec/content.ts` | Zod fragment: `feed_url` (URL), `feed_format` (enum) |
| `packages/brs-gen/src/spec/app-spec.ts` | Existing wrapper extended with optional `branding` + `content` |
| `packages/brs-gen/src/assets/pipeline.ts` | `sharp`-based bucketing (HD/FHD/UHD). Roku size matrix hard-coded |
| `packages/brs-gen/src/assets/validate.ts` | PNG magic + min-dimensions check on source |
| `packages/brs-gen/src/assets/resolve.ts` | Path resolver: absolute / spec-origin-relative / CWD-relative |
| `packages/brs-gen/src/merger/emit-template-config.ts` | `TemplateConfig()` BrightScript emitter |
| `packages/brs-gen/src/merger/build.ts` | Extended: accepts `assetBuckets`, `assetManifestEntries`, `templateConfigBrs` |
| `packages/brs-gen/src/tools/generate-app.ts` | Modified: new asset-resolution stage between AppSpec parse and merger |
| `packages/brs-gen/templates/video_grid_channel/` | The template (template.toml, schema.ts, files/) |
| `packages/brs-gen/scripts/t27-video-grid.mjs` | Real-device verification driver |
| `packages/brs-gen/scripts/_t27-lib.mjs` | Shared T27 helpers (sideload, keypress, playback poll) for Plans 4a-4e reuse |
| `packages/brs-gen/scripts/fixtures/t27-{icon,splash}-uhd.png` | Operator-facing fixture assets for T27 |
| `packages/brs-gen/tests/__fixtures__/icon-uhd.png` | Unit-test fixture |
| `packages/brs-gen/tests/__fixtures__/splash-uhd.png` | Unit-test fixture |
| `packages/brs-gen/tests/__golden__/video-grid.zip` | Golden output for e2e byte-equality |
| `packages/brs-gen/tests/__golden__/video-grid.provenance.json` | Golden provenance |

### 4.2 Dependencies

- Add `sharp@^0.33.0` as a prod dep of `brs-gen`. Prebuilt native binaries via npm; no post-install compile on macOS arm64/x64, Linux x64/arm64.
- No other new dependencies. `pnpm-lock.yaml` updated via `pnpm install`.

### 4.3 Invariants preserved

- Same `AppSpec` + same catalog + same source asset = same bytes out. `sharp` with pinned kernel + compression options is deterministic; confirmed by a new T28-style test.
- No AppSpec breakage: `branding`, `content` are optional at the wrapper level. stub_hello continues to validate without them.
- stub_hello's goldens (`stub.zip`, `stub.provenance.json`) do not regenerate. Asset pipeline runs only when `branding` is present in the resolved spec.
- All 10 MCP tools keep their Plan 3 contracts. No handler signature changes, no new wire-format fields, no new failure codes (`ASSET_VALIDATION_FAILED` is reused with richer `details`).
- In-process bsc compile stays mandatory pre-zip. Post-compile XML `.bs` → `.brs` sweep (v0.3.1) still runs on the generated project.

## 5. AppSpec schema extensions

### 5.1 `branding` (new, optional at wrapper level)

```ts
// packages/brs-gen/src/spec/branding.ts
export const BrandingSchema = z.object({
  primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),  // #RRGGBB
  icon: z.string().min(1).optional(),                                // path to source PNG
  splash: z.string().min(1).optional(),                              // path to source PNG
}).strict();
```

Path resolution precedence for `icon` / `splash`:

1. Absolute → used as-is.
2. Relative + AppSpec loaded from a file path → resolved relative to that file's directory.
3. Relative + AppSpec passed inline (object or JSON string) → resolved relative to `process.cwd()`.

Source-resolution rule: `icon` source ≥ 336×218; `splash` source ≥ 1920×1080. Upscaling is explicitly refused with `ASSET_VALIDATION_FAILED` + `details.reason = 'source_too_small'`.

### 5.2 `content` (new, optional at wrapper level)

```ts
// packages/brs-gen/src/spec/content.ts
export const ContentSchema = z.object({
  feed_url: z.string().url(),
  feed_format: z.enum(['roku_direct_publisher_json']),
}).strict();
```

Only RDP JSON supported at v0.4. MRSS / sitemap-rss would extend the enum in a later plan.

### 5.3 Wrapper integration

```ts
// packages/brs-gen/src/spec/app-spec.ts (existing wrapper, extended)
export const AppSpecV2Wrapper = z.object({
  spec_version: z.literal(2),
  template: z.union([z.string(), TemplateRefSchema]),
  app: AppInfoSchema,
  branding: BrandingSchema.optional(),          // NEW
  content: ContentSchema.optional(),            // NEW
  modules: z.array(ModuleRefSchema),
}).passthrough();
```

Templates enforce required-ness via their own `schema.ts` (`.strict()`).

### 5.4 Template-strict schema for `video_grid_channel`

```ts
// templates/video_grid_channel/schema.ts
export const Schema = AppSpecV2Wrapper.extend({
  branding: BrandingSchema.required({ icon: true, splash: true, primary_color: true }),
  content: ContentSchema,
}).strict();
```

`get_template_schema('video_grid_channel')` surfaces these requirements via the existing `zodToJsonSchemaDraft7` path — no code change in that tool.

## 6. Asset pipeline

### 6.1 Bucket matrix (Roku-mandated)

Icons:

| Bucket | Width | Height | Manifest key |
|---|---|---|---|
| hd | 290 | 218 | `mm_icon_focus_hd` |
| fhd | 336 | 210 | `mm_icon_focus_fhd` |

Splashes:

| Bucket | Width | Height | Manifest key |
|---|---|---|---|
| hd | 1280 | 720 | `splash_screen_hd` |
| fhd | 1920 | 1080 | `splash_screen_fhd` |
| uhd | 3840 | 2160 | `splash_screen_uhd` |

Roku does not define a separate UHD icon bucket; FHD is the highest for icons.

### 6.2 `bucketAsset` (pure function)

```ts
export async function bucketAsset(
  source: Buffer,
  kind: 'icon' | 'splash',
  outputPrefix: string,            // e.g., 'images/icon'
): Promise<Map<string, Buffer>>;
```

Uses `sharp(...).resize(w, h, { fit: 'cover', kernel: 'lanczos3' }).png({ compressionLevel: 9, palette: false }).toBuffer()`. Pinned options = byte-deterministic across runs on a single machine. Cross-machine determinism confirmed by CI.

### 6.3 `validateAssetSource` (throws on violation)

```ts
export async function validateAssetSource(
  source: Buffer,
  rule: { min_width: number; min_height: number },
  context: { field: string; path?: string },
): Promise<{ width: number; height: number }>;
```

Throws `fail('ASSET_VALIDATION_FAILED', message, details)` on:
- Not a PNG (first 4 bytes not `89 50 4e 47`).
- Dimensions below rule → `details = { given: 'WxH', required: 'WxH', reason: 'source_too_small' }`.

### 6.4 `resolveAssetPath` (pure)

```ts
export function resolveAssetPath(
  assetPath: string,
  specOrigin: string | null,       // absolute path of the loaded spec file, or null
): string;
```

Implements §5.1's resolution precedence.

### 6.5 Determinism

- `sharp` with pinned options produces byte-identical output on repeat runs on the same machine.
- Cross-machine (macOS arm64 ↔ Linux x64) byte equality verified by a new `tests/determinism.test.ts` case. Sharp's bundled libvips is the same across these platforms.
- If CI ever catches drift (rare), pin `sharp` + `libvips` versions more tightly.

## 7. `video_grid_channel` template

### 7.1 Directory layout

```
templates/video_grid_channel/
├── template.toml
├── schema.ts                       (exports Schema + Example)
├── files/
│   ├── manifest.ejs
│   ├── source/
│   │   ├── Main.bs
│   │   ├── Feed.bs                 (RDP JSON → ContentNode tree)
│   │   └── HttpTask.bs             (Task subclass wrapping roUrlTransfer)
│   └── components/
│       ├── MainScene.xml           (Hero + RowList layout)
│       ├── MainScene.bs            (feed-load wiring, focus routing)
│       ├── HeroUnit.xml            (poster + title/synopsis)
│       ├── HeroUnit.bs             (6s auto-rotate timer, manual nav)
│       ├── DetailsScene.xml        (selected-tile details)
│       ├── DetailsScene.bs
│       ├── PlayerScene.xml         (Video node, default controls)
│       └── PlayerScene.bs          (state transitions, error surface)
```

### 7.2 `template.toml` sketch

```toml
[template]
id = "video_grid_channel"
version = "0.1.0"
spec_compat = ">=2"
description = "Hero + category rows + details + player. Consumes RDP JSON."

[template.manifest_defaults]
title           = "<%= spec.app.name %>"
major_version   = "<%= spec.app.major_version %>"
minor_version   = "<%= spec.app.minor_version %>"
build_version   = "<%= spec.app.build_version %>"
splash_color    = "<%= spec.branding.primary_color %>"
ui_resolutions  = "fhd,hd"
bs_const        = "DEBUG=0"
# mm_icon_focus_* and splash_screen_* are injected by the asset pipeline.

[template.exports]
init_hooks = [
  { scope = "MainScene",   phase = "before_content_load", file = "components/MainScene.bs",   signature = "(m as object) as void" },
  { scope = "MainScene",   phase = "after_content_load",  file = "components/MainScene.bs",   signature = "(m as object) as void" },
  { scope = "MainScene",   phase = "after_hero_load",     file = "components/MainScene.bs",   signature = "(m as object) as void" },
  { scope = "PlayerScene", phase = "before_play",         file = "components/PlayerScene.bs", signature = "(m as object) as void" },
  { scope = "Main",        phase = "before_scene_show",   file = "source/Main.bs",            signature = "(args as dynamic) as void" },
]
scene_nodes = [
  { name = "MainScene",    file = "components/MainScene.xml" },
  { name = "DetailsScene", file = "components/DetailsScene.xml" },
  { name = "PlayerScene",  file = "components/PlayerScene.xml" },
  { name = "HeroUnit",     file = "components/HeroUnit.xml" },
]
# No `supported_modules` allowlist at v0.4.0.
```

**Schema note:** The dotted TOML syntax above (`[template.exports]`, `[template.manifest_defaults]`) maps to the flat schema keys `template_exports` and `template_manifest_defaults` via the catalog loader's `flatten()` pass (`src/catalog/loader.ts:21-41`). The TOML source file uses the dotted form; the validated Zod shape uses underscores. This matches the `stub_hello/template.toml` convention.

**Template files enumeration:** Unlike `module.toml` (which declares `module_files.add`), templates do not declare a file list. The catalog loader and `generate_app` discover template files by walking `packages/brs-gen/templates/<id>/files/` recursively. The sketch above intentionally omits a `[template.files]` section — it would fail strict schema validation.

**Init-hook `scope` + `phase`:** Both are BrightScript identifiers (`/^[A-Za-z_][A-Za-z0-9_]*$/`). The merger's `__init_hooks.bs` emitter composes them into dispatch functions named `Modules_On<Scope><PhasePascal>` (Plan 3 T12). The slash-joined form mentioned in the PRD (e.g. `"MainScene.init/before_content_load"`) was prose shorthand; the actual wire form is the two-field `{scope, phase}` pair.

### 7.3 Runtime behavior

- **`Main.bs`**: creates Scene, shows `MainScene`, exits on close. Calls `Modules_OnMainBeforeSceneShow(args)` from the merger-emitted `__init_hooks.bs`.
- **`MainScene.bs`**: on init, reads `TemplateConfig().feed_url`, kicks off `HttpTask` for feed fetch. On feed loaded, hydrates a `ContentNode` tree with categories → items; binds to `RowList`; sets `HeroUnit.content` to the first item of the first category. Rotates hero every 6 seconds unless hero itself has focus.
- **`Feed.bs`**: permissive RDP JSON parser. Missing thumbnails or long descriptions are logged, not fatal.
- **`HttpTask.bs`**: `roSGNode("Task")` subclass wrapping `roUrlTransfer`. 1 retry on 5xx / TLS failures.
- **`DetailsScene.bs`**: shows selected item. "Play" pushes `PlayerScene`.
- **`PlayerScene.bs`**: wires `Video` node. Listens for `state` transitions. On `finished` pops back. On `error` shows a minimal overlay with the captured error code.

### 7.4 Namespace and collision discipline

- Template files live under `source/` and `components/` at the top level (template territory).
- Modules (future) live under `components/<module_id>/` or `source/_modules/<module_id>/` per Plan 3 merger rules — no collision with template files.
- `source/_template/config.brs` is template territory (new namespace); merger's `detectConflicts` refuses module contributions under `source/_template/`.

## 8. `generate_app` integration

### 8.1 Pipeline ordering (numbers keyed to Plan 3 T22 skeleton)

```
  1.  parse input                                      [existing]
  1a. NEW: capture specOrigin (absolute path if file-based, null if inline)
  2.  v1 → v2 promote                                  [existing]
  3.  preflight template                               [existing]
  4.  wrapper parse                                    [existing]
  4a. template-strict schema parse                     [existing]
  5.  module resolution                                [existing]
  6.  spec_compat check                                [existing]
  7.  per-module config validation                     [existing]

  ── NEW asset resolution pass ─────────────────────────────
  7a. resolveAssetPath(branding.icon, specOrigin)   → absolute fs path
  7b. readFile → source Buffer
  7c. validateAssetSource(source, ICON_SOURCE_MIN, ...)
  7d. bucketAsset(source, 'icon',   'images/icon')  → Map<path, Buffer>
  7e. bucketAsset(source, 'splash', 'images/splash')→ Map<path, Buffer>
  7f. manifestEntriesForBuckets('icon', ...)        → Record<manifest_key, pkg:/path>
  7g. manifestEntriesForBuckets('splash', ...)      → Record<manifest_key, pkg:/path>
  ──────────────────────────────────────────────────────────

  8.  load template/module file bytes                  [existing]
  9.  EJS render template files                        [existing]
  9a. NEW: emit source/_template/config.brs via TemplateConfig emitter
  10. buildEmittedProject                              [existing, inputs extended]
  11. writeProject                                     [existing]
  12. compileProject (mandatory)                       [existing]
  13. optional zip                                     [existing]
  14. optional sideload                                [existing]
  15. result envelope                                  [existing]
```

### 8.2 `buildEmittedProject` signature extensions

```ts
export interface BuildInput {
  spec: AppSpec;
  template: TemplateEntry;
  modules: ModuleToml[];
  renderedTemplateFiles: Array<{ path: string; content: string | Buffer }>;
  moduleFileBytes: ReadonlyMap<string, Buffer>;
  brsGenVersion: string;
  assetBuckets?: ReadonlyMap<string, Buffer>;                    // NEW
  assetManifestEntries?: Readonly<Record<string, string>>;       // NEW
  templateConfigBrs?: string;                                    // NEW
}
```

- `assetBuckets` entries are added directly to `project.files` as `{path, content: Buffer}` items, sort-preserved.
- `assetManifestEntries` feed into the manifest merge as a synthetic layer prioritized AFTER `template.manifest_defaults` and BEFORE explicit user/module keys. Strategy: `set-if-unset`. User or module overrides win.
- `templateConfigBrs` when present adds `source/_template/config.brs` to `project.files`.

### 8.3 `TemplateConfig()` emitter

New: `src/merger/emit-template-config.ts`. Takes the validated AppSpec + the template's expected fields, emits:

```brs
' AUTO-GENERATED by brs-gen; DO NOT EDIT.
' Template-level config derived from AppSpec.
function TemplateConfig() as Object
  return {
    channel_name:   "Acme TV",
    feed_format:    "roku_direct_publisher_json",
    feed_url:       "https://devresources.s3.amazonaws.com/feeds/sample.json",
    primary_color:  "#E50914",
  }
end function
```

Keys sorted deterministically. String escapes via the shared `escapeBsString` helper from `src/util/deterministic.ts`; control chars throw `APP_SPEC_INVALID`.

## 9. T27 verification gate

Manual, real-device verification. Operator-run before tagging.

### 9.1 Prerequisites

- A Roku in developer mode on the operator's LAN.
- Env: `ROKUDEV_HOST` (IP), `ROKUDEV_DEV_PASSWORD` (defaults to `1234`).
- `dist/` built via `pnpm -C packages/brs-gen build`.
- Sample feed URL reachable from the Roku.

### 9.2 Flow (`scripts/t27-video-grid.mjs`)

1. Read env.
2. Generate a `video_grid_channel` project with the canonical T27 spec (fixture icon + splash under `scripts/fixtures/`, configured primary_color, feed_url = the pinned Roku sample URL).
3. Sideload via `@rokudev/device-client` `DevPortal.sideload(zipPath)` after tearing down any existing dev channel.
4. ECP `POST /launch/dev?bs_debug_protocol=0`.
5. Poll `/query/active-app` until app id = `dev` (timeout 30s). Sleep 5s for feed fetch + hero hydration. Screenshot via `/plugin_inspect`. Assert no error overlay (file-size heuristic per D11).
6. ECP `POST /keypress/Down` then `/keypress/Right ×2` to reach the second tile of the first row. Screenshot; assert no error overlay.
7. ECP `POST /keypress/Select` (enter details). Screenshot; assert no error overlay.
8. ECP `POST /keypress/Select` (start playback). Poll `/query/media-player` until `state == 'play'` (timeout 20s). Sleep 10s. Re-poll; assert `state == 'play'` and `position` monotonically increased. Capture screenshots at t=2s/5s/10s.
9. ECP `POST /keypress/Home`. Tail BrightScript debug log (port 8085) for last 30s; stream to `scripts/t27-logs/<ISO>.log`.
10. Tear down dev channel. Clean up tmpdir.
11. Print summary to stdout: pass/fail counts, screenshot paths, log path, observed media-player state transitions.

### 9.3 PASS criteria

All mandatory asserts hold:
- Sideload returned 2xx.
- `/query/active-app` reports the dev channel launched.
- Each screenshot heuristic passed.
- `/query/media-player` state reached `'play'` and held for 10s with `position` increasing.
- Log tail contains no `SCRIPT ERROR` or `Runtime error` patterns.

### 9.4 Failure behavior

On any failed assert:
- Capture 60s of tail log.
- Screenshot current state.
- Print observed-vs-expected.
- Exit non-zero.

No self-healing or silent retry. Failure is a signal to investigate.

### 9.5 Shared helpers (for Plan 4a-4e reuse)

Extracted to `scripts/_t27-lib.mjs`:
- `sideloadAndLaunch(zipPath, host, password)`
- `screenshotNoError(host, password)` — returns `true` if file size > 15 KB.
- `navigateAndAssertScene(host, keySequence)`
- `assertPlaybackStarts(host, timeoutMs)`

Plan 4a-4e write ~50-line driver on top of these; no re-implementation.

### 9.6 What gets committed

- `scripts/t27-video-grid.mjs` and `scripts/_t27-lib.mjs`.
- `scripts/fixtures/t27-{icon,splash}-uhd.png`. Deterministic, "clearly test channel" look.
- A T27 verification log entry appended to this design doc (§Appendix A) with the operator's PASS evidence before tagging v0.4.0.

### 9.7 Not in T27 for Plan 4

- No deep-link test (ECP `/input?contentId=...`) — Plan 5 `deep_link.global`.
- No trick-play test — the built-in Video-node overlay handles it; separate coverage not worth the flake surface.
- No accessibility audit — Plan 5 `accessibility.captions` module territory.
- No Channel Store certification checks — `roku-channel-store-precheck` skill territory (later plan).

## 10. Testing strategy

All CI-runnable tests are deterministic and require no external services. T27 (§9) is the sole manual gate.

### 10.1 New unit tests (co-located)

| Module | Scope | Approx count |
|---|---|---|
| `src/assets/pipeline.test.ts` | Bucket keys, dimensions, in-process determinism | 5 |
| `src/assets/validate.test.ts` | Valid PNG, not-a-PNG, too-small, field context | 4 |
| `src/assets/resolve.test.ts` | Absolute, relative+specOrigin, relative+null | 3 |
| `src/spec/branding.test.ts` | Hex color validation pass/fail | 3 |
| `src/spec/content.test.ts` | URL validation, enum acceptance/rejection | 3 |
| `src/merger/emit-template-config.test.ts` | Flatten, escape, sort, control-char reject | 5 |
| Subtotal unit | | ~23 |

### 10.2 Modified tool-level tests

- `src/tools/generate-app.test.ts`: T22's 13 stay green. Adds 5 scenarios (happy path with video_grid_channel, relative-path resolution both branches, two `ASSET_VALIDATION_FAILED` paths) → ~18.
- `src/tools/validate-assets.test.ts`: T25's 8 stay green. Adds 2 for source-too-small detection → 10.
- `src/tools/get-template-schema.test.ts`: T20's stay green. Adds 1 scenario asserting video_grid_channel's surfaced requirements → +1.

### 10.3 Cross-cutting tests (`packages/brs-gen/tests/`)

- `tests/determinism.test.ts`: T28's 4 stay green. Adds 1 case: run the full pipeline-through-generate_app twice on the same fixture PNG; assert emitted PNG buffers and the zip are byte-equal. Covers cross-platform determinism of the sharp pipeline via CI running on both macOS and Linux.
- `tests/snapshots.test.ts`: T29's 5 stay green. Adds 5 new snapshots under `tests/__snapshots__/video-grid/`: manifest, MainScene.xml, HeroUnit.xml, template-config.bs, files listing.
- `tests/conflict-matrix.test.ts`: T30's harness adds video_grid_channel to template iteration. With 1 module (stub_label) and 2 templates, 2-subsets stays empty; test runs trivially. Lights up when Plan 5 modules land.
- `tests/e2e.test.ts`: T31's 5 stay green. Adds 3: `generate_app` on canonical video_grid_channel produces byte-equal `tests/__golden__/video-grid.zip`, `validate_manifest` returns ok:true, provenance byte-equal against `tests/__golden__/video-grid.provenance.json`. **Lint assertion is strict (no soft-assert).** If the template has bsc warnings at authoring time, they're fixed before the plan is done.

### 10.4 Test-count delta

| Layer | v0.3.1 | Plan 4 target | Delta |
|---|---|---|---|
| brs-gen unit (co-located `.test.ts` under `src/`) | 192 | ~223 | +~31 (§10.1 ~23 new modules + §10.2 +8 tool-level additions) |
| brs-gen integration/snapshot | 5 | 10 | +5 |
| brs-gen e2e | 5 | 8 | +3 |
| brs-gen determinism | 4 | 5 | +1 |
| brs-gen conflict-matrix | 1 | 1 | 0 |
| brs-gen total | 195 | ~235 | ~+40 |
| @rokudev/device-client | 294 | 294 | 0 |
| rokudev-device | 184 | 184 | 0 |
| **Monorepo** | **672** | **~712** | **~+40** |

### 10.5 Fixtures and goldens

- `packages/brs-gen/tests/__fixtures__/icon-uhd.png` — 336×218 or larger; 2-5 KB. Deterministic hand-authored via extended `scripts/gen-stub-pngs.mjs`. (336×218 matches §5.1's `ICON_SOURCE_MIN` — min-of-all-bucket-dimensions so every bucket downscales cleanly without upscale.)
- `packages/brs-gen/tests/__fixtures__/splash-uhd.png` — 3840×2160 at minimal color depth; ~30-60 KB.
- `packages/brs-gen/tests/__golden__/video-grid.zip` + `video-grid.provenance.json`. In `.prettierignore` like stub goldens.

### 10.6 Golden regen path

Extended `scripts/regen-golden.mjs` regenerates both `stub.*` (unchanged behavior) and `video-grid.*` (new). Operator invocation unchanged: `TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs`.

## 11. Release scope

### 11.1 Version bumps

- Root `package.json`: `0.3.1` → `0.4.0`.
- `packages/brs-gen/package.json`: `0.3.1` → `0.4.0`.
- `packages/roku-device-client/package.json`: unchanged (`0.2.1`).
- `packages/rokudev-device/package.json`: unchanged (`0.2.0`).

### 11.2 README

- New section `## What's in v0.4 (Plan 4)` after v0.3.
- Bullets: first real template `video_grid_channel`; new AppSpec fields `branding` + `content`; sharp-based asset pipeline; `TemplateConfig()` emitter; T27 gate established for future real templates.
- T27 PASS evidence (Roku model, firmware, timestamp) linked from the spec doc's Appendix A.
- No "known follow-ups" bullets — everything Plan 4 sets out to do gets done. Remaining gaps are scope for Plans 4a-4e / 5 / 6 / 7.

### 11.3 Release prep

- `pnpm run release-prep` must pass clean.
- Prettier pass on any new files; committed separately if drift surfaces (same pattern as v0.3.0).
- Annotated tag `v0.4.0`.
- `gh release create v0.4.0` with notes matching v0.3.0/v0.3.1 format.

### 11.4 Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| `sharp` prebuilt binary unavailable on a CI platform we care about | Low | Pin a known-good version for macOS arm64 (dev) + Linux x64 (CI). Escape hatch: swap to pure-JS resize if ever needed (quality degrades; feature still ships). |
| Sharp cross-platform byte drift | Low | Determinism test runs on both macOS and Linux in CI. If drift surfaces, pin sharp + libvips more tightly, or accept a platform-tagged golden matrix. |
| Roku sample feed URL drift (404s) | Medium (historical pattern) | Live-URL dependence is accepted per D4/D12. Fix-forward: update the pinned URL when drift is observed. T27 logs make the failure explicit. |
| Hero auto-rotation interacting badly with module-injected rows (Plan 5) | Unknown until modules land | Plan 5 will add regression tests for this. v0.4.0 doesn't test it because no modules exist. |
| `MainScene.init/after_hero_load` hook is defined but no module consumes it yet | None at v0.4.0 | Exporting unused init hooks is cheap; hooks without calls are no-ops. |
| video_grid_channel.zip golden exceeds reasonable repo size (~200 KB) | Low | Fixture PNGs are minimal color depth. Expected total < 200 KB. Prettierignore applied. |

## 12. Acceptance criteria for v0.4.0

Plan 4 is done when all of the following hold:

1. `AppSpecV2Wrapper` accepts `branding` and `content` as optional fields. stub_hello continues to validate without them.
2. `templates/video_grid_channel/` ships with `template.toml`, `schema.ts`, and all 12 `files/` entries. `get_template_schema('video_grid_channel')` surfaces the required branding + content fields via JSON Schema.
3. `generate_app` with a complete video_grid_channel AppSpec produces a project tree containing: `manifest` with all Roku-required image refs; `images/icon_{hd,fhd}.png` + `images/splash_{hd,fhd,uhd}.png` at spec dimensions; `source/_template/config.brs` containing the configured fields; `source/Main.brs`, `source/Feed.brs`, `source/HttpTask.brs`, all `components/*.brs` and `components/*.xml`.
4. Post-compile sweep converts all `.bs` to `.brs` and rewrites XML `uri` refs correctly.
5. Integrated bsc compile passes with zero error-severity diagnostics.
6. Full test suite passes at ~712 tests across the monorepo (point estimate; acceptable ±8 variance for parameterized tests per §10.4). `pnpm run release-prep` clean.
7. T27 verification PASS recorded in §Appendix A of this spec (Roku model, firmware, timestamp, screenshots, log path).
8. v0.4.0 tag annotated, pushed. GitHub release page published with the same style as v0.3.0.
9. Memory file (`~/.claude/projects/-.../memory/MEMORY.md`) updated: Plan 4 COMPLETE, v0.4.0 tag, new test count, template-level design notes.

## Appendix A: T27 verification log

*To be filled by the operator during Plan 4 task T\<last\>. Mirrors Plan 2's §6 verification log format.*

```
Date:             <YYYY-MM-DD HH:MM TZ>
Roku model:       <model string from /query/device-info>
Firmware:         <firmware version + build>
brs-gen version:  0.4.0
T27 script:       scripts/t27-video-grid.mjs
Sample feed URL:  <actual URL used>

Assertions:
  [ ] Sideload 2xx
  [ ] /query/active-app = dev
  [ ] Home screen screenshot > 15 KB (no error overlay)
  [ ] First row navigable (Down → Right × 2)
  [ ] DetailsScene entered via Select
  [ ] /query/media-player state=play reached within 20s
  [ ] Position monotonically increased over 10s
  [ ] No SCRIPT ERROR / Runtime error in 8085 tail
  [ ] Home keypress returned cleanly

Screenshots captured: scripts/t27-screenshots/<ISO>/
Log tail:             scripts/t27-logs/<ISO>.log

PASS / FAIL:  <...>
Notes:        <any operator observations>
```
