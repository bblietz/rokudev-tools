# Plan 4e: `screensaver` template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the fifth v1 catalog template `screensaver`: a pure-screensaver Roku channel (no app UI) that displays a deterministic 8-photo slideshow with Ken Burns motion, crossfade, and anti-burn-in pixel-shift; bundled JPEGs with optional operator JSON-feed override; cert-grade manifest discipline (no app-only keys) and `RunScreenSaver()` entry point with required memory monitoring.

**Architecture:** Mirrors prior v1 templates (`video_grid_channel`, `news_channel`, `music_player`). Hand-authored, deterministic, byte-equal goldens. Single additive engine touchpoint (TemplateConfig threading for `transition_seconds` + `motion`) plus one new template-conditional post-zip cert validator (`SCREENSAVER_ZIP_TOO_LARGE`) and one schema-side validator (`SCREENSAVER_TITLE_CONTAINS_ROKU`). Five SceneGraph components (`Screensaver`, `PhotoCycle`, `HttpTask` x XML+BS pairs). One init-hook export: `Screensaver/after_scene_show`. The reference implementation at `/Users/bblietz/Work/ClaudeProjects/DevSummit-Screensaver-RokuTV/` is the load-bearing source of truth for screensaver-specific patterns (manifest allowlist, RunScreenSaver entry, memory monitoring, pixel-shift Animation, two-Poster pingpong + crossfade + Ken Burns).

**Tech Stack:** TypeScript (brs-gen engine), BrighterScript (`.bs` source emitted to `.brs` via compile.ts sweep), SceneGraph XML, Zod (schema), Vitest (tests), yazl (zip; TZ=UTC required), sharp 0.34.5 (deterministic JPEG generation), `@rokudev/device-client` (T27 ECP/dev-portal), Roku Native 2910X firmware (T27 device target).

**Reference docs:** Spec at `docs/superpowers/specs/2026-05-14-plan-4e-screensaver-design.md`. Memory: `~/.config/.../memory/MEMORY.md` + topic files (`plan-4d-music.md`, `plan-4c-news.md`, etc.) Reference implementation: `/Users/bblietz/Work/ClaudeProjects/DevSummit-Screensaver-RokuTV/{CLAUDE.md, channel/manifest, channel/source/main.brs, channel/components/CountdownScreensaver.xml, docs/CERT_CHECKLIST.md}`.

**Execution scaffolding:**
- All commands assume CWD = monorepo root `/Users/bblietz/Work/ClaudeProjects/rokudev-tools` unless stated.
- Test runner: `pnpm -C packages/brs-gen exec vitest run <pattern>` (NOT watch mode).
- Build: `pnpm -C packages/brs-gen build` (gating verification step; vitest does NOT typecheck).
- Golden regen: `TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs` (yazl 2.5.x DOS-time encoding requires UTC for cross-machine byte equality).
- T27: device IP set per session (`ROKUDEV_DEFAULT_ROKU_HOST`); password `1234`.

**Key gotchas already paid for in prior plans (do NOT relearn):**
- `pos`, `box`, `next`, `step`, `then`, `to` are BrightScript reserved words. Use `curPos` etc.
- `findNode` is id-only, NOT type-aware. Cache `m.<x>Ref` for any `createChild` you intend to remove or re-find.
- XML `<script>` includes for `source/lib/*.brs` are MANDATORY in components; silent runtime failure (`func_name_resolver failed resolving '<name>'`) otherwise. The merger only auto-injects `_template/config.bs` and `_modules/__init_hooks.bs`.
- `HttpTask` is `createObject`-instantiated, NEVER `<script>`-included into a Scene (Plan 4c lesson: causes duplicate `init()` triggering).
- XML `.bs` URIs at authoring time are intentional; `compile.ts` post-compile sweep rewrites to `.brs`.
- Sharp 0.34.5 byte-equality risk (Plan 4d): if `gen-screensaver-photos.mjs` cannot reliably regenerate the same JPEG bytes across runs, fall back to `copyFile`-ing committed authoritative bytes. See Task 8 contingency.
- Animation `control="start"` inline XML attribute is unreliable; programmatically set `control = "start"` in `init()` (idempotent guard, reference repo CityBackground.brs lesson).
- Re-sideload preamble does NOT fully reset BrightScript m globals on Native 2910X firmware (Plan 4c). Use Home keypress + ECP `launch('dev')`. For screensavers, the trigger story is more nuanced (see Task 16).

---

## File Structure

**Created:**

```
packages/brs-gen/
  templates/screensaver/
    template.toml                                      # Task 3
    schema.ts                                          # Task 3
    files/
      manifest.ejs                                     # Task 4
      source/
        main.brs                                       # Task 5
        lib/
          Feed.brs                                     # Task 6
      components/
        HttpTask.xml                                   # Task 9
        HttpTask.bs                                    # Task 9
        PhotoCycle.xml                                 # Task 10
        PhotoCycle.bs                                  # Task 10
        Screensaver.xml                                # Task 11
        Screensaver.bs                                 # Task 11
      data/
        screensaver-feed.json                          # Task 7
      images/
        sample-photo-1.jpg ... sample-photo-8.jpg      # Task 8 (8 files)
  scripts/
    gen-screensaver-photos.mjs                         # Task 8
    t27-screensaver.mjs                                # Task 15
  tests/
    cert-validators.test.ts                            # Task 2 (new file)
    __snapshots__/screensaver/
      manifest.snap.txt                                # Task 4
      main.brs.snap.txt                                # Task 5
      Feed.brs.snap.txt                                # Task 6
      screensaver-feed.json.snap.txt                   # Task 7
      HttpTask.xml.snap.txt                            # Task 9
      HttpTask.brs.snap.txt                            # Task 9
      PhotoCycle.xml.snap.txt                          # Task 10
      PhotoCycle.brs.snap.txt                          # Task 10
      Screensaver.xml.snap.txt                         # Task 11
      Screensaver.brs.snap.txt                         # Task 11
      __init_hooks.bs.snap.txt                         # Task 11
      files-listing.snap.txt                           # Task 11
    __golden__/
      screensaver.zip                                  # Task 13
      screensaver.provenance.json                      # Task 13
docs/superpowers/plans/
  2026-05-14-plan-4e-screensaver.md                    # this file
```

**Modified:**

```
packages/brs-gen/src/tools/generate-app.ts             # Task 1 (lines 353-378 region)
packages/brs-gen/src/build/zip.ts                      # Task 2 (post-zip validator)
packages/brs-gen/tests/snapshots.test.ts               # Tasks 4-11 (one describe block, grown)
packages/brs-gen/tests/conflict-matrix.test.ts         # Task 12
packages/brs-gen/tests/determinism.test.ts             # Task 12
packages/brs-gen/tests/e2e.test.ts                     # Task 13
packages/brs-gen/scripts/regen-golden.mjs              # Task 13 (add screensaver entry)
packages/brs-gen/scripts/_t27-lib.mjs                  # Task 14 (assertActiveAppIsOurs opt)
packages/rokudev-device/...                            # Task 14 (if helper lives there; verify)
README.md                                              # Task 17 (v0.5.5 release notes)
~/.config/.../memory/MEMORY.md                         # Task 18 (status line)
~/.config/.../memory/plan-4e-screensaver.md            # Task 18 (new topic file)
package.json (root) + packages/*/package.json          # Task 19 (v0.5.5)
```

---

## Phase 0: Engine prep (independent of template files)

### Task 1: TemplateConfig threading for `transition_seconds` + `motion`

**Files:**
- Modify: `packages/brs-gen/src/tools/generate-app.ts:353-378`
- Test: `packages/brs-gen/tests/template-config.test.ts` (extend existing OR add `screensaver-config.test.ts` if not present; verify via Glob first)

**Context:** Plan 4c widened the TemplateConfig emission gate to `if (brandingSpec.primary_color || content || effectivePrimaryColor)`. Plan 4d added `service_name`. We add two more keys: `transition_seconds` and `motion`. Pure additive change — zero impact on existing templates because they don't have these keys in their schemas. The current `content` type widening at line 358-365 must also be extended to include the new fields so TypeScript builds clean.

- [ ] **Step 1: Locate the existing threading region**

Run: `grep -n "service_name" packages/brs-gen/src/tools/generate-app.ts`
Expected: hits around lines 363, 376 in the `9a` TemplateConfig block.

- [ ] **Step 2: Find existing test for service_name threading**

Run: `grep -rn "service_name" packages/brs-gen/tests/ | head -20`
Expected: at least one test asserting `cfg['service_name']` emission. Note the file path.

- [ ] **Step 3: Write failing test for `transition_seconds` + `motion` threading**

Add (in the same file as the `service_name` test, mirroring its structure):

```typescript
it('emits transition_seconds and motion into TemplateConfig when content has them', async () => {
  const cat = await loadCatalog(PKG_ROOT);
  setCatalogForTests(cat);
  const handler = getGenerateAppHandler();
  const dir = await mkdtemp(join(tmpdir(), 'brs-gen-tc-ss-'));
  try {
    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'screensaver', // template need not exist yet for this test;
        // if template loading fails, fall back to a stub template that accepts content.transition_seconds.
        // OR write this test to use a hand-built minimal CatalogTemplate fixture (see existing tests for pattern).
        modules: [],
        app: { name: 'Test', major_version: 0, minor_version: 1, build_version: 0 },
        content: { transition_seconds: 12, motion: 'crossfade_only' },
      },
      output_dir: join(dir, 'project'),
    });
    expect((result as { ok: boolean }).ok).toBe(true);
    const cfgBs = await readFile(join(dir, 'project', 'source', '_template', 'config.brs'), 'utf8');
    expect(cfgBs).toMatch(/transition_seconds["']?\s*[:=]\s*12/);
    expect(cfgBs).toMatch(/motion["']?\s*[:=]\s*"crossfade_only"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

NOTE: This test depends on the screensaver template existing OR on a fixture catalog. If the screensaver template scaffolding (Task 3) is not yet present, the test will fail at template-load time, NOT at the assertion. That is acceptable: this test stays red until Task 3 lands the template, then turns green when this engine change is in place. **OR** rewrite the test to use the existing `video_grid_channel` template + a stub spec that includes the extra content fields (the template just won't read them, but the engine should still emit them).

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm -C packages/brs-gen exec vitest run template-config`
Expected: FAIL — either with "template not found" (acceptable; test is red until Task 3) OR with the assertion failures showing `transition_seconds` not present in `cfg.brs`.

- [ ] **Step 5: Edit `generate-app.ts` to thread the new fields**

In the `content` type cast (around line 358-365), add the two fields:

```typescript
const content = (
  appSpec as {
    content?: {
      feed_url?: string;
      feed_format?: string;
      live_label?: string;
      service_name?: string;
      transition_seconds?: number;
      motion?: string;
    };
  }
).content;
```

In the `cfg` population block (around line 372-376), append two lines AFTER the `service_name` line:

```typescript
if (content?.transition_seconds !== undefined) cfg['transition_seconds'] = String(content.transition_seconds);
if (content?.motion) cfg['motion'] = content.motion;
```

NOTE: `cfg` is `Record<string, string>`; convert numeric `transition_seconds` to string with `String()`. The `emitTemplateConfigBs` helper handles the BrightScript-side type at emission (numbers come in as strings, get emitted with quotes; the consumer `TemplateConfig().transition_seconds` reads as string and parses to int via `Val()`. If the existing helper instead emits typed values, mirror its pattern. Verify by reading `emitTemplateConfigBs` source first.)

- [ ] **Step 6: Run TS build to catch type errors**

Run: `pnpm -C packages/brs-gen build`
Expected: PASS, no TS errors.

- [ ] **Step 7: Run test to verify it passes (after Task 3)**

Run: `pnpm -C packages/brs-gen exec vitest run template-config`
Expected: After Task 3 lands, PASS. If Task 3 hasn't landed, this stays red but `service_name` / `live_label` regression coverage stays green.

- [ ] **Step 8: Run full vitest sweep to confirm no regressions in existing templates**

Run: `pnpm -C packages/brs-gen exec vitest run`
Expected: All previously-green tests stay green (808 baseline from v0.5.4; new red test is acceptable until Task 3).

- [ ] **Step 9: Commit**

```bash
git add packages/brs-gen/src/tools/generate-app.ts packages/brs-gen/tests/
git commit -m "feat(brs-gen): thread content.transition_seconds + content.motion into TemplateConfig (Plan 4e prep)"
```

---

### Task 2: Post-zip cert validator `SCREENSAVER_ZIP_TOO_LARGE`

**Files:**
- Modify: `packages/brs-gen/src/tools/generate-app.ts` (insertion point: after the `packageProject` call near line 433-438)
- Modify: `packages/brs-gen/src/spec/failure-codes.ts` (or wherever `FailureCode` enum lives; verify via Grep `SPEC_INVALID` first)
- Create: `packages/brs-gen/tests/cert-validators.test.ts`

**Context:** Cert rule 3.7: screensaver zip MUST be ≤ 4 MB. Hard error > 4 MB; warning > 3.5 MB. **Template-conditional**: only fires when `manifest` contains `screensaver_title=`. Other templates unaffected. Per Section 5 of the spec, validator lives near the `packageProject` call site (NOT inside `packageProject`, which stays template-agnostic).

- [ ] **Step 1: Locate the failure-code enum**

Run: `grep -rn "SPEC_INVALID\|FailureCode" packages/brs-gen/src/ --include="*.ts" | head -20`
Expected: a single source-of-truth file. Note its path.

- [ ] **Step 2: Add `SCREENSAVER_ZIP_TOO_LARGE` to the failure-code enum/union**

Add the new code alongside existing codes. If failure codes are a TS string-literal union, add `'SCREENSAVER_ZIP_TOO_LARGE'`. If an enum, add the corresponding member.

- [ ] **Step 3: Write failing tests in new `tests/cert-validators.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, copyFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yazl from 'yazl';
import { createWriteStream } from 'node:fs';

// Helper: build a synthetic zip of N bytes by stuffing a single padding file.
async function buildSyntheticZip(zipPath: string, sizeBytes: number, manifestContent: string): Promise<void> {
  const zip = new yazl.ZipFile();
  zip.addBuffer(Buffer.from(manifestContent, 'utf8'), 'manifest', { mtime: new Date(0), compress: false });
  // Stuff a dummy file so the resulting zip is approximately sizeBytes large.
  // Actual encoded size will be slightly larger due to zip overhead; tune padding accordingly.
  const padding = Buffer.alloc(Math.max(0, sizeBytes - 256));
  zip.addBuffer(padding, 'padding.bin', { mtime: new Date(0), compress: false });
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream.pipe(createWriteStream(zipPath)).on('close', resolve).on('error', reject);
  });
}

describe('SCREENSAVER_ZIP_TOO_LARGE validator', () => {
  it('throws on > 4 MB zip when manifest has screensaver_title', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brs-gen-cv-'));
    try {
      const zipPath = join(dir, 'big.zip');
      await buildSyntheticZip(zipPath, 4.5 * 1024 * 1024, 'title=Foo\nscreensaver_title=Foo\n');
      // Import the validator and invoke directly (not via the full pipeline).
      const { validateScreensaverZipSize } = await import('../src/build/screensaver-validators.js');
      const manifestText = 'title=Foo\nscreensaver_title=Foo\n';
      await expect(
        validateScreensaverZipSize(zipPath, manifestText)
      ).rejects.toThrow(/SCREENSAVER_ZIP_TOO_LARGE/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns warning on > 3.5 MB but <= 4 MB zip when manifest has screensaver_title', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brs-gen-cv-'));
    try {
      const zipPath = join(dir, 'med.zip');
      await buildSyntheticZip(zipPath, 3.7 * 1024 * 1024, 'title=Foo\nscreensaver_title=Foo\n');
      const { validateScreensaverZipSize } = await import('../src/build/screensaver-validators.js');
      const result = await validateScreensaverZipSize(zipPath, 'title=Foo\nscreensaver_title=Foo\n');
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/3\.\d MB/)]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('passes for any size zip when manifest LACKS screensaver_title (apps unaffected)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'brs-gen-cv-'));
    try {
      const zipPath = join(dir, 'app.zip');
      await buildSyntheticZip(zipPath, 4.5 * 1024 * 1024, 'title=AppFoo\nsplash_color=#000000\n');
      const { validateScreensaverZipSize } = await import('../src/build/screensaver-validators.js');
      const result = await validateScreensaverZipSize(zipPath, 'title=AppFoo\nsplash_color=#000000\n');
      expect(result.warnings).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4: Run tests to verify they fail (validator does not exist yet)**

Run: `pnpm -C packages/brs-gen exec vitest run cert-validators`
Expected: FAIL with `Cannot find module '../src/build/screensaver-validators.js'`.

- [ ] **Step 5: Create the validator module**

Create `packages/brs-gen/src/build/screensaver-validators.ts`:

```typescript
import { stat } from 'node:fs/promises';

export interface ValidationResult {
  warnings: string[];
}

const MAX_BYTES = 4 * 1024 * 1024;
const WARN_BYTES = 3.5 * 1024 * 1024;

export async function validateScreensaverZipSize(
  zipPath: string,
  manifestText: string,
): Promise<ValidationResult> {
  const isScreensaver = /^screensaver_title\s*=/m.test(manifestText);
  if (!isScreensaver) return { warnings: [] };

  const { size } = await stat(zipPath);
  if (size > MAX_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(2);
    const err = new Error(
      `SCREENSAVER_ZIP_TOO_LARGE: screensaver zip is ${mb} MB; cert rule 3.7 requires <= 4 MB`,
    );
    (err as Error & { code: string }).code = 'SCREENSAVER_ZIP_TOO_LARGE';
    throw err;
  }
  if (size > WARN_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(2);
    return { warnings: [`screensaver zip is ${mb} MB; approaching cert rule 3.7 limit (4 MB)`] };
  }
  return { warnings: [] };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm -C packages/brs-gen exec vitest run cert-validators`
Expected: All three tests PASS.

- [ ] **Step 7: Wire validator into generate-app.ts post-zip path**

After the `packageProject` call (around line 433-438), add:

```typescript
if (zipPath) {
  const { validateScreensaverZipSize } = await import('../build/screensaver-validators.js');
  const manifestText = await readFile(join(outputDir, 'manifest'), 'utf8');
  const ssvr = await validateScreensaverZipSize(zipPath, manifestText);
  if (ssvr.warnings.length > 0) {
    details.warnings = [...(details.warnings ?? []), ...ssvr.warnings];
  }
}
```

NOTE: `details` is the existing payload accumulator returned by `generate_app`. Verify exact name by reading the function. Adapt accordingly.

- [ ] **Step 8: Build and run full test suite**

Run: `pnpm -C packages/brs-gen build && pnpm -C packages/brs-gen exec vitest run`
Expected: PASS (build clean; all tests green except the Task 1 test that may still be red until Task 3).

- [ ] **Step 9: Commit**

```bash
git add packages/brs-gen/src/build/screensaver-validators.ts packages/brs-gen/src/tools/generate-app.ts packages/brs-gen/src/spec/ packages/brs-gen/tests/cert-validators.test.ts
git commit -m "feat(brs-gen): add SCREENSAVER_ZIP_TOO_LARGE post-zip cert validator (Plan 4e prep)"
```

---

## Phase 1: Template scaffolding

### Task 3: `template.toml` + `schema.ts` + cert-validator `SCREENSAVER_TITLE_CONTAINS_ROKU`

**Files:**
- Create: `packages/brs-gen/templates/screensaver/template.toml`
- Create: `packages/brs-gen/templates/screensaver/schema.ts`
- Test: `packages/brs-gen/tests/cert-validators.test.ts` (extend with schema-side cases)

**Context:** Per spec §5 layout and §6 schema. Template id is `screensaver`. Single init-hook export: `Screensaver/after_scene_show`. Three scene_node declarations: Screensaver, PhotoCycle, HttpTask. Schema includes `ScreensaverContentSchema.strict()` with `feed_url` (optional URL), `feed_format` (literal `"rokudev_screensaver_v1"`, default), `transition_seconds` (int 4..30, default 7), `motion` (enum `'ken_burns' | 'crossfade_only' | 'none'`, default `'ken_burns'`). The `app.name` field has `.refine()` that rejects "roku" case-insensitive.

- [ ] **Step 1: Write failing schema-validator test cases**

Append to `packages/brs-gen/tests/cert-validators.test.ts`:

```typescript
import { Schema as ScreensaverSchema } from '../templates/screensaver/schema.js';

describe('SCREENSAVER_TITLE_CONTAINS_ROKU validator', () => {
  const baseSpec = {
    spec_version: 2 as const,
    template: 'screensaver' as const,
    modules: [],
    app: { name: 'PLACEHOLDER', major_version: 1, minor_version: 0, build_version: 0 },
  };

  it('rejects spec.app.name containing "Roku" (case-insensitive)', () => {
    const r1 = ScreensaverSchema.safeParse({ ...baseSpec, app: { ...baseSpec.app, name: 'Roku Photos' } });
    expect(r1.success).toBe(false);
    if (!r1.success) {
      expect(JSON.stringify(r1.error.format())).toMatch(/screensaver_title cannot contain the word "Roku"/);
    }

    const r2 = ScreensaverSchema.safeParse({ ...baseSpec, app: { ...baseSpec.app, name: 'ROKU PHOTOS' } });
    expect(r2.success).toBe(false);

    const r3 = ScreensaverSchema.safeParse({ ...baseSpec, app: { ...baseSpec.app, name: 'My rOKu Channel' } });
    expect(r3.success).toBe(false);
  });

  it('accepts spec.app.name without "Roku"', () => {
    const r = ScreensaverSchema.safeParse({ ...baseSpec, app: { ...baseSpec.app, name: 'Family Photos' } });
    expect(r.success).toBe(true);
  });
});

describe('screensaver content schema', () => {
  const base = {
    spec_version: 2 as const,
    template: 'screensaver' as const,
    modules: [],
    app: { name: 'OK Name', major_version: 1, minor_version: 0, build_version: 0 },
  };

  it('applies defaults: motion=ken_burns, transition_seconds=7, feed_format=rokudev_screensaver_v1', () => {
    const r = ScreensaverSchema.parse({ ...base, content: {} });
    expect(r.content?.motion).toBe('ken_burns');
    expect(r.content?.transition_seconds).toBe(7);
    expect(r.content?.feed_format).toBe('rokudev_screensaver_v1');
  });

  it('rejects transition_seconds < 4', () => {
    const r = ScreensaverSchema.safeParse({ ...base, content: { transition_seconds: 3 } });
    expect(r.success).toBe(false);
  });

  it('rejects transition_seconds > 30', () => {
    const r = ScreensaverSchema.safeParse({ ...base, content: { transition_seconds: 31 } });
    expect(r.success).toBe(false);
  });

  it('rejects unknown content fields (strict)', () => {
    const r = ScreensaverSchema.safeParse({ ...base, content: { random_field: true } as object });
    expect(r.success).toBe(false);
  });

  it('rejects motion outside enum', () => {
    const r = ScreensaverSchema.safeParse({ ...base, content: { motion: 'sparkles' } as object });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail (schema does not exist)**

Run: `pnpm -C packages/brs-gen exec vitest run cert-validators`
Expected: FAIL with `Cannot find module '../templates/screensaver/schema.js'`.

- [ ] **Step 3: Create `templates/screensaver/template.toml`**

```toml
[template]
id = "screensaver"
version = "0.1.0"
spec_compat = ">=2"
description = "Pure-screensaver Roku channel: deterministic photo slideshow with Ken Burns motion + crossfade. Manifest declares ONLY screensaver_title + version + rsg_version + ui_resolutions; NO app-only keys."

[template.manifest_defaults]
title = "<%= spec.app.name %>"
major_version = "<%= spec.app.major_version %>"
minor_version = "<%= spec.app.minor_version %>"
build_version = "<%= spec.app.build_version %>"
rsg_version = "1.3"
ui_resolutions = "hd,fhd"
screensaver_title = "<%= spec.app.name %>"

[template.exports]
init_hooks = [
  { scope = "Screensaver", phase = "after_scene_show", file = "components/Screensaver.bs", signature = "(m as object) as void" },
]
scene_nodes = [
  { name = "Screensaver", file = "components/Screensaver.xml" },
  { name = "PhotoCycle",  file = "components/PhotoCycle.xml" },
  { name = "HttpTask",    file = "components/HttpTask.xml" },
]
```

NOTE: Deliberately NO `[template.branding_defaults]` section (screensavers have no UI to brand). Deliberately NO `splash_color`, NO `bs_const = "DEBUG=false"` — manifest stays absolutely minimal per §4 of the spec. Verify by Read of news_channel/template.toml that adding `bs_const` is optional.

- [ ] **Step 4: Create `templates/screensaver/schema.ts`**

Mirror the spec §6 ScreensaverContentSchema literally:

```typescript
import { z } from 'zod';

const NonNegInt = z.number().int().min(0);

export const ScreensaverContentSchema = z
  .object({
    feed_url: z.string().url().optional(),
    feed_format: z.literal('rokudev_screensaver_v1').default('rokudev_screensaver_v1'),
    transition_seconds: z.number().int().min(4).max(30).default(7),
    motion: z.enum(['ken_burns', 'crossfade_only', 'none']).default('ken_burns'),
  })
  .strict();

export const Schema = z
  .object({
    spec_version: z.literal(2),
    template: z.literal('screensaver'),
    modules: z.array(z.record(z.unknown())),
    app: z
      .object({
        name: z
          .string()
          .min(1)
          .max(50)
          .refine((v) => !/roku/i.test(v), {
            message: 'screensaver_title cannot contain the word "Roku" per Roku Channel Store cert rules',
          }),
        major_version: NonNegInt,
        minor_version: NonNegInt,
        build_version: NonNegInt,
      })
      .strict(),
    branding: z.object({}).passthrough().optional(),
    content: ScreensaverContentSchema.optional(),
  })
  .strict();

export const Example = {
  spec_version: 2 as const,
  template: 'screensaver' as const,
  modules: [],
  app: { name: 'My Screensaver', major_version: 1, minor_version: 0, build_version: 0 },
  content: {
    feed_format: 'rokudev_screensaver_v1' as const,
    transition_seconds: 7,
    motion: 'ken_burns' as const,
  },
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -C packages/brs-gen exec vitest run cert-validators`
Expected: All schema tests PASS.

- [ ] **Step 6: Run TS build to confirm types are clean**

Run: `pnpm -C packages/brs-gen build`
Expected: PASS.

- [ ] **Step 7: Confirm template loads via catalog discovery**

Run: `pnpm -C packages/brs-gen exec vitest run snapshots -t "music_player"`
Expected: PASS (existing tests unaffected). Then run a scratch script or quick test to assert `loadCatalog(PKG_ROOT)` now returns a `screensaver` template entry. If no existing test covers this, add a 1-line check to an existing catalog test:

```typescript
expect(cat.templates.has('screensaver')).toBe(true);
```

- [ ] **Step 8: Commit**

```bash
git add packages/brs-gen/templates/screensaver/template.toml packages/brs-gen/templates/screensaver/schema.ts packages/brs-gen/tests/cert-validators.test.ts
git commit -m "feat(brs-gen): scaffold screensaver template (toml + schema + cert validator)"
```

---

### Task 4: `manifest.ejs` + snapshot test with allowlist defense

**Files:**
- Create: `packages/brs-gen/templates/screensaver/files/manifest.ejs`
- Modify: `packages/brs-gen/tests/snapshots.test.ts` (add `screensaver` describe block; first test only — rest grow in Tasks 5-11)
- Create: `packages/brs-gen/tests/__snapshots__/screensaver/manifest.snap.txt` (auto-written by toMatchFileSnapshot)

**Context:** This is the load-bearing correctness invariant of the template (spec §4). Manifest MUST contain ONLY: `title`, `major_version`, `minor_version`, `build_version`, `rsg_version`, `ui_resolutions`, `screensaver_title`. Defense-in-depth: snapshot test PLUS a separate allowlist-keys test that asserts the EXACT set, so a future template author who adds e.g. `screensaver_animated_thumbnail_hd` (not on the forbidden list because it doesn't exist yet) gets caught.

- [ ] **Step 1: Create `manifest.ejs`**

Per spec §4:

```
title=<%= spec.app.name %>
major_version=<%= spec.app.major_version %>
minor_version=<%= spec.app.minor_version %>
build_version=<%= spec.app.build_version %>
rsg_version=1.3
ui_resolutions=hd,fhd
screensaver_title=<%= spec.app.name %>
```

- [ ] **Step 2: Add screensaver describe block + manifest snapshot test in snapshots.test.ts**

Mirror the music_player describe block at lines 474-572. Beginning of new block (place at end of file):

```typescript
describe('screensaver snapshots', () => {
  let parentDir: string;
  let projectDir: string;

  beforeAll(async () => {
    const cat = await loadCatalog(PKG_ROOT);
    setCatalogForTests(cat);
    parentDir = await mkdtemp(join(tmpdir(), 'brs-gen-ssvr-'));
    projectDir = join(parentDir, 'project');
    const handler = getGenerateAppHandler();
    const result = await handler({
      spec: {
        spec_version: 2,
        template: 'screensaver',
        modules: [],
        app: { name: 'Demo Photos', major_version: 0, minor_version: 1, build_version: 0 },
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
    await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/manifest.snap.txt');
  });

  it('manifest key set is EXACTLY the cert-allowed allowlist (defense-in-depth)', async () => {
    const s = await readFile(join(projectDir, 'manifest'), 'utf8');
    const keys = new Set(
      s
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.trim().startsWith('#'))
        .map((l) => l.split('=')[0]!.trim()),
    );
    const allowed = new Set([
      'title',
      'major_version',
      'minor_version',
      'build_version',
      'rsg_version',
      'ui_resolutions',
      'screensaver_title',
    ]);
    // Symmetric diff: keys not in allowlist + allowlist members not in manifest.
    const extras = [...keys].filter((k) => !allowed.has(k));
    const missing = [...allowed].filter((k) => !keys.has(k));
    expect({ extras, missing }).toEqual({ extras: [], missing: [] });
  });
});
```

NOTE: The two tests serve distinct purposes. `toMatchFileSnapshot` LOCKS the exact bytes (any diff requires manual review). The allowlist test is the SEMANTIC check — it survives intentional formatting changes (e.g. trailing newline) and catches "added a new key" mistakes loudly.

- [ ] **Step 3: Run tests to confirm snapshot is created and allowlist test passes**

Run: `pnpm -C packages/brs-gen exec vitest run snapshots -t "screensaver"`
Expected: First run creates `__snapshots__/screensaver/manifest.snap.txt`. PASS. Re-run: PASS (idempotent).

If allowlist test fails because manifest contains an unexpected key, the manifest.ejs is wrong; FIX the .ejs (do NOT relax the allowlist).

- [ ] **Step 4: Inspect the generated manifest snapshot**

Run: `cat packages/brs-gen/tests/__snapshots__/screensaver/manifest.snap.txt`
Expected: matches the spec §4 manifest exactly. No `splash_color`, no `mm_icon_focus_*`, no `bs_const`.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/templates/screensaver/files/manifest.ejs packages/brs-gen/tests/snapshots.test.ts packages/brs-gen/tests/__snapshots__/screensaver/
git commit -m "feat(screensaver): manifest.ejs (cert-allowlist enforced via snapshot + key-set test)"
```

---

## Phase 2: Entry point + bundled content + assets

### Task 5: `source/main.brs` (RunScreenSaver entry + memory monitoring)

**Files:**
- Create: `packages/brs-gen/templates/screensaver/files/source/main.brs`
- Modify: `packages/brs-gen/tests/snapshots.test.ts` (add main.brs snapshot test to screensaver describe block)
- Create (auto): `packages/brs-gen/tests/__snapshots__/screensaver/main.brs.snap.txt`

**Context:** Per spec §5.2. Entry point MUST be `sub RunScreenSaver()`. NOT `Main()`, NOT `RunUserInterface()`. Memory monitoring boilerplate is cert-required from 2026-10-01. The reference repo's main.brs is the source of truth (mined during brainstorming). NOTE: This file is `.brs` NOT `.bs` — `source/main.brs` is the BrightScript runtime entry point and the compile.ts sweep does not transform `source/*.brs`. Keep it as plain BrightScript.

- [ ] **Step 1: Write the file `source/main.brs`**

Per spec §5.2 verbatim:

```brightscript
sub RunScreenSaver()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)

    ' Memory monitoring (cert requirement effective 2026-10-01).
    memMonitor = CreateObject("roAppMemoryMonitor")
    if memMonitor <> invalid then
        memMonitor.SetMessagePort(port)
        memMonitor.EnableMemoryWarningEvent(true)
    end if
    di = CreateObject("roDeviceInfo")
    di.SetMessagePort(port)
    di.EnableLowGeneralMemoryEvent(true)

    screen.CreateScene("Screensaver")
    screen.Show()

    while true
        msg = wait(0, port)
        if msg <> invalid
            msgType = type(msg)
            if msgType = "roSGScreenEvent"
                if msg.IsScreenClosed() then return
            else if msgType = "roAppMemoryNotificationEvent"
                print "[main] memory warning"
            else if msgType = "roDeviceInfoEvent"
                ' v1.x will free texture caches here when generalMemoryLevel reports low
            end if
        end if
    end while
end sub
```

NOTE: No leading `function Main()` — pure-screensaver channels MUST NOT have `Main()`. Including it causes the channel to register as `type=appl` instead of `type=ssvr` even with the correct manifest (Plan 4e brainstorming research).

- [ ] **Step 2: Add main.brs snapshot test + entry-point regression assertions**

Append to the `screensaver` describe block in `snapshots.test.ts`:

```typescript
it('source/main.brs matches saved snapshot', async () => {
  const s = await readFile(join(projectDir, 'source', 'main.brs'), 'utf8');
  await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/main.brs.snap.txt');
});

it('source/main.brs uses RunScreenSaver entry point and includes memory monitoring', async () => {
  const s = await readFile(join(projectDir, 'source', 'main.brs'), 'utf8');
  expect(s).toMatch(/^sub\s+RunScreenSaver\s*\(\s*\)/m);
  expect(s).not.toMatch(/^sub\s+Main\s*\(/m);
  expect(s).not.toMatch(/^function\s+Main\s*\(/m);
  expect(s).toContain('roAppMemoryMonitor');
  expect(s).toContain('EnableLowGeneralMemoryEvent');
  expect(s).toContain('roSGScreenEvent');
});
```

- [ ] **Step 3: Run snapshot test (creates snapshot file)**

Run: `pnpm -C packages/brs-gen exec vitest run snapshots -t "screensaver"`
Expected: PASS. Snapshot file created.

- [ ] **Step 4: Inspect the snapshot**

Run: `cat packages/brs-gen/tests/__snapshots__/screensaver/main.brs.snap.txt`
Expected: matches what was authored.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/templates/screensaver/files/source/main.brs packages/brs-gen/tests/snapshots.test.ts packages/brs-gen/tests/__snapshots__/screensaver/main.brs.snap.txt
git commit -m "feat(screensaver): source/main.brs with RunScreenSaver entry + memory monitoring"
```

---

### Task 6: `source/lib/Feed.brs` (3 pure helpers)

**Files:**
- Create: `packages/brs-gen/templates/screensaver/files/source/lib/Feed.brs`
- Modify: `packages/brs-gen/tests/snapshots.test.ts`
- Create (auto): `packages/brs-gen/tests/__snapshots__/screensaver/Feed.brs.snap.txt`

**Context:** Per spec §5.6. Three helpers. NO SceneGraph dependencies. Mirrors `news_channel`'s and `music_player`'s `Feed.brs` style. The file is `.brs` (NOT `.bs`) so it's directly emitted, no compile sweep.

NOTE: Design spec writes the helpers in `.brs` syntax with `function ... as object` already, so this is correct as-is. Distinguish from component-side `.bs` files that go through brighterscript compilation.

- [ ] **Step 1: Write the file**

Per spec §5.6:

```brightscript
function ScreensaverFeed_LoadBundled() as object
    raw = ReadAsciiFile("pkg:/data/screensaver-feed.json")
    return ParseJSON(raw)
end function

function ScreensaverFeed_LoadOperator(rawJson as string) as object
    return ParseJSON(rawJson)
end function

function ScreensaverFeed_BuildContentNodes(feed as object) as object
    nodes = []
    if feed = invalid then return nodes
    if feed.photos = invalid then return nodes
    for each photo in feed.photos
        node = CreateObject("roSGNode", "ContentNode")
        node.url = photo.url
        if photo.title <> invalid then node.title = photo.title
        ' ShortDescriptionLine2 is the documented descriptive-text field
        ' for ContentNode (Plan 4d lesson; not SecondaryTitle).
        if photo.credit <> invalid then node.ShortDescriptionLine2 = photo.credit
        nodes.push(node)
    end for
    return nodes
end function
```

- [ ] **Step 2: Add snapshot + assertion test**

Append to screensaver describe block:

```typescript
it('source/lib/Feed.brs matches saved snapshot', async () => {
  const s = await readFile(join(projectDir, 'source', 'lib', 'Feed.brs'), 'utf8');
  await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/Feed.brs.snap.txt');
});

it('Feed.brs exports the 3 helpers used by Screensaver.bs', async () => {
  const s = await readFile(join(projectDir, 'source', 'lib', 'Feed.brs'), 'utf8');
  expect(s).toMatch(/function\s+ScreensaverFeed_LoadBundled/);
  expect(s).toMatch(/function\s+ScreensaverFeed_LoadOperator/);
  expect(s).toMatch(/function\s+ScreensaverFeed_BuildContentNodes/);
  expect(s).not.toMatch(/SecondaryTitle/);  // Plan 4d guardrail
  expect(s).toContain('ShortDescriptionLine2');
});
```

- [ ] **Step 3: Run test**

Run: `pnpm -C packages/brs-gen exec vitest run snapshots -t "screensaver"`
Expected: PASS, snapshot created.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/templates/screensaver/files/source/lib/Feed.brs packages/brs-gen/tests/snapshots.test.ts packages/brs-gen/tests/__snapshots__/screensaver/Feed.brs.snap.txt
git commit -m "feat(screensaver): source/lib/Feed.brs (3 pure helpers, no SG dependencies)"
```

---

### Task 7: `data/screensaver-feed.json` (bundled 8-photo list)

**Files:**
- Create: `packages/brs-gen/templates/screensaver/files/data/screensaver-feed.json`
- Modify: `packages/brs-gen/tests/snapshots.test.ts`

**Context:** Spec §5.7 + §9 determinism. JSON is sorted by `id` (alphabetically); no timestamps. Stable across regen. 8 entries pointing at `pkg:/images/sample-photo-{1..8}.jpg`.

- [ ] **Step 1: Author the JSON**

```json
{
  "version": 1,
  "photos": [
    { "id": "p1", "url": "pkg:/images/sample-photo-1.jpg", "title": "Sample Photo 1", "credit": "Generated placeholder" },
    { "id": "p2", "url": "pkg:/images/sample-photo-2.jpg", "title": "Sample Photo 2", "credit": "Generated placeholder" },
    { "id": "p3", "url": "pkg:/images/sample-photo-3.jpg", "title": "Sample Photo 3", "credit": "Generated placeholder" },
    { "id": "p4", "url": "pkg:/images/sample-photo-4.jpg", "title": "Sample Photo 4", "credit": "Generated placeholder" },
    { "id": "p5", "url": "pkg:/images/sample-photo-5.jpg", "title": "Sample Photo 5", "credit": "Generated placeholder" },
    { "id": "p6", "url": "pkg:/images/sample-photo-6.jpg", "title": "Sample Photo 6", "credit": "Generated placeholder" },
    { "id": "p7", "url": "pkg:/images/sample-photo-7.jpg", "title": "Sample Photo 7", "credit": "Generated placeholder" },
    { "id": "p8", "url": "pkg:/images/sample-photo-8.jpg", "title": "Sample Photo 8", "credit": "Generated placeholder" }
  ]
}
```

NOTE: Use 2-space indent. The merger does NOT reformat `data/*.json` (verify by reading prior templates' bundled JSONs). Author EXACTLY in the form that should ship; the snapshot test will lock the bytes.

- [ ] **Step 2: Add snapshot + structural assertions**

```typescript
it('data/screensaver-feed.json matches saved snapshot', async () => {
  const s = await readFile(join(projectDir, 'data', 'screensaver-feed.json'), 'utf8');
  await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/screensaver-feed.json.snap.txt');
});

it('screensaver-feed.json contains exactly 8 sequential entries with stable ids', async () => {
  const raw = await readFile(join(projectDir, 'data', 'screensaver-feed.json'), 'utf8');
  const feed = JSON.parse(raw) as { version: number; photos: Array<{ id: string; url: string }> };
  expect(feed.version).toBe(1);
  expect(feed.photos).toHaveLength(8);
  feed.photos.forEach((p, i) => {
    expect(p.id).toBe(`p${i + 1}`);
    expect(p.url).toBe(`pkg:/images/sample-photo-${i + 1}.jpg`);
  });
});
```

- [ ] **Step 3: Run test**

Run: `pnpm -C packages/brs-gen exec vitest run snapshots -t "screensaver"`
Expected: PASS, snapshot created.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/templates/screensaver/files/data/screensaver-feed.json packages/brs-gen/tests/snapshots.test.ts packages/brs-gen/tests/__snapshots__/screensaver/screensaver-feed.json.snap.txt
git commit -m "feat(screensaver): data/screensaver-feed.json (bundled 8-photo list)"
```

---

### Task 8: Asset generation: `gen-screensaver-photos.mjs` + 8 JPEGs

**Files:**
- Create: `packages/brs-gen/scripts/gen-screensaver-photos.mjs`
- Create (via script): `packages/brs-gen/templates/screensaver/files/images/sample-photo-{1..8}.jpg`
- Test: extend `packages/brs-gen/tests/asset-reuse.test.ts` OR add a new test ensuring all 8 JPEGs exist + are 1920x1080

**Context:** Per spec §9 determinism. Sharp 0.34.5 is project-pinned. 8 deterministic JPEGs (gradient + "Sample Photo N" text overlay). **Sharp byte-equality risk** (Plan 4d carry-forward): if the `gen` script cannot reliably reproduce the same JPEG bytes across runs (specifically: text-rendering pixel jitter inside sharp's libvips path), commit the 8 JPEGs as authoritative bytes and have the script `copyFile` rather than regenerate. Decision is made empirically — run gen TWICE, compare bytes; if equal, regen-from-svg pattern stands; if not, switch to commit-and-copyFile pattern.

- [ ] **Step 1: Write `scripts/gen-screensaver-photos.mjs`**

Mirror `gen-music-thumb.mjs` structure (paths, sharp params, error handling):

```javascript
#!/usr/bin/env node
// Deterministic generator for screensaver template's 8 sample JPEGs.
// 1920x1080 each, 8 distinct gradients with "Sample Photo N" text overlay.
// Sharp 0.34.5 pinned for determinism; if regeneration produces non-equal bytes
// across runs, switch to copyFile pattern (see Plan 4d play-icon precedent).

import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);
const IMAGES = join(PKG_ROOT, 'templates', 'screensaver', 'files', 'images');

// 8 distinct gradient color pairs (deterministic; visually distinct).
const PHOTOS = [
  { n: 1, top: '#1a3a8a', bot: '#0a1a4a' },
  { n: 2, top: '#2a8a3a', bot: '#0a4a1a' },
  { n: 3, top: '#8a3a2a', bot: '#4a0a0a' },
  { n: 4, top: '#7a2a8a', bot: '#3a0a4a' },
  { n: 5, top: '#8a7a2a', bot: '#4a3a0a' },
  { n: 6, top: '#2a7a8a', bot: '#0a3a4a' },
  { n: 7, top: '#5a5a5a', bot: '#1a1a1a' },
  { n: 8, top: '#8a4a6a', bot: '#3a1a2a' },
];

async function main() {
  await mkdir(IMAGES, { recursive: true });
  for (const p of PHOTOS) {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1920" height="1080" viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.top}" />
      <stop offset="1" stop-color="${p.bot}" />
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#g)" />
  <text x="960" y="600" text-anchor="middle" font-family="sans-serif" font-size="120" font-weight="700" fill="#FFFFFF" opacity="0.85">Sample Photo ${p.n}</text>
</svg>`;
    const file = `sample-photo-${p.n}.jpg`;
    await sharp(Buffer.from(svg))
      .jpeg({ quality: 82, mozjpeg: false, chromaSubsampling: '4:2:0' })
      .toFile(join(IMAGES, file));
    process.stdout.write(`wrote ${file}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`gen-screensaver-photos failed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
```

NOTE: `mozjpeg: false` ensures we use the deterministic libjpeg path, not mozjpeg's optimizer (which can vary slightly). `chromaSubsampling: '4:2:0'` is the default but pinning it explicitly removes one axis of variation.

- [ ] **Step 2: Run the script TWICE; compare byte-equality (DETERMINISM CHECK)**

```bash
mkdir -p /tmp/ssvr-gen-A /tmp/ssvr-gen-B
node packages/brs-gen/scripts/gen-screensaver-photos.mjs
cp packages/brs-gen/templates/screensaver/files/images/*.jpg /tmp/ssvr-gen-A/
node packages/brs-gen/scripts/gen-screensaver-photos.mjs
cp packages/brs-gen/templates/screensaver/files/images/*.jpg /tmp/ssvr-gen-B/
diff -r /tmp/ssvr-gen-A /tmp/ssvr-gen-B
echo "exit=$?"
```

Expected: exit=0 (byte-equal). If non-equal: STOP, switch to fallback Step 2-FALLBACK.

- [ ] **Step 2-FALLBACK (only if Step 2 shows byte-mismatch): commit JPEGs as authoritative + change script to `copyFile`**

Replicate the Plan 4d `play-icon` workaround:
1. Pick the run-A bytes as authoritative; commit them under `templates/screensaver/files/images/`.
2. Move them to a sibling directory (e.g. `scripts/_screensaver-photo-bytes/`) committed as the source of truth.
3. Rewrite `gen-screensaver-photos.mjs` to `copyFile(sibling, target)` for each of 8 files.
4. Verify: `diff` between sibling and target after running the script — must equal.
5. Document the decision inline in the script's header comment.

- [ ] **Step 3: Add asset-existence test**

Append to `packages/brs-gen/tests/asset-reuse.test.ts` OR add a new `screensaver-assets.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

const IMAGES = join(__dirname, '..', 'templates', 'screensaver', 'files', 'images');

describe('screensaver assets', () => {
  it('all 8 sample-photo JPEGs exist and are non-empty', async () => {
    for (let i = 1; i <= 8; i++) {
      const s = await stat(join(IMAGES, `sample-photo-${i}.jpg`));
      expect(s.isFile()).toBe(true);
      expect(s.size).toBeGreaterThan(1024);
    }
  });
});
```

OPTIONAL stronger check (image-magick / sharp-side dimension probe):

```typescript
import sharp from 'sharp';
it('all 8 JPEGs are 1920x1080', async () => {
  for (let i = 1; i <= 8; i++) {
    const meta = await sharp(join(IMAGES, `sample-photo-${i}.jpg`)).metadata();
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
    expect(meta.format).toBe('jpeg');
  }
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm -C packages/brs-gen exec vitest run`
Expected: All previously-green tests stay green PLUS the 1-2 new screensaver-assets tests PASS.

- [ ] **Step 5: Verify the snapshot tests from Tasks 4-7 still pass after assets land**

Run: `pnpm -C packages/brs-gen exec vitest run snapshots -t "screensaver"`
Expected: PASS (assets do not affect manifest / source / data snapshots).

- [ ] **Step 6: Commit (script + 8 JPEGs together)**

```bash
git add packages/brs-gen/scripts/gen-screensaver-photos.mjs packages/brs-gen/templates/screensaver/files/images/ packages/brs-gen/tests/
git commit -m "feat(screensaver): gen-screensaver-photos.mjs + 8 deterministic 1920x1080 JPEGs"
```

If the FALLBACK path was taken, the commit message becomes:
`feat(screensaver): gen-screensaver-photos.mjs + 8 authoritative JPEGs (copyFile pattern; Plan 4d carry-forward)`

---

## Phase 3: SceneGraph components

### Task 9: `HttpTask.xml` + `HttpTask.bs`

**Files:**
- Create: `packages/brs-gen/templates/screensaver/files/components/HttpTask.xml`
- Create: `packages/brs-gen/templates/screensaver/files/components/HttpTask.bs`
- Modify: `packages/brs-gen/tests/snapshots.test.ts`

**Context:** Per spec §5.5. Reuse the pattern from `news_channel/files/components/HttpTask.{xml,bs}`. Task subclass with declared `<interface>` fields (`url`, `response`). createObject-instantiated by `Screensaver.bs`, NEVER `<script>`-included into the Scene XML (Plan 4c lesson). The `.bs` file is BrighterScript; compile.ts sweep transforms `.bs` → `.brs` and rewrites the XML's `<script uri="...HttpTask.bs">` to `.brs`.

- [ ] **Step 1: Verify the news_channel reference**

Run: `cat packages/brs-gen/templates/news_channel/files/components/HttpTask.xml packages/brs-gen/templates/news_channel/files/components/HttpTask.bs`
Expected: A clean Task subclass with `init()` setting up `roUrlTransfer`, observer on `url` field, response field setter. Read closely; the screensaver version is essentially identical.

- [ ] **Step 2: Author `HttpTask.xml`**

Mirror news_channel's HttpTask.xml literally. The screensaver's HttpTask only fetches the operator-feed JSON (one request lifecycle), so the news_channel version is over-spec but harmless.

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<component name="HttpTask" extends="Task">
  <script type="text/brightscript" uri="pkg:/components/HttpTask.bs" />
  <interface>
    <field id="url"      type="string" />
    <field id="response" type="assocarray" />
  </interface>
</component>
```

- [ ] **Step 3: Author `HttpTask.bs`**

Mirror news_channel's HttpTask.bs literally. Must include the Roku-cert-required cert-setup boilerplate (`SetCertificatesFile("common:/certs/ca-bundle.crt")`, `InitClientCertificates()`, `EnablePeerVerification(true)`, `EnableHostVerification(true)`).

```brightscript
sub init()
    m.top.functionName = "doRequest"
end sub

sub doRequest()
    if m.top.url = invalid or m.top.url = "" then
        m.top.response = { ok: false, error: "no_url" }
        return
    end if
    transfer = CreateObject("roUrlTransfer")
    transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    transfer.InitClientCertificates()
    transfer.EnablePeerVerification(true)
    transfer.EnableHostVerification(true)
    transfer.SetUrl(m.top.url)
    body = transfer.GetToString()
    if body = "" then
        m.top.response = { ok: false, error: "empty" }
        return
    end if
    m.top.response = { ok: true, body: body }
end sub
```

- [ ] **Step 4: Add snapshot tests**

Append:

```typescript
it('HttpTask.xml matches saved snapshot', async () => {
  const s = await readFile(join(projectDir, 'components', 'HttpTask.xml'), 'utf8');
  await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/HttpTask.xml.snap.txt');
});

it('HttpTask.brs matches saved snapshot (post-compile)', async () => {
  const s = await readFile(join(projectDir, 'components', 'HttpTask.brs'), 'utf8');
  await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/HttpTask.brs.snap.txt');
});

it('HttpTask.xml has script URI rewritten to .brs (post-compile sweep)', async () => {
  const s = await readFile(join(projectDir, 'components', 'HttpTask.xml'), 'utf8');
  expect(s).toMatch(/uri="pkg:\/components\/HttpTask\.brs"/);
  expect(s).not.toMatch(/uri="pkg:\/components\/HttpTask\.bs"/);
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm -C packages/brs-gen exec vitest run snapshots -t "screensaver"`
Expected: PASS, snapshots created.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/templates/screensaver/files/components/HttpTask.xml packages/brs-gen/templates/screensaver/files/components/HttpTask.bs packages/brs-gen/tests/snapshots.test.ts packages/brs-gen/tests/__snapshots__/screensaver/
git commit -m "feat(screensaver): HttpTask component (createObject-only; news_channel pattern)"
```

---

### Task 10: `PhotoCycle.xml` + `PhotoCycle.bs`

**Files:**
- Create: `packages/brs-gen/templates/screensaver/files/components/PhotoCycle.xml`
- Create: `packages/brs-gen/templates/screensaver/files/components/PhotoCycle.bs`
- Modify: `packages/brs-gen/tests/snapshots.test.ts`

**Context:** Per spec §5.4. Composite `Group` with 2 Posters (pingpong), 4 Animations (crossfade, kenBurnsA, kenBurnsB, pixelShift), 1 Timer. PhotoCycle's `init()` MUST programmatically set `control = "start"` on every Animation it owns (idempotent guard against XML inline `control="start"` not taking effect at scene load — reference repo CityBackground.brs lesson). Locks Ken Burns Animation duration to `m.top.transitionSeconds` (spec §5.4).

- [ ] **Step 1: Author `PhotoCycle.xml`**

Verbatim from spec §5.4:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<component name="PhotoCycle" extends="Group">
  <script type="text/brightscript" uri="pkg:/components/PhotoCycle.bs" />

  <interface>
    <field id="photos"             type="array"   value="[]" />
    <field id="transitionSeconds"  type="integer" value="7" />
    <field id="motion"             type="string"  value="ken_burns" />
    <field id="currentIndex"       type="integer" value="0" />
  </interface>

  <children>
    <Group id="content" translation="[0,0]">
      <Poster id="posterA" width="1920" height="1080" loadDisplayMode="scaleToFill" opacity="1.0" />
      <Poster id="posterB" width="1920" height="1080" loadDisplayMode="scaleToFill" opacity="0.0" />
    </Group>

    <Timer id="cycleTimer" repeat="true" duration="7" />

    <Animation id="crossfade" duration="1.0" repeat="false" easeFunction="inOutCubic">
      <FloatFieldInterpolator fieldToInterp="posterA.opacity" key="[0.0, 1.0]" keyValue="[1.0, 0.0]" />
      <FloatFieldInterpolator fieldToInterp="posterB.opacity" key="[0.0, 1.0]" keyValue="[0.0, 1.0]" />
    </Animation>

    <Animation id="kenBurnsA" duration="7" repeat="false" easeFunction="linear" control="start">
      <Vector2DFieldInterpolator fieldToInterp="posterA.translation" key="[0.0, 1.0]" keyValue="[ [0,0], [-40,-30] ]" />
      <Vector2DFieldInterpolator fieldToInterp="posterA.scale"       key="[0.0, 1.0]" keyValue="[ [1.0,1.0], [1.05,1.05] ]" />
    </Animation>

    <Animation id="kenBurnsB" duration="7" repeat="false" easeFunction="linear">
      <Vector2DFieldInterpolator fieldToInterp="posterB.translation" key="[0.0, 1.0]" keyValue="[ [0,0], [-40,-30] ]" />
      <Vector2DFieldInterpolator fieldToInterp="posterB.scale"       key="[0.0, 1.0]" keyValue="[ [1.0,1.0], [1.05,1.05] ]" />
    </Animation>

    <Animation id="pixelShift" duration="90" repeat="true" easeFunction="inOutQuad" control="start">
      <Vector2DFieldInterpolator
        fieldToInterp="content.translation"
        key="[0.0, 0.25, 0.50, 0.75, 1.0]"
        keyValue="[ [0,0], [8,5], [0,0], [-8,-5], [0,0] ]" />
    </Animation>
  </children>
</component>
```

- [ ] **Step 2: Author `PhotoCycle.bs`**

Per spec §5.4 init() responsibilities:

```brightscript
sub init()
    m.cycleTimer    = m.top.findNode("cycleTimer")
    m.crossfadeAnim = m.top.findNode("crossfade")
    m.kenBurnsAAnim = m.top.findNode("kenBurnsA")
    m.kenBurnsBAnim = m.top.findNode("kenBurnsB")
    m.pixelShiftAnim = m.top.findNode("pixelShift")
    m.posterA = m.top.findNode("posterA")
    m.posterB = m.top.findNode("posterB")

    m.activeIsA = true
    m.elapsedSec = 0

    ' Lock Ken Burns duration to the configured transitionSeconds so the pan
    ' completes exactly when the swap happens (avoids low-transitionSeconds bug).
    m.kenBurnsAAnim.duration = m.top.transitionSeconds
    m.kenBurnsBAnim.duration = m.top.transitionSeconds
    m.cycleTimer.duration = m.top.transitionSeconds

    ' Idempotent control=start guard (XML inline control="start" can fail at scene load).
    m.kenBurnsAAnim.control = "start"
    m.kenBurnsBAnim.control = "start"
    m.pixelShiftAnim.control = "start"

    m.posterA.observeField("loadStatus", "onPosterLoad")
    m.posterB.observeField("loadStatus", "onPosterLoad")
    m.cycleTimer.observeField("fire", "onCycleTimerFire")
    m.top.observeField("photos", "onPhotosChanged")
end sub

sub onPhotosChanged()
    if m.top.photos = invalid then return
    if m.top.photos.count() = 0 then return
    m.top.currentIndex = 0
    m.posterA.uri = m.top.photos[0].url
    m.activeIsA = true
    m.elapsedSec = 0
    m.cycleTimer.control = "start"
end sub

sub onCycleTimerFire()
    m.elapsedSec = m.elapsedSec + 1
    if m.elapsedSec >= m.top.transitionSeconds - 1 then
        ' Kick off crossfade + load next photo into the inactive poster.
        nextIndex = (m.top.currentIndex + 1) mod m.top.photos.count()
        if m.activeIsA then
            m.posterB.uri = m.top.photos[nextIndex].url
        else
            m.posterA.uri = m.top.photos[nextIndex].url
        end if

        if m.top.motion <> "none" then
            m.crossfadeAnim.control = "start"
        end if

        m.top.currentIndex = nextIndex
        m.activeIsA = not m.activeIsA
        m.elapsedSec = 0

        if m.top.motion = "ken_burns" then
            if m.activeIsA then
                m.kenBurnsAAnim.control = "start"
            else
                m.kenBurnsBAnim.control = "start"
            end if
        end if
    end if
end sub

sub onPosterLoad(event as object)
    status = event.getData()
    if status = "failed" then
        print "[PhotoCycle] poster failed to load; skipping frame"
    end if
end sub
```

- [ ] **Step 3: Add snapshot tests + structural assertions**

```typescript
it('PhotoCycle.xml matches saved snapshot', async () => {
  const s = await readFile(join(projectDir, 'components', 'PhotoCycle.xml'), 'utf8');
  await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/PhotoCycle.xml.snap.txt');
});

it('PhotoCycle.brs matches saved snapshot (post-compile)', async () => {
  const s = await readFile(join(projectDir, 'components', 'PhotoCycle.brs'), 'utf8');
  await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/PhotoCycle.brs.snap.txt');
});

it('PhotoCycle.xml declares the 5 named animations and 4 interface fields', async () => {
  const s = await readFile(join(projectDir, 'components', 'PhotoCycle.xml'), 'utf8');
  for (const animId of ['crossfade', 'kenBurnsA', 'kenBurnsB', 'pixelShift']) {
    expect(s).toMatch(new RegExp(`<Animation\\s+id="${animId}"`));
  }
  for (const field of ['photos', 'transitionSeconds', 'motion', 'currentIndex']) {
    expect(s).toMatch(new RegExp(`<field\\s+id="${field}"`));
  }
  expect(s).toMatch(/<Timer\s+id="cycleTimer"/);
});

it('PhotoCycle.brs locks kenBurns duration to transitionSeconds and uses programmatic control=start', async () => {
  const s = await readFile(join(projectDir, 'components', 'PhotoCycle.brs'), 'utf8');
  expect(s).toMatch(/m\.kenBurnsAAnim\.duration\s*=\s*m\.top\.transitionSeconds/);
  expect(s).toMatch(/m\.kenBurnsBAnim\.duration\s*=\s*m\.top\.transitionSeconds/);
  expect(s).toMatch(/m\.pixelShiftAnim\.control\s*=\s*"start"/);
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm -C packages/brs-gen exec vitest run snapshots -t "screensaver"`
Expected: PASS, snapshots created.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/templates/screensaver/files/components/PhotoCycle.xml packages/brs-gen/templates/screensaver/files/components/PhotoCycle.bs packages/brs-gen/tests/snapshots.test.ts packages/brs-gen/tests/__snapshots__/screensaver/
git commit -m "feat(screensaver): PhotoCycle component (2-poster pingpong + crossfade + Ken Burns + pixel shift)"
```

---

### Task 11: `Screensaver.xml` + `Screensaver.bs` (root scene + init-hook firing)

**Files:**
- Create: `packages/brs-gen/templates/screensaver/files/components/Screensaver.xml`
- Create: `packages/brs-gen/templates/screensaver/files/components/Screensaver.bs`
- Modify: `packages/brs-gen/tests/snapshots.test.ts`

**Context:** Per spec §5.3. Root scene, observed by `RunScreenSaver()`. Auto-injected `<script>` tags by the merger: `_template/config.bs`, `_modules/__init_hooks.bs`. Manual `<script>` for `pkg:/source/lib/Feed.brs` is REQUIRED (silent runtime failure otherwise — Plan 4c lesson). Init-hook dispatcher `Modules_OnScreensaverAfterSceneShow` is auto-emitted (Plan 3 engine pattern, name derived by `dispatchFuncName('Screensaver', 'after_scene_show')`).

- [ ] **Step 1: Author `Screensaver.xml`**

Per spec §5.3. NOTE: explicit `<script>` for `pkg:/source/lib/Feed.brs` is the load-bearing line; everything else either auto-injects or follows existing patterns.

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<component name="Screensaver" extends="Scene">
  <script type="text/brightscript" uri="pkg:/components/Screensaver.bs" />
  <script type="text/brightscript" uri="pkg:/source/lib/Feed.brs" />

  <interface>
    <field id="currentPhotoIndex" type="integer" value="0" />
  </interface>

  <children>
    <PhotoCycle id="photoCycle" />
  </children>
</component>
```

NOTE: HttpTask is NOT a `<children>` entry; it's instantiated via `createObject("roSGNode", "HttpTask")` in `Screensaver.bs` only when `feed_url` is set. Plan 4c lesson: `<script>`-including HttpTask.bs in the Scene caused duplicate `init()` triggering; the `<children>` form has the same risk via auto-script-include of the child's own .bs. By keeping HttpTask out of `<children>`, we ensure init runs exactly once.

CONFIRM: read Plan 4c memory notes (`plan-4c-news.md`) to verify whether news_channel uses `<children><HttpTask /></children>` or `createObject` only. The reference repo and §5.3 of the spec both say createObject-only; honor that.

- [ ] **Step 2: Author `Screensaver.bs`**

```brightscript
sub init()
    m.photoCycle = m.top.findNode("photoCycle")
    m.feedTaskRef = invalid

    cfg = TemplateConfig()

    ' Configure the cycle from TemplateConfig.
    transitionSec = 7
    if cfg.transition_seconds <> invalid then
        transitionSec = Val(cfg.transition_seconds)
        if transitionSec < 4 then transitionSec = 7
    end if
    m.photoCycle.transitionSeconds = transitionSec
    if cfg.motion <> invalid then
        m.photoCycle.motion = cfg.motion
    end if

    ' Bind feed: operator URL if set, else bundled.
    if cfg.feed_url <> invalid and cfg.feed_url <> "" then
        m.feedTaskRef = CreateObject("roSGNode", "HttpTask")
        m.feedTaskRef.observeField("response", "onFeedResponse")
        m.feedTaskRef.url = cfg.feed_url
        m.feedTaskRef.control = "RUN"
    else
        feed = ScreensaverFeed_LoadBundled()
        bindFeed(feed)
    end if

    Modules_OnScreensaverAfterSceneShow(m)
end sub

sub onFeedResponse(event as object)
    resp = event.getData()
    if resp = invalid or resp.ok = false or resp.body = invalid then
        ' Operator feed failed; fall back to bundled so the screensaver still renders.
        feed = ScreensaverFeed_LoadBundled()
        bindFeed(feed)
        return
    end if
    feed = ScreensaverFeed_LoadOperator(resp.body)
    bindFeed(feed)
end sub

sub bindFeed(feed as object)
    nodes = ScreensaverFeed_BuildContentNodes(feed)
    if nodes.count() = 0 then
        ' Defensive: empty feed -> bundled fallback.
        bundled = ScreensaverFeed_LoadBundled()
        nodes = ScreensaverFeed_BuildContentNodes(bundled)
    end if
    photoData = []
    for each n in nodes
        photoData.push({ url: n.url, title: n.title })
    end for
    m.photoCycle.observeField("currentIndex", "onCurrentIndexChanged")
    m.photoCycle.photos = photoData
end sub

sub onCurrentIndexChanged()
    m.top.currentPhotoIndex = m.photoCycle.currentIndex
end sub
```

NOTE: PhotoCycle's `photos` field is declared `type="array"`; we pass plain assocArrays (`{ url, title }`) NOT ContentNodes, since PhotoCycle reads `.url` directly. ContentNodes work too but assocArrays keep the field schema simple.

CONFIRM: read other templates' patterns for whether `photos` field should be ContentNode array vs plain assocarray; if news_channel/music_player uses ContentNode arrays for similar fields, mirror them.

- [ ] **Step 3: Add snapshot tests + assertions for init-hook firing**

```typescript
it('Screensaver.xml matches saved snapshot', async () => {
  const s = await readFile(join(projectDir, 'components', 'Screensaver.xml'), 'utf8');
  await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/Screensaver.xml.snap.txt');
});

it('Screensaver.brs matches saved snapshot (post-compile)', async () => {
  const s = await readFile(join(projectDir, 'components', 'Screensaver.brs'), 'utf8');
  await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/Screensaver.brs.snap.txt');
});

it('Screensaver.xml has explicit <script> for source/lib/Feed.brs (Plan 4c invariant)', async () => {
  const s = await readFile(join(projectDir, 'components', 'Screensaver.xml'), 'utf8');
  expect(s).toMatch(/<script\s+type="text\/brightscript"\s+uri="pkg:\/source\/lib\/Feed\.brs"\s*\/>/);
});

it('Screensaver.brs fires the after_scene_show init hook', async () => {
  const s = await readFile(join(projectDir, 'components', 'Screensaver.brs'), 'utf8');
  expect(s).toContain('Modules_OnScreensaverAfterSceneShow(m)');
});

it('__init_hooks.bs declares Modules_OnScreensaverAfterSceneShow', async () => {
  const s = await readFile(join(projectDir, 'source', '_modules', '__init_hooks.brs'), 'utf8');
  // The dispatcher always exists even with zero modules (empty body).
  expect(s).toMatch(/sub\s+Modules_OnScreensaverAfterSceneShow\s*\(\s*m\s+as\s+object\s*\)\s+as\s+void/);
});

it('full files listing matches saved snapshot', async () => {
  const { readdirSync, statSync } = await import('node:fs');
  function walk(dir: string, base: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir).sort()) {
      const p = join(dir, entry);
      const rel = base ? `${base}/${entry}` : entry;
      if (statSync(p).isDirectory()) out.push(...walk(p, rel));
      else out.push(rel);
    }
    return out;
  }
  const listing = walk(projectDir, '').join('\n') + '\n';
  await expect(listing).toMatchFileSnapshot('__snapshots__/screensaver/files-listing.snap.txt');
});

it('__init_hooks.bs (or .brs) post-compile matches saved snapshot', async () => {
  const s = await readFile(join(projectDir, 'source', '_modules', '__init_hooks.brs'), 'utf8');
  await expect(s).toMatchFileSnapshot('__snapshots__/screensaver/__init_hooks.brs.snap.txt');
});
```

- [ ] **Step 4: Run tests**

Run: `pnpm -C packages/brs-gen exec vitest run snapshots -t "screensaver"`
Expected: PASS. All snapshots created. Listing snapshot will show all generated files (manifest, source/main.brs, source/lib/Feed.brs, source/_template/config.brs, source/_modules/__init_hooks.brs, components/{Screensaver,PhotoCycle,HttpTask}.{xml,brs}, data/screensaver-feed.json, images/sample-photo-{1..8}.jpg).

- [ ] **Step 5: Build to confirm TS clean**

Run: `pnpm -C packages/brs-gen build`
Expected: PASS.

- [ ] **Step 6: Run full test suite to confirm nothing else regressed**

Run: `pnpm -C packages/brs-gen exec vitest run`
Expected: All tests PASS. (Task 1's stub-fail test should now pass since the screensaver template exists.)

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/templates/screensaver/files/components/Screensaver.xml packages/brs-gen/templates/screensaver/files/components/Screensaver.bs packages/brs-gen/tests/snapshots.test.ts packages/brs-gen/tests/__snapshots__/screensaver/
git commit -m "feat(screensaver): Screensaver root scene (init-hook firing + bundled/operator feed binding)"
```

---

## Phase 4: Gold-standard tests

### Task 12: Conflict-matrix entry + determinism test

**Files:**
- Modify: `packages/brs-gen/tests/conflict-matrix.test.ts`
- Modify: `packages/brs-gen/tests/determinism.test.ts`

**Context:** Each new template gets a `template + []` (no modules) entry in the conflict-matrix and a full-pipeline byte-equality test in the determinism suite. Mirror the music_player patterns at lines 335-344 and 284-304 / 391-409 respectively.

- [ ] **Step 1: Add conflict-matrix entry**

Append to `packages/brs-gen/tests/conflict-matrix.test.ts`:

```typescript
describe('conflict-matrix: screensaver entries', () => {
  it('screensaver + no modules: merges cleanly', async () => {
    const cat = await loadCatalog(PKG_ROOT);
    const template = cat.templates.get('screensaver')!;
    expect(template).toBeDefined();
    const result = await runEntry(template, []);
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Add determinism helper + test**

Append to `packages/brs-gen/tests/determinism.test.ts`. Mirror the `generateMusicPlayer` helper at lines 391-409:

```typescript
async function generateScreensaver(workDir: string): Promise<{ ok: boolean }> {
  const cat = await loadCatalog(PKG_ROOT);
  setCatalogForTests(cat);
  const handler = getGenerateAppHandler();
  const result = await handler({
    spec: {
      spec_version: 2,
      template: 'screensaver',
      modules: [],
      app: { name: 'Screensaver Determinism', major_version: 0, minor_version: 1, build_version: 0 },
    },
    output_dir: join(workDir, 'project'),
    zip: { output_zip: join(workDir, 'project.zip') },
  });
  return result as { ok: boolean };
}

it('screensaver full-pipeline byte equality across two in-process runs', async () => {
  process.env.TZ = 'UTC';
  const dirA = tmp('ssvr-det-a');
  const dirB = tmp('ssvr-det-b');
  await mkdir(dirA, { recursive: true });
  await mkdir(dirB, { recursive: true });
  try {
    const resultA = await generateScreensaver(dirA);
    const resultB = await generateScreensaver(dirB);
    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    const zipA = await readFile(join(dirA, 'project.zip'));
    const zipB = await readFile(join(dirB, 'project.zip'));
    expect(zipA.equals(zipB)).toBe(true);
  } finally {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests**

Run: `pnpm -C packages/brs-gen exec vitest run conflict-matrix determinism`
Expected: PASS.

If determinism FAILS, the most likely cause is non-deterministic JPEG bytes (Task 8 fallback path was needed but not taken). Re-run Task 8 Step 2's diff check; if non-equal, switch to copyFile pattern.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/tests/conflict-matrix.test.ts packages/brs-gen/tests/determinism.test.ts
git commit -m "test(brs-gen): conflict-matrix + determinism entries for screensaver template"
```

---

### Task 13: E2E golden test + regen

**Files:**
- Modify: `packages/brs-gen/tests/e2e.test.ts`
- Modify: `packages/brs-gen/scripts/regen-golden.mjs` (add screensaver entry)
- Create (via script): `packages/brs-gen/tests/__golden__/screensaver.zip`
- Create (via script): `packages/brs-gen/tests/__golden__/screensaver.provenance.json`

**Context:** Per spec §11. Mirror music_player's e2e block at lines 577-656. The regen-golden.mjs script is the source of truth for generating the golden zip + provenance. Run with `TZ=UTC` (mandatory; yazl 2.5.x DOS-time encoding requirement, root-cause documented in MEMORY.md).

- [ ] **Step 1: Inspect regen-golden.mjs to see how to add a new template**

Run: `cat packages/brs-gen/scripts/regen-golden.mjs`
Expected: A loop or list of template ids; add `'screensaver'` alongside others.

- [ ] **Step 2: Add `screensaver` entry to regen-golden.mjs**

Mirror existing entries. Likely a list literal:

```javascript
const TEMPLATES = ['video_grid_channel', 'blank_scenegraph', 'news_channel', 'music_player', 'screensaver'];
```

If the script uses per-template SPEC objects, add:

```javascript
{
  templateId: 'screensaver',
  goldenZip: 'screensaver.zip',
  goldenProvenance: 'screensaver.provenance.json',
  spec: {
    spec_version: 2,
    template: 'screensaver',
    modules: [],
    app: { name: 'Screensaver E2E', major_version: 0, minor_version: 1, build_version: 0 },
  },
}
```

NOTE: the spec passed here MUST be byte-identical to the spec used in the e2e test below (Step 4); `app.name` mismatch will cause hash mismatch.

- [ ] **Step 3: Generate the golden artifacts**

Run: `TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs`
Expected: writes `tests/__golden__/screensaver.zip` and `tests/__golden__/screensaver.provenance.json`. Existing goldens (stub, video-grid, blank, news, music) re-emit identical bytes (no diff vs HEAD). If existing goldens change, STOP — that means the engine prep tasks (1, 2) regressed something; investigate before proceeding.

- [ ] **Step 4: Add e2e test block**

Append to `packages/brs-gen/tests/e2e.test.ts`. Mirror music_player's block at lines 577-656 with `screensaver` substituted for `music_player` everywhere:

```typescript
describe('screensaver', () => {
  const CANONICAL_SCREENSAVER_SPEC = {
    spec_version: 2,
    template: 'screensaver',
    modules: [],
    app: { name: 'Screensaver E2E', major_version: 0, minor_version: 1, build_version: 0 },
  };

  let workDir: string;
  let outputDir: string;
  let zipPath: string;
  let client: McpChild;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'brs-gen-e2e-ssvr-'));
    outputDir = join(workDir, 'project');
    zipPath = join(workDir, 'project.zip');

    client = new McpChild();
    const initResp = await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'brs-gen-e2e-screensaver', version: '1' },
    });
    if (initResp.error) throw new Error(`screensaver initialize failed: ${JSON.stringify(initResp.error)}`);

    const gen = await client.request('tools/call', {
      name: 'generate_app',
      arguments: {
        spec: CANONICAL_SCREENSAVER_SPEC,
        output_dir: outputDir,
        zip: { output_zip: zipPath },
      },
    });
    if (gen.error) throw new Error(`screensaver generate_app failed: ${JSON.stringify(gen.error)}`);
    parseToolPayload(gen.result);
  }, 60_000);

  afterAll(async () => {
    client.kill();
    await rm(workDir, { recursive: true, force: true });
  });

  it('generate_app on screensaver produces byte-equal golden zip + provenance', async () => {
    const emitted = await readFile(zipPath);
    const golden = await readFile(join(GOLDEN_DIR, 'screensaver.zip'));
    expect(emitted.equals(golden)).toBe(true);

    const emittedProv = await readFile(join(outputDir, '.rokudev-tools', 'provenance.json'));
    const goldenProv = await readFile(join(GOLDEN_DIR, 'screensaver.provenance.json'));
    expect(emittedProv.equals(goldenProv)).toBe(true);
  }, 10_000);

  it('validate_manifest returns ok:true on the screensaver project', async () => {
    const vm = await client.request('tools/call', {
      name: 'validate_manifest',
      arguments: { project_dir: outputDir },
    });
    expect(vm.error).toBeUndefined();
    const payload = parseToolPayload(vm.result);
    expect(payload['ok']).toBe(true);
  }, 15_000);

  it('lint reports no errors on the screensaver project', async () => {
    const lintResp = await client.request('tools/call', {
      name: 'lint',
      arguments: { project_dir: outputDir },
    });
    expect(lintResp.error).toBeUndefined();
    const payload = parseToolPayload(lintResp.result);
    expect(payload['ok']).toBe(true);
    expect(
      (payload['diagnostics'] as Array<{ severity: string }>).filter((d) => d.severity === 'error'),
    ).toEqual([]);
  });
});
```

- [ ] **Step 5: Run e2e test**

Run: `TZ=UTC pnpm -C packages/brs-gen exec vitest run e2e -t "screensaver"`
Expected: PASS (3 sub-tests).

NOTE: `lint` may surface BrighterScript warnings on the new components. Errors are the gate; warnings are informational. If errors appear, fix the `.bs` files (most likely culprits: missing imports, reserved-word use, unused variables in strict mode).

- [ ] **Step 6: Run full vitest sweep**

Run: `pnpm -C packages/brs-gen exec vitest run`
Expected: ALL tests PASS. Baseline now ~835+ tests (up from 808).

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/tests/e2e.test.ts packages/brs-gen/scripts/regen-golden.mjs packages/brs-gen/tests/__golden__/screensaver.zip packages/brs-gen/tests/__golden__/screensaver.provenance.json
git commit -m "test(brs-gen): screensaver e2e golden zip + lint + validate_manifest"
```

---

## Phase 5: T27 device verification

### Task 14: `assertActiveAppIsOurs` `screensaverMode` opt + unit test

**Files:**
- Modify: `packages/brs-gen/scripts/_t27-lib.mjs:65-78` (the `assertActiveAppIsOurs` helper)
- Test: extend an existing `_t27-lib.test.mjs` if it exists; otherwise add inline test in t27-screensaver.mjs (the helper is internal to scripts/)

**Context:** Per spec §10 D-impl-3 + the API shape pre-commit. Existing helper checks `id === 'dev'`. For screensaver context, `/query/active-app` returns `type='ssvr'` (per Roku ECP docs + reference repo CERT_CHECKLIST). The `id` may or may not be `'dev'` — verify on first T27 run. We commit to the API shape: `assertActiveAppIsOurs(host, opts?)` where `opts.screensaverMode === true` accepts EITHER `id === 'dev'` OR `type === 'ssvr'` (whichever the device returns).

- [ ] **Step 1: Read the existing helper**

Run: `cat packages/brs-gen/scripts/_t27-lib.mjs`
Expected: locate `assertActiveAppIsOurs` (around lines 65-78). Note its current signature.

- [ ] **Step 2: Locate where `screenshotNoError` calls `assertActiveAppIsOurs`**

Run: `grep -n "assertActiveAppIsOurs" packages/brs-gen/scripts/_t27-lib.mjs`
Expected: at least one call inside `screenshotNoError`.

- [ ] **Step 3: Extend `assertActiveAppIsOurs` to accept opts**

Replace the function with:

```javascript
async function assertActiveAppIsOurs(host, opts = {}) {
  const { screensaverMode = false } = opts;
  const client = new EcpClient(host);
  let lastSeen = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await client.activeApp();
    lastSeen = a;
    if (screensaverMode) {
      // Sideloaded screensaver: accept either id='dev' OR type='ssvr'.
      if (a.id === 'dev' || a.type === 'ssvr') return;
    } else {
      if (a.id === 'dev') return;
    }
    if (attempt === 0) await sleep(250);
  }
  const expected = screensaverMode ? `id='dev' OR type='ssvr'` : `id='dev'`;
  throw new Error(
    `active-app check failed (expected ${expected}; got id='${lastSeen?.id ?? ''}', ` +
      `type='${lastSeen?.type ?? ''}', name='${lastSeen?.name ?? ''}')`,
  );
}
```

- [ ] **Step 4: Extend `screenshotNoError` to pass through the opt (if present)**

Locate `export async function screenshotNoError(host, password, outPath)` (around line 84). Change signature to:

```javascript
export async function screenshotNoError(host, password, outPath, opts = {}) {
  await assertActiveAppIsOurs(host, opts);
  // ...rest unchanged
}
```

NOTE: existing callers pass 3 args; default opts={} preserves prior behavior. The `screensaverMode: true` path is opt-in.

- [ ] **Step 5: Add a smoke unit test for the helper extension**

Create `packages/brs-gen/scripts/_t27-lib.test.mjs` (if not present) OR extend an existing test file. The helper relies on a real ECP server, so use vitest with an http-mock or fetch-mock to simulate `/query/active-app` responses.

If mocking proves cumbersome, document in the task: "Skip unit test; functional coverage comes from the t27-screensaver.mjs run on real device." That is acceptable: the helper is used by exactly one new caller (t27-screensaver.mjs), and the device run will exercise it.

- [ ] **Step 6: Run any test that uses _t27-lib.mjs**

Run: `pnpm -C packages/brs-gen exec vitest run`
Expected: PASS (no regression in existing T27 callers; they don't pass `screensaverMode` so default behavior is unchanged).

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/scripts/_t27-lib.mjs packages/brs-gen/scripts/_t27-lib.test.mjs
git commit -m "feat(brs-gen): assertActiveAppIsOurs accepts screensaverMode opt (Plan 4e prep)"
```

---

### Task 15: `t27-screensaver.mjs` driver

**Files:**
- Create: `packages/brs-gen/scripts/t27-screensaver.mjs`

**Context:** Per spec §10. Screensavers do NOT launch via `/launch/dev` — they activate via system idle-timer OR via the dev-portal "Test Screensaver" trigger. Three options for T27 trigger (preference order):
- **Option A**: dev-portal HTTP form-POST to `/plugin_inspect` with a screensaver-specific `mysubmit` value. Try this first.
- **Option B**: sideload + manual instruction to operator to set screensaver in Settings + idle wait.
- **Option C**: skip on-device; rely on snapshots + manifest validation (mirrors `blank_scenegraph` Phase B deferral).

The decision among A/B/C is empirical: the script attempts A; if A returns 4xx/5xx or doesn't trigger, fall back to B (logs prominent operator instructions); document outcome in the run log.

- [ ] **Step 1: Read the music_player T27 driver as the structural template**

Run: `cat packages/brs-gen/scripts/t27-music.mjs`
Expected: import structure, assertStep helper, generate+sideload+launch sequence, screenshot capture cadence.

- [ ] **Step 2: Read the news_channel T27 for Home + ECP launch pattern (Plan 4c)**

Run: `cat packages/brs-gen/scripts/t27-news.mjs | head -150`
Expected: Phase A vs Phase B preamble pattern. We do NOT want the Phase A `sideloadAndLaunch` for screensaver; we want sideload + screensaver-trigger.

- [ ] **Step 3: Author `t27-screensaver.mjs` skeleton**

Mirror music_player's structure for setup (env vars, host/password resolution, generate+zip, summary tracking). Diverge for the trigger phase:

```javascript
#!/usr/bin/env node
// T27 driver for the screensaver template.
// Phase A: bundled feed; trigger via dev-portal (Option A) with fallback to manual (Option B).
// Phase B: operator feed-URL override (deferred per spec §10).

import { mkdir, mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { request as undiciRequest, FormData } from 'undici';
import {
  sideload,                     // sideload-only (no launch); confirm exists in _t27-lib
  screenshotNoError,
  sleep,
  // any other needed helpers
} from './_t27-lib.mjs';
import { generateAppForRegen } from './regen-helper.mjs';
import { EcpClient } from '@rokudev/device-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);

const host = process.env.ROKUDEV_DEFAULT_ROKU_HOST;
const password = process.env.ROKUDEV_ROKU_DEV_PASSWORD ?? '1234';
if (!host) {
  process.stderr.write('ROKUDEV_DEFAULT_ROKU_HOST env var required\n');
  process.exit(2);
}

const summary = { passed: [], failed: [] };
function assertStep(name, thunk) {
  return thunk()
    .then((v) => { summary.passed.push(name); return v; })
    .catch((e) => {
      summary.failed.push({ name, message: String(e && e.message ? e.message : e) });
      throw e;
    });
}

// Trigger Option A: dev-portal form-POST.
// The Roku dev portal exposes "Screensaver" preview at /plugin_inspect with a specific
// form field. The exact mysubmit value is reverse-engineered on first run.
// Hypothesis: mysubmit="Test screensaver" or mysubmit="Screensaver".
async function triggerScreensaverViaDevPortal(host, password) {
  // First: GET /plugin_inspect to discover the form fields available for screensavers.
  // Look for input[type=submit][value="..."] entries; any with "screensaver" or "test"
  // in the value is a candidate.
  // Then: form-POST with multipart/form-data, mysubmit=<discovered value>.
  // Document the exact mysubmit value once observed.
  // Reference: see packages/roku-device-client/src/devportal/inspect.ts for digest auth.

  // PSEUDOCODE: this is the load-bearing experiment of Task 16.
  throw new Error('triggerScreensaverViaDevPortal: not yet implemented; see Task 16 for discovery');
}

async function main() {
  const workDir = await mkdtemp(join(tmpdir(), 't27-ssvr-'));
  const outputDir = join(workDir, 'project');
  const outputZip = join(workDir, 'project.zip');
  const screensDir = join(workDir, 'screens');
  await mkdir(screensDir, { recursive: true });

  const specPath = /* canonical spec inline OR write to tmp file */;

  try {
    // Phase A
    await assertStep('generate_app', () =>
      generateAppForRegen({ outputDir, spec: specPath, outputZip }),
    );

    await assertStep('sideload (no launch)', () => sideload(outputZip, host, password));

    // Try Option A; if it throws, fall back to Option B (manual).
    let triggerPath = 'A';
    try {
      await assertStep('trigger screensaver (dev-portal)', () =>
        triggerScreensaverViaDevPortal(host, password),
      );
    } catch (e) {
      triggerPath = 'B';
      process.stdout.write(`[t27-screensaver] Option A failed: ${e.message}\n`);
      process.stdout.write(`[t27-screensaver] FALLBACK: please set this channel as your active screensaver\n`);
      process.stdout.write(`[t27-screensaver]   in Settings > Theme > Screensavers > Custom > <channel name>,\n`);
      process.stdout.write(`[t27-screensaver]   then leave the device idle. Waiting 90s for activation...\n`);
      await sleep(90_000);
    }

    // Wait transition_seconds + 2 = 9s for first photo to render.
    await sleep(9_000);

    // Screenshot 1: assert no error overlay; assert active app is screensaver.
    await assertStep('clean screensaver render (screenshot 1)', () =>
      screenshotNoError(host, password, join(screensDir, 'A1.png'), { screensaverMode: true }),
    );

    // Wait another transition_seconds + 2 = 9s for cycle to advance.
    await sleep(9_000);

    // Screenshot 2: assert different from screenshot 1 (cycle is running).
    await assertStep('cycle advanced (screenshot 2 differs from 1)', async () => {
      await screenshotNoError(host, password, join(screensDir, 'A2.png'), { screensaverMode: true });
      const { readFileSync } = await import('node:fs');
      const { createHash } = await import('node:crypto');
      const h1 = createHash('sha256').update(readFileSync(join(screensDir, 'A1.png'))).digest('hex');
      const h2 = createHash('sha256').update(readFileSync(join(screensDir, 'A2.png'))).digest('hex');
      if (h1 === h2) throw new Error('cycle did not advance: screenshots are byte-equal');
    });

    // Optional: query active-app and document what device returns.
    await assertStep('document /query/active-app (informational)', async () => {
      const ecp = new EcpClient(host);
      const a = await ecp.activeApp();
      process.stdout.write(`[t27-screensaver] /query/active-app: ${JSON.stringify(a)}\n`);
    });

    process.stdout.write(`[t27-screensaver] Phase A complete (trigger path: ${triggerPath})\n`);
  } finally {
    process.stdout.write(`\n=== Summary ===\nPassed: ${summary.passed.length}\nFailed: ${summary.failed.length}\n`);
    for (const f of summary.failed) {
      process.stdout.write(`  FAIL: ${f.name} -- ${f.message}\n`);
    }
    process.exit(summary.failed.length > 0 ? 1 : 0);
  }
}

main().catch((err) => {
  process.stderr.write(`t27-screensaver crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
```

NOTE: `sideload` (without launch) may not exist as a standalone helper in `_t27-lib.mjs`; only `sideloadAndLaunch` may exist. If so, EITHER add a `sideload` helper that does the dev-portal upload but skips the ECP launch, OR have the screensaver T27 use a low-level sideload via `@rokudev/device-client`'s `DevPortalInstall` directly. Verify by reading `_t27-lib.mjs` and `packages/roku-device-client/src/devportal/install.ts`.

- [ ] **Step 4: Add a `sideload` helper to `_t27-lib.mjs` if missing**

If `_t27-lib.mjs` only exposes `sideloadAndLaunch`, factor out a `sideload(zipPath, host, password)` that does just the `/plugin_install` POST without the subsequent `EcpControl.launch('dev')` call. Both helpers can share the underlying `DevPortalInstall` invocation; `sideloadAndLaunch` becomes `sideload` + `launch`.

If this refactor is bigger than expected, leave `sideloadAndLaunch` alone and have t27-screensaver.mjs call `DevPortalInstall` directly via `@rokudev/device-client`.

- [ ] **Step 5: Add a `t27-screensaver` script entry to `packages/brs-gen/package.json`**

Mirror the existing `t27-music`, `t27-news` scripts:

```json
"t27-screensaver": "node scripts/t27-screensaver.mjs"
```

- [ ] **Step 6: Smoke-build the script (parse-only, no device required)**

Run: `node --check packages/brs-gen/scripts/t27-screensaver.mjs`
Expected: exit 0 (no syntax errors).

- [ ] **Step 7: Commit (without running on device yet)**

```bash
git add packages/brs-gen/scripts/t27-screensaver.mjs packages/brs-gen/scripts/_t27-lib.mjs packages/brs-gen/package.json
git commit -m "feat(brs-gen): t27-screensaver.mjs driver (Phase A; trigger via dev-portal with manual fallback)"
```

---

### Task 16: Run T27 on device; resolve trigger Option A vs B; document Phase A results

**Files:**
- Modify: `packages/brs-gen/scripts/t27-screensaver.mjs` (replace `triggerScreensaverViaDevPortal` PSEUDOCODE with real implementation)
- Create: `docs/t27-evidence/2026-05-14-screensaver-phase-a.md` (Phase A evidence; matches prior templates' pattern; verify path)

**Context:** This is the discovery task. We need a real Roku in developer mode (Native 2910X firmware preferred per most-recent device pool) with `ROKUDEV_DEFAULT_ROKU_HOST` set. Goal: get Option A working OR document that we are falling back to Option B.

- [ ] **Step 1: Confirm device target**

Run: `echo "host=$ROKUDEV_DEFAULT_ROKU_HOST"; curl -s http://$ROKUDEV_DEFAULT_ROKU_HOST:8060/query/device-info | head -20`
Expected: `host` is set; ECP responds with device-info XML.

- [ ] **Step 2: Reverse-engineer the dev portal's screensaver-trigger form**

Run: `curl --digest -u rokudev:1234 -s "http://$ROKUDEV_DEFAULT_ROKU_HOST/plugin_inspect" -F "archive=" -F "mysubmit=Test screensaver" -o /tmp/r.html; head -c 500 /tmp/r.html`

(Try variations: `mysubmit=Screensaver`, `mysubmit=Test+Screensaver`, etc.)

Look at the response. If 200 with normal portal HTML, the trigger MIGHT have fired. Switch to the device and observe: did the screensaver come up?

If no obvious endpoint, GET the portal page and inspect the HTML for any form/button related to screensavers:

```bash
curl --digest -u rokudev:1234 -s "http://$ROKUDEV_DEFAULT_ROKU_HOST/plugin_inspect" -o /tmp/portal.html
grep -i "screensaver\|preview" /tmp/portal.html | head -20
```

- [ ] **Step 3: Decide trigger path (A or B)**

If Step 2 found a working `mysubmit` value, commit to **Option A**. Edit `t27-screensaver.mjs` `triggerScreensaverViaDevPortal` to perform the discovered form-POST. Use digest auth (mirrors `packages/roku-device-client/src/devportal/inspect.ts`).

If Step 2 yielded nothing, commit to **Option B** (manual fallback). Update the script to skip the Option A try/catch and go straight to the manual instructions + sleep. Document why in the script's header comment.

If neither A nor B is viable on the available test device (e.g. no consenting human nearby for Option B and Option A unreachable), commit to **Option C** (skip on-device; rely on snapshot + manifest validation only). Update t27-screensaver.mjs to be a no-op that prints "T27 deferred; see spec §10 D-impl-1 fallback to Option C."

- [ ] **Step 4: Run the T27 driver**

Run: `pnpm -C packages/brs-gen run t27-screensaver`
Expected: All steps pass; `=== Summary === Passed: N Failed: 0`. Cycle screenshots A1.png and A2.png are byte-different.

If FAIL: investigate per the failure name. Common failures:
- "active-app check failed (expected id='dev' OR type='ssvr'; got ...)": the screensaver did not activate. Most likely the trigger fired but the operator hasn't set this as the active screensaver. For Option A, this is the Option-A unreachable case; fall back to B.
- "cycle did not advance": screenshots byte-equal after 18s. Likely the cycle isn't running. Telnet to port 8087 (NOT 8085 — screensaver context) and look for log output: any `func_name_resolver failed` lines indicate missing `<script>` includes; fix in PhotoCycle.bs / Screensaver.bs.

- [ ] **Step 5: Capture evidence + write to docs/t27-evidence/**

Mirror prior templates' Phase A evidence files (search for them with `Glob docs/t27-evidence/*.md`). Include:
- Device model + firmware version
- Trigger path used (A / B / C)
- `/query/active-app` response (for D-impl-3 documentation)
- Screenshot byte hashes
- Pass/fail counts
- Any device-specific quirks observed
- For Option A: the exact `mysubmit` value used
- For Option C: documented deferral rationale

- [ ] **Step 6: Resolve `screensaver_thumbnail_*` open question (D-impl-2)**

While the channel is sideloaded, navigate on the device: `Settings > Theme > Screensavers > Custom > <channel name>`. Is the channel listed? Does it appear without a thumbnail? Does activating it work?

If the channel does NOT appear OR is rejected as "missing thumbnail", D-impl-2 escalates to a NEW Task M (add `screensaver_thumbnail_hd/fhd/uhd` PNG buckets to the template + extend `validate_assets` to enforce). Plan M is added inline to the plan as a follow-up task; do NOT block v0.5.5 release on it (v1.x feature).

If the channel works without thumbnails, D-impl-2 is RESOLVED: documented in the evidence file. No template change needed.

- [ ] **Step 7: Commit T27 driver final form + evidence**

```bash
git add packages/brs-gen/scripts/t27-screensaver.mjs docs/t27-evidence/2026-05-14-screensaver-phase-a.md
git commit -m "test(t27): screensaver Phase A passing on <device-model> firmware <version> (trigger: <A|B|C>)"
```

NOTE: If Option A required a code change (form-POST implementation), include `_t27-lib.mjs` in the commit if a new helper landed there.

---

## Phase 6: Release

### Task 17: README v0.5.5 release notes

**Files:**
- Modify: `README.md`

**Context:** Mirror the v0.5.4 (Plan 4d) block at lines 83-96. Chronological pattern: insert v0.5.5 ABOVE v0.5.4 (newest first).

- [ ] **Step 1: Read existing v0.5.4 block**

Run: `head -120 README.md | tail -50`
Expected: shows the structure: title, opening paragraph, bullet points, "Out of v0.5.4" trailing paragraph.

- [ ] **Step 2: Author v0.5.5 block + insert above v0.5.4**

Insert at the line immediately before "## What's in v0.5.4":

```markdown
## What's in v0.5.5 (Plan 4e)

Fifth v1 catalog template: `screensaver`. A pure-screensaver Roku channel (NOT a launchable app) that displays a deterministic 8-photo slideshow with Ken Burns motion + crossfade transitions. Manifest discipline is the load-bearing correctness invariant: the template emits ONLY the screensaver-registration keys (`screensaver_title`, `rsg_version=1.3`, `ui_resolutions`, version) and rigorously excludes every app-only key (`splash_color`, `splash_screen_*`, `mm_icon_focus_*`); presence of any of those would cause `/query/apps` to register the channel as `type=appl` instead of `type=ssvr`. The reference implementation at `/Users/bblietz/Work/ClaudeProjects/DevSummit-Screensaver-RokuTV` paid for this lesson at build 23 of its own iteration.

- **Template: `screensaver`** with three SceneGraph components (Screensaver, PhotoCycle, HttpTask).
- **Bundled feed** at `pkg:/data/screensaver-feed.json`: 8 entries pointing at `pkg:/images/sample-photo-{1..8}.jpg`. Operator can override via `spec.content.feed_url` (JSON list of photo URLs in `rokudev_screensaver_v1` format).
- **`AppSpec` content extension**: `content.feed_url` (optional URL), `content.feed_format` (literal `"rokudev_screensaver_v1"`), `content.transition_seconds` (int 4..30, default 7), `content.motion` (`'ken_burns' | 'crossfade_only' | 'none'`, default `'ken_burns'`). `transition_seconds` and `motion` are threaded into runtime via `TemplateConfig()`.
- **New init-hook export**: `Screensaver/after_scene_show`. Modules can hook here for photo-shown analytics events (observe `m.top.currentPhotoIndex`).
- **Engine changes**: two additive lines in `generate-app.ts` propagate `content.transition_seconds` and `content.motion` into emitted `TemplateConfig()`. New post-zip cert validator `SCREENSAVER_ZIP_TOO_LARGE` (template-conditional; only fires when manifest has `screensaver_title=`); fails > 4 MB, warns > 3.5 MB. New schema-side validator `SCREENSAVER_TITLE_CONTAINS_ROKU` rejects `spec.app.name` containing "roku" case-insensitive (cert rule).
- **Entry point**: `sub RunScreenSaver()` (NOT `Main()`); includes `roAppMemoryMonitor` + `roDeviceInfo.EnableLowGeneralMemoryEvent` boilerplate per cert requirement effective 2026-10-01.
- **Anti-burn-in pixel-shift Animation**: +/-8px X, +/-5px Y, 90s `inOutQuad` loop on the photo Group (mined from reference repo's CountdownScreensaver.xml).
- **Two-poster pingpong + crossfade + Ken Burns**: PhotoCycle has 2 Posters (A/B), 4 Animations (crossfade, kenBurnsA, kenBurnsB, pixelShift), 1 Timer. Ken Burns Animation duration is locked to `transitionSeconds` so the pan completes exactly when the swap happens (prevents low-`transitionSeconds` pan-truncation bug).
- **8 deterministic 1920x1080 JPEGs** generated via `gen-screensaver-photos.mjs` (gradient + "Sample Photo N" text overlay). Sharp 0.34.5 with `mozjpeg: false` for byte-equality across runs.
- **T27 driver `t27-screensaver.mjs`** (Phase A: bundled feed). Trigger via dev-portal Option A (preferred) with manual fallback (Option B) and snapshot-only deferral (Option C) per spec §10.

Out of v0.5.5: per-photo metadata caption overlay (needs custom font work; deferred); schedule-aware screensavers; random shuffle (sequential cycle in v1); `screensaver_thumbnail_*` keys (status TBD per T27 verification; if cert-required, add as Plan 4e Task M); operator-configurable anti-burn-in shift parameters (locked at +/-8x, +/-5y, 90s); memory-pressure response (log-only in v1; v1.x will free texture caches).
```

- [ ] **Step 3: Verify**

Run: `head -120 README.md | grep -A 1 "What's in"`
Expected: chronological order v0.5.5 → v0.5.4 → v0.5.3 → ...

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: v0.5.5 release notes (Plan 4e screensaver template)"
```

---

### Task 18: MEMORY.md status line + `plan-4e-screensaver.md` topic file

**Files:**
- Modify: `~/.config/.../memory/MEMORY.md` (auto-memory; absolute path: `/Users/bblietz/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md`)
- Create: `/Users/bblietz/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/plan-4e-screensaver.md`

**Context:** MEMORY.md is the always-loaded index (200-line cap). Topic files load on demand. Per the established pattern from plan-4d-music.md, plan-4c-news.md, etc.

- [ ] **Step 1: Author `plan-4e-screensaver.md` topic file**

Per the prior topic files' structure (date, what shipped, engine changes, lessons, T27 status):

```markdown
# Plan 4e - screensaver (v0.5.5, 2026-05-14)

Tag `v0.5.5` on `origin`. <NNN> tests passing.

## What shipped

Fifth v1 catalog template `screensaver` (pure-screensaver Roku channel; no launchable UI; manifest declares ONLY screensaver-registration keys). 3 SceneGraph components (Screensaver, PhotoCycle, HttpTask). Bundled `pkg:/data/screensaver-feed.json` (8 deterministic 1920x1080 JPEGs cycling). Operator override via `spec.content.feed_url`. Two engine surfaces added: `spec.content.transition_seconds` (4..30, default 7) and `spec.content.motion` (ken_burns | crossfade_only | none, default ken_burns) thread through `TemplateConfig()`. Two new cert validators: `SCREENSAVER_TITLE_CONTAINS_ROKU` (schema-side; rejects "roku" in app.name) and `SCREENSAVER_ZIP_TOO_LARGE` (post-zip; > 4 MB hard error, > 3.5 MB warning, template-conditional via `screensaver_title=` manifest probe).

## Outstanding polish (as of v0.5.5)

- Per-photo caption / metadata overlay (needs custom font work; out of v1)
- Random shuffle (v1 is deterministic sequential)
- Schedule-aware behavior
- Memory-pressure response (v1 logs only; v1.x to free texture caches)
- `screensaver_thumbnail_*` keys (T27 verification result drives this; tracked as D-impl-2)
- `CERT_CHECKLIST.md.ejs` per-channel emission (benefits ALL templates; tracked)

## Engine changes

- **TemplateConfig threading**: two additive lines in `src/tools/generate-app.ts` push `content.transition_seconds` and `content.motion` into emitted `TemplateConfig()`. Plan 4c emission gate widened in v0.5.3 already covers this (any `content` field triggers emission).
- **`SCREENSAVER_ZIP_TOO_LARGE` validator**: new module `src/build/screensaver-validators.ts` with `validateScreensaverZipSize(zipPath, manifestText)`. Wired into generate-app.ts post-zip path. Template-conditional (regex probe of manifest for `screensaver_title=`).
- **`SCREENSAVER_TITLE_CONTAINS_ROKU`**: schema-side `.refine()` on `app.name` in `templates/screensaver/schema.ts`. Lives in template-local schema (not shared `src/spec/`); zero impact on other templates.
- **`assertActiveAppIsOurs(host, opts)`** helper extended in `scripts/_t27-lib.mjs` with `opts.screensaverMode = true` accepting either `id='dev'` OR `type='ssvr'`. Existing 3-arg callers preserved.

## Lessons

- **Manifest allowlist test is load-bearing**. The forbidden-keys list is non-exhaustive by nature (future Roku-side keys not yet on the list). Defense-in-depth via SET-EQUALITY assertion against the cert-allowed key set is the only way to catch a future "added a new key without realizing it's app-only" mistake at generate-time. Snapshot test alone is not enough.
- **`sub RunScreenSaver()` is the EXCLUSIVE entry point** for pure screensavers. `Main()` and `RunUserInterface()` would cause registration as `type=appl`. Document and snapshot-test the absence of `Main(`.
- **App-only manifest keys are silent killers**. Including `splash_color` or `mm_icon_focus_*` in a screensaver manifest causes `/query/apps` to register as `type=appl` (not `type=ssvr`); the channel appears on the Home row instead of in `Settings > Theme > Screensavers > Custom`. Reference repo paid for this at build 23 (weeks of iteration).
- **Memory monitoring is cert-required from 2026-10-01** (`roAppMemoryMonitor` + `roDeviceInfo.EnableLowGeneralMemoryEvent`). The boilerplate is small (~10 lines) and lives in `source/main.brs`. Log-and-continue is acceptable in v1; freeing texture caches is a v1.x feature.
- **Animation `control="start"` inline XML attribute is unreliable**; programmatically set `control = "start"` in init() (idempotent guard, reference repo CityBackground.brs lesson). Locked into PhotoCycle.bs init().
- **Ken Burns Animation duration MUST be locked to `transitionSeconds`** (not the static XML default). Otherwise low `transitionSeconds=4` triggers crossfade at elapsedSec=3 while the still-running 8s pan would leave the inactive poster at an inconsistent intermediate position. Locking duration ensures the pan completes exactly when the swap happens.
- **Telnet debug port for screensaver context is 8087 (NOT 8085)**. Reference repo CLAUDE.md.
- **`<script>` for `source/lib/*.brs` is MANDATORY in components** (Plan 4c invariant; silent runtime failure: `func_name_resolver failed resolving '<name>'`). Snapshot-test that `Screensaver.xml` includes `<script ... uri="pkg:/source/lib/Feed.brs" />`.
- **HttpTask is `createObject`-only** (Plan 4c lesson; `<script>`-include in Scene causes duplicate `init()` triggering). Honored in Screensaver.bs.

## T27 status

Phase A <NN/NN> PASS verified on <device-model> firmware <NN.N.N> (<host>, 2026-05-14). Trigger path used: <A | B | C>. Phase B (operator feed-URL override) deferred per spec §10. <Add notes about active-app reporting, screensaver_thumbnail_* status.>

## Sharp byte-equality (Plan 4d carry-forward verification)

Run-A vs run-B JPEG bytes were <equal | NOT-equal>. <If NOT-equal>: switched to `copyFile` pattern committing 8 authoritative JPEGs under `scripts/_screensaver-photo-bytes/` and having `gen-screensaver-photos.mjs` `copyFile` each. <If equal>: regen-from-svg pattern stands; sharp 0.34.5 with `mozjpeg: false` is reliable for this content shape.
```

NOTE: Fill in `<NNN>` test count, `<device-model>`, `<firmware>`, `<host>`, trigger path, and Sharp byte-equality outcome from Task 16 evidence + Task 8 results before committing this file.

- [ ] **Step 2: Update MEMORY.md**

Apply 3 small edits:

(a) Update topic-files list to include the new file:

Insert under `## Topic files (Read on demand)`:

```markdown
- `plan-4e-screensaver.md`: `screensaver` (Plan 4e; v0.5.5) details + lessons
```

(b) Update status block:

Insert into `## Status (one line per plan)`:

```markdown
- Plan 4e COMPLETE 2026-05-14 v0.5.5 (~835 tests). `screensaver`. See plan-4e-screensaver.md
```

And update the `v1 catalog` line:

```markdown
- v1 catalog: 5 of 6 templates shipped. Remaining: `game_shell`.
```

(c) Update the latent-traps section (if a Sharp byte-equality fallback was needed):

Add bullet point under "Latent traps" if Task 8 went the FALLBACK path documenting the screensaver-photos copyFile fallback as another instance of the Plan 4d sharp-determinism issue.

- [ ] **Step 3: Verify MEMORY.md still under 200 lines**

Run: `wc -l /Users/bblietz/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md`
Expected: < 200. If close to or over, prune older content into existing topic files (do NOT delete history; relocate it).

- [ ] **Step 4: Memory files are NOT git-tracked; just save them**

NOTE: `~/.config/.../memory/` is auto-memory; not part of the repo. No git commit needed for memory files.

---

### Task 19: Final verification, version bump, commit, tag, push

**Files:**
- Modify: `package.json` (root) and `packages/brs-gen/package.json` and any other workspace `package.json` whose version moves to `0.5.5`. Verify the prior cadence by looking at v0.5.4 commits.
- Tag: `v0.5.5`

- [ ] **Step 1: Verify the version-bump pattern from v0.5.4**

Run: `git log --oneline | grep -i "v0.5.4\|0.5.4" | head -5`
Expected: a chore(release) commit. Read it to see exactly which files were touched.

```bash
git show <sha-of-v0.5.4-bump-commit> --stat
```

- [ ] **Step 2: Bump versions in identified package.json files to 0.5.5**

For each package.json identified in Step 1, change `"version": "0.5.4"` → `"version": "0.5.5"`.

- [ ] **Step 3: Run the full test suite (every package)**

Run: `pnpm -r test 2>&1 | tail -50`
Expected: all packages green. Total test count up from 808 (v0.5.4) by ~25-35 (new screensaver snapshots, e2e block, conflict-matrix entry, determinism test, cert-validator tests, schema tests). Exact count depends on snapshot test count and any tests added in Tasks 1-2.

If ANY test fails, STOP. Investigate before tagging.

- [ ] **Step 4: Run TS build for every package**

Run: `pnpm -r build`
Expected: all packages build clean.

- [ ] **Step 5: Confirm goldens are byte-stable**

Run: `TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs && git status --porcelain packages/brs-gen/tests/__golden__/`
Expected: NO modified golden files (regen produces byte-equal output). If any file is modified, the determinism is broken; investigate before tagging.

- [ ] **Step 6: Commit version bump**

```bash
git add package.json packages/*/package.json
git commit -m "chore(release): bump rokudev-tools to 0.5.5 (Plan 4e screensaver template)"
```

- [ ] **Step 7: Tag**

```bash
git tag v0.5.5
```

- [ ] **Step 8: Push (with explicit user confirmation)**

This is the only destructive-class operation in the plan. STOP and ask the user before pushing:

> "All Plan 4e work is committed locally. About to push v0.5.5 + tag to origin/main. OK?"

If user confirms:

```bash
git push origin main
git push origin v0.5.5
```

- [ ] **Step 9: Verify push**

Run: `git log --oneline origin/main..HEAD`
Expected: empty (HEAD is at origin/main).

Run: `git tag -l v0.5.5 && git ls-remote --tags origin v0.5.5`
Expected: tag present locally and on origin.

---

## Plan summary

19 tasks across 6 phases:
- **Phase 0** (Tasks 1-2): engine prep — TemplateConfig threading + post-zip cert validator. Independent of template files; lays the test-infra groundwork.
- **Phase 1** (Tasks 3-4): template scaffolding — toml + schema + manifest with allowlist defense.
- **Phase 2** (Tasks 5-8): entry point + bundled content — main.brs, Feed.brs, feed JSON, 8 JPEGs.
- **Phase 3** (Tasks 9-11): SceneGraph components — HttpTask, PhotoCycle, Screensaver.
- **Phase 4** (Tasks 12-13): gold-standard tests — conflict-matrix, determinism, e2e golden.
- **Phase 5** (Tasks 14-16): T27 device verification — assertActiveAppIsOurs opt, t27-screensaver.mjs, on-device run.
- **Phase 6** (Tasks 17-19): release — README v0.5.5, MEMORY.md update, version bump + tag + push.

Each task is self-contained, ends with a commit, and has clear test gates. TDD discipline: each test is written to fail first; the corresponding code change makes it pass.

**Open implementation-time decisions** (resolved during execution, NOT in this plan):
- D-impl-1 (T27 trigger A vs B vs C): resolved in Task 16 Step 3.
- D-impl-2 (`screensaver_thumbnail_*` required?): resolved in Task 16 Step 6. Adds Task M only if cert-required.
- D-impl-3 (active-app reporting): observed in Task 16 Step 4 logs; helper API shape pre-committed in Task 14.
- Sharp byte-equality outcome (Plan 4d carry-forward): resolved in Task 8 Step 2; FALLBACK Step 2-FALLBACK if needed.

