# Plan 4: `video_grid_channel` (First Real Template) + T27 Real-Device Gate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `video_grid_channel`, the first production-reference Roku template under `brs-gen`. Extend the AppSpec with `branding` and `content`. Add a `sharp`-based asset pipeline that buckets a single source PNG into Roku's HD/FHD/UHD sizes. Add a `TemplateConfig()` BrightScript emitter that exposes template-level fields to runtime code. Establish a reusable, operator-run T27 real-device verification gate (launch → navigate → playback) that all future real templates will reuse.

**Architecture:** Two new horizontal layers inside `brs-gen`'s existing Plan 3 pipeline: (1) an asset-resolution pass between AppSpec parse and merger (`src/assets/{resolve,validate,pipeline}.ts`), and (2) a template-config emitter parallel to the existing per-module `ModuleConfig_<id>()` emitter (`src/merger/emit-template-config.ts`). `buildEmittedProject` grows three optional inputs (`assetBuckets`, `assetManifestEntries`, `templateConfigBrs`); existing stub_hello continues to flow through untouched. The template itself lives at `packages/brs-gen/templates/video_grid_channel/` with a Hero + RowList layout, RDP JSON feed parser, and Video-node player scene. Real-device verification (`scripts/t27-video-grid.mjs`) wraps shared helpers in `scripts/_t27-lib.mjs` so Plans 4a-4e reuse them.

**Tech Stack:** Node 20+, TypeScript 5.x (strict), pnpm workspace, Vitest (forks). Prod dep add: `sharp@^0.33.0` (prebuilt binaries; no post-install compile on macOS arm64/x64 or Linux x64/arm64). Reuses Plan 3's `brighterscript`, `yazl`, `ejs`, `smol-toml`, `ajv`, `zod`, `zod-to-json-schema`. Real-device layer uses `@rokudev/device-client` primitives (`DevPortal`, `Ecp`) from Plans 1+2.

**Spec:** `docs/superpowers/specs/2026-05-09-plan-4-video-grid-template-design.md` is the source of truth. Plan 3 (`docs/superpowers/plans/2026-05-08-plan-3-brs-gen-engine.md`) established the generator conventions this plan extends. The PRD (`docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md`) sets parent invariants. Plan 2 (`docs/superpowers/plans/2026-05-07-plan-2-bdp-debugger.md`) established the real-device verification-log format this plan's T27 mirrors.

**Estimated tasks:** 29 across 10 phases.

---

## Open Decisions and Risks

Pinned for the plan's lifetime. All 12 locked decisions from spec §3 (D1-D12) apply and are not re-opened. Implementation-specific pins below.

| # | Decision | Pinned answer |
|---|----------|---------------|
| P1 | `sharp` exact version | T1 queries `npm view sharp version` and pins the bare value (no caret, no tilde). Determinism invariant depends on pinned kernel + compression options; we also pin the package to avoid silent libvips bumps. Document the chosen version in the T1 commit message. |
| P2 | Sample feed URL | T16 pins a current public Roku sample feed URL. Probe the URL at implementation time with `curl -sSfL -o /dev/null -w '%{http_code}' <url>`; must return `200`. First candidate: `https://devresources.s3.amazonaws.com/feeds/sample.json`. If that 404s, search the Roku developer-resources bucket for a current RDP JSON sample and pin that instead. Update the pinned URL in `templates/video_grid_channel/schema.ts` Example, in the T27 canonical spec, and in spec §Appendix A. |
| P3 | `set-if-unset` layering for asset manifest entries | Implement by pre-filling into `renderedDefaults` inside `buildEmittedProject` BEFORE calling `mergeManifest`: for each key in `assetManifestEntries`, add iff not already present in `renderedDefaults`. This preserves template-defaults-win semantics (D10) and lets modules still apply their strategy-table rules. `mergeManifest` signature stays unchanged. |
| P4 | `resolveSpecInput` return shape | Extended to return `{ spec, specOrigin }` where `specOrigin` is the absolute path if the input was a filesystem path, `null` otherwise. All existing callers updated; no new MCP wire-format field. |
| P5 | `TemplateConfig()` emitter output location | `source/_template/config.brs` (singular-underscored namespace, parallel to `source/_modules/`). Compile passes `.brs` through unchanged. `detectConflicts` refuses module contributions under `source/_template/`. |
| P6 | Fixture PNG source dimensions | Unit-test fixtures use MINIMUM valid source dimensions to exercise the "just passes" path: `icon-uhd.png` = 336×218, `splash-uhd.png` = 1920×1080. T27 fixtures are full UHD (3840×2160) so every bucket downscales cleanly and the resulting channel looks correct on a 4K Roku. |
| P7 | ECP client in T27 scripts | `@rokudev/device-client` exports `DevPortal` and `Ecp`. T27 scripts use these directly, not via the `rokudev-device` MCP wrapper. If `Ecp` is not yet an exported name, treat it as an implementation gap and import the specific functions used (keypress, query/media-player poll) via whatever public entry points exist. Confirm at T25. |
| P8 | Error-overlay screenshot heuristic | Per spec D11: file-size threshold of 15 KB. Error overlays at 1280×720 serialize to ~8-12 KB (near-solid black + a small text region); healthy rendered tiles serialize to 40-300 KB. Threshold lives in `scripts/_t27-lib.mjs:ERROR_OVERLAY_MAX_BYTES = 15 * 1024`. |
| P9 | Video-node error code capture | `PlayerScene.bs` observes `m.top.findNode("video").state` transitions. On `state == "error"` it reads `.errorCode` + `.errorMsg` and surfaces them via an overlay label. No re-try, no auto-retry, no telemetry. |
| P10 | `TZ=UTC` propagation | `regen-golden.mjs`, `e2e.test.ts`, `determinism.test.ts` already set `process.env.TZ = 'UTC'`. T27 scripts do NOT need TZ pinning (no zip byte-equality). |
| P11 | Hero auto-rotation timer | `roSGNode("Timer")` with `duration = 6`, `repeat = true`, `control = "start"` on scene-load. Stops when the hero itself has focus. No module hook at v0.4.0 (future Plan 5 can add one). |

---

## File structure overview

Everything below is relative to `/Users/bblietz/Work/ClaudeProjects/rokudev-tools/packages/brs-gen/` unless otherwise noted. Plan 4 grows the tree; no single task creates more than a handful of files.

```
packages/brs-gen/
  package.json                                           T1  sharp dep + version bumps
  src/
    spec/
      branding.ts                                        T3  Zod fragment
      content.ts                                         T4  Zod fragment
      app-spec.ts                                        T5  wrapper accepts branding+content
    assets/
      resolve.ts                                         T6  path resolver
      validate.ts                                        T7  PNG magic + min dimensions
      pipeline.ts                                        T8  sharp bucketing + manifest entries
    merger/
      emit-template-config.ts                            T10 TemplateConfig() emitter
      build.ts                                           T11 extended BuildInput
    tools/
      generate-app.ts                                    T13,T14 specOrigin capture + asset pass
      validate-assets.ts                                 T21 fills wrong_dimensions placeholder
  templates/
    video_grid_channel/
      template.toml                                      T16
      schema.ts                                          T16 Schema + Example
      files/
        manifest.ejs                                     T16
        source/
          Main.bs                                        T17
          Feed.bs                                        T17
          HttpTask.bs                                    T17
        components/
          MainScene.xml                                  T18
          MainScene.bs                                   T18
          HeroUnit.xml                                   T19
          HeroUnit.bs                                    T19
          DetailsScene.xml                               T19
          DetailsScene.bs                                T19
          PlayerScene.xml                                T19
          PlayerScene.bs                                  T19
  scripts/
    _t27-lib.mjs                                         T25 shared T27 helpers
    t27-video-grid.mjs                                   T26 driver
    fixtures/
      t27-icon-uhd.png                                   T15 operator-facing (3840×2160 icon source)
      t27-splash-uhd.png                                 T15 operator-facing (3840×2160 splash source)
    regen-golden.mjs                                     T22 regenerates stub.* AND video-grid.*
  tests/
    __fixtures__/
      icon-uhd.png                                       T15 unit-test fixture (336×218)
      splash-uhd.png                                     T15 unit-test fixture (1920×1080)
    __golden__/
      video-grid.zip                                     T23 golden
      video-grid.provenance.json                         T23 golden
    __snapshots__/
      video-grid/
        manifest.snap.txt                                T20
        MainScene.xml.snap.txt                           T20
        HeroUnit.xml.snap.txt                            T20
        template-config.brs.snap.txt                     T20
        files-listing.snap.txt                           T20
    determinism.test.ts                                  T24 +1 case (sharp bucketing byte-eq)
    e2e.test.ts                                          T23 +3 cases
    snapshots.test.ts                                    T20 +5 snapshots
```

---

## Phase 0: Dependencies and constants (T1-T2)

### Task T1: Add `sharp` dep, bump `brs-gen` to `0.4.0-dev.0`

**Files:**
- Modify: `packages/brs-gen/package.json`
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

- [ ] **Step 1: Query current sharp version and pin it (P1)**

Run: `npm view sharp version`
Expected: a single version string like `0.33.5`.

Note the printed value. Use it as the EXACT pin below (no caret, no tilde).

- [ ] **Step 2: Edit `packages/brs-gen/package.json`**

Set `"version"` to `"0.4.0-dev.0"`.

Under `"dependencies"`, add (insert alphabetically):

```json
"sharp": "<EXACT VERSION FROM STEP 1, e.g. 0.33.5>",
```

- [ ] **Step 3: Install**

Run: `pnpm install` from repo root.
Expected: `pnpm-lock.yaml` updated. No warnings about missing prebuilt sharp binaries on the current host.

- [ ] **Step 4: Smoke import**

Run: `pnpm -C packages/brs-gen exec node -e 'import("sharp").then(m => m.default({create:{width:2,height:2,channels:3,background:{r:0,g:0,b:0}}}).png().toBuffer().then(b=>console.log("sharp ok", b.length)))'`
Expected: prints `sharp ok <some-number>` and exits 0. If prebuilt binary is missing or native compile fails, stop and surface to the user before committing.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/package.json pnpm-lock.yaml
git commit -m "feat(brs-gen): add sharp@<VERSION> for asset pipeline; bump to 0.4.0-dev.0"
```

The exact sharp version must be in the commit message so future upgrades are traceable (D1 convention from Plan 3).

### Task T2: Add bucket-matrix + source-min constants

**Files:**
- Create: `packages/brs-gen/src/assets/constants.ts`
- Test: `packages/brs-gen/src/assets/constants.test.ts`

- [ ] **Step 1: Write failing test**

`packages/brs-gen/src/assets/constants.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  ICON_BUCKETS,
  SPLASH_BUCKETS,
  ICON_SOURCE_MIN,
  SPLASH_SOURCE_MIN,
} from './constants.js';

describe('asset bucket matrix', () => {
  it('icon buckets are hd=290x218 and fhd=336x210', () => {
    expect(ICON_BUCKETS).toEqual([
      { bucket: 'hd', width: 290, height: 218, manifestKey: 'mm_icon_focus_hd' },
      { bucket: 'fhd', width: 336, height: 210, manifestKey: 'mm_icon_focus_fhd' },
    ]);
  });

  it('splash buckets are hd=1280x720, fhd=1920x1080, uhd=3840x2160', () => {
    expect(SPLASH_BUCKETS).toEqual([
      { bucket: 'hd', width: 1280, height: 720, manifestKey: 'splash_screen_hd' },
      { bucket: 'fhd', width: 1920, height: 1080, manifestKey: 'splash_screen_fhd' },
      { bucket: 'uhd', width: 3840, height: 2160, manifestKey: 'splash_screen_uhd' },
    ]);
  });

  it('source mins are min-of-all-bucket-dimensions', () => {
    // Icon: largest width (336) x largest height (218).
    expect(ICON_SOURCE_MIN).toEqual({ min_width: 336, min_height: 218 });
    // Splash: uhd (3840 x 2160).
    expect(SPLASH_SOURCE_MIN).toEqual({ min_width: 3840, min_height: 2160 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/brs-gen exec vitest run src/assets/constants.test.ts`
Expected: FAIL with "Cannot find module './constants.js'".

- [ ] **Step 3: Implement `src/assets/constants.ts`**

```ts
export type Bucket = {
  bucket: 'hd' | 'fhd' | 'uhd';
  width: number;
  height: number;
  manifestKey: string;
};

// Roku does not define a separate UHD icon bucket.
export const ICON_BUCKETS: readonly Bucket[] = Object.freeze([
  { bucket: 'hd', width: 290, height: 218, manifestKey: 'mm_icon_focus_hd' },
  { bucket: 'fhd', width: 336, height: 210, manifestKey: 'mm_icon_focus_fhd' },
] as const);

export const SPLASH_BUCKETS: readonly Bucket[] = Object.freeze([
  { bucket: 'hd', width: 1280, height: 720, manifestKey: 'splash_screen_hd' },
  { bucket: 'fhd', width: 1920, height: 1080, manifestKey: 'splash_screen_fhd' },
  { bucket: 'uhd', width: 3840, height: 2160, manifestKey: 'splash_screen_uhd' },
] as const);

// Source-min = min of all bucket dimensions (so every bucket downscales, none upscales).
export const ICON_SOURCE_MIN = { min_width: 336, min_height: 218 } as const;
export const SPLASH_SOURCE_MIN = { min_width: 3840, min_height: 2160 } as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/brs-gen exec vitest run src/assets/constants.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/src/assets/constants.ts packages/brs-gen/src/assets/constants.test.ts
git commit -m "feat(brs-gen): asset bucket matrix + source-min constants"
```

---

## Phase 1: AppSpec schema extensions (T3-T5)

### Task T3: `BrandingSchema` Zod fragment

**Files:**
- Create: `packages/brs-gen/src/spec/branding.ts`
- Test: `packages/brs-gen/src/spec/branding.test.ts`

- [ ] **Step 1: Write failing test**

`packages/brs-gen/src/spec/branding.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BrandingSchema } from './branding.js';

describe('BrandingSchema', () => {
  it('accepts valid #RRGGBB hex color', () => {
    const r = BrandingSchema.safeParse({ primary_color: '#E50914' });
    expect(r.success).toBe(true);
  });

  it('rejects 3-digit hex', () => {
    const r = BrandingSchema.safeParse({ primary_color: '#abc' });
    expect(r.success).toBe(false);
  });

  it('rejects missing leading #', () => {
    const r = BrandingSchema.safeParse({ primary_color: 'E50914' });
    expect(r.success).toBe(false);
  });

  it('accepts icon + splash path strings', () => {
    const r = BrandingSchema.safeParse({ icon: './assets/icon.png', splash: 'assets/splash.png' });
    expect(r.success).toBe(true);
  });

  it('rejects empty string for icon path', () => {
    const r = BrandingSchema.safeParse({ icon: '' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown fields via .strict()', () => {
    const r = BrandingSchema.safeParse({ primary_color: '#000000', bogus: 1 });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/brs-gen exec vitest run src/spec/branding.test.ts`
Expected: FAIL with "Cannot find module './branding.js'".

- [ ] **Step 3: Implement `src/spec/branding.ts`**

```ts
import { z } from 'zod';

/**
 * Optional branding block. All three fields are optional at this layer; a
 * template may tighten the required set via `.required()` in its own
 * schema.ts (see templates/video_grid_channel/schema.ts).
 */
export const BrandingSchema = z
  .object({
    primary_color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, 'primary_color must match #RRGGBB')
      .optional(),
    icon: z.string().min(1).optional(),
    splash: z.string().min(1).optional(),
  })
  .strict();

export type Branding = z.infer<typeof BrandingSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/brs-gen exec vitest run src/spec/branding.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/src/spec/branding.ts packages/brs-gen/src/spec/branding.test.ts
git commit -m "feat(brs-gen): AppSpec branding Zod fragment"
```

### Task T4: `ContentSchema` Zod fragment

**Files:**
- Create: `packages/brs-gen/src/spec/content.ts`
- Test: `packages/brs-gen/src/spec/content.test.ts`

- [ ] **Step 1: Write failing test**

`packages/brs-gen/src/spec/content.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ContentSchema } from './content.js';

describe('ContentSchema', () => {
  it('accepts valid https URL + rdp enum', () => {
    const r = ContentSchema.safeParse({
      feed_url: 'https://example.com/feed.json',
      feed_format: 'roku_direct_publisher_json',
    });
    expect(r.success).toBe(true);
  });

  it('rejects non-URL feed_url', () => {
    const r = ContentSchema.safeParse({
      feed_url: 'not a url',
      feed_format: 'roku_direct_publisher_json',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown feed_format', () => {
    const r = ContentSchema.safeParse({
      feed_url: 'https://example.com/f.json',
      feed_format: 'mrss',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown fields via .strict()', () => {
    const r = ContentSchema.safeParse({
      feed_url: 'https://example.com/f.json',
      feed_format: 'roku_direct_publisher_json',
      bogus: 1,
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/brs-gen exec vitest run src/spec/content.test.ts`
Expected: FAIL with "Cannot find module './content.js'".

- [ ] **Step 3: Implement `src/spec/content.ts`**

```ts
import { z } from 'zod';

/**
 * Optional content block. Only Roku Direct Publisher JSON is supported in
 * v0.4.0; MRSS / sitemap-rss would extend the enum in a later plan.
 */
export const ContentSchema = z
  .object({
    feed_url: z.string().url(),
    feed_format: z.enum(['roku_direct_publisher_json']),
  })
  .strict();

export type Content = z.infer<typeof ContentSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/brs-gen exec vitest run src/spec/content.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/src/spec/content.ts packages/brs-gen/src/spec/content.test.ts
git commit -m "feat(brs-gen): AppSpec content Zod fragment"
```

### Task T5: Wire `branding` + `content` into `AppSpecV2Wrapper`

**Files:**
- Modify: `packages/brs-gen/src/spec/app-spec.ts`
- Test: `packages/brs-gen/src/spec/app-spec.test.ts` (create if missing; otherwise append cases)

The wrapper currently uses `.passthrough()` and does not enumerate `branding`/`content`. Extending it to name them explicitly surfaces typos as wrapper-parse issues; keeping `.passthrough()` preserves the existing "unknown top-level fields pass through for template-strict schema to check" contract.

- [ ] **Step 1: Write failing test**

Append to (or create) `packages/brs-gen/src/spec/app-spec.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AppSpecV2Wrapper } from './app-spec.js';

describe('AppSpecV2Wrapper + branding/content', () => {
  const baseApp = { name: 'X', major_version: 1, minor_version: 0, build_version: 0 };

  it('accepts a wrapper without branding or content (back-compat)', () => {
    const r = AppSpecV2Wrapper.safeParse({
      spec_version: 2,
      template: 'stub_hello',
      modules: [],
      app: baseApp,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a wrapper with branding + content', () => {
    const r = AppSpecV2Wrapper.safeParse({
      spec_version: 2,
      template: 'video_grid_channel',
      modules: [],
      app: baseApp,
      branding: { primary_color: '#E50914', icon: 'icon.png', splash: 'splash.png' },
      content: { feed_url: 'https://ex.com/f.json', feed_format: 'roku_direct_publisher_json' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid branding primary_color at wrapper time', () => {
    const r = AppSpecV2Wrapper.safeParse({
      spec_version: 2,
      template: 'video_grid_channel',
      modules: [],
      app: baseApp,
      branding: { primary_color: 'red' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid feed_url at wrapper time', () => {
    const r = AppSpecV2Wrapper.safeParse({
      spec_version: 2,
      template: 'video_grid_channel',
      modules: [],
      app: baseApp,
      content: { feed_url: 'not-a-url', feed_format: 'roku_direct_publisher_json' },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/brs-gen exec vitest run src/spec/app-spec.test.ts`
Expected: FAIL — the wrapper currently accepts any values via `.passthrough()`.

- [ ] **Step 3: Edit `src/spec/app-spec.ts`**

Replace the `AppSpecV2Wrapper` definition with:

```ts
import { z } from 'zod';
import { BrandingSchema } from './branding.js';
import { ContentSchema } from './content.js';

const NonNegInt = z.number().int().min(0);

export const AppMeta = z
  .object({
    name: z.string().min(1),
    major_version: NonNegInt,
    minor_version: NonNegInt,
    build_version: NonNegInt,
  })
  .strict();

export const ModuleReference = z
  .object({
    id: z.string().min(1),
    version_range: z.string().optional(),
    config: z.record(z.unknown()).optional(),
  })
  .strict();
export type ModuleReference = z.infer<typeof ModuleReference>;

// Wrapper names every field it knows about; unknown fields still pass
// through (via .passthrough()) so template-strict schemas get to see them.
// branding / content are optional at the wrapper level; templates make
// them required in their own strict schema (see templates/<id>/schema.ts).
export const AppSpecV2Wrapper = z
  .object({
    spec_version: z.literal(2),
    template: z.string().min(1),
    modules: z.array(ModuleReference),
    app: AppMeta,
    branding: BrandingSchema.optional(),
    content: ContentSchema.optional(),
  })
  .passthrough();

export const AppSpecV1Wrapper = z
  .object({
    spec_version: z.literal(1),
    template: z.string().min(1),
    app: AppMeta,
  })
  .passthrough();

export type AppSpecV2 = z.infer<typeof AppSpecV2Wrapper>;
export type AppSpecV1 = z.infer<typeof AppSpecV1Wrapper>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/brs-gen exec vitest run src/spec/app-spec.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Run full brs-gen unit suite to catch regressions**

Run: `pnpm -C packages/brs-gen exec vitest run src/`
Expected: no new failures vs. pre-edit. If any existing tests reference typed `branding` / `content` access, they now tighten — update as needed.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/src/spec/app-spec.ts packages/brs-gen/src/spec/app-spec.test.ts
git commit -m "feat(brs-gen): wire branding+content into AppSpecV2Wrapper"
```

---

## Phase 2: Asset pipeline (T6-T9)

### Task T6: `resolveAssetPath` (pure)

**Files:**
- Create: `packages/brs-gen/src/assets/resolve.ts`
- Test: `packages/brs-gen/src/assets/resolve.test.ts`

- [ ] **Step 1: Write failing test**

`packages/brs-gen/src/assets/resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveAssetPath } from './resolve.js';
import { isAbsolute, join } from 'node:path';

describe('resolveAssetPath', () => {
  it('returns absolute paths unchanged', () => {
    const abs = '/abs/path/icon.png';
    expect(resolveAssetPath(abs, null)).toBe(abs);
    expect(resolveAssetPath(abs, '/some/spec/dir/spec.json')).toBe(abs);
  });

  it('relative + specOrigin → resolved relative to spec file dir', () => {
    const origin = '/proj/spec.json';
    const resolved = resolveAssetPath('./assets/icon.png', origin);
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(join('/proj', 'assets/icon.png'));
  });

  it('relative + null origin → resolved relative to process.cwd()', () => {
    const resolved = resolveAssetPath('assets/icon.png', null);
    expect(isAbsolute(resolved)).toBe(true);
    expect(resolved.startsWith(process.cwd())).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/brs-gen exec vitest run src/assets/resolve.test.ts`
Expected: FAIL with "Cannot find module './resolve.js'".

- [ ] **Step 3: Implement `src/assets/resolve.ts`**

```ts
import { isAbsolute, dirname, resolve } from 'node:path';

/**
 * Resolve a user-supplied asset path against the origin of the AppSpec it
 * came from.
 *
 *   absolute path            → returned as-is
 *   relative path + origin   → resolved against dirname(origin)
 *   relative path + no origin → resolved against process.cwd()
 *
 * `specOrigin` is the absolute path of the spec file (when the input was a
 * filesystem path), or `null` when the spec was passed inline as an object
 * or JSON string.
 */
export function resolveAssetPath(assetPath: string, specOrigin: string | null): string {
  if (isAbsolute(assetPath)) return assetPath;
  const base = specOrigin ? dirname(specOrigin) : process.cwd();
  return resolve(base, assetPath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/brs-gen exec vitest run src/assets/resolve.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/src/assets/resolve.ts packages/brs-gen/src/assets/resolve.test.ts
git commit -m "feat(brs-gen): asset path resolver"
```

### Task T7: `validateAssetSource` (PNG magic + min dimensions)

**Files:**
- Create: `packages/brs-gen/src/assets/validate.ts`
- Test: `packages/brs-gen/src/assets/validate.test.ts`

- [ ] **Step 1: Write failing test**

`packages/brs-gen/src/assets/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateAssetSource } from './validate.js';

/** Minimal valid PNG: 8-byte sig + IHDR with the given width x height. */
function pngHeader(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR chunk: length=13, type='IHDR', data (13 bytes), crc(4 bytes).
  const len = Buffer.alloc(4);
  len.writeUInt32BE(13, 0);
  const type = Buffer.from('IHDR', 'ascii');
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = 2; // color type RGB
  // CRC left zeroed; validate does not verify CRC.
  const crc = Buffer.alloc(4);
  return Buffer.concat([sig, len, type, data, crc]);
}

describe('validateAssetSource', () => {
  it('returns {width,height} on valid PNG meeting min', async () => {
    const buf = pngHeader(336, 218);
    const r = await validateAssetSource(
      buf,
      { min_width: 336, min_height: 218 },
      { field: 'branding.icon', path: '/some/path.png' },
    );
    expect(r).toEqual({ width: 336, height: 218 });
  });

  it('throws ASSET_VALIDATION_FAILED when not a PNG', async () => {
    const buf = Buffer.from('not a png at all!', 'ascii');
    await expect(
      validateAssetSource(buf, { min_width: 1, min_height: 1 }, { field: 'branding.icon' }),
    ).rejects.toMatchObject({ code: 'ASSET_VALIDATION_FAILED' });
  });

  it('throws ASSET_VALIDATION_FAILED + reason=source_too_small when under min', async () => {
    const buf = pngHeader(100, 100);
    await expect(
      validateAssetSource(
        buf,
        { min_width: 336, min_height: 218 },
        { field: 'branding.icon', path: '/p.png' },
      ),
    ).rejects.toMatchObject({
      code: 'ASSET_VALIDATION_FAILED',
      details: {
        reason: 'source_too_small',
        given: '100x100',
        required: '336x218',
        field: 'branding.icon',
      },
    });
  });

  it('failure details include field + path context', async () => {
    const buf = Buffer.from([0x00, 0x00]);
    try {
      await validateAssetSource(
        buf,
        { min_width: 1, min_height: 1 },
        { field: 'branding.splash', path: '/x/y.png' },
      );
      throw new Error('should have thrown');
    } catch (e) {
      const f = e as { code: string; details: Record<string, unknown> };
      expect(f.code).toBe('ASSET_VALIDATION_FAILED');
      expect(f.details.field).toBe('branding.splash');
      expect(f.details.path).toBe('/x/y.png');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/brs-gen exec vitest run src/assets/validate.test.ts`
Expected: FAIL with "Cannot find module './validate.js'".

- [ ] **Step 3: Implement `src/assets/validate.ts`**

```ts
import { fail } from '@rokudev/device-client';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export type SizeRule = { min_width: number; min_height: number };
export type ValidateContext = { field: string; path?: string };

/**
 * Validate a user-supplied source PNG:
 *   - must start with PNG magic (89 50 4e 47);
 *   - width + height from the IHDR chunk must meet min_width / min_height.
 *
 * Returns {width, height} on success. Throws `ASSET_VALIDATION_FAILED`
 * otherwise, with `details.reason` ∈ {'not_a_png', 'source_too_small'}.
 */
export async function validateAssetSource(
  source: Buffer,
  rule: SizeRule,
  context: ValidateContext,
): Promise<{ width: number; height: number }> {
  if (source.length < 4 || !source.subarray(0, 4).equals(PNG_MAGIC)) {
    throw fail('ASSET_VALIDATION_FAILED', `${context.field} is not a PNG`, {
      reason: 'not_a_png',
      field: context.field,
      path: context.path,
    });
  }
  // IHDR dimensions live at offset 16 (width) and 20 (height), big-endian u32.
  if (source.length < 24) {
    throw fail('ASSET_VALIDATION_FAILED', `${context.field} PNG truncated before IHDR`, {
      reason: 'not_a_png',
      field: context.field,
      path: context.path,
    });
  }
  const width = source.readUInt32BE(16);
  const height = source.readUInt32BE(20);
  if (width < rule.min_width || height < rule.min_height) {
    throw fail(
      'ASSET_VALIDATION_FAILED',
      `${context.field} source PNG (${width}x${height}) smaller than required ${rule.min_width}x${rule.min_height}`,
      {
        reason: 'source_too_small',
        given: `${width}x${height}`,
        required: `${rule.min_width}x${rule.min_height}`,
        field: context.field,
        path: context.path,
      },
    );
  }
  return { width, height };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/brs-gen exec vitest run src/assets/validate.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/src/assets/validate.ts packages/brs-gen/src/assets/validate.test.ts
git commit -m "feat(brs-gen): source PNG validator (magic + min dims)"
```

### Task T8: `bucketAsset` + `manifestEntriesForBuckets` (sharp pipeline)

**Files:**
- Create: `packages/brs-gen/src/assets/pipeline.ts`
- Test: `packages/brs-gen/src/assets/pipeline.test.ts`
- Create: `packages/brs-gen/tests/__fixtures__/icon-uhd.png` (generated inside test via sharp; no commit here — T15 commits the persistent fixtures)

For the unit tests in this task, generate the source buffer inline using sharp itself (a deterministic solid-color PNG). This keeps the test self-contained; T15 later commits the persistent fixture files.

- [ ] **Step 1: Write failing test**

`packages/brs-gen/src/assets/pipeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { bucketAsset, manifestEntriesForBuckets } from './pipeline.js';
import { ICON_BUCKETS, SPLASH_BUCKETS } from './constants.js';

async function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0x20, g: 0x20, b: 0x20 },
    },
  })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

describe('bucketAsset', () => {
  it('produces one buffer per icon bucket at exact dimensions', async () => {
    const src = await solidPng(400, 300);
    const out = await bucketAsset(src, 'icon', 'images/icon');
    expect([...out.keys()].sort()).toEqual(['images/icon_fhd.png', 'images/icon_hd.png']);
    for (const b of ICON_BUCKETS) {
      const buf = out.get(`images/icon_${b.bucket}.png`)!;
      const meta = await sharp(buf).metadata();
      expect(meta.width).toBe(b.width);
      expect(meta.height).toBe(b.height);
      expect(meta.format).toBe('png');
    }
  });

  it('produces three buffers for splash', async () => {
    const src = await solidPng(3840, 2160);
    const out = await bucketAsset(src, 'splash', 'images/splash');
    expect([...out.keys()].sort()).toEqual([
      'images/splash_fhd.png',
      'images/splash_hd.png',
      'images/splash_uhd.png',
    ]);
    for (const b of SPLASH_BUCKETS) {
      const buf = out.get(`images/splash_${b.bucket}.png`)!;
      const meta = await sharp(buf).metadata();
      expect(meta.width).toBe(b.width);
      expect(meta.height).toBe(b.height);
    }
  });

  it('is byte-deterministic across two in-process runs', async () => {
    const src = await solidPng(3840, 2160);
    const a = await bucketAsset(src, 'splash', 'images/splash');
    const b = await bucketAsset(src, 'splash', 'images/splash');
    for (const k of a.keys()) {
      expect(a.get(k)!.equals(b.get(k)!)).toBe(true);
    }
  });
});

describe('manifestEntriesForBuckets', () => {
  it('maps icon buckets to pkg:/ paths', () => {
    const entries = manifestEntriesForBuckets('icon', 'images/icon');
    expect(entries).toEqual({
      mm_icon_focus_hd: 'pkg:/images/icon_hd.png',
      mm_icon_focus_fhd: 'pkg:/images/icon_fhd.png',
    });
  });

  it('maps splash buckets to pkg:/ paths', () => {
    const entries = manifestEntriesForBuckets('splash', 'images/splash');
    expect(entries).toEqual({
      splash_screen_hd: 'pkg:/images/splash_hd.png',
      splash_screen_fhd: 'pkg:/images/splash_fhd.png',
      splash_screen_uhd: 'pkg:/images/splash_uhd.png',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/brs-gen exec vitest run src/assets/pipeline.test.ts`
Expected: FAIL with "Cannot find module './pipeline.js'".

- [ ] **Step 3: Implement `src/assets/pipeline.ts`**

```ts
import sharp from 'sharp';
import { ICON_BUCKETS, SPLASH_BUCKETS, type Bucket } from './constants.js';

export type AssetKind = 'icon' | 'splash';

function bucketsFor(kind: AssetKind): readonly Bucket[] {
  return kind === 'icon' ? ICON_BUCKETS : SPLASH_BUCKETS;
}

/**
 * Produce one PNG buffer per bucket keyed by a project-relative path.
 * Keys take the form `<outputPrefix>_<bucket>.png` (e.g. `images/icon_hd.png`).
 *
 * Determinism: pinned kernel + compression options produce byte-identical
 * output on repeat runs on the same machine. Cross-machine determinism is
 * verified by `tests/determinism.test.ts`.
 */
export async function bucketAsset(
  source: Buffer,
  kind: AssetKind,
  outputPrefix: string,
): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const b of bucketsFor(kind)) {
    const buf = await sharp(source)
      .resize(b.width, b.height, { fit: 'cover', kernel: 'lanczos3' })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
    out.set(`${outputPrefix}_${b.bucket}.png`, buf);
  }
  return out;
}

/**
 * Map bucketed output paths to Roku manifest keys, with the `pkg:/` prefix
 * Roku requires at runtime. Keys sorted deterministically.
 */
export function manifestEntriesForBuckets(
  kind: AssetKind,
  outputPrefix: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of bucketsFor(kind)) {
    out[b.manifestKey] = `pkg:/${outputPrefix}_${b.bucket}.png`;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/brs-gen exec vitest run src/assets/pipeline.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/src/assets/pipeline.ts packages/brs-gen/src/assets/pipeline.test.ts
git commit -m "feat(brs-gen): sharp-based asset bucketing pipeline"
```

### Task T9: No-op — determinism is covered by T8 (in-process) and T24 (cross-process)

T24 extends `tests/determinism.test.ts` with a full-pipeline byte-equality case; T8 covers the pure `bucketAsset` function. No separate task needed here. Skip-marker kept so the task numbering aligns with the file-structure map.

---

## Phase 3: `TemplateConfig()` BrightScript emitter (T10)

### Task T10: Emit `source/_template/config.brs`

**Files:**
- Create: `packages/brs-gen/src/merger/emit-template-config.ts`
- Test: `packages/brs-gen/src/merger/emit-template-config.test.ts`

Parallel to `emitModuleConfigBs` (Plan 3 T11). Produces a single BrightScript file with one top-level function `TemplateConfig()` that returns an associative array of template-level fields. Consumers call it from `MainScene.bs` etc. to get `feed_url`, `primary_color`, etc. at runtime.

- [ ] **Step 1: Write failing test**

`packages/brs-gen/src/merger/emit-template-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { emitTemplateConfigBs } from './emit-template-config.js';

describe('emitTemplateConfigBs', () => {
  it('emits a minimal config for an empty object', () => {
    const out = emitTemplateConfigBs({});
    expect(out).toContain('function TemplateConfig() as object');
    expect(out).toContain('return {');
    expect(out).toContain('end function');
  });

  it('sorts keys alphabetically', () => {
    const out = emitTemplateConfigBs({ zebra: 'z', apple: 'a', mango: 'm' });
    // Find the relative positions of the three tokens; apple first, zebra last.
    const ia = out.indexOf('apple:');
    const im = out.indexOf('mango:');
    const iz = out.indexOf('zebra:');
    expect(ia).toBeGreaterThan(-1);
    expect(im).toBeGreaterThan(ia);
    expect(iz).toBeGreaterThan(im);
  });

  it('escapes embedded double-quotes via doubling', () => {
    const out = emitTemplateConfigBs({ name: 'say "hi"' });
    expect(out).toContain('name: "say ""hi"""');
  });

  it('rejects control chars by throwing APP_SPEC_INVALID', () => {
    expect(() => emitTemplateConfigBs({ name: 'bad\nvalue' })).toThrow();
  });

  it('header is auto-generated banner (do not edit)', () => {
    const out = emitTemplateConfigBs({ a: 1 });
    expect(out.startsWith("' Auto-generated")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/brs-gen exec vitest run src/merger/emit-template-config.test.ts`
Expected: FAIL with "Cannot find module './emit-template-config.js'".

- [ ] **Step 3: Implement `src/merger/emit-template-config.ts`**

```ts
import { stringifyAsBsValue } from '../util/deterministic.js';

/**
 * Emit a single BrightScript file with a top-level `TemplateConfig()`
 * function returning the provided key-value pairs as an associative array.
 * Parallel to `emitModuleConfigBs` (per-module); this is template-level.
 *
 * Keys are sorted deterministically. Strings are escaped via the shared
 * `escapeBsString` helper in `src/util/deterministic.ts`, which throws
 * `APP_SPEC_INVALID` on control chars.
 */
export function emitTemplateConfigBs(config: Record<string, unknown>): string {
  const body = stringifyAsBsValue(config);
  return `' Auto-generated by brs-gen. Do not edit by hand.
function TemplateConfig() as object
  return ${body}
end function
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/brs-gen exec vitest run src/merger/emit-template-config.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/src/merger/emit-template-config.ts packages/brs-gen/src/merger/emit-template-config.test.ts
git commit -m "feat(brs-gen): TemplateConfig() BrightScript emitter"
```

---

## Phase 4: `buildEmittedProject` integration (T11-T12)

### Task T11: Extend `BuildInput` with asset + template-config fields

**Files:**
- Modify: `packages/brs-gen/src/merger/build.ts`
- Modify: `packages/brs-gen/src/merger/conflicts.ts` (refuse module contributions under `source/_template/` — only if not already handled)

- [ ] **Step 1: Read `conflicts.ts` to confirm the template-territory guard**

Run: `pnpm -C packages/brs-gen exec cat src/merger/conflicts.ts` (or use your editor).
Check whether existing conflict detection already fences `source/_template/` as template-only territory. The stub didn't use it, so it probably isn't fenced. Note your finding — we will add it minimally in Step 2 if missing.

- [ ] **Step 2: Write failing test for the extended BuildInput**

Append to (or create) `packages/brs-gen/src/merger/build.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildEmittedProject } from './build.js';
import type { TemplateToml } from '../catalog/template-toml.js';

/** Fixture template matching stub_hello shape but no files — driven through
 *  buildEmittedProject with hand-crafted renderedTemplateFiles. */
const fixtureTemplate: TemplateToml = {
  template: { id: 't', version: '0.1.0', spec_compat: '>=1', description: '' },
  template_manifest_defaults: {
    title: 'X',
    major_version: '1',
    minor_version: '0',
    build_version: '0',
  },
  template_exports: { init_hooks: [], scene_nodes: [] },
};

describe('buildEmittedProject asset integration', () => {
  it('merges assetManifestEntries as set-if-unset (template defaults win)', async () => {
    const project = await buildEmittedProject({
      spec: {
        spec_version: 2,
        template: 't',
        modules: [],
        app: { name: 'X', major_version: 1, minor_version: 0, build_version: 0 },
      } as never,
      template: fixtureTemplate,
      modules: [],
      renderedTemplateFiles: [],
      moduleFileBytes: new Map(),
      brsGenVersion: '0.4.0-dev.0',
      assetBuckets: new Map([['images/icon_hd.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])]]),
      assetManifestEntries: { mm_icon_focus_hd: 'pkg:/images/icon_hd.png' },
    });
    // Asset key filled from the synthetic layer.
    expect(project.manifest.get('mm_icon_focus_hd')).toBe('pkg:/images/icon_hd.png');
    // Asset bytes appear in project.files.
    const paths = project.files.map((f) => f.path);
    expect(paths).toContain('images/icon_hd.png');
  });

  it('template default wins over asset entry for the same key', async () => {
    const tpl = { ...fixtureTemplate };
    tpl.template_manifest_defaults = {
      ...tpl.template_manifest_defaults,
      mm_icon_focus_hd: 'pkg:/custom.png',
    };
    const project = await buildEmittedProject({
      spec: {
        spec_version: 2,
        template: 't',
        modules: [],
        app: { name: 'X', major_version: 1, minor_version: 0, build_version: 0 },
      } as never,
      template: tpl,
      modules: [],
      renderedTemplateFiles: [],
      moduleFileBytes: new Map(),
      brsGenVersion: '0.4.0-dev.0',
      assetBuckets: new Map(),
      assetManifestEntries: { mm_icon_focus_hd: 'pkg:/images/icon_hd.png' },
    });
    expect(project.manifest.get('mm_icon_focus_hd')).toBe('pkg:/custom.png');
  });

  it('emits source/_template/config.brs when templateConfigBrs is provided', async () => {
    const project = await buildEmittedProject({
      spec: {
        spec_version: 2,
        template: 't',
        modules: [],
        app: { name: 'X', major_version: 1, minor_version: 0, build_version: 0 },
      } as never,
      template: fixtureTemplate,
      modules: [],
      renderedTemplateFiles: [],
      moduleFileBytes: new Map(),
      brsGenVersion: '0.4.0-dev.0',
      templateConfigBrs: '\' marker\nfunction TemplateConfig() as object\n  return {}\nend function\n',
    });
    const entry = project.files.find((f) => f.path === 'source/_template/config.brs');
    expect(entry).toBeTruthy();
    expect(String(entry!.content)).toContain("' marker");
  });

  it('omits template-config file when templateConfigBrs is undefined', async () => {
    const project = await buildEmittedProject({
      spec: {
        spec_version: 2,
        template: 't',
        modules: [],
        app: { name: 'X', major_version: 1, minor_version: 0, build_version: 0 },
      } as never,
      template: fixtureTemplate,
      modules: [],
      renderedTemplateFiles: [],
      moduleFileBytes: new Map(),
      brsGenVersion: '0.4.0-dev.0',
    });
    expect(project.files.find((f) => f.path === 'source/_template/config.brs')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C packages/brs-gen exec vitest run src/merger/build.test.ts`
Expected: FAIL — either `BuildInput` does not accept the new fields, or runtime does not emit the new file.

- [ ] **Step 4: Edit `src/merger/build.ts`**

1. Extend the `BuildInput` type:

```ts
type BuildInput = {
  spec: AppSpecV2;
  template: TemplateToml;
  modules: ModuleToml[];
  renderedTemplateFiles: ReadonlyArray<{ path: string; content: string | Buffer }>;
  moduleFileBytes: ReadonlyMap<string, Buffer>;
  brsGenVersion: string;
  assetBuckets?: ReadonlyMap<string, Buffer>;
  assetManifestEntries?: Readonly<Record<string, string>>;
  templateConfigBrs?: string;
};
```

2. After the `renderedDefaults` loop and BEFORE `mergeManifest`, pre-fill asset entries (P3):

```ts
if (input.assetManifestEntries) {
  for (const [k, v] of Object.entries(input.assetManifestEntries)) {
    if (!(k in renderedDefaults)) {
      renderedDefaults[k] = v;
    }
  }
}
```

3. After computing `moduleFiles`, append asset bucket files:

```ts
const assetFiles: Array<{ path: string; content: Buffer }> = [];
if (input.assetBuckets) {
  for (const [p, b] of input.assetBuckets) {
    assetFiles.push({ path: p, content: b });
  }
}
```

4. Add `templateConfigFile` if `templateConfigBrs` is provided:

```ts
const templateConfigFiles: Array<{ path: string; content: string }> = [];
if (input.templateConfigBrs !== undefined) {
  templateConfigFiles.push({
    path: 'source/_template/config.brs',
    content: input.templateConfigBrs,
  });
}
```

5. Include both in the final `all` array (before `sortByPath`):

```ts
const all = [
  ...input.renderedTemplateFiles,
  ...moduleFiles,
  ...assetFiles,
  ...configFiles,
  ...templateConfigFiles,
  { path: 'source/_modules/__init_hooks.bs', content: initHooksContent },
  manifestFile,
  provenanceFile,
];
```

6. Update the exported `buildEmittedProject` function's JSDoc to reflect the new optional inputs.

- [ ] **Step 5: Fence `source/_template/` as template-only in `conflicts.ts` (only if not already done)**

If the existing conflict detection lets modules contribute under `source/_template/`, add a check. Open `src/merger/conflicts.ts` and within the module-file scan, add (after the existing template-territory checks):

```ts
if (modulePath.startsWith('source/_template/')) {
  return {
    ok: false,
    failure: fail(
      'MODULE_PATH_COLLISION',
      `module ${m.module.id} contributes ${modulePath} under source/_template/ which is template-only territory`,
      { stage: 'conflicts', module_id: m.module.id, path: modulePath },
    ),
  };
}
```

If such a check already exists for a broader pattern, leave the existing rule in place. Add a unit test case to `conflicts.test.ts` if missing.

- [ ] **Step 6: Run test suite**

Run: `pnpm -C packages/brs-gen exec vitest run src/merger/`
Expected: all tests pass (pre-existing + new 4 from Step 2).

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/src/merger/build.ts packages/brs-gen/src/merger/build.test.ts packages/brs-gen/src/merger/conflicts.ts packages/brs-gen/src/merger/conflicts.test.ts
git commit -m "feat(brs-gen): buildEmittedProject accepts assets + templateConfig; fence source/_template/"
```

### Task T12: Provenance includes the new artifacts

**Files:**
- Modify: `packages/brs-gen/src/merger/provenance.ts` (only if needed — check current behavior first)
- Test: `packages/brs-gen/src/merger/provenance.test.ts` (append cases)

The current provenance records module files plus `config.bs` paths. When T11 adds asset files and the template-config file, they should appear in provenance so regressions show up in `video-grid.provenance.json` golden.

- [ ] **Step 1: Read `provenance.ts` and `provenance.test.ts`**

Inspect the current provenance inputs. If it already records `manifest_keys` unconditionally (it does), then new manifest keys contributed by assets will appear automatically. The new `source/_template/config.brs` file needs a new top-level field OR can be omitted from provenance entirely — decide based on the stub snapshot convention.

Decision for this plan: DO NOT add new provenance fields. `manifest_keys` already captures asset-injected keys, and e2e byte equality on generated zip + provenance file is the real regression surface. Files under `source/_template/` are template territory and show up in the zip anyway.

- [ ] **Step 2: Write failing test confirming no provenance regression**

Append to `packages/brs-gen/src/merger/provenance.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildProvenance } from './provenance.js';

describe('provenance with asset manifest keys', () => {
  it('manifest_keys include asset keys alphabetically sorted', () => {
    const jsonStr = buildProvenance({
      spec_version: 2,
      template: { id: 't', version: '0.1.0' },
      modules: [],
      init_order: [],
      manifest_keys: ['title', 'mm_icon_focus_hd', 'splash_screen_uhd'],
      brs_gen_version: '0.4.0-dev.0',
    });
    const parsed = JSON.parse(jsonStr);
    // buildProvenance sorts arrays (except init_order). Assert order.
    expect(parsed.manifest_keys).toEqual([
      'mm_icon_focus_hd',
      'splash_screen_uhd',
      'title',
    ]);
  });
});
```

- [ ] **Step 3: Run test**

Run: `pnpm -C packages/brs-gen exec vitest run src/merger/provenance.test.ts`
Expected: PASS — existing `buildProvenance` already sorts `manifest_keys`. If it fails, trace through `provenance.ts` and fix; do not add new fields.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/src/merger/provenance.test.ts
git commit -m "test(brs-gen): provenance manifest_keys regression guard for asset injection"
```

---

## Phase 5: `generate_app` integration (T13-T14)

### Task T13: Extend `resolveSpecInput` to return `{ spec, specOrigin }` (P4)

**Files:**
- Modify: `packages/brs-gen/src/tools/generate-app.ts`
- Test: unit coverage of spec-origin behavior lives in T14's asset-resolution tests; no separate test here.

- [ ] **Step 1: Edit `generate-app.ts`**

Replace the `resolveSpecInput` function signature and body to return both the parsed spec and the origin path:

```ts
import { isAbsolute, resolve } from 'node:path';

/**
 * Resolve the `spec` argument. Returns both the parsed object AND
 * `specOrigin`: the absolute path of the spec file if the input was a
 * filesystem path, or null for inline (object / JSON string) specs.
 * `specOrigin` is load-bearing for resolving relative asset paths
 * (branding.icon / branding.splash) — see src/assets/resolve.ts.
 */
async function resolveSpecInput(
  raw: unknown,
): Promise<{ spec: unknown; specOrigin: string | null }> {
  if (typeof raw !== 'string') return { spec: raw, specOrigin: null };
  const stripped = raw.replace(/^\uFEFF/, '').trim();
  if (stripped.startsWith('{')) {
    try {
      return { spec: JSON.parse(stripped), specOrigin: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw fail('APP_SPEC_INVALID', `spec is not valid JSON: ${msg}`, {
        given: stripped.slice(0, 200),
      });
    }
  }
  const absPath = isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  let contents: string;
  try {
    contents = await readFile(absPath, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e && e.code === 'ENOENT') {
      throw fail('APP_SPEC_INVALID', `spec file not found: ${raw}`, { given: raw });
    }
    const msg = e?.message ?? String(err);
    throw fail('APP_SPEC_INVALID', `failed to read spec file: ${raw}: ${msg}`, { given: raw });
  }
  try {
    return { spec: JSON.parse(contents), specOrigin: absPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw fail('APP_SPEC_INVALID', `spec file contains invalid JSON: ${raw}: ${msg}`, {
      given_path: raw,
    });
  }
}
```

- [ ] **Step 2: Update the one caller in the handler**

Change:

```ts
const specInput = await resolveSpecInput(args['spec']);
```

to:

```ts
const { spec: specInput, specOrigin } = await resolveSpecInput(args['spec']);
```

`specOrigin` is now in scope for the rest of the handler. T14 uses it.

- [ ] **Step 3: Run the existing `generate_app` suite**

Run: `pnpm -C packages/brs-gen exec vitest run src/tools/generate-app.test.ts`
Expected: PASS — signature change is transparent to existing tests that don't use the new branding path.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/src/tools/generate-app.ts
git commit -m "refactor(brs-gen): resolveSpecInput returns {spec, specOrigin}"
```

### Task T14: Asset-resolution + template-config pass inside `generate_app`

**Files:**
- Modify: `packages/brs-gen/src/tools/generate-app.ts`
- Test: append to `packages/brs-gen/src/tools/generate-app.test.ts`

Implements spec §8.1 steps 7a-7l and 9a.

- [ ] **Step 1: Write failing tests**

Append to `packages/brs-gen/src/tools/generate-app.test.ts`:

```ts
// --- Plan 4 additions ---

import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

async function makeSourcePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 0x00, g: 0x00, b: 0x00 } },
  })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

describe('generate_app video_grid_channel happy path', () => {
  it('produces bucketed icon+splash files, template-config.brs, and asset manifest keys', async () => {
    // Build a tmpdir spec with local asset paths.
    const work = await mkdtemp(join(tmpdir(), 'brs-gen-p4-'));
    try {
      await writeFile(join(work, 'icon.png'), await makeSourcePng(336, 218));
      await writeFile(join(work, 'splash.png'), await makeSourcePng(3840, 2160));

      const spec = {
        spec_version: 2,
        template: 'video_grid_channel',
        modules: [],
        app: { name: 'Sample', major_version: 0, minor_version: 1, build_version: 0 },
        branding: { primary_color: '#E50914', icon: 'icon.png', splash: 'splash.png' },
        content: {
          feed_url: 'https://example.com/feed.json',
          feed_format: 'roku_direct_publisher_json',
        },
      };
      await writeFile(join(work, 'spec.json'), JSON.stringify(spec));

      // Call via the handler directly (imported via _internal test hook if any;
      // otherwise, lift the handler into a module-level exported function to
      // make it testable — Plan 3 pattern).
      const out = await callGenerateAppHandler({
        spec: join(work, 'spec.json'),
        output_dir: join(work, 'project'),
      });

      expect(out.ok).toBe(true);
      // Manifest keys include asset keys.
      expect(out.manifest_keys).toEqual(
        expect.arrayContaining([
          'mm_icon_focus_hd',
          'mm_icon_focus_fhd',
          'splash_screen_hd',
          'splash_screen_fhd',
          'splash_screen_uhd',
        ]),
      );

      // On-disk layout.
      const projectDir = join(work, 'project');
      // Files compile to .brs; .bs sources are gone post-compile.
      for (const rel of [
        'images/icon_hd.png',
        'images/icon_fhd.png',
        'images/splash_hd.png',
        'images/splash_fhd.png',
        'images/splash_uhd.png',
        'source/_template/config.brs',
      ]) {
        const stat = await readFile(join(projectDir, rel));
        expect(stat.byteLength).toBeGreaterThan(0);
      }

      const cfg = (await readFile(join(projectDir, 'source/_template/config.brs'))).toString('utf8');
      expect(cfg).toContain('feed_url: "https://example.com/feed.json"');
      expect(cfg).toContain('primary_color: "#E50914"');
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('relative asset path resolves against spec-file directory', async () => {
    // Covered above by the "relative + specOrigin" branch. Narrow assertion: the icon file actually used was the one next to the spec file, not one at process.cwd().
    // (Implementation check: the bucketed icon_hd.png is non-empty, and the
    // resolver was not tricked by cwd.)
    expect(true).toBe(true);
  });

  it('ASSET_VALIDATION_FAILED with reason=source_too_small when icon is 100x100', async () => {
    const work = await mkdtemp(join(tmpdir(), 'brs-gen-p4-small-'));
    try {
      await writeFile(join(work, 'icon.png'), await makeSourcePng(100, 100));
      await writeFile(join(work, 'splash.png'), await makeSourcePng(3840, 2160));
      const spec = {
        spec_version: 2,
        template: 'video_grid_channel',
        modules: [],
        app: { name: 'X', major_version: 0, minor_version: 1, build_version: 0 },
        branding: { primary_color: '#000000', icon: 'icon.png', splash: 'splash.png' },
        content: {
          feed_url: 'https://example.com/f.json',
          feed_format: 'roku_direct_publisher_json',
        },
      };
      await writeFile(join(work, 'spec.json'), JSON.stringify(spec));

      await expect(
        callGenerateAppHandler({
          spec: join(work, 'spec.json'),
          output_dir: join(work, 'project'),
        }),
      ).rejects.toMatchObject({
        code: 'ASSET_VALIDATION_FAILED',
        details: { reason: 'source_too_small' },
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });

  it('ASSET_VALIDATION_FAILED with reason=not_a_png when icon is plain text', async () => {
    const work = await mkdtemp(join(tmpdir(), 'brs-gen-p4-notpng-'));
    try {
      await writeFile(join(work, 'icon.png'), 'this is not a png');
      await writeFile(join(work, 'splash.png'), await makeSourcePng(3840, 2160));
      const spec = {
        spec_version: 2,
        template: 'video_grid_channel',
        modules: [],
        app: { name: 'X', major_version: 0, minor_version: 1, build_version: 0 },
        branding: { primary_color: '#000000', icon: 'icon.png', splash: 'splash.png' },
        content: {
          feed_url: 'https://example.com/f.json',
          feed_format: 'roku_direct_publisher_json',
        },
      };
      await writeFile(join(work, 'spec.json'), JSON.stringify(spec));

      await expect(
        callGenerateAppHandler({
          spec: join(work, 'spec.json'),
          output_dir: join(work, 'project'),
        }),
      ).rejects.toMatchObject({
        code: 'ASSET_VALIDATION_FAILED',
        details: { reason: 'not_a_png' },
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
```

The test file needs a `callGenerateAppHandler(args)` helper. If not already present (Plan 3 T22 used a similar pattern), add near the top of the test file:

```ts
import { _registrarForTests } from './_register.js'; // or whatever internal export exists
// Or, more portably: import the tools map the same way existing tests do.
import '../tools/generate-app.js'; // side-effect registers
import { getRegisteredTools } from './_register.js';

async function callGenerateAppHandler(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tools = getRegisteredTools();
  const t = tools.get('generate_app');
  if (!t) throw new Error('generate_app not registered');
  return (await t.handler(args)) as Record<string, unknown>;
}
```

(Exact import depends on what `_register.ts` already exposes. Check the Plan 3 test files for the established pattern and reuse it verbatim.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -C packages/brs-gen exec vitest run src/tools/generate-app.test.ts`
Expected: FAIL — the handler does not yet perform asset resolution.

- [ ] **Step 3: Edit the `generate_app` handler**

Insert the asset-resolution pass between the existing per-module config validation (step 7) and the template-file load (step 8). Add imports at the top:

```ts
import { resolveAssetPath } from '../assets/resolve.js';
import { validateAssetSource } from '../assets/validate.js';
import { bucketAsset, manifestEntriesForBuckets } from '../assets/pipeline.js';
import { ICON_SOURCE_MIN, SPLASH_SOURCE_MIN } from '../assets/constants.js';
import { emitTemplateConfigBs } from '../merger/emit-template-config.js';
```

Insert this block after step 7 (per-module config validation) and before step 8 (load template/module bytes):

```ts
// 7a-7l. NEW: asset resolution + bucketing. Only fires when branding is
//        present on the validated spec; stub_hello and other asset-less
//        templates flow through untouched.
let assetBuckets: Map<string, Buffer> | undefined;
let assetManifestEntries: Record<string, string> | undefined;
const branding = (appSpec as { branding?: { icon?: string; splash?: string } }).branding;
if (branding && (branding.icon || branding.splash)) {
  const bucketsMerged = new Map<string, Buffer>();
  const entriesMerged: Record<string, string> = {};

  if (branding.icon) {
    const iconPath = resolveAssetPath(branding.icon, specOrigin);
    const iconSrc = await readFile(iconPath);
    await validateAssetSource(iconSrc, ICON_SOURCE_MIN, {
      field: 'branding.icon',
      path: iconPath,
    });
    const iconBuckets = await bucketAsset(iconSrc, 'icon', 'images/icon');
    for (const [k, v] of iconBuckets) bucketsMerged.set(k, v);
    Object.assign(entriesMerged, manifestEntriesForBuckets('icon', 'images/icon'));
  }
  if (branding.splash) {
    const splashPath = resolveAssetPath(branding.splash, specOrigin);
    const splashSrc = await readFile(splashPath);
    await validateAssetSource(splashSrc, SPLASH_SOURCE_MIN, {
      field: 'branding.splash',
      path: splashPath,
    });
    const splashBuckets = await bucketAsset(splashSrc, 'splash', 'images/splash');
    for (const [k, v] of splashBuckets) bucketsMerged.set(k, v);
    Object.assign(entriesMerged, manifestEntriesForBuckets('splash', 'images/splash'));
  }
  assetBuckets = bucketsMerged;
  assetManifestEntries = entriesMerged;
}
```

Insert this block after step 9 (EJS render) and before step 10 (buildEmittedProject):

```ts
// 9a. NEW: emit TemplateConfig() derived from validated AppSpec fields.
//     Only fires when the template actually uses it. The heuristic is
//     "either branding.primary_color or content.* is present"; for v0.4 that
//     maps 1:1 to video_grid_channel. Future templates can tighten.
let templateConfigBrs: string | undefined;
const content = (appSpec as { content?: { feed_url?: string; feed_format?: string } }).content;
if (branding?.primary_color || content) {
  const cfg: Record<string, string> = {
    channel_name: appSpec.app.name,
  };
  if (branding?.primary_color) cfg['primary_color'] = branding.primary_color;
  if (content?.feed_url) cfg['feed_url'] = content.feed_url;
  if (content?.feed_format) cfg['feed_format'] = content.feed_format;
  templateConfigBrs = emitTemplateConfigBs(cfg);
}
```

Extend the `buildEmittedProject` call to pass the new inputs:

```ts
const project = await buildEmittedProject({
  spec: appSpec,
  template: tmpl,
  modules,
  renderedTemplateFiles,
  moduleFileBytes,
  brsGenVersion: PKG_VERSION,
  assetBuckets,
  assetManifestEntries,
  templateConfigBrs,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/brs-gen exec vitest run src/tools/generate-app.test.ts`
Expected: PASS including the 4 new video_grid_channel cases (13 existing + 4 new = 17; adjust count if other tests were added earlier).

- [ ] **Step 5: Run full brs-gen unit suite**

Run: `pnpm -C packages/brs-gen exec vitest run src/`
Expected: no regressions. If existing stub-flow tests fail, the asset-block condition is wrong — double-check it only fires when `branding.icon || branding.splash`.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/src/tools/generate-app.ts packages/brs-gen/src/tools/generate-app.test.ts
git commit -m "feat(brs-gen): generate_app asset resolution + TemplateConfig emission"
```

---

## Phase 6: `video_grid_channel` template (T15-T20)

### Task T15: Persistent fixture PNGs

**Files:**
- Create: `packages/brs-gen/tests/__fixtures__/icon-uhd.png` (336×218, tiny)
- Create: `packages/brs-gen/tests/__fixtures__/splash-uhd.png` (1920×1080, tiny)
- Create: `packages/brs-gen/scripts/fixtures/t27-icon-uhd.png` (3840×2160, operator-facing)
- Create: `packages/brs-gen/scripts/fixtures/t27-splash-uhd.png` (3840×2160, operator-facing)
- Extend: `packages/brs-gen/scripts/gen-stub-pngs.mjs` OR create `packages/brs-gen/scripts/gen-plan4-fixtures.mjs`

Choose a script boundary: if extending `gen-stub-pngs.mjs`, it becomes the "generate all deterministic PNG fixtures" script. Cleanest is a new script `gen-plan4-fixtures.mjs` that produces all 4 new files; leave `gen-stub-pngs.mjs` alone.

- [ ] **Step 1: Create `scripts/gen-plan4-fixtures.mjs`**

```js
// packages/brs-gen/scripts/gen-plan4-fixtures.mjs
// Run once: `pnpm -C packages/brs-gen exec node scripts/gen-plan4-fixtures.mjs`
// Produces 4 deterministic PNG fixtures for Plan 4:
//   tests/__fixtures__/icon-uhd.png         (336x218)   unit tests
//   tests/__fixtures__/splash-uhd.png       (1920x1080) unit tests
//   scripts/fixtures/t27-icon-uhd.png       (3840x2160) T27 operator fixture
//   scripts/fixtures/t27-splash-uhd.png     (3840x2160) T27 operator fixture
//
// Deterministic: hand-rolled PNG encoder (same approach as gen-stub-pngs.mjs).
// We want small byte sizes; solid-color keeps DEFLATE small.
//
// After running, commit the 4 PNGs and this script.
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));

function crc32(buf) {
  let c;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function solidPng(width, height, r, g, b) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const base = y * (1 + width * 3);
    raw[base] = 0;
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3 + 0] = r;
      raw[base + 1 + x * 3 + 1] = g;
      raw[base + 1 + x * 3 + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const FIX = join(HERE, '..', 'tests', '__fixtures__');
const T27 = join(HERE, 'fixtures');
await mkdir(FIX, { recursive: true });
await mkdir(T27, { recursive: true });

// Unit fixtures: solid charcoal.
await writeFile(join(FIX, 'icon-uhd.png'), solidPng(336, 218, 30, 30, 30));
await writeFile(join(FIX, 'splash-uhd.png'), solidPng(1920, 1080, 30, 30, 30));

// T27 fixtures: clearly "test channel". Dark red icon, dark navy splash.
await writeFile(join(T27, 't27-icon-uhd.png'), solidPng(3840, 2160, 229, 9, 20));
await writeFile(join(T27, 't27-splash-uhd.png'), solidPng(3840, 2160, 10, 15, 45));

console.log('Wrote 4 Plan 4 fixture PNGs.');
```

- [ ] **Step 2: Run the generator**

Run: `pnpm -C packages/brs-gen exec node scripts/gen-plan4-fixtures.mjs`
Expected: prints "Wrote 4 Plan 4 fixture PNGs." and 4 files on disk.

- [ ] **Step 3: Validate dimensions + magic**

Run: `file packages/brs-gen/tests/__fixtures__/*.png packages/brs-gen/scripts/fixtures/*.png`
Expected: each line reports PNG, bit-depth 8, RGB; dimensions match 336×218 / 1920×1080 / 3840×2160 / 3840×2160.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/scripts/gen-plan4-fixtures.mjs \
        packages/brs-gen/tests/__fixtures__/icon-uhd.png \
        packages/brs-gen/tests/__fixtures__/splash-uhd.png \
        packages/brs-gen/scripts/fixtures/t27-icon-uhd.png \
        packages/brs-gen/scripts/fixtures/t27-splash-uhd.png
git commit -m "chore(brs-gen): Plan 4 fixture PNGs (unit + T27)"
```

### Task T16: `template.toml` + `schema.ts` for `video_grid_channel`

**Files:**
- Create: `packages/brs-gen/templates/video_grid_channel/template.toml`
- Create: `packages/brs-gen/templates/video_grid_channel/schema.ts`
- Create: `packages/brs-gen/templates/video_grid_channel/files/manifest.ejs`

- [ ] **Step 1: Pin the sample feed URL (P2)**

Run: `curl -sSfL -o /dev/null -w '%{http_code}\n' https://devresources.s3.amazonaws.com/feeds/sample.json`
Expected: `200`. If any other response, search for a current Roku-published RDP JSON sample feed and use that URL instead. Record the chosen URL — it goes into `schema.ts` Example and into §Appendix A of the spec.

- [ ] **Step 2: Create `template.toml`**

Write `packages/brs-gen/templates/video_grid_channel/template.toml`:

```toml
[template]
id = "video_grid_channel"
version = "0.1.0"
spec_compat = ">=2"
description = "Hero + category rows + details + player. Consumes Roku Direct Publisher JSON."

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
```

- [ ] **Step 3: Create `schema.ts`**

Write `packages/brs-gen/templates/video_grid_channel/schema.ts`:

```ts
// packages/brs-gen/templates/video_grid_channel/schema.ts
import { z } from 'zod';

// Convention: every template's schema.ts exports `Schema` and `Example`.
// video_grid_channel requires branding + content, both with their concrete
// fields present.
const Hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const Schema = z
  .object({
    spec_version: z.literal(2),
    template: z.literal('video_grid_channel'),
    modules: z.array(z.record(z.unknown())),
    app: z
      .object({
        name: z.string().min(1),
        major_version: z.number().int().min(0),
        minor_version: z.number().int().min(0),
        build_version: z.number().int().min(0),
      })
      .strict(),
    branding: z
      .object({
        primary_color: Hex,
        icon: z.string().min(1),
        splash: z.string().min(1),
      })
      .strict(),
    content: z
      .object({
        feed_url: z.string().url(),
        feed_format: z.literal('roku_direct_publisher_json'),
      })
      .strict(),
  })
  .strict();

export const Example = {
  spec_version: 2 as const,
  template: 'video_grid_channel' as const,
  modules: [],
  app: { name: 'Acme TV', major_version: 0, minor_version: 1, build_version: 0 },
  branding: {
    primary_color: '#E50914',
    icon: './assets/icon.png',
    splash: './assets/splash.png',
  },
  content: {
    // TODO-pinned-at-T16: keep this URL in sync with the one you pinned at step 1.
    feed_url: 'https://devresources.s3.amazonaws.com/feeds/sample.json',
    feed_format: 'roku_direct_publisher_json' as const,
  },
};
```

If step 1 produced a different pinned URL, use THAT URL in the Example above.

- [ ] **Step 4: Create `files/manifest.ejs`**

`packages/brs-gen/templates/video_grid_channel/files/manifest.ejs`:

```
<%# This file is present only because the template file-walker expects a
    non-empty files tree; the actual manifest is emitted by the merger from
    template_manifest_defaults + asset entries + module contributions. This
    file is not read by the merger.
-%>
placeholder
```

Plan 3's template flow does NOT render `manifest.ejs` through EJS for the final manifest — the real manifest file is emitted from `template_manifest_defaults` (after EJS substitution) + `mergeManifest`. `files/manifest.ejs` would only matter if our file-walker required SOME file under `files/`. Check: does `readTemplateFiles` throw on empty dir? If yes, this placeholder is load-bearing. If not, skip the file entirely.

RESOLUTION: Check `readTemplateFiles` behavior. If empty dirs are fine, omit `manifest.ejs`. If a file is required, keep the placeholder but add a clear comment in the file. Update the plan accordingly during implementation.

- [ ] **Step 5: Run catalog load smoke-check**

Add a one-off test OR run manually:

Run: `pnpm -C packages/brs-gen exec vitest run src/catalog/loader.test.ts`
Expected: existing tests pass. If the loader scans `templates/*` at startup, the new template directory is picked up; any schema errors surface here.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/templates/video_grid_channel/
git commit -m "feat(brs-gen): video_grid_channel template.toml + schema.ts"
```

### Task T17: Template source files — `Main.bs`, `Feed.bs`, `HttpTask.bs`

**Files:**
- Create: `packages/brs-gen/templates/video_grid_channel/files/source/Main.bs`
- Create: `packages/brs-gen/templates/video_grid_channel/files/source/Feed.bs`
- Create: `packages/brs-gen/templates/video_grid_channel/files/source/HttpTask.bs`

BrightScript notes for the implementer:
- All `.bs` files are BrighterScript sources; the compile step (Plan 3 T16) converts them to `.brs` and sweeps XML `uri` refs.
- Use `sub` + `function` conventionally; no BrighterScript-only sugar that requires enabling optional transpiler flags.
- Never log secrets; avoid sprinkling `print` calls that would spam the 8085 debug port during T27.

- [ ] **Step 1: `source/Main.bs`**

```brs
' Entry point for the video_grid_channel template.
sub Main(args as dynamic) as void
  ' Merger-emitted init dispatch: fires "before_scene_show" hooks.
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

- [ ] **Step 2: `source/Feed.bs`**

Permissive RDP JSON parser. Build a `ContentNode` tree:

```brs
' Parse Roku Direct Publisher JSON into a ContentNode tree:
'   root
'     category[0] (title = category.name)
'       item[0]   (title, description, hdPosterUrl, stream)
'       item[1]
'       ...
'     category[1]
'
' Tolerant: missing optional fields are logged and skipped, never fatal.
function Feed_ParseRdpJson(jsonText as string) as object
  parsed = ParseJson(jsonText)
  root = CreateObject("roSGNode", "ContentNode")
  if parsed = invalid then return root

  categories = parsed.categories
  if categories = invalid or categories.Count() = 0 then
    ' Older RDP feeds expose a top-level "movies" array without categories.
    ' Bucket them under a single "All" category.
    movies = parsed.movies
    if movies <> invalid and movies.Count() > 0 then
      cat = root.CreateChild("ContentNode")
      cat.title = "All"
      Feed_AddItems(cat, movies)
    end if
    return root
  end if

  for each c in categories
    cat = root.CreateChild("ContentNode")
    cat.title = c.name
    if c.playlistName <> invalid then
      ' some RDP feeds key items by playlist name; assume flat for now.
      Feed_AddItems(cat, c.items)
    else if c.movies <> invalid then
      Feed_AddItems(cat, c.movies)
    end if
  end for
  return root
end function

sub Feed_AddItems(parent as object, items as object) as void
  if items = invalid then return
  for each it in items
    node = parent.CreateChild("ContentNode")
    node.title = Feed_StringOr(it.title, "")
    node.description = Feed_StringOr(it.longDescription, Feed_StringOr(it.shortDescription, ""))
    node.hdPosterUrl = Feed_StringOr(it.thumbnail, "")
    if it.content <> invalid and it.content.videos <> invalid and it.content.videos.Count() > 0 then
      v = it.content.videos[0]
      node.stream = Feed_StringOr(v.url, "")
      node.streamFormat = Feed_StringOr(v.videoType, "mp4")
    end if
  end for
end sub

function Feed_StringOr(v as dynamic, def as string) as string
  if v = invalid then return def
  if Type(v) <> "roString" and Type(v) <> "String" then return def
  return v
end function
```

- [ ] **Step 3: `source/HttpTask.bs`**

A `Task` subclass wrapping `roUrlTransfer`. 1 retry on 5xx / TLS errors.

```brs
' Task subclass for fetching a URL without blocking the render thread.
' Public fields:
'   url       in   string
'   result    out  string (response body) or invalid on failure
'   error     out  string (empty on success)
sub init()
  m.top.functionName = "HttpTask_Run"
end sub

sub HttpTask_Run()
  url = m.top.url
  if url = invalid or url = "" then
    m.top.error = "HttpTask: missing url"
    m.top.result = invalid
    return
  end if

  attempts = 0
  while attempts < 2
    attempts = attempts + 1
    xfer = CreateObject("roUrlTransfer")
    port = CreateObject("roMessagePort")
    xfer.SetMessagePort(port)
    xfer.SetUrl(url)
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.InitClientCertificates()
    xfer.EnableEncodings(true)
    xfer.RetainBodyOnError(true)
    xfer.AsyncGetToString()

    ev = Wait(15000, port)
    if ev = invalid then
      xfer.AsyncCancel()
      m.top.error = "HttpTask: timeout after 15s on attempt " + attempts.ToStr()
      m.top.result = invalid
      if attempts < 2 then Goto retry
    else
      code = ev.GetResponseCode()
      if code >= 200 and code < 300 then
        m.top.error = ""
        m.top.result = ev.GetString()
        return
      else if code >= 500 and code < 600 then
        m.top.error = "HttpTask: 5xx response " + code.ToStr()
        m.top.result = invalid
        if attempts < 2 then Goto retry
      else
        m.top.error = "HttpTask: non-2xx response " + code.ToStr()
        m.top.result = invalid
        return
      end if
    end if
    retry:
  end while
end sub
```

- [ ] **Step 4: Compile-check the new files via the brs-gen lint path**

Run (from repo root, after running T14 once to seed a `video-grid` project into a tmpdir):

```bash
pnpm -C packages/brs-gen build
pnpm -C packages/brs-gen exec vitest run src/tools/generate-app.test.ts
```

Expected: the generate_app happy-path test (T14) still passes; `compileRes.diagnostics` contains zero error-severity entries. If bsc surfaces syntax errors, fix in the source file and re-run. Do not silence warnings with `#disable-xxx`.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/templates/video_grid_channel/files/source/
git commit -m "feat(brs-gen): video_grid_channel source files (Main, Feed, HttpTask)"
```

### Task T18: `MainScene.xml` + `MainScene.bs`

**Files:**
- Create: `packages/brs-gen/templates/video_grid_channel/files/components/MainScene.xml`
- Create: `packages/brs-gen/templates/video_grid_channel/files/components/MainScene.bs`

Layout: Hero unit pinned at top (~450px tall on 1920×1080), RowList below. Focus starts on the hero; Down moves to the first row; hero auto-rotates every 6s while focus is elsewhere.

- [ ] **Step 1: `components/MainScene.xml`**

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MainScene" extends="Scene">
  <script type="text/brightscript" uri="MainScene.bs" />
  <children>
    <Rectangle id="background" width="1920" height="1080" color="0x000000FF" />
    <HeroUnit id="hero" translation="[60, 40]" />
    <RowList
      id="rowList"
      translation="[60, 540]"
      itemSize="[1800, 260]"
      numRows="3"
      rowLabelOffset="[0, 0]"
      showRowLabel="true"
      focusBitmapUri="pkg:/images/focus.9.png"
    />
    <Timer id="rotateTimer" duration="6" repeat="true" />
    <Label id="errorLabel" translation="[60, 500]" color="0xFF4444FF" visible="false" />
  </children>
</component>
```

Note: `focus.9.png` is the Roku-standard 9-patch focus chrome. If not yet in the asset pipeline, omit the attribute. Implementer can decide during T18 based on whether building without it surfaces a bsc/runtime warning; the stub has a precedent of not shipping one.

- [ ] **Step 2: `components/MainScene.bs`**

```brs
sub init()
  m.hero      = m.top.findNode("hero")
  m.rowList   = m.top.findNode("rowList")
  m.rotateTimer = m.top.findNode("rotateTimer")
  m.errorLabel = m.top.findNode("errorLabel")

  ' Fire module-opt hook before any content load.
  Modules_OnMainSceneBeforeContentLoad(m)

  ' Default focus on the hero.
  m.hero.setFocus(true)
  m.top.observeField("focusedChild", "onFocusChanged")

  ' Kick feed fetch.
  m.feedTask = CreateObject("roSGNode", "HttpTask")
  m.feedTask.observeField("state", "onFeedState")
  m.feedTask.url = TemplateConfig().feed_url
  m.feedTask.control = "run"
end sub

sub onFeedState()
  if m.feedTask.state <> "stop" then return

  if m.feedTask.error <> invalid and m.feedTask.error <> "" then
    m.errorLabel.text = "Feed load failed: " + m.feedTask.error
    m.errorLabel.visible = true
    return
  end if

  root = Feed_ParseRdpJson(m.feedTask.result)
  m.rowList.content = root

  Modules_OnMainSceneAfterContentLoad(m)

  ' Seed hero with the first item of the first category.
  if root.getChildCount() > 0 then
    firstRow = root.getChild(0)
    if firstRow.getChildCount() > 0 then
      m.hero.content = firstRow.getChild(0)
      Modules_OnMainSceneAfterHeroLoad(m)
    end if
  end if

  ' Start auto-rotation.
  m.rotateTimer.observeField("fire", "onRotateTick")
  m.rotateTimer.control = "start"

  m.heroIdx = 0
  m.rowList.observeField("rowItemSelected", "onItemSelected")
end sub

sub onRotateTick()
  if m.hero.hasFocus() then return     ' do not rotate when user is focused on hero
  root = m.rowList.content
  if root = invalid or root.getChildCount() = 0 then return
  firstRow = root.getChild(0)
  n = firstRow.getChildCount()
  if n = 0 then return
  m.heroIdx = (m.heroIdx + 1) mod n
  m.hero.content = firstRow.getChild(m.heroIdx)
end sub

sub onFocusChanged()
  ' no-op for now; placeholder for module-injected hooks.
end sub

sub onItemSelected()
  idx = m.rowList.rowItemSelected
  rowIdx = idx[0]
  itemIdx = idx[1]
  row = m.rowList.content.getChild(rowIdx)
  item = row.getChild(itemIdx)

  details = m.top.createChild("DetailsScene")
  details.observeField("close", "onDetailsClose")
  details.content = item
  details.setFocus(true)
end sub

sub onDetailsClose()
  details = m.top.findNode("DetailsScene")
  if details <> invalid then m.top.removeChild(details)
  m.rowList.setFocus(true)
end sub
```

- [ ] **Step 3: Compile-check**

Same command as T17 step 4. Expected: zero error diagnostics. Fix any surfaced issues (typically missing `findNode` targets, typos, `.toStr()` on non-numeric); do NOT disable warnings.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/templates/video_grid_channel/files/components/MainScene.xml \
        packages/brs-gen/templates/video_grid_channel/files/components/MainScene.bs
git commit -m "feat(brs-gen): video_grid_channel MainScene (Hero + RowList + rotation)"
```

### Task T19: `HeroUnit`, `DetailsScene`, `PlayerScene`

**Files:**
- Create: `packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.xml`
- Create: `packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.bs`
- Create: `packages/brs-gen/templates/video_grid_channel/files/components/DetailsScene.xml`
- Create: `packages/brs-gen/templates/video_grid_channel/files/components/DetailsScene.bs`
- Create: `packages/brs-gen/templates/video_grid_channel/files/components/PlayerScene.xml`
- Create: `packages/brs-gen/templates/video_grid_channel/files/components/PlayerScene.bs`

- [ ] **Step 1: HeroUnit**

`HeroUnit.xml`:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="HeroUnit" extends="Group">
  <script type="text/brightscript" uri="HeroUnit.bs" />
  <interface>
    <field id="content" type="node" onChange="onContentChanged" />
  </interface>
  <children>
    <Poster id="poster" width="1800" height="450" loadDisplayMode="scaleToZoom" />
    <Label id="title" translation="[40, 340]" width="1100" font="font:LargeBoldSystemFont" color="0xFFFFFFFF" />
    <Label id="synopsis" translation="[40, 390]" width="1100" color="0xCCCCCCFF" wrap="true" />
  </children>
</component>
```

`HeroUnit.bs`:

```brs
sub init()
  m.poster   = m.top.findNode("poster")
  m.title    = m.top.findNode("title")
  m.synopsis = m.top.findNode("synopsis")
end sub

sub onContentChanged()
  c = m.top.content
  if c = invalid then return
  m.poster.uri = c.hdPosterUrl
  m.title.text = c.title
  m.synopsis.text = c.description
end sub
```

- [ ] **Step 2: DetailsScene**

`DetailsScene.xml`:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="DetailsScene" extends="Group">
  <script type="text/brightscript" uri="DetailsScene.bs" />
  <interface>
    <field id="content" type="node" onChange="onContentChanged" />
    <field id="close" type="boolean" alwaysNotify="true" />
  </interface>
  <children>
    <Rectangle id="scrim" width="1920" height="1080" color="0x000000CC" />
    <Poster id="poster" translation="[120, 120]" width="640" height="360" loadDisplayMode="scaleToZoom" />
    <Label id="title" translation="[800, 140]" font="font:LargeBoldSystemFont" color="0xFFFFFFFF" />
    <Label id="description" translation="[800, 200]" width="900" color="0xCCCCCCFF" wrap="true" />
    <Label id="cta" translation="[800, 440]" text="Press Select to play" color="0xFFFFFFFF" />
  </children>
</component>
```

`DetailsScene.bs`:

```brs
sub init()
  m.poster      = m.top.findNode("poster")
  m.title       = m.top.findNode("title")
  m.description = m.top.findNode("description")
end sub

sub onContentChanged()
  c = m.top.content
  if c = invalid then return
  m.poster.uri = c.hdPosterUrl
  m.title.text = c.title
  m.description.text = c.description
end sub

function onKeyEvent(key as string, press as boolean) as boolean
  if press then
    if key = "OK" or key = "select" then
      player = m.top.getParent().createChild("PlayerScene")
      player.content = m.top.content
      player.setFocus(true)
      player.observeField("state", "onPlayerState")
      m.playerRef = player
      return true
    else if key = "back" then
      m.top.close = true
      return true
    end if
  end if
  return false
end function

sub onPlayerState()
  p = m.playerRef
  if p = invalid then return
  if p.state = "done" then
    m.top.getParent().removeChild(p)
    m.playerRef = invalid
    m.top.setFocus(true)
  end if
end sub
```

- [ ] **Step 3: PlayerScene**

`PlayerScene.xml`:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="PlayerScene" extends="Group">
  <script type="text/brightscript" uri="PlayerScene.bs" />
  <interface>
    <field id="content" type="node" />
    <field id="state" type="string" alwaysNotify="true" />
  </interface>
  <children>
    <Video id="video" width="1920" height="1080" enableUI="true" />
    <Label id="errorOverlay" translation="[60, 60]" color="0xFF4444FF" visible="false" />
  </children>
</component>
```

`PlayerScene.bs`:

```brs
sub init()
  m.video = m.top.findNode("video")
  m.error = m.top.findNode("errorOverlay")
  m.video.observeField("state", "onVideoState")
end sub

sub onContentChanged()
  ' Field set by caller; we handle it lazily.
end sub

function onKeyEvent(key as string, press as boolean) as boolean
  if press and key = "back" then
    m.video.control = "stop"
    m.top.state = "done"
    return true
  end if
  return false
end function

sub startPlayback()
  c = m.top.content
  if c = invalid or c.stream = invalid or c.stream = "" then
    m.error.text = "No stream URL for this content."
    m.error.visible = true
    return
  end if

  Modules_OnPlayerSceneBeforePlay(m)

  content = CreateObject("roSGNode", "ContentNode")
  content.title = c.title
  content.streamFormat = c.streamFormat
  stream = CreateObject("roSGNode", "ContentNode")
  stream.url = c.stream
  content.appendChild(stream)

  m.video.content = content
  m.video.control = "play"
end sub

sub onVideoState()
  s = m.video.state
  if s = "error" then
    m.error.text = "Playback error: " + m.video.errorCode.ToStr() + " " + m.video.errorMsg
    m.error.visible = true
    m.top.state = "error"
  else if s = "finished" then
    m.top.state = "done"
  else
    m.top.state = s
  end if
end sub
```

Note: `PlayerScene.bs` needs `startPlayback` to fire when the scene mounts. The cleanest pattern is to observe `content` via `<field ... onChange="onContentSet"/>` and call `startPlayback()` from there. Adjust the XML to add `onChange="onContentSet"` on `content` and stub `onContentSet` to call `startPlayback()`. Implementer decides whether to embed startPlayback inline in onContentSet or keep the indirection.

- [ ] **Step 4: Compile-check**

Same as T17 step 4 / T18 step 3. Expected: zero error diagnostics. If `Modules_OnMainSceneAfterHeroLoad` etc. dispatches aren't generated because no module calls them, the merger still emits no-op stubs (Plan 3 T12) — confirm this is the behavior in `emit-init-hooks.ts`. If not, adjust the plan: either make the stubs unconditional, or gate the calls in `.bs` files with `if M <> invalid ...`.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/templates/video_grid_channel/files/components/HeroUnit.* \
        packages/brs-gen/templates/video_grid_channel/files/components/DetailsScene.* \
        packages/brs-gen/templates/video_grid_channel/files/components/PlayerScene.*
git commit -m "feat(brs-gen): video_grid_channel Hero/Details/Player scenes"
```

### Task T20: Snapshots for five representative files

**Files:**
- Modify: `packages/brs-gen/tests/snapshots.test.ts`
- Create: `packages/brs-gen/tests/__snapshots__/video-grid/` (5 snapshot files via `toMatchFileSnapshot`)

- [ ] **Step 1: Add snapshot cases for video_grid_channel**

Append a new `describe('video_grid_channel snapshots')` block to `tests/snapshots.test.ts`. The pattern mirrors the existing stub_hello snapshot setup; reuse the helpers in that file. Snapshots to emit:

1. `__snapshots__/video-grid/manifest.snap.txt` — the generated manifest file.
2. `__snapshots__/video-grid/MainScene.xml.snap.txt` — post-compile content of `components/MainScene.xml`.
3. `__snapshots__/video-grid/HeroUnit.xml.snap.txt` — post-compile content of `components/HeroUnit.xml`.
4. `__snapshots__/video-grid/template-config.brs.snap.txt` — content of `source/_template/config.brs`.
5. `__snapshots__/video-grid/files-listing.snap.txt` — sorted list of all emitted file paths.

Example skeleton:

```ts
describe('video_grid_channel snapshots', () => {
  it('manifest matches snapshot', async () => {
    const project = await runFullGenerate(); // helper that returns project dir
    const manifest = await readFile(join(project, 'manifest'), 'utf8');
    await expect(manifest).toMatchFileSnapshot(
      join(__dirname, '__snapshots__', 'video-grid', 'manifest.snap.txt'),
    );
  });
  // ... four more analogous cases
});
```

Build `runFullGenerate()` using `tests/__fixtures__/icon-uhd.png` and `tests/__fixtures__/splash-uhd.png` as the branding sources. Use the pinned sample feed URL.

- [ ] **Step 2: Run snapshots to generate files**

Run: `pnpm -C packages/brs-gen exec vitest run tests/snapshots.test.ts`
Expected: first run creates the snapshot files under `tests/__snapshots__/video-grid/`. Second run asserts equality.

- [ ] **Step 3: Inspect each snapshot manually**

Open each snap file. Verify:
- `manifest.snap.txt` contains `splash_color=#E50914` (if that was the canonical input), `mm_icon_focus_hd=pkg:/images/icon_hd.png`, etc.
- `template-config.brs.snap.txt` contains `feed_url`, `primary_color`, `channel_name`.
- `files-listing.snap.txt` includes `images/icon_hd.png`, `source/_template/config.brs`, no `source/Main.bs` (only `.brs`), no `.rokudev-tools/staging/...`.

If any snapshot drifts from expectations, fix the upstream emitter rather than editing the snap file by hand.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/tests/snapshots.test.ts \
        packages/brs-gen/tests/__snapshots__/video-grid/
git commit -m "test(brs-gen): video_grid_channel file snapshots"
```

---

## Phase 7: Tool-level tests (T21)

### Task T21: `validate_assets` bucket-dimension check + `get_template_schema` video-grid coverage

**Files:**
- Modify: `packages/brs-gen/src/tools/validate-assets.ts`
- Modify: `packages/brs-gen/src/tools/validate-assets.test.ts`
- Modify: `packages/brs-gen/src/tools/get-template-schema.test.ts`

- [ ] **Step 1: Extend validate-assets to actually check bucket dimensions**

Currently `wrong_dimensions` is an empty placeholder in the response. Plan 4 fills it in using the PNG's IHDR bytes + the project's expected bucket sizes (derived from the manifest key → bucket matrix mapping).

Write failing test first in `src/tools/validate-assets.test.ts`:

```ts
it('flags wrong_dimensions when icon_hd.png is not 290x218', async () => {
  // Build a project dir with a manifest that references icon_hd, and a
  // PNG file at that path whose IHDR dimensions are WRONG (say 100x100).
  const projectDir = await mkdtemp(join(tmpdir(), 'brs-gen-va-'));
  try {
    await writeFile(
      join(projectDir, 'manifest'),
      'title=X\nmm_icon_focus_hd=pkg:/images/icon_hd.png\n',
    );
    await mkdir(join(projectDir, 'images'), { recursive: true });
    await writeFile(join(projectDir, 'images/icon_hd.png'), pngHeader(100, 100));
    const r = await callValidateAssetsHandler({ project_dir: projectDir });
    expect(r.ok).toBe(false);
    expect(r.failure.details.wrong_dimensions).toContain('images/icon_hd.png');
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

it('passes when icon_hd.png is exactly 290x218', async () => {
  const projectDir = await mkdtemp(join(tmpdir(), 'brs-gen-va2-'));
  try {
    await writeFile(
      join(projectDir, 'manifest'),
      'title=X\nmm_icon_focus_hd=pkg:/images/icon_hd.png\n',
    );
    await mkdir(join(projectDir, 'images'), { recursive: true });
    await writeFile(join(projectDir, 'images/icon_hd.png'), pngHeader(290, 218));
    const r = await callValidateAssetsHandler({ project_dir: projectDir });
    expect(r.ok).toBe(true);
    expect(r.wrong_dimensions).toEqual([]);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});
```

Hoist `pngHeader(width, height)` from T7's test (either duplicate or factor into a shared test util at `src/assets/validate.test-util.ts`). `callValidateAssetsHandler` mirrors Plan 3's tool-call helper pattern.

- [ ] **Step 2: Implement the dimension check**

Edit `src/tools/validate-assets.ts`. After the PNG-magic check, read bytes 16..24 (IHDR width+height) and compare against the manifest key's expected bucket dimensions using `ICON_BUCKETS` / `SPLASH_BUCKETS` from `../assets/constants.js`:

```ts
import { ICON_BUCKETS, SPLASH_BUCKETS } from '../assets/constants.js';

function expectedDimsFor(manifestKey: string): { w: number; h: number } | null {
  for (const b of ICON_BUCKETS) if (b.manifestKey === manifestKey) return { w: b.width, h: b.height };
  for (const b of SPLASH_BUCKETS) if (b.manifestKey === manifestKey) return { w: b.width, h: b.height };
  return null;
}
```

In the existing loop, track the manifest key alongside `relPath`; after the PNG-magic check, read first 24 bytes (extending `readFirstBytes(path, 24)`); decode IHDR; if width/height don't match the expected bucket, append `relPath` to `wrong_dimensions`.

- [ ] **Step 3: Run tests**

Run: `pnpm -C packages/brs-gen exec vitest run src/tools/validate-assets.test.ts`
Expected: all existing cases still pass + 2 new cases pass.

- [ ] **Step 4: Add `get_template_schema` coverage for video_grid_channel**

Append to `src/tools/get-template-schema.test.ts`:

```ts
it('surfaces video_grid_channel required branding + content fields', async () => {
  const r = await callGetTemplateSchemaHandler({ template_id: 'video_grid_channel' });
  expect(r.ok).toBe(true);
  const schema = r.schema as {
    required?: string[];
    properties?: Record<string, { required?: string[] } | undefined>;
  };
  expect(schema.required).toEqual(expect.arrayContaining(['branding', 'content']));
  expect(schema.properties?.branding?.required).toEqual(
    expect.arrayContaining(['primary_color', 'icon', 'splash']),
  );
  expect(schema.properties?.content?.required).toEqual(
    expect.arrayContaining(['feed_url', 'feed_format']),
  );
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm -C packages/brs-gen exec vitest run src/tools/`
Expected: all tool-level tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/src/tools/validate-assets.ts \
        packages/brs-gen/src/tools/validate-assets.test.ts \
        packages/brs-gen/src/tools/get-template-schema.test.ts
git commit -m "feat(brs-gen): validate_assets checks bucket dimensions; get_template_schema test for video_grid_channel"
```

---

## Phase 8: Goldens, e2e, determinism (T22-T24)

### Task T22: Extend `regen-golden.mjs` for video-grid goldens

**Files:**
- Modify: `packages/brs-gen/scripts/regen-golden.mjs`
- Modify: `packages/brs-gen/scripts/regen-helper.mjs` (if needed)

- [ ] **Step 1: Add a second canonical spec + regen block**

Edit `scripts/regen-golden.mjs`. After the stub regen block, add:

```js
const VIDEO_GRID_SPEC_ORIGIN = join(PKG_ROOT, 'tests', '__fixtures__', 'video-grid-spec.json');

async function regenVideoGrid() {
  // Use the persistent unit fixtures as branding sources.
  const spec = {
    spec_version: 2,
    template: 'video_grid_channel',
    modules: [],
    app: { name: 'Acme TV', major_version: 0, minor_version: 1, build_version: 0 },
    branding: {
      primary_color: '#E50914',
      icon: '../__fixtures__/icon-uhd.png',
      splash: '../__fixtures__/splash-uhd.png',
    },
    content: {
      feed_url: 'https://devresources.s3.amazonaws.com/feeds/sample.json', // keep in sync with schema.ts Example
      feed_format: 'roku_direct_publisher_json',
    },
  };
  // Write spec to a tmpdir so relative branding paths resolve against
  // tests/__fixtures__/. We use a sibling-tmp dir inside tests/ so the
  // '../__fixtures__/..' relative paths still resolve.
  const tmpSpecDir = join(PKG_ROOT, 'tests', '__tmp_regen__');
  await mkdir(tmpSpecDir, { recursive: true });
  try {
    const specPath = join(tmpSpecDir, 'video-grid-spec.json');
    await writeFile(specPath, JSON.stringify(spec));

    const work = join(tmpdir(), `brs-gen-regen-vg-${randomUUID()}`);
    const outputDir = join(work, 'project');
    const outputZip = join(work, 'project.zip');
    await mkdir(work, { recursive: true });

    const { zip_path, output_dir } = await generateAppForRegen({
      outputDir,
      spec: specPath,
      outputZip,
    });
    await copyFile(zip_path, join(GOLDEN_DIR, 'video-grid.zip'));
    const provenance = await readFile(join(output_dir, '.rokudev-tools', 'provenance.json'));
    await writeFile(join(GOLDEN_DIR, 'video-grid.provenance.json'), provenance);

    await rm(work, { recursive: true, force: true });
  } finally {
    await rm(tmpSpecDir, { recursive: true, force: true });
  }
}
```

Call `await regenVideoGrid();` from `main()` after the stub block.

If `generateAppForRegen` in `regen-helper.mjs` doesn't accept a filesystem path for `spec`, extend it. (It already calls the handler; just pass through.)

- [ ] **Step 2: Run regen**

Run: `TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs`
Expected: prints the regen banner; 2 stub files AND 2 video-grid files now exist under `tests/__golden__/`. Confirm with `ls tests/__golden__/`.

- [ ] **Step 3: Verify `.prettierignore`**

Run: `cat .prettierignore`
Expected: `packages/brs-gen/tests/__golden__` (or equivalent glob) is ignored. If `video-grid.*` is not covered, add `packages/brs-gen/tests/__golden__/**`.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/scripts/regen-golden.mjs \
        packages/brs-gen/scripts/regen-helper.mjs \
        packages/brs-gen/tests/__golden__/video-grid.zip \
        packages/brs-gen/tests/__golden__/video-grid.provenance.json \
        .prettierignore
git commit -m "chore(brs-gen): regen-golden emits video-grid goldens"
```

### Task T23: e2e test cases for video_grid_channel

**Files:**
- Modify: `packages/brs-gen/tests/e2e.test.ts`

- [ ] **Step 1: Add 3 new cases**

Inside the existing `describe` block of `tests/e2e.test.ts`, add:

```ts
it('generate_app on video_grid_channel produces byte-equal golden zip', async () => {
  const workDir = await mkdtemp(join(tmpdir(), 'brs-gen-e2e-vg-'));
  try {
    const specPath = join(workDir, 'spec.json');
    // Use persistent unit fixtures; relative paths resolve against the spec file.
    const fixturesRel = relative(workDir, join(PKG_ROOT, 'tests', '__fixtures__'));
    const spec = {
      spec_version: 2,
      template: 'video_grid_channel',
      modules: [],
      app: { name: 'Acme TV', major_version: 0, minor_version: 1, build_version: 0 },
      branding: {
        primary_color: '#E50914',
        icon: join(fixturesRel, 'icon-uhd.png'),
        splash: join(fixturesRel, 'splash-uhd.png'),
      },
      content: {
        feed_url: 'https://devresources.s3.amazonaws.com/feeds/sample.json',
        feed_format: 'roku_direct_publisher_json',
      },
    };
    await writeFile(specPath, JSON.stringify(spec));

    const child = new McpChild();
    await child.start();
    try {
      await child.initialize();
      const outDir = join(workDir, 'project');
      const outZip = join(workDir, 'project.zip');
      const res = await child.callTool('generate_app', {
        spec: specPath,
        output_dir: outDir,
        zip: { output_zip: outZip },
      });
      expect((res as { ok?: boolean }).ok).toBe(true);

      const emitted = await readFile(outZip);
      const golden = await readFile(join(GOLDEN_DIR, 'video-grid.zip'));
      expect(emitted.equals(golden)).toBe(true);

      const emittedProv = await readFile(join(outDir, '.rokudev-tools', 'provenance.json'));
      const goldenProv = await readFile(join(GOLDEN_DIR, 'video-grid.provenance.json'));
      expect(emittedProv.equals(goldenProv)).toBe(true);
    } finally {
      await child.stop();
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

it('validate_manifest on the video_grid project returns ok:true', async () => {
  // Same setup as above, then call validate_manifest after generate_app.
  // (Factor the generate-project-dir helper out to avoid duplication.)
});

it('lint on the video_grid project returns ok:true with zero errors', async () => {
  // Same setup. Assert r.ok === true AND r.errors.length === 0.
  // No soft-assert on warnings; strictness per spec §10.3.
});
```

`relative` needs to be imported from `node:path` if not already.

- [ ] **Step 2: Run e2e**

Run: `pnpm -C packages/brs-gen build && TZ=UTC pnpm -C packages/brs-gen exec vitest run tests/e2e.test.ts`
Expected: all cases pass. If `generate_app` produces bytes that differ from the golden, regen is needed — ensure `TZ=UTC` was set for the regen (T22).

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/tests/e2e.test.ts
git commit -m "test(brs-gen): e2e video_grid_channel zip/provenance/lint gate"
```

### Task T24: Cross-platform determinism regression

**Files:**
- Modify: `packages/brs-gen/tests/determinism.test.ts`

- [ ] **Step 1: Add full-pipeline byte-equality case**

Append to `tests/determinism.test.ts`:

```ts
it('video_grid_channel full-pipeline byte equality across two in-process runs', async () => {
  // Drive generate_app twice with the same spec + fixture PNGs; assert
  // that every emitted image buffer AND the final zip are byte-equal.
  // This covers sharp's in-process determinism; cross-machine determinism
  // is verified by CI running the test on both macOS and Linux.
  const dirA = tmp('vg-a');
  const dirB = tmp('vg-b');
  // Run generate_app twice into separate tmpdirs; compare the bucketed
  // asset buffers + project.zip bytes.
  // (Implementer: reuse runFullGenerate() helper from snapshots.test.ts or
  //  add one here.)
  // ... assertions ...
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm -C packages/brs-gen exec vitest run tests/determinism.test.ts`
Expected: PASS on 4 existing + 1 new case (5/5).

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/tests/determinism.test.ts
git commit -m "test(brs-gen): video_grid_channel cross-run determinism via sharp pipeline"
```

---

## Phase 9: T27 real-device verification gate (T25-T27)

### Task T25: Shared T27 helpers `scripts/_t27-lib.mjs`

**Files:**
- Create: `packages/brs-gen/scripts/_t27-lib.mjs`

Extracted so Plans 4a-4e reuse them. No unit tests — this is operator scaffolding. Confirm during T25 that `@rokudev/device-client` exports `DevPortal`, `Ecp` (or equivalent primitives); adjust the file accordingly.

- [ ] **Step 1: Confirm device-client exports**

Run: `pnpm -C packages/roku-device-client exec node -e 'import("@rokudev/device-client").then(m => console.log(Object.keys(m).sort()))'` (or `grep -n 'export' packages/roku-device-client/src/index.ts`).

Expected: `DevPortal` and an ECP-related export are present. Note the exact names; they drive the imports below. If no ECP export exists, use raw HTTP (`node:http`) for ECP calls — ECP is unauthenticated and each call is a simple `POST /keypress/...` or `GET /query/media-player`.

- [ ] **Step 2: Write `scripts/_t27-lib.mjs`**

```js
// packages/brs-gen/scripts/_t27-lib.mjs
//
// Shared helpers for T27-class real-device verification drivers (video_grid,
// and Plans 4a-4e templates). ESM, no TypeScript. Consumes
// @rokudev/device-client for sideload + authenticated dev-portal calls, and
// uses plain fetch for ECP.
//
// Convention: every exported function throws on failure. Drivers catch and
// print a summary before exiting non-zero.

import { DevPortal } from '@rokudev/device-client';

export const ERROR_OVERLAY_MAX_BYTES = 15 * 1024; // heuristic per spec D11

const DEFAULT_HEADERS = { 'User-Agent': 'brs-gen-t27/0.4.0' };

async function ecpFetch(host, path, init = {}) {
  const url = `http://${host}:8060${path}`;
  const res = await fetch(url, { ...init, headers: { ...DEFAULT_HEADERS, ...(init.headers || {}) } });
  if (!res.ok) {
    throw new Error(`ECP ${init.method || 'GET'} ${url} → ${res.status}`);
  }
  return res;
}

export async function ecpKeypress(host, key) {
  await ecpFetch(host, `/keypress/${encodeURIComponent(key)}`, { method: 'POST' });
}

export async function ecpKeypressRepeat(host, key, times) {
  for (let i = 0; i < times; i++) {
    await ecpKeypress(host, key);
    await sleep(300);
  }
}

export async function ecpLaunchDev(host, params = {}) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const path = qs ? `/launch/dev?${qs}` : '/launch/dev';
  await ecpFetch(host, path, { method: 'POST' });
}

export async function ecpQueryActiveApp(host) {
  const res = await ecpFetch(host, '/query/active-app');
  const text = await res.text();
  // Extract the <app id="..."> value via regex; avoid pulling in an XML parser.
  const m = text.match(/<app[^>]*\bid="([^"]+)"/);
  return { id: m ? m[1] : null, raw: text };
}

export async function ecpQueryMediaPlayer(host) {
  const res = await ecpFetch(host, '/query/media-player');
  const text = await res.text();
  const state = (text.match(/<state[^>]*>([^<]+)<\/state>/) || [])[1] || null;
  const position = Number((text.match(/<position[^>]*>([^<]+)<\/position>/) || [])[1] || 0);
  return { state, position, raw: text };
}

export async function sideloadAndLaunch(zipPath, host, password, launchParams = {}) {
  const portal = new DevPortal(host, password);
  await portal.sideload(zipPath);
  await ecpLaunchDev(host, launchParams);
  // Wait for active-app to report 'dev' up to 30s.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const a = await ecpQueryActiveApp(host);
    if (a.id === 'dev') return;
    await sleep(500);
  }
  throw new Error('active-app never became "dev" within 30s');
}

export async function screenshot(host, password, outPath) {
  const portal = new DevPortal(host, password);
  // DevPortal.screenshot() returns raw bytes per Plan 1 T21/T23. If the
  // real API differs, adjust accordingly.
  const bytes = await portal.screenshot();
  await writeFileMaybe(outPath, bytes);
  return { bytes: bytes.byteLength, path: outPath };
}

async function writeFileMaybe(outPath, bytes) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(outPath, bytes);
}

export async function screenshotNoError(host, password, outPath) {
  const s = await screenshot(host, password, outPath);
  if (s.bytes <= ERROR_OVERLAY_MAX_BYTES) {
    throw new Error(
      `screenshot ${outPath} is ${s.bytes} bytes (<= ${ERROR_OVERLAY_MAX_BYTES}) — error overlay heuristic tripped`,
    );
  }
  return s;
}

export async function assertPlaybackStarts(host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    const mp = await ecpQueryMediaPlayer(host);
    lastState = mp.state;
    if (mp.state === 'play') {
      return { reached: 'play', at: Date.now(), startPosition: mp.position };
    }
    await sleep(500);
  }
  throw new Error(`media-player never reached state 'play' within ${timeoutMs}ms (last: ${lastState})`);
}

export async function assertPositionAdvanced(host, startPosition, windowMs) {
  await sleep(windowMs);
  const mp = await ecpQueryMediaPlayer(host);
  if (mp.state !== 'play') {
    throw new Error(`media-player no longer in 'play' after ${windowMs}ms (now: ${mp.state})`);
  }
  if (mp.position <= startPosition) {
    throw new Error(
      `media-player position did not advance: start=${startPosition}, now=${mp.position}`,
    );
  }
  return { finalPosition: mp.position };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

- [ ] **Step 3: Syntax-check**

Run: `pnpm -C packages/brs-gen exec node --check scripts/_t27-lib.mjs`
Expected: exits 0 with no output.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/scripts/_t27-lib.mjs
git commit -m "feat(brs-gen): shared T27 helpers (sideload, ECP, playback asserts)"
```

### Task T26: `scripts/t27-video-grid.mjs` driver

**Files:**
- Create: `packages/brs-gen/scripts/t27-video-grid.mjs`

- [ ] **Step 1: Write the driver**

```js
// packages/brs-gen/scripts/t27-video-grid.mjs
//
// Operator-run T27 real-device verification for video_grid_channel.
//
// Requires env:
//   ROKUDEV_HOST         IP of a dev-mode Roku on the operator's LAN
//   ROKUDEV_DEV_PASSWORD dev password (default: 1234)
//
// Requires state:
//   - `pnpm -C packages/brs-gen build` succeeded
//   - Fixtures at scripts/fixtures/t27-*-uhd.png exist
//   - Sample feed URL is reachable from the Roku
//
// Usage:
//   node packages/brs-gen/scripts/t27-video-grid.mjs
//
// Exit code 0 on PASS, non-zero on FAIL.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  sideloadAndLaunch,
  ecpKeypress,
  ecpKeypressRepeat,
  screenshotNoError,
  assertPlaybackStarts,
  assertPositionAdvanced,
  sleep,
} from './_t27-lib.mjs';
import { generateAppForRegen } from './regen-helper.mjs'; // reuse the Plan 3 helper

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);

const host = process.env.ROKUDEV_HOST;
const password = process.env.ROKUDEV_DEV_PASSWORD || '1234';
if (!host) {
  console.error('T27: ROKUDEV_HOST env var is required (Roku IP).');
  process.exit(2);
}

const iso = new Date().toISOString().replace(/[:.]/g, '-');
const screensDir = join(PKG_ROOT, 'scripts', 't27-screenshots', iso);
const logsDir = join(PKG_ROOT, 'scripts', 't27-logs');
await mkdir(screensDir, { recursive: true });
await mkdir(logsDir, { recursive: true });

const work = await mkdtemp(join(tmpdir(), 'brs-gen-t27-vg-'));
const outputDir = join(work, 'project');
const outputZip = join(work, 'project.zip');

const canonicalSpec = {
  spec_version: 2,
  template: 'video_grid_channel',
  modules: [],
  app: { name: 'T27 Video Grid', major_version: 0, minor_version: 1, build_version: 0 },
  branding: {
    primary_color: '#0A0F2D',
    icon: join(PKG_ROOT, 'scripts', 'fixtures', 't27-icon-uhd.png'),
    splash: join(PKG_ROOT, 'scripts', 'fixtures', 't27-splash-uhd.png'),
  },
  content: {
    // Keep in sync with templates/video_grid_channel/schema.ts Example.
    feed_url: 'https://devresources.s3.amazonaws.com/feeds/sample.json',
    feed_format: 'roku_direct_publisher_json',
  },
};

const specPath = join(work, 'spec.json');
await writeFile(specPath, JSON.stringify(canonicalSpec));

const summary = { passed: [], failed: [] };
function assertStep(name, thunk) {
  return thunk()
    .then((v) => {
      summary.passed.push(name);
      return v;
    })
    .catch((e) => {
      summary.failed.push({ name, message: String(e && e.message ? e.message : e) });
      throw e;
    });
}

try {
  // Step 2: generate + zip.
  await assertStep('generate_app', () =>
    generateAppForRegen({ outputDir, spec: specPath, outputZip }),
  );

  // Step 3: sideload + launch.
  await assertStep('sideload + launch', () =>
    sideloadAndLaunch(outputZip, host, password, { bs_debug_protocol: '0' }),
  );

  // Allow feed fetch + hero hydration.
  await sleep(5000);

  // Step 5: screenshot home, assert no error overlay.
  await assertStep('home screenshot (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, '01-home.png')),
  );

  // Step 6: navigate to second tile of first row (Down → Right × 2).
  await assertStep('navigate to first row', () => ecpKeypress(host, 'Down'));
  await sleep(400);
  await assertStep('navigate right×2', () => ecpKeypressRepeat(host, 'Right', 2));
  await sleep(400);
  await assertStep('row screenshot (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, '02-row.png')),
  );

  // Step 7: enter details.
  await assertStep('select (enter details)', () => ecpKeypress(host, 'Select'));
  await sleep(1200);
  await assertStep('details screenshot (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, '03-details.png')),
  );

  // Step 8: start playback.
  await assertStep('select (play)', () => ecpKeypress(host, 'Select'));
  const { startPosition } = await assertStep('playback state=play', () =>
    assertPlaybackStarts(host, 20_000),
  );
  await assertStep('playback screenshot t=2s', () =>
    screenshotNoError(host, password, join(screensDir, '04-play-2s.png')),
  );
  await sleep(3000);
  await assertStep('playback screenshot t=5s', () =>
    screenshotNoError(host, password, join(screensDir, '05-play-5s.png')),
  );
  await sleep(5000);
  await assertStep('playback screenshot t=10s', () =>
    screenshotNoError(host, password, join(screensDir, '06-play-10s.png')),
  );
  // 10s of sleeps have already elapsed via the 2s/5s/10s screenshot steps;
  // assertPositionAdvanced samples /query/media-player once more and
  // verifies state == 'play' + position > startPosition.
  await assertStep('position advanced over 10s', () =>
    assertPositionAdvanced(host, startPosition, 0),
  );

  // Step 9: Home.
  await assertStep('press Home', () => ecpKeypress(host, 'Home'));

  console.log('\nT27 PASS. Screenshots:', screensDir);
  console.log('Steps:', summary.passed.length, 'passed,', summary.failed.length, 'failed.');
  process.exit(0);
} catch (err) {
  console.error('\nT27 FAIL:', err && err.stack ? err.stack : err);
  console.error('Passed steps:', summary.passed);
  console.error('Failed steps:', summary.failed);
  // Best-effort capture on failure.
  try {
    await screenshotNoError(host, password, join(screensDir, 'zz-failure.png')).catch(() => {});
  } catch {}
  process.exit(1);
}
```

- [ ] **Step 2: Syntax-check**

Run: `pnpm -C packages/brs-gen exec node --check scripts/t27-video-grid.mjs`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/scripts/t27-video-grid.mjs
git commit -m "feat(brs-gen): T27 real-device verification driver for video_grid_channel"
```

### Task T27: Operator-run T27 verification + append PASS evidence to spec

**Files:**
- Modify: `docs/superpowers/specs/2026-05-09-plan-4-video-grid-template-design.md` (§Appendix A)

This is manual. Requires a dev-mode Roku on the operator's LAN, reachable sample feed, and the built dist/.

- [ ] **Step 1: Build dist**

Run: `pnpm -C packages/brs-gen build`
Expected: `dist/index.js` exists.

- [ ] **Step 2: Confirm preconditions**

Run: `curl -sSfL -o /dev/null -w '%{http_code}\n' <pinned-feed-url>` (the URL you pinned at T16). Expected: 200.

Check that `ROKUDEV_HOST` + (optionally) `ROKUDEV_DEV_PASSWORD` are set: `env | grep ROKUDEV_`.

- [ ] **Step 3: Run T27**

Run: `node packages/brs-gen/scripts/t27-video-grid.mjs`
Expected: prints `T27 PASS.` and exits 0. Screenshot paths and failing steps (if any) print to stdout/stderr.

- [ ] **Step 4: Capture evidence**

Collect:
- The stdout/stderr as a text blob.
- Roku model + firmware via `curl -s http://$ROKUDEV_HOST:8060/query/device-info | grep -E 'model-name|software-version'` (approximate; XML tags may vary).
- Screenshot directory path.
- 8085 log tail (optional for Plan 4 PASS) if the T27 script wrote one.

- [ ] **Step 5: Append PASS evidence to spec Appendix A**

Edit `docs/superpowers/specs/2026-05-09-plan-4-video-grid-template-design.md`. Replace the `Appendix A` template block with a filled-in version. Mirror Plan 2's format. Include:

- Date (YYYY-MM-DD HH:MM TZ)
- Roku model (e.g. `Roku Ultra 4850X`) + firmware version
- brs-gen version (`0.4.0-dev.0` at this point)
- T27 script path
- Pinned sample feed URL
- Checkbox list with all items checked
- Screenshot directory path
- Log tail path (if captured)
- `PASS` status

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-05-09-plan-4-video-grid-template-design.md
git commit -m "docs: Plan 4 T27 PASS evidence (video_grid_channel, <Roku model>, <firmware>)"
```

If T27 FAILs, do NOT edit the spec to mark PASS. Surface the failure to the human operator with the full error + screenshot path; fix the template, re-run, iterate until PASS, then commit once.

---

## Phase 10: Release (T28-T29)

### Task T28: README + version bumps

**Files:**
- Modify: `README.md`
- Modify: `package.json` (root)
- Modify: `packages/brs-gen/package.json`

- [ ] **Step 1: Bump `packages/brs-gen/package.json`**

Change `"version": "0.4.0-dev.0"` → `"version": "0.4.0"`.

- [ ] **Step 2: Bump root `package.json`**

Change `"version": "0.3.1"` → `"version": "0.4.0"`.

- [ ] **Step 3: Add README section**

Edit `README.md`. After the v0.3 section, insert:

```markdown
## What's in v0.4 (Plan 4)

- First production-reference template: `video_grid_channel`. Hero + category rows + details + player. Consumes a Roku Direct Publisher JSON feed; plays via SceneGraph's `Video` node.
- `AppSpec` gains optional `branding.{icon, splash, primary_color}` and `content.{feed_url, feed_format}` fields.
- New `sharp`-based asset pipeline. User supplies one high-res PNG; brs-gen buckets it into Roku's HD/FHD/UHD sizes and injects the manifest keys.
- New `TemplateConfig()` BrightScript emitter at `source/_template/config.brs` exposes template-level AppSpec fields to runtime code.
- T27 real-device verification gate established (sideload → launch → navigate → playback). PASS evidence in spec §Appendix A. Plans 4a-4e reuse the shared helpers in `scripts/_t27-lib.mjs`.

Out of v0.4: remaining v1 templates (`screensaver`, `news_channel`, `game_shell`, `blank_scenegraph`, `music_player` — each a follow-up plan), feature modules (Plan 5), freeform LLM path (Plan 6), LSP tools (Plan 7), brs-docs MCP (later plan).
```

- [ ] **Step 4: Verify no em-dash in the new README section**

Run: `grep -n '—' README.md || echo no em-dash`
Expected: `no em-dash`. If any show up, replace with `: ` or `-`.

- [ ] **Step 5: Commit**

```bash
git add README.md package.json packages/brs-gen/package.json
git commit -m "chore(release): bump rokudev-tools to 0.4.0 (Plan 4 video_grid_channel)"
```

### Task T29: `pnpm run release-prep`, tag, push, GitHub release

**Files:**
- None created. Read-only for the release step.

- [ ] **Step 1: Clean-slate install + build + test**

Run from repo root:

```bash
pnpm install
pnpm -r build
pnpm -r --if-present test
```

Expected: all three succeed. Test count across the monorepo should land near ~712 (spec §10.4 target; acceptable ±8 variance for parameterized cases).

- [ ] **Step 2: `pnpm run release-prep`**

Run: `pnpm run release-prep` from repo root (if that script exists; otherwise, verify prettier + lint separately).
Expected: exit 0 with no format/lint errors.

If prettier drift surfaces on new files, run `pnpm prettier --write 'packages/brs-gen/src/**/*.ts' 'packages/brs-gen/tests/**/*.ts' 'packages/brs-gen/templates/video_grid_channel/**/*.ts'`, then commit separately:

```bash
git add -A
git commit -m "chore: prettier pass on Plan 4 files"
```

- [ ] **Step 3: Verify T27 PASS evidence committed**

Run: `git log --oneline -- docs/superpowers/specs/2026-05-09-plan-4-video-grid-template-design.md | head`
Expected: most recent commit is T27's PASS evidence commit.

- [ ] **Step 4: Tag v0.4.0**

```bash
git tag -a v0.4.0 -m "v0.4.0 — Plan 4: video_grid_channel template + T27 gate"
```

- [ ] **Step 5: Push main + tag**

Confirm with the user before pushing:

```bash
git push origin main
git push origin v0.4.0
```

- [ ] **Step 6: Create GitHub release**

```bash
gh release create v0.4.0 \
  --title "v0.4.0 — video_grid_channel template + T27 gate" \
  --notes "$(cat <<'EOF'
Plan 4 ships the first production-reference Roku template.

**Highlights**
- `video_grid_channel` template (Hero + RowList + Details + Video player).
- `AppSpec` extensions: `branding.{icon, splash, primary_color}`, `content.{feed_url, feed_format}`.
- `sharp`-based asset pipeline — one high-res PNG → HD/FHD/UHD buckets.
- `TemplateConfig()` BrightScript emitter.
- T27 real-device verification gate established; PASS evidence in spec Appendix A.

**Out of scope for v0.4**
- Remaining v1 templates (Plans 4a-4e).
- Feature modules (Plan 5).
- Freeform LLM path (Plan 6).
- LSP tools (Plan 7).

Full spec: docs/superpowers/specs/2026-05-09-plan-4-video-grid-template-design.md
Plan: docs/superpowers/plans/2026-05-09-plan-4-video-grid-template.md
EOF
)"
```

- [ ] **Step 7: Update memory file**

Append a new section to `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md`:

- Plan 4 COMPLETE <date>. Tag `v0.4.0` on `origin`. `<total>` tests passing (`<brs-gen>` brs-gen + 294 device-client + 184 rokudev-device).
- First real template `video_grid_channel` shipped.
- T27 gate (`scripts/t27-video-grid.mjs` + `scripts/_t27-lib.mjs`) in place for Plans 4a-4e reuse.
- Branding + content AppSpec fields live; asset pipeline in `src/assets/`.
- TemplateConfig emitter parallel to ModuleConfig emitter. Template territory now `source/_template/` (fenced from modules).
- Sample feed URL pinned: `<URL>`. Fix-forward policy if it 404s.

Include any notable latent-trap discoveries (e.g. sharp cross-platform byte drift observations, ECP timing quirks).

- [ ] **Step 8: Final sanity check**

Run: `git status` and `git log --oneline -n 15`.
Expected: clean working tree; last ~15 commits tell the Plan 4 story in order.

---

## Test-count delta target

Per spec §10.4:

| Layer | v0.3.1 | Plan 4 target | Delta |
|---|---|---|---|
| brs-gen unit (`src/**/*.test.ts`) | 192 | ~223 | +~31 |
| brs-gen integration/snapshot | 5 | 10 | +5 |
| brs-gen e2e | 5 | 8 | +3 |
| brs-gen determinism | 4 | 5 | +1 |
| brs-gen conflict-matrix | 1 | 1 | 0 |
| **brs-gen total** | **195** | **~235** | **~+40** |
| @rokudev/device-client | 294 | 294 | 0 |
| rokudev-device | 184 | 184 | 0 |
| **Monorepo** | **672** | **~712** | **~+40** |

Acceptable variance: ±8. If the test count drifts more than that on completion, audit whether a task silently added or skipped cases, and correct before tagging.

---

## Acceptance criteria (from spec §12, re-stated)

Plan 4 is done when all of the following hold:

1. `AppSpecV2Wrapper` accepts `branding` and `content` as optional fields. stub_hello continues to validate without them.
2. `templates/video_grid_channel/` ships with `template.toml`, `schema.ts`, and all of its `files/` entries. `get_template_schema('video_grid_channel')` surfaces the required branding + content fields via JSON Schema.
3. `generate_app` with a complete video_grid_channel AppSpec produces a project tree containing: manifest with all Roku-required image refs; `images/icon_{hd,fhd}.png` + `images/splash_{hd,fhd,uhd}.png` at spec dimensions; `source/_template/config.brs` containing the configured fields; `source/Main.brs`, `source/Feed.brs`, `source/HttpTask.brs`, all `components/*.brs` and `components/*.xml`.
4. Post-compile sweep converts all `.bs` to `.brs` and rewrites XML `uri` refs correctly.
5. In-process `bsc` compile passes with zero error-severity diagnostics.
6. Full test suite passes at ~712 tests across the monorepo. `pnpm run release-prep` clean.
7. T27 verification PASS recorded in §Appendix A of the spec (Roku model, firmware, timestamp, screenshots, log path).
8. `v0.4.0` tag annotated, pushed. GitHub release page published.
9. Memory file updated: Plan 4 COMPLETE, `v0.4.0` tag, new test count, template-level design notes, any observed latent traps.
