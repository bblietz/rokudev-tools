# Plan 4f: `game_shell` template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the sixth and final v1 catalog template `game_shell`: a Pong-based reference channel demonstrating the canonical state-machine + Timer-driven game loop + D-pad input + registry-backed high-score pattern, composed of `Rectangle` + `Label` SceneGraph nodes only (zero bitmap sprites). Closes PRD §8.1's 6-template requirement.

**Architecture:** Mirrors prior v1 templates (`video_grid_channel`, `news_channel`, `music_player`, `screensaver`). Hand-authored, deterministic, byte-equal goldens. Three additive engine threading lines for new `content` fields (`cpu_difficulty`, `score_to_win`, `high_score_persistence`); zero new validators; zero bundled assets beyond optional branding. Three SceneGraph components (`GameScene`, `Paddle`, `Ball`); pure-math collision/AI helpers in `source/lib/pong.brs` with TS shim for off-device unit tests. Three init-hook exports (scope `GameScene`): `after_scene_show`, `after_game_start`, `after_game_over`. The `after_scene_show` hook fires from `init()` (NOT from `enterTitle()`) per Plan 4d's `NowPlayingScene/after_scene_show` pattern.

**Tech Stack:** TypeScript (brs-gen engine), BrighterScript (`.bs` source emitted to `.brs` via compile.ts sweep), SceneGraph XML, Zod (schema with `.default(...)` flowing downstream via Plan 4e Task 11 fix), Vitest (tests), yazl (zip; `TZ=UTC` required for cross-machine byte equality), `@rokudev/device-client` (T27 ECP/dev-portal), Roku Native 2910X firmware (T27 device target, IP `10.128.162.107`).

**Reference docs:** Spec at `docs/superpowers/specs/2026-05-15-plan-4f-game-shell-design.md`. Memory: `~/.config/.../memory/MEMORY.md` plus topic files (`plan-4e-screensaver.md`, `plan-4d-music.md`, `plan-4c-news.md`, `plan-4-video-grid.md`). Reference repo `/Users/bblietz/Work/ClaudeProjects/FlappyBat-game-Roku/` is consulted for game-architecture patterns ONLY (state-machine triplet, single-Scene mutable-state ownership); its hand-authored channel code is NOT copied.

**Execution scaffolding:**
- All commands assume CWD = monorepo root `/Users/bblietz/Work/ClaudeProjects/rokudev-tools` unless stated.
- Test runner: `pnpm -C packages/brs-gen exec vitest run <pattern>` (NOT watch mode).
- Build: `pnpm -C packages/brs-gen build` (gating verification step; vitest does NOT typecheck — missing TS surface only surfaces here).
- Golden regen: `TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs` (yazl 2.5.x DOS-time encoding requires UTC for cross-machine byte equality).
- T27: device IP per session (`ROKUDEV_HOST=10.128.162.107`); password `1234`.

**Key gotchas already paid for in prior plans (do NOT relearn):**
- `pos`, `box`, `next`, `step`, `then`, `to` are BrightScript reserved words. Use `curPos` etc.
- `findNode` is id-only, NOT type-aware. Cache `m.<x>Ref` for any `createChild` you intend to remove or re-find.
- XML `<script>` includes for `source/lib/*.brs` are MANDATORY in components that call those functions; silent runtime failure (`func_name_resolver failed resolving '<name>'`) otherwise. Same applies to `pkg:/source/_template/config.bs` and `pkg:/source/_modules/__init_hooks.bs` (Plan 4e Task 11 generalization). The merger only auto-injects these for components it owns; templates must declare them explicitly.
- XML `.bs` URIs at authoring time are intentional; `compile.ts` post-compile sweep rewrites to `.brs`.
- Animation `control="start"` inline XML attribute is unreliable — programmatically set `control = "start"` in `init()`. (Plan 4f only uses Timer, not Animation; this is a heads-up for future game additions.)
- MCP handler wrapping convention: tool handlers return plain payload objects; bootstrap does the one-and-only `{content:[{type:'text', text: JSON.stringify(...)}]}` wrap. Do NOT wrap in handlers. (Plan 4f does not add new MCP tools, so this is informational.)
- Strict-template-schema downstream-data flow (Plan 4e Task 11): when a template ships `schema.ts`, the engine assigns `appSpec = strict.data` so Zod defaults flow to all downstream emission. This is what makes `game_shell`'s bare-spec generate work without a `content` block.

---

## File Structure

**Created:**

```
packages/brs-gen/
  templates/game_shell/
    template.toml                                      # Task 2
    schema.ts                                          # Task 2
    files/
      manifest.ejs                                     # Task 3
      source/
        main.brs                                       # Task 4
        lib/
          pong.brs                                     # Task 5
      components/
        Ball.xml                                       # Task 8
        Ball.bs                                        # Task 8
        Paddle.xml                                     # Task 9
        Paddle.bs                                      # Task 9
        GameScene.xml                                  # Task 10
        GameScene.bs                                   # Task 10
  scripts/
    t27-game-shell.mjs                                 # Task 13
  tests/
    templates/
      game-shell-schema.test.ts                        # Task 2
      pong-helpers.ts                                  # Task 6 (TS shim, NOT a test)
      pong-helpers.test.ts                             # Task 6
      pong-const-parity.test.ts                        # Task 7
    e2e/
      game-shell.test.ts                               # Task 12
    __golden__/game_shell/
      game-shell.zip                                   # Task 12 (regen)
      manifest.snap                                    # Task 3
      main.brs.snap                                    # Task 4
      pong.brs.snap                                    # Task 5
      Ball.xml.snap, Ball.bs.snap                      # Task 8
      Paddle.xml.snap, Paddle.bs.snap                  # Task 9
      GameScene.xml.snap, GameScene.bs.snap            # Task 10

docs/t27-evidence/
  2026-05-15-game-shell-phase-a.md                     # Task 14

~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/
  plan-4f-game-shell.md                                # Task 16
```

**Modified:**

- `packages/brs-gen/src/tools/generate-app.ts` — 3 threading lines + 3 content-cast field additions (Task 1).
- `packages/brs-gen/tests/tools/generate-app.test.ts` — 4 new game_shell coverage entries (Task 1 within same task; tests are part of the engine-change TDD cycle).
- `packages/brs-gen/tests/build/conflict-matrix.test.ts` — 1 new game_shell row (Task 11).
- `packages/brs-gen/tests/build/determinism.test.ts` — 1 new game_shell entry (Task 11).
- `README.md` — v0.5.6 release notes appended at END (ASCENDING order; Task 15).
- `package.json` (monorepo root) — version bump to `0.5.6` (Task 17).
- `packages/brs-gen/package.json` — version bump to `0.5.6` (Task 17).
- `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md` — Plan 4f status line + topic-file pointer (Task 16).

---

## Task list (17 tasks)

1. Engine threading: 3 `TemplateConfig()` lines for `cpu_difficulty`/`score_to_win`/`high_score_persistence` in `generate-app.ts` + 3 content-cast fields + 4 engine test coverage entries.
2. Template metadata: `template.toml` + `schema.ts` (Zod, strict, defaulted) + `game-shell-schema.test.ts`.
3. `manifest.ejs` + manifest snapshot test.
4. `source/main.brs` (standard `Main()` + message pump) + snapshot.
5. `source/lib/pong.brs` (5 helpers + module-level constants) + snapshot.
6. `tests/templates/pong-helpers.ts` (TS shim, verbatim translation) + `pong-helpers.test.ts` (off-device unit tests).
7. `tests/templates/pong-const-parity.test.ts` (parses BRS const block, asserts equality with TS shim).
8. `Ball.xml` + `Ball.bs` (1-Rectangle inner + position mirror) + snapshots.
9. `Paddle.xml` + `Paddle.bs` (1-Rectangle inner + paddleY mirror + side-conditional X) + snapshots.
10. `GameScene.xml` + `GameScene.bs` (root scene; state machine; Timer; key handler; init-hook firing from `init()`) + snapshots.
11. Conflict-matrix entry + determinism entry (covers cross-template no-conflict + byte-equal regen).
12. E2E golden test (`tests/e2e/game-shell.test.ts`) + golden zip regen via `TZ=UTC ... regen-golden.mjs`.
13. T27 driver `scripts/t27-game-shell.mjs`.
14. Run T27 on device 10.128.162.107; capture screenshots; write Phase A evidence doc.
15. README v0.5.6 release notes (appended at END; ASCENDING order).
16. MEMORY.md status line + new `plan-4f-game-shell.md` topic file.
17. Final verification: full test suite, build, golden regen confirmation, version bump (root + `brs-gen` package.json to 0.5.6), commit, tag `v0.5.6`, push to origin.

---

## Task 1: Engine threading + engine test coverage

**Goal:** Thread three new `content` fields into `TemplateConfig()`. Mechanical edit; mirrors Plan 4d (`service_name`) and Plan 4e (`transition_seconds`, `motion`) exactly.

**Files:**
- Modify: `packages/brs-gen/src/tools/generate-app.ts` (TemplateConfig emission block + local content type cast)
- Modify: `packages/brs-gen/tests/tools/generate-app.test.ts` (4 new game_shell test cases)

- [ ] **Step 1: Read existing TemplateConfig threading block to confirm pattern**

Run:
```
grep -n "transition_seconds\|service_name\|live_label" packages/brs-gen/src/tools/generate-app.ts
```
Expected: shows the existing `if (content?.X) cfg['X'] = String(content.X);` lines clustered in one block (~lines 380-388 per spec §7 reviewer note). Confirm the local `content` cast type lists `feed_url`, `feed_format`, `live_label`, `service_name`, `transition_seconds`, `motion`. The new fields will go in the same block; the cast will gain three new optional fields.

- [ ] **Step 2: Write 4 failing engine test cases**

Edit `packages/brs-gen/tests/tools/generate-app.test.ts`. Find the existing screensaver-coverage block (search `/screensaver.*transition_seconds/i`) and add a parallel block for `game_shell` immediately after. The 4 cases:

```typescript
describe('game_shell template threading', () => {
  it('bare spec generates clean (uses Zod defaults)', async () => {
    const result = await generateApp(
      { spec_version: 2, template: 'game_shell', modules: [], app: { name: 'Pong E2E', major_version: 0, minor_version: 1, build_version: 0 } },
      { outputDir: tmpProj() },
    );
    expect(result.ok).toBe(true);
    const cfg = readFileSync(join(result.outputDir, 'source/_template/config.brs'), 'utf8');
    expect(cfg).toContain('"cpu_difficulty": "normal"');
    expect(cfg).toContain('"score_to_win": "5"');
    expect(cfg).toContain('"high_score_persistence": "true"');
  });

  it('emits cpu_difficulty=hard when set', async () => {
    const result = await generateApp(
      { spec_version: 2, template: 'game_shell', modules: [], app: { name: 'Pong Hard', major_version: 0, minor_version: 1, build_version: 0 }, content: { cpu_difficulty: 'hard' } },
      { outputDir: tmpProj() },
    );
    expect(result.ok).toBe(true);
    const cfg = readFileSync(join(result.outputDir, 'source/_template/config.brs'), 'utf8');
    expect(cfg).toContain('"cpu_difficulty": "hard"');
  });

  it('emits score_to_win=10 when set', async () => {
    const result = await generateApp(
      { spec_version: 2, template: 'game_shell', modules: [], app: { name: 'Pong 10', major_version: 0, minor_version: 1, build_version: 0 }, content: { score_to_win: 10 } },
      { outputDir: tmpProj() },
    );
    expect(result.ok).toBe(true);
    const cfg = readFileSync(join(result.outputDir, 'source/_template/config.brs'), 'utf8');
    expect(cfg).toContain('"score_to_win": "10"');
  });

  it('emits high_score_persistence=false when set', async () => {
    const result = await generateApp(
      { spec_version: 2, template: 'game_shell', modules: [], app: { name: 'Pong Kiosk', major_version: 0, minor_version: 1, build_version: 0 }, content: { high_score_persistence: false } },
      { outputDir: tmpProj() },
    );
    expect(result.ok).toBe(true);
    const cfg = readFileSync(join(result.outputDir, 'source/_template/config.brs'), 'utf8');
    expect(cfg).toContain('"high_score_persistence": "false"');
  });
});
```

Use whatever `tmpProj()` helper / `readFileSync` import / `generateApp` import the surrounding tests already use. If the surrounding tests use a different naming or async setup, MIRROR that pattern verbatim (do not introduce a new style).

- [ ] **Step 3: Run failing tests to confirm they fail**

Run: `pnpm -C packages/brs-gen exec vitest run tests/tools/generate-app.test.ts -t "game_shell template threading"`
Expected: 4 FAIL — either "template not found: game_shell" (template.toml absent) OR "expected to contain ... but did not" (engine threading missing). Both are acceptable failure modes; both will be fixed by Tasks 1+2.

(Note: these tests REQUIRE the template scaffolding from Task 2 to actually pass; they will pass at the end of Task 2, not Task 1. We're writing them now so that the engine change in this task is TDD-shaped.)

- [ ] **Step 4: Implement engine threading**

Edit `packages/brs-gen/src/tools/generate-app.ts`. Find the existing block (after the `transition_seconds` and `motion` lines from Plan 4e). Add three lines in the same style:

```typescript
if (content?.cpu_difficulty) cfg['cpu_difficulty'] = String(content.cpu_difficulty);
if (content?.score_to_win !== undefined) cfg['score_to_win'] = String(content.score_to_win);
if (content?.high_score_persistence !== undefined) cfg['high_score_persistence'] = String(content.high_score_persistence);
```

Then find the local TypeScript cast for `content` (should be a union or interface listing the existing fields). Add the three new optional fields:

```typescript
const content = appSpec.content as {
  feed_url?: string;
  feed_format?: string;
  live_label?: string;
  service_name?: string;
  transition_seconds?: number;
  motion?: string;
  cpu_difficulty?: 'easy' | 'normal' | 'hard';
  score_to_win?: number;
  high_score_persistence?: boolean;
} | undefined;
```

(Adapt the exact shape to whatever the existing cast looks like; the principle is "add the new optional fields to whatever existing cast type the file already declares".)

- [ ] **Step 5: Confirm `pnpm -C packages/brs-gen build` is clean**

Run: `pnpm -C packages/brs-gen build`
Expected: zero TS errors, build succeeds. (Vitest does not typecheck; this is the gating step.)

- [ ] **Step 6: Defer test pass to Task 2**

The 4 test cases will fail until `templates/game_shell/template.toml` exists (Task 2). Move on; Task 2's final verification step re-runs these tests and asserts pass.

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/src/tools/generate-app.ts packages/brs-gen/tests/tools/generate-app.test.ts
git commit -m "$(cat <<'EOF'
feat(brs-gen): thread game_shell content fields into TemplateConfig

Three additive lines for cpu_difficulty, score_to_win, and
high_score_persistence. Local content cast extended with the three
new optional fields. Four engine test cases added (will pass once
template.toml lands in Task 2).

Mirrors Plan 4d service_name and Plan 4e transition_seconds/motion
threading patterns.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Template metadata + schema + schema test

**Goal:** Make `template: 'game_shell'` a recognized template id with a strict Zod schema and three defaulted content fields. After this task, the Task 1 engine tests pass.

**Files:**
- Create: `packages/brs-gen/templates/game_shell/template.toml`
- Create: `packages/brs-gen/templates/game_shell/schema.ts`
- Create: `packages/brs-gen/tests/templates/game-shell-schema.test.ts`

- [ ] **Step 1: Read Plan 4e's screensaver template.toml + schema.ts as the structural reference**

Run: `cat packages/brs-gen/templates/screensaver/template.toml packages/brs-gen/templates/screensaver/schema.ts`

Note: the `[template.exports]` block lists init_hooks (scope/phase/file/signature) and scene_nodes (name/file). game_shell will have 3 init_hooks (`after_scene_show`, `after_game_start`, `after_game_over`) all at scope `GameScene`, plus 3 scene_nodes (`GameScene`, `Paddle`, `Ball`).

- [ ] **Step 2: Write `template.toml`**

Create `packages/brs-gen/templates/game_shell/template.toml` with:

```toml
[template]
id = "game_shell"
version = "0.1.0"
spec_compat = ">=2"

[template.manifest_defaults]
title = "<%= spec.app.name %>"
major_version = "<%= spec.app.major_version %>"
minor_version = "<%= spec.app.minor_version %>"
build_version = "<%= spec.app.build_version %>"
ui_resolutions = "hd,fhd"
mm_icon_focus_hd = "pkg:/images/icon_hd.png"
mm_icon_focus_fhd = "pkg:/images/icon_fhd.png"
splash_screen_hd = "pkg:/images/splash_hd.png"
splash_screen_fhd = "pkg:/images/splash_fhd.png"
splash_color = "#000000"
splash_min_time = "1500"
screen_saver_private = "1"
requires_audio_guide = "0"

[template.exports]
init_hooks = [
  { scope = "GameScene", phase = "after_scene_show", file = "components/GameScene.bs", signature = "(m as object) as void" },
  { scope = "GameScene", phase = "after_game_start", file = "components/GameScene.bs", signature = "(m as object) as void" },
  { scope = "GameScene", phase = "after_game_over",  file = "components/GameScene.bs", signature = "(m as object) as void" },
]
scene_nodes = [
  { name = "GameScene", file = "components/GameScene.xml" },
  { name = "Paddle",    file = "components/Paddle.xml" },
  { name = "Ball",      file = "components/Ball.xml" },
]
```

- [ ] **Step 3: Write `schema.ts`**

Create `packages/brs-gen/templates/game_shell/schema.ts`:

```typescript
import { z } from 'zod';
import { AppSpecBaseSchema } from '../../src/spec/wrapper.js';

const GameShellContentSchema = z.object({
  cpu_difficulty: z.enum(['easy', 'normal', 'hard']).default('normal'),
  score_to_win: z.number().int().min(1).max(21).default(5),
  high_score_persistence: z.boolean().default(true),
}).strict().default({});

export const GameShellSpecSchema = AppSpecBaseSchema.extend({
  template: z.literal('game_shell'),
  content: GameShellContentSchema,
}).strict();

export default GameShellSpecSchema;
```

(If `AppSpecBaseSchema` lives at a different path or under a different name in the workspace, mirror what `templates/screensaver/schema.ts` imports. Run `cat packages/brs-gen/templates/screensaver/schema.ts` to confirm.)

- [ ] **Step 4: Write `game-shell-schema.test.ts`**

Create `packages/brs-gen/tests/templates/game-shell-schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { GameShellSpecSchema } from '../../templates/game_shell/schema.js';

const baseApp = { name: 'Pong', major_version: 0, minor_version: 1, build_version: 0 };
const baseSpec = { spec_version: 2, template: 'game_shell' as const, modules: [], app: baseApp };

describe('GameShellSpecSchema', () => {
  it('accepts bare spec (no content) and applies defaults', () => {
    const r = GameShellSpecSchema.safeParse(baseSpec);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.content.cpu_difficulty).toBe('normal');
      expect(r.data.content.score_to_win).toBe(5);
      expect(r.data.content.high_score_persistence).toBe(true);
    }
  });

  it.each(['easy', 'normal', 'hard'] as const)('accepts cpu_difficulty=%s', (d) => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, content: { cpu_difficulty: d } });
    expect(r.success).toBe(true);
  });

  it('rejects cpu_difficulty=insane', () => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, content: { cpu_difficulty: 'insane' } });
    expect(r.success).toBe(false);
  });

  it.each([1, 5, 21])('accepts score_to_win=%d', (n) => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, content: { score_to_win: n } });
    expect(r.success).toBe(true);
  });

  it.each([0, 22, -1, 1.5])('rejects score_to_win=%s', (n) => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, content: { score_to_win: n } });
    expect(r.success).toBe(false);
  });

  it('accepts high_score_persistence=false', () => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, content: { high_score_persistence: false } });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.content.high_score_persistence).toBe(false);
  });

  it('rejects unknown content fields (strict)', () => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, content: { not_a_real_field: 'x' } });
    expect(r.success).toBe(false);
  });

  it('rejects unknown top-level fields (strict)', () => {
    const r = GameShellSpecSchema.safeParse({ ...baseSpec, surprise: 'x' });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 5: Run schema tests**

Run: `pnpm -C packages/brs-gen exec vitest run tests/templates/game-shell-schema.test.ts`
Expected: all PASS.

- [ ] **Step 6: Re-run Task 1 engine tests; expect pass**

Run: `pnpm -C packages/brs-gen exec vitest run tests/tools/generate-app.test.ts -t "game_shell template threading"`
Expected: 4 PASS. The bare-spec test verifies that Zod defaults flow downstream via Plan 4e's `appSpec = strict.data` mechanism.

If the bare-spec test still fails with "config.brs not found", the engine's emission gate may not be firing. Re-check Task 1 Step 4's edit — the existing gate `if (branding.primary_color || content || effectivePrimaryColor)` should fire because `content` is defined post-strict-parse (defaults populate it).

- [ ] **Step 7: Confirm `pnpm -C packages/brs-gen build` is clean**

Run: `pnpm -C packages/brs-gen build`
Expected: zero TS errors.

- [ ] **Step 8: Commit**

```bash
git add packages/brs-gen/templates/game_shell/template.toml packages/brs-gen/templates/game_shell/schema.ts packages/brs-gen/tests/templates/game-shell-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(brs-gen): game_shell template metadata + schema + schema tests

template.toml declares the standard app manifest (title, version,
ui_resolutions=hd,fhd, icons, splash, splash_color=#000000,
splash_min_time=1500, screen_saver_private=1, requires_audio_guide=0)
plus 3 init_hooks (GameScene/after_scene_show, after_game_start,
after_game_over) and 3 scene_nodes (GameScene, Paddle, Ball).

schema.ts declares GameShellSpecSchema with .strict() and content
fields all Zod-defaulted: cpu_difficulty (normal), score_to_win (5),
high_score_persistence (true). Per Plan 4e Task 11 fix, defaults
flow downstream so bare-spec generates work.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `manifest.ejs` + manifest snapshot test

**Goal:** Render the manifest from EJS template + snapshot the output for regression detection.

**Files:**
- Create: `packages/brs-gen/templates/game_shell/files/manifest.ejs`
- Create (regen): `packages/brs-gen/tests/__golden__/game_shell/manifest.snap`
- Modify: existing manifest snapshot test runner if a per-template registry exists; otherwise add inline test in `tests/templates/game-shell-manifest.test.ts`.

- [ ] **Step 1: Inspect screensaver's `manifest.ejs` and how its snapshot test is wired**

Run:
```
cat packages/brs-gen/templates/screensaver/files/manifest.ejs
ls packages/brs-gen/tests/templates/ | grep manifest
```
Confirm the per-template snapshot pattern (likely a `<template>-manifest.test.ts` file using `toMatchFileSnapshot`).

- [ ] **Step 2: Write `manifest.ejs`**

Create `packages/brs-gen/templates/game_shell/files/manifest.ejs`:

```ejs
title=<%= spec.app.name %>
major_version=<%= spec.app.major_version %>
minor_version=<%= spec.app.minor_version %>
build_version=<%= String(spec.app.build_version).padStart(5, '0') %>
ui_resolutions=hd,fhd
mm_icon_focus_hd=pkg:/images/icon_hd.png
mm_icon_focus_fhd=pkg:/images/icon_fhd.png
splash_screen_hd=pkg:/images/splash_hd.png
splash_screen_fhd=pkg:/images/splash_fhd.png
splash_color=#000000
splash_min_time=1500
screen_saver_private=1
requires_audio_guide=0
```

Note: `build_version` uses Roku's required 5-digit zero-padded format (`00000` minimum). Confirm whether the merger / EJS context handles padding upstream — if it does, drop `padStart(5, '0')` and emit raw. If unsure, run `cat packages/brs-gen/templates/screensaver/files/manifest.ejs` and mirror its build_version pattern.

- [ ] **Step 3: Write manifest snapshot test**

Create `packages/brs-gen/tests/templates/game-shell-manifest.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp } from '../../src/tools/generate-app.js';

describe('game_shell manifest snapshot', () => {
  it('matches golden manifest', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'game-shell-manifest-'));
    const result = await generateApp(
      { spec_version: 2, template: 'game_shell', modules: [], app: { name: 'Pong E2E', major_version: 0, minor_version: 1, build_version: 0 } },
      { outputDir },
    );
    expect(result.ok).toBe(true);
    const manifest = readFileSync(join(outputDir, 'manifest'), 'utf8');
    await expect(manifest).toMatchFileSnapshot('../__golden__/game_shell/manifest.snap');
  });
});
```

Mirror whatever import paths and helper conventions the screensaver snapshot test uses (look at `tests/templates/screensaver-manifest.test.ts` if it exists).

- [ ] **Step 4: Run snapshot test (first run creates the snap file)**

Run: `pnpm -C packages/brs-gen exec vitest run tests/templates/game-shell-manifest.test.ts -u`
Expected: PASS. The `-u` flag writes the snapshot file. Verify the file exists at `tests/__golden__/game_shell/manifest.snap`.

- [ ] **Step 5: Open the generated `manifest.snap` and audit against spec §4**

Run: `cat packages/brs-gen/tests/__golden__/game_shell/manifest.snap`
Expected: 13 lines matching spec §4 verbatim. Confirm:
- `title=Pong E2E`
- `major_version=0`, `minor_version=1`, `build_version=00000` (or `0` — match whatever Step 2 produced)
- `ui_resolutions=hd,fhd`
- 4 lines of icon + splash paths
- `splash_color=#000000`, `splash_min_time=1500`
- `screen_saver_private=1`, `requires_audio_guide=0`
- NO `screensaver_title=` (load-bearing absence per spec §4 + §13)

If anything is off, fix `manifest.ejs` and re-run with `-u`.

- [ ] **Step 6: Re-run without `-u` to confirm idempotent**

Run: `pnpm -C packages/brs-gen exec vitest run tests/templates/game-shell-manifest.test.ts`
Expected: PASS (no snapshot updates).

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/templates/game_shell/files/manifest.ejs packages/brs-gen/tests/templates/game-shell-manifest.test.ts packages/brs-gen/tests/__golden__/game_shell/manifest.snap
git commit -m "$(cat <<'EOF'
feat(brs-gen): game_shell manifest.ejs + golden snapshot

Standard app manifest per spec §4. screen_saver_private=1 opts out
of OS screensaver during gameplay. requires_audio_guide=0 explicit.
NO screensaver_title= (load-bearing absence; ensures
SCREENSAVER_ZIP_TOO_LARGE validator from Plan 4e skips this template).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `source/main.brs` + snapshot

**Goal:** Standard `Main()` entry point with the canonical SceneGraph message-pump loop.

**Files:**
- Create: `packages/brs-gen/templates/game_shell/files/source/main.brs`
- Create (regen): `packages/brs-gen/tests/__golden__/game_shell/main.brs.snap`
- Create: `packages/brs-gen/tests/templates/game-shell-main.test.ts`

- [ ] **Step 1: Reference an existing template's `main.brs` for the canonical pattern**

Run: `cat packages/brs-gen/templates/blank_scenegraph/files/source/main.brs` (most minimal app-style template).

If `blank_scenegraph` doesn't have a `main.brs` (some templates rely on a default-injected one), inspect `video_grid_channel`'s instead. Document the canonical pattern observed.

- [ ] **Step 2: Write `main.brs`**

Create `packages/brs-gen/templates/game_shell/files/source/main.brs`:

```brightscript
sub Main()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.setMessagePort(port)
    scene = screen.CreateScene("GameScene")
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

(If the existing template's `main.brs` uses a slightly different idiom — e.g. a local `m.global` setup, or a `roUrlTransfer`-priming workaround — match the existing pattern verbatim instead. Determinism matters more than novelty here.)

- [ ] **Step 3: Write snapshot test**

Create `packages/brs-gen/tests/templates/game-shell-main.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp } from '../../src/tools/generate-app.js';

describe('game_shell main.brs snapshot', () => {
  it('matches golden main.brs', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'game-shell-main-'));
    const result = await generateApp(
      { spec_version: 2, template: 'game_shell', modules: [], app: { name: 'Pong', major_version: 0, minor_version: 1, build_version: 0 } },
      { outputDir },
    );
    expect(result.ok).toBe(true);
    const main = readFileSync(join(outputDir, 'source/main.brs'), 'utf8');
    await expect(main).toMatchFileSnapshot('../__golden__/game_shell/main.brs.snap');
  });
});
```

- [ ] **Step 4: Run snapshot test with `-u`**

Run: `pnpm -C packages/brs-gen exec vitest run tests/templates/game-shell-main.test.ts -u`
Expected: PASS. Snap file written.

- [ ] **Step 5: Re-run without `-u`**

Expected: PASS, no updates.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/templates/game_shell/files/source/main.brs packages/brs-gen/tests/templates/game-shell-main.test.ts packages/brs-gen/tests/__golden__/game_shell/main.brs.snap
git commit -m "feat(brs-gen): game_shell source/main.brs + golden snapshot

Standard sub Main() + roSGScreen + message-pump loop. Creates the
GameScene root; loop exits on roSGScreenEvent.isScreenClosed().

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: `source/lib/pong.brs` + snapshot

**Goal:** Pure-math collision/AI helpers + module-level constant table per spec §5.5. No SG references, no `m.*`.

**Files:**
- Create: `packages/brs-gen/templates/game_shell/files/source/lib/pong.brs`
- Create (regen): `packages/brs-gen/tests/__golden__/game_shell/pong.brs.snap`
- Create: `packages/brs-gen/tests/templates/game-shell-pong-brs.test.ts`

- [ ] **Step 1: Write `pong.brs`**

Create `packages/brs-gen/templates/game_shell/files/source/lib/pong.brs`:

```brightscript
' ---------------------------------------------------------------------
' pong.brs - pure-math helpers for game_shell template (Pong reference).
' No SG references, no m.*. Deterministic. TS shim mirrors this file
' verbatim at packages/brs-gen/tests/templates/pong-helpers.ts; keep
' the constants below in sync (covered by pong-const-parity.test.ts).
' ---------------------------------------------------------------------

' Logical canvas constants (1920x1080 top-left origin; +x right, +y down).
const PONG_SCREEN_W% = 1920
const PONG_SCREEN_H% = 1080
const PONG_PADDLE_W% = 20
const PONG_PADDLE_H% = 140
const PONG_BALL_SIZE% = 24
const PONG_PADDLE_SPEED_PX% = 12
const PONG_BALL_VX_INITIAL! = 9.0
const PONG_BALL_VY_INITIAL! = 4.5

' CPU paddle: track ballY toward paddle centre, lagged by lagPx.
' Returns the new top-left paddleY for the CPU side. CPU delta is
' capped at 1.2 * PONG_PADDLE_SPEED_PX per tick (R1 mitigation).
function Pong_StepCpu(currentPaddleY as float, ballY as float, lagPx as integer) as float
    targetCentre = ballY
    paddleCentre = currentPaddleY + (PONG_PADDLE_H% / 2)
    delta = targetCentre - paddleCentre
    if abs(delta) <= lagPx then return currentPaddleY
    maxDelta = PONG_PADDLE_SPEED_PX% * 1.2
    if delta > maxDelta then delta = maxDelta
    if delta < -maxDelta then delta = -maxDelta
    newY = currentPaddleY + delta
    if newY < 0 then newY = 0
    maxY = PONG_SCREEN_H% - PONG_PADDLE_H%
    if newY > maxY then newY = maxY
    return newY
end function

' Advances ball by (vx, vy). Does NOT perform wall or paddle collision.
' Tests left/right edges for scoring. Returns assocArray:
'   { ballX: float, ballY: float, vx: float, vy: float, scored: string }
' scored is "" / "player" (passed left edge; CPU wins this rally) /
' "cpu" (passed right edge; player wins this rally).
function Pong_StepBall(ballX as float, ballY as float, vx as float, vy as float) as object
    nx = ballX + vx
    ny = ballY + vy
    scored = ""
    if nx + PONG_BALL_SIZE% < 0 then scored = "player"
    if nx > PONG_SCREEN_W% then scored = "cpu"
    return { ballX: nx, ballY: ny, vx: vx, vy: vy, scored: scored }
end function

' Detects rect-vs-rect overlap of ball and paddle. Reflects vx ONLY when
' ball is moving toward the paddle (prevents stick-collision when ball
' overlaps paddle for >1 tick). Adds vy "english" based on hit position
' relative to paddle centre. Returns { vx: float, vy: float }.
function Pong_CollidePaddle(ballX as float, ballY as float, vx as float, vy as float, paddleX as float, paddleY as float) as object
    ' Overlap check.
    if ballX + PONG_BALL_SIZE% < paddleX then return { vx: vx, vy: vy }
    if ballX > paddleX + PONG_PADDLE_W% then return { vx: vx, vy: vy }
    if ballY + PONG_BALL_SIZE% < paddleY then return { vx: vx, vy: vy }
    if ballY > paddleY + PONG_PADDLE_H% then return { vx: vx, vy: vy }
    ' Approaching-frame check: paddle on left of ball means ball is moving
    ' rightward into a left paddle (vx < 0 = approaching); paddle on right
    ' of ball means ball moving rightward (vx > 0 = approaching).
    paddleCentreX = paddleX + (PONG_PADDLE_W% / 2)
    if paddleCentreX < ballX and vx > 0 then return { vx: vx, vy: vy }   ' moving away
    if paddleCentreX > ballX and vx < 0 then return { vx: vx, vy: vy }   ' moving away
    ' Reflect vx; add english based on (ballCentreY - paddleCentreY).
    ballCentreY = ballY + (PONG_BALL_SIZE% / 2)
    paddleCentreY = paddleY + (PONG_PADDLE_H% / 2)
    english = (ballCentreY - paddleCentreY) / (PONG_PADDLE_H% / 2)   ' -1.0 .. 1.0
    return { vx: -vx, vy: vy + (english * 3.0) }
end function

' Detects ball-vs-wall (top OR bottom). Flips vy on wall hit.
function Pong_CollideWall(ballY as float, vy as float, screenH as integer) as float
    if ballY <= 0 and vy < 0 then return -vy
    if ballY + PONG_BALL_SIZE% >= screenH and vy > 0 then return -vy
    return vy
end function

' Difficulty -> CPU lag in pixels. Unknown -> 25 (normal).
function Pong_DifficultyToLagPx(difficulty as string) as integer
    if difficulty = "easy" then return 60
    if difficulty = "hard" then return 5
    return 25
end function
```

- [ ] **Step 2: Write snapshot test**

Create `packages/brs-gen/tests/templates/game-shell-pong-brs.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp } from '../../src/tools/generate-app.js';

describe('game_shell pong.brs snapshot', () => {
  it('matches golden pong.brs', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'game-shell-pong-'));
    const result = await generateApp(
      { spec_version: 2, template: 'game_shell', modules: [], app: { name: 'Pong', major_version: 0, minor_version: 1, build_version: 0 } },
      { outputDir },
    );
    expect(result.ok).toBe(true);
    const pong = readFileSync(join(outputDir, 'source/lib/pong.brs'), 'utf8');
    await expect(pong).toMatchFileSnapshot('../__golden__/game_shell/pong.brs.snap');
  });
});
```

- [ ] **Step 3: Run with `-u`**

Run: `pnpm -C packages/brs-gen exec vitest run tests/templates/game-shell-pong-brs.test.ts -u`
Expected: PASS. Snap file written.

- [ ] **Step 4: Re-run without `-u`**

Expected: PASS, no updates.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/templates/game_shell/files/source/lib/pong.brs packages/brs-gen/tests/templates/game-shell-pong-brs.test.ts packages/brs-gen/tests/__golden__/game_shell/pong.brs.snap
git commit -m "feat(brs-gen): game_shell source/lib/pong.brs + golden snapshot

Five pure-math helpers + module-level constant table per spec §5.5.
Pong_StepCpu (CPU AI with capped delta), Pong_StepBall (advance +
score detection), Pong_CollidePaddle (rect overlap + approaching-frame
guard + english), Pong_CollideWall (top/bottom reflection),
Pong_DifficultyToLagPx (easy/normal/hard mapping). All deterministic.

Constants (PONG_SCREEN_W/H, PADDLE_W/H, BALL_SIZE, PADDLE_SPEED_PX,
BALL_VX/VY_INITIAL) mirrored verbatim in TS shim at
tests/templates/pong-helpers.ts (Task 6); parity asserted in
pong-const-parity.test.ts (Task 7).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: TS shim + off-device unit tests

**Goal:** Verbatim TS translation of `pong.brs` so we can exercise the helpers under Vitest with no Roku in the loop. Per spec R7, this is the cheapest path to true unit coverage; const-parity test (Task 7) catches numeric drift.

**Files:**
- Create: `packages/brs-gen/tests/templates/pong-helpers.ts`
- Create: `packages/brs-gen/tests/templates/pong-helpers.test.ts`

- [ ] **Step 1: Write `pong-helpers.ts` (TS shim)**

Create `packages/brs-gen/tests/templates/pong-helpers.ts`:

```typescript
// pong-helpers.ts — verbatim TS translation of templates/game_shell/files/source/lib/pong.brs.
// Keep numeric constants in sync; pong-const-parity.test.ts asserts parity.

export const PONG_SCREEN_W = 1920;
export const PONG_SCREEN_H = 1080;
export const PONG_PADDLE_W = 20;
export const PONG_PADDLE_H = 140;
export const PONG_BALL_SIZE = 24;
export const PONG_PADDLE_SPEED_PX = 12;
export const PONG_BALL_VX_INITIAL = 9.0;
export const PONG_BALL_VY_INITIAL = 4.5;

export function pongStepCpu(currentPaddleY: number, ballY: number, lagPx: number): number {
  const targetCentre = ballY;
  const paddleCentre = currentPaddleY + PONG_PADDLE_H / 2;
  let delta = targetCentre - paddleCentre;
  if (Math.abs(delta) <= lagPx) return currentPaddleY;
  const maxDelta = PONG_PADDLE_SPEED_PX * 1.2;
  if (delta > maxDelta) delta = maxDelta;
  if (delta < -maxDelta) delta = -maxDelta;
  let newY = currentPaddleY + delta;
  if (newY < 0) newY = 0;
  const maxY = PONG_SCREEN_H - PONG_PADDLE_H;
  if (newY > maxY) newY = maxY;
  return newY;
}

export interface BallStepResult {
  ballX: number;
  ballY: number;
  vx: number;
  vy: number;
  scored: '' | 'player' | 'cpu';
}

export function pongStepBall(ballX: number, ballY: number, vx: number, vy: number): BallStepResult {
  const nx = ballX + vx;
  const ny = ballY + vy;
  let scored: '' | 'player' | 'cpu' = '';
  if (nx + PONG_BALL_SIZE < 0) scored = 'player';
  if (nx > PONG_SCREEN_W) scored = 'cpu';
  return { ballX: nx, ballY: ny, vx, vy, scored };
}

export interface PaddleCollideResult { vx: number; vy: number; }

export function pongCollidePaddle(
  ballX: number, ballY: number, vx: number, vy: number,
  paddleX: number, paddleY: number,
): PaddleCollideResult {
  if (ballX + PONG_BALL_SIZE < paddleX) return { vx, vy };
  if (ballX > paddleX + PONG_PADDLE_W) return { vx, vy };
  if (ballY + PONG_BALL_SIZE < paddleY) return { vx, vy };
  if (ballY > paddleY + PONG_PADDLE_H) return { vx, vy };
  const paddleCentreX = paddleX + PONG_PADDLE_W / 2;
  if (paddleCentreX < ballX && vx > 0) return { vx, vy };
  if (paddleCentreX > ballX && vx < 0) return { vx, vy };
  const ballCentreY = ballY + PONG_BALL_SIZE / 2;
  const paddleCentreY = paddleY + PONG_PADDLE_H / 2;
  const english = (ballCentreY - paddleCentreY) / (PONG_PADDLE_H / 2);
  return { vx: -vx, vy: vy + english * 3.0 };
}

export function pongCollideWall(ballY: number, vy: number, screenH: number): number {
  if (ballY <= 0 && vy < 0) return -vy;
  if (ballY + PONG_BALL_SIZE >= screenH && vy > 0) return -vy;
  return vy;
}

export function pongDifficultyToLagPx(difficulty: string): number {
  if (difficulty === 'easy') return 60;
  if (difficulty === 'hard') return 5;
  return 25;
}
```

- [ ] **Step 2: Write `pong-helpers.test.ts`**

Create `packages/brs-gen/tests/templates/pong-helpers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  pongStepCpu, pongStepBall, pongCollidePaddle, pongCollideWall, pongDifficultyToLagPx,
  PONG_PADDLE_SPEED_PX, PONG_PADDLE_H, PONG_SCREEN_H, PONG_BALL_SIZE,
} from './pong-helpers.js';

describe('pongDifficultyToLagPx', () => {
  it.each([['easy', 60], ['normal', 25], ['hard', 5], ['unknown', 25], ['', 25]] as const)(
    '%s -> %d', (d, expected) => { expect(pongDifficultyToLagPx(d)).toBe(expected); },
  );
});

describe('pongStepCpu', () => {
  it('does not move when ball is within lag tolerance', () => {
    expect(pongStepCpu(400, 470, 25)).toBe(400);  // paddleCentre=470, ballY=470, delta=0
  });
  it('moves toward ball when ball is below', () => {
    const r = pongStepCpu(400, 700, 25);  // paddleCentre=470, target=700, delta=230 > maxDelta=14.4
    expect(r).toBe(400 + 14.4);
  });
  it('clamps to screen top', () => {
    expect(pongStepCpu(0, -1000, 5)).toBe(0);
  });
  it('clamps to screen bottom', () => {
    const maxY = PONG_SCREEN_H - PONG_PADDLE_H;
    expect(pongStepCpu(maxY, 9999, 5)).toBe(maxY);
  });
});

describe('pongStepBall', () => {
  it('advances by (vx, vy) and reports no score in middle of court', () => {
    const r = pongStepBall(960, 540, 9, 4.5);
    expect(r.ballX).toBe(969);
    expect(r.ballY).toBe(544.5);
    expect(r.scored).toBe('');
  });
  it('reports scored=player when ball passes left edge', () => {
    const r = pongStepBall(-PONG_BALL_SIZE, 540, -1, 0);
    expect(r.scored).toBe('player');
  });
  it('reports scored=cpu when ball passes right edge', () => {
    const r = pongStepBall(1920, 540, 1, 0);
    expect(r.scored).toBe('cpu');
  });
});

describe('pongCollidePaddle', () => {
  it('returns unchanged when no overlap', () => {
    const r = pongCollidePaddle(960, 540, -9, 0, 40, 470);
    expect(r).toEqual({ vx: -9, vy: 0 });
  });
  it('reflects vx when ball overlaps left paddle and is moving leftward', () => {
    // Ball at x=50 (overlaps paddle at x=40,w=20 -> spans 40..60), vx=-9 (moving toward paddle).
    // Paddle centre x = 50; ball x = 50; paddleCentreX < ballX is false; vx<0 so reflect.
    const r = pongCollidePaddle(50, 540, -9, 0, 40, 470);
    expect(r.vx).toBe(9);
  });
  it('does NOT reflect when ball overlaps but is moving away (stick-collision guard)', () => {
    // Ball at x=50 (still overlapping), but vx=+5 (moving right, AWAY from left paddle).
    // paddleCentreX (50) > ballX (50)? No (equal). Per code, the strict-greater check fails;
    // then we check if approach reflects. Use a less-degenerate setup:
    const r = pongCollidePaddle(55, 540, +5, 0, 40, 470);
    // paddleCentreX (50) < ballX (55) AND vx > 0 (moving right, away from left paddle).
    expect(r).toEqual({ vx: 5, vy: 0 });
  });
  it('adds positive english when ball hits below paddle centre', () => {
    // paddleY=470, paddleCentreY=540. Ball at ballY=580 (below centre). english>0.
    const r = pongCollidePaddle(50, 580, -9, 0, 40, 470);
    expect(r.vy).toBeGreaterThan(0);
  });
});

describe('pongCollideWall', () => {
  it('flips vy on top wall hit', () => {
    expect(pongCollideWall(0, -3, PONG_SCREEN_H)).toBe(3);
  });
  it('flips vy on bottom wall hit', () => {
    expect(pongCollideWall(PONG_SCREEN_H - PONG_BALL_SIZE, 3, PONG_SCREEN_H)).toBe(-3);
  });
  it('returns vy unchanged when ball is in middle', () => {
    expect(pongCollideWall(540, 3, PONG_SCREEN_H)).toBe(3);
  });
  it('does not double-flip when ball already moving away from wall', () => {
    expect(pongCollideWall(0, 3, PONG_SCREEN_H)).toBe(3);
  });
});
```

- [ ] **Step 3: Run unit tests**

Run: `pnpm -C packages/brs-gen exec vitest run tests/templates/pong-helpers.test.ts`
Expected: all PASS. If any fail, the bug is in `pong-helpers.ts` — fix the shim, NOT the tests, until they all pass. Then mirror the fix into `pong.brs` (Task 5) and re-run Task 5's snapshot to update the golden.

- [ ] **Step 4: Build check**

Run: `pnpm -C packages/brs-gen build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/tests/templates/pong-helpers.ts packages/brs-gen/tests/templates/pong-helpers.test.ts
git commit -m "test(brs-gen): pong-helpers TS shim + off-device unit tests

Verbatim TS translation of pong.brs for Vitest coverage. Five helper
groups (StepCpu, StepBall, CollidePaddle, CollideWall, DifficultyToLagPx)
covered with edge cases (in-tolerance no-move, below-tolerance move,
top/bottom clamps, score detection, stick-collision guard, english).

Per spec §14 R7, drift between BRS and TS is mitigated by (a) verbatim
review in same PR and (b) const-parity test in Task 7.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Const-parity test

**Goal:** Parse the `const PONG_*` block at the top of `pong.brs` and assert numeric equality with the TS shim's exported constants. Catches the most common R7 drift class.

**Files:**
- Create: `packages/brs-gen/tests/templates/pong-const-parity.test.ts`

- [ ] **Step 1: Write the parity test**

Create `packages/brs-gen/tests/templates/pong-const-parity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shim from './pong-helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PONG_BRS = join(HERE, '../../templates/game_shell/files/source/lib/pong.brs');

// Map BRS const name -> TS shim export name.
const PARITY: Array<[string, keyof typeof shim, number]> = [
  ['PONG_SCREEN_W%', 'PONG_SCREEN_W', 1920],
  ['PONG_SCREEN_H%', 'PONG_SCREEN_H', 1080],
  ['PONG_PADDLE_W%', 'PONG_PADDLE_W', 20],
  ['PONG_PADDLE_H%', 'PONG_PADDLE_H', 140],
  ['PONG_BALL_SIZE%', 'PONG_BALL_SIZE', 24],
  ['PONG_PADDLE_SPEED_PX%', 'PONG_PADDLE_SPEED_PX', 12],
  ['PONG_BALL_VX_INITIAL!', 'PONG_BALL_VX_INITIAL', 9.0],
  ['PONG_BALL_VY_INITIAL!', 'PONG_BALL_VY_INITIAL', 4.5],
];

describe('pong.brs <-> pong-helpers.ts const parity', () => {
  const brs = readFileSync(PONG_BRS, 'utf8');

  for (const [brsName, tsName, expectedValue] of PARITY) {
    it(`${brsName} === shim.${String(tsName)} === ${expectedValue}`, () => {
      // Parse BRS: `const NAME = VALUE` (with optional whitespace, % or ! suffix).
      const escaped = brsName.replace(/[%!]/g, '\\$&');
      const re = new RegExp(`const\\s+${escaped}\\s*=\\s*([0-9.\\-]+)`, 'm');
      const m = brs.match(re);
      expect(m, `BRS const ${brsName} not found in pong.brs`).toBeTruthy();
      const brsValue = parseFloat(m![1]);
      const tsValue = shim[tsName];
      expect(brsValue).toBe(expectedValue);
      expect(tsValue).toBe(expectedValue);
    });
  }
});
```

- [ ] **Step 2: Run the parity test**

Run: `pnpm -C packages/brs-gen exec vitest run tests/templates/pong-const-parity.test.ts`
Expected: 8 PASS. If any fail, the BRS regex did not match — inspect the actual `pong.brs` const-block formatting and adjust the regex (or the BRS file's whitespace) so the regex parses cleanly.

- [ ] **Step 3: Build check**

Run: `pnpm -C packages/brs-gen build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/tests/templates/pong-const-parity.test.ts
git commit -m "test(brs-gen): pong.brs <-> TS shim const-parity test

Parses the const block at the top of pong.brs via regex and asserts
numeric equality against the TS shim's exported constants. 8 const
pairs covered (screen, paddle, ball, speed, initial velocity).

Mitigates spec §14 R7 by detecting drift at test time.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: `Ball.xml` + `Ball.bs` + snapshots

**Goal:** Smallest component first — single inner Rectangle, public `ballX/ballY/vx/vy` interface fields with `ballX`+`ballY` mirrored onto the inner rectangle's translation.

**Files:**
- Create: `packages/brs-gen/templates/game_shell/files/components/Ball.xml`
- Create: `packages/brs-gen/templates/game_shell/files/components/Ball.bs`
- Create (regen): `packages/brs-gen/tests/__golden__/game_shell/Ball.xml.snap`
- Create (regen): `packages/brs-gen/tests/__golden__/game_shell/Ball.bs.snap`
- Create: `packages/brs-gen/tests/templates/game-shell-ball.test.ts`

- [ ] **Step 1: Write `Ball.xml`**

Create `packages/brs-gen/templates/game_shell/files/components/Ball.xml`:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<component name="Ball" extends="Group">
    <interface>
        <field id="ballX" type="float" alias="ballRect.translation.0" />
        <field id="ballY" type="float" alias="ballRect.translation.1" />
        <field id="vx" type="float" />
        <field id="vy" type="float" />
    </interface>
    <script type="text/brightscript" uri="Ball.bs" />
    <children>
        <Rectangle id="ballRect" width="24" height="24" color="0xFFFFFFFF" />
    </children>
</component>
```

If `field alias=` syntax does NOT work for SceneGraph translation fields (Roku docs may forbid sub-index aliases), fall back to a manual observer in `Ball.bs`. Test on device in Task 14; for now, code defensively in `Ball.bs` with an observer-based fallback.

- [ ] **Step 2: Write `Ball.bs`**

Create `packages/brs-gen/templates/game_shell/files/components/Ball.bs`:

```brightscript
sub init()
    m.ballRect = m.top.findNode("ballRect")
    m.top.observeField("ballX", "onBallPos")
    m.top.observeField("ballY", "onBallPos")
end sub

sub onBallPos()
    m.ballRect.translation = [m.top.ballX, m.top.ballY]
end sub
```

(The `alias` attribute in XML may be sufficient; if so, `Ball.bs` becomes a no-op `init()`. The defensive observer is harmless either way — it overwrites `translation` to the same value the alias already set. Adopt whichever pattern prior templates use; check `cat packages/brs-gen/templates/screensaver/files/components/PhotoCycle.xml` for `alias=` precedent.)

- [ ] **Step 3: Write snapshot test**

Create `packages/brs-gen/tests/templates/game-shell-ball.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp } from '../../src/tools/generate-app.js';

describe('game_shell Ball component snapshot', () => {
  it('matches golden Ball.xml + Ball.brs', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'game-shell-ball-'));
    const result = await generateApp(
      { spec_version: 2, template: 'game_shell', modules: [], app: { name: 'Pong', major_version: 0, minor_version: 1, build_version: 0 } },
      { outputDir },
    );
    expect(result.ok).toBe(true);
    const xml = readFileSync(join(outputDir, 'components/Ball.xml'), 'utf8');
    const brs = readFileSync(join(outputDir, 'components/Ball.brs'), 'utf8');
    await expect(xml).toMatchFileSnapshot('../__golden__/game_shell/Ball.xml.snap');
    await expect(brs).toMatchFileSnapshot('../__golden__/game_shell/Ball.bs.snap');
  });
});
```

(Note: the post-compile sweep rewrites `.bs` -> `.brs` in the output, so we read `.brs` on disk but snapshot it under `.bs.snap` for naming consistency with the source.)

- [ ] **Step 4: Run with `-u`**

Run: `pnpm -C packages/brs-gen exec vitest run tests/templates/game-shell-ball.test.ts -u`
Expected: PASS. Two snap files written.

- [ ] **Step 5: Re-run without `-u`**

Expected: PASS, no updates.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/templates/game_shell/files/components/Ball.xml packages/brs-gen/templates/game_shell/files/components/Ball.bs packages/brs-gen/tests/templates/game-shell-ball.test.ts packages/brs-gen/tests/__golden__/game_shell/Ball.xml.snap packages/brs-gen/tests/__golden__/game_shell/Ball.bs.snap
git commit -m "feat(brs-gen): game_shell Ball component + golden snapshots

Single inner Rectangle (24x24, white). Public ballX/ballY/vx/vy
interface fields. Defensive observer mirrors ballX/ballY onto inner
rect translation (in addition to any alias= sugar that may apply).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: `Paddle.xml` + `Paddle.bs` + snapshots

**Goal:** Single inner Rectangle (20x140 white), public `paddleY` + `side` interface fields. The `side` field is set once at create-time by `GameScene` (left -> X=40, right -> X=1860); `Paddle.bs` reads it in `init()` and applies `translation[0]` accordingly.

**Files:**
- Create: `packages/brs-gen/templates/game_shell/files/components/Paddle.xml`
- Create: `packages/brs-gen/templates/game_shell/files/components/Paddle.bs`
- Create (regen): `packages/brs-gen/tests/__golden__/game_shell/Paddle.xml.snap`
- Create (regen): `packages/brs-gen/tests/__golden__/game_shell/Paddle.bs.snap`
- Create: `packages/brs-gen/tests/templates/game-shell-paddle.test.ts`

- [ ] **Step 1: Write `Paddle.xml`**

Create `packages/brs-gen/templates/game_shell/files/components/Paddle.xml`:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<component name="Paddle" extends="Group">
    <interface>
        <field id="paddleY" type="float" />
        <field id="side" type="string" />
    </interface>
    <script type="text/brightscript" uri="Paddle.bs" />
    <children>
        <Rectangle id="paddleRect" width="20" height="140" color="0xFFFFFFFF" />
    </children>
</component>
```

- [ ] **Step 2: Write `Paddle.bs`**

Create `packages/brs-gen/templates/game_shell/files/components/Paddle.bs`:

```brightscript
sub init()
    m.paddleRect = m.top.findNode("paddleRect")
    ' side is set by GameScene before any paddleY writes; read once.
    if m.top.side = "left" then
        m.sideX = 40
    else
        m.sideX = 1860
    end if
    m.top.observeField("paddleY", "onPaddleY")
end sub

sub onPaddleY()
    m.paddleRect.translation = [m.sideX, m.top.paddleY]
end sub
```

- [ ] **Step 3: Write snapshot test**

Create `packages/brs-gen/tests/templates/game-shell-paddle.test.ts` (mirror Task 8's pattern but for Paddle):

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp } from '../../src/tools/generate-app.js';

describe('game_shell Paddle component snapshot', () => {
  it('matches golden Paddle.xml + Paddle.brs', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'game-shell-paddle-'));
    const result = await generateApp(
      { spec_version: 2, template: 'game_shell', modules: [], app: { name: 'Pong', major_version: 0, minor_version: 1, build_version: 0 } },
      { outputDir },
    );
    expect(result.ok).toBe(true);
    const xml = readFileSync(join(outputDir, 'components/Paddle.xml'), 'utf8');
    const brs = readFileSync(join(outputDir, 'components/Paddle.brs'), 'utf8');
    await expect(xml).toMatchFileSnapshot('../__golden__/game_shell/Paddle.xml.snap');
    await expect(brs).toMatchFileSnapshot('../__golden__/game_shell/Paddle.bs.snap');
  });
});
```

- [ ] **Step 4: Run with `-u`**

Run: `pnpm -C packages/brs-gen exec vitest run tests/templates/game-shell-paddle.test.ts -u`
Expected: PASS. Two snap files written.

- [ ] **Step 5: Re-run without `-u`**

Expected: PASS, no updates.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/templates/game_shell/files/components/Paddle.xml packages/brs-gen/templates/game_shell/files/components/Paddle.bs packages/brs-gen/tests/templates/game-shell-paddle.test.ts packages/brs-gen/tests/__golden__/game_shell/Paddle.xml.snap packages/brs-gen/tests/__golden__/game_shell/Paddle.bs.snap
git commit -m "feat(brs-gen): game_shell Paddle component + golden snapshots

Single inner Rectangle (20x140, white). Public paddleY + side
interface fields. side is read once in init() to compute sideX
(left=40, right=1860); paddleY observer mirrors onto inner rect.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: `GameScene.xml` + `GameScene.bs` + snapshots

**Goal:** The big one. Root scene with state machine (`title`/`playing`/`gameover`), 60 Hz Timer-driven game loop, key handler (Up/Down continuous-while-held), high-score I/O, and three init-hook fires. The `after_scene_show` hook fires from `init()` — NOT from `enterTitle()` — per the spec §5.2 Plan-4d-style pattern.

**Files:**
- Create: `packages/brs-gen/templates/game_shell/files/components/GameScene.xml`
- Create: `packages/brs-gen/templates/game_shell/files/components/GameScene.bs`
- Create (regen): `packages/brs-gen/tests/__golden__/game_shell/GameScene.xml.snap`
- Create (regen): `packages/brs-gen/tests/__golden__/game_shell/GameScene.bs.snap`
- Create: `packages/brs-gen/tests/templates/game-shell-gamescene.test.ts`

- [ ] **Step 1: Write `GameScene.xml`**

Create `packages/brs-gen/templates/game_shell/files/components/GameScene.xml`:

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<component name="GameScene" extends="Scene">
    <interface>
        <field id="cpuDifficulty" type="string" />
        <field id="scoreToWin" type="integer" />
        <field id="highScorePersistence" type="boolean" />
    </interface>
    <script type="text/brightscript" uri="GameScene.bs" />
    <script type="text/brightscript" uri="pkg:/source/lib/pong.brs" />
    <script type="text/brightscript" uri="pkg:/source/_template/config.bs" />
    <script type="text/brightscript" uri="pkg:/source/_modules/__init_hooks.bs" />
    <children>
        <Rectangle id="bg" width="1920" height="1080" color="0x000000FF" />

        <!-- Center dashed line: 10 short rectangles vertically distributed -->
        <Rectangle id="dash0" width="4" height="18" translation="[958, 60]"  color="0xFFFFFFFF" />
        <Rectangle id="dash1" width="4" height="18" translation="[958, 162]" color="0xFFFFFFFF" />
        <Rectangle id="dash2" width="4" height="18" translation="[958, 264]" color="0xFFFFFFFF" />
        <Rectangle id="dash3" width="4" height="18" translation="[958, 366]" color="0xFFFFFFFF" />
        <Rectangle id="dash4" width="4" height="18" translation="[958, 468]" color="0xFFFFFFFF" />
        <Rectangle id="dash5" width="4" height="18" translation="[958, 570]" color="0xFFFFFFFF" />
        <Rectangle id="dash6" width="4" height="18" translation="[958, 672]" color="0xFFFFFFFF" />
        <Rectangle id="dash7" width="4" height="18" translation="[958, 774]" color="0xFFFFFFFF" />
        <Rectangle id="dash8" width="4" height="18" translation="[958, 876]" color="0xFFFFFFFF" />
        <Rectangle id="dash9" width="4" height="18" translation="[958, 978]" color="0xFFFFFFFF" />

        <Paddle id="playerPaddle" side="left"  paddleY="470" />
        <Paddle id="cpuPaddle"    side="right" paddleY="470" />
        <Ball   id="ball" ballX="948" ballY="528" vx="0" vy="0" />

        <Label id="playerScore" text="0" translation="[640, 80]"  width="200" horizAlign="center"
               font="font:LargeBoldSystemFont" color="0xFFFFFFFF" />
        <Label id="cpuScore"    text="0" translation="[1080, 80]" width="200" horizAlign="center"
               font="font:LargeBoldSystemFont" color="0xFFFFFFFF" />

        <Group id="titleGroup" visible="true">
            <Label id="titleLine"   text="PONG"               translation="[760, 380]" width="400"
                   horizAlign="center" font="font:LargeBoldSystemFont" color="0xFFFFFFFF" />
            <Label id="titleHint"   text="Press OK to start"  translation="[660, 540]" width="600"
                   horizAlign="center" font="font:MediumBoldSystemFont" color="0xFFFFFFFF" />
            <Label id="titleHigh"   text="High score: 0"      translation="[660, 620]" width="600"
                   horizAlign="center" font="font:SmallSystemFont" color="0xFFFFFFFF" />
        </Group>

        <Group id="gameOverGroup" visible="false">
            <Label id="gameOverLine" text="GAME OVER"             translation="[660, 380]" width="600"
                   horizAlign="center" font="font:LargeBoldSystemFont" color="0xFFFFFFFF" />
            <Label id="gameOverHint" text="Press OK for new game" translation="[610, 540]" width="700"
                   horizAlign="center" font="font:MediumBoldSystemFont" color="0xFFFFFFFF" />
        </Group>

        <Timer id="tick" repeat="true" duration="0.0166" control="stop" />
    </children>
</component>
```

(SystemFont references like `font:LargeBoldSystemFont` are URI-style font references that Roku resolves built-in; if your engine's compiler/lint does not recognize them, switch to `<Font role="font" uri="font:LargeBoldSystemFont" />` child syntax inside the Label. Adopt the form prior templates use.)

The three `<script>` tags below `GameScene.bs` are LOAD-BEARING (Plan 4c invariant generalized in Plan 4e): we explicitly include `pong.brs` (because GameScene calls `Pong_*` functions), `config.bs` (because GameScene calls `TemplateConfig()`), and `__init_hooks.bs` (because GameScene calls `Modules_OnGameSceneAfterSceneShow` etc.). Without these, bsc lint fails with "Cannot find function".

- [ ] **Step 2: Write `GameScene.bs` — top of file (init + state-enter helpers)**

Create `packages/brs-gen/templates/game_shell/files/components/GameScene.bs`:

```brightscript
sub init()
    ' Read config from TemplateConfig() (defaults applied via Plan 4e schema-strict downstream).
    cfg = TemplateConfig()
    m.top.cpuDifficulty = cfg.cpu_difficulty
    m.top.scoreToWin = cfg.score_to_win.toInt()
    m.top.highScorePersistence = (cfg.high_score_persistence = "true")

    ' Cache child node refs.
    m.playerPaddle = m.top.findNode("playerPaddle")
    m.cpuPaddle = m.top.findNode("cpuPaddle")
    m.ball = m.top.findNode("ball")
    m.playerScoreLabel = m.top.findNode("playerScore")
    m.cpuScoreLabel = m.top.findNode("cpuScore")
    m.titleGroup = m.top.findNode("titleGroup")
    m.titleHigh = m.top.findNode("titleHigh")
    m.gameOverGroup = m.top.findNode("gameOverGroup")
    m.tick = m.top.findNode("tick")

    ' Internal state.
    m.state = "title"
    m.playerScore = 0
    m.cpuScore = 0
    m.upHeld = false
    m.downHeld = false
    m.servesPlayed = 0
    m.cpuLagPx = Pong_DifficultyToLagPx(m.top.cpuDifficulty)

    ' High score: read from registry if persistence enabled.
    m.highScore = 0
    if m.top.highScorePersistence then
        reg = CreateObject("roRegistrySection", "GameShell")
        if reg.exists("highScore") then m.highScore = val(reg.read("highScore"), 10)
    end if

    ' Wire timer + key handler.
    m.tick.observeField("fire", "onTick")

    ' Enter title (idempotent).
    enterTitle()

    ' Fire after_scene_show ONCE on boot, AFTER first enterTitle. Matches
    ' Plan 4d's NowPlayingScene/after_scene_show-from-init pattern.
    Modules_OnGameSceneAfterSceneShow(m)
end sub

sub enterTitle()
    m.tick.control = "stop"
    m.playerScore = 0
    m.cpuScore = 0
    m.playerScoreLabel.text = "0"
    m.cpuScoreLabel.text = "0"
    m.playerPaddle.paddleY = 470
    m.cpuPaddle.paddleY = 470
    m.ball.ballX = 948
    m.ball.ballY = 528
    m.ball.vx = 0
    m.ball.vy = 0
    m.titleHigh.text = "High score: " + m.highScore.toStr()
    m.titleGroup.visible = true
    m.gameOverGroup.visible = false
    m.state = "title"
end sub

sub enterPlaying()
    m.titleGroup.visible = false
    m.gameOverGroup.visible = false
    ' Center the ball; choose serve direction by parity of m.servesPlayed.
    m.ball.ballX = 948
    m.ball.ballY = 528
    if (m.servesPlayed mod 2) = 0 then
        m.ball.vx = -PONG_BALL_VX_INITIAL  ' toward player (left)
    else
        m.ball.vx = PONG_BALL_VX_INITIAL   ' toward CPU (right)
    end if
    m.ball.vy = PONG_BALL_VY_INITIAL
    m.servesPlayed = m.servesPlayed + 1
    m.tick.control = "start"
    m.state = "playing"
    Modules_OnGameSceneAfterGameStart(m)
end sub

sub enterGameOver()
    m.tick.control = "stop"
    m.titleGroup.visible = false
    m.gameOverGroup.visible = true
    if m.top.highScorePersistence and m.playerScore > m.highScore then
        m.highScore = m.playerScore
        reg = CreateObject("roRegistrySection", "GameShell")
        reg.write("highScore", m.highScore.toStr())
        reg.flush()
    end if
    m.state = "gameover"
    Modules_OnGameSceneAfterGameOver(m)
end sub
```

- [ ] **Step 3: Append onKeyEvent + onTick to `GameScene.bs`**

Append to `packages/brs-gen/templates/game_shell/files/components/GameScene.bs`:

```brightscript

function onKeyEvent(key as string, press as boolean) as boolean
    if m.state = "title" then
        if key = "OK" and press then
            enterPlaying()
            return true
        end if
        return false  ' Back falls through to Roku channel-exit
    end if
    if m.state = "playing" then
        if key = "up" then
            m.upHeld = press
            return true
        end if
        if key = "down" then
            m.downHeld = press
            return true
        end if
        if key = "back" and press then
            enterTitle()
            return true
        end if
        return false
    end if
    if m.state = "gameover" then
        if (key = "OK" or key = "back") and press then
            enterTitle()
            return true
        end if
        return false
    end if
    return false
end function

sub onTick()
    if m.state <> "playing" then return  ' state-guard against late Timer events

    ' Player paddle.
    if m.upHeld then m.playerPaddle.paddleY = m.playerPaddle.paddleY - PONG_PADDLE_SPEED_PX
    if m.downHeld then m.playerPaddle.paddleY = m.playerPaddle.paddleY + PONG_PADDLE_SPEED_PX
    if m.playerPaddle.paddleY < 0 then m.playerPaddle.paddleY = 0
    maxPaddleY = PONG_SCREEN_H - PONG_PADDLE_H
    if m.playerPaddle.paddleY > maxPaddleY then m.playerPaddle.paddleY = maxPaddleY

    ' CPU paddle.
    m.cpuPaddle.paddleY = Pong_StepCpu(m.cpuPaddle.paddleY, m.ball.ballY, m.cpuLagPx)

    ' Ball step + score detection.
    step = Pong_StepBall(m.ball.ballX, m.ball.ballY, m.ball.vx, m.ball.vy)
    m.ball.ballX = step.ballX
    m.ball.ballY = step.ballY

    ' Wall collision.
    m.ball.vy = Pong_CollideWall(m.ball.ballY, m.ball.vy, PONG_SCREEN_H)

    ' Paddle collisions (player on left, CPU on right).
    cp = Pong_CollidePaddle(m.ball.ballX, m.ball.ballY, m.ball.vx, m.ball.vy, 40, m.playerPaddle.paddleY)
    m.ball.vx = cp.vx
    m.ball.vy = cp.vy
    cc = Pong_CollidePaddle(m.ball.ballX, m.ball.ballY, m.ball.vx, m.ball.vy, 1860, m.cpuPaddle.paddleY)
    m.ball.vx = cc.vx
    m.ball.vy = cc.vy

    ' Score handling.
    if step.scored = "cpu" then
        m.playerScore = m.playerScore + 1
        m.playerScoreLabel.text = m.playerScore.toStr()
        if m.playerScore >= m.top.scoreToWin then
            enterGameOver()
        else
            ' Re-serve.
            m.ball.ballX = 948
            m.ball.ballY = 528
            m.ball.vx = PONG_BALL_VX_INITIAL  ' serve toward CPU again
            m.ball.vy = PONG_BALL_VY_INITIAL
        end if
    end if
    if step.scored = "player" then
        m.cpuScore = m.cpuScore + 1
        m.cpuScoreLabel.text = m.cpuScore.toStr()
        if m.cpuScore >= m.top.scoreToWin then
            enterGameOver()
        else
            m.ball.ballX = 948
            m.ball.ballY = 528
            m.ball.vx = -PONG_BALL_VX_INITIAL  ' serve toward player
            m.ball.vy = PONG_BALL_VY_INITIAL
        end if
    end if
end sub
```

- [ ] **Step 4: Write snapshot test**

Create `packages/brs-gen/tests/templates/game-shell-gamescene.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp } from '../../src/tools/generate-app.js';

describe('game_shell GameScene snapshot', () => {
  it('matches golden GameScene.xml + GameScene.brs', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'game-shell-scene-'));
    const result = await generateApp(
      { spec_version: 2, template: 'game_shell', modules: [], app: { name: 'Pong', major_version: 0, minor_version: 1, build_version: 0 } },
      { outputDir },
    );
    expect(result.ok).toBe(true);
    const xml = readFileSync(join(outputDir, 'components/GameScene.xml'), 'utf8');
    const brs = readFileSync(join(outputDir, 'components/GameScene.brs'), 'utf8');
    await expect(xml).toMatchFileSnapshot('../__golden__/game_shell/GameScene.xml.snap');
    await expect(brs).toMatchFileSnapshot('../__golden__/game_shell/GameScene.bs.snap');
  });
});
```

- [ ] **Step 5: Run with `-u`**

Run: `pnpm -C packages/brs-gen exec vitest run tests/templates/game-shell-gamescene.test.ts -u`
Expected: PASS. Two snap files written.

- [ ] **Step 6: Lint the generated channel**

Run: `pnpm -C packages/brs-gen exec vitest run tests/templates/game-shell-gamescene.test.ts` (without `-u`); also run lint via the engine path:

```
mkdir -p /tmp/game-shell-lint && pnpm -C packages/brs-gen exec node -e "
import('./dist/tools/generate-app.js').then(async ({ generateApp }) => {
  const r = await generateApp(
    { spec_version: 2, template: 'game_shell', modules: [], app: { name: 'Pong Lint', major_version: 0, minor_version: 1, build_version: 0 } },
    { outputDir: '/tmp/game-shell-lint' },
  );
  console.log(JSON.stringify(r, null, 2));
});
"
```

Expected: result has `ok: true` and the lint phase reports zero errors. If `bsc` reports `Cannot find function 'TemplateConfig'` or `'Pong_StepCpu'`, the `<script>` tags in `GameScene.xml` are missing or pointing at wrong URIs — re-check Step 1.

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/templates/game_shell/files/components/GameScene.xml packages/brs-gen/templates/game_shell/files/components/GameScene.bs packages/brs-gen/tests/templates/game-shell-gamescene.test.ts packages/brs-gen/tests/__golden__/game_shell/GameScene.xml.snap packages/brs-gen/tests/__golden__/game_shell/GameScene.bs.snap
git commit -m "$(cat <<'EOF'
feat(brs-gen): game_shell GameScene root scene + golden snapshots

Root Scene with state machine (title/playing/gameover), 60Hz Timer
game loop, key handler (Up/Down continuous-while-held; Back returns
to title from playing; OK starts/restarts), score Labels, title +
game-over overlay Groups, and registry-backed high-score I/O gated
by content.high_score_persistence.

after_scene_show fires ONCE from init() (NOT from enterTitle()) per
Plan 4d's NowPlayingScene pattern. after_game_start and
after_game_over fire on every transition.

Three explicit <script> includes (pong.brs, _template/config.bs,
_modules/__init_hooks.bs) per Plan 4c invariant generalized in
Plan 4e: the merger does NOT auto-inject these into template-owned
scenes; bsc lint would otherwise fail with "Cannot find function".

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Conflict-matrix + determinism entries

**Goal:** Verify `game_shell` does not collide with the other 5 templates' file overlays, manifest patches, or component patches; and that two consecutive generates produce byte-equal zips.

**Files:**
- Modify: `packages/brs-gen/tests/build/conflict-matrix.test.ts`
- Modify: `packages/brs-gen/tests/build/determinism.test.ts`

- [ ] **Step 1: Read existing conflict-matrix test to understand the row pattern**

Run: `cat packages/brs-gen/tests/build/conflict-matrix.test.ts | head -80`

Identify how each existing template (`screensaver`, `music_player`, `news_channel`, `video_grid_channel`, `blank_scenegraph`, `stub_hello`) is enumerated. Look for an array literal of template ids or a per-template `it()` block.

- [ ] **Step 2: Add `game_shell` row to conflict-matrix**

If the test enumerates an array of template ids, add `'game_shell'`. If it has per-template `it()` blocks, add a parallel `it('game_shell does not conflict with other templates', () => { ... })` matching the existing shape.

If the existing pattern uses a canonical spec helper, the canonical game_shell spec is:

```typescript
{ spec_version: 2, template: 'game_shell', modules: [], app: { name: 'Pong Conflict', major_version: 0, minor_version: 1, build_version: 0 } }
```

- [ ] **Step 3: Add `game_shell` row to determinism test**

Run: `cat packages/brs-gen/tests/build/determinism.test.ts | head -80`

Same pattern: add `game_shell` to whatever array or per-template block enumerates the templates. The determinism test typically generates the same spec twice and asserts byte-equal zip output (requires `TZ=UTC`).

- [ ] **Step 4: Run both tests under TZ=UTC**

Run: `TZ=UTC pnpm -C packages/brs-gen exec vitest run tests/build/conflict-matrix.test.ts tests/build/determinism.test.ts`
Expected: PASS for both. If determinism fails, the most likely cause is a non-deterministic snapshot in some component's emitted source (a timestamp, `Date.now()`, etc.) — but our template emits no such values, so a failure here points to a bug elsewhere (the build pipeline, the manifest EJS, etc.). Investigate; do NOT skip.

- [ ] **Step 5: Build check**

Run: `pnpm -C packages/brs-gen build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/tests/build/conflict-matrix.test.ts packages/brs-gen/tests/build/determinism.test.ts
git commit -m "test(brs-gen): conflict-matrix + determinism entries for game_shell

Verifies game_shell does not collide with the other 5 v1 templates'
file overlays, manifest patches, or component patches. Determinism
test asserts two consecutive generates produce byte-equal zips
(TZ=UTC required by yazl 2.5.x DOS-time encoding).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 12: E2E golden test + zip regen

**Goal:** Full pipeline (generate -> zip -> bsc lint -> validate_manifest -> validate_assets), with a checked-in byte-equal golden zip for regression detection.

**Files:**
- Create: `packages/brs-gen/tests/e2e/game-shell.test.ts`
- Create (regen): `packages/brs-gen/tests/__golden__/game_shell/game-shell.zip`

- [ ] **Step 1: Read an existing e2e test as the structural reference**

Run: `cat packages/brs-gen/tests/e2e/screensaver.test.ts`

Note the canonical spec, output paths, the assertions (zip bytes match golden, lint clean, validate_manifest passes, validate_assets passes), and how the golden zip is regenerated (typically via `scripts/regen-golden.mjs` or an explicit `-u` mode in the test).

- [ ] **Step 2: Write `game-shell.test.ts`**

Create `packages/brs-gen/tests/e2e/game-shell.test.ts` (mirror the screensaver.test.ts shape exactly; here is the conceptual outline):

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateApp } from '../../src/tools/generate-app.js';
import { lint } from '../../src/tools/lint.js';
import { validateManifest } from '../../src/tools/validate-manifest.js';
import { validateAssets } from '../../src/tools/validate-assets.js';

const GOLDEN = join(__dirname, '../__golden__/game_shell/game-shell.zip');
const CANONICAL_SPEC = {
  spec_version: 2,
  template: 'game_shell' as const,
  modules: [],
  app: { name: 'Pong E2E', major_version: 0, minor_version: 1, build_version: 0 },
};

describe('game_shell e2e', () => {
  it('generates byte-equal to golden zip + lint clean + validators pass', async () => {
    const work = mkdtempSync(join(tmpdir(), 'game-shell-e2e-'));
    const outputDir = join(work, 'project');
    const outputZip = join(work, 'project.zip');

    const result = await generateApp(CANONICAL_SPEC, { outputDir, outputZip });
    expect(result.ok).toBe(true);

    // Byte-equal golden.
    const actual = readFileSync(outputZip);
    const golden = readFileSync(GOLDEN);
    expect(actual.equals(golden)).toBe(true);

    // Lint clean.
    const lintResult = await lint({ projectDir: outputDir });
    expect(lintResult.errors).toEqual([]);

    // Manifest validator.
    const mfRes = await validateManifest({ projectDir: outputDir });
    expect(mfRes.ok).toBe(true);

    // Assets validator.
    const aRes = await validateAssets({ projectDir: outputDir });
    expect(aRes.ok).toBe(true);
  });
});
```

(Adapt imports/assertion shapes to match what `screensaver.test.ts` actually uses; the principle is full-pipeline coverage with the byte-equal golden.)

- [ ] **Step 3: Regen the golden zip**

Run:
```
TZ=UTC pnpm -C packages/brs-gen exec node scripts/regen-golden.mjs
```

This script (used in Plans 4-4e) iterates all templates and regenerates `tests/__golden__/<template>/<template>.zip`. After it runs, confirm `tests/__golden__/game_shell/game-shell.zip` exists.

If `regen-golden.mjs` does NOT discover `game_shell` automatically, edit the script's template-id array to add `'game_shell'`. Read `cat packages/brs-gen/scripts/regen-golden.mjs` to find the array.

- [ ] **Step 4: Run e2e test under TZ=UTC**

Run: `TZ=UTC pnpm -C packages/brs-gen exec vitest run tests/e2e/game-shell.test.ts`
Expected: PASS.

If the byte-equal assertion fails, the regen step (Step 3) and the test run did not produce the same bytes. Cross-check that BOTH are running under `TZ=UTC` (omitting it on either side breaks parity). Also confirm the canonical spec used in the test matches the canonical spec used by `regen-golden.mjs` (some helpers parameterize this differently; mirror what other e2e tests do).

- [ ] **Step 5: Run the FULL test suite under TZ=UTC**

Run: `TZ=UTC pnpm -C packages/brs-gen exec vitest run`
Expected: all PASS (300+ tests in brs-gen; 800+ in repo). Capture the count for the commit message.

- [ ] **Step 6: Build check**

Run: `pnpm -C packages/brs-gen build`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/tests/e2e/game-shell.test.ts packages/brs-gen/tests/__golden__/game_shell/game-shell.zip
# If regen-golden.mjs needed editing, also add it:
# git add packages/brs-gen/scripts/regen-golden.mjs
git commit -m "test(brs-gen): game_shell e2e golden zip + lint + validate_manifest

Full pipeline coverage: generate -> zip -> bsc lint clean ->
validate_manifest pass -> validate_assets pass. Byte-equal golden
zip checked in (TZ=UTC required for cross-machine parity per yazl
2.5.x DOS-time encoding).

Closes the in-package gating story for game_shell. T27 real-device
verification follows in Tasks 13-14.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 13: T27 driver `t27-game-shell.mjs`

**Goal:** Operator-runnable script that exercises the full Phase A flow on a real Roku per spec §9.1.

**Files:**
- Create: `packages/brs-gen/scripts/t27-game-shell.mjs`

- [ ] **Step 1: Read existing T27 driver as reference**

Run: `cat packages/brs-gen/scripts/t27-music.mjs` (closest archetype: app-style channel, no operator-trigger pattern unlike screensaver).

Note the canonical structure: env-var read for host/password, `mkdtemp` work dir, canonical spec, `assertStep(name, thunk)` helper, calls to `_t27-lib.mjs` shared helpers (`sideloadAndLaunch`, `screenshotNoError`, `sleep`), failure-capture screenshot with `{assertForeground: false}`.

- [ ] **Step 2: Write `t27-game-shell.mjs`**

Create `packages/brs-gen/scripts/t27-game-shell.mjs`:

```javascript
// packages/brs-gen/scripts/t27-game-shell.mjs
//
// Operator-run real-device driver for game_shell template (Plan 4f §9.1).
//
// Phase A: bundled defaults (cpu_difficulty=normal, score_to_win=5,
//   high_score_persistence=true).
//   1.  generate_app
//   2.  sideloadAndLaunch
//   3.  screenshot title screen
//   4.  ECP Select to start
//   5.  screenshot playing-initial
//   6.  ECP Up x3, Down x3 to move paddle
//   7.  sleep 2.5s for ball to travel + bounce
//   8.  screenshot playing-later
//   9.  SHA-256 compare playing screenshots; assert different (game animating)
//   10. ECP Back to return to title
//   11. screenshot title-after-back (binding "Back returns to title" gate
//       via screenshotNoError's foreground check)
//
// Phase B (operator override of cpu_difficulty / score_to_win) deferred
// per spec §9.2.
//
// Usage:
//   ROKUDEV_HOST=10.x.x.x ROKUDEV_DEV_PASSWORD=... \
//     node packages/brs-gen/scripts/t27-game-shell.mjs
//
// Failure capture: forensic screenshots use {assertForeground: false}
// so the active-app check does not shadow the original failure.

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  sideloadAndLaunch,
  screenshotNoError,
  sleep,
  ecpKeypress,
  ecpKeypressRepeat,
} from './_t27-lib.mjs';
import { generateAppForRegen } from './regen-helper.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = dirname(HERE);

const host = process.env.ROKUDEV_HOST || process.env.ROKUDEV_DEFAULT_ROKU_HOST;
const password =
  process.env.ROKUDEV_DEV_PASSWORD || process.env.ROKUDEV_ROKU_DEV_PASSWORD || '1234';

if (!host) {
  console.error('T27 game_shell: ROKUDEV_HOST env var is required (Roku IP).');
  process.exit(2);
}

const iso = new Date().toISOString().replace(/[:.]/g, '-');
const screensDir = join(PKG_ROOT, 'scripts', 't27-screenshots', iso);
await mkdir(screensDir, { recursive: true });

const work = await mkdtemp(join(tmpdir(), 'brs-gen-t27-game-shell-'));
const outputDir = join(work, 'project');
const outputZip = join(work, 'project.zip');

const canonicalSpec = {
  spec_version: 2,
  template: 'game_shell',
  modules: [],
  app: { name: 'Pong E2E', major_version: 0, minor_version: 1, build_version: 0 },
};

const specPath = join(work, 'spec.json');
await writeFile(specPath, JSON.stringify(canonicalSpec));

const summary = { passed: [], failed: [] };
function assertStep(name, thunk) {
  return thunk()
    .then((v) => { summary.passed.push(name); return v; })
    .catch((e) => {
      summary.failed.push({ name, message: String(e && e.message ? e.message : e) });
      throw e;
    });
}

try {
  // Step 1: generate + zip.
  await assertStep('generate_app', () =>
    generateAppForRegen({ outputDir, spec: specPath, outputZip }),
  );

  // Step 2: sideload + launch (game is a regular app channel).
  await assertStep('sideloadAndLaunch', () =>
    sideloadAndLaunch(outputZip, host, password),
  );

  // Step 3: screenshot title.
  await sleep(1500);
  await assertStep('A1: title screen', () =>
    screenshotNoError(host, password, join(screensDir, 'A1-title.png')),
  );

  // Step 4: Select to start.
  await assertStep('ECP Select to start', () => ecpKeypress(host, 'Select'));
  await sleep(1500);

  // Step 5: screenshot playing-initial.
  await assertStep('A2: playing initial', () =>
    screenshotNoError(host, password, join(screensDir, 'A2-playing-initial.png')),
  );

  // Step 6: move paddle up then down.
  await assertStep('ECP Up x3', () => ecpKeypressRepeat(host, 'Up', 3, 100));
  await sleep(500);
  await assertStep('ECP Down x3', () => ecpKeypressRepeat(host, 'Down', 3, 100));
  await sleep(500);

  // Step 7-8: sleep + screenshot playing-later.
  await sleep(2500);
  await assertStep('A3: playing later', () =>
    screenshotNoError(host, password, join(screensDir, 'A3-playing-later.png')),
  );

  // Step 9: SHA-256 compare A2 vs A3; assert different.
  await assertStep('game animating (A2 != A3)', async () => {
    const h2 = createHash('sha256').update(readFileSync(join(screensDir, 'A2-playing-initial.png'))).digest('hex');
    const h3 = createHash('sha256').update(readFileSync(join(screensDir, 'A3-playing-later.png'))).digest('hex');
    if (h2 === h3) throw new Error('game did not animate: A2 and A3 are byte-equal');
  });

  // Step 10: Back to return to title.
  await assertStep('ECP Back to title', () => ecpKeypress(host, 'Back'));
  await sleep(1000);

  // Step 11: screenshot title-after-back. screenshotNoError's foreground check
  // is the binding "Back returns to title without exiting channel" gate.
  await assertStep('A4: title after Back (binding foreground gate)', () =>
    screenshotNoError(host, password, join(screensDir, 'A4-title-after-back.png')),
  );

  console.log(`\nT27 game_shell PASS (Phase A). Phase B (operator content override) deferred per spec §9.2.`);
  console.log('Screenshots:', screensDir);
  console.log('Steps:', summary.passed.length, 'passed,', summary.failed.length, 'failed.');
  process.exit(0);
} catch (err) {
  console.error('\nT27 game_shell FAIL:', err && err.stack ? err.stack : err);
  console.error('Passed steps:', summary.passed);
  console.error('Failed steps:', summary.failed);
  try {
    await screenshotNoError(host, password, join(screensDir, 'zz-failure.png'), {
      assertForeground: false,
    }).catch(() => {});
  } catch {}
  process.exit(1);
}
```

If `_t27-lib.mjs` does not export `ecpKeypress` / `ecpKeypressRepeat` under those names, check the actual exports (`grep -n "^export" packages/brs-gen/scripts/_t27-lib.mjs`) and adapt. Plan 4d/4e drivers used these helpers; Plan 4e added the `screensaverMode` opt to `screenshotNoError` — the default (no opt) is what we want here.

- [ ] **Step 3: Lint the script**

Run: `node --check packages/brs-gen/scripts/t27-game-shell.mjs`
Expected: no syntax errors.

Run: `pnpm -C packages/brs-gen build`
Expected: clean (the script is `.mjs`, not TS, so build is unaffected; but confirm nothing regressed).

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/scripts/t27-game-shell.mjs
git commit -m "feat(brs-gen): t27-game-shell.mjs driver (Phase A)

11 steps per spec §9.1: generate -> sideloadAndLaunch -> A1 title ->
Select -> A2 playing -> Up/Down paddle -> A3 playing-later -> SHA-256
compare A2 vs A3 (assert game is animating) -> Back -> A4 title
(binding foreground-check gate).

Failure capture screenshot uses {assertForeground: false} so the
active-app check does not shadow the original failure.

Phase B (operator content override) deferred per spec §9.2 (matches
news_channel, music_player, screensaver Phase B deferrals).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 14: Run T27 on device 10.128.162.107 + Phase A evidence doc

**Goal:** Real-device verification that Pong sideloads, launches, animates, accepts D-pad input, and Back returns to title cleanly.

**Files:**
- Create: `docs/t27-evidence/2026-05-15-game-shell-phase-a.md`
- Add (artifact, NOT committed by default): `packages/brs-gen/scripts/t27-screenshots/<iso>/A{1,2,3,4}-*.png`

**Pre-flight:**
- Device IP: `10.128.162.107` (Roku Native 2910X firmware 15.2.4 per Plan 4e evidence doc).
- Dev password: `1234` (default; per CLAUDE.md global preference).
- Confirm the device is in dev mode and reachable: `curl -sf -o /dev/null --max-time 3 http://10.128.162.107:8060/query/device-info && echo OK`.

- [ ] **Step 1: Build the engine and run T27**

Run:
```
pnpm -C packages/brs-gen build && \
  ROKUDEV_HOST=10.128.162.107 ROKUDEV_DEV_PASSWORD=1234 \
  node packages/brs-gen/scripts/t27-game-shell.mjs
```

Expected outcomes by step:
- "generate_app" PASS.
- "sideloadAndLaunch" PASS. If this fails with EPIPE / ECONNRESET / 401, follow Plan 4d's stale-state recovery: `curl --digest -u rokudev:1234 -X POST -F "mysubmit=Delete" http://10.128.162.107/plugin_install`, then re-run the driver.
- "A1: title screen" PASS — screenshot must show black background + "PONG" + "Press OK to start" + "High score: 0".
- "ECP Select to start" PASS.
- "A2: playing initial" PASS — screenshot must show paddles + ball + 0/0 score; ball at centre.
- "ECP Up x3" / "ECP Down x3" PASS.
- "A3: playing later" PASS — screenshot must show ball moved + paddle moved + possibly score increment.
- "game animating (A2 != A3)" PASS — SHA-256 mismatch (proof of animation).
- "ECP Back to title" PASS.
- "A4: title after Back" PASS — foreground-check + size heuristic confirms title screen returned.

If any step fails, look at `zz-failure.png` and the script's stack trace; classify the failure (lint regression, asset gen issue, runtime null reference, ECP timeout, etc.).

- [ ] **Step 2: Inspect screenshots**

```
ls -la packages/brs-gen/scripts/t27-screenshots/<iso>/
```

Open each PNG in `Preview` (or `qlmanage -p`). Visual sanity-check:
- A1: PONG title, instruction, high score line.
- A2: black background, two white paddles, white ball at centre, white scores.
- A3: ball + paddles in different positions; scoreboard may differ from A2.
- A4: title screen again.

If A4 looks like Roku Home (no PONG title), Back accidentally exited the channel — `enterTitle()` from gameplay-state was not handled. Re-check `GameScene.bs` Step 3's `onKeyEvent` `m.state = "playing"` block.

- [ ] **Step 3: Write Phase A evidence doc**

Create `docs/t27-evidence/2026-05-15-game-shell-phase-a.md`:

```markdown
# Plan 4f T27 Phase A Evidence (game_shell template)

**Date:** 2026-05-15
**Device:** Roku Native, model 2910X
**Device IP:** 10.128.162.107
**Dev password:** 1234 (default)
**Channel sideloaded:** Pong E2E (spec_version: 2, template: 'game_shell',
  no content block; uses Zod defaults: cpu_difficulty=normal,
  score_to_win=5, high_score_persistence=true)
**T27 driver commit:** <SHA from Task 13>

## Summary

Phase A verification status: **PASS** (all 11 steps).

The game_shell channel sideloads cleanly, launches as a regular app
channel (id='dev', type='appl'), renders the title screen with PONG
header, accepts Select to enter gameplay, accepts Up/Down to move
the player paddle, animates the ball + CPU paddle, and returns to
title cleanly on Back without exiting the channel.

## Per-step results

| # | Step | Outcome |
|---|---|---|
| 1 | generate_app | <PASS / FAIL with notes> |
| 2 | sideloadAndLaunch | <PASS / FAIL — note any stale-state recovery> |
| 3 | A1 title screen | <PASS / FAIL> |
| 4 | ECP Select | PASS |
| 5 | A2 playing initial | PASS |
| 6 | Up x3 / Down x3 | PASS |
| 7 | A3 playing later | PASS |
| 8 | game animating (SHA-256 differ) | PASS |
| 9 | ECP Back | PASS |
| 10 | A4 title after Back (binding foreground gate) | PASS |

## Visual confirmations

- A1: black background, "PONG" title, "Press OK to start" hint,
  "High score: 0" line. <attach screenshot>
- A2: paddles at vertical centre (Y~470), ball at canvas centre,
  score 0/0. <attach screenshot>
- A3: ball + paddles in different positions vs A2. May show
  scoreboard increment if a rally completed during the 2.5s window.
  <attach screenshot>
- A4: title screen restored; high-score line may show updated value.
  <attach screenshot>

## Conclusion

Phase A registration + interactivity gate: **PASS**. The game_shell
template generates a Roku channel that:
- Sideloads cleanly.
- Launches as id='dev', type='appl'.
- Title screen renders correctly with all three Labels visible.
- Game-loop state transition Select -> playing fires.
- 60Hz Timer + Pong helpers + paddle/ball coordination produces
  visible motion within 2.5s.
- D-pad Up/Down moves player paddle (visible delta in A3 vs A2).
- Back from gameplay returns to title without exiting the channel
  (binding gate: screenshotNoError's foreground check on A4).

Phase B (operator content override) deferred per spec §9.2.

## Artifacts

- T27 driver: `packages/brs-gen/scripts/t27-game-shell.mjs`
- Screenshot directory: `packages/brs-gen/scripts/t27-screenshots/<iso>/`
- Engine + template artifacts: see commits leading to v0.5.6.

## Follow-ups

1. Phase B (operator override): if an operator-feed-style harness is
   ever added across all v1 templates, game_shell's Phase B would
   exercise the same TemplateConfig() threading proven in Phase A.
2. Frame-rate observation: if the device shows stutter at 60 Hz, the
   `<Timer duration="0.0166">` in GameScene.xml is the lever. Document
   any observed firmware-specific behavior.
3. v1.x audio: SFX bundle (paddle/wall/score bounces) + `content.sfx_enabled`.
```

Update the `<...>` placeholders with actual outcomes. Keep the doc
honest: if any step degraded (e.g., foreground check passed but the
screenshot looks visually wrong), note it explicitly.

- [ ] **Step 4: Commit evidence**

```bash
git add docs/t27-evidence/2026-05-15-game-shell-phase-a.md
git commit -m "test(t27): Plan 4f game_shell Phase A evidence (PASS)

11/11 steps PASS on Roku Native 2910X (10.128.162.107). Sideload +
launch + title render + Select-to-play + D-pad input + ball/paddle
animation (SHA-256 differ) + Back-to-title (binding foreground gate).

Phase B (operator content override) deferred per spec §9.2.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 15: README v0.5.6 release notes

**Goal:** Append the release-notes block to README.md at the END (ASCENDING chronological order; reaffirmed by Plan 4e Task 17 lesson).

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Confirm README order**

Run: `grep -n "^## What's in" README.md`
Expected: list of `## What's in v0.X.Y (Plan ...)` lines in chronological ASCENDING order, with v0.5.5 (Plan 4e) appearing LAST. The new v0.5.6 block goes AFTER v0.5.5.

- [ ] **Step 2: Append v0.5.6 release notes**

Open `README.md`, find the v0.5.5 release-notes block (`## What's in v0.5.5 (Plan 4e)`), and append AFTER its closing paragraph:

```markdown

## What's in v0.5.6 (Plan 4f)

Sixth and final v1 catalog template: `game_shell`. A regular Roku channel demonstrating the canonical state machine + Timer-driven game loop + D-pad input + registry-backed high-score pattern, composed of `Rectangle` + `Label` SceneGraph nodes only (zero bitmap sprites). Bundled reference game is **Pong**: classic 2-paddle table tennis with a CPU-controlled right paddle, deterministic AI lag, and per-difficulty handicap. Manifest is a standard app manifest (NOT pure-screensaver), with `screen_saver_private=1` to opt out of the OS screensaver during gameplay and `requires_audio_guide=0` declared explicitly. **v1 catalog COMPLETE: 6 of 6 templates shipped.**

- **Template: `game_shell`** with three SceneGraph components (`GameScene`, `Paddle`, `Ball`).
- **Pure-math collision/AI helpers** at `pkg:/source/lib/pong.brs` (5 functions: `Pong_StepCpu`, `Pong_StepBall`, `Pong_CollidePaddle`, `Pong_CollideWall`, `Pong_DifficultyToLagPx`) plus a module-level constant table (logical canvas = 1920x1080, top-left origin). Off-device Vitest coverage via TS shim at `tests/templates/pong-helpers.ts`; constant parity asserted by `tests/templates/pong-const-parity.test.ts`.
- **`AppSpec` content extension**: three new fields, all Zod-defaulted: `content.cpu_difficulty` (`'easy' | 'normal' | 'hard'`, default `'normal'`; CPU paddle tracking error: 60/25/5 px), `content.score_to_win` (int 1..21, default `5`), `content.high_score_persistence` (boolean, default `true`; gates `roRegistrySection("GameShell")` read/write).
- **New init-hook exports**: three at scope `GameScene`: `after_scene_show` (fires once from `init()` per Plan 4d's `NowPlayingScene/after_scene_show` pattern; NOT from `enterTitle()`), `after_game_start` (fires every transition into `playing`), `after_game_over` (fires every transition into `gameover` with `m.playerScore`/`m.cpuScore`/`m.highScore` available). Matches PRD §6.4 `game_shell` + `analytics.event_pipe` default module pairing.
- **Engine change**: three additive lines in `generate-app.ts` propagate `content.cpu_difficulty`, `content.score_to_win`, and `content.high_score_persistence` into the emitted `TemplateConfig()`. The local TypeScript `content` cast extended with the three new optional fields. No new validators, no new error or warning codes, no new shared engine surface. Zero behavior change for existing templates.
- **Manifest discipline**: standard app manifest (`screen_saver_private=1`, `requires_audio_guide=0`, standard icons/splash/splash_color/splash_min_time). Does NOT include `screensaver_title=`, so Plan 4e's template-conditional `SCREENSAVER_ZIP_TOO_LARGE` validator skips this template (verified in §13 engine-surface-lock checks).
- **Zero bundled bitmap assets**: gameplay scene is `Rectangle` + `Label` only. Eliminates Sharp/byte-equality concerns. Branding (icon + splash) reuses the existing `branding.{icon,splash}` AppSpec wrapper.
- **T27 driver `t27-game-shell.mjs`** (Phase A: bundled defaults). Verified on Roku Native 2910X firmware: sideload + launch + title render + Select-to-play + D-pad input + ball/paddle animation (SHA-256 differ proof) + Back-to-title (binding foreground gate). Phase B (operator content override) deferred per spec §9.2.

Out of v0.5.6: audio (SFX bundle + `content.sfx_enabled`); gamepad input; multiplayer; additional bundled games (Snake, Memory, etc.); background music; difficulty-scaling AI during play; game-pause overlay; network leaderboard; Roku Pay integration in shell.
```

- [ ] **Step 3: Diff to confirm placement**

Run: `git diff README.md | head -80`
Expected: a single hunk APPENDING the v0.5.6 block AFTER the v0.5.5 block. No edits to other versions.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: v0.5.6 release notes (Plan 4f game_shell template)

Sixth and final v1 catalog template. v1 catalog COMPLETE.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 16: MEMORY.md update + new `plan-4f-game-shell.md` topic file

**Goal:** Persist Plan 4f knowledge for future sessions per the project's auto-memory convention.

**Files:**
- Modify: `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md`
- Create: `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/plan-4f-game-shell.md`

NOTE: these paths are OUTSIDE the git repo (in the user's `~/.claude/...` config tree). They are NOT committed and do NOT show up in `git status`.

- [ ] **Step 1: Read current MEMORY.md status block**

Read `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md`. Identify:
- The "## Topic files (Read on demand)" section.
- The "## Status (one line per plan)" section with entries ending at "Plan 4e COMPLETE 2026-05-15 v0.5.5...".
- The "v1 catalog: 5 of 6 templates shipped. Remaining: `game_shell`." line.
- Any "Plans 4f, 5-7 still to write..." line.

- [ ] **Step 2: Update MEMORY.md**

Make three edits:

1. In "## Topic files", add the new pointer line in alphabetical order (after `plan-4e-screensaver.md`):
```
- `plan-4f-game-shell.md`: Plan 4f `game_shell` template (Pong reference; v0.5.6) details + lessons
```

2. In "## Status", add a new line after the Plan 4e entry:
```
- Plan 4f COMPLETE 2026-05-15 v0.5.6 (~<NEW_TEST_COUNT> brs-gen tests, ~<NEW_REPO_TOTAL> repo total). `game_shell` (Pong). See plan-4f-game-shell.md
```
(Replace `<NEW_TEST_COUNT>` and `<NEW_REPO_TOTAL>` with the actual counts from Task 12's full-suite run.)

3. Update the catalog status line:
```
- v1 catalog: 6 of 6 templates shipped. v1 CATALOG COMPLETE.
```

And update the still-to-write line to remove `4f`:
```
- Plans 5-7 still to write (real modules; freeform/LSP; brs-docs; skills+plugin).
```

- [ ] **Step 3: Create `plan-4f-game-shell.md` topic file**

Create `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/plan-4f-game-shell.md`:

```markdown
# Plan 4f - game_shell (v0.5.6, 2026-05-15)

Tag `v0.5.6` planned on `origin`. ~<NEW_TEST_COUNT> tests passing in brs-gen; ~<NEW_REPO_TOTAL> repo total. **v1 catalog COMPLETE: 6 of 6 templates shipped.**

## What shipped

Sixth and final v1 catalog template `game_shell` — a Pong-based reference channel demonstrating the canonical state machine + Timer-driven game loop + D-pad input + registry-backed high-score pattern. Three SceneGraph components (`GameScene`, `Paddle`, `Ball`); pure-math collision/AI helpers in `pkg:/source/lib/pong.brs` with off-device TS shim coverage. Three init-hook exports at scope `GameScene` (`after_scene_show`, `after_game_start`, `after_game_over`). Three new `content` fields all Zod-defaulted (`cpu_difficulty`, `score_to_win`, `high_score_persistence`).

## Outstanding polish (as of v0.5.6)

- Audio (SFX bundle + `content.sfx_enabled`); blocked on deterministic WAV pipeline.
- Gamepad input (`roSGNode("Input")` + button translation); standard remote D-pad only in v1.
- Multiplayer (2-player local).
- Additional bundled games (Snake, Memory, Tetris, etc.) as cookbook examples or future template variants.
- Difficulty-scaling AI during play (current AI uses constant lag).
- Game-pause overlay (current Back-from-playing returns to title; v1.x could add Back-Back-to-quit).
- Network leaderboard (requires auth + analytics + network module composition).
- `roAppMemoryMonitor` boilerplate (cert-recommended for memory-heavy apps; not required for game_shell scope).
- `CERT_CHECKLIST.md.ejs` per-channel emission (cross-template polish; carried over from Plans 4d + 4e).

## Engine changes

- **TemplateConfig threading**: three additive lines in `src/tools/generate-app.ts` for `content.cpu_difficulty`, `content.score_to_win`, `content.high_score_persistence`. Local TypeScript `content` cast extended with the three new optional fields. Existing emission gate (`if (branding.primary_color || content || effectivePrimaryColor)`) widened in v0.5.3 already covers any `content` field; no new gate.
- **No new validators**, no new error codes, no new warning codes, no new shared engine surface.
- **Strict-template-schema downstream-data flow** (Plan 4e Task 11 fix) inherited for free: `templates/game_shell/schema.ts` declares `.default(...)` for all three content fields; engine's `appSpec = strict.data` means defaults flow into `TemplateConfig()` for the bare-spec case.

## Lessons

- **`screen_saver_private=1` is a small but load-bearing manifest key for active-input apps** (Roku channel-store cert recommendation). Without it, the OS screensaver can fire mid-game on idle paddles. Trivial to forget; trivial to add. Document for future game-style templates.
- **`after_scene_show` belongs in `init()`, NOT in `enterTitle()`** (Plan 4d's `NowPlayingScene/after_scene_show` pattern). Calling it from `enterTitle()` would re-fire on every Back-from-game (analytics would over-report "channel opened"). Spec §5.2 reviewer-recommended fix; folded into the spec via §5.2 edit.
- **Pure-math helpers + TS shim + const-parity test = cheap, robust off-device unit coverage**. The TS shim is verbatim translation; the const-parity test parses the BRS const block via regex and asserts numeric equality. Catches the most common drift class. Pattern is reusable for any future template with non-trivial pure-math (collision, layout, animation curves).
- **Zero bitmap assets is a real scope reduction**. Pong's all-Rectangle-and-Label scene means: no `gen-game-assets.mjs`, no Sharp byte-equality risk, no `images/` directory in golden zip, no asset-pipeline test surface. By far the smallest v1 template (~200 KB zip including branding placeholders).
- **`<script uri="pkg:/source/_template/config.bs">` is required in any component that calls `TemplateConfig()`** (Plan 4c invariant generalized in Plan 4e). Same for `pkg:/source/_modules/__init_hooks.bs` when a component calls `Modules_On*` hooks. The merger does NOT auto-inject these for template-owned components; templates must declare them explicitly.
- **`splash_color=#000000` matched to in-game black background eliminates the visible splash-to-game transition flash**. Trivial polish that costs zero engineering. Future game / black-themed templates should adopt.
- **Standard remote (Up/Down/OK/Back) covers the casual-game input space**. Continuous-while-held via `keypress`/`keyup` works on Roku Native 2910X firmware; document any firmware-specific behavior in the T27 evidence doc if observed.

## T27 status

Phase A registration + interactivity gate **PASS** on Roku Native 2910X firmware (10.128.162.107, 2026-05-15):
- Sideload via `/plugin_install` succeeds.
- Title screen renders (PONG header + instruction + high score line).
- Select transitions to playing.
- D-pad Up/Down moves player paddle.
- 60Hz Timer + Pong helpers produce visible motion (SHA-256 differ between A2 and A3).
- Back returns to title without exiting channel (binding gate: `screenshotNoError` foreground check).

Phase B (operator content override) deferred per spec §9.2 (matches `news_channel`, `music_player`, `screensaver` Phase B deferrals).

Evidence: `docs/t27-evidence/2026-05-15-game-shell-phase-a.md`.

## Latent traps to surface for cross-plan reuse

- **Wrapper-schema `content.feed_format` enum is still narrow** (locked to `roku_direct_publisher_json` in `src/spec/content.ts`; Plan 4c carry-forward; Plan 4e worked around at template level). Game_shell does NOT use `feed_format` so this does not affect it. Widen the enum when more feed formats land.
- **Strict-template-schema downstream-data flow** (Plan 4e Task 11 fix): forward-compatible. Game_shell now relies on it for default-content emission. Future templates with their own `.default(...)` declarations will continue to benefit; watch for golden-zip changes when bumping schemas.
- **README is ASCENDING chronological order** (v0.1 at top, v0.5.6 at bottom). Reaffirmed at every release.
```

- [ ] **Step 4: Commit (no-op for git, but the topic-file write itself is the persistence step)**

These files are outside the git repo. There is no `git add` or `git commit` in this task. Verify the write succeeded:

```
ls -l ~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/plan-4f-game-shell.md
```
Expected: file exists, non-zero size. The topic file is now discoverable in future sessions via MEMORY.md's "Topic files" pointer.

---

## Task 17: Final verification + version bump + tag + push

**Goal:** Last-mile verification, version bump to `0.5.6` in two `package.json` files, release commit + tag + push.

**Files:**
- Modify: `package.json` (monorepo root)
- Modify: `packages/brs-gen/package.json`

- [ ] **Step 1: Run the FULL test suite under TZ=UTC**

Run:
```
TZ=UTC pnpm -r exec vitest run
```
Or, if `pnpm -r` does not propagate test runs cleanly, run per-package:
```
TZ=UTC pnpm -C packages/roku-device-client exec vitest run && \
  TZ=UTC pnpm -C packages/rokudev-device exec vitest run && \
  TZ=UTC pnpm -C packages/brs-gen exec vitest run
```

Expected: all PASS. Capture totals (e.g., "297 + 184 + <new>"). The `<new>` brs-gen count should exceed Plan 4e's 372 by ~30 tests (4 engine cases + ~10 schema cases + ~15 pong-helpers cases + 8 const-parity cases + 1 e2e + 1 each for the 5 component snapshots = ~30+).

- [ ] **Step 2: Build all packages**

Run: `pnpm -r build`
Expected: zero TS errors, all builds succeed.

- [ ] **Step 3: Bump version in root `package.json`**

Edit `package.json` (monorepo root): `"version": "0.5.5"` -> `"version": "0.5.6"`.

- [ ] **Step 4: Bump version in `packages/brs-gen/package.json`**

Edit `packages/brs-gen/package.json`: `"version": "0.5.5"` -> `"version": "0.5.6"`.

(If `roku-device-client` and `rokudev-device` versions are also bumped per release per the project's convention, check the prior release commits to confirm. Plan 4e's release commit is `8fd4c99 chore(release): bump rokudev-tools to 0.5.5`; inspect with `git show 8fd4c99 --stat` to see exactly which package.json files Plan 4e bumped.)

- [ ] **Step 5: Re-run full suite to confirm version bumps did not break anything**

Run: `TZ=UTC pnpm -C packages/brs-gen exec vitest run` (focused; the version is read by some tests).
Expected: PASS.

- [ ] **Step 6: Verify `git status` is clean except for the version bumps**

Run: `git status`
Expected: only `package.json` and `packages/brs-gen/package.json` (and any sibling package.json files if Step 4 bumped them) show as modified.

- [ ] **Step 7: Release commit**

Run:
```bash
git add package.json packages/brs-gen/package.json
# Add other package.json files if Step 4 bumped them.
git commit -m "$(cat <<'EOF'
chore(release): bump rokudev-tools to 0.5.6 (Plan 4f game_shell)

Sixth and final v1 catalog template: game_shell (Pong reference).
Three SceneGraph components, pure-math helpers with TS-shim coverage,
three new content fields, three init-hook exports. No new validators
or shared engine surface. v1 catalog COMPLETE (6 of 6 templates).

Test totals: <fill from Step 1>.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Tag `v0.5.6`**

Run:
```bash
git tag -a v0.5.6 -m "rokudev-tools v0.5.6 (Plan 4f game_shell; v1 catalog complete)"
```

- [ ] **Step 9: Confirm with user before push**

Push is a remote-affecting action. Pause and present a summary:

> "Plan 4f complete locally. Final state:
> - <N> commits since v0.5.5
> - All <total> tests passing (split: roku-device-client / rokudev-device / brs-gen)
> - T27 Phase A PASS on 10.128.162.107
> - Tag v0.5.6 created locally
>
> Ready to push `main` + tag to origin?"

WAIT for explicit user confirmation. Do NOT push without it.

- [ ] **Step 10: Push (after explicit user OK)**

Run:
```bash
git push origin main
git push origin v0.5.6
```

Expected: both push succeed. Report:
- Final origin SHA: <output of `git rev-parse origin/main`>
- Tag URL (if hosted on a forge): `<repo URL>/releases/tag/v0.5.6`

- [ ] **Step 11: Final summary**

Print to user:

> "Plan 4f shipped: v0.5.6
>
> - origin main: <SHA>
> - tag v0.5.6: published
> - <N> commits in this session
> - <total> tests passing
> - 6 of 6 v1 templates shipped — v1 CATALOG COMPLETE
>
> Per work-order directive in MEMORY.md, next priorities are blocks 2-10 (freeform LLM, LSP, brs-docs, skills, CLI, plugin, migration docs, real-device CI, version compat). Block 1 (real feature modules) is LAST per user directive; remind before treating v1 as done."

---

## Plan complete

After Task 17, all 17 tasks are checked off. The v1 catalog is complete (6 of 6 templates). Per `superpowers:subagent-driven-development`, run a final code-reviewer subagent over the entire implementation before treating the plan as fully closed.
