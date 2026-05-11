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

```toml
[template]
id = "blank_scenegraph"
version = "0.1.0"
spec_compat = ">=2"
description = "Minimal module-friendly starter channel. Scene + MainScene + one init hook; no content, no UI beyond a focus-capable Group."

[template.exports]
scene_nodes = ["MainScene"]

[[template.exports.init_hooks]]
name = "MainScene.init/after_scene_show"
scope = "MainScene"
phase = "after_scene_show"

# No supported_modules.allowlist → open (PRD §3.2.6.1 default).

[template.manifest]
# Base manifest values. Channel name/version come from AppSpec.app.*
# via merger's "set" strategy.
ui_resolutions = "hd,fhd"
splash_color = "#000000"

[template.branding_defaults]
primary_color = "#000000"
# icon and splash are absent → engine synthesizes from primary_color.
```

### 5.2 `schema.ts`

```ts
import { z } from 'zod';
import { AppSpecBase } from '../../src/spec/app-spec.js';
import { BrandingSchema } from '../../src/spec/branding.js';

// Blank explicitly FORBIDS the content block (blank has no content concept).
// branding is fully optional (both icon and splash optional; primary_color optional).
export const Schema = AppSpecBase.extend({
  template: z.literal('blank_scenegraph'),
  branding: BrandingSchema.partial().optional(),
  content: z.never().optional(),  // or .undefined() + .strict() equivalent
}).strict();

export const Example = {
  spec_version: 2,
  template: 'blank_scenegraph',
  modules: [],
  app: { name: 'Blank Channel', major_version: 0, minor_version: 1, build_version: 0 },
};
```

The `Example` intentionally has no `branding` block — proves the zero-input path works end-to-end.

### 5.3 `files/manifest.ejs`

```
title=<%= app.name %>
major_version=<%= app.major_version %>
minor_version=<%= app.minor_version %>
build_version=<%= app.build_version %>
ui_resolutions=hd,fhd
splash_color=<%= splash_color %>
<% if (mm_icon_focus_hd) { %>mm_icon_focus_hd=<%= mm_icon_focus_hd %>
<% } %><% if (mm_icon_focus_fhd) { %>mm_icon_focus_fhd=<%= mm_icon_focus_fhd %>
<% } %><% if (splash_screen_hd) { %>splash_screen_hd=<%= splash_screen_hd %>
<% } %><% if (splash_screen_fhd) { %>splash_screen_fhd=<%= splash_screen_fhd %>
<% } %><% if (splash_screen_uhd) { %>splash_screen_uhd=<%= splash_screen_uhd %>
<% } %>
```

The conditional emits preserve existing "omit key if asset absent" semantics.

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

Extend `TemplateTomlSchema`:

```ts
template: z.object({
  // ...existing fields...
  branding_defaults: z
    .object({
      icon: z.string().optional(),
      splash: z.string().optional(),
      primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    })
    .strict()
    .optional(),
}),
```

Validation rules at parse time:
- If `branding_defaults.icon` is declared, the path (relative to template dir) must exist when the template is loaded.
- Same for `branding_defaults.splash`.
- If `branding_defaults` is declared with no sub-keys, error: `TEMPLATE_TOML_INVALID { reason: "branding_defaults declared but empty" }`.

### 6.2 `src/assets/synthesize.ts` (new)

```ts
import sharp from 'sharp';

/**
 * Synthesize a solid-color source PNG at the given dimensions.
 *
 * Deterministic contract:
 * - Given identical sharp major.minor version + identical {width, height, color},
 *   output bytes are byte-equal.
 * - Determinism across OS/arch is asserted by a gate test; if libvips variance
 *   ever breaks this, we switch to static PNGs per-template.
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

The synthesized PNG is written to a per-generation scratch directory inside the project's `.rokudev-tools-tmp/` (cleaned at end of generation).

### 6.5 `src/merger/conflicts.ts`

Add `assets/` to the template-territory fence (mirrors `source/_template/`). Modules cannot contribute under `assets/`.

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
  - Known color + dimensions → exact sha256 (libvips drift gate)
  - Dimensions match ICON_SOURCE_MIN / SPLASH_SOURCE_MIN
  - Invalid color throws `ASSET_INVALID_COLOR`
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

`tests/determinism.test.ts` adds a blank_scenegraph full-pipeline byte-equality test across two in-process runs. Catches synthesis determinism regressions on the dev machine.

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

1. `pnpm -C packages/brs-gen test` — all green (252 + new tests).
2. `TZ=UTC node scripts/regen-golden.mjs` followed by `pnpm -C packages/brs-gen test` — still green (determinism).
3. `t27-blank.mjs` Phase A: zero-branding spec PASS on operator's Roku.
4. `t27-blank.mjs` Phase B: module composition PASS.
5. `videorid_channel` existing T27 driver still PASS (no regression from engine change).
6. Secret-leak invariant: `JSON.stringify(synthesisResult)` contains no dev_password / signing_password (no new code paths that would).

## 14. Open questions / to-resolve-in-plan

- Where does the scratch directory for synthesized PNGs live? Candidate: `<projectDir>-synth-<random>/` alongside the existing `-tmp-` dir, cleaned on atomic rename. Decide in Plan 4a's task decomposition.
- Does the Example spec include `branding.primary_color` for documentation value, or stay bare to prove zero-input works? Plan-level decision.

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
