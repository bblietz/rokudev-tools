# Plan 5: analytics.event_pipe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first v1 feature module `analytics.event_pipe` and the small `optional_init_calls` engine extension it needs, as v0.6.0.

**Architecture:** Two surfaces. (1) `brs-gen` engine: new additive `module_wiring.optional_init_calls` field in module-toml schema + permissive validator branch + emit-init-hooks extension. (2) New module under `packages/brs-gen/modules/analytics.event_pipe/` providing a `Analytics_Track` / `Analytics_AddSink` BrightScript API backed by an `m.global` SceneGraph-node singleton, with two bundled sinks (Console, HTTP-batched). Auto-emits 3 standard events from template hooks (`channel_start`, `screen_view`, `content_start`) via opportunistic wiring.

**Tech Stack:** TypeScript (pnpm workspaces, vitest, zod), BrightScript (.bs source compiled to .brs), Roku SceneGraph (`roSGNode`, `roUrlTransfer`, `roDeviceInfo`), yazl 2.5.x for deterministic zip, T27 via `roku-device-client` against Roku Native 2910X.

**Spec:** `docs/superpowers/specs/2026-05-18-analytics-event-pipe-design.md`

---

## Pre-flight checklist (READ FIRST)

Before starting Task 1, the implementer should:

- [ ] Read the spec end-to-end. The plan does NOT duplicate spec content — design decisions live in the spec.
- [ ] Read `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md` for project conventions, especially the "Latent traps" section.
- [ ] Read `packages/brs-gen/modules/stub_label/module.toml` and `packages/brs-gen/modules/stub_label/files/source/_modules/stub_label/Init.bs` — these are the only existing module fixture. Pattern-match against them when authoring `analytics.event_pipe` module files.
- [ ] Read `packages/brs-gen/src/catalog/module-toml.ts` (lines 1-100) — the schema you're extending in Task 1.
- [ ] Read `packages/brs-gen/src/merger/wiring.ts` end-to-end (~80 lines) — the validator you're extending in Task 2.
- [ ] Read `packages/brs-gen/src/merger/emit-init-hooks.ts` end-to-end (~30 lines) — the emitter you're extending in Task 3.
- [ ] Read the 6 template.toml files to internalize the hook surfaces the module's wiring map (§9.1 of spec) references.
- [ ] Read `packages/brs-gen/scripts/t27-game-shell.mjs` and `packages/brs-gen/scripts/_t27-lib.mjs` (≤120 lines combined) — the T27 framework + helpers you'll reuse in Task 19.
- [ ] Verify dev tools available: `pnpm`, `tsc`, `vitest`, `yazl`. All in workspace package.json files; should already work via `pnpm install`.
- [ ] Verify a Roku Native 2910X is available on the LAN at the IP captured during Plan 4f (10.128.160.39) OR ask the user for a current IP before Task 20.

**Latent traps to remember (from MEMORY.md):**

- `TZ=UTC` required for yazl golden byte-equality. The regen-golden.mjs script sets this; pure `vitest` runs of e2e tests do not. Goldens must live in `tests/__golden__/` which is in `.prettierignore`.
- `m.top.setFocus(true)` mandatory in Scenes without focusable children for `onKeyEvent` to fire. (Not relevant to analytics module directly, but relevant to T27 navigation flows on `game_shell`.)
- ECP `Select` maps to BrightScript `key="select"` (lowercase) on Roku Native 2910X firmware 15.2.4. Use lowercase or accept both.
- `findNode(id)` is id-only, NOT type-aware. Cache `m.<x>Ref` references on `createChild` if you intend to find them later.
- BrightScript reserved words to avoid: `pos`, `box`, `next`, `step`, `then`, `to`.
- vitest does NOT typecheck. `pnpm build` is the gating verification step for new TS surface — run it before declaring any task involving TS edits "done".
- MCP handler wrapping: tool handlers return plain payload objects; bootstrap wraps to `{content:[{type:'text', text: ...}]}` once. Do NOT wrap inside handlers.
- `BRS_GEN_VERSION` change requires ALL goldens regenerated. Task 21 handles this.

---

## File structure (locked from spec §13)

### Modified files (3 source + 1 script)

| Path | Concern |
|---|---|
| `packages/brs-gen/src/catalog/module-toml.ts` | Add `optional_init_calls` field on `ModuleWiringSchema` |
| `packages/brs-gen/src/merger/wiring.ts` | Validate optional-call shape; allow missing template hook |
| `packages/brs-gen/src/merger/emit-init-hooks.ts` | Include matched optional calls in dispatch output |
| `packages/brs-gen/scripts/regen-golden.mjs` | Add `regenAnalyticsEventPipe` function |

### New files (~22)

**Module sources:**

| Path | Concern |
|---|---|
| `packages/brs-gen/modules/analytics.event_pipe/module.toml` | Module declaration: config schema, wiring, ordering |
| `.../files/source/_modules/analytics_event_pipe/Dispatcher.bs` | Singleton init, queue, flush timer, sink registry |
| `.../files/source/_modules/analytics_event_pipe/Hooks.bs` | 4 hook-handler entry points |
| `.../files/source/_modules/analytics_event_pipe/sinks/ConsoleSink.bs` | `print` per event |
| `.../files/source/_modules/analytics_event_pipe/sinks/HttpSink.bs` | roUrlTransfer.AsyncPostFromString batched POST |

**Tests:**

| Path | Concern |
|---|---|
| `packages/brs-gen/tests/catalog/module-toml-optional.test.ts` | Schema accepts/rejects `optional_init_calls` |
| `packages/brs-gen/tests/merger/optional-init-calls.test.ts` | Validator + emitter behavior on matched/unmatched |
| `packages/brs-gen/tests/analytics-helpers.ts` | TS shim of pure dispatcher functions |
| `packages/brs-gen/tests/analytics-dispatcher.test.ts` | Name normalization |
| `packages/brs-gen/tests/analytics-sinks.test.ts` | addSink/removeSink handle stability + dedup |
| `packages/brs-gen/tests/analytics-flush.test.ts` | drain, retry-once, drop, overflow |
| `packages/brs-gen/tests/analytics-privacy.test.ts` | RIDA branch, channel_client_id, default_props/identity merge |
| `packages/brs-gen/tests/analytics-identity.test.ts` | SetIdentity overwrite, nil-delete |
| `packages/brs-gen/tests/analytics-const-parity.test.ts` | Regex-parse Dispatcher.bs const block; equal to TS shim |
| `packages/brs-gen/tests/e2e/analytics-event-pipe.test.ts` | 6-template composition matrix |
| `packages/brs-gen/tests/__golden__/analytics-event-pipe-news.zip` | Canonical golden zip |
| `packages/brs-gen/tests/__snapshots__/analytics_event_pipe/Dispatcher.brs.snap.txt` | BS shape capture |
| `.../Hooks.brs.snap.txt`, `.../ConsoleSink.brs.snap.txt`, `.../HttpSink.brs.snap.txt` | Sink + hooks shape capture |

**Scripts + evidence:**

| Path | Concern |
|---|---|
| `packages/brs-gen/scripts/t27-analytics-event-pipe.mjs` | On-device verification driver |
| `docs/t27-evidence/<YYYY-MM-DD>-analytics-event-pipe.md` | T27 PASS evidence |

---

## Phase plan overview

| Phase | Tasks | Surface |
|---|---|---|
| 1 | Tasks 1-3 | Engine extension: schema, validator, emitter |
| 2 | Tasks 4-5 | Module scaffolding: module.toml + BS file skeletons |
| 3 | Tasks 6-11 | TS shim + unit tests (pure dispatcher logic) |
| 4 | Tasks 12-15 | BrightScript implementation (Dispatcher, Hooks, sinks) |
| 5 | Tasks 16-18 | Composition matrix + canonical golden + regen-golden integration |
| 6 | Tasks 19-20 | T27 driver + on-device verification |
| 7 | Tasks 21-23 | Release: version bump, regen, README/MEMORY, push |

**Total: 23 tasks. Most tasks are 5-7 bite-sized steps.**

---

## Phase 1: Engine extension (Tasks 1-3)

### Task 1: Add `optional_init_calls` to ModuleTomlSchema

**Files:**
- Modify: `packages/brs-gen/src/catalog/module-toml.ts` (extend `ModuleWiringSchema`)
- Test: `packages/brs-gen/tests/catalog/module-toml-optional.test.ts` (new)

**Context:** The existing schema at `module-toml.ts:26-64` declares `ModuleWiringSchema` with `exports`, `requires`, and `init_calls`. Add `optional_init_calls` with the same shape as `init_calls` but defaulting to `[]` so existing modules (`stub_label`) still validate without modification.

- [ ] **Step 1: Write the failing schema test**

Create `packages/brs-gen/tests/catalog/module-toml-optional.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ModuleTomlSchema } from '../../src/catalog/module-toml.js';

describe('ModuleTomlSchema optional_init_calls', () => {
  const baseModule = {
    module: { id: 'x', version: '0.1.0', spec_compat: '>=2', description: 'd' },
    module_config_schema: {},
    module_files: { add: [] },
    module_wiring: {
      exports: [],
      requires: [],
      init_calls: [],
    },
    module_ordering: { before: [], after: [] },
    module_conflicts: { exclusive_with: [] },
  };

  it('defaults optional_init_calls to empty array when omitted', () => {
    const parsed = ModuleTomlSchema.parse(baseModule);
    expect(parsed.module_wiring.optional_init_calls).toEqual([]);
  });

  it('accepts valid optional_init_calls entries', () => {
    const mod = {
      ...baseModule,
      module_wiring: {
        ...baseModule.module_wiring,
        optional_init_calls: [
          { hook: 'MainScene.after_scene_show', statement: 'Foo_bar(m)' },
        ],
      },
    };
    expect(() => ModuleTomlSchema.parse(mod)).not.toThrow();
  });

  it('rejects optional_init_calls entry missing hook field', () => {
    const mod = {
      ...baseModule,
      module_wiring: {
        ...baseModule.module_wiring,
        optional_init_calls: [{ statement: 'Foo()' }],
      },
    };
    expect(() => ModuleTomlSchema.parse(mod)).toThrow();
  });

  it('rejects optional_init_calls entry with extra field (strict mode)', () => {
    const mod = {
      ...baseModule,
      module_wiring: {
        ...baseModule.module_wiring,
        optional_init_calls: [{ hook: 'X.y', statement: 'Z()', extra: 1 }],
      },
    };
    expect(() => ModuleTomlSchema.parse(mod)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rokudev/brs-gen test tests/catalog/module-toml-optional.test.ts -- --run`
Expected: FAIL on first test ("Unrecognized key" or "undefined" for `optional_init_calls`).

- [ ] **Step 3: Extend the schema**

In `packages/brs-gen/src/catalog/module-toml.ts`, locate the `module_wiring` block in `ModuleTomlSchema`. After the `init_calls` line, add:

```typescript
optional_init_calls: z.array(z.object({
  hook: z.string().min(1),
  statement: z.string().min(1),
}).strict()).default([]),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rokudev/brs-gen test tests/catalog/module-toml-optional.test.ts -- --run`
Expected: PASS, 4/4.

- [ ] **Step 5: Run full brs-gen test suite to verify no regression**

Run: `pnpm --filter @rokudev/brs-gen test -- --run`
Expected: ALL previously-passing tests still pass (e.g. existing `module-toml.test.ts`, stub_label compose tests). New count = old count + 4.

- [ ] **Step 6: Run TypeScript build to catch missing types**

Run: `pnpm --filter @rokudev/brs-gen build`
Expected: clean exit. (vitest does not typecheck; only build catches missing types.)

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/src/catalog/module-toml.ts packages/brs-gen/tests/catalog/module-toml-optional.test.ts
git commit -m "feat(brs-gen): add optional_init_calls field to ModuleTomlSchema

Additive schema extension for modules that wire opportunistically into
template hooks. Defaults to []; existing modules unaffected. Validator
and emitter branches in subsequent tasks."
```

---

### Task 2: Extend wiring validator to permit missing optional hooks

**Files:**
- Modify: `packages/brs-gen/src/merger/wiring.ts`
- Test: `packages/brs-gen/tests/merger/optional-init-calls.test.ts` (new)

**Context:** The existing validator at `wiring.ts:11-78` throws `WIRING_CONTRACT_VIOLATION` when a module's `init_calls` hook isn't exported by the template. The new `optional_init_calls` field must use a parallel path: validate hook shape (scope+phase string format) and statement (non-empty), but DO NOT throw if the template lacks the hook. The validator returns the *matched subset* for the emitter to consume.

- [ ] **Step 1: Write the failing validator test**

Create `packages/brs-gen/tests/merger/optional-init-calls.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateWiring } from '../../src/merger/wiring.js';

const templateExports = {
  init_hooks: [
    { scope: 'MainScene', phase: 'after_scene_show', file: 'c/M.bs', signature: '(m) as void' },
  ],
  scene_nodes: [],
};

const baseModule = {
  id: 'mod_a',
  module_wiring: {
    exports: [],
    requires: [],
    init_calls: [],
    optional_init_calls: [
      { hook: 'MainScene.after_scene_show', statement: 'MatchedFn(m)' },
      { hook: 'PlayerScene.before_play', statement: 'UnmatchedFn(m)' },
    ],
  },
};

describe('validateWiring optional_init_calls', () => {
  it('returns only the matched optional calls in matchedOptional', () => {
    const result = validateWiring([baseModule], templateExports);
    expect(result.matchedOptional).toEqual([
      { moduleId: 'mod_a', hook: 'MainScene.after_scene_show', statement: 'MatchedFn(m)' },
    ]);
  });

  it('does not throw when optional hooks reference missing template exports', () => {
    expect(() => validateWiring([baseModule], templateExports)).not.toThrow();
  });

  it('rejects malformed optional hook strings (no dot separator)', () => {
    const bad = {
      ...baseModule,
      module_wiring: {
        ...baseModule.module_wiring,
        optional_init_calls: [{ hook: 'NoDot', statement: 'X()' }],
      },
    };
    expect(() => validateWiring([bad], templateExports)).toThrow(/WIRING_OPTIONAL_HOOK_MALFORMED/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rokudev/brs-gen test tests/merger/optional-init-calls.test.ts -- --run`
Expected: FAIL with "validateWiring is not a function" OR "result.matchedOptional is undefined" (depends on current export shape).

- [ ] **Step 3: Read existing `wiring.ts`**

Read the full file. Note the return type of `validateWiring`. Decide whether to extend the return shape with `matchedOptional` or add a parallel function `matchOptionalCalls`. For DRY/cohesion, extend the same function's return shape.

- [ ] **Step 4: Extend wiring.ts**

Add `matchedOptional` to the return shape. Implementation sketch:

```typescript
// after existing strict-init_calls validation loop, add:
const matchedOptional: Array<{ moduleId: string; hook: string; statement: string }> = [];
const exportedHookKeys = new Set(
  templateExports.init_hooks.map((h) => `${h.scope}.${h.phase}`),
);
for (const mod of modules) {
  for (const oc of mod.module_wiring.optional_init_calls ?? []) {
    if (!oc.hook.includes('.')) {
      throw new BrsGenError('WIRING_OPTIONAL_HOOK_MALFORMED', `Module ${mod.id} optional hook "${oc.hook}" missing scope.phase separator`);
    }
    if (exportedHookKeys.has(oc.hook)) {
      matchedOptional.push({ moduleId: mod.id, hook: oc.hook, statement: oc.statement });
    }
    // unmatched: silently skipped
  }
}
return { ...existingReturn, matchedOptional };
```

Add the new error code `WIRING_OPTIONAL_HOOK_MALFORMED` to whichever error-code enum file the project uses (search for `WIRING_CONTRACT_VIOLATION` to find its sibling).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rokudev/brs-gen test tests/merger/optional-init-calls.test.ts -- --run`
Expected: PASS, 3/3.

- [ ] **Step 6: Run full brs-gen test suite + build**

Run: `pnpm --filter @rokudev/brs-gen test -- --run && pnpm --filter @rokudev/brs-gen build`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/src/merger/wiring.ts packages/brs-gen/tests/merger/optional-init-calls.test.ts packages/brs-gen/src/<error-codes-file>
git commit -m "feat(brs-gen): wiring validator permits missing optional template hooks

Adds matchedOptional to validateWiring return shape. Unmatched optional
hooks silently skipped (opt-in); malformed hook strings (no scope.phase
separator) still rejected via WIRING_OPTIONAL_HOOK_MALFORMED."
```

---

### Task 3: Emit matched optional init calls in dispatch generator

**Files:**
- Modify: `packages/brs-gen/src/merger/emit-init-hooks.ts`
- Test: extend `packages/brs-gen/tests/merger/optional-init-calls.test.ts` from Task 2

**Context:** `emitInitHooks` at `emit-init-hooks.ts:1-30` currently consumes a `callsByModule` map of strict init_calls and emits `Modules_On<PascalCase>` dispatch functions. Extend it to ALSO consume the `matchedOptional` list from Task 2 and merge those entries into the dispatch output. Order within a hook: existing init_calls first (in init_order), then matched optional calls (also in init_order, stable lexical tiebreak).

- [ ] **Step 1: Write the failing emitter test**

Append to `packages/brs-gen/tests/merger/optional-init-calls.test.ts`:

```typescript
import { emitInitHooks } from '../../src/merger/emit-init-hooks.js';

describe('emitInitHooks with matched optional calls', () => {
  it('emits matched optional calls after strict init_calls within the same hook', () => {
    const hooks = [
      { scope: 'MainScene', phase: 'after_scene_show', file: 'c/M.bs', signature: '(m as object) as void' },
    ];
    const initOrder = ['strict_mod', 'opt_mod'];
    const callsByModule = new Map([
      ['strict_mod', [{ hook: 'MainScene.after_scene_show', statement: 'StrictFn(m)' }]],
    ]);
    const matchedOptional = [
      { moduleId: 'opt_mod', hook: 'MainScene.after_scene_show', statement: 'OptFn(m)' },
    ];
    const out = emitInitHooks(hooks, initOrder, callsByModule, matchedOptional);
    expect(out).toContain('sub Modules_OnMainSceneAfterSceneShow(m as object) as void');
    const lines = out.split('\n');
    const strictIdx = lines.findIndex((l) => l.includes('StrictFn(m)'));
    const optIdx = lines.findIndex((l) => l.includes('OptFn(m)'));
    expect(strictIdx).toBeGreaterThan(-1);
    expect(optIdx).toBeGreaterThan(strictIdx);
  });

  it('emits hook function even when only optional calls match', () => {
    const hooks = [{ scope: 'X', phase: 'y', file: 'f', signature: '() as void' }];
    const matchedOptional = [{ moduleId: 'm', hook: 'X.y', statement: 'OnlyOpt()' }];
    const out = emitInitHooks(hooks, ['m'], new Map(), matchedOptional);
    expect(out).toContain('OnlyOpt()');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rokudev/brs-gen test tests/merger/optional-init-calls.test.ts -- --run`
Expected: FAIL with "emitInitHooks expects 3 args, got 4" or similar.

- [ ] **Step 3: Extend `emit-init-hooks.ts`**

Add a 4th parameter `matchedOptional` to `emitInitHooks`. Inside the per-hook loop, after iterating strict `callsByModule` per `initOrder`, iterate `matchedOptional` filtering by `oc.hook === '${h.scope}.${h.phase}'` AND respecting `initOrder` for moduleId ordering. Emit one line per matched optional call.

```typescript
export function emitInitHooks(
  hooks: Hook[],
  initOrder: string[],
  callsByModule: ReadonlyMap<string, Array<{ hook: string; statement: string }>>,
  matchedOptional: ReadonlyArray<{ moduleId: string; hook: string; statement: string }> = [],
): string {
  // existing body...
  for (const h of hooks) {
    // existing strict call emission...
    const hookKey = `${h.scope}.${h.phase}`;
    for (const modId of initOrder) {
      for (const opt of matchedOptional) {
        if (opt.moduleId === modId && opt.hook === hookKey) {
          lines.push(`  ${opt.statement}`);
        }
      }
    }
    // existing end sub...
  }
}
```

- [ ] **Step 4: Update all `emitInitHooks` callers**

`grep -r 'emitInitHooks(' packages/brs-gen/src/ packages/brs-gen/tests/` to find every caller. Pass `[]` as the new 4th arg, OR thread `matchedOptional` from `validateWiring`'s return. The merger orchestration in `packages/brs-gen/src/merger/build.ts` should thread it through.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @rokudev/brs-gen test tests/merger/optional-init-calls.test.ts -- --run`
Expected: PASS, 5/5 (including the 3 from Task 2).

- [ ] **Step 6: Run full brs-gen test suite + build**

Run: `pnpm --filter @rokudev/brs-gen test -- --run && pnpm --filter @rokudev/brs-gen build`
Expected: all green. Stub_label compose still works.

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/src/merger/emit-init-hooks.ts packages/brs-gen/src/merger/build.ts packages/brs-gen/tests/merger/optional-init-calls.test.ts
git commit -m "feat(brs-gen): emit matched optional init calls in dispatch generator

emitInitHooks accepts matchedOptional from validateWiring and emits
matched entries after strict init_calls within each hook. Init order
preserved; lexical tiebreak. Stub_label compose unaffected (zero
matched optional calls)."
```

---

## Phase 2: Module scaffolding (Tasks 4-5)

### Task 4: Create module.toml with config schema, wiring, ordering

**Files:**
- Create: `packages/brs-gen/modules/analytics.event_pipe/module.toml`

**Context:** Mirror `packages/brs-gen/modules/stub_label/module.toml`'s shape. Use the config_schema and wiring from spec §10.1 + §9.1. The module has NO strict requires (empty array) — all wiring is optional_init_calls.

- [ ] **Step 1: Create the file**

Create `packages/brs-gen/modules/analytics.event_pipe/module.toml`:

```toml
[module]
id = "analytics.event_pipe"
version = "0.1.0"
spec_compat = ">=2"
description = "Pluggable event-dispatch layer with batched HTTP sink + console sink. Auto-emits Roku-conventional standard events from template hooks. Honors RIDA opt-out."

[module.config_schema]
type = "object"
additionalProperties = false
  [module.config_schema.properties]
  http_endpoint     = { type = "string", format = "uri", default = "" }
  http_app_key      = { type = "string", default = "" }
  console_sink      = { type = "boolean", default = true }
  batch_interval_ms = { type = "integer", minimum = 1000, maximum = 300000, default = 10000 }
  batch_max_events  = { type = "integer", minimum = 1, maximum = 1000, default = 50 }
  default_props     = { type = "object", additionalProperties = { type = "string" }, default = {} }

[module.files]
add = [
  "source/_modules/analytics_event_pipe/Dispatcher.bs",
  "source/_modules/analytics_event_pipe/Hooks.bs",
  "source/_modules/analytics_event_pipe/sinks/ConsoleSink.bs",
  "source/_modules/analytics_event_pipe/sinks/HttpSink.bs",
]

[module.wiring]
exports = []
requires = []
init_calls = []

optional_init_calls = [
  { hook = "MainScene.after_scene_show",         statement = "AnalyticsEventPipe_OnScreenView(m, \"MainScene\")" },
  { hook = "MainScene.after_content_load",       statement = "AnalyticsEventPipe_OnScreenView(m, \"MainScene\")" },
  { hook = "CategoryGridScene.after_scene_show", statement = "AnalyticsEventPipe_OnScreenView(m, \"CategoryGridScene\")" },
  { hook = "NowPlayingScene.after_scene_show",   statement = "AnalyticsEventPipe_OnScreenView(m, \"NowPlayingScene\")" },
  { hook = "GameScene.after_scene_show",         statement = "AnalyticsEventPipe_OnScreenView(m, \"GameScene\")" },
  { hook = "Screensaver.after_scene_show",       statement = "AnalyticsEventPipe_OnScreenView(m, \"Screensaver\")" },
  { hook = "PlayerScene.before_play",            statement = "AnalyticsEventPipe_OnContentStart(m)" },
  { hook = "GameScene.after_game_start",         statement = "AnalyticsEventPipe_OnGameStart(m)" },
  { hook = "GameScene.after_game_over",          statement = "AnalyticsEventPipe_OnGameOver(m)" },
]

[module.ordering]
before = []
after  = ["auth.device_link_code", "auth.oauth_device_grant", "auth.roku_os_signin"]

[module.conflicts]
exclusive_with = []
```

- [ ] **Step 2: Verify the catalog loads it**

Run: `pnpm --filter @rokudev/brs-gen test -- --run`
Expected: catalog loader tests (if any iterate the modules/ dir) discover analytics.event_pipe. No errors. Files referenced in `[module.files]` don't exist yet but parsing should succeed (file existence checked at compose time, not catalog-load time).

- [ ] **Step 3: Commit (skeleton, no BS files yet)**

```bash
git add packages/brs-gen/modules/analytics.event_pipe/module.toml
git commit -m "feat(brs-gen): scaffold analytics.event_pipe module.toml

Module declaration only; BrightScript sources stubbed in next task.
Config schema, wiring (optional_init_calls only), and ordering match
spec sections 10.1 + 9.1. Files referenced will be created in Task 5."
```

---

### Task 5: Create BrightScript file skeletons

**Files:**
- Create: `packages/brs-gen/modules/analytics.event_pipe/files/source/_modules/analytics_event_pipe/Dispatcher.bs`
- Create: `.../analytics_event_pipe/Hooks.bs`
- Create: `.../analytics_event_pipe/sinks/ConsoleSink.bs`
- Create: `.../analytics_event_pipe/sinks/HttpSink.bs`

**Context:** Stub files exist solely to let the engine compose `analytics.event_pipe + <template>` without 404-on-readFile. Functions are STUB markers; real implementations land in Tasks 13-15.

- [ ] **Step 1: Create Dispatcher.bs stub**

```brightscript
' STUB: Real implementation in Task 13. Functions present so engine
' can compose this module with any template without bsc errors.

function Analytics_Track(name as string, props as object) as void
end function

function Analytics_AddSink(handlerName as string) as integer
    return 0
end function

function Analytics_RemoveSink(handle as integer) as boolean
    return false
end function

sub Analytics_Flush()
end sub

sub Analytics_SetIdentity(props as object)
end sub
```

- [ ] **Step 2: Create Hooks.bs stub**

```brightscript
' STUB: Real implementation in Task 14.

sub AnalyticsEventPipe_OnScreenView(m as object, screenName as string)
end sub

sub AnalyticsEventPipe_OnContentStart(m as object)
end sub

sub AnalyticsEventPipe_OnGameStart(m as object)
end sub

sub AnalyticsEventPipe_OnGameOver(m as object)
end sub
```

- [ ] **Step 3: Create ConsoleSink.bs stub**

```brightscript
' STUB: Real implementation in Task 15.
function ConsoleSink_handler(events as object) as boolean
    return true
end function
```

- [ ] **Step 4: Create HttpSink.bs stub**

```brightscript
' STUB: Real implementation in Task 15.
function HttpSink_handler(events as object) as boolean
    return true
end function
```

- [ ] **Step 5: Smoke-compose against blank_scenegraph**

Write a one-off ad-hoc script in `/tmp/compose-smoke.mjs`:

```javascript
import { generateAppForRegen } from '/Users/bblietz/Work/ClaudeProjects/rokudev-tools/packages/brs-gen/scripts/regen-helper.mjs';
import { writeFileSync } from 'node:fs';
const specPath = '/tmp/analytics-smoke-spec.json';
writeFileSync(specPath, JSON.stringify({
  spec_version: 2,
  template: 'blank_scenegraph',
  modules: [{ id: 'analytics.event_pipe' }],
  app: { name: 'Analytics Smoke', major_version: 0, minor_version: 1, build_version: 0 },
}));
const r = await generateAppForRegen({
  outputDir: '/tmp/analytics-smoke',
  spec: specPath,
  outputZip: '/tmp/analytics-smoke.zip',
});
console.log('lint errors:', JSON.stringify(r.payload.lint_errors || [], null, 2).slice(0, 800));
```

Run: `node /tmp/compose-smoke.mjs`
Expected: compose succeeds, lint_errors empty array. The 4 stub files appear in `/tmp/analytics-smoke/source/_modules/analytics_event_pipe/`. The auto-generated `__init_hooks.brs` contains the `Modules_OnMainSceneAfterSceneShow` dispatch with the matched optional call `AnalyticsEventPipe_OnScreenView(m, "MainScene")`.

- [ ] **Step 6: Run full test suite + build**

Run: `pnpm --filter @rokudev/brs-gen test -- --run && pnpm --filter @rokudev/brs-gen build`
Expected: green. (No new tests yet; this is scaffold-only.)

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/modules/analytics.event_pipe/files/
git commit -m "feat(brs-gen): scaffold analytics.event_pipe BrightScript files (stubs)

STUB files so the engine can compose analytics.event_pipe with any
template. Smoke-tested against blank_scenegraph; optional init call
fires AnalyticsEventPipe_OnScreenView (stub). Real implementations in
Tasks 13-15."
```

---

## Phase 3: TS shim + unit tests (Tasks 6-11)

The TS shim mirrors the *pure* dispatcher functions (no SceneGraph). It lets us TDD the logic before authoring BrightScript. Pattern precedent: `packages/brs-gen/tests/pong-helpers.ts` for `game_shell`.

### Task 6: Foundation — analytics-helpers.ts shim with constants

**Files:**
- Create: `packages/brs-gen/tests/analytics-helpers.ts`

**Context:** Define module-level constants that will be mirrored verbatim in `Dispatcher.bs`. These are the defaults from §10.1 and the auto-prop keys from §6.2. Pure module — no exports except constants and pure functions added in later tasks.

- [ ] **Step 1: Create the shim with constants**

```typescript
// packages/brs-gen/tests/analytics-helpers.ts
// TS shim mirroring pure logic in modules/analytics.event_pipe/files/source/_modules/analytics_event_pipe/Dispatcher.bs.
// Keep the constants below in sync (covered by analytics-const-parity.test.ts).

export const ANALYTICS_DEFAULT_BATCH_INTERVAL_MS = 10000;
export const ANALYTICS_DEFAULT_BATCH_MAX_EVENTS = 50;
export const ANALYTICS_SINK_HTTP_TIMEOUT_S = 5;
export const ANALYTICS_QUEUE_OVERFLOW_MULTIPLIER = 2;  // >2x batch_max triggers force-flush
```

- [ ] **Step 2: No test yet (foundation only); verify import resolves**

Run: `pnpm --filter @rokudev/brs-gen exec tsc --noEmit tests/analytics-helpers.ts`
Expected: clean exit.

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/tests/analytics-helpers.ts
git commit -m "test(brs-gen): scaffold analytics-helpers.ts TS shim with constants

Mirrors pure dispatcher constants from Dispatcher.bs (Task 13). Functions
added per-task in Phase 3. Const-parity test in Task 12 will gate equality
between this shim and the BS source."
```

---

### Task 7: Name normalization (TDD)

**Files:**
- Modify: `packages/brs-gen/tests/analytics-helpers.ts` (add `normalizeEventName`)
- Test: `packages/brs-gen/tests/analytics-dispatcher.test.ts` (new)

**Context:** From spec §6.1: event names are normalized to lowercase snake_case at `Analytics_Track` entry. Warn (return a `{ name, warning }` tuple) if input differs from output; never drop the event. Snake-case means `[a-z0-9_]+`; uppercase letters lowercase, dashes/spaces become underscores, invalid chars stripped.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/brs-gen/tests/analytics-dispatcher.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeEventName } from './analytics-helpers.js';

describe('normalizeEventName', () => {
  it('lowercases ASCII letters', () => {
    expect(normalizeEventName('ChannelStart').name).toBe('channelstart');
  });
  it('preserves valid snake_case input verbatim, no warning', () => {
    const r = normalizeEventName('channel_start');
    expect(r.name).toBe('channel_start');
    expect(r.warning).toBeUndefined();
  });
  it('warns when input differed from normalized output', () => {
    const r = normalizeEventName('ChannelStart');
    expect(r.warning).toContain('normalized');
  });
  it('replaces dash and space with underscore', () => {
    expect(normalizeEventName('content-end now').name).toBe('content_end_now');
  });
  it('strips chars outside [a-z0-9_]', () => {
    expect(normalizeEventName('foo!bar@1').name).toBe('foobar1');
  });
  it('returns empty name + warning when input empty after normalization', () => {
    const r = normalizeEventName('!@#$');
    expect(r.name).toBe('');
    expect(r.warning).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rokudev/brs-gen test tests/analytics-dispatcher.test.ts -- --run`
Expected: FAIL with "normalizeEventName is not a function".

- [ ] **Step 3: Implement `normalizeEventName` in analytics-helpers.ts**

```typescript
export function normalizeEventName(input: string): { name: string; warning?: string } {
  const lowered = input.toLowerCase();
  const replaced = lowered.replace(/[\s-]+/g, '_');
  const stripped = replaced.replace(/[^a-z0-9_]/g, '');
  if (stripped === '') return { name: '', warning: `name "${input}" empty after normalization` };
  if (stripped !== input) return { name: stripped, warning: `name "${input}" normalized to "${stripped}"` };
  return { name: stripped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rokudev/brs-gen test tests/analytics-dispatcher.test.ts -- --run`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/tests/analytics-helpers.ts packages/brs-gen/tests/analytics-dispatcher.test.ts
git commit -m "test(brs-gen): analytics event name normalization (TS shim)

normalizeEventName lowercases, snake-cases, strips invalid chars; never
drops the event. Returns {name, warning?} so the dispatcher can log a
console warning without dropping. BS impl in Task 13."
```

---

### Task 8: Sink registration & dedup (TDD)

**Files:**
- Modify: `packages/brs-gen/tests/analytics-helpers.ts` (add SinkRegistry class)
- Test: `packages/brs-gen/tests/analytics-sinks.test.ts` (new)

**Context:** Spec §7.3: sinks registered by function name string. Same name registered twice returns the same handle. Handles are monotonic positive integers. `removeSink(unknownHandle)` returns false.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/brs-gen/tests/analytics-sinks.test.ts
import { describe, it, expect } from 'vitest';
import { SinkRegistry } from './analytics-helpers.js';

describe('SinkRegistry', () => {
  it('returns monotonic positive handle on first add', () => {
    const r = new SinkRegistry();
    expect(r.add('A_handler')).toBe(1);
    expect(r.add('B_handler')).toBe(2);
  });
  it('returns existing handle when same name registered twice', () => {
    const r = new SinkRegistry();
    const h1 = r.add('A_handler');
    expect(r.add('A_handler')).toBe(h1);
    expect(r.list()).toEqual(['A_handler']);
  });
  it('removes by handle and returns true', () => {
    const r = new SinkRegistry();
    const h = r.add('A_handler');
    expect(r.remove(h)).toBe(true);
    expect(r.list()).toEqual([]);
  });
  it('returns false on remove with unknown handle', () => {
    const r = new SinkRegistry();
    expect(r.remove(999)).toBe(false);
  });
  it('preserves registration order in list()', () => {
    const r = new SinkRegistry();
    r.add('Z_handler'); r.add('A_handler'); r.add('M_handler');
    expect(r.list()).toEqual(['Z_handler', 'A_handler', 'M_handler']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rokudev/brs-gen test tests/analytics-sinks.test.ts -- --run`
Expected: FAIL with "SinkRegistry is not a constructor".

- [ ] **Step 3: Implement SinkRegistry in analytics-helpers.ts**

```typescript
export class SinkRegistry {
  private byHandle = new Map<number, string>();
  private byName = new Map<string, number>();
  private nextHandle = 1;
  add(name: string): number {
    const existing = this.byName.get(name);
    if (existing !== undefined) return existing;
    const h = this.nextHandle++;
    this.byHandle.set(h, name);
    this.byName.set(name, h);
    return h;
  }
  remove(handle: number): boolean {
    const name = this.byHandle.get(handle);
    if (name === undefined) return false;
    this.byHandle.delete(handle);
    this.byName.delete(name);
    return true;
  }
  list(): string[] {
    return Array.from(this.byHandle.values());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rokudev/brs-gen test tests/analytics-sinks.test.ts -- --run`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/tests/analytics-helpers.ts packages/brs-gen/tests/analytics-sinks.test.ts
git commit -m "test(brs-gen): analytics SinkRegistry (TS shim)

Stable handle on dedup-by-name; monotonic positive int handles;
remove returns false for unknown handle. BS impl in Task 13."
```

---

### Task 9: Identity merge (TDD)

**Files:**
- Modify: `packages/brs-gen/tests/analytics-helpers.ts` (add `mergeIdentity`)
- Test: `packages/brs-gen/tests/analytics-identity.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/brs-gen/tests/analytics-identity.test.ts
import { describe, it, expect } from 'vitest';
import { mergeIdentity } from './analytics-helpers.js';

describe('mergeIdentity', () => {
  it('adds new keys', () => {
    expect(mergeIdentity({}, { user_id: 'u1' })).toEqual({ user_id: 'u1' });
  });
  it('overwrites existing keys with new value', () => {
    expect(mergeIdentity({ user_id: 'u1' }, { user_id: 'u2' })).toEqual({ user_id: 'u2' });
  });
  it('deletes keys whose new value is null', () => {
    expect(mergeIdentity({ user_id: 'u1', tier: 'pro' }, { tier: null })).toEqual({ user_id: 'u1' });
  });
  it('returns a new object (no mutation)', () => {
    const base = { a: 1 };
    const out = mergeIdentity(base, { b: 2 });
    expect(base).toEqual({ a: 1 });
    expect(out).toEqual({ a: 1, b: 2 });
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm --filter @rokudev/brs-gen test tests/analytics-identity.test.ts -- --run`
Expected: FAIL.

- [ ] **Step 3: Implement `mergeIdentity` in analytics-helpers.ts**

```typescript
export function mergeIdentity(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @rokudev/brs-gen test tests/analytics-identity.test.ts -- --run`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/tests/analytics-helpers.ts packages/brs-gen/tests/analytics-identity.test.ts
git commit -m "test(brs-gen): analytics identity merge (TS shim)

mergeIdentity overwrites keys, deletes on null, never mutates input.
BS impl in Task 13 will use 'for each k in incoming.Keys()' with
'invalid' check standing in for JS null."
```

---

### Task 10: Privacy / RIDA / auto-props (TDD)

**Files:**
- Modify: `packages/brs-gen/tests/analytics-helpers.ts` (add `buildAutoProps`)
- Test: `packages/brs-gen/tests/analytics-privacy.test.ts` (new)

**Context:** Spec §10.3 BrightScript snippet defines the auto-prop build. TS shim takes a `DeviceInfoLike` interface so tests can inject mocks for `IsRIDADisabled()`, `GetRIDA()`, `GetChannelClientId()`, `GetModel()`, `GetVersion()`.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/brs-gen/tests/analytics-privacy.test.ts
import { describe, it, expect } from 'vitest';
import { buildAutoProps } from './analytics-helpers.js';

const baseDi = {
  GetChannelClientId: () => 'ccid_xyz',
  GetRIDA: () => 'rida_abc',
  IsRIDADisabled: () => false,
  GetModel: () => '2910X',
  GetVersion: () => '15.2.4',
};

describe('buildAutoProps', () => {
  it('includes channel_client_id, session_id, channel_version, roku_model, roku_fw, ts_epoch_ms', () => {
    const out = buildAutoProps({
      di: baseDi,
      sessionId: 's_1',
      manifestVersion: '0.1.0',
      defaultProps: {},
      identity: {},
      nowMs: 1700000000000,
    });
    expect(out.channel_client_id).toBe('ccid_xyz');
    expect(out.session_id).toBe('s_1');
    expect(out.channel_version).toBe('0.1.0');
    expect(out.roku_model).toBe('2910X');
    expect(out.roku_fw).toBe('15.2.4');
    expect(out.ts_epoch_ms).toBe(1700000000000);
  });
  it('includes rida when IsRIDADisabled() returns false', () => {
    const out = buildAutoProps({ di: baseDi, sessionId: 's', manifestVersion: '0', defaultProps: {}, identity: {}, nowMs: 0 });
    expect(out.rida).toBe('rida_abc');
  });
  it('omits rida when IsRIDADisabled() returns true', () => {
    const di = { ...baseDi, IsRIDADisabled: () => true };
    const out = buildAutoProps({ di, sessionId: 's', manifestVersion: '0', defaultProps: {}, identity: {}, nowMs: 0 });
    expect('rida' in out).toBe(false);
  });
  it('merges default_props after auto-props', () => {
    const out = buildAutoProps({ di: baseDi, sessionId: 's', manifestVersion: '0', defaultProps: { environment: 'prod' }, identity: {}, nowMs: 0 });
    expect(out.environment).toBe('prod');
  });
  it('merges identity AFTER default_props (identity wins on key collision)', () => {
    const out = buildAutoProps({ di: baseDi, sessionId: 's', manifestVersion: '0', defaultProps: { environment: 'prod' }, identity: { environment: 'staging' }, nowMs: 0 });
    expect(out.environment).toBe('staging');
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm --filter @rokudev/brs-gen test tests/analytics-privacy.test.ts -- --run`
Expected: FAIL.

- [ ] **Step 3: Implement `buildAutoProps`**

```typescript
export interface DeviceInfoLike {
  GetChannelClientId(): string;
  GetRIDA(): string;
  IsRIDADisabled(): boolean;
  GetModel(): string;
  GetVersion(): string;
}

export function buildAutoProps(args: {
  di: DeviceInfoLike;
  sessionId: string;
  manifestVersion: string;
  defaultProps: Record<string, string>;
  identity: Record<string, unknown>;
  nowMs: number;
}): Record<string, unknown> {
  const props: Record<string, unknown> = {
    channel_client_id: args.di.GetChannelClientId(),
    session_id:        args.sessionId,
    channel_version:   args.manifestVersion,
    roku_model:        args.di.GetModel(),
    roku_fw:           args.di.GetVersion(),
    ts_epoch_ms:       args.nowMs,
  };
  if (!args.di.IsRIDADisabled()) props.rida = args.di.GetRIDA();
  for (const [k, v] of Object.entries(args.defaultProps)) props[k] = v;
  for (const [k, v] of Object.entries(args.identity)) props[k] = v;
  return props;
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @rokudev/brs-gen test tests/analytics-privacy.test.ts -- --run`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/tests/analytics-helpers.ts packages/brs-gen/tests/analytics-privacy.test.ts
git commit -m "test(brs-gen): analytics buildAutoProps (TS shim)

RIDA opt-out honored via IsRIDADisabled(); channel_client_id always
present; default_props then identity merged (identity wins). Matches
spec section 10.3 BrightScript snippet. BS impl in Task 13."
```

---

### Task 11: Flush, retry-once, queue overflow (TDD)

**Files:**
- Modify: `packages/brs-gen/tests/analytics-helpers.ts` (add `drainQueue`)
- Test: `packages/brs-gen/tests/analytics-flush.test.ts` (new)

**Context:** Spec §8.4 drain procedure: pop queue, merge retryBuffer to front, fan out to each sink, push failures back into retryBuffer (overwriting; only one cycle). The TS shim is pure: it takes inputs (queue, retryBuffer, sinks) and returns the new state (nextQueue, nextRetryBuffer, droppedBatches).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/brs-gen/tests/analytics-flush.test.ts
import { describe, it, expect, vi } from 'vitest';
import { drainQueue } from './analytics-helpers.js';

const ev = (name: string) => ({ name, ts: '2026-05-18T00:00:00.000Z', props: {} });

describe('drainQueue', () => {
  it('calls each sink with the batch', () => {
    const sinkA = vi.fn().mockReturnValue(true);
    const sinkB = vi.fn().mockReturnValue(true);
    const out = drainQueue({ queue: [ev('a')], retryBuffer: [], sinks: [sinkA, sinkB] });
    expect(sinkA).toHaveBeenCalledOnce();
    expect(sinkB).toHaveBeenCalledOnce();
    expect(out.nextQueue).toEqual([]);
    expect(out.nextRetryBuffer).toEqual([]);
  });
  it('merges retryBuffer to FRONT of batch', () => {
    const sink = vi.fn().mockReturnValue(true);
    drainQueue({ queue: [ev('new')], retryBuffer: [ev('old')], sinks: [sink] });
    const batch = sink.mock.calls[0][0] as Array<{ name: string }>;
    expect(batch.map((e) => e.name)).toEqual(['old', 'new']);
  });
  it('pushes failed batch into nextRetryBuffer', () => {
    const sink = vi.fn().mockReturnValue(false);
    const out = drainQueue({ queue: [ev('a')], retryBuffer: [], sinks: [sink] });
    expect(out.nextRetryBuffer.map((e) => e.name)).toEqual(['a']);
  });
  it('drops the batch when retry also fails (no third attempt)', () => {
    const sink = vi.fn().mockReturnValue(false);
    const out = drainQueue({ queue: [], retryBuffer: [ev('a')], sinks: [sink] });
    expect(out.nextRetryBuffer).toEqual([]);
    expect(out.droppedCount).toBe(1);
  });
  it('treats sink throw as failure', () => {
    const sink = vi.fn().mockImplementation(() => { throw new Error('boom'); });
    const out = drainQueue({ queue: [ev('a')], retryBuffer: [], sinks: [sink] });
    expect(out.nextRetryBuffer.map((e) => e.name)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Verify it fails**

Run: `pnpm --filter @rokudev/brs-gen test tests/analytics-flush.test.ts -- --run`
Expected: FAIL.

- [ ] **Step 3: Implement `drainQueue`**

```typescript
type Event = { name: string; ts: string; props: Record<string, unknown> };
type SinkFn = (events: Event[]) => boolean;

export function drainQueue(args: {
  queue: Event[];
  retryBuffer: Event[];
  sinks: SinkFn[];
}): { nextQueue: Event[]; nextRetryBuffer: Event[]; droppedCount: number } {
  const batch = [...args.retryBuffer, ...args.queue];
  const wasRetry = args.retryBuffer.length > 0;
  let allOk = true;
  for (const sink of args.sinks) {
    try {
      if (!sink(batch)) allOk = false;
    } catch {
      allOk = false;
    }
  }
  if (allOk) {
    return { nextQueue: [], nextRetryBuffer: [], droppedCount: 0 };
  }
  if (wasRetry) {
    // already retried once; drop
    return { nextQueue: [], nextRetryBuffer: [], droppedCount: batch.length };
  }
  return { nextQueue: [], nextRetryBuffer: batch, droppedCount: 0 };
}
```

- [ ] **Step 4: Run test**

Run: `pnpm --filter @rokudev/brs-gen test tests/analytics-flush.test.ts -- --run`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/tests/analytics-helpers.ts packages/brs-gen/tests/analytics-flush.test.ts
git commit -m "test(brs-gen): analytics drainQueue + retry-once-then-drop (TS shim)

Pure drain: merges retryBuffer to front of batch, fans to sinks,
pushes failures into nextRetryBuffer, drops on second failure. Sink
exception treated as failure. BS impl in Task 13."
```

---

## Phase 4: BrightScript implementation (Tasks 12-15)

### Task 12: Const-parity test (gates BS implementation)

**Files:**
- Test: `packages/brs-gen/tests/analytics-const-parity.test.ts` (new)

**Context:** Pattern precedent: `packages/brs-gen/tests/pong-const-parity.test.ts`. Regex-parse the module-level const block of `Dispatcher.bs` and assert numeric equality with the exports of `analytics-helpers.ts`. Test FAILS until Task 13 writes the right BS consts.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/brs-gen/tests/analytics-const-parity.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shim from './analytics-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DISPATCHER_BS_PATH = join(
  __dirname,
  '../modules/analytics.event_pipe/files/source/_modules/analytics_event_pipe/Dispatcher.bs',
);

function parseConst(src: string, name: string): number {
  // matches: const NAME% = 123  OR  const NAME = 123  OR  const NAME! = 1.5
  const re = new RegExp(`^const\\s+${name}[%!]?\\s*=\\s*([-+]?\\d+(?:\\.\\d+)?)`, 'm');
  const m = src.match(re);
  if (!m) throw new Error(`const ${name} not found in Dispatcher.bs`);
  return Number(m[1]);
}

describe('analytics const parity (Dispatcher.bs <-> analytics-helpers.ts)', () => {
  const src = readFileSync(DISPATCHER_BS_PATH, 'utf8');

  it('ANALYTICS_DEFAULT_BATCH_INTERVAL_MS', () => {
    expect(parseConst(src, 'ANALYTICS_DEFAULT_BATCH_INTERVAL_MS')).toBe(shim.ANALYTICS_DEFAULT_BATCH_INTERVAL_MS);
  });
  it('ANALYTICS_DEFAULT_BATCH_MAX_EVENTS', () => {
    expect(parseConst(src, 'ANALYTICS_DEFAULT_BATCH_MAX_EVENTS')).toBe(shim.ANALYTICS_DEFAULT_BATCH_MAX_EVENTS);
  });
  it('ANALYTICS_SINK_HTTP_TIMEOUT_S', () => {
    expect(parseConst(src, 'ANALYTICS_SINK_HTTP_TIMEOUT_S')).toBe(shim.ANALYTICS_SINK_HTTP_TIMEOUT_S);
  });
  it('ANALYTICS_QUEUE_OVERFLOW_MULTIPLIER', () => {
    expect(parseConst(src, 'ANALYTICS_QUEUE_OVERFLOW_MULTIPLIER')).toBe(shim.ANALYTICS_QUEUE_OVERFLOW_MULTIPLIER);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rokudev/brs-gen test tests/analytics-const-parity.test.ts -- --run`
Expected: FAIL (Dispatcher.bs is a stub from Task 5; no const declarations). Error like "const ANALYTICS_DEFAULT_BATCH_INTERVAL_MS not found".

- [ ] **Step 3: Commit the failing test (TDD gate)**

```bash
git add packages/brs-gen/tests/analytics-const-parity.test.ts
git commit -m "test(brs-gen): analytics const-parity gate (failing; locks Task 13)

Regex-parse Dispatcher.bs module-level const block; assert numeric
equality with analytics-helpers.ts shim exports. Currently FAILS
because Dispatcher.bs is a stub; Task 13 makes it pass."
```

---

### Task 13: Implement Dispatcher.bs

**Files:**
- Modify: `packages/brs-gen/modules/analytics.event_pipe/files/source/_modules/analytics_event_pipe/Dispatcher.bs`

**Context:** Full BrightScript implementation per spec §8 + §10.3. Mirror the TS shim's pure functions verbatim where possible. Use the `[Analytics]` log-line format documented in §12.4 (one line per emitted event when drained to ConsoleSink). Const block lives at the top of the file to satisfy Task 12's parity test.

The dispatcher state lives on an `m.global` child `roSGNode(Node)` with `id="AnalyticsEventPipe"`. The Timer is a child of that node. See spec §8.1 for the field map.

- [ ] **Step 1: Author the file**

Replace the stub at `packages/brs-gen/modules/analytics.event_pipe/files/source/_modules/analytics_event_pipe/Dispatcher.bs` with full implementation:

```brightscript
' ---------------------------------------------------------------------
' Dispatcher.bs - analytics.event_pipe singleton + public API.
' Pure-logic functions mirrored verbatim in packages/brs-gen/tests/
' analytics-helpers.ts; keep the constants below in sync (covered by
' analytics-const-parity.test.ts).
' ---------------------------------------------------------------------

const ANALYTICS_DEFAULT_BATCH_INTERVAL_MS% = 10000
const ANALYTICS_DEFAULT_BATCH_MAX_EVENTS% = 50
const ANALYTICS_SINK_HTTP_TIMEOUT_S% = 5
const ANALYTICS_QUEUE_OVERFLOW_MULTIPLIER% = 2

' --- Public API ------------------------------------------------------

function Analytics_Track(name as string, props as object) as void
    node = AnalyticsEventPipe_GetOrInitNode()
    if node = invalid then return  ' pre-SG context; spec section 11
    normalized = AnalyticsEventPipe_NormalizeName(name)
    if normalized.name = "" then
        print "[Analytics] reject name=" + name
        return
    end if
    if normalized.warning <> "" then
        print "[Analytics] warn " + normalized.warning
    end if
    ' channel_start synthesis (spec section 8.3): on first emission per session
    if node.coldStartFired <> true then
        node.coldStartFired = true
        AnalyticsEventPipe_Enqueue(node, "channel_start", { cold_start: true })
    end if
    AnalyticsEventPipe_Enqueue(node, normalized.name, props)
    ' threshold flush
    qlen = AnalyticsEventPipe_QueueLength(node)
    if qlen >= node.config.batch_max_events then
        AnalyticsEventPipe_Flush(node)
    end if
end function

function Analytics_AddSink(handlerName as string) as integer
    node = AnalyticsEventPipe_GetOrInitNode()
    if node = invalid then return 0
    existing = node.sinkHandles[handlerName]
    if existing <> invalid then return existing
    handle = node.nextHandle
    node.nextHandle = handle + 1
    sinks = node.sinks
    sinks.push(handlerName)
    node.sinks = sinks
    handles = node.sinkHandles
    handles[handlerName] = handle
    node.sinkHandles = handles
    return handle
end function

function Analytics_RemoveSink(handle as integer) as boolean
    node = AnalyticsEventPipe_GetOrInitNode()
    if node = invalid then return false
    handles = node.sinkHandles
    foundName = ""
    for each k in handles.Keys()
        if handles[k] = handle then foundName = k
    end for
    if foundName = "" then return false
    handles.Delete(foundName)
    node.sinkHandles = handles
    newSinks = []
    for each s in node.sinks
        if s <> foundName then newSinks.push(s)
    end for
    node.sinks = newSinks
    return true
end function

sub Analytics_Flush()
    node = AnalyticsEventPipe_GetOrInitNode()
    if node = invalid then return
    AnalyticsEventPipe_Flush(node)
end sub

sub Analytics_SetIdentity(props as object)
    node = AnalyticsEventPipe_GetOrInitNode()
    if node = invalid then return
    id = node.identity
    for each k in props.Keys()
        if props[k] = invalid then
            id.Delete(k)
        else
            id[k] = props[k]
        end if
    end for
    node.identity = id
end sub

' --- Internal --------------------------------------------------------

function AnalyticsEventPipe_GetOrInitNode() as object
    if m.global = invalid then return invalid
    node = m.global.findNode("AnalyticsEventPipe")
    if node <> invalid then return node
    return AnalyticsEventPipe_Init()
end function

function AnalyticsEventPipe_Init() as object
    node = m.global.createChild("Node")
    node.id = "AnalyticsEventPipe"
    cfg = ModuleConfig_analytics_event_pipe()
    node.addField("config", "assocarray", false)
    node.addField("queue", "string", false)
    node.addField("retryBuffer", "string", false)
    node.addField("sinks", "array", false)
    node.addField("sinkHandles", "assocarray", false)
    node.addField("nextHandle", "integer", false)
    node.addField("identity", "assocarray", false)
    node.addField("sessionId", "string", false)
    node.addField("manifestVersion", "string", false)
    node.addField("previousScreen", "string", false)
    node.addField("coldStartFired", "boolean", false)
    node.config = cfg
    node.queue = "[]"
    node.retryBuffer = "[]"
    node.sinks = []
    node.sinkHandles = {}
    node.nextHandle = 1
    node.identity = {}
    node.sessionId = AnalyticsEventPipe_NewSessionId()
    node.manifestVersion = AnalyticsEventPipe_ReadManifestVersion()
    node.previousScreen = ""
    node.coldStartFired = false
    ' Flush timer.
    timer = node.createChild("Timer")
    timer.id = "AnalyticsEventPipe_FlushTimer"
    timer.repeat = true
    timer.duration = cfg.batch_interval_ms / 1000.0
    timer.observeField("fire", "AnalyticsEventPipe_OnFlushTimer")
    timer.control = "start"
    ' Default sinks.
    if cfg.console_sink = true then Analytics_AddSink("ConsoleSink_handler")
    if cfg.http_endpoint <> "" then Analytics_AddSink("HttpSink_handler")
    return node
end function

sub AnalyticsEventPipe_OnFlushTimer(event as object)
    node = m.global.findNode("AnalyticsEventPipe")
    if node = invalid then return
    AnalyticsEventPipe_Flush(node)
end sub

sub AnalyticsEventPipe_Enqueue(node as object, name as string, eventProps as object)
    ts = AnalyticsEventPipe_NowIso()
    auto = AnalyticsEventPipe_BuildAutoProps(node)
    merged = {}
    for each k in auto.Keys()
        merged[k] = auto[k]
    end for
    for each k in eventProps.Keys()
        merged[k] = eventProps[k]
    end for
    if name = "screen_view" then
        if node.previousScreen <> "" and merged["previous_screen"] = invalid then
            merged.previous_screen = node.previousScreen
        end if
        if merged.screen_name <> invalid then node.previousScreen = merged.screen_name
    end if
    ev = { name: name, ts: ts, props: merged }
    q = ParseJson(node.queue)
    if q = invalid then q = []
    q.push(ev)
    ' overflow protection
    if q.Count() > node.config.batch_max_events * ANALYTICS_QUEUE_OVERFLOW_MULTIPLIER% then
        node.queue = FormatJson(q)
        AnalyticsEventPipe_Flush(node)
        return
    end if
    node.queue = FormatJson(q)
end sub

sub AnalyticsEventPipe_Flush(node as object)
    q = ParseJson(node.queue)
    if q = invalid then q = []
    rb = ParseJson(node.retryBuffer)
    if rb = invalid then rb = []
    if q.Count() = 0 and rb.Count() = 0 then return
    batch = []
    for each e in rb : batch.push(e) : end for
    for each e in q : batch.push(e) : end for
    wasRetry = (rb.Count() > 0)
    node.queue = "[]"
    node.retryBuffer = "[]"
    allOk = true
    for each sinkName in node.sinks
        ok = false
        try
            fn = Function(sinkName)
            if fn <> invalid then ok = fn(batch)
        catch e
            ok = false
        end try
        if ok <> true then allOk = false
    end for
    if allOk then return
    if wasRetry then
        print "[Analytics] DROP batch=" + batch.Count().toStr() + " reason=sink_failure_twice"
        return
    end if
    node.retryBuffer = FormatJson(batch)
end sub

function AnalyticsEventPipe_QueueLength(node as object) as integer
    q = ParseJson(node.queue)
    if q = invalid then return 0
    return q.Count()
end function

function AnalyticsEventPipe_NormalizeName(input as string) as object
    lowered = LCase(input)
    re = CreateObject("roRegex", "[\s\-]+", "")
    replaced = re.ReplaceAll(lowered, "_")
    re2 = CreateObject("roRegex", "[^a-z0-9_]", "")
    stripped = re2.ReplaceAll(replaced, "")
    if stripped = "" then return { name: "", warning: "name " + chr(34) + input + chr(34) + " empty after normalization" }
    if stripped <> input then return { name: stripped, warning: "name " + chr(34) + input + chr(34) + " normalized to " + chr(34) + stripped + chr(34) }
    return { name: stripped, warning: "" }
end function

function AnalyticsEventPipe_BuildAutoProps(node as object) as object
    di = CreateObject("roDeviceInfo")
    props = {
        channel_client_id: di.GetChannelClientId(),
        session_id:        node.sessionId,
        channel_version:   node.manifestVersion,
        roku_model:        di.GetModel(),
        roku_fw:           di.GetVersion(),
        ts_epoch_ms:       CreateObject("roDateTime").AsSeconds() * 1000
    }
    if NOT di.IsRIDADisabled() then props.rida = di.GetRIDA()
    for each k in node.config.default_props.Keys() : props[k] = node.config.default_props[k] : end for
    for each k in node.identity.Keys() : props[k] = node.identity[k] : end for
    return props
end function

function AnalyticsEventPipe_NewSessionId() as string
    return CreateObject("roDeviceInfo").GetRandomUUID()
end function

function AnalyticsEventPipe_NowIso() as string
    dt = CreateObject("roDateTime")
    return dt.ToISOString()
end function

function AnalyticsEventPipe_ReadManifestVersion() as string
    mf = CreateObject("roAppInfo")
    return mf.GetVersion()
end function
```

- [ ] **Step 2: Run the const-parity test from Task 12**

Run: `pnpm --filter @rokudev/brs-gen test tests/analytics-const-parity.test.ts -- --run`
Expected: PASS, 4/4.

- [ ] **Step 3: Smoke-compose against blank_scenegraph (re-run Task 5 script)**

Run: `node /tmp/compose-smoke.mjs`
Expected: compose succeeds, lint_errors empty array. Generated `Dispatcher.brs` contains the full implementation.

- [ ] **Step 4: Run full brs-gen test suite + build**

Run: `pnpm --filter @rokudev/brs-gen test -- --run && pnpm --filter @rokudev/brs-gen build`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/modules/analytics.event_pipe/files/source/_modules/analytics_event_pipe/Dispatcher.bs
git commit -m "feat(brs-gen): implement analytics.event_pipe Dispatcher.bs

Full dispatcher per spec sections 8 + 10.3: SG-node singleton, queue,
flush timer, sink registry, public API (Track/AddSink/RemoveSink/
Flush/SetIdentity), channel_start synthesis on first emission, RIDA
opt-out honored, retry-once-then-drop, queue-overflow force-flush.
Const block mirrored verbatim in analytics-helpers.ts shim
(const-parity test passes)."
```

---

### Task 14: Implement Hooks.bs

**Files:**
- Modify: `packages/brs-gen/modules/analytics.event_pipe/files/source/_modules/analytics_event_pipe/Hooks.bs`

**Context:** 4 hook handlers that translate template-scope events into `Analytics_Track` calls. Each one reads context-appropriate fields from `m` (the scene component scope) and synthesizes an event payload.

- [ ] **Step 1: Author the file**

Replace stub with:

```brightscript
' Hooks.bs - analytics.event_pipe hook handlers wired from optional_init_calls.

sub AnalyticsEventPipe_OnScreenView(m as object, screenName as string)
    Analytics_Track("screen_view", { screen_name: screenName })
end sub

sub AnalyticsEventPipe_OnContentStart(m as object)
    ' PlayerScene convention: m.top.content is a ContentNode with title/url/streamformat.
    content = invalid
    if m.top <> invalid and m.top.content <> invalid then content = m.top.content
    props = {
        content_id: "",
        content_title: "",
        content_kind: "video",
        is_live: false
    }
    if content <> invalid then
        if content.id <> invalid then props.content_id = content.id
        if content.title <> invalid then props.content_title = content.title
        if content.streamformat = "hls" then props.is_live = true  ' coarse heuristic; channels can override
    end if
    Analytics_Track("content_start", props)
end sub

sub AnalyticsEventPipe_OnGameStart(m as object)
    props = {}
    if m.top <> invalid then
        if m.top.cpuDifficulty <> invalid then props.cpu_difficulty = m.top.cpuDifficulty
        if m.top.scoreToWin <> invalid then props.score_to_win = m.top.scoreToWin
    end if
    Analytics_Track("game_start", props)
end sub

sub AnalyticsEventPipe_OnGameOver(m as object)
    props = {}
    if m.playerScore <> invalid then props.player_score = m.playerScore
    if m.cpuScore <> invalid then props.cpu_score = m.cpuScore
    if m.highScore <> invalid then props.high_score = m.highScore
    Analytics_Track("game_over", props)
end sub
```

- [ ] **Step 2: Smoke-compose against game_shell**

Tweak `/tmp/compose-smoke.mjs` to use `template: 'game_shell'` and re-run. Verify the generated channel includes `AnalyticsEventPipe_OnGameStart` / `OnGameOver` calls in `Modules_OnGameSceneAfterGameStart` / `Over`.

- [ ] **Step 3: Run full brs-gen test suite + build**

Run: `pnpm --filter @rokudev/brs-gen test -- --run && pnpm --filter @rokudev/brs-gen build`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/modules/analytics.event_pipe/files/source/_modules/analytics_event_pipe/Hooks.bs
git commit -m "feat(brs-gen): implement analytics.event_pipe Hooks.bs

Four hook handlers: screen_view (generic), content_start (PlayerScene
ContentNode reader), game_start (game_shell m.top fields),
game_over (game_shell scoreboard fields). Each emits via
Analytics_Track."
```

---

### Task 15: Implement ConsoleSink.bs + HttpSink.bs

**Files:**
- Modify: `.../sinks/ConsoleSink.bs`
- Modify: `.../sinks/HttpSink.bs`

**Context:** ConsoleSink: one `print` per event with `[Analytics] name=<name> props=<json>` format matched by the T27 grep in §12.4. HttpSink: roUrlTransfer.AsyncPostFromString with 5s timeout, JSON body wrapping the batch array.

- [ ] **Step 1: Author ConsoleSink.bs**

```brightscript
' ConsoleSink.bs - prints each event to BrightScript debug output.
' T27 driver greps for "[Analytics] " lines (spec section 12.4).

function ConsoleSink_handler(events as object) as boolean
    for each ev in events
        line = "[Analytics] name=" + ev.name + " props=" + FormatJson(ev.props)
        print line
    end for
    return true
end function
```

- [ ] **Step 2: Author HttpSink.bs**

```brightscript
' HttpSink.bs - batched HTTPS POST via roUrlTransfer.AsyncPostFromString.

function HttpSink_handler(events as object) as boolean
    node = m.global.findNode("AnalyticsEventPipe")
    if node = invalid then return false
    cfg = node.config
    if cfg.http_endpoint = "" then return false
    body = FormatJson({ events: events })
    port = CreateObject("roMessagePort")
    xfer = CreateObject("roUrlTransfer")
    xfer.SetUrl(cfg.http_endpoint)
    xfer.AddHeader("Content-Type", "application/json")
    if cfg.http_app_key <> "" then xfer.AddHeader("X-App-Key", cfg.http_app_key)
    xfer.SetMessagePort(port)
    if NOT xfer.AsyncPostFromString(body) then
        print "[HttpSink] async_post_returned_false"
        return false
    end if
    msg = port.WaitMessage(ANALYTICS_SINK_HTTP_TIMEOUT_S * 1000)
    if msg = invalid then
        xfer.AsyncCancel()
        print "[HttpSink] timeout url=" + cfg.http_endpoint
        return false
    end if
    code = msg.GetResponseCode()
    print "[HttpSink] POST " + cfg.http_endpoint + " -> " + code.toStr()
    if code >= 200 and code < 300 then return true
    return false
end function
```

- [ ] **Step 3: Smoke-compose against blank_scenegraph (HTTP endpoint configured)**

Update `/tmp/compose-smoke.mjs` to include:
```javascript
modules: [{ id: 'analytics.event_pipe', config: { http_endpoint: 'https://example.com/v1/events' } }],
```
Re-run. Verify `HttpSink.brs` lands in compiled output.

- [ ] **Step 4: Run full brs-gen test suite + build**

Run: `pnpm --filter @rokudev/brs-gen test -- --run && pnpm --filter @rokudev/brs-gen build`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/modules/analytics.event_pipe/files/source/_modules/analytics_event_pipe/sinks/
git commit -m "feat(brs-gen): implement analytics.event_pipe ConsoleSink + HttpSink

ConsoleSink prints '[Analytics] name=... props={...}' per event
(grep target for T27). HttpSink async-POSTs JSON {events:[...]} batch
with 5s timeout; X-App-Key header when configured; status<300 = success."
```

---

## Phase 5: Composition matrix + golden + regen integration (Tasks 16-18)

### Task 16: e2e composition matrix for 6 templates

**Files:**
- Test: `packages/brs-gen/tests/e2e/analytics-event-pipe.test.ts` (new)
- Snapshots: `packages/brs-gen/tests/__snapshots__/analytics_event_pipe/<file>.brs.snap.txt` (auto-created on first run)

**Context:** Compose each of 6 templates with `analytics.event_pipe` and snapshot the generated `source/_modules/__init_hooks.brs`. The snapshot proves the right optional hooks matched per template. Pattern precedent: `packages/brs-gen/tests/e2e/<existing>.test.ts` for template composition.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/brs-gen/tests/e2e/analytics-event-pipe.test.ts
import { describe, it, expect } from 'vitest';
import { generateAppForRegen } from '../../scripts/regen-helper.mjs';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEMPLATES = [
  { id: 'video_grid_channel', expects: ['MainScene'] },
  { id: 'news_channel',       expects: ['MainScene', 'CategoryGridScene'] },
  { id: 'music_player',       expects: ['MainScene', 'NowPlayingScene'] },
  { id: 'game_shell',         expects: ['GameScene'] },
  { id: 'screensaver',        expects: ['Screensaver'] },
  { id: 'blank_scenegraph',   expects: ['MainScene'] },
];

async function compose(templateId: string) {
  const outDir = mkdtempSync(join(tmpdir(), 'analytics-' + templateId + '-'));
  const specPath = join(outDir, 'spec.json');
  writeFileSync(specPath, JSON.stringify({
    spec_version: 2,
    template: templateId,
    modules: [{ id: 'analytics.event_pipe' }],
    app: { name: 'A ' + templateId, major_version: 0, minor_version: 1, build_version: 0 },
  }));
  await generateAppForRegen({ outputDir: outDir, spec: specPath, outputZip: join(outDir, 'out.zip') });
  return readFileSync(join(outDir, 'source/_modules/__init_hooks.brs'), 'utf8');
}

describe('analytics.event_pipe composition matrix', () => {
  for (const t of TEMPLATES) {
    it('composes with ' + t.id + ' and emits expected screen_view init calls', async () => {
      const src = await compose(t.id);
      for (const scope of t.expects) {
        expect(src).toContain('AnalyticsEventPipe_OnScreenView(m, "' + scope + '")');
      }
    });
  }
  it('video_grid_channel + news_channel emit content_start at PlayerScene.before_play', async () => {
    for (const id of ['video_grid_channel', 'news_channel']) {
      const src = await compose(id);
      expect(src).toContain('AnalyticsEventPipe_OnContentStart(m)');
    }
  });
  it('game_shell emits game_start + game_over at GameScene hooks', async () => {
    const src = await compose('game_shell');
    expect(src).toContain('AnalyticsEventPipe_OnGameStart(m)');
    expect(src).toContain('AnalyticsEventPipe_OnGameOver(m)');
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @rokudev/brs-gen test tests/e2e/analytics-event-pipe.test.ts -- --run`
Expected: PASS (Tasks 1-15 already produce the right wiring).

- [ ] **Step 3: Add file-snapshot assertions for module BS files**

Append to the same test file:

```typescript
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = join(__dirname, '../__snapshots__/analytics_event_pipe');

describe('analytics.event_pipe BS file snapshots', () => {
  it('snapshots Dispatcher.brs', async () => {
    const src = await composeAndRead('blank_scenegraph', 'source/_modules/analytics_event_pipe/Dispatcher.brs');
    await expect(src).toMatchFileSnapshot(join(SNAP_DIR, 'Dispatcher.brs.snap.txt'));
  });
  it('snapshots Hooks.brs', async () => {
    const src = await composeAndRead('blank_scenegraph', 'source/_modules/analytics_event_pipe/Hooks.brs');
    await expect(src).toMatchFileSnapshot(join(SNAP_DIR, 'Hooks.brs.snap.txt'));
  });
  it('snapshots ConsoleSink.brs', async () => {
    const src = await composeAndRead('blank_scenegraph', 'source/_modules/analytics_event_pipe/sinks/ConsoleSink.brs');
    await expect(src).toMatchFileSnapshot(join(SNAP_DIR, 'ConsoleSink.brs.snap.txt'));
  });
  it('snapshots HttpSink.brs', async () => {
    const src = await composeAndRead('blank_scenegraph', 'source/_modules/analytics_event_pipe/sinks/HttpSink.brs');
    await expect(src).toMatchFileSnapshot(join(SNAP_DIR, 'HttpSink.brs.snap.txt'));
  });
});

async function composeAndRead(templateId: string, relPath: string): Promise<string> {
  const outDir = mkdtempSync(join(tmpdir(), 'snap-' + templateId + '-'));
  const specPath = join(outDir, 'spec.json');
  writeFileSync(specPath, JSON.stringify({
    spec_version: 2, template: templateId, modules: [{ id: 'analytics.event_pipe' }],
    app: { name: 'S', major_version: 0, minor_version: 1, build_version: 0 },
  }));
  await generateAppForRegen({ outputDir: outDir, spec: specPath, outputZip: join(outDir, 'out.zip') });
  return readFileSync(join(outDir, relPath), 'utf8');
}
```

- [ ] **Step 4: Run the test to create snapshots**

Run: `pnpm --filter @rokudev/brs-gen test tests/e2e/analytics-event-pipe.test.ts -- --run`
Expected: PASS. 4 new snapshot files created.

- [ ] **Step 5: Manually inspect the snapshots**

Read each of the 4 snapshot files. Confirm they match the BS source authored in Tasks 13-15 (modulo `.bs` → `.brs` extension rewrite by compile.ts). Any drift means the bsc compile sweep did something unexpected; investigate before locking.

- [ ] **Step 6: Run full brs-gen test suite + build**

Run: `pnpm --filter @rokudev/brs-gen test -- --run && pnpm --filter @rokudev/brs-gen build`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/tests/e2e/analytics-event-pipe.test.ts packages/brs-gen/tests/__snapshots__/analytics_event_pipe/
git commit -m "test(brs-gen): analytics.event_pipe composition matrix + BS snapshots

Six-template composition test asserts AnalyticsEventPipe_OnScreenView
calls match the spec section 9.2 wiring map. Four file-snapshot tests
lock the post-compile shape of Dispatcher/Hooks/ConsoleSink/HttpSink."
```

---

### Task 17: Canonical golden zip — news_channel + analytics.event_pipe

**Files:**
- Test: extend `packages/brs-gen/tests/e2e/analytics-event-pipe.test.ts`
- Golden: `packages/brs-gen/tests/__golden__/analytics-event-pipe-news.zip` (binary; produced by regen script)

**Context:** Pattern precedent: existing template goldens under `tests/__golden__/*.zip`. The golden zip locks byte-equality of the composed channel. yazl 2.5.x requires `TZ=UTC` for determinism.

- [ ] **Step 1: Write the failing byte-equality test**

Append to `tests/e2e/analytics-event-pipe.test.ts`:

```typescript
import { createHash } from 'node:crypto';

describe('analytics.event_pipe canonical golden', () => {
  const goldenPath = join(__dirname, '../__golden__/analytics-event-pipe-news.zip');
  it('news_channel + analytics.event_pipe byte-equal to golden zip', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'golden-'));
    const specPath = join(outDir, 'spec.json');
    writeFileSync(specPath, JSON.stringify({
      spec_version: 2,
      template: 'news_channel',
      modules: [{ id: 'analytics.event_pipe', config: {
        http_endpoint: 'https://analytics.example.com/v1/events',
        http_app_key: 'test_key',
        default_props: { environment: 'test', channel_name: 'news_demo' },
      }}],
      app: { name: 'AnalyticsGolden', major_version: 0, minor_version: 1, build_version: 0 },
    }));
    const zipPath = join(outDir, 'out.zip');
    await generateAppForRegen({ outputDir: outDir, spec: specPath, outputZip: zipPath });
    const actual = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
    const expected = createHash('sha256').update(readFileSync(goldenPath)).digest('hex');
    expect(actual).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (no golden yet)**

Run: `TZ=UTC pnpm --filter @rokudev/brs-gen test tests/e2e/analytics-event-pipe.test.ts -- --run`
Expected: FAIL — golden file doesn't exist.

- [ ] **Step 3: Generate the golden zip via the regen script (extension comes in Task 18)**

For now, produce the golden manually so this task is self-contained:

```bash
TZ=UTC node -e "
const { generateAppForRegen } = require('./packages/brs-gen/scripts/regen-helper.mjs');
const { mkdirSync, writeFileSync, copyFileSync } = require('node:fs');
const { join } = require('node:path');
const outDir = '/tmp/analytics-golden-news';
mkdirSync(outDir, { recursive: true });
const specPath = join(outDir, 'spec.json');
writeFileSync(specPath, JSON.stringify({
  spec_version: 2,
  template: 'news_channel',
  modules: [{ id: 'analytics.event_pipe', config: {
    http_endpoint: 'https://analytics.example.com/v1/events',
    http_app_key: 'test_key',
    default_props: { environment: 'test', channel_name: 'news_demo' },
  }}],
  app: { name: 'AnalyticsGolden', major_version: 0, minor_version: 1, build_version: 0 },
}));
(async () => {
  await generateAppForRegen({ outputDir: outDir, spec: specPath, outputZip: join(outDir, 'out.zip') });
  copyFileSync(join(outDir, 'out.zip'), 'packages/brs-gen/tests/__golden__/analytics-event-pipe-news.zip');
  console.log('golden written');
})();
"
```

NB: this assumes the regen-helper exports the right function; if not, mirror the existing template golden-regen pattern in `packages/brs-gen/scripts/regen-golden.mjs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=UTC pnpm --filter @rokudev/brs-gen test tests/e2e/analytics-event-pipe.test.ts -- --run`
Expected: PASS.

- [ ] **Step 5: Verify .prettierignore covers the golden**

`grep '__golden__' .prettierignore` should show the directory. If not, add `packages/brs-gen/tests/__golden__/` to `.prettierignore`.

- [ ] **Step 6: Commit golden + extended test**

```bash
git add packages/brs-gen/tests/__golden__/analytics-event-pipe-news.zip packages/brs-gen/tests/e2e/analytics-event-pipe.test.ts
git commit -m "test(brs-gen): canonical golden zip news_channel + analytics.event_pipe

Byte-equality test under TZ=UTC. Golden produced via regen-helper
with deterministic AppSpec (config http_endpoint, app_key,
default_props). Locks composed-channel output shape."
```

---

### Task 18: Extend regen-golden.mjs to regenerate analytics goldens

**Files:**
- Modify: `packages/brs-gen/scripts/regen-golden.mjs`

**Context:** The script regenerates all golden artifacts in one TZ=UTC run. Existing pattern: each template has a `regenXxx` async function called from `main()`. Add `regenAnalyticsEventPipe` that writes the canonical golden zip. The stdout summary count should bump.

- [ ] **Step 1: Read the existing regen-golden.mjs**

Read the file end-to-end to understand the existing pattern. Note: `regenGameShell` from Plan 4f is the most recent precedent.

- [ ] **Step 2: Add `regenAnalyticsEventPipe`**

In `regen-golden.mjs`, add a new async function modeled on `regenGameShell`:

```javascript
async function regenAnalyticsEventPipe() {
  const outDir = path.join(os.tmpdir(), 'regen-analytics-' + Date.now());
  fs.mkdirSync(outDir, { recursive: true });
  const specPath = path.join(outDir, 'spec.json');
  fs.writeFileSync(specPath, JSON.stringify({
    spec_version: 2,
    template: 'news_channel',
    modules: [{ id: 'analytics.event_pipe', config: {
      http_endpoint: 'https://analytics.example.com/v1/events',
      http_app_key: 'test_key',
      default_props: { environment: 'test', channel_name: 'news_demo' },
    }}],
    app: { name: 'AnalyticsGolden', major_version: 0, minor_version: 1, build_version: 0 },
  }));
  const zipPath = path.join(outDir, 'out.zip');
  await generateAppForRegen({ outputDir: outDir, spec: specPath, outputZip: zipPath });
  const goldenPath = path.join(REPO_ROOT, 'packages/brs-gen/tests/__golden__/analytics-event-pipe-news.zip');
  fs.copyFileSync(zipPath, goldenPath);
  console.log('  - analytics-event-pipe-news.zip');
}
```

Call it from `main()` after the last existing `regenXxx`. Bump the stdout count message (e.g. "fourteen" → "fifteen", or whatever the current count is).

- [ ] **Step 3: Run the script end-to-end**

Run: `TZ=UTC pnpm --filter @rokudev/brs-gen exec node scripts/regen-golden.mjs`
Expected: all goldens regenerate; the analytics one matches the file written in Task 17 byte-for-byte (since both run TZ=UTC and use the same AppSpec). No git diff on `tests/__golden__/`.

- [ ] **Step 4: Run full brs-gen test suite + build**

Run: `pnpm --filter @rokudev/brs-gen test -- --run && pnpm --filter @rokudev/brs-gen build`
Expected: green. Golden byte-equality still holds.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/scripts/regen-golden.mjs
git commit -m "chore(brs-gen): extend regen-golden.mjs with analytics.event_pipe

regenAnalyticsEventPipe writes the canonical news+analytics golden zip.
Idempotent under TZ=UTC; produces byte-identical artifact to Task 17."
```

---

## Phase 6: T27 driver + on-device verification (Tasks 19-20)

### Task 19: Author `t27-analytics-event-pipe.mjs`

**Files:**
- Create: `packages/brs-gen/scripts/t27-analytics-event-pipe.mjs`

**Context:** Pattern precedent: `packages/brs-gen/scripts/t27-game-shell.mjs` from Plan 4f. Reuse helpers from `packages/brs-gen/scripts/_t27-lib.mjs` (specifically `sideloadAndLaunch`, `keypress`, `keypressRepeat`, `tailLog`, `screenshot`). The driver implements the procedure from spec §12.4 with T27-specific config (`batch_interval_ms: 1500`, `batch_max_events: 5`).

Important: the IPs in this driver are PLACEHOLDERS. Before Task 20 the implementer asks the user for the live IP if 10.128.160.39 is unreachable.

- [ ] **Step 1: Skim existing T27 helpers**

Read `packages/brs-gen/scripts/_t27-lib.mjs` end-to-end. Note the exact export names (e.g. `keypress` vs `ecpKeypress`). Trap: in Plan 4f the import names were `keypress` and `keypressRepeat`, NOT `ecp*` — verify before authoring imports.

- [ ] **Step 2: Author the driver**

Create `packages/brs-gen/scripts/t27-analytics-event-pipe.mjs`:

```javascript
#!/usr/bin/env node
// T27 driver for analytics.event_pipe. Spec section 12.4.
import { generateAppForRegen } from './regen-helper.mjs';
import { sideloadAndLaunch, keypress, keypressRepeat, tailLog } from './_t27-lib.mjs';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEVICE_IP = process.env.ROKUDEV_DEFAULT_ROKU_HOST || '10.128.160.39';
const DEV_PASSWORD = process.env.ROKUDEV_ROKU_DEV_PASSWORD || '1234';

const T27_CONFIG = {
  http_endpoint: '',
  http_app_key: '',
  console_sink: true,
  batch_interval_ms: 1500,
  batch_max_events: 5,
  default_props: { environment: 't27' },
};

const TEMPLATES = [
  {
    id: 'video_grid_channel',
    sequence: async (ip) => {
      await keypressRepeat(ip, 'Right', 2, 200);
      await keypress(ip, 'Select'); // enter Details
      await keypress(ip, 'Down');   // focus play button
      await keypress(ip, 'Select'); // play
    },
    expectedEvents: ['channel_start', 'screen_view', 'content_start'],
    expectedScreens: ['MainScene'],
  },
  {
    id: 'news_channel',
    sequence: async (ip) => {
      await keypress(ip, 'Right');  // category tile
      await keypress(ip, 'Select'); // enter CategoryGridScene
      await keypress(ip, 'Select'); // play
    },
    expectedEvents: ['channel_start', 'screen_view', 'screen_view', 'content_start'],
    expectedScreens: ['MainScene', 'CategoryGridScene'],
  },
  {
    id: 'music_player',
    sequence: async (ip) => {
      await keypress(ip, 'Right');
      await keypress(ip, 'Select');
    },
    expectedEvents: ['channel_start', 'screen_view', 'screen_view'],
    expectedScreens: ['MainScene', 'NowPlayingScene'],
  },
  {
    id: 'game_shell',
    sequence: async (ip) => {
      await keypress(ip, 'Select');
    },
    expectedEvents: ['channel_start', 'screen_view', 'game_start'],
    expectedScreens: ['GameScene'],
  },
];

function parseAnalyticsLines(logText) {
  const lines = logText.split('\n').filter((l) => l.includes('[Analytics] name='));
  return lines.map((l) => {
    const nameMatch = l.match(/name=([a-z0-9_]+)/);
    const propsMatch = l.match(/props=(\{.*\})$/);
    const name = nameMatch ? nameMatch[1] : '';
    let props = {};
    if (propsMatch) {
      try { props = JSON.parse(propsMatch[1]); } catch { /* ignore */ }
    }
    return { name, props };
  });
}

async function runOne(template) {
  const outDir = mkdtempSync(join(tmpdir(), 't27-analytics-' + template.id + '-'));
  const specPath = join(outDir, 'spec.json');
  writeFileSync(specPath, JSON.stringify({
    spec_version: 2,
    template: template.id,
    modules: [{ id: 'analytics.event_pipe', config: T27_CONFIG }],
    app: { name: 'T27 Analytics ' + template.id, major_version: 0, minor_version: 1, build_version: 0 },
  }));
  await generateAppForRegen({ outputDir: outDir, spec: specPath, outputZip: join(outDir, 'out.zip') });

  console.log(`\n=== ${template.id} ===`);
  await sideloadAndLaunch({ deviceIp: DEVICE_IP, devPassword: DEV_PASSWORD, zipPath: join(outDir, 'out.zip') });
  // Wait for initial mount + first flush tick
  await new Promise((r) => setTimeout(r, 2500));
  // Capture mount events
  let mountLog = await tailLog({ deviceIp: DEVICE_IP, seconds: 0.1 }); // peek
  // Send keypress sequence
  await template.sequence(DEVICE_IP);
  await new Promise((r) => setTimeout(r, 2000));
  // Capture all events
  const fullLog = await tailLog({ deviceIp: DEVICE_IP, seconds: 0.1 });
  const events = parseAnalyticsLines(fullLog);
  console.log(`[${template.id}] captured ${events.length} events:`, events.map((e) => e.name));

  // Assertions
  const failures = [];
  // 1. channel_start first
  if (events.length === 0 || events[0].name !== 'channel_start' || events[0].props.cold_start !== true) {
    failures.push(`expected first event channel_start cold_start=true; got ${events[0]?.name}`);
  }
  // 2. exactly one channel_start
  const csCount = events.filter((e) => e.name === 'channel_start').length;
  if (csCount !== 1) failures.push(`expected exactly 1 channel_start; got ${csCount}`);
  // 3. event sequence matches expected (multiset + order)
  const actualNames = events.map((e) => e.name);
  if (JSON.stringify(actualNames) !== JSON.stringify(template.expectedEvents)) {
    failures.push(`expected events [${template.expectedEvents.join(',')}]; got [${actualNames.join(',')}]`);
  }
  // 4. auto-props present
  for (const ev of events) {
    for (const k of ['channel_client_id', 'session_id', 'channel_version', 'roku_model', 'roku_fw', 'ts_epoch_ms']) {
      if (ev.props[k] === undefined) {
        failures.push(`event ${ev.name} missing auto-prop ${k}`);
      }
    }
  }
  return { template: template.id, pass: failures.length === 0, failures, events };
}

async function main() {
  const results = [];
  for (const t of TEMPLATES) {
    try {
      results.push(await runOne(t));
    } catch (e) {
      results.push({ template: t.id, pass: false, failures: [String(e)], events: [] });
    }
  }
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.template}${r.pass ? '' : ': ' + r.failures.join('; ')}`);
  }
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}
main();
```

- [ ] **Step 3: Make executable**

Run: `chmod +x packages/brs-gen/scripts/t27-analytics-event-pipe.mjs`

- [ ] **Step 4: Dry-run locally without device (syntax check)**

Run: `node --check packages/brs-gen/scripts/t27-analytics-event-pipe.mjs`
Expected: no syntax errors.

- [ ] **Step 5: Commit (driver only; no T27 run yet)**

```bash
git add packages/brs-gen/scripts/t27-analytics-event-pipe.mjs
git commit -m "feat(brs-gen): T27 driver for analytics.event_pipe

11-template-step driver per spec section 12.4. Composes each of 4
target templates with batch_interval_ms=1500 + batch_max_events=5;
sideloads; navigates per-template keypress sequence; tails BrightScript
log; greps [Analytics] lines; asserts channel_start first + auto-props
present + event sequence matches spec section 12.4.2."
```

---

### Task 20: Run T27 on-device and write evidence

**Files:**
- Create: `docs/t27-evidence/<YYYY-MM-DD>-analytics-event-pipe.md`

**Context:** Execute the driver against the live Roku Native 2910X. If 4/4 templates PASS, write the evidence file. If any FAIL, debug iteratively (look for missing auto-props, wrong event order, log-grep regex issues) and re-run.

- [ ] **Step 1: Confirm device IP**

If the user already provided an IP this session, use it. Otherwise ask:

```
The T27 device is expected at ROKUDEV_DEFAULT_ROKU_HOST (default 10.128.160.39).
Please confirm the device IP for this run, or paste a new one.
```

- [ ] **Step 2: Verify device reachable**

```bash
curl -s -m 5 http://${DEVICE_IP}:8060/query/device-info | head -1
```
Expected: XML response. If timeout or empty: ask user for current IP.

- [ ] **Step 3: Run the T27 driver**

```bash
TZ=UTC ROKUDEV_DEFAULT_ROKU_HOST=<ip> node packages/brs-gen/scripts/t27-analytics-event-pipe.mjs
```
Expected: SUMMARY block with `PASS` for all 4 templates.

- [ ] **Step 4: If any FAIL, iterate**

Plan 4d-style stale-state recovery if sideload errors:
```bash
curl --digest -u rokudev:1234 -X POST -F "mysubmit=Delete" -F "archive=" http://${DEVICE_IP}/plugin_install
```
Common failure modes (debug systematically):
- Event count off-by-one: timing — bump the 2000ms post-keypress wait to 2500ms.
- channel_start not first: dispatcher coldStartFired logic bug; revisit Task 13.
- ConsoleSink lines truncated by Roku log: check `print` calls don't exceed 2000 chars (split if needed in Task 15).
- Empty events buffer: flush timer never fired — verify T27_CONFIG.batch_interval_ms threading through ModuleConfig_analytics_event_pipe() codegen.

- [ ] **Step 5: Write evidence file when all 4 templates PASS**

Use the actual run date. File path: `docs/t27-evidence/<YYYY-MM-DD>-analytics-event-pipe.md`. Template (mirror plan-4f's evidence shape):

```markdown
# Plan 5 T27 Evidence (analytics.event_pipe)

**Date:** YYYY-MM-DD
**Device:** Roku Native, model 2910X, firmware 15.2.4
**Device IP:** <ip>
**Dev password:** 1234 (default)
**T27 driver commit:** <sha>

## Summary

T27 verification status: **PASS** (4/4 templates).

| # | Template | Outcome | Events captured |
|---|---|---|---|
| 1 | video_grid_channel | PASS | channel_start, screen_view(MainScene), content_start(video) |
| 2 | news_channel | PASS | channel_start, screen_view(MainScene), screen_view(CategoryGridScene), content_start(video) |
| 3 | music_player | PASS | channel_start, screen_view(MainScene), screen_view(NowPlayingScene) |
| 4 | game_shell | PASS | channel_start, screen_view(GameScene), game_start |

(Append any debugging notes, recovery steps, surprises discovered during the run.)

## Auto-props verification

Confirmed present on EVERY captured event for all 4 templates:
channel_client_id, session_id, channel_version, roku_model, roku_fw, ts_epoch_ms.

RIDA: present (device IsRIDADisabled()=false) / omitted (=true) — circle whichever applies.

## Conclusion

analytics.event_pipe v0.1.0 composed with v1 channel templates emits
the spec-mandated Roku-conventional event vocabulary via the optional
init-call wiring extension. All auto-props attached. Channel-store
privacy posture (RIDA opt-out honored) consistent with spec section 10.3.
```

- [ ] **Step 6: Commit evidence**

```bash
git add docs/t27-evidence/<YYYY-MM-DD>-analytics-event-pipe.md
git commit -m "test(plan-5): T27 evidence analytics.event_pipe PASS 4/4

On-device verification against Roku Native 2910X firmware 15.2.4.
All 4 navigable templates emit channel_start (cold_start=true) +
expected event sequence per spec section 12.4.2 with auto-props
present. ConsoleSink + log-tail strategy validated."
```

---

## Phase 7: Release (Tasks 21-23)

### Task 21: Version bump v0.5.6 → v0.6.0 + regen all goldens

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/brs-gen/package.json`
- Modify: `packages/roku-device-client/package.json` (only if cross-package version match is enforced)
- Modify: `packages/rokudev-device/package.json` (same)
- Regen: ALL files under `packages/brs-gen/tests/__golden__/`
- Regen: ALL files under `packages/brs-gen/tests/__snapshots__/` that embed `BRS_GEN_VERSION`

**Context:** `BRS_GEN_VERSION` is embedded in provenance JSON inside every generated channel. Bumping the version invalidates every golden zip. Pattern precedent: Plan 4f's v0.5.5 → v0.5.6 release commit (see git log for the exact shape).

- [ ] **Step 1: Verify cross-package version sync policy**

`grep -r 'rokudev-tools' --include=package.json` and check the existing version-compat-check test (search `tests/version-compat*` or similar). Confirm whether all packages bump in lockstep.

- [ ] **Step 2: Bump versions**

In each affected `package.json`, change `"version": "0.5.6"` to `"version": "0.6.0"`.

- [ ] **Step 3: Regen all goldens under TZ=UTC**

Run: `TZ=UTC pnpm --filter @rokudev/brs-gen exec node scripts/regen-golden.mjs`
Expected: every golden zip and version-embedded snapshot regenerated. `git status` shows churn across many files in `tests/__golden__/` and `tests/__snapshots__/`.

- [ ] **Step 4: Run full test suite + build to confirm everything still passes**

Run: `TZ=UTC pnpm -r test -- --run && pnpm -r build`
Expected: all green. Total test count: previous (≈917) + ~24 new (catalog opt, merger opt, dispatcher 6, sinks 5, identity 4, privacy 5, flush 5, const-parity 4, e2e 8, golden 1) = ~941.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/*/package.json packages/brs-gen/tests/__golden__/ packages/brs-gen/tests/__snapshots__/
git commit -m "chore(release): bump rokudev-tools to 0.6.0 (Plan 5 analytics.event_pipe)

- First v1 feature module: analytics.event_pipe
- Engine: additive module_wiring.optional_init_calls
- Tests: 24 new (catalog/merger/dispatcher/sinks/privacy/identity/flush/const-parity/e2e/golden)
- Regen all goldens + snapshots that embed BRS_GEN_VERSION
- v1 catalog: 6 of 6 templates + 1 of 10 modules"
```

---

### Task 22: README release notes + MEMORY topic file

**Files:**
- Modify: `README.md` (append v0.6.0 release-notes section in chronological order)
- Create: `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/plan-5-analytics-event-pipe.md`
- Modify: `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md` (add plan-5 to status list + Topic files; append any new latent traps discovered)

**Context:** Chronological order means APPEND at the end of the release-notes section, NOT prepend. Pattern precedent: README.md's v0.5.6 section added at end during Plan 4f.

- [ ] **Step 1: Read existing README.md release-notes section**

Skim the file. Find the last release-notes entry (v0.5.6 Plan 4f). Note its shape.

- [ ] **Step 2: Append v0.6.0 release notes**

After the v0.5.6 section, add:

```markdown
## v0.6.0 — Plan 5: analytics.event_pipe (first feature module)

First v1 feature module + foundational engine extension.

**New: analytics.event_pipe module**

- `Analytics_Track(name, props)` / `Analytics_AddSink(handlerName)` / `Analytics_RemoveSink(handle)` / `Analytics_Flush()` / `Analytics_SetIdentity(props)` BrightScript API
- Auto-emits Roku-conventional standard events from template hooks: `channel_start`, `screen_view`, `content_start`, plus `game_start`/`game_over` for game_shell
- 2 bundled sinks: `ConsoleSink_handler` (always) and `HttpSink_handler` (when http_endpoint configured)
- Batched flush (default 10s timer + 50-event threshold; T27 fixtures override to 1.5s/5 events)
- Honors `roDeviceInfo.IsRIDADisabled()`; always sends `GetChannelClientId()`
- Composes with all 6 v1 templates via new `optional_init_calls` wiring

**Engine: `module_wiring.optional_init_calls`**

- Additive schema field; existing modules unchanged
- Validator allows missing template hook (silently skipped); rejects malformed `scope.phase` strings
- Emitter places matched optional calls after strict `init_calls` within each hook

**T27 evidence:** 4/4 navigable templates PASS on Roku Native 2910X firmware 15.2.4.

**v1 status:** templates 6/6 (catalog COMPLETE since v0.5.6); feature modules 1/10.
```

- [ ] **Step 3: Create MEMORY topic file `plan-5-analytics-event-pipe.md`**

Mirror plan-4f-game-shell.md's shape. Capture:
- Spec/plan paths
- Engine extension shape (optional_init_calls)
- 7 brainstorming decisions (Q1-Q7)
- Wiring map per template
- Two known-debug nuggets if discovered: any new latent trap from BS implementation, T27 timing observations
- Outstanding polish items for v1.x (e.g. music_player NowPlayingScene.before_play hook)

- [ ] **Step 4: Update MEMORY.md**

Append to the Status block:
```
- Plan 5 COMPLETE YYYY-MM-DD v0.6.0 (~941 tests). analytics.event_pipe + optional_init_calls engine extension. See plan-5-analytics-event-pipe.md
```

Update the work-order block to mark module 1 of 10 shipped:
```
1. **Real feature modules (10)** - 1 of 10 SHIPPED 2026-MM-DD: analytics.event_pipe.
   - REMAINING: monetization.roku_pay.{subscription,transactional}, ads.raf_{csai,ssai}, auth.{device_link_code,oauth_device_grant,roku_os_signin}, deep_link.global, accessibility.captions
```

Append to "Topic files":
```
- `plan-5-analytics-event-pipe.md`: Plan 5 analytics.event_pipe module + optional_init_calls engine extension (v0.6.0) details + lessons
```

If any new latent traps discovered during implementation (e.g. SceneGraph node field types, FormatJson roundtrip nuances), add to the "Latent traps" section.

- [ ] **Step 5: Commit README + MEMORY**

```bash
git add README.md
git commit -m "docs: v0.6.0 release notes (Plan 5 analytics.event_pipe)"
```

(MEMORY changes are user-scoped, not committed to the repo. They're saved separately via the memory file edits.)

---

### Task 23: Tag + push to origin (REQUIRES USER CONFIRMATION)

**Files:** none (git ops only)

**Context:** Per project invariant: do NOT push without explicit user "yes". Confirm-before-push gate. Tagging precedent: `v0.5.6` tag for Plan 4f.

- [ ] **Step 1: Confirm working tree is clean**

```bash
git status
```
Expected: "nothing to commit, working tree clean".

- [ ] **Step 2: Show summary of changes since v0.5.6**

```bash
git log --oneline v0.5.6..HEAD
```
Expected: ~23 commits matching Tasks 1-22.

- [ ] **Step 3: Ask user for push confirmation via AskUserQuestion**

Ask: "Plan 5 is fully implemented and tested (4/4 T27 PASS on Roku Native 2910X). Working tree clean. Ready to tag v0.6.0 and push to origin. Confirm?"

Options:
- (a) Yes, tag and push (Recommended)
- (b) Hold push; let me inspect first
- (c) Push main only; defer tag

If (b) or (c), pause and wait for further direction.

- [ ] **Step 4: Tag and push (only if user picked (a))**

```bash
git tag -a v0.6.0 -m "v0.6.0: Plan 5 analytics.event_pipe (first feature module)"
git push origin main
git push origin v0.6.0
```

- [ ] **Step 5: Verify on origin**

```bash
git ls-remote --tags origin | grep v0.6.0
```
Expected: tag SHA visible.

- [ ] **Step 6: Report completion**

Summarize: spec, plan, all commits, T27 result, version, test count, links. Mark Plan 5 COMPLETE.

---

## Plan completion criteria

Plan 5 ships when ALL of these hold:

- [ ] All 23 tasks above completed with their commits.
- [ ] `pnpm -r test -- --run` green across all packages (target ~941 tests).
- [ ] `pnpm -r build` clean.
- [ ] T27 driver reports 4/4 PASS on a real Roku Native 2910X.
- [ ] T27 evidence file committed under `docs/t27-evidence/`.
- [ ] README v0.6.0 release notes appended in chronological order.
- [ ] MEMORY status line + topic file updated.
- [ ] `v0.6.0` tag published to origin (only after explicit user push approval).
- [ ] No `dev_password` or `http_app_key` strings leaked in any log, commit message, or test artifact.

---

## Notes for the implementer

- **TDD discipline:** Every TS test in Phase 3 follows red-green-refactor. Do not skip writing the failing test first.
- **BrightScript hand-authoring:** Phase 4 cannot strictly TDD because there's no BS unit-test runner in this pipeline. The const-parity test (Task 12) is the TDD gate; snapshot tests (Task 16) lock the post-compile shape.
- **Snapshot inspection:** When `toMatchFileSnapshot` creates a new snapshot, READ it before locking the test. A wrong snapshot becomes a permanent regression target.
- **Determinism:** Every `pnpm test` AND every regen-golden run MUST be under `TZ=UTC` for yazl byte-equality. CI is already set up for this; local dev should match.
- **Commit cadence:** Each task ends with one commit. Do NOT batch multiple tasks into a single commit; the per-task atomicity is the basis for subagent-driven-development review.
- **Subagent dispatch:** When using superpowers:subagent-driven-development, provide each implementer subagent with: (1) this plan's full task text, (2) the spec section(s) referenced, (3) the relevant precedent file (pong-helpers.ts for the TS shim pattern, t27-game-shell.mjs for the T27 driver pattern), (4) the latent traps from MEMORY.md that apply.
- **Worktree:** Brainstorming skill notes that planning should happen in a dedicated worktree. This plan was authored on main (consistent with Plan 4f's precedent). If you prefer worktree isolation for execution, create one at the start of Task 1 via `EnterWorktree`.
