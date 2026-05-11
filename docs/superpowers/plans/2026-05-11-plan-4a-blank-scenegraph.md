# Plan 4a: `blank_scenegraph` Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `blank_scenegraph` base template (second of six in the v1 catalog) plus a reusable template-branding-defaults engine mechanism that synthesizes icon/splash PNGs when the operator omits them.

**Architecture:** Extend `TemplateTomlSchema` with `template_branding_defaults`, add a new `src/assets/synthesize.ts` that wraps `sharp`'s solid-color PNG creation, extend `src/assets/resolve.ts` with template-default precedence, wire the new resolver into `generate_app`, and create the blank template tree. All changes are additive; no Plan 3/Plan 4 behavior changes.

**Tech Stack:** TypeScript + Zod + sharp (0.34.5 pinned) + yazl + brighterscript (bsc) + smol-toml + vitest + SceneGraph. All already in `packages/brs-gen`.

**Spec:** `docs/superpowers/specs/2026-05-11-plan-4a-blank-scenegraph-design.md` (commit `04599bc`).

**Prereqs you must have read:**
- The spec above, especially §5 (files), §6 (engine changes), §9 (testing), §10 (T27).
- `packages/brs-gen/templates/video_grid_channel/template.toml` — canonical shape for a real template.
- `packages/brs-gen/src/catalog/loader.ts` — the `flatten()` function (TOML `[template.foo]` → Zod flat `template_foo`).
- `packages/brs-gen/src/tools/generate-app.ts` — pipeline orchestrator; lines 286-320 are the existing asset block you'll refactor.
- Memory file `/Users/bblietz/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md` — look for:
  - "sharp/libvips solid-PNG cross-arch determinism" concerns
  - "TZ=UTC required" for golden byte-equality
  - "findNode is id-only" (not needed for Plan 4a but worth knowing)

---

## File Structure

**New files (relative to repo root):**

| Path | Responsibility |
|---|---|
| `packages/brs-gen/src/assets/synthesize.ts` | sharp-wrapping solid-color PNG synthesizer |
| `packages/brs-gen/src/assets/synthesize.test.ts` | Unit tests + darwin-arm64 sha256 gate |
| `packages/brs-gen/src/assets/resolve-with-default.ts` | New resolver with template-default + synthesis precedence |
| `packages/brs-gen/src/assets/resolve-with-default.test.ts` | Precedence tests |
| `packages/brs-gen/tests/fixtures/template-with-static-branding-default/template.toml` | Minimal TOML declaring a real static icon path |
| `packages/brs-gen/tests/fixtures/template-with-static-branding-default/assets/icon.png` | 336×218 PNG fixture for happy-path existence check |
| `packages/brs-gen/templates/blank_scenegraph/template.toml` | Blank's TOML (see spec §5.1) |
| `packages/brs-gen/templates/blank_scenegraph/schema.ts` | Blank's per-template Zod schema |
| `packages/brs-gen/templates/blank_scenegraph/files/manifest.ejs` | Placeholder (not read; see spec §5.3) |
| `packages/brs-gen/templates/blank_scenegraph/files/source/Main.bs` | SceneGraph bootstrap |
| `packages/brs-gen/templates/blank_scenegraph/files/components/MainScene.xml` | Scene-extending component |
| `packages/brs-gen/templates/blank_scenegraph/files/components/MainScene.bs` | One-line init() calls dispatcher |
| `packages/brs-gen/tests/__snapshots__/blank_scenegraph/manifest.snap.txt` | Snapshot (auto-written) |
| `packages/brs-gen/tests/__snapshots__/blank_scenegraph/MainScene.xml.snap.txt` | Snapshot |
| `packages/brs-gen/tests/__snapshots__/blank_scenegraph/MainScene.brs.snap.txt` | Snapshot (post-compile) |
| `packages/brs-gen/tests/__golden__/blank.zip` | Golden zip (auto-regenerated under TZ=UTC) |
| `packages/brs-gen/tests/__golden__/blank.provenance.json` | Golden provenance |
| `packages/brs-gen/scripts/t27-blank.mjs` | Operator-run real-device driver |

**Modified files:**

| Path | Change |
|---|---|
| `packages/brs-gen/src/catalog/template-toml.ts` | Add `template_branding_defaults` block to schema |
| `packages/brs-gen/src/catalog/template-toml.test.ts` | New test cases for branding_defaults |
| `packages/brs-gen/src/catalog/loader.ts` | Existence check for `template_branding_defaults.icon` / `.splash` paths |
| `packages/brs-gen/src/catalog/loader.test.ts` | New test cases for existence check |
| `packages/brs-gen/src/tools/generate-app.ts` | Replace lines ~286-320 with new resolver + scratch dir |
| `packages/brs-gen/src/tools/generate-app.test.ts` | New test case: zero-branding spec generates synthesized assets |
| `packages/brs-gen/src/merger/conflicts.ts` | Add `assets/` to template-reserved fence |
| `packages/brs-gen/tests/snapshots.test.ts` | Blank describe block |
| `packages/brs-gen/tests/e2e.test.ts` | Blank describe block |
| `packages/brs-gen/tests/conflict-matrix.test.ts` | 2 blank entries |
| `packages/brs-gen/tests/determinism.test.ts` | Blank entry |
| `packages/brs-gen/scripts/regen-golden.mjs` | Emit blank.zip + blank.provenance.json |
| `packages/brs-gen/package.json` | Bump `version` 0.4.3 → 0.5.0 |
| `package.json` (root) | Bump `version` 0.4.3 → 0.5.0 |

---

## Errata vs. Spec

Minor shape corrections made during plan authoring (committed at `04599bc`):
- TOML uses `[template.manifest_defaults]` (no `manifest` block variant).
- Zod schema key is flat `template_branding_defaults` at top level (post-smol-toml-flatten), not nested under `template`.
- `files/manifest.ejs` is a placeholder; real manifest is synthesized from `template_manifest_defaults` + asset entries.

No decisions changed. Tasks below use the engine-accurate shapes.

---

## Task 1: Extend `TemplateTomlSchema` with `template_branding_defaults`

**Files:**
- Modify: `packages/brs-gen/src/catalog/template-toml.ts`
- Test: `packages/brs-gen/src/catalog/template-toml.test.ts`

- [ ] **Step 1: Read the existing test file to learn the conventions used**

Run: `cat packages/brs-gen/src/catalog/template-toml.test.ts | head -50`

Look for: how existing tests exercise `safeParse`. You'll mirror that pattern.

- [ ] **Step 2: Write 4 failing tests**

Open `packages/brs-gen/src/catalog/template-toml.test.ts` and append:

```ts
describe('template_branding_defaults', () => {
  function baseValidTemplate() {
    return {
      template: { id: 'x', version: '0.1.0', spec_compat: '>=2', description: 'x' },
      template_manifest_defaults: { title: 'x' },
      template_exports: { init_hooks: [], scene_nodes: [] },
    };
  }

  it('accepts branding_defaults with all three sub-keys', () => {
    const input = {
      ...baseValidTemplate(),
      template_branding_defaults: {
        icon: 'assets/icon.png',
        splash: 'assets/splash.png',
        primary_color: '#123456',
      },
    };
    const r = TemplateTomlSchema.safeParse(input);
    expect(r.success).toBe(true);
  });

  it('accepts branding_defaults with only primary_color', () => {
    const input = {
      ...baseValidTemplate(),
      template_branding_defaults: { primary_color: '#000000' },
    };
    expect(TemplateTomlSchema.safeParse(input).success).toBe(true);
  });

  it('rejects invalid hex in primary_color', () => {
    const input = {
      ...baseValidTemplate(),
      template_branding_defaults: { primary_color: 'not-a-hex' },
    };
    const r = TemplateTomlSchema.safeParse(input);
    expect(r.success).toBe(false);
  });

  it('rejects unknown sub-keys under branding_defaults (strict)', () => {
    const input = {
      ...baseValidTemplate(),
      template_branding_defaults: { primary_color: '#000000', bogus: 'x' },
    };
    expect(TemplateTomlSchema.safeParse(input).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run the new tests and verify they fail**

Run: `pnpm -C packages/brs-gen test src/catalog/template-toml.test.ts`

Expected: 4 of 4 new tests FAIL with Zod errors about the `template_branding_defaults` key (strict schema rejects unknown top-level keys).

- [ ] **Step 4: Add the schema field**

In `packages/brs-gen/src/catalog/template-toml.ts`, right after the `template_suppressed_warnings` field (around line 48, inside the top-level `.object({ ... })`), add:

```ts
    template_branding_defaults: z
      .object({
        icon: z.string().optional(),
        splash: z.string().optional(),
        primary_color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/, 'must be a 6-digit hex color like #RRGGBB')
          .optional(),
      })
      .strict()
      .optional(),
```

- [ ] **Step 5: Run tests — expect all 4 pass**

Run: `pnpm -C packages/brs-gen test src/catalog/template-toml.test.ts`

Expected: all new + pre-existing template-toml tests PASS.

- [ ] **Step 6: Run the full brs-gen test suite to catch regressions**

Run: `pnpm -C packages/brs-gen test`

Expected: 252+ tests pass (baseline 252, +4 new). No failures.

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/src/catalog/template-toml.ts \
        packages/brs-gen/src/catalog/template-toml.test.ts
git commit -m "feat(brs-gen): extend TemplateTomlSchema with template_branding_defaults

Adds optional block with icon, splash, primary_color sub-keys. Strict
subobject; primary_color must match /^#[0-9A-Fa-f]{6}$/. Pure schema;
existence check for icon/splash paths lands in Task 2.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Existence check for static icon/splash paths at load-time

**Files:**
- Create: `packages/brs-gen/tests/fixtures/template-with-static-branding-default/template.toml`
- Create: `packages/brs-gen/tests/fixtures/template-with-static-branding-default/assets/icon.png` (336×218 real PNG)
- Create: `packages/brs-gen/tests/fixtures/template-with-static-branding-default/files/manifest.ejs`
- Create: `packages/brs-gen/tests/fixtures/template-with-static-branding-default/files/components/MainScene.xml` + `MainScene.bs`
- Modify: `packages/brs-gen/src/catalog/loader.ts`
- Test: `packages/brs-gen/src/catalog/loader.test.ts`

- [ ] **Step 1: Read the loader's existing module-file existence check for the pattern**

Run: `grep -n 'does not exist at' packages/brs-gen/src/catalog/loader.ts`

Expected lines ~168-172. The pattern throws `CATALOG_INVALID` with `module_id` + `path` in details.

- [ ] **Step 2: Generate a minimal 336×218 PNG fixture**

Run: `node -e "
const sharp = require('sharp');
(async () => {
  const buf = await sharp({
    create: { width: 336, height: 218, channels: 4, background: '#123456' }
  }).png({ compressionLevel: 9, palette: false, adaptiveFiltering: false }).toBuffer();
  require('node:fs').mkdirSync('packages/brs-gen/tests/fixtures/template-with-static-branding-default/assets', { recursive: true });
  require('node:fs').writeFileSync('packages/brs-gen/tests/fixtures/template-with-static-branding-default/assets/icon.png', buf);
  console.log('ok', buf.length, 'bytes');
})();
"`

Expected: `ok <N> bytes` where N > 0. File created.

- [ ] **Step 3: Create the fixture template.toml + minimal files**

```bash
mkdir -p packages/brs-gen/tests/fixtures/template-with-static-branding-default/files/{components,source}
```

Write `packages/brs-gen/tests/fixtures/template-with-static-branding-default/template.toml`:

```toml
[template]
id = "template-with-static-branding-default"
version = "0.0.1"
spec_compat = ">=2"
description = "Test fixture. Declares a real static branding icon path."

[template.manifest_defaults]
title           = "<%= spec.app.name %>"
major_version   = "<%= spec.app.major_version %>"
minor_version   = "<%= spec.app.minor_version %>"
build_version   = "<%= spec.app.build_version %>"
splash_color    = "#000000"
ui_resolutions  = "hd,fhd"

[template.exports]
init_hooks = []
scene_nodes = [
  { name = "MainScene", file = "components/MainScene.xml" },
]

[template.branding_defaults]
icon = "assets/icon.png"
primary_color = "#123456"
```

Write `packages/brs-gen/tests/fixtures/template-with-static-branding-default/files/manifest.ejs`:

```
<%# placeholder -%>
placeholder
```

Write `packages/brs-gen/tests/fixtures/template-with-static-branding-default/files/components/MainScene.xml`:

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MainScene" extends="Scene">
  <script type="text/brightscript" uri="MainScene.bs" />
  <children />
</component>
```

Write `packages/brs-gen/tests/fixtures/template-with-static-branding-default/files/components/MainScene.bs`:

```brs
sub init()
end sub
```

- [ ] **Step 4: Write 2 failing tests in `loader.test.ts`**

Append to `packages/brs-gen/src/catalog/loader.test.ts`:

```ts
describe('template_branding_defaults existence check', () => {
  const FIXTURE_ROOT = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../tests/fixtures',
  );

  it('loads a template whose branding_defaults.icon path exists', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'catalog-static-branding-'));
    await mkdir(join(tmp, 'templates'), { recursive: true });
    await mkdir(join(tmp, 'modules'), { recursive: true });
    await cp(
      join(FIXTURE_ROOT, 'template-with-static-branding-default'),
      join(tmp, 'templates', 'template-with-static-branding-default'),
      { recursive: true },
    );
    const cat = await loadCatalog(tmp);
    expect(cat.templates.has('template-with-static-branding-default')).toBe(true);
  });

  it('rejects a template whose branding_defaults.icon path is missing', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'catalog-missing-branding-'));
    await mkdir(join(tmp, 'templates', 'bad-branding'), { recursive: true });
    await mkdir(join(tmp, 'modules'), { recursive: true });
    await writeFile(
      join(tmp, 'templates', 'bad-branding', 'template.toml'),
      `[template]
id = "bad-branding"
version = "0.0.1"
spec_compat = ">=2"
description = "x"

[template.manifest_defaults]
title = "x"

[template.exports]
init_hooks = []
scene_nodes = []

[template.branding_defaults]
icon = "assets/missing.png"
primary_color = "#000000"
`,
    );
    await mkdir(join(tmp, 'templates', 'bad-branding', 'files'), { recursive: true });
    await writeFile(
      join(tmp, 'templates', 'bad-branding', 'files', 'manifest.ejs'),
      'placeholder\n',
    );
    await expect(loadCatalog(tmp)).rejects.toMatchObject({
      code: 'CATALOG_INVALID',
      message: expect.stringContaining('assets/missing.png'),
    });
  });
});
```

(Imports at top of the file: ensure `cp`, `mkdir`, `mkdtemp`, `writeFile` from `node:fs/promises`; `join`, `dirname` from `node:path`; `tmpdir` from `node:os`; `fileURLToPath` from `node:url`; `loadCatalog` already imported.)

- [ ] **Step 5: Run tests — verify they fail**

Run: `pnpm -C packages/brs-gen test src/catalog/loader.test.ts`

Expected: both new tests FAIL (no existence check exists yet; the happy-path test fails because the loader has no knowledge of `template_branding_defaults.icon`; the rejection test fails the same way — loader loads the catalog with no error).

- [ ] **Step 6: Add the existence check in `loader.ts`**

Find the block in `loadCatalog` that loads templates (currently around lines 151-157). Immediately after `validateHookScopeCasing(t, tomlPath)`, insert:

```ts
    // template_branding_defaults.icon/splash paths must resolve to real files.
    const brandingDefaults = (t as { template_branding_defaults?: { icon?: string; splash?: string } })
      .template_branding_defaults;
    if (brandingDefaults) {
      for (const key of ['icon', 'splash'] as const) {
        const rel = brandingDefaults[key];
        if (!rel) continue;
        const onDisk = join(root, 'templates', d.name, rel);
        try {
          await readFile(onDisk);
        } catch {
          throw fail(
            'CATALOG_INVALID',
            `${tomlPath}: template ${d.name} declares branding_defaults.${key}=${rel} which does not exist at ${onDisk}`,
            { template_id: d.name, key, path: rel },
          );
        }
      }
    }
```

- [ ] **Step 7: Run tests — expect passing**

Run: `pnpm -C packages/brs-gen test src/catalog/loader.test.ts`

Expected: both new tests PASS. Pre-existing loader tests still PASS.

- [ ] **Step 8: Full suite check**

Run: `pnpm -C packages/brs-gen test`

Expected: 252 baseline + 4 (Task 1) + 2 (Task 2) = 258 tests pass. No failures.

- [ ] **Step 9: Commit**

```bash
git add packages/brs-gen/src/catalog/loader.ts \
        packages/brs-gen/src/catalog/loader.test.ts \
        packages/brs-gen/tests/fixtures/template-with-static-branding-default/
git commit -m "feat(brs-gen): load-time existence check for template_branding_defaults paths

Catalog loader now verifies template_branding_defaults.icon and .splash
resolve to real files at template-load time. Fixture at
tests/fixtures/template-with-static-branding-default/ (icon path resolves).
Rejection path uses in-memory TOML per existing loader-test conventions.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `src/assets/synthesize.ts` — solid-color PNG synthesis

**Files:**
- Create: `packages/brs-gen/src/assets/synthesize.ts`
- Create: `packages/brs-gen/src/assets/synthesize.test.ts`

- [ ] **Step 1: Look up existing sharp usage patterns**

Run: `grep -n 'import sharp' packages/brs-gen/src/assets/*.ts`

Confirm `sharp` is already a runtime dep (not a peer). Expected: seen in pipeline.ts.

- [ ] **Step 2: Write 2 failing tests — dimensions + invalid color**

Create `packages/brs-gen/src/assets/synthesize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { synthesizeSolidPng } from './synthesize.js';

describe('synthesizeSolidPng — shape + error handling', () => {
  it('emits a PNG of the requested dimensions', async () => {
    const buf = await synthesizeSolidPng('#123456', 336, 218);
    const meta = await sharp(buf).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(336);
    expect(meta.height).toBe(218);
  });

  it('throws ASSET_INVALID_COLOR for non-hex input', async () => {
    await expect(synthesizeSolidPng('not-a-hex', 10, 10)).rejects.toMatchObject({
      code: 'ASSET_INVALID_COLOR',
    });
  });

  it('throws ASSET_INVALID_COLOR for #RGB (3-digit) shorthand', async () => {
    await expect(synthesizeSolidPng('#abc', 10, 10)).rejects.toMatchObject({
      code: 'ASSET_INVALID_COLOR',
    });
  });
});

describe('synthesizeSolidPng — byte-determinism gate', () => {
  // This test pins the sharp version AND the output sha256 of a known
  // color+dimensions. It is darwin-arm64-only by design (see spec §9.1);
  // other platforms skip the sha256 branch with a warning but still run
  // the sharp-version assertion. If CI lands on a different platform,
  // either switch CI to macOS arm64 or extract the hash per-platform.
  it('has the pinned sharp version', () => {
    expect(sharp.versions.sharp).toBe('0.34.5');
  });

  it('produces a deterministic sha256 for a known color+dimensions', async () => {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
      console.warn(
        `skipping sha256 gate on ${process.platform}/${process.arch} (pinned to darwin/arm64)`,
      );
      return;
    }
    const buf = await synthesizeSolidPng('#6F3FF5', 336, 218);
    const hash = createHash('sha256').update(buf).digest('hex');
    // PIN_REPLACE_ME is replaced in Step 7 with the actual hash captured
    // from the first successful synthesis on the dev machine.
    expect(hash).toBe('PIN_REPLACE_ME');
  });
});
```

- [ ] **Step 3: Run tests — verify they fail (file doesn't exist yet)**

Run: `pnpm -C packages/brs-gen test src/assets/synthesize.test.ts`

Expected: import resolution error (`Cannot find module './synthesize.js'`).

- [ ] **Step 4: Implement `synthesize.ts`**

Create `packages/brs-gen/src/assets/synthesize.ts`:

```ts
import sharp from 'sharp';
import { fail } from '@rokudev/device-client';

/**
 * Synthesize a solid-color source PNG at the given dimensions.
 *
 * Deterministic contract:
 * - Given the exact pinned sharp version (patch-level match, see pin in
 *   packages/brs-gen/package.json) + identical {width, height, color},
 *   output bytes are byte-equal on the same OS/arch.
 * - Determinism across OS/arch is NOT guaranteed; asserted only by the
 *   darwin-arm64-gated sha256 test in synthesize.test.ts. If libvips
 *   variance ever breaks this, switch to static PNGs per-template.
 *
 * Pinned params (DO NOT CHANGE without regenerating goldens):
 *   create: { width, height, channels: 4, background: hexToRgba(color) }
 *   png:    { compressionLevel: 9, palette: false, adaptiveFiltering: false }
 */
export async function synthesizeSolidPng(
  color: string,
  width: number,
  height: number,
): Promise<Buffer> {
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
    throw fail(
      'ASSET_INVALID_COLOR',
      `color must match /^#[0-9A-Fa-f]{6}$/; got ${JSON.stringify(color)}`,
      { color },
    );
  }
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  try {
    return await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r, g, b, alpha: 1 },
      },
    })
      .png({ compressionLevel: 9, palette: false, adaptiveFiltering: false })
      .toBuffer();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw fail('ASSET_SYNTHESIS_FAILED', `sharp failed to synthesize PNG: ${msg}`, {
      color,
      width,
      height,
    });
  }
}
```

- [ ] **Step 5: Run tests — dimensions + invalid color tests pass, sha256 gate fails with actual hash**

Run: `pnpm -C packages/brs-gen test src/assets/synthesize.test.ts`

Expected:
- `emits a PNG of the requested dimensions` → PASS
- both `ASSET_INVALID_COLOR` tests → PASS
- `has the pinned sharp version` → PASS
- `produces a deterministic sha256 for a known color+dimensions` → FAIL with output like `expected 'abc123...' to be 'PIN_REPLACE_ME'`

**CAPTURE the actual sha256** from the vitest output. It'll look like `expected 'fa47...' to be 'PIN_REPLACE_ME'` — copy the 64-hex-char string.

- [ ] **Step 6: Paste the actual sha256 into the test**

In `synthesize.test.ts`, replace `PIN_REPLACE_ME` with the 64-hex-char hash you captured.

- [ ] **Step 7: Run tests again — all pass on darwin-arm64**

Run: `pnpm -C packages/brs-gen test src/assets/synthesize.test.ts`

Expected: all 5 tests PASS (on darwin-arm64; on any other platform the sha256 gate logs a skip warning but returns without asserting).

- [ ] **Step 8: Full suite check**

Run: `pnpm -C packages/brs-gen test`

Expected: baseline 258 + 5 = 263 tests pass. No regressions.

- [ ] **Step 9: Commit**

```bash
git add packages/brs-gen/src/assets/synthesize.ts \
        packages/brs-gen/src/assets/synthesize.test.ts
git commit -m "feat(brs-gen): synthesizeSolidPng for template-default branding assets

New src/assets/synthesize.ts wraps sharp's solid-color PNG creation with
pinned params (channels=4, compressionLevel=9, palette=false). Errors
surface as ASSET_INVALID_COLOR (hex regex) and ASSET_SYNTHESIS_FAILED
(sharp throw).

Gate test pins sharp version to 0.34.5 and asserts exact sha256 for a
known color+dimensions. Gate runs only on darwin/arm64; other platforms
skip with warning. Documented in test comment.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: `resolveAssetWithTemplateDefault` — precedence resolver

**Files:**
- Create: `packages/brs-gen/src/assets/resolve-with-default.ts`
- Create: `packages/brs-gen/src/assets/resolve-with-default.test.ts`

This is a pure function over precedence logic. The synthesis side-effect (PNG bytes) is the synthesizer's output; the resolver just decides which source to read/synthesize.

- [ ] **Step 1: Write failing tests for all precedence paths**

Create `packages/brs-gen/src/assets/resolve-with-default.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAssetSource } from './resolve-with-default.js';

describe('resolveAssetSource — precedence', () => {
  it('returns operator-supplied asset bytes when spec provides a path', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'rwd-op-'));
    const opPath = join(tmp, 'op-icon.png');
    await writeFile(opPath, Buffer.from('operator-png-bytes'));
    const r = await resolveAssetSource({
      specAssetPath: opPath,
      specOrigin: null,
      templateRoot: '/unused',
      templateDefaultPath: 'assets/ignored.png',
      effectivePrimaryColor: '#000000',
      kind: 'icon',
      sourceMin: { width: 1, height: 1 }, // disable dim check for this test
      noValidate: true,
    });
    expect(r.source).toBe('operator');
    expect(r.bytes.toString()).toBe('operator-png-bytes');
  });

  it('returns template-static bytes when operator omits + template declares path', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'rwd-static-'));
    await mkdir(join(tmp, 'assets'), { recursive: true });
    const staticPath = 'assets/static-icon.png';
    await writeFile(join(tmp, staticPath), Buffer.from('template-static-bytes'));
    const r = await resolveAssetSource({
      specAssetPath: undefined,
      specOrigin: null,
      templateRoot: tmp,
      templateDefaultPath: staticPath,
      effectivePrimaryColor: '#000000',
      kind: 'icon',
      sourceMin: { width: 1, height: 1 },
      noValidate: true,
    });
    expect(r.source).toBe('template-static');
    expect(r.bytes.toString()).toBe('template-static-bytes');
  });

  it('synthesizes from effectivePrimaryColor when both operator and template-static are absent', async () => {
    const r = await resolveAssetSource({
      specAssetPath: undefined,
      specOrigin: null,
      templateRoot: '/unused',
      templateDefaultPath: undefined,
      effectivePrimaryColor: '#123456',
      kind: 'icon',
      sourceMin: { width: 336, height: 218 },
      noValidate: false,
    });
    expect(r.source).toBe('synthesized');
    // The byte length is non-zero and the PNG sig is correct.
    expect(r.bytes.subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG magic
  });

  it('returns source:none when all three inputs are absent', async () => {
    const r = await resolveAssetSource({
      specAssetPath: undefined,
      specOrigin: null,
      templateRoot: '/unused',
      templateDefaultPath: undefined,
      effectivePrimaryColor: undefined,
      kind: 'icon',
      sourceMin: { width: 336, height: 218 },
      noValidate: false,
    });
    expect(r.source).toBe('none');
    expect(r.bytes).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail (file doesn't exist)**

Run: `pnpm -C packages/brs-gen test src/assets/resolve-with-default.test.ts`

Expected: `Cannot find module './resolve-with-default.js'`.

- [ ] **Step 3: Implement the resolver**

Create `packages/brs-gen/src/assets/resolve-with-default.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveAssetPath } from './resolve.js';
import { validateAssetSource } from './validate.js';
import { synthesizeSolidPng } from './synthesize.js';
import { ICON_SOURCE_MIN, SPLASH_SOURCE_MIN } from './constants.js';

export type AssetKind = 'icon' | 'splash';

export type ResolvedAssetSource =
  | { source: 'operator'; bytes: Buffer }
  | { source: 'template-static'; bytes: Buffer }
  | { source: 'synthesized'; bytes: Buffer }
  | { source: 'none'; bytes?: undefined };

export type ResolveInput = {
  specAssetPath: string | undefined;
  specOrigin: string | null;
  templateRoot: string;
  templateDefaultPath: string | undefined;
  effectivePrimaryColor: string | undefined;
  kind: AssetKind;
  sourceMin: { width: number; height: number };
  /** Skip source-PNG dimension/format validation. Tests only. */
  noValidate?: boolean;
};

const SYNTH_DIMENSIONS: Record<AssetKind, { width: number; height: number }> = {
  icon: { width: ICON_SOURCE_MIN.width, height: ICON_SOURCE_MIN.height },
  splash: { width: SPLASH_SOURCE_MIN.width, height: SPLASH_SOURCE_MIN.height },
};

/**
 * Resolve an asset's source bytes via precedence: operator > template-static >
 * synthesized > none. The caller decides what to do with `source: 'none'`
 * (usually: omit the manifest key).
 */
export async function resolveAssetSource(input: ResolveInput): Promise<ResolvedAssetSource> {
  const { specAssetPath, specOrigin, templateRoot, templateDefaultPath } = input;

  if (specAssetPath) {
    const abs = resolveAssetPath(specAssetPath, specOrigin);
    const bytes = await readFile(abs);
    if (!input.noValidate) {
      await validateAssetSource(bytes, input.sourceMin, {
        field: `branding.${input.kind}`,
        path: abs,
      });
    }
    return { source: 'operator', bytes };
  }

  if (templateDefaultPath) {
    const abs = join(templateRoot, templateDefaultPath);
    const bytes = await readFile(abs);
    if (!input.noValidate) {
      await validateAssetSource(bytes, input.sourceMin, {
        field: `template.branding_defaults.${input.kind}`,
        path: abs,
      });
    }
    return { source: 'template-static', bytes };
  }

  if (input.effectivePrimaryColor) {
    const dims = SYNTH_DIMENSIONS[input.kind];
    const bytes = await synthesizeSolidPng(
      input.effectivePrimaryColor,
      dims.width,
      dims.height,
    );
    return { source: 'synthesized', bytes };
  }

  return { source: 'none' };
}
```

- [ ] **Step 4: Run tests — all 4 pass**

Run: `pnpm -C packages/brs-gen test src/assets/resolve-with-default.test.ts`

Expected: all 4 PASS.

- [ ] **Step 5: Full suite**

Run: `pnpm -C packages/brs-gen test`

Expected: 267 tests pass (263 + 4).

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/src/assets/resolve-with-default.ts \
        packages/brs-gen/src/assets/resolve-with-default.test.ts
git commit -m "feat(brs-gen): resolveAssetSource with operator/template-static/synthesized precedence

New src/assets/resolve-with-default.ts returns {source, bytes} from the
three-way precedence described in spec §7. source='none' when all inputs
are absent; the caller omits the manifest key.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Wire resolver into `generate-app.ts` + add `assets/` fence

**Files:**
- Modify: `packages/brs-gen/src/tools/generate-app.ts`
- Modify: `packages/brs-gen/src/merger/conflicts.ts`
- Test: `packages/brs-gen/src/tools/generate-app.test.ts` (new cases)

- [ ] **Step 1: Locate the current asset block in generate-app.ts**

Run: `grep -n 'NEW: asset resolution' packages/brs-gen/src/tools/generate-app.ts`

Expected: `286:      // 7a-7l. NEW: asset resolution + bucketing. ...`. You will REPLACE lines ~289-320 (the `const branding = ...; if (branding ...) { ... }` block) with the new flow.

- [ ] **Step 2: Write a failing integration test for zero-branding blank spec**

Append to `packages/brs-gen/src/tools/generate-app.test.ts`:

```ts
describe('generate_app — template_branding_defaults synthesis path', () => {
  it('generates synthesized icon + splash when spec has no branding', async () => {
    // Will light up once Task 6 adds blank_scenegraph; for Task 5 we
    // exercise the fixture template with a static default.
    const tmp = await mkdtemp(join(tmpdir(), 'gen-synth-'));
    const outDir = join(tmp, 'out');
    const spec = {
      spec_version: 2,
      template: 'template-with-static-branding-default',
      modules: [],
      app: { name: 'X', major_version: 0, minor_version: 1, build_version: 0 },
    };
    // Pre-load a fake catalog rooted at packages/brs-gen/tests/fixtures/
    // (pattern follows existing generate-app.test.ts cases).
    // ... use setCatalogForTests with a catalog loaded from the fixture dir ...

    const res = await callGenerateApp(spec, outDir);
    expect(res['ok']).toBe(true);
    // Icon from template-static path; no splash (fixture doesn't declare one).
    expect(res['manifest_keys']).toContain('mm_icon_focus_hd');
    expect(res['manifest_keys']).toContain('mm_icon_focus_fhd');
    expect(res['manifest_keys']).not.toContain('splash_screen_uhd');
  });
});
```

(Flesh out the test-catalog setup using the existing generate-app.test.ts helpers. If the test scaffolding is heavy, check `packages/brs-gen/src/tools/_catalog-singleton.ts` for `setCatalogForTests`.)

- [ ] **Step 3: Run the test — expect fail (new resolver not wired yet)**

Run: `pnpm -C packages/brs-gen test src/tools/generate-app.test.ts`

Expected: new test FAILS (missing manifest_keys since nothing resolves template-static assets yet).

- [ ] **Step 4: Refactor generate-app.ts to use the new resolver**

Replace lines ~286-320 in `packages/brs-gen/src/tools/generate-app.ts` with:

```ts
      // 7a-7l. Asset resolution via precedence: operator > template-static
      //        > synthesized. Effective primary_color = spec > template >
      //        "#000000". Synthesized PNGs land in a per-generation scratch
      //        dir cleaned in a finally block.
      const templateRoot = join(pkgRoot, 'templates', tmpl.template.id);
      const brandingSpec =
        (appSpec as { branding?: { icon?: string; splash?: string; primary_color?: string } })
          .branding ?? {};
      const brandingDefaults =
        (tmpl as { template_branding_defaults?: { icon?: string; splash?: string; primary_color?: string } })
          .template_branding_defaults ?? {};
      const effectivePrimaryColor =
        brandingSpec.primary_color ?? brandingDefaults.primary_color ?? '#000000';

      let assetBuckets: Map<string, Buffer> | undefined;
      let assetManifestEntries: Record<string, string> | undefined;

      const iconResolved = await resolveAssetSource({
        specAssetPath: brandingSpec.icon,
        specOrigin,
        templateRoot,
        templateDefaultPath: brandingDefaults.icon,
        effectivePrimaryColor,
        kind: 'icon',
        sourceMin: ICON_SOURCE_MIN,
      });
      const splashResolved = await resolveAssetSource({
        specAssetPath: brandingSpec.splash,
        specOrigin,
        templateRoot,
        templateDefaultPath: brandingDefaults.splash,
        effectivePrimaryColor,
        kind: 'splash',
        sourceMin: SPLASH_SOURCE_MIN,
      });

      const buckets = new Map<string, Buffer>();
      const entries: Record<string, string> = {};
      if (iconResolved.source !== 'none') {
        const iconBuckets = await bucketAsset(iconResolved.bytes, 'icon', 'images/icon');
        for (const [k, v] of iconBuckets) buckets.set(k, v);
        Object.assign(entries, manifestEntriesForBuckets('icon', 'images/icon'));
      }
      if (splashResolved.source !== 'none') {
        const splashBuckets = await bucketAsset(splashResolved.bytes, 'splash', 'images/splash');
        for (const [k, v] of splashBuckets) buckets.set(k, v);
        Object.assign(entries, manifestEntriesForBuckets('splash', 'images/splash'));
      }
      if (buckets.size > 0) {
        assetBuckets = buckets;
        assetManifestEntries = entries;
      }
```

Imports to add at the top of `generate-app.ts`:

```ts
import { resolveAssetSource } from '../assets/resolve-with-default.js';
```

Remove the now-unused `resolveAssetPath` + `validateAssetSource` imports **only if** nothing else in the file uses them. The refactor may leave them used elsewhere — check before removing.

- [ ] **Step 5: Add `assets/` fence to `src/merger/conflicts.ts`**

Modify `packages/brs-gen/src/merger/conflicts.ts` lines ~27-36 — extend the `source/_template/` reserved-territory check to also include `assets/`:

```ts
      if (p.startsWith('source/_template/') || p.startsWith('assets/')) {
        return {
          ok: false,
          failure: fail(
            'FILE_COLLISION',
            `module ${m.module.id} cannot add path ${p}: source/_template/ and assets/ are reserved for template content`,
            {
              stage: 'conflicts',
              path: p,
              owner_a: '<template-reserved>',
              owner_b: m.module.id,
            },
          ),
        };
      }
```

- [ ] **Step 6: Add a conflicts test for the new `assets/` fence**

Append to `packages/brs-gen/src/merger/conflicts.test.ts` (check the file exists first; if not, create it following neighboring `*.test.ts` conventions):

```ts
it('rejects a module that tries to add under assets/', () => {
  const module = {
    module: { id: 'bad', version: '0.1.0', spec_compat: '>=2', description: 'x' },
    module_files: { add: ['assets/icon.png'] },
    module_conflicts: { exclusive_with: [] },
    module_exports: {},
    module_init: {},
    module_requires: {},
    module_manifest_deltas: {},
    module_config_schema: { type: 'object', properties: {}, additionalProperties: false },
    module_ordering: { before: [], after: [] },
  } as unknown as ModuleToml;
  const r = detectConflicts([module], []);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.failure.code).toBe('FILE_COLLISION');
    expect(r.failure.message).toContain('assets/icon.png');
  }
});
```

- [ ] **Step 7: Run both new tests — verify passing**

Run: `pnpm -C packages/brs-gen test src/tools/generate-app.test.ts src/merger/conflicts.test.ts`

Expected: both new tests PASS.

- [ ] **Step 8: Full suite**

Run: `pnpm -C packages/brs-gen test`

Expected: 269 tests pass (267 + 2). No regressions; video_grid_channel still works because its spec provides branding, which goes down the `operator` branch.

- [ ] **Step 9: Commit**

```bash
git add packages/brs-gen/src/tools/generate-app.ts \
        packages/brs-gen/src/tools/generate-app.test.ts \
        packages/brs-gen/src/merger/conflicts.ts \
        packages/brs-gen/src/merger/conflicts.test.ts
git commit -m "feat(brs-gen): route generate_app through resolveAssetSource; fence assets/

Replaces the inline branding+asset block in generate-app.ts with the
three-way precedence resolver from Task 4. effectivePrimaryColor falls
back through spec > template_default > #000000. source='none' omits the
manifest key (operator who chose no-branding + no template default).

Also extends the template-territory conflicts fence to assets/ (mirrors
source/_template/). Modules can no longer contribute under assets/.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Create `blank_scenegraph` template files

**Files:**
- Create: `packages/brs-gen/templates/blank_scenegraph/template.toml`
- Create: `packages/brs-gen/templates/blank_scenegraph/schema.ts`
- Create: `packages/brs-gen/templates/blank_scenegraph/files/manifest.ejs`
- Create: `packages/brs-gen/templates/blank_scenegraph/files/source/Main.bs`
- Create: `packages/brs-gen/templates/blank_scenegraph/files/components/MainScene.xml`
- Create: `packages/brs-gen/templates/blank_scenegraph/files/components/MainScene.bs`

- [ ] **Step 1: Write a failing integration test**

Append to `packages/brs-gen/src/tools/generate-app.test.ts`:

```ts
describe('generate_app — blank_scenegraph zero-input spec', () => {
  it('generates a valid channel tree from {spec_version, template, modules:[], app:{}}', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'gen-blank-'));
    const outDir = join(tmp, 'out');
    const spec = {
      spec_version: 2,
      template: 'blank_scenegraph',
      modules: [],
      app: { name: 'Blank Test', major_version: 0, minor_version: 0, build_version: 1 },
    };

    const res = await callGenerateApp(spec, outDir);
    expect(res['ok']).toBe(true);
    // Synthesized assets present.
    expect(res['manifest_keys']).toContain('mm_icon_focus_hd');
    expect(res['manifest_keys']).toContain('mm_icon_focus_fhd');
    expect(res['manifest_keys']).toContain('splash_screen_hd');
    expect(res['manifest_keys']).toContain('splash_screen_fhd');
    expect(res['manifest_keys']).toContain('splash_screen_uhd');
    // init_order empty (no modules).
    expect(res['init_order']).toEqual([]);
    // Key files exist on disk post-compile.
    await stat(join(outDir, 'manifest'));
    await stat(join(outDir, 'components/MainScene.xml'));
    await stat(join(outDir, 'components/MainScene.brs'));
    await stat(join(outDir, 'source/Main.brs'));
  });
});
```

- [ ] **Step 2: Run test — expect fail (template doesn't exist in catalog)**

Run: `pnpm -C packages/brs-gen test src/tools/generate-app.test.ts`

Expected: FAIL with `UNKNOWN_TEMPLATE` or similar.

- [ ] **Step 3: Create `template.toml`**

```bash
mkdir -p packages/brs-gen/templates/blank_scenegraph/files/{components,source}
```

Write `packages/brs-gen/templates/blank_scenegraph/template.toml`:

```toml
[template]
id = "blank_scenegraph"
version = "0.1.0"
spec_compat = ">=2"
description = "Minimal module-friendly starter channel. Scene + MainScene + one init hook; no content."

[template.manifest_defaults]
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
```

- [ ] **Step 4: Create `schema.ts`**

Write `packages/brs-gen/templates/blank_scenegraph/schema.ts`:

```ts
import { z } from 'zod';
// Relative imports follow video_grid_channel's schema.ts pattern; the
// template is dynamically imported from pkgRoot by generate-app.ts.
import { AppSpecV2 } from '../../src/spec/app-spec.js';
import { BrandingSchema } from '../../src/spec/branding.js';

// Blank explicitly FORBIDS the content block. AppSpecV2 declares content
// as optional, so .strict() alone is insufficient — the z.never().optional()
// override allows "key absent" / "key: undefined" but rejects any actual
// value.
export const Schema = AppSpecV2.extend({
  template: z.literal('blank_scenegraph'),
  branding: BrandingSchema.partial().optional(),
  content: z.never().optional(),
}).strict();

export const Example = {
  spec_version: 2,
  template: 'blank_scenegraph',
  modules: [],
  app: { name: 'Blank Channel', major_version: 0, minor_version: 1, build_version: 0 },
} as const;
```

(Check the actual name of the AppSpec base export — it may be `AppSpecV2` or `AppSpecBase` depending on the current `src/spec/app-spec.ts` shape. Match whatever video_grid_channel's schema.ts imports.)

- [ ] **Step 5: Create the file tree**

Write `packages/brs-gen/templates/blank_scenegraph/files/manifest.ejs`:

```
<%# This file is present only because git does not track empty directories.
    The actual manifest is emitted by the merger from template_manifest_defaults
    + asset entries + module contributions. This file is not read.
-%>
placeholder
```

Write `packages/brs-gen/templates/blank_scenegraph/files/source/Main.bs`:

```brs
sub Main()
  screen = CreateObject("roSGScreen")
  m.port = CreateObject("roMessagePort")
  screen.setMessagePort(m.port)
  ' CreateScene attaches the MainScene as the screen's root and returns a
  ' handle. The intentionally-unused `scene` binding makes the idiom
  ' explicit: creation is the side effect that matters.
  scene = screen.CreateScene("MainScene")
  screen.show()
  while true
    msg = wait(0, m.port)
    if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
  end while
end sub
```

Write `packages/brs-gen/templates/blank_scenegraph/files/components/MainScene.xml`:

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

Write `packages/brs-gen/templates/blank_scenegraph/files/components/MainScene.bs`:

```brs
sub init()
  Modules_OnMainSceneAfterSceneShow(m)
end sub
```

- [ ] **Step 6: Rebuild and run the new test**

Run: `pnpm -C packages/brs-gen build && pnpm -C packages/brs-gen test src/tools/generate-app.test.ts`

Expected: the new blank_scenegraph test PASSES. Manifest keys contain synthesized asset entries. Generated files exist.

- [ ] **Step 7: Full suite**

Run: `pnpm -C packages/brs-gen test`

Expected: 270 tests pass (269 + 1).

- [ ] **Step 8: Commit**

```bash
git add packages/brs-gen/templates/blank_scenegraph/ \
        packages/brs-gen/src/tools/generate-app.test.ts
git commit -m "feat(brs-gen): blank_scenegraph template files

New v1 catalog entry. Minimal module-friendly starter with one init hook
(MainScene.init/after_scene_show) and one scene node (MainScene). Empty
rootGroup as a stable mount point for modules. Zero content, zero UI
beyond the Group. branding_defaults synthesizes icon + splash from
primary_color (#000000) when spec omits branding.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Snapshot tests for blank_scenegraph

**Files:**
- Modify: `packages/brs-gen/tests/snapshots.test.ts`

- [ ] **Step 1: Find the snapshots.test.ts structure**

Run: `grep -n 'video_grid_channel snapshots' packages/brs-gen/tests/snapshots.test.ts | head -3`

You'll see a `describe('video_grid_channel snapshots', ...)` block with `beforeAll` that generates once, and `it(...)` cases per file.

- [ ] **Step 2: Add a blank_scenegraph describe block**

Append near the bottom of `packages/brs-gen/tests/snapshots.test.ts` (mirror the video_grid pattern):

```ts
describe('blank_scenegraph snapshots', () => {
  let projectDir: string;

  beforeAll(async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'blank-snap-'));
    projectDir = join(tmp, 'out');
    await callGenerateApp(
      {
        spec_version: 2,
        template: 'blank_scenegraph',
        modules: [],
        app: {
          name: 'Blank Snap',
          major_version: 0,
          minor_version: 1,
          build_version: 0,
        },
      },
      projectDir,
    );
  }, 30_000);

  it('manifest matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'manifest'), 'utf8');
    await expect(s).toMatchFileSnapshot('__snapshots__/blank_scenegraph/manifest.snap.txt');
  });

  it('MainScene.xml (post-compile, .brs refs) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.xml'), 'utf8');
    await expect(s).toMatchFileSnapshot(
      '__snapshots__/blank_scenegraph/MainScene.xml.snap.txt',
    );
  });

  it('MainScene.brs (post-compile) matches saved snapshot', async () => {
    const s = await readFile(join(projectDir, 'components/MainScene.brs'), 'utf8');
    await expect(s).toMatchFileSnapshot(
      '__snapshots__/blank_scenegraph/MainScene.brs.snap.txt',
    );
  });
});
```

- [ ] **Step 3: Run — snapshots auto-create on first run**

Run: `pnpm -C packages/brs-gen test tests/snapshots.test.ts`

Expected: first run writes 3 snapshot files and all 3 tests PASS.

- [ ] **Step 4: Sanity-check the snapshot contents**

Run: `cat packages/brs-gen/tests/__snapshots__/blank_scenegraph/manifest.snap.txt | head -20`

Verify:
- `title=Blank Snap`
- `splash_color=#000000`
- `ui_resolutions=hd,fhd`
- `mm_icon_focus_hd=pkg:/images/icon_hd.png`
- `splash_screen_hd=pkg:/images/splash_hd.png`

- [ ] **Step 5: Full suite**

Run: `pnpm -C packages/brs-gen test`

Expected: 273 tests pass (270 + 3).

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/tests/snapshots.test.ts \
        packages/brs-gen/tests/__snapshots__/blank_scenegraph/
git commit -m "test(brs-gen): snapshot tests for blank_scenegraph manifest + components

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Conflict-matrix entries for blank_scenegraph

**Files:**
- Modify: `packages/brs-gen/tests/conflict-matrix.test.ts`

- [ ] **Step 1: Inspect the current matrix**

Run: `grep -n 'template:' packages/brs-gen/tests/conflict-matrix.test.ts | head -10`

Learn the existing pattern (likely a list of `{ template, modules }` entries fed through `generate_app` + asserting `ok`).

- [ ] **Step 2: Add 2 blank entries**

Append the new entries to the matrix array in `packages/brs-gen/tests/conflict-matrix.test.ts`:

```ts
  { template: 'blank_scenegraph', modules: [] },
  { template: 'blank_scenegraph', modules: ['stub_label'] },
```

(If each entry has a configs field, supply `stub_label`'s minimal config; check existing stub_hello/stub_label entry for the shape.)

- [ ] **Step 3: Run the matrix test**

Run: `pnpm -C packages/brs-gen test tests/conflict-matrix.test.ts`

Expected: both new entries PASS (blank with zero modules; blank with stub_label). Existing entries unchanged.

- [ ] **Step 4: Full suite**

Run: `pnpm -C packages/brs-gen test`

Expected: 275 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/tests/conflict-matrix.test.ts
git commit -m "test(brs-gen): conflict-matrix entries for blank_scenegraph

Two new entries: blank with zero modules, blank with stub_label. Exercises
the merger's happy path on the new template with and without a module.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Determinism test entry for blank_scenegraph

**Files:**
- Modify: `packages/brs-gen/tests/determinism.test.ts`

- [ ] **Step 1: Find the existing video_grid entry**

Run: `grep -n 'video_grid' packages/brs-gen/tests/determinism.test.ts`

Copy its structure.

- [ ] **Step 2: Add a blank_scenegraph entry (under TZ=UTC)**

The existing video_grid determinism test runs two in-process generate cycles and diffs the emitted zip bytes. Add a parallel `it(...)` for blank_scenegraph.

```ts
it('blank_scenegraph full-pipeline byte equality across two in-process runs', async () => {
  const spec = {
    spec_version: 2,
    template: 'blank_scenegraph',
    modules: [],
    app: { name: 'Blank Determ', major_version: 0, minor_version: 1, build_version: 0 },
  };
  const [zip1, zip2] = await Promise.all([
    runToZip(spec),
    runToZip(spec),
  ]);
  expect(zip1.equals(zip2)).toBe(true);
});
```

(Re-use the existing `runToZip` / helper from the video_grid test; if none, see how video_grid's determinism test is structured and mirror it.)

- [ ] **Step 3: Run**

Run: `TZ=UTC pnpm -C packages/brs-gen test tests/determinism.test.ts`

Expected: new test PASSES. Two in-process runs produce byte-equal zips (catches synthesis determinism regressions).

- [ ] **Step 4: Full suite under TZ=UTC**

Run: `TZ=UTC pnpm -C packages/brs-gen test`

Expected: 276 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/tests/determinism.test.ts
git commit -m "test(brs-gen): determinism entry for blank_scenegraph

Two in-process generate cycles must produce byte-equal zips. Catches
libvips non-determinism and any future breaks in the synthesis path.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: e2e test + golden zip/provenance for blank_scenegraph

**Files:**
- Modify: `packages/brs-gen/tests/e2e.test.ts`
- Modify: `packages/brs-gen/scripts/regen-golden.mjs`
- Create: `packages/brs-gen/tests/__golden__/blank.zip`
- Create: `packages/brs-gen/tests/__golden__/blank.provenance.json`

- [ ] **Step 1: Open the existing e2e.test.ts video_grid block**

Run: `grep -n 'video_grid_channel' packages/brs-gen/tests/e2e.test.ts | head -5`

The `describe('video_grid_channel', ...)` block around line 303 is the template to mirror.

- [ ] **Step 2: Add blank_scenegraph describe block**

Append to `packages/brs-gen/tests/e2e.test.ts` (after the video_grid_channel block):

```ts
  describe('blank_scenegraph', () => {
    let blankOutputDir: string;
    let blankZipPath: string;

    const CANONICAL_BLANK_SPEC = {
      spec_version: 2,
      template: 'blank_scenegraph',
      modules: [],
      app: { name: 'Blank E2E', major_version: 0, minor_version: 1, build_version: 0 },
    };

    beforeAll(async () => {
      const tmp = await mkdtemp(join(tmpdir(), 'brs-gen-blank-e2e-'));
      blankOutputDir = join(tmp, 'project');
      blankZipPath = join(tmp, 'project.zip');
    });

    it('generate_app on blank_scenegraph produces byte-equal golden zip + provenance', async () => {
      const resp = await client.request('tools/call', {
        name: 'generate_app',
        arguments: {
          spec: CANONICAL_BLANK_SPEC,
          output_dir: blankOutputDir,
          zip: { output_zip: blankZipPath },
        },
      });
      expect(resp.error).toBeUndefined();
      const payload = parseToolPayload(resp.result);
      expect(payload['ok']).toBe(true);

      const emitted = await readFile(blankZipPath);
      const golden = await readFile(join(GOLDEN_DIR, 'blank.zip'));
      expect(emitted.equals(golden)).toBe(true);

      const emittedProv = await readFile(
        join(blankOutputDir, '.rokudev-tools', 'provenance.json'),
      );
      const goldenProv = await readFile(join(GOLDEN_DIR, 'blank.provenance.json'));
      expect(emittedProv.equals(goldenProv)).toBe(true);
    }, 30_000);

    it('validate_manifest returns ok:true on the blank_scenegraph project', async () => {
      const resp = await client.request('tools/call', {
        name: 'validate_manifest',
        arguments: { project_dir: blankOutputDir },
      });
      const payload = parseToolPayload(resp.result);
      expect(payload['ok']).toBe(true);
    }, 30_000);

    it('lint reports no errors on the blank_scenegraph project', async () => {
      const resp = await client.request('tools/call', {
        name: 'lint',
        arguments: { project_dir: blankOutputDir },
      });
      const payload = parseToolPayload(resp.result);
      expect(payload['ok']).toBe(true);
      expect(
        (payload['diagnostics'] as Array<{ severity: string }>).filter(
          (d) => d.severity === 'error',
        ),
      ).toEqual([]);
    }, 45_000);
  });
```

- [ ] **Step 3: Extend `regen-golden.mjs` to emit blank goldens**

Open `packages/brs-gen/scripts/regen-golden.mjs`. Find where `video-grid.zip` is regenerated. Add a parallel block for `blank.zip` + `blank.provenance.json` using the canonical blank spec.

- [ ] **Step 4: Run tests — expect fail (goldens don't exist)**

Run: `TZ=UTC pnpm -C packages/brs-gen test tests/e2e.test.ts`

Expected: new blank-zip assertion FAILS with ENOENT (no golden yet).

- [ ] **Step 5: Regenerate goldens under TZ=UTC**

Run: `TZ=UTC node packages/brs-gen/scripts/regen-golden.mjs`

Expected output includes `blank.zip` and `blank.provenance.json` in the "regenerated" list.

- [ ] **Step 6: Re-run e2e tests — all pass**

Run: `TZ=UTC pnpm -C packages/brs-gen test tests/e2e.test.ts`

Expected: all blank + video_grid + stub e2e tests PASS.

- [ ] **Step 7: Full suite under TZ=UTC**

Run: `TZ=UTC pnpm -C packages/brs-gen test`

Expected: 279 tests pass (276 + 3 e2e cases).

- [ ] **Step 8: Commit (includes goldens)**

```bash
git add packages/brs-gen/tests/e2e.test.ts \
        packages/brs-gen/scripts/regen-golden.mjs \
        packages/brs-gen/tests/__golden__/blank.zip \
        packages/brs-gen/tests/__golden__/blank.provenance.json
git commit -m "test(brs-gen): e2e + golden fixtures for blank_scenegraph

Three new e2e cases under the blank_scenegraph describe block:
- generate_app produces byte-equal golden zip + provenance
- validate_manifest ok:true
- lint reports no errors

Goldens regenerated under TZ=UTC via regen-golden.mjs. blank.zip +
blank.provenance.json committed. .prettierignore already covers
tests/__golden__ so the compact stableStringify JSON stays as-emitted.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 11: T27 real-device driver for blank_scenegraph

**Files:**
- Create: `packages/brs-gen/scripts/t27-blank.mjs`

- [ ] **Step 1: Study the video_grid T27 driver for the helper API**

Run: `cat packages/brs-gen/scripts/t27-video-grid.mjs`

Note the helpers from `_t27-lib.mjs`: `sideloadAndLaunch`, `keypress`, `keypressRepeat`, `screenshotNoError`, `sleep`, and the `generateAppForRegen` helper.

- [ ] **Step 2: Write `scripts/t27-blank.mjs` with Phase A + Phase B**

Create `packages/brs-gen/scripts/t27-blank.mjs`:

```js
// packages/brs-gen/scripts/t27-blank.mjs
//
// Operator-run T27 real-device verification for blank_scenegraph.
//
// Requires env:
//   ROKUDEV_HOST         IP of a dev-mode Roku
//   ROKUDEV_DEV_PASSWORD dev password (default: 1234)
//
// Phase A: zero-branding spec (synthesized icon + splash)
// Phase B: module composition spec (adds stub_label module)
//
// Exit 0 on PASS, non-zero on FAIL. Screenshots written to
// scripts/t27-screenshots/blank-<iso>/.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  sideloadAndLaunch,
  keypress,
  screenshotNoError,
  sleep,
} from './_t27-lib.mjs';
import { generateAppForRegen } from './regen-helper.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);

const host = process.env.ROKUDEV_HOST;
const password = process.env.ROKUDEV_DEV_PASSWORD || '1234';
if (!host) {
  console.error('T27 blank: ROKUDEV_HOST env var is required.');
  process.exit(2);
}

const iso = new Date().toISOString().replace(/[:.]/g, '-');
const screensDir = join(PKG_ROOT, 'scripts', 't27-screenshots', `blank-${iso}`);
await mkdir(screensDir, { recursive: true });

const summary = { passed: [], failed: [] };
function assertStep(name, thunk) {
  return thunk()
    .then((v) => { summary.passed.push(name); return v; })
    .catch((e) => {
      summary.failed.push({ name, message: String(e?.message ?? e) });
      throw e;
    });
}

// ---------- Phase A: zero-branding spec ----------
async function runPhaseA() {
  console.log('=== Phase A: zero-branding spec ===');
  const work = await mkdtemp(join(tmpdir(), 'brs-gen-t27-blank-a-'));
  const outputDir = join(work, 'project');
  const outputZip = join(work, 'project.zip');
  const spec = {
    spec_version: 2,
    template: 'blank_scenegraph',
    modules: [],
    app: {
      name: 'T27 Blank Phase A',
      major_version: 0,
      minor_version: 1,
      build_version: 0,
    },
  };
  const specPath = join(work, 'spec.json');
  await writeFile(specPath, JSON.stringify(spec));

  await assertStep('A: generate_app', () =>
    generateAppForRegen({ outputDir, spec: specPath, outputZip }),
  );
  await assertStep('A: sideload + launch', () =>
    sideloadAndLaunch(outputZip, host, password),
  );
  await sleep(3000);
  await assertStep('A: home screenshot (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'a-01-home.png')),
  );
  await assertStep('A: Home exits channel', () => keypress(host, 'Home'));
}

// ---------- Phase B: module composition spec ----------
async function runPhaseB() {
  console.log('=== Phase B: module composition (stub_label) ===');
  const work = await mkdtemp(join(tmpdir(), 'brs-gen-t27-blank-b-'));
  const outputDir = join(work, 'project');
  const outputZip = join(work, 'project.zip');
  const spec = {
    spec_version: 2,
    template: 'blank_scenegraph',
    modules: [
      {
        id: 'stub_label',
        config: {
          // fill in stub_label's minimal required config; see
          // packages/brs-gen/modules/stub_label/module.toml
          text: 'Plan 4a',
        },
      },
    ],
    app: {
      name: 'T27 Blank Phase B',
      major_version: 0,
      minor_version: 1,
      build_version: 0,
    },
  };
  const specPath = join(work, 'spec.json');
  await writeFile(specPath, JSON.stringify(spec));

  await assertStep('B: generate_app', () =>
    generateAppForRegen({ outputDir, spec: specPath, outputZip }),
  );
  await assertStep('B: sideload + launch', () =>
    sideloadAndLaunch(outputZip, host, password),
  );
  await sleep(3000);
  await assertStep('B: home screenshot with module (no error overlay)', () =>
    screenshotNoError(host, password, join(screensDir, 'b-01-home.png')),
  );
  await assertStep('B: Home exits channel', () => keypress(host, 'Home'));
}

try {
  await runPhaseA();
  await runPhaseB();
  console.log('\nT27 BLANK PASS.');
  console.log('Screenshots:', screensDir);
  console.log('Passed:', summary.passed.length, 'Failed:', summary.failed.length);
  process.exit(0);
} catch (err) {
  console.error('\nT27 BLANK FAIL:', err?.stack ?? err);
  console.error('Passed:', summary.passed);
  console.error('Failed:', summary.failed);
  process.exit(1);
}
```

**Note on Phase B**: the `stub_label` module's config shape should match whatever `packages/brs-gen/modules/stub_label/module.toml` declares. Check the `module_config_schema` for required fields and adjust the `config` object above.

- [ ] **Step 3: Operator runs the driver against a dev-mode Roku**

Run (operator):

```bash
ROKUDEV_HOST=<your-roku-ip> ROKUDEV_DEV_PASSWORD=1234 TZ=UTC \
  node packages/brs-gen/scripts/t27-blank.mjs
```

Expected output: `T27 BLANK PASS.` with Phase A + Phase B both reporting steps passed.

- [ ] **Step 4: Review screenshots**

Open `packages/brs-gen/scripts/t27-screenshots/blank-<iso>/a-01-home.png` and `b-01-home.png`. Phase A should be mostly black (synthesized icon/splash at `#000000`); Phase B should show stub_label's marker.

- [ ] **Step 5: If Phase B fails because stub_label's hooks don't target `MainScene.init/after_scene_show`**

stub_label's module.toml may only declare hooks for `Main/before_scene_show` (see the existing stub_hello template). If Phase B fails with `WIRING_CONTRACT_VIOLATION`, stub_label won't compose onto blank as-is. Fix-forward options:
- (a) Fold Phase B into a follow-up patch once a module exists that targets `MainScene.init/after_scene_show`.
- (b) Extend stub_label to declare both hook targets.
- (c) Skip Phase B in this task; call it "Phase B pending first after_scene_show-compatible module" and open a follow-up note.

If (a) or (c): comment out Phase B in the driver and note it in the commit message.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/scripts/t27-blank.mjs
git commit -m "feat(brs-gen): T27 real-device driver for blank_scenegraph

Phase A: zero-branding spec sideloads + launches + screenshots clean.
Phase B: stub_label module composes onto blank via
MainScene.init/after_scene_show (or noted as pending if stub_label's
hooks don't align with blank's exports).

Operator-run; requires ROKUDEV_HOST + ROKUDEV_DEV_PASSWORD in env.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 12: Release v0.5.0

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/brs-gen/package.json`
- Regenerate: `packages/brs-gen/tests/__golden__/{stub,video-grid,blank}.{zip,provenance.json}`

- [ ] **Step 1: Bump monorepo version**

Edit `package.json`: `"version": "0.4.3"` → `"version": "0.5.0"`.

- [ ] **Step 2: Bump brs-gen version**

Edit `packages/brs-gen/package.json`: `"version": "0.4.3"` → `"version": "0.5.0"`.

(`@rokudev/device-client` unchanged at 0.2.2 — this release is template-side only.)

- [ ] **Step 3: Regenerate all goldens under TZ=UTC**

Run: `TZ=UTC node packages/brs-gen/scripts/regen-golden.mjs`

Expected output lists all 4 golden files (stub.zip, stub.provenance.json, video-grid.zip + provenance, blank.zip + provenance — some will now show `brs_gen_version:"0.5.0"` in provenance).

- [ ] **Step 4: Rebuild brs-gen**

Run: `pnpm -C packages/brs-gen build`

Expected: clean compile.

- [ ] **Step 5: Run full brs-gen tests under TZ=UTC**

Run: `TZ=UTC pnpm -C packages/brs-gen test`

Expected: all ~279 tests pass.

- [ ] **Step 6: Run the full monorepo suite**

Run: `TZ=UTC pnpm test`

Expected: all 3 packages green: `@rokudev/device-client` (296), `rokudev-device` (184), `brs-gen` (~279). Total ~759.

- [ ] **Step 7: Commit everything**

```bash
git add package.json \
        packages/brs-gen/package.json \
        packages/brs-gen/tests/__golden__/
git commit -m "chore(release): v0.5.0 — blank_scenegraph + template-branding-defaults

Release notes:
- New base template blank_scenegraph (second in v1 catalog).
- Reusable engine surface: template_branding_defaults with synthesized
  PNG fallbacks from primary_color.
- Asset resolver precedence: operator > template-static > synthesized >
  none (omit manifest key).

See docs/superpowers/plans/2026-05-11-plan-4a-blank-scenegraph.md for
task-by-task delivery log and docs/superpowers/specs/2026-05-11-plan-4a-
blank-scenegraph-design.md for the spec.

Package bumps:
- rokudev-tools (root) 0.4.3 -> 0.5.0
- brs-gen 0.4.3 -> 0.5.0
- @rokudev/device-client unchanged at 0.2.2

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 8: Tag + push + gh release**

```bash
git tag -a v0.5.0 -m "v0.5.0: blank_scenegraph + template-branding-defaults"
git push origin main
git push origin v0.5.0
gh release create v0.5.0 \
  --title "v0.5.0 — blank_scenegraph + template-branding-defaults" \
  --notes "$(cat <<'EOF'
## Summary

Second base template in the v1 catalog: `blank_scenegraph` — a minimal
module-friendly starter channel. Also introduces a reusable engine
mechanism (`template_branding_defaults`) for synthesizing icon + splash
PNGs from `primary_color` when the operator provides no branding.

## What's new

- **New template** `blank_scenegraph`: Scene + MainScene + one init hook
  (`MainScene.init/after_scene_show`). Zero content. Any module that
  targets the exported hook composes on top.
- **Engine: `template_branding_defaults` block** in `template.toml`.
  Optional fields `icon`, `splash`, `primary_color`. Used by the asset
  resolver when operator branding is absent.
- **Engine: `src/assets/synthesize.ts`** wraps `sharp` solid-color PNG
  creation with pinned params. Deterministic on dev-machine platform;
  byte-equality asserted by a darwin/arm64-gated sha256 test.
- **Engine: `src/assets/resolve-with-default.ts`** returns resolved
  source bytes via operator > template-static > synthesized > none
  precedence.

## Tests

- 296 @rokudev/device-client tests
- 184 rokudev-device tests
- ~279 brs-gen tests (baseline 252 + new)
- Total ~759

## Release operator checklist

- `TZ=UTC pnpm test` all green
- `T27 blank PASS` on dev-mode Roku (Phase A + Phase B)
- Goldens regenerated under TZ=UTC
EOF
)"
```

Expected: new release visible at `https://github.com/bblietz/rokudev-tools/releases/tag/v0.5.0`.

- [ ] **Step 9: Update memory**

Edit `/Users/bblietz/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md`:

- Mark Plan 4a complete with tag `v0.5.0`.
- Add a new entry under "brs-gen MCP design notes" describing `template_branding_defaults` and the `synthesize.ts`/`resolve-with-default.ts` surfaces.
- Note: darwin/arm64 sha256 gate exists as a trap for future contributors on other platforms.

---

## Verification Gate Summary

After all 12 tasks, the following MUST be green:

1. `TZ=UTC pnpm test` (monorepo)
2. `T27 blank` Phase A + Phase B (or Phase A only with a documented Phase B follow-up)
3. `T27 video-grid` (regression gate — engine refactor must not break Plan 4)
4. `v0.5.0` tag pushed + gh release created

---

## Reference: skills to lean on

- @superpowers:test-driven-development for the write-fail-implement-pass-commit discipline within each task.
- @superpowers:verification-before-completion before claiming any task is done.
- @superpowers:systematic-debugging if Task 5 or Task 6 surfaces an unexpected engine interaction.
