# Plan 4a: `blank_scenegraph` template design

> Status: draft for spec review, 2026-05-11.
> Parent spec: `docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md` (PRD).
> Related plans: Plan 3 (brs-gen engine), Plan 4 (video_grid_channel template).

## 1. Goal

Ship the second base template in the v1 catalog: `blank_scenegraph`, a minimal module-friendly starter channel. Also extend the brs-gen engine with a reusable **template-branding-defaults** mechanism so future base templates (Plan 4b-4e) can declare per-template fallback assets without re-doing engine work.

Plan 4a is net-new; it does not build on or propagate any outstanding `video_grid_channel` polish items (see memory's "reference-app polish insistence rule").

## 2. Locked decisions (from brainstorming)

| Decision | Value | Source |
|---|---|---|
| Template id | `blank_scenegraph` | PRD §v1 catalog |
| Philosophy | Module-friendly minimum | Q2 |
| Module allowlist | Open (no restriction) | Q3 |
| Branding policy | Optional, template-shipped defaults | Q4 |
| Engine approach | B — reusable branding-defaults infra | Q5 |
| Default PNG strategy | Synthesized from `primary_color` at generate time | Q5a |

## 3. Non-goals

- Not a content-driven channel. No feed fetch, no RowList, no HeroUnit, no PlayerScene.
- Not an LLM freeform entry point yet. Plan 6 layers the freeform driver on top of blank; Plan 4a just ships the deterministic path.
- Not a replacement for `video_grid_channel`. Blank is the "empty canvas" base; video_grid is the "production reference" base.
- No cross-arch libvips determinism investigation. v1 asserts byte-determinism on the dev machine's platform; cross-arch variance (if it surfaces on CI later) is a fix-forward follow-up.
- No static-PNG fallback path exercised in v1. The engine's `template.branding_defaults.icon` / `.splash` fields are schema-declared for future use; blank uses only the synthesized path.

## 4. Architecture

The template is the smallest channel that is Channel-Store shape-valid: manifest with required keys, icon bucket (HD + FHD), splash bucket (HD + FHD + UHD), a single `MainScene` extending `Scene` with a no-op `init()`, and exactly one module-visible init hook (`MainScene.init/after_scene_show`).

The engine change is narrow: a new branding-defaults resolver that consults `template.branding_defaults` when the AppSpec omits `branding.icon` / `branding.splash`. The resolver either loads a template-declared source PNG path, or synthesizes a solid-color PNG from the resolved `primary_color`. After that, the existing asset pipeline (`src/assets/pipeline.ts`) handles everything identically to Plan 4 — same sharp params, same bucket mapping, same manifest entries.

```
AppSpec ──► branding resolver (NEW) ──► existing pipeline ──► manifest + assets
  │            │
  │            ├── spec.branding.icon   (operator, wins) ──┐
  │            ├── template_default icon path (static)    ├──► loaded/synthesized PNG
  │            └── synthesize(primary_color)              ─┘
  │
  └──► merger (unchanged) ──► init-hooks emitter (unchanged) ──► zip
```

Nothing else in brs-gen changes: merger, manifest merge strategies, init-hook dispatcher, EJS escape override, compile sweep, deterministic zip builder, provenance format.

## 5. Template files

```
packages/brs-gen/templates/blank_scenegraph/
├── template.toml           # metadata + exports + branding_defaults
├── schema.ts               # per-template Zod schema + Example
└── files/
    ├── manifest.ejs        # required keys only, no bs_const, no splash_min_time
    ├── source/
    │   └── Main.bs         # Main() sub: screen := CreateObject("roSGScreen"), scene = CreateScene("MainScene")
    └── components/
        ├── MainScene.xml   # extends Scene; children: one focusable empty Group; scripts include __init_hooks.bs + _template/config.bs
        └── MainScene.bs    # init() calls Modules_OnMainSceneAfterSceneShow(m)
```

### 5.1 `template.toml`

Engine convention (see `packages/brs-gen/src/catalog/loader.ts` `flatten()`): smol-toml parses `[template.<child>]` into nested `template.<child>`, then the loader hoists sub-tables to flat sibling keys (`template_<child>`). The Zod schema sees flat keys.

TOML shape authored by template authors:

```toml
[template]
id = "blank_scenegraph"
version = "0.1.0"
spec_compat = ">=2"
description = "Minimal module-friendly starter channel. Scene + MainScene + one init hook; no content, no UI beyond a focus-capable Group."

[template.manifest_defaults]
# Values are EJS templates rendered against the AppSpec.
# The merger emits the final manifest from this map + asset pipeline entries.
title          = "<%= spec.app.name %>"
major_version  = "<%= spec.app.major_version %>"
minor_version  = "<%= spec.app.minor_version %>"
build_version  = "<%= spec.app.build_version %>"
splash_color   = "#000000"
ui_resolutions = "hd,fhd"

[template.exports]
init_hooks = [
  { scope = "MainScene", phase = "after_scene_show", file = "components/MainScene.bs", signature = "(m as object) as void" },
]
scene_nodes = [
  { name = "MainScene", file = "components/MainScene.xml" },
]

[template.branding_defaults]
primary_color = "#000000"
# icon and splash are absent → engine synthesizes from primary_color.
```

After `flatten()`, the Zod schema sees top-level keys: `template`, `template_manifest_defaults`, `template_exports`, `template_branding_defaults`. The engine invariant (`template.id` matches the directory name) is enforced by the loader per pre-existing convention.

### 5.2 `schema.ts`

```ts
import { z } from 'zod';
import { AppSpecBase } from '../../src/spec/app-spec.js';
import { BrandingSchema } from '../../src/spec/branding.js';

// Blank explicitly FORBIDS the content block (AppSpecBase declares content as
// optional, so .strict() alone is insufficient — we must override with
// z.never().optional() to allow "key absent" / "key: undefined" but reject
// any actual value).
export const Schema = AppSpecBase.extend({
  template: z.literal('blank_scenegraph'),
  branding: BrandingSchema.partial().optional(),
  content: z.never().optional(),
}).strict();

export const Example = {
  spec_version: 2,
  template: 'blank_scenegraph',
  modules: [],
  app: { name: 'Blank Channel', major_version: 0, minor_version: 1, build_version: 0 },
};
```

The `Example` intentionally has no `branding` block — proves the zero-input path works end-to-end. `content` absence is the canonical case; the `z.never().optional()` override above additionally rejects attempts to pass `content: {...}` with a clear error.

### 5.3 `files/manifest.ejs`

Per video_grid_channel's pattern (and engine convention), the actual manifest is NOT emitted from an authored `manifest.ejs` — it is synthesized by the merger from `template_manifest_defaults` + asset pipeline entries + module contributions. The `files/manifest.ejs` file exists only as a placeholder because git does not track empty directories. Blank ships the same placeholder:

```
<%# This file is present only because git does not track empty directories.
    The actual manifest is emitted by the merger from template_manifest_defaults
    + asset entries + module contributions. This file is not read.
-%>
placeholder
```

The asset pipeline's `manifestEntriesForBuckets` contributes `mm_icon_focus_*` and `splash_screen_*` keys when icon / splash are resolved; absent keys are omitted from the final manifest.

### 5.4 `components/MainScene.xml`

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MainScene" extends="Scene">
  <script type="text/brightscript" uri="MainScene.bs" />
  <script type="text/brightscript" uri="pkg:/source/_template/config.bs" />
  <script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />
  <children>
    <Group id="rootGroup" />
  </children>
</component>
```

The `Group id="rootGroup"` gives modules a stable mount point to find via `m.top.findNode("rootGroup")` and `createChild` under. Template itself never touches it.

### 5.5 `components/MainScene.bs`

```brs
sub init()
  Modules_OnMainSceneAfterSceneShow(m)
end sub
```

One line. Every other behavior is module-contributed.

### 5.6 `source/Main.bs`

```brs
sub Main()
  screen = CreateObject("roSGScreen")
  m.port = CreateObject("roMessagePort")
  screen.setMessagePort(m.port)
  ' CreateScene attaches the MainScene as the screen's root and returns a
  ' handle; we don't need the handle post-attach, but creation is the side
  ' effect that matters. The intentionally-unused `scene` binding makes the
  ' idiom obvious to readers.
  scene = screen.CreateScene("MainScene")
  screen.show()
  while true
    msg = wait(0, m.port)
    if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
  end while
end sub
```

Standard SceneGraph bootstrap. No branching, no module-contributable surface.

## 6. Engine changes

### 6.1 `src/catalog/template-toml.ts`

Extend `TemplateTomlSchema` at the **top level** (post-flatten), alongside the existing sibling keys `template_exports`, `template_manifest_defaults`, `template_supported_modules`, `template_suppressed_warnings`:

```ts
template_branding_defaults: z
  .object({
    icon: z.string().optional(),
    splash: z.string().optional(),
    primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  })
  .strict()
  .optional(),
```

Validation rules at parse time:
- If `branding_defaults.icon` is declared, the path (relative to template dir) must exist when the template is loaded.
- Same for `branding_defaults.splash`.
- If `branding_defaults` is declared with no sub-keys, error: `TEMPLATE_TOML_INVALID { reason: "branding_defaults declared but empty" }`.

Since no v1 template ships a static `branding_defaults.icon` / `.splash` path, the existence-check's happy path is exercised via a **test fixture template** under `packages/brs-gen/tests/fixtures/template-with-static-branding-default/` (containing a minimal `template.toml` declaring a real path + a 336×218 PNG file at that path). The schema-rejection path (declared path missing, etc.) uses in-memory TOML strings per existing catalog test conventions.

### 6.2 `src/assets/synthesize.ts` (new)

```ts
import sharp from 'sharp';

/**
 * Synthesize a solid-color source PNG at the given dimensions.
 *
 * Deterministic contract:
 * - Given the exact pinned sharp version (patch-level match, see pin in
 *   packages/brs-gen/package.json) + identical {width, height, color},
 *   output bytes are byte-equal on the same OS/arch.
 * - Determinism across OS/arch is NOT guaranteed; it is asserted by the §9.1
 *   gate test which runs on the pinned dev-machine platform only. If libvips
 *   variance ever breaks this, we switch to static PNGs per-template.
 *
 * Pinned params (DO NOT CHANGE without regenerating goldens):
 *   create: { width, height, channels: 4, background: hexToRgba(color) }
 *   png:    { compressionLevel: 9, palette: false, adaptiveFiltering: false }
 */
export async function synthesizeSolidPng(
  color: string,
  width: number,
  height: number,
): Promise<Buffer> { ... }
```

Error codes:
- `ASSET_INVALID_COLOR` — color string doesn't match `/^#[0-9A-Fa-f]{6}$/`.
- `ASSET_SYNTHESIS_FAILED` — sharp throws unexpectedly.

**sharp/libvips pin (load-bearing for determinism):** the exact pin lives at `packages/brs-gen/package.json` (currently `"sharp": "0.34.5"`). The byte-equality gate test in §9.1 asserts `sharp.versions.sharp === '0.34.5'` before comparing sha256 — prevents silent drift if a future dev bumps the sharp version without regenerating the pinned sha256.

### 6.3 `src/assets/resolve.ts`

Extend with:

```ts
/**
 * Precedence: operator > template static > synthesized.
 * Returns absolute path to the resolved source PNG, or undefined if the
 * template has neither static path nor primary_color (caller omits the
 * manifest key).
 */
export async function resolveAssetWithTemplateDefault(
  specAssetPath: string | undefined,
  specOrigin: string,           // spec file directory
  templateDefaultPath: string | undefined,
  templateRoot: string,
  effectivePrimaryColor: string | undefined,
  assetKind: 'icon' | 'splash',
  scratchDir: string,           // where to write synthesized PNGs
): Promise<string | undefined>;
```

### 6.4 `src/tools/generate-app.ts`

Replace the direct asset resolution calls with the new `resolveAssetWithTemplateDefault`. Compute `effectivePrimaryColor` as:

```
spec.branding?.primary_color
  ?? template.branding_defaults?.primary_color
  ?? "#000000"
```

The synthesized PNG is written to a per-generation scratch directory at `<outputDir>-synth-<random>/` (parallel in style to `writeProject`'s existing `<outputDir>-tmp-<random>/`). The scratch dir is `fs.rm(..., { recursive: true })`'d in a `finally` block at the end of `generate_app`. It is NEVER placed inside `outputDir` — the scratch dir and the output dir are siblings so the atomic rename of the project tree doesn't race with synthesis cleanup.

### 6.5 `src/merger/conflicts.ts`

Add `assets/` to the template-territory fence (mirrors `source/_template/`). Modules cannot contribute under `assets/`. Violation raises `MODULE_TEMPLATE_TERRITORY_VIOLATION { module, path }` (same error code the existing `source/_template/` fence uses; re-used rather than coining a new one).

## 7. Data flow — asset resolution (authoritative)

```
for assetKind in {icon, splash}:
  if spec.branding?[assetKind] is set:
    return validated+resized operator asset
  elif template.branding_defaults?[assetKind] is set (static path):
    return validated+resized template asset
  elif template.branding_defaults?.primary_color is set OR spec.branding?.primary_color is set:
    effectivePrimaryColor = spec... ?? template... ?? "#000000"
    return validated+resized synthesized asset
  else:
    return undefined  # manifest key omitted
```

## 8. Error handling

| Error code | When | Data |
|---|---|---|
| `ASSET_INVALID_COLOR` | Invalid hex in primary_color | `{ color }` |
| `ASSET_SYNTHESIS_FAILED` | sharp throws during synthesis | `{ cause }` |
| `ASSET_TEMPLATE_DEFAULT_NOT_FOUND` | `template.branding_defaults.icon` path does not resolve | `{ template, path }` |
| `TEMPLATE_TOML_INVALID` | Existing code; now also fires when `branding_defaults` declared but empty | `{ reason }` |

Pre-existing `ASSET_*` codes from Plan 4 (`ASSET_NOT_FOUND`, `ASSET_TOO_SMALL`, `ASSET_WRONG_FORMAT`) apply unchanged to both operator and template-static paths.

## 9. Testing strategy

### 9.1 Unit tests (brs-gen)

- `src/assets/synthesize.test.ts` (new)
  - Asserts `sharp.versions.sharp === '0.34.5'` as precondition, then known color + dimensions → exact sha256 (libvips drift gate).
  - **Scope pinned: dev-machine platform only, gated via an env check.** The sha256 assertion runs only when `process.arch === 'arm64' && process.platform === 'darwin'` (the current dev-machine shape). Other platforms skip just the sha256 branch with `test.skip` and a warning log; the dimensions + invalid-color subtests still run everywhere. Rationale: we don't have CI yet; when CI lands (Plan 7+) it either uses a matching macOS arm64 runner or we revisit the gate. This avoids the ambiguity of "gate test may fail on CI" — it explicitly will not run outside the pinned platform, making the test stable and the platform coupling explicit.
  - Dimensions match ICON_SOURCE_MIN / SPLASH_SOURCE_MIN (runs on all platforms).
  - Invalid color throws `ASSET_INVALID_COLOR` (runs on all platforms).
- `src/assets/resolve.test.ts` (extend)
  - Precedence: operator > template static > synthesized
  - effectivePrimaryColor precedence: spec > template_default > "#000000"
- `src/catalog/template-toml.test.ts` (extend)
  - Accepts `branding_defaults` with all three sub-keys
  - Rejects empty `branding_defaults` block
  - Rejects invalid hex in `branding_defaults.primary_color`
- `src/tools/generate-app.test.ts` (extend)
  - Generating blank from zero-branding spec produces manifest with synthesized icon + splash entries

### 9.2 Snapshot tests

- `tests/__snapshots__/blank_scenegraph/manifest.snap.txt`
- `tests/__snapshots__/blank_scenegraph/MainScene.xml.snap.txt`
- `tests/__snapshots__/blank_scenegraph/MainScene.brs.snap.txt` (post-compile)

### 9.3 Golden e2e test

`tests/e2e.test.ts` gains a `blank_scenegraph` describe block with:
- `tests/__golden__/blank.zip`
- `tests/__golden__/blank.provenance.json`

Regenerated via `TZ=UTC node scripts/regen-golden.mjs` (already the Plan 3+ workflow).

### 9.4 Conflict matrix

`tests/conflict-matrix.test.ts` adds:
- `{ template: 'blank_scenegraph', modules: [] }` → must merge, compile, zip.
- `{ template: 'blank_scenegraph', modules: ['stub_label'] }` → must merge, compile, zip; emitted project contains `source/_modules/stub_label/` and `__init_hooks.bs` dispatches to it.

### 9.5 Determinism

`tests/determinism.test.ts` adds a blank_scenegraph full-pipeline byte-equality test across two in-process runs, executed under **`TZ=UTC`** (mandatory — the zip builder's DOS mtime encoding is local-time per memory's known-trap entry; cross-timezone byte equality requires UTC). Catches synthesis determinism regressions on the dev machine. This test runs alongside the Plan 4 `video_grid_channel` determinism test; both go green or both go red.

## 10. T27 real-device verification

`scripts/t27-blank.mjs` (operator-run):

**Phase A: zero-branding spec**
1. `generate_app` — spec has only `app` + `template` fields
2. Sideload + launch
3. `/query/active-app` reports `dev`
4. Screenshot — assert no error overlay + pixel-variance below 15KB threshold (blank channel is mostly black)
5. Press Home — active-app no longer `dev`

**Phase B: module composition spec**
6. `generate_app` — spec adds `modules: [{ id: 'stub_label', config: {...} }]`
7. Sideload + launch
8. Screenshot — assert stub_label's visible marker is rendered at the expected location (proves `Modules_OnMainSceneAfterSceneShow` dispatcher works on-device)
9. Press Home

Total: ~8 steps, ~20 seconds on-device. No rows, no Details, no playback.

## 11. Scope cut (explicit non-ships)

- Static-PNG path in `template.branding_defaults.icon` / `.splash` is schema-declared but unexercised in v1. Blank uses only the synthesized path. First consumer of static path ships in Plan 4b+.
- Cross-arch libvips determinism — single-platform gate only. Follow-up if CI surfaces variance.
- Documentation/README emit at generate time. (Deferred to Plan 6 freeform work.)
- `app.author`, `app.description`, `app.channel_store_*` manifest keys. Minimum required keys only.
- Template-level i18n/locale. Deferred to v1.x per PRD.

## 12. Release plan

- Monorepo bump: `v0.4.3` → `v0.5.0` (minor — new engine surface area in template-toml).
- Package bumps: `brs-gen` 0.4.3 → 0.5.0; `@rokudev/device-client` unchanged.
- Goldens regenerated under `TZ=UTC`.
- Tag + gh release with release notes covering the engine change, new template, T27 evidence.
- Update `MEMORY.md`'s Plan 4a status block + note the new `template.branding_defaults` engine surface as load-bearing for Plan 4b-4e.

## 13. Verification gate (must pass before ship)

1. `pnpm -C packages/brs-gen test` — all green. Target count: approximately **270-280 tests** (252 baseline from v0.4.3 + ~4 synthesis tests + ~3 resolve additions + ~3 template-toml additions + ~2 generate-app additions + 3 snapshot tests + 3 e2e additions + 2 conflict-matrix entries + 1 determinism entry). Actual count finalized during plan decomposition.
2. `TZ=UTC node scripts/regen-golden.mjs` followed by `pnpm -C packages/brs-gen test` — still green (determinism).
3. `t27-blank.mjs` Phase A: zero-branding spec PASS on operator's Roku.
4. `t27-blank.mjs` Phase B: module composition PASS.
5. `video_grid_channel` existing T27 driver still PASS (no regression from engine change).
6. Secret-leak invariant: `JSON.stringify(synthesisResult)` contains no dev_password / signing_password (no new code paths that would).

## 14. Open questions / to-resolve-in-plan

- **RESOLVED** (inline): scratch dir is `<outputDir>-synth-<random>/`, parallel to `<outputDir>-tmp-<random>/`, cleaned in a `finally` block — see §6.4.
- **RESOLVED** (inline): Example spec stays bare (no `branding` block) — proves zero-input path works end-to-end, which is the load-bearing invariant blank_scenegraph is ultimately selling. Operator docs (Plan 6 skill) can later demonstrate the branding-override path separately.

No outstanding open questions. Plan decomposition may proceed.

---

**Appendix A:** PRD cross-references

- §3.2.1 (base template definition) — blank fits the shape.
- §3.2.6.1 (template.toml format) — extended with `branding_defaults` block.
- §10.5 (asset constraints) — blank ships synthesized PNGs meeting ICON_SOURCE_MIN + SPLASH_SOURCE_MIN.
- §8.3 (combinatorial merger test) — blank adds 2 entries to the matrix.

**Appendix B:** memory-side lessons carried in

- `findNode` is id-only — we already chose `id="rootGroup"` explicitly for exactly this reason.
- bs_const must use `KEY=false/true` — blank omits bs_const entirely.
- `createChild` returns must be cached — blank's init is a one-liner; N/A here, but modules composing onto blank must follow the rule.
- Reference-app polish insistence rule — blank is net-new, no video_grid dependency.
