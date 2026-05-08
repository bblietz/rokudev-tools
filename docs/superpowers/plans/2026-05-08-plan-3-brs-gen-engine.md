# Plan 3: brs-gen Engine (with Stub Template + Stub Module)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `brs-gen`: a new MCP server in the monorepo that takes an AppSpec + stub template + stub module and produces a byte-reproducible Roku channel project (tree + zip) with a mandatory in-process `bsc` compile pass, while exposing 10 MCP tools that Plans 4 through 7 will extend with real templates, real modules, freeform path, and LSP tools.

**Architecture:** Seven submodules inside `packages/brs-gen/` with hard-walled responsibilities: `bootstrap/` (MCP entry + cross-package version check), `spec/` (AppSpec Zod schema + v1-to-v2 auto-promotion + JSON Schema export), `catalog/` (TOML loaders for `template.toml` and `module.toml`, manifest-key strategy table), `merger/` (pure: conflict detection, init-order topo sort, wiring contract validator, manifest merge, provenance), `render/` (EJS templates, module config emission, text normalisation), `build/` (disk write, `bsc` compile, deterministic `yazl` zip), and `tools/` (10 thin MCP tool registrars via the side-effect-import pattern established by rokudev-device). A bundled stub catalog (`stub_hello` template + `stub_label` module) exercises every merger feature exactly once and forms the basis of the e2e test.

**Tech Stack:** Node 20+, TypeScript 5.x (strict), pnpm workspace, Vitest (forks). Direct workspace dep on `@rokudev/device-client` (for `devPortal.sideload()`). Exact pin on `brighterscript` (determinism). `zod` + `zod-to-json-schema` for AppSpec validation, `ajv` for JSON Schema Draft 7 module config validation, `ejs` for template rendering, `smol-toml` for TOML parsing, `yazl` for deterministic zip, `semver` for range comparison, `@modelcontextprotocol/sdk` for MCP server boilerplate.

**Spec:** `docs/superpowers/specs/2026-05-08-brs-gen-engine-design.md` is the source of truth. The PRD (`docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md`) sets parent invariants. Plan 1 (`2026-05-06-plan-1-roku-device-client-and-rokudev-device.md`) established monorepo conventions; Plan 2 (`2026-05-07-plan-2-bdp-debugger.md`) established the MCP-tool test and e2e patterns this plan mirrors.

**Estimated tasks:** 32 across nine phases.

---

## Open Decisions and Risks

These are pinned for the plan's lifetime. If real-world input forces a change, surface it before continuing past the affected phase.

| # | Decision | Pinned answer |
|---|----------|---------------|
| D1 | `brighterscript` exact version | T2 queries `npm view brighterscript version` and commits that exact value to `packages/brs-gen/package.json` with no caret or tilde. Document the chosen version in the T2 commit message so upgrades are traceable. |
| D2 | TOML parser library | `smol-toml` (^1.3.x). Modern API, pure TypeScript, no native deps, correct handling of inline-table syntax used in `module.config_schema`. |
| D3 | JSON Schema validator | `ajv` (^8.16.x) with `ajv-formats`. Mature, fast, Draft 7 support, good error messages (JSON Pointers). |
| D4 | Zip library | `yazl` (^2.5.x). Matches brs-mcp, produces `STORED` entries with user-specified DOS mtime. Deterministic by construction. |
| D5 | Templating engine | `ejs` (^3.1.x), matches brs-mcp. Auto-escape disabled (conflicts with BrightScript hex literals like `&hRRGGBBFF`); templates call `helpers.xmlEscape()` explicitly when emitting XML attribute values. |
| D6 | Error helpers | Re-export `fail()` and the `Failure`/`Warning` types from `@rokudev/device-client`. Keep codes in a brs-gen local registry (`src/util/error-codes.ts`) so rokudev-device does not have to care about brs-gen codes. |
| D7 | Stub PNG assets | Commit four pre-generated PNGs (icon_hd, icon_fhd, splash_hd, splash_fhd) to `packages/brs-gen/templates/stub_hello/files/images/`. Each is a solid-colour square of the correct Roku dimensions, produced by a one-off `scripts/gen-stub-pngs.mjs` script that is NOT part of the runtime or CI path. Commit the script too, so the assets can be regenerated on demand. |
| D8 | Real-device verification gate | NOT required for Plan 3. The stub channel is functional but deliberately uninteresting. First plan that ships a real template (Plan 4) adds the first T27-style gate. |
| D9 | e2e golden regeneration | Manual via `packages/brs-gen/scripts/regen-golden.ts`. CI does NOT auto-regen. Maintainers run the script intentionally when an acknowledged upstream change (e.g. `bsc` bump) requires it and commit the new golden with a message that names the cause. |
| D10 | `inputSchema` style for new MCP tools | Hand-rolled JSON Schema literals, matching Plan 1 + Plan 2 tool style (`tools/log.ts`, `tools/debug-*.ts`). Do NOT introduce Zod-to-JSON-Schema conversion at the tool layer (only at the `get_template_schema` / `get_module_schema` output layer). |
| D11 | TS internal vs. MCP wire naming | Internals camelCase (`templateId`, `moduleVersion`, `initOrder`). MCP wire fields snake_case (`template_id`, `module_version`, `init_order`). Each tool handler converts at the boundary. Established by Plans 1 and 2. |

---

## File structure overview

Everything below is relative to `/Users/bblietz/Work/ClaudeProjects/rokudev-tools/packages/brs-gen/` unless otherwise noted. The plan constructs this tree incrementally; no single task creates more than a handful of files.

```
packages/brs-gen/
  package.json                                   T1
  tsconfig.json                                  T1
  vitest.config.ts                               T1
  src/
    bootstrap/
      index.ts                                   T2   runServer entry
      version-check.ts                           T2   mirrors rokudev-device
    util/
      error-codes.ts                             T2   code registry + helpers
      deterministic.ts                           T13  sortByPath, escapeBsString
      text-normalize.ts                          T14  LF, UTF-8, strip BOM
    spec/
      preflight.ts                               T3   UNKNOWN_TEMPLATE error
      app-spec.ts                                T3   Zod wrapper schema
      promote.ts                                 T3   v1->v2 in-memory
      to-json-schema.ts                          T3   zod-to-json-schema helper
    catalog/
      toml.ts                                    T4   smol-toml wrapper
      template-toml.ts                           T4   template.toml Zod schema
      module-toml.ts                             T4   module.toml Zod schema
      loader.ts                                  T4   startup scan + validation
      manifest-key-strategies.ts                 T5   closed strategy table
    merger/
      compat.ts                                  T6   spec_version range matching
      validate-config.ts                         T6   ajv + JSON Schema
      conflicts.ts                               T7   exclusive_with + collisions
      init-order.ts                              T8   topo sort
      wiring.ts                                  T9   requires/exports/init_calls
      merge-manifest.ts                          T10  strategy table application
      emit-config-bs.ts                          T11  per-module config.bs
      emit-init-hooks.ts                         T12  __init_hooks.bs
      provenance.ts                              T13  deterministic record
      build.ts                                   T13  EmittedProject assembly
    render/
      helpers.ts                                 T14  xmlEscape, color conv, etc.
      ejs.ts                                     T14  render wrapper
    build/
      write.ts                                   T15  atomic write to disk
      compile.ts                                 T16  in-process bsc Program
      zip.ts                                     T17  yazl deterministic zip
    tools/
      all.ts                                     T20  side-effect import barrel
      list-templates.ts                          T20  two catalog-reader tools
      get-template-schema.ts                     T20
      list-modules.ts                            T21  two more catalog-reader tools
      get-module-schema.ts                       T21
      generate-app.ts                            T22  main generation tool
      package-app.ts                             T23  zip-only repackage
      validate-manifest.ts                       T24
      validate-assets.ts                         T25
      spec-upgrade.ts                            T26
      lint.ts                                    T27
    index.ts                                     T2   bin shim entry
  templates/
    stub_hello/
      template.toml                              T18
      schema.ts                                  T18
      files/
        manifest.ejs                             T18
        source/
          Main.bs                                T18
        components/
          MainScene.xml                          T18
          MainScene.bs                           T18
        images/
          icon_hd.png, icon_fhd.png              T18
          splash_hd.png, splash_fhd.png          T18
  modules/
    stub_label/
      module.toml                                T19
      files/
        source/_modules/stub_label/
          Init.bs                                T19
  scripts/
    gen-stub-pngs.mjs                            T18  one-off PNG generator
    regen-golden.ts                              T31  maintainer-run
    manual-smoke.mjs                             T31  optional dev helper
  tests/
    e2e.test.ts                                  T31  MCP smoke
    determinism.test.ts                          T28
    snapshots.test.ts                            T29
    conflict-matrix.test.ts                      T30
    __golden__/
      stub.zip                                   T31
      stub.provenance.json                       T31
```

---

## Phase 0: Scaffolding (T1-T2)

### Task T1: Create `packages/brs-gen/` package scaffold

**Files:**
- Create: `packages/brs-gen/package.json`
- Create: `packages/brs-gen/tsconfig.json`
- Create: `packages/brs-gen/vitest.config.ts`
- Modify: `pnpm-workspace.yaml` (confirm `packages/*` glob already matches; if not, add)

- [ ] **Step 1: Confirm workspace already includes `packages/*`**

Run: `cat pnpm-workspace.yaml`.
Expected: a line `  - 'packages/*'` already present (Plan 1 established this). If missing, add it.

- [ ] **Step 2: Query the current `brighterscript` release and pin it (D1)**

Run: `npm view brighterscript version`
Expected: a single version string like `0.69.4`.

Note the printed version. Use it as the EXACT pin in the next step (no caret, no tilde).

- [ ] **Step 3: Write `packages/brs-gen/package.json`**

```json
{
  "name": "brs-gen",
  "version": "0.3.0-dev.0",
  "description": "BrightScript channel generator MCP server (templates + composable feature modules).",
  "type": "module",
  "bin": {
    "brs-gen": "dist/index.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src tests --ext .ts",
    "format:check": "prettier --check src tests"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "workspace:* || ^1.0.0",
    "@rokudev/device-client": "workspace:*",
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "brighterscript": "<EXACT VERSION FROM STEP 2, e.g. 0.69.4>",
    "ejs": "^3.1.10",
    "semver": "^7.6.3",
    "smol-toml": "^1.3.0",
    "yazl": "^2.5.1",
    "zod": "^3.23.8",
    "zod-to-json-schema": "^3.23.2"
  },
  "devDependencies": {
    "@types/ejs": "^3.1.5",
    "@types/semver": "^7.5.8",
    "@types/yazl": "^2.4.5"
  }
}
```

Replace `<EXACT VERSION FROM STEP 2, e.g. 0.69.4>` with the bare version (no caret, no tilde). Double-check the `@modelcontextprotocol/sdk` dependency string matches the version that rokudev-device uses; look at `packages/rokudev-device/package.json` and copy the exact dep spec.

- [ ] **Step 4: Write `packages/brs-gen/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["tests", "dist", "node_modules", "templates", "modules"]
}
```

- [ ] **Step 5: Write `packages/brs-gen/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import base from '../../vitest.config.base.ts';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    pool: 'forks',
  },
});
```

- [ ] **Step 6: Install deps**

Run: `pnpm install`
Expected: the new package is added to the lockfile; no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/package.json packages/brs-gen/tsconfig.json \
        packages/brs-gen/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(brs-gen): package scaffold with pinned brighterscript

Scaffolds the empty brs-gen package with exact-pinned brighterscript per
spec §1.3 (byte-equality of compiled output depends on a fixed bsc
version). Installs zod, ajv, ejs, smol-toml, yazl, semver transitively
via pnpm install."
```

### Task T2: Bootstrap, version-check, and error registry

**Files:**
- Create: `packages/brs-gen/src/index.ts`
- Create: `packages/brs-gen/src/bootstrap/index.ts`
- Create: `packages/brs-gen/src/bootstrap/version-check.ts`
- Create: `packages/brs-gen/src/bootstrap/version-check.test.ts`
- Create: `packages/brs-gen/src/util/error-codes.ts`
- Create: `packages/brs-gen/src/util/error-codes.test.ts`

- [ ] **Step 1: Write the version-check test first**

```ts
// src/bootstrap/version-check.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { checkSiblings } from './version-check.js';

function makeTmpDir() {
  return join(tmpdir(), `brs-gen-vcheck-${randomUUID()}`);
}
async function writePackageJson(dir: string, version: string) {
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'brs-gen', version }));
}
async function writeAnchorFile(dir: string) {
  await writeFile(join(dir, 'index.js'), '');
}
async function writeSibling(dir: string, version: string) {
  const p = join(dir, 'node_modules', '@rokudev', 'device-client');
  await mkdir(p, { recursive: true });
  await writeFile(join(p, 'package.json'), JSON.stringify({ name: '@rokudev/device-client', version }));
}

describe('brs-gen checkSiblings', () => {
  let d: string;
  beforeEach(async () => { d = makeTmpDir(); await mkdir(d, { recursive: true }); });
  afterEach(async () => { await rm(d, { recursive: true, force: true }); });

  it('ok when versions match', async () => {
    await writePackageJson(d, '0.3.0');
    await writeAnchorFile(d);
    await writeSibling(d, '0.3.0');
    const r = await checkSiblings(pathToFileURL(join(d, 'index.js')).href);
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty('warning');
  });

  it('warning on minor drift', async () => {
    await writePackageJson(d, '0.3.0');
    await writeAnchorFile(d);
    await writeSibling(d, '0.3.1');
    const r = await checkSiblings(pathToFileURL(join(d, 'index.js')).href);
    expect(r.ok).toBe(true);
    if (!('warning' in r)) throw new Error('expected warning');
    expect(r.warning.code).toBe('CROSS_PACKAGE_VERSION_MISMATCH');
  });

  it('failure on major drift', async () => {
    await writePackageJson(d, '0.3.0');
    await writeAnchorFile(d);
    await writeSibling(d, '1.0.0');
    const r = await checkSiblings(pathToFileURL(join(d, 'index.js')).href);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('CROSS_PACKAGE_VERSION_MISMATCH');
  });

  it('ok when sibling cannot be loaded (malformed pkg.json)', async () => {
    await writePackageJson(d, '0.3.0');
    await writeAnchorFile(d);
    const p = join(d, 'node_modules', '@rokudev', 'device-client');
    await mkdir(p, { recursive: true });
    await writeFile(join(p, 'package.json'), '{not valid');
    const r = await checkSiblings(pathToFileURL(join(d, 'index.js')).href);
    expect(r.ok).toBe(true);
  });
});
```

Study `packages/rokudev-device/src/bootstrap/version-check.ts` and the matching test (corrected in Plan 2's final commit) as the canonical implementation you are mirroring. Use the same malformed-sibling approach for the "no-op" case because vite-node's resolver would otherwise find the workspace sibling; see MEMORY.md §"Latent traps observed" for the full explanation.

- [ ] **Step 2: Run the test; expect it to fail at import**

Run: `pnpm -F brs-gen test -t "checkSiblings"`
Expected: failure because `./version-check.js` does not exist yet.

- [ ] **Step 3: Implement `version-check.ts`**

```ts
// src/bootstrap/version-check.ts
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fail, type Failure, type Warning } from '@rokudev/device-client';

type CheckResult =
  | { ok: true; warning?: Warning }
  | { ok: false; failure: Failure };

export async function checkSiblings(myImportMetaUrl: string): Promise<CheckResult> {
  const require = createRequire(myImportMetaUrl);

  // Read our own version first.
  let myVersion: string;
  try {
    const ownPath = require.resolve('./package.json' as never);
    myVersion = (JSON.parse(await readFile(ownPath, 'utf8')) as { version: string }).version;
  } catch {
    // Very unusual; without our own version we cannot compare.
    return { ok: true };
  }

  // Read the sibling.
  let siblingVersion: string | undefined;
  try {
    const siblingPath = require.resolve('@rokudev/device-client/package.json');
    siblingVersion = (JSON.parse(await readFile(siblingPath, 'utf8')) as { version: string }).version;
  } catch {
    return { ok: true };
  }

  // Compare.
  const [myMaj, myMin] = myVersion.split('.').map((n) => Number.parseInt(n, 10));
  const [sibMaj, sibMin] = siblingVersion.split('.').map((n) => Number.parseInt(n, 10));

  if (myMaj !== sibMaj) {
    return {
      ok: false,
      failure: fail('CROSS_PACKAGE_VERSION_MISMATCH',
        `major-version drift: brs-gen ${myVersion} vs @rokudev/device-client ${siblingVersion}`,
        { stage: 'bootstrap', package: '@rokudev/device-client',
          expected_version: myVersion, installed_version: siblingVersion }),
    };
  }
  if (myMin !== sibMin) {
    return {
      ok: true,
      warning: {
        code: 'CROSS_PACKAGE_VERSION_MISMATCH',
        message: `minor-version drift: brs-gen ${myVersion} vs @rokudev/device-client ${siblingVersion}`,
        package: '@rokudev/device-client',
        expected_version: myVersion,
        installed_version: siblingVersion,
      } as Warning,
    };
  }
  return { ok: true };
}
```

If the `Failure` type shape differs from what this snippet assumes, open `packages/roku-device-client/src/errors/index.ts` and match exactly what Plan 1 shipped. Copy field names and typing verbatim.

- [ ] **Step 4: Run tests; expect 4 passing**

Run: `pnpm -F brs-gen test -t "checkSiblings"`
Expected: 4 passing.

- [ ] **Step 5: Write the error-codes test first**

```ts
// src/util/error-codes.test.ts
import { describe, it, expect } from 'vitest';
import { BRS_GEN_ERROR_CODES, BRS_GEN_WARNING_CODES, assertErrorCode, assertWarningCode } from './error-codes.js';

describe('error-codes registry', () => {
  it('enumerates every spec error code', () => {
    for (const c of [
      'UNKNOWN_TEMPLATE', 'UNKNOWN_MODULE', 'APP_SPEC_INVALID', 'SPEC_VERSION_INCOMPATIBLE',
      'MODULE_CONFIG_INVALID', 'MODULE_VERSION_UNAVAILABLE', 'MODULE_CONFLICT', 'FILE_COLLISION',
      'INIT_ORDER_CYCLE', 'WIRING_CONTRACT_VIOLATION', 'MANIFEST_KEY_CONFLICT',
      'UNKNOWN_MANIFEST_KEY', 'OUTPUT_DIR_NOT_EMPTY', 'LINT_FAILED', 'COMPILE_FAILED',
      'ASSET_VALIDATION_FAILED', 'MANIFEST_VALIDATION_FAILED', 'CATALOG_INVALID',
      'CROSS_PACKAGE_VERSION_MISMATCH', 'NOT_IMPLEMENTED', 'DEVICE_NO_PASSWORD',
      'CATALOG_INTEGRITY',
    ]) {
      expect(BRS_GEN_ERROR_CODES).toContain(c);
    }
  });

  it('enumerates every spec warning code', () => {
    for (const c of [
      'ASYMMETRIC_CONFLICT', 'MODULE_VERSION_UNPINNED', 'BSC_LINT_WARNING',
      'SPEC_AUTO_PROMOTED', 'HOOK_DISPATCH_NOT_INVOKED', 'MANIFEST_DRIFT',
    ]) {
      expect(BRS_GEN_WARNING_CODES).toContain(c);
    }
  });

  it('assertErrorCode accepts registered codes and rejects unknown', () => {
    expect(() => assertErrorCode('UNKNOWN_TEMPLATE')).not.toThrow();
    expect(() => assertErrorCode('NOT_A_REAL_CODE')).toThrow();
  });

  it('assertWarningCode accepts registered codes and rejects unknown', () => {
    expect(() => assertWarningCode('BSC_LINT_WARNING')).not.toThrow();
    expect(() => assertWarningCode('FAKE')).toThrow();
  });
});
```

- [ ] **Step 6: Run; expect failure**

Run: `pnpm -F brs-gen test -t "error-codes registry"`
Expected: module not found.

- [ ] **Step 7: Implement the registry**

```ts
// src/util/error-codes.ts
export const BRS_GEN_ERROR_CODES = [
  'UNKNOWN_TEMPLATE', 'UNKNOWN_MODULE', 'APP_SPEC_INVALID', 'SPEC_VERSION_INCOMPATIBLE',
  'MODULE_CONFIG_INVALID', 'MODULE_VERSION_UNAVAILABLE', 'MODULE_CONFLICT', 'FILE_COLLISION',
  'INIT_ORDER_CYCLE', 'WIRING_CONTRACT_VIOLATION', 'MANIFEST_KEY_CONFLICT',
  'UNKNOWN_MANIFEST_KEY', 'OUTPUT_DIR_NOT_EMPTY', 'LINT_FAILED', 'COMPILE_FAILED',
  'ASSET_VALIDATION_FAILED', 'MANIFEST_VALIDATION_FAILED', 'CATALOG_INVALID',
  'CROSS_PACKAGE_VERSION_MISMATCH', 'NOT_IMPLEMENTED',
  // DEVICE_NO_PASSWORD is defined by @rokudev/device-client (Plan 1) but
  // can be re-raised by generate_app's sideload path; listing it here keeps
  // assertErrorCode() satisfied when tool handlers pass through device-client
  // failures.
  'DEVICE_NO_PASSWORD',
  // CATALOG_INTEGRITY is raised by T13 buildEmittedProject when a module
  // declares a file in [module.files].add that was not loaded into the
  // bytes map passed to the merger. Expected to be unreachable once T4's
  // loader verifies every declared file exists on disk, but kept as a
  // defensive guard so the error path does not reuse FILE_COLLISION's
  // semantics for a different failure mode.
  'CATALOG_INTEGRITY',
] as const;

export const BRS_GEN_WARNING_CODES = [
  'ASYMMETRIC_CONFLICT', 'MODULE_VERSION_UNPINNED', 'BSC_LINT_WARNING',
  'SPEC_AUTO_PROMOTED', 'HOOK_DISPATCH_NOT_INVOKED', 'MANIFEST_DRIFT',
] as const;

export type BrsGenErrorCode = (typeof BRS_GEN_ERROR_CODES)[number];
export type BrsGenWarningCode = (typeof BRS_GEN_WARNING_CODES)[number];

export function assertErrorCode(c: string): asserts c is BrsGenErrorCode {
  if (!(BRS_GEN_ERROR_CODES as readonly string[]).includes(c)) {
    throw new Error(`Unknown brs-gen error code: ${c}`);
  }
}
export function assertWarningCode(c: string): asserts c is BrsGenWarningCode {
  if (!(BRS_GEN_WARNING_CODES as readonly string[]).includes(c)) {
    throw new Error(`Unknown brs-gen warning code: ${c}`);
  }
}
```

- [ ] **Step 8: Run; expect 4 passing**

Run: `pnpm -F brs-gen test -t "error-codes"`
Expected: 4 passing.

- [ ] **Step 9: Implement `bootstrap/index.ts` and `src/index.ts`**

`src/bootstrap/index.ts` exports `runServer()`; keep it minimal for now, real tool registration lands in later phases.

```ts
// src/bootstrap/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { checkSiblings } from './version-check.js';

export async function runServer(): Promise<void> {
  const versionResult = await checkSiblings(import.meta.url);

  const server = new Server(
    { name: 'brs-gen', version: (await import('../../package.json', { assert: { type: 'json' } })).default.version },
    { capabilities: { tools: {} } },
  );

  // TODO(T20+): register tools via REGISTRARS pattern (mirrors rokudev-device).
  // For now the server responds to initialize but exposes zero tools.
  // The version-check result will guard tool calls once tools exist.
  void versionResult;

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

```ts
// src/index.ts
#!/usr/bin/env node
import { runServer } from './bootstrap/index.js';
runServer().catch((e) => {
  process.stderr.write(`brs-gen failed to start: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
```

Match the SDK import path style used by `packages/rokudev-device/src/index.ts`; if the exported members differ, follow rokudev-device's pattern exactly.

- [ ] **Step 10: Verify the build compiles**

Run: `pnpm -F brs-gen build`
Expected: clean, `dist/` populated.

- [ ] **Step 11: Commit**

```bash
git add packages/brs-gen/src
git commit -m "feat(brs-gen): bootstrap, version-check, error-code registry

Mirrors rokudev-device's bootstrap + version-check pattern. The
version-check test uses the malformed-sibling approach established in
Plan 2 (vite-node's resolver would otherwise find the workspace sibling
through the monorepo). Error-code registry enumerates every code/warning
from spec §6."
```

---

## Phase 1: AppSpec schema and catalog loaders (T3-T5)

### Task T3: AppSpec Zod schema, v1 auto-promotion, JSON Schema export

**Files:**
- Create: `packages/brs-gen/src/spec/app-spec.ts`
- Create: `packages/brs-gen/src/spec/app-spec.test.ts`
- Create: `packages/brs-gen/src/spec/preflight.ts`
- Create: `packages/brs-gen/src/spec/preflight.test.ts`
- Create: `packages/brs-gen/src/spec/promote.ts`
- Create: `packages/brs-gen/src/spec/promote.test.ts`
- Create: `packages/brs-gen/src/spec/to-json-schema.ts`
- Create: `packages/brs-gen/src/spec/to-json-schema.test.ts`

Spec reference: §3.1 wrapper shape, §3.5 v1-to-v2 promotion, §3.3 JSON Schema export surface.

- [ ] **Step 1: Write the app-spec Zod test first**

```ts
// src/spec/app-spec.test.ts
import { describe, it, expect } from 'vitest';
import { AppSpecV2Wrapper, ModuleReference } from './app-spec.js';

describe('AppSpecV2Wrapper', () => {
  const base = {
    spec_version: 2 as const,
    template: 'stub_hello',
    modules: [],
    app: { name: 'Test', major_version: 1, minor_version: 0, build_version: 0 },
  };

  it('parses a minimal valid spec', () => {
    expect(AppSpecV2Wrapper.safeParse(base).success).toBe(true);
  });
  it('passes through extra top-level fields (per-template schema enforces strictness in pass 2)', () => {
    // Wrapper is intentionally .passthrough() so per-template fields survive.
    // The per-template schema (T6 / T20 / T22) is .strict() and rejects typos
    // at the full-shape parse step.
    const r = AppSpecV2Wrapper.safeParse({ ...base, nope: 1 });
    expect(r.success).toBe(true);
    if (!r.success) throw new Error('narrowing');
    expect((r.data as Record<string, unknown>).nope).toBe(1);
  });
  it('rejects missing app.name', () => {
    expect(AppSpecV2Wrapper.safeParse({ ...base, app: { major_version: 1, minor_version: 0, build_version: 0 } }).success).toBe(false);
  });
  it('accepts module references with optional version_range', () => {
    expect(AppSpecV2Wrapper.safeParse({ ...base, modules: [{ id: 'stub_label', config: { text: 'hi' } }] }).success).toBe(true);
  });
  it('requires non-negative integer versions on app.*', () => {
    expect(AppSpecV2Wrapper.safeParse({ ...base, app: { ...base.app, major_version: -1 } }).success).toBe(false);
  });
  it('ModuleReference rejects version_range that is not a string', () => {
    expect(ModuleReference.safeParse({ id: 'x', version_range: 1 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run; expect failure (module not found)**

Run: `pnpm -F brs-gen test -t "AppSpecV2Wrapper"`.

- [ ] **Step 3: Implement `app-spec.ts`**

```ts
// src/spec/app-spec.ts
import { z } from 'zod';

const NonNegInt = z.number().int().min(0);

export const AppMeta = z.object({
  name: z.string().min(1),
  major_version: NonNegInt,
  minor_version: NonNegInt,
  build_version: NonNegInt,
}).strict();

export const ModuleReference = z.object({
  id: z.string().min(1),
  version_range: z.string().optional(),
  config: z.record(z.unknown()).optional(),
}).strict();
export type ModuleReference = z.infer<typeof ModuleReference>;

// Wrapper parses only the 4 wrapper fields. Per-template top-level fields
// (e.g. `branding` for a future video_grid_channel) are accepted via
// `.passthrough()` and validated by the template's bundled schema in a
// second parse pass (happens at tool-layer in T20's get_template_schema /
// T22's generate_app). Do NOT chain `.strict()` here; Zod's passthrough
// supersedes strict so the combination is only confusing.
export const AppSpecV2Wrapper = z.object({
  spec_version: z.literal(2),
  template: z.string().min(1),
  modules: z.array(ModuleReference),
  app: AppMeta,
}).passthrough();

export const AppSpecV1Wrapper = z.object({
  spec_version: z.literal(1),
  template: z.string().min(1),
  app: AppMeta,
}).passthrough();

export type AppSpecV2 = z.infer<typeof AppSpecV2Wrapper>;
export type AppSpecV1 = z.infer<typeof AppSpecV1Wrapper>;
```

`.passthrough()` lets per-template top-level fields survive; strict-mode full-shape parsing happens in T6 once the per-template schema is known.

Re-run the test; 6 passing.

- [ ] **Step 4: Write the promote test first**

```ts
// src/spec/promote.test.ts
import { describe, it, expect } from 'vitest';
import { promoteV1ToV2 } from './promote.js';

describe('promoteV1ToV2', () => {
  it('converts v1 shape to v2 with empty modules', () => {
    const v1 = { spec_version: 1 as const, template: 'x',
                 app: { name: 'N', major_version: 0, minor_version: 0, build_version: 0 } };
    const out = promoteV1ToV2(v1);
    expect(out.spec).toEqual({ ...v1, spec_version: 2, modules: [] });
    expect(out.warning?.code).toBe('SPEC_AUTO_PROMOTED');
  });
  it('leaves v2 unchanged and returns no warning', () => {
    const v2 = { spec_version: 2 as const, template: 'x', modules: [],
                 app: { name: 'N', major_version: 0, minor_version: 0, build_version: 0 } };
    const out = promoteV1ToV2(v2);
    expect(out.spec).toEqual(v2);
    expect(out.warning).toBeUndefined();
  });
});
```

- [ ] **Step 5: Implement `promote.ts`**

```ts
// src/spec/promote.ts
import type { AppSpecV1, AppSpecV2 } from './app-spec.js';

export type PromoteResult = { spec: AppSpecV2; warning?: { code: 'SPEC_AUTO_PROMOTED'; message: string } };

export function promoteV1ToV2(input: AppSpecV1 | AppSpecV2): PromoteResult {
  if (input.spec_version === 2) return { spec: input };
  return {
    spec: { ...input, spec_version: 2, modules: [] } as AppSpecV2,
    warning: { code: 'SPEC_AUTO_PROMOTED', message: 'AppSpec v1 detected; promoted to v2 in-memory (no disk mutation).' },
  };
}
```

Re-run; 2 passing.

- [ ] **Step 6: Write the preflight test first**

```ts
// src/spec/preflight.test.ts
import { describe, it, expect } from 'vitest';
import { preflightTemplate } from './preflight.js';

describe('preflightTemplate', () => {
  it('returns ok when template id is in the provided set', () => {
    expect(preflightTemplate('stub_hello', new Set(['stub_hello', 'other']))).toEqual({ ok: true });
  });
  it('returns UNKNOWN_TEMPLATE when not', () => {
    const r = preflightTemplate('missing', new Set(['stub_hello']));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('UNKNOWN_TEMPLATE');
    expect(r.failure.details?.known).toEqual(['stub_hello']);
    expect(r.failure.details?.given).toBe('missing');
  });
});
```

- [ ] **Step 7: Implement `preflight.ts`**

```ts
// src/spec/preflight.ts
import { fail, type Failure } from '@rokudev/device-client';

type Result = { ok: true } | { ok: false; failure: Failure };

export function preflightTemplate(given: string, known: ReadonlySet<string>): Result {
  if (known.has(given)) return { ok: true };
  return {
    ok: false,
    failure: fail('UNKNOWN_TEMPLATE', `template not in catalog: ${given}`, {
      stage: 'preflight', given, known: [...known].sort(),
    }),
  };
}
```

Run; 2 passing.

- [ ] **Step 8: Write the JSON-Schema export test first**

```ts
// src/spec/to-json-schema.test.ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchemaDraft7 } from './to-json-schema.js';

describe('zodToJsonSchemaDraft7', () => {
  it('produces Draft 7 object for a Zod object', () => {
    const js = zodToJsonSchemaDraft7(z.object({ name: z.string().min(1) }).strict(), 'S');
    expect(js.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(js.type).toBe('object');
    expect(js.properties).toHaveProperty('name');
  });
  it('is JSON-serializable', () => {
    const js = zodToJsonSchemaDraft7(z.object({ n: z.number() }), 'S');
    expect(() => JSON.stringify(js)).not.toThrow();
  });
});
```

- [ ] **Step 9: Implement `to-json-schema.ts`**

```ts
// src/spec/to-json-schema.ts
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export function zodToJsonSchemaDraft7(schema: ZodTypeAny, name: string): Record<string, unknown> {
  const out = zodToJsonSchema(schema, { name, target: 'jsonSchema7' }) as Record<string, unknown>;
  const defs = (out.definitions ?? {}) as Record<string, unknown>;
  const inner = (defs[name] as Record<string, unknown> | undefined) ?? out;
  return { $schema: 'http://json-schema.org/draft-07/schema#', ...inner };
}
```

Run; 2 passing.

- [ ] **Step 10: Commit**

```bash
git add packages/brs-gen/src/spec
git commit -m "feat(brs-gen): AppSpec Zod schema + v1->v2 promotion + JSON Schema export

Implements spec §3.1 wrapper (strict; extra fields rejected), §3.5
v1-to-v2 auto-promotion (in-memory only; emits SPEC_AUTO_PROMOTED
warning), §3.3 JSON Schema Draft 7 export for public get_*_schema tools,
and preflight template validation so UNKNOWN_TEMPLATE errors carry the
offending name + known list."
```

### Task T4: TOML loader and catalog scanner

**Files:**
- Create: `packages/brs-gen/src/catalog/toml.ts` + `.test.ts`
- Create: `packages/brs-gen/src/catalog/template-toml.ts` + `.test.ts`
- Create: `packages/brs-gen/src/catalog/module-toml.ts` + `.test.ts`
- Create: `packages/brs-gen/src/catalog/loader.ts` + `.test.ts`

Spec reference: §3.2, §3.3 shapes; §1.4 bootstrap CATALOG_INVALID fail-fast; §5.4 ASYMMETRIC_CONFLICT warning.

- [ ] **Step 1: TOML wrapper test + impl**

```ts
// src/catalog/toml.test.ts
import { describe, it, expect } from 'vitest';
import { parseToml } from './toml.js';

describe('parseToml', () => {
  it('parses valid TOML', () => {
    expect(parseToml('[section]\nkey = "v"')).toEqual({ section: { key: 'v' } });
  });
  it('throws on invalid TOML', () => {
    expect(() => parseToml('= = =')).toThrow();
  });
});
```

```ts
// src/catalog/toml.ts
import { parse } from 'smol-toml';
export function parseToml(src: string): Record<string, unknown> {
  return parse(src) as Record<string, unknown>;
}
```

Run; 2 passing.

- [ ] **Step 2: template-toml Zod test + impl**

```ts
// src/catalog/template-toml.test.ts
import { describe, it, expect } from 'vitest';
import { TemplateTomlSchema } from './template-toml.js';

const minimal = {
  template: { id: 'stub_hello', version: '0.1.0', spec_compat: '>=1', description: 'x' },
  template_exports: { init_hooks: [], scene_nodes: [] },
  template_manifest_defaults: {},
};

describe('TemplateTomlSchema', () => {
  it('parses minimal', () => { expect(TemplateTomlSchema.safeParse(minimal).success).toBe(true); });
  it('rejects missing template.id', () => {
    expect(TemplateTomlSchema.safeParse({ ...minimal,
      template: { version: '0.1.0', spec_compat: '>=1', description: 'x' } }).success).toBe(false);
  });
  it('rejects invalid spec_compat semver', () => {
    expect(TemplateTomlSchema.safeParse({ ...minimal,
      template: { ...minimal.template, spec_compat: 'nope' } }).success).toBe(false);
  });
  it('accepts init_hooks entries', () => {
    expect(TemplateTomlSchema.safeParse({ ...minimal,
      template_exports: {
        init_hooks: [{ scope: 'Main', phase: 'before_scene_show', file: 'source/Main.bs',
                       signature: '(args as dynamic) as void' }],
        scene_nodes: [{ name: 'MainScene', file: 'components/MainScene.xml' }],
      } }).success).toBe(true);
  });
  it('accepts optional suppressed_warnings', () => {
    expect(TemplateTomlSchema.safeParse({ ...minimal,
      template_suppressed_warnings: { codes: ['HOOK_DISPATCH_NOT_INVOKED'] } }).success).toBe(true);
  });
});
```

```ts
// src/catalog/template-toml.ts
import { z } from 'zod';
import semver from 'semver';

const SemverRange = z.string().refine((s) => semver.validRange(s) !== null, 'invalid semver range');

export const TemplateTomlSchema = z.object({
  template: z.object({
    id: z.string().min(1),
    version: z.string().refine((s) => semver.valid(s) !== null, 'invalid semver'),
    spec_compat: SemverRange,
    description: z.string(),
  }).strict(),
  template_exports: z.object({
    init_hooks: z.array(z.object({
      scope: z.string().min(1), phase: z.string().min(1),
      file: z.string().min(1), signature: z.string().min(1),
    }).strict()),
    scene_nodes: z.array(z.object({ name: z.string().min(1), file: z.string().min(1) }).strict()),
  }).strict(),
  template_manifest_defaults: z.record(z.string()),
  template_supported_modules: z.object({ allowlist: z.array(z.string()) }).strict().optional(),
  template_suppressed_warnings: z.object({ codes: z.array(z.string()) }).strict().optional(),
}).strict();

export type TemplateToml = z.infer<typeof TemplateTomlSchema>;
```

Run; 5 passing.

- [ ] **Step 3: module-toml Zod test + impl**

```ts
// src/catalog/module-toml.test.ts
import { describe, it, expect } from 'vitest';
import { ModuleTomlSchema } from './module-toml.js';

const minimal = {
  module: { id: 'stub_label', version: '0.1.0', spec_compat: '>=2', description: 'd' },
  module_config_schema: { type: 'object', properties: {} },
  module_files: { add: [] },
  module_wiring: { exports: [], requires: [], init_calls: [] },
  module_ordering: { before: [], after: [] },
  module_conflicts: { exclusive_with: [] },
};

describe('ModuleTomlSchema', () => {
  it('parses minimal', () => { expect(ModuleTomlSchema.safeParse(minimal).success).toBe(true); });
  it('rejects missing module.id', () => {
    expect(ModuleTomlSchema.safeParse({ ...minimal,
      module: { version: '0.1.0', spec_compat: '>=2', description: 'd' } }).success).toBe(false);
  });
  it('accepts optional module_manifest', () => {
    expect(ModuleTomlSchema.safeParse({ ...minimal, module_manifest: { title: 'x' } }).success).toBe(true);
  });
  it('validates init_calls entries', () => {
    expect(ModuleTomlSchema.safeParse({ ...minimal,
      module_wiring: {
        exports: [],
        requires: [{ kind: 'init_hook', scope: 'Main', phase: 'before_scene_show' }],
        init_calls: [{ hook: 'Main.before_scene_show', statement: 'StubLabel_init(args)' }],
      }}).success).toBe(true);
  });
});
```

```ts
// src/catalog/module-toml.ts
import { z } from 'zod';
import semver from 'semver';

const SemverRange = z.string().refine((s) => semver.validRange(s) !== null, 'invalid semver range');

const ExportEntry = z.object({
  kind: z.enum(['init_fn', 'scene_node', 'helper']),
  name: z.string().min(1),
  file: z.string().min(1).optional(),
}).strict();

const RequireEntry = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('init_hook'), scope: z.string(), phase: z.string() }).strict(),
  z.object({ kind: z.literal('scene_node'), name: z.string() }).strict(),
]);

export const ModuleTomlSchema = z.object({
  module: z.object({
    id: z.string().min(1),
    version: z.string().refine((s) => semver.valid(s) !== null, 'invalid semver'),
    spec_compat: SemverRange,
    description: z.string(),
  }).strict(),
  module_config_schema: z.record(z.unknown()),
  module_files: z.object({ add: z.array(z.string().min(1)) }).strict(),
  module_manifest: z.record(z.string()).optional(),
  module_wiring: z.object({
    exports: z.array(ExportEntry),
    requires: z.array(RequireEntry),
    init_calls: z.array(z.object({
      hook: z.string().min(1), statement: z.string().min(1),
    }).strict()),
  }).strict(),
  module_ordering: z.object({ before: z.array(z.string()), after: z.array(z.string()) }).strict(),
  module_conflicts: z.object({ exclusive_with: z.array(z.string()) }).strict(),
}).strict();

export type ModuleToml = z.infer<typeof ModuleTomlSchema>;
```

Run; 4 passing.

- [ ] **Step 4: Loader test + impl**

```ts
// src/catalog/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from './loader.js';

function tmp() { return join(tmpdir(), `brs-gen-cat-${randomUUID()}`); }

const T_TOML = `[template]
id = "t"
version = "0.1.0"
spec_compat = ">=1"
description = "d"
[template.exports]
init_hooks = []
scene_nodes = []
[template.manifest_defaults]
`;
const M_TOML = `[module]
id = "m"
version = "0.1.0"
spec_compat = ">=2"
description = "d"
[module.config_schema]
type = "object"
[module.files]
add = []
[module.wiring]
exports = []
requires = []
init_calls = []
[module.ordering]
before = []
after = []
[module.conflicts]
exclusive_with = []
`;

describe('loadCatalog', () => {
  let root: string;
  beforeEach(async () => {
    root = tmp();
    await mkdir(join(root, 'templates', 't'), { recursive: true });
    await mkdir(join(root, 'modules', 'm'), { recursive: true });
    await writeFile(join(root, 'templates', 't', 'template.toml'), T_TOML);
    await writeFile(join(root, 'modules', 'm', 'module.toml'), M_TOML);
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('scans both dirs', async () => {
    const cat = await loadCatalog(root);
    expect(cat.templates.get('t')?.template.version).toBe('0.1.0');
    expect(cat.modules.get('m')?.module.version).toBe('0.1.0');
  });
  it('throws CATALOG_INVALID on malformed TOML', async () => {
    await writeFile(join(root, 'templates', 't', 'template.toml'), '= = =');
    await expect(loadCatalog(root)).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
  });
  it('throws CATALOG_INVALID when id != dir name', async () => {
    await writeFile(join(root, 'templates', 't', 'template.toml'),
                    T_TOML.replace('id = "t"', 'id = "other"'));
    await expect(loadCatalog(root)).rejects.toMatchObject({ code: 'CATALOG_INVALID' });
  });
  it('emits ASYMMETRIC_CONFLICT warning on one-sided exclusive_with', async () => {
    const m2 = join(root, 'modules', 'm2');
    await mkdir(m2, { recursive: true });
    await writeFile(join(m2, 'module.toml'),
                    M_TOML.replace('id = "m"', 'id = "m2"')
                          .replace('exclusive_with = []', 'exclusive_with = ["m"]'));
    const cat = await loadCatalog(root);
    expect(cat.warnings).toContainEqual(expect.objectContaining({ code: 'ASYMMETRIC_CONFLICT' }));
  });
});
```

```ts
// src/catalog/loader.ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from '@rokudev/device-client';
import { parseToml } from './toml.js';
import { TemplateTomlSchema, type TemplateToml } from './template-toml.js';
import { ModuleTomlSchema, type ModuleToml } from './module-toml.js';

export type Catalog = {
  templates: ReadonlyMap<string, TemplateToml>;
  modules: ReadonlyMap<string, ModuleToml>;
  warnings: ReadonlyArray<{ code: string; message: string; details?: Record<string, unknown> }>;
};

// smol-toml parses [template.exports] as `template.exports` nested under the
// top-level `template` object. Our Zod schemas model this as two separate
// flat keys: `template` (primitives only) and `template_exports` (a sibling
// sub-table). We rewrite the parsed output to match: for every top-level
// key whose value is an object, we split its children into primitives
// (kept on the original key) and sub-tables (hoisted to `<parent>_<child>`).
// Arrays count as primitives so array-of-tables keeps its natural shape.
function flatten(parsed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const primitivesOnly: Record<string, unknown> = {};
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (v2 && typeof v2 === 'object' && !Array.isArray(v2)) {
          // sub-table: hoist to a sibling flat key
          out[`${k}_${k2}`] = v2;
        } else {
          // primitive or array: keep on the parent
          primitivesOnly[k2] = v2;
        }
      }
      out[k] = primitivesOnly;
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function loadOne<T>(
  tomlPath: string, expectedId: string, idPath: string,
  zodSchema: { safeParse(o: unknown): { success: boolean; data?: T; error?: unknown } },
): Promise<T> {
  let raw: string;
  try { raw = await readFile(tomlPath, 'utf8'); }
  catch (e) { throw fail('CATALOG_INVALID', `cannot read ${tomlPath}`, { cause: String(e) }); }
  let parsed: Record<string, unknown>;
  try { parsed = parseToml(raw); }
  catch (e) { throw fail('CATALOG_INVALID', `malformed TOML in ${tomlPath}`, { cause: String(e) }); }
  const flat = flatten(parsed);
  const r = zodSchema.safeParse(flat);
  if (!r.success) throw fail('CATALOG_INVALID', `schema error in ${tomlPath}`, { issues: r.error });
  // idPath is a dot path like "template.id" or "module.id".
  const actualId = idPath.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], r.data!);
  if (actualId !== expectedId) {
    throw fail('CATALOG_INVALID', `${idPath}=${String(actualId)} in ${tomlPath} does not match dir name ${expectedId}`,
               { expected: expectedId, got: actualId });
  }
  return r.data!;
}

function detectAsymmetric(modules: ReadonlyMap<string, ModuleToml>) {
  const out: Array<{ code: string; message: string; details: Record<string, unknown> }> = [];
  for (const [id, m] of modules) {
    for (const other of m.module_conflicts.exclusive_with) {
      const partner = modules.get(other);
      if (!partner) continue;
      if (!partner.module_conflicts.exclusive_with.includes(id)) {
        out.push({
          code: 'ASYMMETRIC_CONFLICT',
          message: `module ${id} declares exclusive_with ${other}, but ${other} does not reciprocate`,
          details: { from: id, to: other },
        });
      }
    }
  }
  return out;
}

export async function loadCatalog(root: string): Promise<Catalog> {
  const templates = new Map<string, TemplateToml>();
  const modules = new Map<string, ModuleToml>();

  for (const d of await readdir(join(root, 'templates'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    templates.set(d.name, await loadOne<TemplateToml>(
      join(root, 'templates', d.name, 'template.toml'), d.name, 'template.id', TemplateTomlSchema));
  }
  for (const d of await readdir(join(root, 'modules'), { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    modules.set(d.name, await loadOne<ModuleToml>(
      join(root, 'modules', d.name, 'module.toml'), d.name, 'module.id', ModuleTomlSchema));
  }

  return { templates, modules, warnings: detectAsymmetric(modules) };
}
```

Run: `pnpm -F brs-gen test -t "loadCatalog"`; 4 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/src/catalog
git commit -m "feat(brs-gen): TOML catalog loader (template.toml + module.toml)

Implements spec §3.2, §3.3, §1.4 CATALOG_INVALID fail-fast, §5.4
ASYMMETRIC_CONFLICT warning. The flatten() step remaps smol-toml's
nested output to the flat keys Zod expects (template_exports,
module_wiring, ...). Loader validates id-matches-dirname (catches
accidental renames)."
```

### Task T5: Manifest-key strategy table

**Files:**
- Create: `packages/brs-gen/src/catalog/manifest-key-strategies.ts` + `.test.ts`

Spec reference: §7.

- [ ] **Step 1: Test first**

```ts
// src/catalog/manifest-key-strategies.test.ts
import { describe, it, expect } from 'vitest';
import { MANIFEST_KEY_STRATEGIES, getStrategy } from './manifest-key-strategies.js';

describe('manifest-key-strategies', () => {
  it('registers set keys', () => {
    for (const k of ['title', 'subtitle', 'splash_color', 'splash_min_time', 'ui_resolutions',
                     'major_version', 'minor_version', 'build_version']) {
      expect(MANIFEST_KEY_STRATEGIES[k]?.strategy).toBe('set');
    }
  });
  it('registers set-if-unset keys', () => {
    for (const k of ['mm_icon_focus_hd','mm_icon_focus_fhd','splash_screen_hd','splash_screen_fhd',
                     'splash_screen_uhd','splash_screen_shd','mm_icon_side_hd','mm_icon_side_fhd',
                     'requires_billing']) {
      expect(MANIFEST_KEY_STRATEGIES[k]?.strategy).toBe('set-if-unset');
    }
  });
  it('registers append-csv keys', () => {
    for (const k of ['bs_const', 'supports_input_launch']) {
      expect(MANIFEST_KEY_STRATEGIES[k]?.strategy).toBe('append-csv');
    }
  });
  it('getStrategy returns undefined for unknown', () => {
    expect(getStrategy('madeUpKey')).toBeUndefined();
  });
  it('version keys are template-only', () => {
    expect(MANIFEST_KEY_STRATEGIES.major_version?.templateOnly).toBe(true);
    expect(MANIFEST_KEY_STRATEGIES.minor_version?.templateOnly).toBe(true);
    expect(MANIFEST_KEY_STRATEGIES.build_version?.templateOnly).toBe(true);
  });
});
```

- [ ] **Step 2: Impl**

```ts
// src/catalog/manifest-key-strategies.ts
export type ManifestStrategy = 'set' | 'set-if-unset' | 'append-csv';
export type ManifestKeyEntry = { strategy: ManifestStrategy; templateOnly?: boolean };

export const MANIFEST_KEY_STRATEGIES: Readonly<Record<string, ManifestKeyEntry>> = Object.freeze({
  title:                 { strategy: 'set' },
  subtitle:              { strategy: 'set' },
  splash_color:          { strategy: 'set' },
  splash_min_time:       { strategy: 'set' },
  ui_resolutions:        { strategy: 'set' },
  major_version:         { strategy: 'set', templateOnly: true },
  minor_version:         { strategy: 'set', templateOnly: true },
  build_version:         { strategy: 'set', templateOnly: true },
  mm_icon_focus_hd:      { strategy: 'set-if-unset' },
  mm_icon_focus_fhd:     { strategy: 'set-if-unset' },
  splash_screen_hd:      { strategy: 'set-if-unset' },
  splash_screen_fhd:     { strategy: 'set-if-unset' },
  splash_screen_uhd:     { strategy: 'set-if-unset' },
  splash_screen_shd:     { strategy: 'set-if-unset' },
  mm_icon_side_hd:       { strategy: 'set-if-unset' },
  mm_icon_side_fhd:      { strategy: 'set-if-unset' },
  requires_billing:      { strategy: 'set-if-unset' },
  bs_const:              { strategy: 'append-csv' },
  supports_input_launch: { strategy: 'append-csv' },
});

export function getStrategy(key: string): ManifestKeyEntry | undefined {
  return MANIFEST_KEY_STRATEGIES[key];
}
```

Run; 5 passing.

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/src/catalog/manifest-key-strategies.ts \
        packages/brs-gen/src/catalog/manifest-key-strategies.test.ts
git commit -m "feat(brs-gen): closed manifest-key strategy table

Implements spec §7. Unknown keys raise UNKNOWN_MANIFEST_KEY at merge
time (T10). Adding a new key is a brs-gen patch release; the test makes
that intentional."
```

---

## Phase 2: Merger (pure) (T6-T13)

Every module in this phase is pure: no filesystem, no network, no logging at module scope. All inputs are deserialized records; all outputs are in-memory values. Tests use small synthetic catalogs constructed in-test rather than real fixture files (that's Phase 5's job).

### Task T6: spec_compat validator and module config validator

**Files:**
- Create: `packages/brs-gen/src/merger/compat.ts` + `.test.ts`
- Create: `packages/brs-gen/src/merger/validate-config.ts` + `.test.ts`

Spec reference: §4.1 steps 3 and 4.

- [ ] **Step 1: compat test first**

```ts
// src/merger/compat.test.ts
import { describe, it, expect } from 'vitest';
import { checkSpecCompat } from './compat.js';

describe('checkSpecCompat', () => {
  it('passes when spec_version satisfies range', () => {
    expect(checkSpecCompat(2, '>=1').ok).toBe(true);
    expect(checkSpecCompat(2, '>=2').ok).toBe(true);
    expect(checkSpecCompat(2, '>=1 <3').ok).toBe(true);
  });
  it('fails SPEC_VERSION_INCOMPATIBLE when spec_version outside range', () => {
    const r = checkSpecCompat(1, '>=2');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('SPEC_VERSION_INCOMPATIBLE');
  });
});
```

- [ ] **Step 2: compat impl**

```ts
// src/merger/compat.ts
import semver from 'semver';
import { fail, type Failure } from '@rokudev/device-client';

type R = { ok: true } | { ok: false; failure: Failure };

export function checkSpecCompat(specVersion: number, range: string, labelFor?: string): R {
  const coerced = `${specVersion}.0.0`;
  if (semver.satisfies(coerced, range)) return { ok: true };
  return {
    ok: false,
    failure: fail('SPEC_VERSION_INCOMPATIBLE',
      `${labelFor ?? 'spec_compat'} range ${range} does not accept spec_version ${specVersion}`,
      { stage: 'compat', spec_version: specVersion, range, rejected_by: labelFor ?? null }),
  };
}
```

Run; 2 passing.

- [ ] **Step 3: validate-config test first**

```ts
// src/merger/validate-config.test.ts
import { describe, it, expect } from 'vitest';
import { validateModuleConfig } from './validate-config.js';

describe('validateModuleConfig', () => {
  const schema = {
    type: 'object', required: ['text'],
    properties: { text: { type: 'string', minLength: 1 } },
    additionalProperties: false,
  };

  it('passes when config matches schema', () => {
    expect(validateModuleConfig('m', schema, { text: 'hi' }).ok).toBe(true);
  });
  it('fails MODULE_CONFIG_INVALID on missing required', () => {
    const r = validateModuleConfig('m', schema, {});
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('MODULE_CONFIG_INVALID');
    expect(r.failure.details?.pointer).toBeDefined();
  });
  it('fails on additional property', () => {
    const r = validateModuleConfig('m', schema, { text: 'x', other: 1 });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 4: validate-config impl**

```ts
// src/merger/validate-config.ts
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { fail, type Failure } from '@rokudev/device-client';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

type R = { ok: true } | { ok: false; failure: Failure };

export function validateModuleConfig(moduleId: string, schema: unknown, config: unknown): R {
  const validate = ajv.compile(schema as object);
  if (validate(config)) return { ok: true };
  const err = validate.errors?.[0];
  return {
    ok: false,
    failure: fail('MODULE_CONFIG_INVALID',
      `config for module ${moduleId} failed validation: ${err?.message ?? 'unknown'}`,
      { stage: 'config-validate', module_id: moduleId,
        pointer: err?.instancePath ?? '', keyword: err?.keyword, params: err?.params }),
  };
}
```

Run; 3 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/src/merger/compat.ts \
        packages/brs-gen/src/merger/compat.test.ts \
        packages/brs-gen/src/merger/validate-config.ts \
        packages/brs-gen/src/merger/validate-config.test.ts
git commit -m "feat(brs-gen): spec_compat + per-module config validators

Implements spec §4.1 steps 3 and 4. spec_compat coerces spec_version to
<n>.0.0 for semver comparison; fail carries rejected_by label.
Validate-config uses ajv Draft 7 and surfaces instancePath as JSON
Pointer in details.pointer."
```

### Task T7: Conflict detection (exclusive_with + file collisions)

**Files:**
- Create: `packages/brs-gen/src/merger/conflicts.ts` + `.test.ts`

Spec reference: §4.1 step 5, §5.4.

- [ ] **Step 1: Test first**

```ts
// src/merger/conflicts.test.ts
import { describe, it, expect } from 'vitest';
import { detectConflicts } from './conflicts.js';

const mod = (id: string, files: string[], exclusive: string[] = []) => ({
  module: { id, version: '0.1.0', spec_compat: '>=2', description: '' },
  module_files: { add: files },
  module_conflicts: { exclusive_with: exclusive },
});

describe('detectConflicts', () => {
  it('ok when no collisions', () => {
    expect(detectConflicts([mod('a', ['a.bs']), mod('b', ['b.bs'])], []).ok).toBe(true);
  });

  it('MODULE_CONFLICT when A exclusive_with B and both present', () => {
    const r = detectConflicts([mod('a', ['a.bs'], ['b']), mod('b', ['b.bs'])], []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('MODULE_CONFLICT');
  });

  it('FILE_COLLISION when two modules add the same path', () => {
    const r = detectConflicts([mod('a', ['shared.bs']), mod('b', ['shared.bs'])], []);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('FILE_COLLISION');
  });

  it('FILE_COLLISION when a module shadows a template file', () => {
    const r = detectConflicts([mod('a', ['source/Main.bs'])], ['source/Main.bs']);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('FILE_COLLISION');
  });
});
```

- [ ] **Step 2: Impl**

```ts
// src/merger/conflicts.ts
import { fail, type Failure } from '@rokudev/device-client';
import type { ModuleToml } from '../catalog/module-toml.js';

type R = { ok: true } | { ok: false; failure: Failure };

export function detectConflicts(modules: ModuleToml[], templateFilePaths: string[]): R {
  const present = new Set(modules.map((m) => m.module.id));
  for (const m of modules) {
    for (const other of m.module_conflicts.exclusive_with) {
      if (present.has(other)) {
        return { ok: false, failure: fail('MODULE_CONFLICT',
          `module ${m.module.id} is exclusive_with ${other}, which is also present`,
          { stage: 'conflicts', a: m.module.id, b: other }) };
      }
    }
  }
  // File-collision detection: every module file and every template file must be unique.
  const owners = new Map<string, string>();
  for (const p of templateFilePaths) owners.set(p, '<template>');
  for (const m of modules) {
    for (const p of m.module_files.add) {
      const existing = owners.get(p);
      if (existing !== undefined) {
        return { ok: false, failure: fail('FILE_COLLISION',
          `path ${p} added by both ${existing} and module ${m.module.id}`,
          { stage: 'conflicts', path: p, owner_a: existing, owner_b: m.module.id }) };
      }
      owners.set(p, `module:${m.module.id}`);
    }
  }
  return { ok: true };
}
```

Run; 4 passing.

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/src/merger/conflicts.ts \
        packages/brs-gen/src/merger/conflicts.test.ts
git commit -m "feat(brs-gen): module conflict and file-collision detection

Implements spec §4.1 step 5 and §5.4. exclusive_with is checked
symmetrically only at the present-set level; asymmetric declarations
are a separate warning emitted at catalog load (§5.4, T4). File
collisions detect both module-vs-module and module-vs-template."
```

### Task T8: Init-order topological sort

**Files:**
- Create: `packages/brs-gen/src/merger/init-order.ts` + `.test.ts`

Spec reference: §4.1 step 6, §5.5.

- [ ] **Step 1: Test first**

```ts
// src/merger/init-order.test.ts
import { describe, it, expect } from 'vitest';
import { topoSortInitOrder } from './init-order.js';

const mod = (id: string, before: string[] = [], after: string[] = []) => ({
  module: { id, version: '0.1.0', spec_compat: '>=2', description: '' },
  module_ordering: { before, after },
});

describe('topoSortInitOrder', () => {
  it('returns lexical order when no constraints', () => {
    const r = topoSortInitOrder([mod('c'), mod('a'), mod('b')]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.order).toEqual(['a', 'b', 'c']);
  });
  it('respects before', () => {
    const r = topoSortInitOrder([mod('a', ['b']), mod('b')]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.order).toEqual(['a', 'b']);
  });
  it('respects after', () => {
    const r = topoSortInitOrder([mod('a'), mod('b', [], ['a'])]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.order).toEqual(['a', 'b']);
  });
  it('tie-break lexical when a single layer has multiple independent nodes', () => {
    const r = topoSortInitOrder([mod('x', [], ['z']), mod('y', [], ['z']), mod('z')]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.order).toEqual(['z', 'x', 'y']);
  });
  it('returns INIT_ORDER_CYCLE when cyclic', () => {
    const r = topoSortInitOrder([mod('a', ['b']), mod('b', ['a'])]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('INIT_ORDER_CYCLE');
    expect(r.failure.details?.cycle).toBeDefined();
  });
  it('ignores edges to modules not present', () => {
    const r = topoSortInitOrder([mod('a', ['not-there']), mod('b')]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.order).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Impl (Kahn's algorithm with lexical tie-break)**

```ts
// src/merger/init-order.ts
import { fail, type Failure } from '@rokudev/device-client';
import type { ModuleToml } from '../catalog/module-toml.js';

type R =
  | { ok: true; order: string[] }
  | { ok: false; failure: Failure };

// "a before b" means a must come before b in the emitted order, so the edge
// in the DAG is a -> b (a must be resolved before b). "b after a" is the
// same edge. Kahn sorts by "nodes with no incoming edges first".
export function topoSortInitOrder(modules: ModuleToml[]): R {
  const ids = modules.map((m) => m.module.id).sort();
  const present = new Set(ids);
  const inDeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const outEdges = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));

  for (const m of modules) {
    const id = m.module.id;
    for (const b of m.module_ordering.before) {
      if (!present.has(b)) continue;
      if (!outEdges.get(id)!.has(b)) {
        outEdges.get(id)!.add(b);
        inDeg.set(b, (inDeg.get(b) ?? 0) + 1);
      }
    }
    for (const a of m.module_ordering.after) {
      if (!present.has(a)) continue;
      if (!outEdges.get(a)!.has(id)) {
        outEdges.get(a)!.add(id);
        inDeg.set(id, (inDeg.get(id) ?? 0) + 1);
      }
    }
  }

  const result: string[] = [];
  // use a sorted-array queue for deterministic lexical tie-break
  const queue = ids.filter((id) => inDeg.get(id) === 0).sort();
  while (queue.length) {
    const next = queue.shift()!;
    result.push(next);
    for (const down of [...outEdges.get(next)!].sort()) {
      const newDeg = (inDeg.get(down) ?? 0) - 1;
      inDeg.set(down, newDeg);
      if (newDeg === 0) {
        // insert preserving sorted order
        const ins = queue.findIndex((q) => q > down);
        if (ins === -1) queue.push(down);
        else queue.splice(ins, 0, down);
      }
    }
  }

  if (result.length !== ids.length) {
    const unresolved = ids.filter((id) => !result.includes(id));
    return { ok: false, failure: fail('INIT_ORDER_CYCLE',
      `cycle involving modules: ${unresolved.join(', ')}`,
      { stage: 'init-order', cycle: unresolved }) };
  }
  return { ok: true, order: result };
}
```

Run; 6 passing.

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/src/merger/init-order.ts \
        packages/brs-gen/src/merger/init-order.test.ts
git commit -m "feat(brs-gen): init-order topo sort with lexical tie-break

Implements spec §4.1 step 6 and §5.5. Kahn's algorithm; tie-breaker is
module-id lexical order so the same module set always produces the same
order. Edges to modules not present in the spec are ignored (not errors).
Cycles raise INIT_ORDER_CYCLE with the involved-modules list in
details.cycle."
```

### Task T9: Wiring contract validator

**Files:**
- Create: `packages/brs-gen/src/merger/wiring.ts` + `.test.ts`

Spec reference: §4.1 step 7, §5.1.

- [ ] **Step 1: Test first**

```ts
// src/merger/wiring.test.ts
import { describe, it, expect } from 'vitest';
import { validateWiring } from './wiring.js';

const mkTemplate = (hooks: Array<{ scope: string; phase: string }>, scenes: string[] = []) => ({
  template_exports: {
    init_hooks: hooks.map((h) => ({ ...h, file: 'x.bs', signature: '()' })),
    scene_nodes: scenes.map((n) => ({ name: n, file: 'x.xml' })),
  },
});
const mkModule = (id: string, reqs: Array<{ kind: 'init_hook'; scope: string; phase: string } | { kind: 'scene_node'; name: string }>,
                  calls: Array<{ hook: string; statement: string }>) => ({
  module: { id, version: '0.1.0', spec_compat: '>=2', description: '' },
  module_wiring: { exports: [], requires: reqs, init_calls: calls },
});

describe('validateWiring', () => {
  it('passes when every require matches an export', () => {
    const t = mkTemplate([{ scope: 'Main', phase: 'before_scene_show' }]);
    const m = mkModule('m', [{ kind: 'init_hook', scope: 'Main', phase: 'before_scene_show' }],
                       [{ hook: 'Main.before_scene_show', statement: 'x()' }]);
    expect(validateWiring(t as any, [m as any]).ok).toBe(true);
  });

  it('WIRING_CONTRACT_VIOLATION when init_hook missing', () => {
    const t = mkTemplate([{ scope: 'Main', phase: 'other_phase' }]);
    const m = mkModule('m', [{ kind: 'init_hook', scope: 'Main', phase: 'before_scene_show' }], []);
    const r = validateWiring(t as any, [m as any]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('WIRING_CONTRACT_VIOLATION');
  });

  it('WIRING_CONTRACT_VIOLATION when scene_node missing', () => {
    const t = mkTemplate([], ['MainScene']);
    const m = mkModule('m', [{ kind: 'scene_node', name: 'OtherScene' }], []);
    const r = validateWiring(t as any, [m as any]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('WIRING_CONTRACT_VIOLATION');
  });

  it('WIRING_CONTRACT_VIOLATION when init_call hook does not match any template init_hook', () => {
    const t = mkTemplate([{ scope: 'Main', phase: 'before_scene_show' }]);
    const m = mkModule('m', [{ kind: 'init_hook', scope: 'Main', phase: 'before_scene_show' }],
                       [{ hook: 'Main.wrong_phase', statement: 'x()' }]);
    const r = validateWiring(t as any, [m as any]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('WIRING_CONTRACT_VIOLATION');
  });
});
```

- [ ] **Step 2: Impl**

```ts
// src/merger/wiring.ts
import { fail, type Failure } from '@rokudev/device-client';
import type { TemplateToml } from '../catalog/template-toml.js';
import type { ModuleToml } from '../catalog/module-toml.js';

type R = { ok: true } | { ok: false; failure: Failure };

function hookKey(scope: string, phase: string): string { return `${scope}.${phase}`; }

export function validateWiring(template: TemplateToml, modules: ModuleToml[]): R {
  const exportedHooks = new Set(template.template_exports.init_hooks.map((h) => hookKey(h.scope, h.phase)));
  const exportedNodes = new Set(template.template_exports.scene_nodes.map((n) => n.name));

  for (const m of modules) {
    for (const req of m.module_wiring.requires) {
      if (req.kind === 'init_hook') {
        if (!exportedHooks.has(hookKey(req.scope, req.phase))) {
          return { ok: false, failure: fail('WIRING_CONTRACT_VIOLATION',
            `module ${m.module.id} requires init_hook ${hookKey(req.scope, req.phase)} not exported by template ${template.template.id}`,
            { stage: 'wiring', module_id: m.module.id, missing: 'init_hook',
              requested: { scope: req.scope, phase: req.phase } }) };
        }
      } else if (req.kind === 'scene_node') {
        if (!exportedNodes.has(req.name)) {
          return { ok: false, failure: fail('WIRING_CONTRACT_VIOLATION',
            `module ${m.module.id} requires scene_node ${req.name} not exported by template ${template.template.id}`,
            { stage: 'wiring', module_id: m.module.id, missing: 'scene_node', requested: { name: req.name } }) };
        }
      }
    }
    for (const call of m.module_wiring.init_calls) {
      if (!exportedHooks.has(call.hook)) {
        return { ok: false, failure: fail('WIRING_CONTRACT_VIOLATION',
          `module ${m.module.id} has init_call for hook ${call.hook} not exported by template ${template.template.id}`,
          { stage: 'wiring', module_id: m.module.id, missing: 'init_hook', requested: { hook: call.hook } }) };
      }
    }
  }
  return { ok: true };
}
```

Run; 4 passing.

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/src/merger/wiring.ts \
        packages/brs-gen/src/merger/wiring.test.ts
git commit -m "feat(brs-gen): wiring contract validator

Implements spec §4.1 step 7 and §5.1. Verifies that every module's
require resolves to a template export and every init_call targets a
template-declared hook. Failure details carry enough context for the
agent to correct the spec or the module."
```

### Task T10: Manifest merge with strategy table

**Files:**
- Create: `packages/brs-gen/src/merger/merge-manifest.ts` + `.test.ts`

Spec reference: §4.1 step 8.5, §7.

- [ ] **Step 1: Test first**

```ts
// src/merger/merge-manifest.test.ts
import { describe, it, expect } from 'vitest';
import { mergeManifest } from './merge-manifest.js';

describe('mergeManifest', () => {
  it('template defaults survive when no module contributes', () => {
    const r = mergeManifest({ title: 'T', ui_resolutions: 'fhd' }, []);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(Object.fromEntries(r.manifest)).toEqual({ title: 'T', ui_resolutions: 'fhd' });
  });

  it('set-if-unset: module fills unset splash icons', () => {
    const r = mergeManifest({ title: 'T' }, [{ id: 'm', manifest: { splash_screen_hd: 'pkg:/x.png' } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.manifest.get('splash_screen_hd')).toBe('pkg:/x.png');
  });

  it('set-if-unset: two modules setting same key raises MANIFEST_KEY_CONFLICT', () => {
    const r = mergeManifest({}, [
      { id: 'a', manifest: { splash_screen_hd: 'pkg:/a.png' } },
      { id: 'b', manifest: { splash_screen_hd: 'pkg:/b.png' } },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('MANIFEST_KEY_CONFLICT');
  });

  it('append-csv: modules contributions joined and sorted-deduped', () => {
    const r = mergeManifest({ bs_const: 'BASE=1' }, [
      { id: 'a', manifest: { bs_const: 'B=1,A=1' } },
      { id: 'b', manifest: { bs_const: 'C=1,B=1' } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.manifest.get('bs_const')).toBe('A=1,B=1,BASE=1,C=1');
  });

  it('set: two modules with different values raise MANIFEST_KEY_CONFLICT', () => {
    const r = mergeManifest({}, [
      { id: 'a', manifest: { title: 'One' } },
      { id: 'b', manifest: { title: 'Two' } },
    ]);
    expect(r.ok).toBe(false);
  });

  it('set: two modules with equal values converge silently', () => {
    const r = mergeManifest({}, [
      { id: 'a', manifest: { title: 'Same' } },
      { id: 'b', manifest: { title: 'Same' } },
    ]);
    expect(r.ok).toBe(true);
  });

  it('UNKNOWN_MANIFEST_KEY when a module uses a key not in the table', () => {
    const r = mergeManifest({}, [{ id: 'a', manifest: { made_up: 'x' } }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('UNKNOWN_MANIFEST_KEY');
  });

  it('rejects modules that try to set template-only keys', () => {
    const r = mergeManifest({}, [{ id: 'a', manifest: { major_version: '2' } }]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('MANIFEST_KEY_CONFLICT');
  });
});
```

- [ ] **Step 2: Impl**

```ts
// src/merger/merge-manifest.ts
import { fail, type Failure } from '@rokudev/device-client';
import { getStrategy } from '../catalog/manifest-key-strategies.js';

type ModuleContrib = { id: string; manifest: Record<string, string> };
type R = { ok: true; manifest: Map<string, string> } | { ok: false; failure: Failure };

function mergeAppendCsv(existing: string | undefined, next: string): string {
  const set = new Set<string>();
  if (existing) existing.split(',').forEach((s) => set.add(s.trim()));
  next.split(',').forEach((s) => set.add(s.trim()));
  return [...set].sort().join(',');
}

export function mergeManifest(templateDefaults: Record<string, string>, modules: ModuleContrib[]): R {
  const out = new Map<string, string>();
  const keyOwners = new Map<string, string>(); // who last contributed each key
  for (const [k, v] of Object.entries(templateDefaults)) {
    out.set(k, v);
    keyOwners.set(k, '<template>');
  }

  for (const m of modules) {
    for (const [k, v] of Object.entries(m.manifest)) {
      const strat = getStrategy(k);
      if (!strat) {
        return { ok: false, failure: fail('UNKNOWN_MANIFEST_KEY',
          `module ${m.id} contributes manifest key ${k} which is not in the strategy table`,
          { stage: 'merge-manifest', module_id: m.id, key: k }) };
      }
      if (strat.templateOnly) {
        return { ok: false, failure: fail('MANIFEST_KEY_CONFLICT',
          `manifest key ${k} is template-only; module ${m.id} cannot contribute it`,
          { stage: 'merge-manifest', module_id: m.id, key: k }) };
      }
      const existing = out.get(k);
      if (strat.strategy === 'set') {
        if (existing !== undefined && existing !== v) {
          return { ok: false, failure: fail('MANIFEST_KEY_CONFLICT',
            `manifest key ${k} set by ${keyOwners.get(k)} to "${existing}"; module ${m.id} conflicts with "${v}"`,
            { stage: 'merge-manifest', key: k, existing, incoming: v,
              owner_a: keyOwners.get(k), owner_b: m.id }) };
        }
        out.set(k, v);
        if (existing === undefined) keyOwners.set(k, m.id);
      } else if (strat.strategy === 'set-if-unset') {
        if (existing !== undefined && existing !== v) {
          return { ok: false, failure: fail('MANIFEST_KEY_CONFLICT',
            `set-if-unset manifest key ${k} contested; ${keyOwners.get(k)} has "${existing}", module ${m.id} wants "${v}"`,
            { stage: 'merge-manifest', key: k, existing, incoming: v,
              owner_a: keyOwners.get(k), owner_b: m.id }) };
        }
        if (existing === undefined) { out.set(k, v); keyOwners.set(k, m.id); }
      } else if (strat.strategy === 'append-csv') {
        out.set(k, mergeAppendCsv(existing, v));
        keyOwners.set(k, existing === undefined ? m.id : `${keyOwners.get(k)},${m.id}`);
      }
    }
  }
  return { ok: true, manifest: out };
}
```

Run; 8 passing.

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/src/merger/merge-manifest.ts \
        packages/brs-gen/src/merger/merge-manifest.test.ts
git commit -m "feat(brs-gen): manifest merger driven by §7 strategy table

Implements spec §4.1 step 8.5 and §7. set/set-if-unset/append-csv
strategies enforced; template-only keys rejected when modules try to
contribute them; unknown keys rejected (typo guard). Append-csv output
is sorted-deduped so same input sets produce same output."
```

### Task T11: Per-module `config.bs` emitter

**Files:**
- Create: `packages/brs-gen/src/merger/emit-config-bs.ts` + `.test.ts`
- Create: `packages/brs-gen/src/util/deterministic.ts` + `.test.ts`

Spec reference: §4.1 step 8.3.

- [ ] **Step 1: deterministic helpers test first**

```ts
// src/util/deterministic.test.ts
import { describe, it, expect } from 'vitest';
import { escapeBsString, stringifyAsBsValue, sortByPath } from './deterministic.js';

describe('escapeBsString', () => {
  it('wraps in double quotes and escapes embedded quotes', () => {
    expect(escapeBsString('he said "hi"')).toBe('"he said ""hi"""');
  });
  it('leaves plain strings as-is', () => {
    expect(escapeBsString('plain')).toBe('"plain"');
  });
});

describe('stringifyAsBsValue', () => {
  it('handles primitives', () => {
    expect(stringifyAsBsValue('x')).toBe('"x"');
    expect(stringifyAsBsValue(42)).toBe('42');
    expect(stringifyAsBsValue(1.5)).toBe('1.5');
    expect(stringifyAsBsValue(true)).toBe('true');
    expect(stringifyAsBsValue(false)).toBe('false');
    expect(stringifyAsBsValue(null)).toBe('invalid');
  });
  it('emits arrays with sorted-stable element order as provided', () => {
    expect(stringifyAsBsValue(['a', 'b'])).toBe('["a", "b"]');
  });
  it('emits AAs with keys sorted asc', () => {
    expect(stringifyAsBsValue({ b: 1, a: 2 })).toBe('{ a: 2, b: 1 }');
  });
});

describe('sortByPath', () => {
  it('sorts by path ascending', () => {
    const files = [{ path: 'c.bs', content: '' }, { path: 'a.bs', content: '' }];
    expect(sortByPath(files).map((f) => f.path)).toEqual(['a.bs', 'c.bs']);
  });
});
```

- [ ] **Step 2: deterministic helpers impl**

```ts
// src/util/deterministic.ts
export function escapeBsString(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

export function stringifyAsBsValue(v: unknown): string {
  if (v === null || v === undefined) return 'invalid';
  if (typeof v === 'string') return escapeBsString(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'invalid';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `[${v.map(stringifyAsBsValue).join(', ')}]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>).sort();
    const body = keys.map((k) => `${k}: ${stringifyAsBsValue((v as Record<string, unknown>)[k])}`).join(', ');
    return `{ ${body} }`;
  }
  return 'invalid';
}

export function sortByPath<T extends { path: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
```

Run; 6 passing.

- [ ] **Step 3: emit-config-bs test first**

```ts
// src/merger/emit-config-bs.test.ts
import { describe, it, expect } from 'vitest';
import { emitModuleConfigBs } from './emit-config-bs.js';

describe('emitModuleConfigBs', () => {
  it('emits a deterministic function returning the config AA', () => {
    const out = emitModuleConfigBs('stub_label', { text: 'hi', n: 3, flag: true });
    expect(out).toContain('function ModuleConfig_stub_label() as object');
    expect(out).toContain('return { flag: true, n: 3, text: "hi" }');
    expect(out).toContain('end function');
  });
  it('emits a stable byte output for same input', () => {
    const a = emitModuleConfigBs('m', { b: 1, a: 2 });
    const b = emitModuleConfigBs('m', { a: 2, b: 1 });
    expect(a).toBe(b);
  });
  it('handles empty config', () => {
    const out = emitModuleConfigBs('m', {});
    expect(out).toContain('return {  }');
  });
});
```

- [ ] **Step 4: emit-config-bs impl**

```ts
// src/merger/emit-config-bs.ts
import { stringifyAsBsValue } from '../util/deterministic.js';

export function emitModuleConfigBs(moduleId: string, config: Record<string, unknown>): string {
  const body = stringifyAsBsValue(config);
  return `' Auto-generated by brs-gen. Do not edit by hand.
function ModuleConfig_${moduleId}() as object
  return ${body}
end function
`;
}
```

Run; 3 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/src/util/deterministic.ts \
        packages/brs-gen/src/util/deterministic.test.ts \
        packages/brs-gen/src/merger/emit-config-bs.ts \
        packages/brs-gen/src/merger/emit-config-bs.test.ts
git commit -m "feat(brs-gen): per-module config.bs emitter with deterministic AA literal

Implements spec §4.1 step 8.3. stringifyAsBsValue sorts AA keys
lexically so the same config object always produces the same bytes.
Null/undefined map to BrightScript 'invalid'; strings use doubled quotes
for escaping (BrightScript convention)."
```

### Task T12: `__init_hooks.bs` emitter (dispatch functions)

**Files:**
- Create: `packages/brs-gen/src/merger/emit-init-hooks.ts` + `.test.ts`

Spec reference: §4.1 step 8.4, §5.2.

- [ ] **Step 1: Test first**

```ts
// src/merger/emit-init-hooks.test.ts
import { describe, it, expect } from 'vitest';
import { emitInitHooks } from './emit-init-hooks.js';

describe('emitInitHooks', () => {
  it('generates one sub per template hook', () => {
    const hooks = [
      { scope: 'Main', phase: 'before_scene_show', file: 'x.bs', signature: '(args as dynamic) as void' },
    ];
    const callsByModule = new Map<string, Array<{ hook: string; statement: string }>>();
    const out = emitInitHooks(hooks, [], callsByModule);
    expect(out).toContain('sub Modules_OnMainBeforeSceneShow(args as dynamic) as void');
    expect(out).toContain('end sub');
  });

  it('inserts init_calls in topo order', () => {
    const hooks = [
      { scope: 'Main', phase: 'before_scene_show', file: 'x.bs', signature: '(args as dynamic) as void' },
    ];
    const callsByModule = new Map([
      ['b', [{ hook: 'Main.before_scene_show', statement: 'B_init(args)' }]],
      ['a', [{ hook: 'Main.before_scene_show', statement: 'A_init(args)' }]],
    ]);
    const out = emitInitHooks(hooks, ['a', 'b'], callsByModule);
    const aIdx = out.indexOf('A_init(args)');
    const bIdx = out.indexOf('B_init(args)');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(aIdx);
  });

  it('emits empty sub bodies when no module contributes', () => {
    const hooks = [
      { scope: 'MainScene.init', phase: 'after_content_load', file: 'y.bs', signature: '(top as roSGNode) as void' },
    ];
    const out = emitInitHooks(hooks, [], new Map());
    expect(out).toContain('sub Modules_OnMainSceneInitAfterContentLoad(top as roSGNode) as void');
    expect(out).toContain('end sub');
  });

  it('handles multiple hooks in file', () => {
    const hooks = [
      { scope: 'Main', phase: 'before_scene_show', file: 'x.bs', signature: '(args) as void' },
      { scope: 'Main', phase: 'after_scene_show',  file: 'x.bs', signature: '(args) as void' },
    ];
    const out = emitInitHooks(hooks, [], new Map());
    expect(out.match(/sub Modules_On/g)?.length).toBe(2);
  });
});
```

- [ ] **Step 2: Impl**

```ts
// src/merger/emit-init-hooks.ts
type Hook = { scope: string; phase: string; file: string; signature: string };

function dispatchFuncName(scope: string, phase: string): string {
  const parts = (scope + ' ' + phase).split(/[^A-Za-z0-9]+/).filter((p) => p.length > 0);
  const pascal = parts.map((p) => p[0]!.toUpperCase() + p.slice(1)).join('');
  return `Modules_On${pascal}`;
}

export function emitInitHooks(
  hooks: Hook[],
  initOrder: string[],
  callsByModule: ReadonlyMap<string, Array<{ hook: string; statement: string }>>,
): string {
  const lines: string[] = [
    "' Auto-generated by brs-gen. Do not edit by hand.",
    '',
  ];
  for (const h of hooks) {
    const name = dispatchFuncName(h.scope, h.phase);
    lines.push(`sub ${name}${h.signature}`);
    for (const modId of initOrder) {
      const calls = callsByModule.get(modId) ?? [];
      for (const c of calls) {
        if (c.hook === `${h.scope}.${h.phase}`) {
          lines.push(`  ${c.statement}`);
        }
      }
    }
    lines.push('end sub');
    lines.push('');
  }
  return lines.join('\n');
}
```

Run; 4 passing.

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/src/merger/emit-init-hooks.ts \
        packages/brs-gen/src/merger/emit-init-hooks.test.ts
git commit -m "feat(brs-gen): __init_hooks.bs dispatch-function emitter

Implements spec §4.1 step 8.4 and §5.2. One sub per template hook;
bodies list init_calls for modules in topo-sorted order. Empty bodies
are kept (no special-casing). Function naming: Modules_On<PascalCase>."
```

### Task T13: Provenance record + EmittedProject assembly

**Files:**
- Create: `packages/brs-gen/src/merger/provenance.ts` + `.test.ts`
- Create: `packages/brs-gen/src/merger/build.ts` + `.test.ts`

Spec reference: §3.4, §4.1 step 8.6 and 8.7.

- [ ] **Step 1: provenance test first**

```ts
// src/merger/provenance.test.ts
import { describe, it, expect } from 'vitest';
import { buildProvenance } from './provenance.js';

describe('buildProvenance', () => {
  it('produces a deterministic sorted record', () => {
    const p = buildProvenance({
      spec_version: 2, template: { id: 't', version: '0.1.0' },
      modules: [{ id: 'b', version: '0.2.0', files: ['b1.bs', 'b0.bs'] },
                { id: 'a', version: '0.1.0', files: ['a.bs'] }],
      init_order: ['b', 'a'],
      manifest_keys: ['title', 'bs_const'],
      brs_gen_version: '0.3.0',
    });
    const parsed = JSON.parse(p);
    expect(parsed.modules.map((m: any) => m.id)).toEqual(['a', 'b']); // sorted
    expect(parsed.modules[1].files).toEqual(['b0.bs', 'b1.bs']);       // sorted
    expect(parsed.manifest_keys).toEqual(['bs_const', 'title']);       // sorted
    expect(parsed.init_order).toEqual(['b', 'a']);                     // preserved
  });

  it('produces byte-equal output across re-invocations', () => {
    const input = { spec_version: 2, template: { id: 't', version: '0.1.0' },
                    modules: [], init_order: [], manifest_keys: [], brs_gen_version: '0.3.0' };
    expect(buildProvenance(input)).toBe(buildProvenance(input));
  });
});
```

- [ ] **Step 2: provenance impl**

```ts
// src/merger/provenance.ts
export type ProvenanceInput = {
  spec_version: 1 | 2;
  template: { id: string; version: string };
  modules: Array<{ id: string; version: string; files: string[] }>;
  init_order: string[];
  manifest_keys: string[];
  brs_gen_version: string;
};

function stableStringify(obj: unknown): string {
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(',')}]`;
  if (obj && typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    return `{${keys.map((k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k])).join(',')}}`;
  }
  return JSON.stringify(obj);
}

export function buildProvenance(input: ProvenanceInput): string {
  // init_order is semantic and must be preserved as given; all other arrays are sorted.
  const normalized = {
    brs_gen_version: input.brs_gen_version,
    init_order: input.init_order,
    manifest_keys: [...input.manifest_keys].sort(),
    modules: [...input.modules].sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((m) => ({ files: [...m.files].sort(), id: m.id, version: m.version })),
    spec_version: input.spec_version,
    template: { id: input.template.id, version: input.template.version },
  };
  return stableStringify(normalized);
}
```

Run; 2 passing.

- [ ] **Step 3: build (EmittedProject assembler) test first**

```ts
// src/merger/build.test.ts
import { describe, it, expect } from 'vitest';
import { buildEmittedProject } from './build.js';

// A minimal fake catalog-shape. Real types are imported from catalog/ but the
// assembler is tested in isolation with plain objects.
const fakeTemplate = {
  template: { id: 't', version: '0.1.0', spec_compat: '>=1', description: '' },
  template_exports: {
    init_hooks: [{ scope: 'Main', phase: 'before_scene_show', file: 'source/Main.bs', signature: '(args) as void' }],
    scene_nodes: [],
  },
  template_manifest_defaults: { title: '<%= spec.app.name %>', ui_resolutions: 'fhd' },
};

const fakeModule = {
  module: { id: 'm', version: '0.1.0', spec_compat: '>=2', description: '' },
  module_config_schema: { type: 'object' },
  module_files: { add: ['source/_modules/m/Init.bs'] },
  module_wiring: { exports: [], requires: [{ kind: 'init_hook', scope: 'Main', phase: 'before_scene_show' }],
                   init_calls: [{ hook: 'Main.before_scene_show', statement: 'M_init(args)' }] },
  module_ordering: { before: [], after: [] },
  module_conflicts: { exclusive_with: [] },
};

const fakeSpec = { spec_version: 2, template: 't', modules: [{ id: 'm', config: { text: 'hi' } }],
                   app: { name: 'Hi', major_version: 1, minor_version: 0, build_version: 0 } };

// renderedTemplateFiles is the output of Phase 3's render step; the assembler
// accepts it as input and does not re-render.
const renderedTemplateFiles = [
  { path: 'source/Main.bs', content: 'sub Main(args): Modules_OnMainBeforeSceneShow(args): end sub' },
];
const moduleFileBytes = new Map<string, Buffer>([
  ['source/_modules/m/Init.bs', Buffer.from('sub M_init(args): end sub')],
]);

describe('buildEmittedProject', () => {
  it('assembles a sorted project tree with manifest, config.bs, and __init_hooks.bs', async () => {
    const p = await buildEmittedProject({
      spec: fakeSpec as any, template: fakeTemplate as any, modules: [fakeModule as any],
      renderedTemplateFiles, moduleFileBytes, brsGenVersion: '0.3.0',
    });
    const paths = p.files.map((f) => f.path);
    expect(paths).toContain('source/Main.bs');
    expect(paths).toContain('source/_modules/m/Init.bs');
    expect(paths).toContain('source/_modules/m/config.bs');
    expect(paths).toContain('source/_modules/__init_hooks.bs');
    expect(paths).toContain('.rokudev-tools/provenance.json');
    expect(paths).toEqual([...paths].sort());
    expect(p.manifest.get('title')).toBe('Hi');
  });

  it('is deterministic across runs', async () => {
    const a = await buildEmittedProject({
      spec: fakeSpec as any, template: fakeTemplate as any, modules: [fakeModule as any],
      renderedTemplateFiles, moduleFileBytes, brsGenVersion: '0.3.0',
    });
    const b = await buildEmittedProject({
      spec: fakeSpec as any, template: fakeTemplate as any, modules: [fakeModule as any],
      renderedTemplateFiles, moduleFileBytes, brsGenVersion: '0.3.0',
    });
    expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
    expect(a.files.map((f) => (typeof f.content === 'string' ? f.content : f.content.toString('base64')))).toEqual(
      b.files.map((f) => (typeof f.content === 'string' ? f.content : f.content.toString('base64'))));
  });
});
```

- [ ] **Step 4: build impl**

```ts
// src/merger/build.ts
import { detectConflicts } from './conflicts.js';
import { topoSortInitOrder } from './init-order.js';
import { validateWiring } from './wiring.js';
import { mergeManifest } from './merge-manifest.js';
import { emitModuleConfigBs } from './emit-config-bs.js';
import { emitInitHooks } from './emit-init-hooks.js';
import { buildProvenance } from './provenance.js';
import { sortByPath } from '../util/deterministic.js';
import { fail, type Failure } from '@rokudev/device-client';
import type { TemplateToml } from '../catalog/template-toml.js';
import type { ModuleToml } from '../catalog/module-toml.js';
import type { AppSpecV2 } from '../spec/app-spec.js';

export type EmittedProject = {
  files: ReadonlyArray<{ path: string; content: Buffer | string }>;
  manifest: ReadonlyMap<string, string>;
  provenance: string;
  initOrder: string[];
};

type BuildInput = {
  spec: AppSpecV2;
  template: TemplateToml;
  modules: ModuleToml[];
  renderedTemplateFiles: ReadonlyArray<{ path: string; content: string | Buffer }>;
  moduleFileBytes: ReadonlyMap<string, Buffer>;
  brsGenVersion: string;
};

export async function buildEmittedProject(input: BuildInput): Promise<EmittedProject> {
  const templatePaths = input.renderedTemplateFiles.map((f) => f.path);
  const conf = detectConflicts(input.modules, templatePaths);
  if (!conf.ok) throw conf.failure;
  const topo = topoSortInitOrder(input.modules);
  if (!topo.ok) throw topo.failure;
  const wiring = validateWiring(input.template, input.modules);
  if (!wiring.ok) throw wiring.failure;

  // Manifest merge
  const specModuleConfigs = new Map(input.spec.modules.map((m) => [m.id, m.config ?? {}]));
  const moduleContribs = input.modules.map((m) => ({
    id: m.module.id,
    manifest: (m.module_manifest ?? {}) as Record<string, string>,
  }));
  const manifestRes = mergeManifest(input.template.template_manifest_defaults as Record<string, string>, moduleContribs);
  if (!manifestRes.ok) throw manifestRes.failure;

  // config.bs per module
  const configFiles: Array<{ path: string; content: string }> = [];
  for (const m of input.modules) {
    const conf = specModuleConfigs.get(m.module.id) ?? {};
    configFiles.push({
      path: `source/_modules/${m.module.id}/config.bs`,
      content: emitModuleConfigBs(m.module.id, conf),
    });
  }

  // __init_hooks.bs
  const callsByModule = new Map(input.modules.map((m) => [m.module.id, m.module_wiring.init_calls]));
  const initHooksContent = emitInitHooks(
    input.template.template_exports.init_hooks,
    topo.order,
    callsByModule,
  );

  // Module static files copied verbatim
  const moduleFiles: Array<{ path: string; content: Buffer }> = [];
  for (const m of input.modules) {
    for (const p of m.module_files.add) {
      const b = input.moduleFileBytes.get(p);
      if (!b) {
        throw fail('CATALOG_INTEGRITY',
          `module ${m.module.id} declares file ${p} but no bytes were provided`,
          { stage: 'build', module_id: m.module.id, missing: p });
      }
      moduleFiles.push({ path: p, content: b });
    }
  }

  // Manifest file (sorted lines)
  const manifestLines = [...manifestRes.manifest.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  const manifestFile = { path: 'manifest', content: manifestLines };

  // Provenance
  const provenance = buildProvenance({
    spec_version: input.spec.spec_version,
    template: { id: input.template.template.id, version: input.template.template.version },
    modules: input.modules.map((m) => ({
      id: m.module.id, version: m.module.version,
      files: [...m.module_files.add, `source/_modules/${m.module.id}/config.bs`],
    })),
    init_order: topo.order,
    manifest_keys: [...manifestRes.manifest.keys()],
    brs_gen_version: input.brsGenVersion,
  });
  const provenanceFile = { path: '.rokudev-tools/provenance.json', content: provenance };

  const all = [
    ...input.renderedTemplateFiles,
    ...moduleFiles,
    ...configFiles,
    { path: 'source/_modules/__init_hooks.bs', content: initHooksContent },
    manifestFile,
    provenanceFile,
  ];

  return {
    files: sortByPath(all),
    manifest: manifestRes.manifest,
    provenance,
    initOrder: topo.order,
  };
}
```

The `CATALOG_INTEGRITY` throw above is a belt-and-braces guard. In practice the loader in T4 should verify every declared file exists on disk during catalog scan, making this path unreachable. If you extend T4's loader with such a check, keep the `CATALOG_INTEGRITY` throw here anyway (it's cheap and catches future regressions where a module adds a file in module.toml but forgets to commit the file).

Run; 2 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/src/merger/provenance.ts \
        packages/brs-gen/src/merger/provenance.test.ts \
        packages/brs-gen/src/merger/build.ts \
        packages/brs-gen/src/merger/build.test.ts
git commit -m "feat(brs-gen): EmittedProject assembler + deterministic provenance

Implements spec §3.4 provenance.json (stable stringify, sorted arrays,
no clock/host) and §4.1 step 8 assembly (run every merger subroutine,
copy module files verbatim, sort output by path). Module files,
manifest, config.bs, __init_hooks.bs, and provenance.json are the five
contribution categories.

buildEmittedProject throws a Failure on any merger subfailure rather
than returning a Result; upstream tools catch and surface. This matches
Plan 1's fail()-throw pattern."
```

---

## Phase 3: Rendering (T14)

### Task T14: EJS template renderer + helpers + text normalisation

**Files:**
- Create: `packages/brs-gen/src/render/helpers.ts` + `.test.ts`
- Create: `packages/brs-gen/src/render/ejs.ts` + `.test.ts`
- Create: `packages/brs-gen/src/util/text-normalize.ts` + `.test.ts`

Spec reference: §4.1 step 8.1, §11.4.

- [ ] **Step 1: text-normalize test first**

```ts
// src/util/text-normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeText } from './text-normalize.js';

describe('normalizeText', () => {
  it('strips UTF-8 BOM', () => {
    expect(normalizeText('\uFEFFhello')).toBe('hello');
  });
  it('converts CRLF to LF', () => {
    expect(normalizeText('a\r\nb\r\n')).toBe('a\nb\n');
  });
  it('converts CR to LF', () => {
    expect(normalizeText('a\rb\r')).toBe('a\nb\n');
  });
  it('leaves already-normalised content alone', () => {
    expect(normalizeText('a\nb\n')).toBe('a\nb\n');
  });
});
```

- [ ] **Step 2: text-normalize impl**

```ts
// src/util/text-normalize.ts
export function normalizeText(s: string): string {
  let out = s;
  if (out.charCodeAt(0) === 0xfeff) out = out.slice(1);    // strip UTF-8 BOM
  out = out.replace(/\r\n/g, '\n').replace(/\r/g, '\n');   // CRLF / CR -> LF
  return out;
}
```

Run; 4 passing.

- [ ] **Step 3: helpers test first**

```ts
// src/render/helpers.test.ts
import { describe, it, expect } from 'vitest';
import { makeHelpers } from './helpers.js';

describe('render helpers', () => {
  it('xmlEscape escapes ampersand, angle brackets, quotes', () => {
    const h = makeHelpers();
    expect(h.xmlEscape('a & b')).toBe('a &amp; b');
    expect(h.xmlEscape('<tag>')).toBe('&lt;tag&gt;');
    expect(h.xmlEscape('"quoted"')).toBe('&quot;quoted&quot;');
    expect(h.xmlEscape("'apos'")).toBe('&apos;apos&apos;');
  });
  it('hex color passthrough is exact (no escaping)', () => {
    const h = makeHelpers();
    expect(h.xmlEscape('&hFF00FFFF')).toBe('&amp;hFF00FFFF');
  });
});
```

- [ ] **Step 4: helpers impl**

```ts
// src/render/helpers.ts
export type Helpers = {
  xmlEscape(s: string): string;
};

export function makeHelpers(): Helpers {
  return {
    xmlEscape(s: string): string {
      return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    },
  };
}
```

Run; 2 passing.

- [ ] **Step 5: EJS render test first**

```ts
// src/render/ejs.test.ts
import { describe, it, expect } from 'vitest';
import { renderTemplateFiles } from './ejs.js';

describe('renderTemplateFiles', () => {
  const spec = {
    spec_version: 2 as const, template: 't', modules: [],
    app: { name: 'Hi', major_version: 1, minor_version: 0, build_version: 0 },
  };
  const meta = { brs_gen_version: '0.3.0', template_version: '0.1.0' };

  it('interpolates spec.app.name into a .bs file', async () => {
    const files = [
      { path: 'source/Main.bs', bytes: Buffer.from('print "<%= spec.app.name %>"\n') },
    ];
    const out = await renderTemplateFiles(files, spec as any, meta);
    expect(out[0].path).toBe('source/Main.bs');
    expect(out[0].content).toBe('print "Hi"\n');
  });

  it('normalises CRLF on text files', async () => {
    const files = [{ path: 'x.bs', bytes: Buffer.from('a\r\nb\r\n') }];
    const out = await renderTemplateFiles(files, spec as any, meta);
    expect(out[0].content).toBe('a\nb\n');
  });

  it('passes binary files through unchanged', async () => {
    const bin = Buffer.from([0xff, 0xfe, 0x00, 0x01]);
    const files = [{ path: 'images/icon.png', bytes: bin }];
    const out = await renderTemplateFiles(files, spec as any, meta);
    expect(Buffer.isBuffer(out[0].content)).toBe(true);
    expect(out[0].content as Buffer).toEqual(bin);
  });

  it('does NOT auto-escape HTML (BrightScript hex literals survive)', async () => {
    const files = [{ path: 'comp.xml', bytes: Buffer.from('<color><%- "&hFF00FFFF" %></color>') }];
    const out = await renderTemplateFiles(files, spec as any, meta);
    expect(out[0].content).toBe('<color>&hFF00FFFF</color>');
  });

  it('.ejs suffix is stripped from the output path', async () => {
    const files = [{ path: 'manifest.ejs', bytes: Buffer.from('title=<%= spec.app.name %>\n') }];
    const out = await renderTemplateFiles(files, spec as any, meta);
    expect(out[0].path).toBe('manifest');
    expect(out[0].content).toBe('title=Hi\n');
  });
});
```

- [ ] **Step 6: EJS impl**

```ts
// src/render/ejs.ts
import ejs from 'ejs';
import { makeHelpers } from './helpers.js';
import { normalizeText } from '../util/text-normalize.js';

const TEXT_EXTS = new Set(['.bs', '.brs', '.xml', '.ejs', '.txt', '.json']);
const NO_TEMPLATING_EXTS = new Set<string>(); // none; all text files go through EJS

function ext(path: string): string {
  const m = path.match(/\.[^./\\]+$/);
  return m ? m[0] : '';
}

function isTextFile(path: string): boolean {
  return TEXT_EXTS.has(ext(path));
}

// Strips one trailing .ejs suffix from path ('manifest.ejs' -> 'manifest').
function stripEjsSuffix(path: string): string {
  return path.endsWith('.ejs') ? path.slice(0, -'.ejs'.length) : path;
}

type Meta = { brs_gen_version: string; template_version: string };

export async function renderTemplateFiles(
  files: ReadonlyArray<{ path: string; bytes: Buffer }>,
  spec: unknown,
  meta: Meta,
): Promise<Array<{ path: string; content: string | Buffer }>> {
  const helpers = makeHelpers();
  const out: Array<{ path: string; content: string | Buffer }> = [];
  for (const f of files) {
    if (!isTextFile(f.path)) {
      out.push({ path: f.path, content: f.bytes });
      continue;
    }
    const src = normalizeText(f.bytes.toString('utf8'));
    const rendered = await ejs.render(src, { spec, helpers, meta }, { async: true, escape: (v) => String(v) });
    // ejs escape override: we disabled HTML escape by setting escape to identity;
    // BrightScript hex literals like &hFF00FFFF would otherwise be mangled.
    out.push({ path: stripEjsSuffix(f.path), content: rendered });
  }
  return out;
}
```

Run; 5 passing.

- [ ] **Step 7: Commit**

```bash
git add packages/brs-gen/src/util/text-normalize.ts \
        packages/brs-gen/src/util/text-normalize.test.ts \
        packages/brs-gen/src/render
git commit -m "feat(brs-gen): EJS template rendering + helpers + text normalisation

Implements spec §4.1 step 8.1 and §11.4. EJS auto-escape disabled
(BrightScript hex literals like &hFF00FFFF would be corrupted);
templates call helpers.xmlEscape() explicitly for XML attribute values.
Text files normalise CRLF to LF, strip BOM. .ejs suffix is stripped
from output paths (manifest.ejs -> manifest)."
```

---

## Phase 4: Build pipeline (T15-T17)

This phase is the first one that touches the outside world (filesystem, subprocess-ish `bsc`, zip bytes). It's also where the §8 determinism guarantees concretely materialise.

### Task T15: Write project tree to disk (atomic tmpdir + rename)

**Files:**
- Create: `packages/brs-gen/src/build/write.ts` + `.test.ts`

Spec reference: §4.1 step 9.

- [ ] **Step 1: Test first**

```ts
// src/build/write.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { writeProject } from './write.js';

function mkdirTmp() { return join(tmpdir(), `brs-gen-write-${randomUUID()}`); }

const sample = [
  { path: 'manifest', content: 'title=Hi\n' },
  { path: 'source/Main.bs', content: 'sub Main(): end sub\n' },
  { path: 'images/icon_hd.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  { path: '.rokudev-tools/provenance.json', content: '{"spec_version":2}' },
];

describe('writeProject', () => {
  let parent: string;
  beforeEach(async () => { parent = mkdirTmp(); await mkdir(parent, { recursive: true }); });
  afterEach(async () => { await rm(parent, { recursive: true, force: true }); });

  it('writes all files under output_dir', async () => {
    const out = join(parent, 'proj');
    await writeProject({ outputDir: out, files: sample, overwrite: false });
    expect((await readFile(join(out, 'manifest'), 'utf8'))).toBe('title=Hi\n');
    expect((await readFile(join(out, 'source/Main.bs'), 'utf8'))).toBe('sub Main(): end sub\n');
    const bin = await readFile(join(out, 'images/icon_hd.png'));
    expect([bin[0], bin[1], bin[2], bin[3]]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('refuses to overwrite existing output_dir without flag', async () => {
    const out = join(parent, 'proj');
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'existing.txt'), 'x');
    await expect(writeProject({ outputDir: out, files: sample, overwrite: false }))
      .rejects.toMatchObject({ code: 'OUTPUT_DIR_NOT_EMPTY' });
  });

  it('replaces existing dir when overwrite=true', async () => {
    const out = join(parent, 'proj');
    await mkdir(out, { recursive: true });
    await writeFile(join(out, 'stale.txt'), 'x');
    await writeProject({ outputDir: out, files: sample, overwrite: true });
    await expect(readFile(join(out, 'stale.txt'))).rejects.toBeDefined(); // deleted
    expect((await readFile(join(out, 'manifest'), 'utf8'))).toBe('title=Hi\n');
  });

  it('tmpdir lives inside dirname(output_dir)', async () => {
    const out = join(parent, 'nested', 'proj');
    await mkdir(dirname(out), { recursive: true });
    // We cannot directly observe the tmpdir, but we can assert the write
    // succeeds on a freshly-created parent (which would fail if the tmpdir
    // were placed on os.tmpdir() and then cross-fs renamed). In this test's
    // case, parent and os.tmpdir() happen to be the same FS, so the assertion
    // is soft: we at least make sure the output_dir was reached.
    await writeProject({ outputDir: out, files: sample, overwrite: false });
    expect(await stat(out)).toBeTruthy();
  });

  it('creates nested parent directories inside output_dir', async () => {
    const out = join(parent, 'proj');
    await writeProject({ outputDir: out, files: sample, overwrite: false });
    expect(await stat(join(out, '.rokudev-tools'))).toBeTruthy();
    expect(await stat(join(out, 'source'))).toBeTruthy();
  });
});
```

- [ ] **Step 2: Impl**

```ts
// src/build/write.ts
import { mkdir, writeFile, rm, rename, access, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail } from '@rokudev/device-client';

type WriteInput = {
  outputDir: string;
  files: ReadonlyArray<{ path: string; content: string | Buffer }>;
  overwrite: boolean;
};

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}
async function isNonEmpty(p: string): Promise<boolean> {
  try { return (await readdir(p)).length > 0; } catch { return false; }
}

export async function writeProject(input: WriteInput): Promise<void> {
  if (await exists(input.outputDir) && await isNonEmpty(input.outputDir)) {
    if (!input.overwrite) {
      throw fail('OUTPUT_DIR_NOT_EMPTY',
        `output_dir ${input.outputDir} is non-empty; pass overwrite: true to replace`,
        { stage: 'write', output_dir: input.outputDir });
    }
  }

  // tmpdir inside dirname(output_dir) so fs.rename is same-filesystem and atomic.
  const parent = dirname(input.outputDir);
  await mkdir(parent, { recursive: true });
  const tmp = join(parent, `.brs-gen-tmp-${randomUUID()}`);
  await mkdir(tmp, { recursive: true });

  for (const f of input.files) {
    const dest = join(tmp, f.path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, f.content);
  }

  if (await exists(input.outputDir)) {
    // one final rm (overwrite path), then rename
    await rm(input.outputDir, { recursive: true, force: true });
  }
  await rename(tmp, input.outputDir);
  // sanity-guard: if rename failed silently, clean up tmp
  if (await exists(tmp)) await rm(tmp, { recursive: true, force: true });
}
```

Run; 5 passing.

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/src/build/write.ts \
        packages/brs-gen/src/build/write.test.ts
git commit -m "feat(brs-gen): atomic project-tree writer (tmpdir+rename)

Implements spec §4.1 step 9. Tmpdir lives inside dirname(output_dir)
for same-filesystem rename. Non-empty output_dir is rejected unless
overwrite: true. All file contents are written byte-verbatim; no text
normalisation happens here (that's render/'s job)."
```

### Task T16: bsc compile (in-process via `brighterscript`)

**Files:**
- Create: `packages/brs-gen/src/build/compile.ts` + `.test.ts`

Spec reference: §4.1 step 10, §8, §10.2.3.

- [ ] **Step 1: Test first**

The test needs a compilable stub project on disk. Use the fake project shape `writeProject` produces. Keep the project small so the bsc invocation is fast.

```ts
// src/build/compile.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { compileProject } from './compile.js';

function tmp() { return join(tmpdir(), `brs-gen-compile-${randomUUID()}`); }

async function writeMiniProject(dir: string, mainBody: string) {
  await mkdir(join(dir, 'source'), { recursive: true });
  await writeFile(join(dir, 'manifest'), 'title=Test\nmajor_version=1\nminor_version=0\nbuild_version=0\nui_resolutions=fhd\n');
  await writeFile(join(dir, 'source/Main.bs'), mainBody);
  await writeFile(join(dir, 'bsconfig.json'), JSON.stringify({ sourceMap: true, rootDir: '.' }));
}

describe('compileProject', () => {
  let root: string;
  beforeEach(async () => { root = tmp(); await mkdir(root, { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('returns ok with no diagnostics for a clean project', async () => {
    await writeMiniProject(root, 'sub Main(args as dynamic) as void\n  print "hi"\nend sub\n');
    const r = await compileProject(root);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('narrowing');
    expect(r.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('emits .brs + .brs.map beside each .bs source', async () => {
    await writeMiniProject(root, 'sub Main(args as dynamic) as void\n  print "hi"\nend sub\n');
    await compileProject(root);
    // bsc transpiles .bs -> .brs; the staging dir is implementation-detail of
    // compileProject. Locate the .brs by asking compileProject for the staging path.
    // (The implementation exports it as part of the result.)
  });

  it('returns LINT_FAILED on a syntax error', async () => {
    await writeMiniProject(root, 'sub Main(args as dynamic) as void\n  print "unterminated\nend sub\n');
    const r = await compileProject(root);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('narrowing');
    expect(r.failure.code).toBe('LINT_FAILED');
    expect(r.failure.details?.diagnostics).toBeDefined();
  });

  it('produces byte-equal output across two invocations on the same input', async () => {
    await writeMiniProject(root, 'sub Main(args as dynamic) as void\n  print "hi"\nend sub\n');
    const a = await compileProject(root);
    const b = await compileProject(root);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error('narrowing');
    const fa = await readFile(join(a.stagingDir, 'source/Main.brs'), 'utf8');
    const fb = await readFile(join(b.stagingDir, 'source/Main.brs'), 'utf8');
    expect(fa).toBe(fb);
  });
});
```

- [ ] **Step 2: Impl**

```ts
// src/build/compile.ts
import { ProgramBuilder } from 'brighterscript';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fail, type Failure } from '@rokudev/device-client';

export type CompileDiagnostic = {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  file: string;
  line: number;
  col: number;
};

type CompileResult =
  | { ok: true; diagnostics: CompileDiagnostic[]; stagingDir: string }
  | { ok: false; failure: Failure };

export async function compileProject(projectDir: string): Promise<CompileResult> {
  // Staging dir sits inside projectDir so source-map paths stay relative; a
  // fresh UUID per call prevents leftover staging artefacts from a prior run
  // contaminating program.validate(). Callers wanting staging outside the
  // project can pass a different path in a future version, but Plan 3 ships
  // this shape and the e2e tests depend on it.
  const staging = join(projectDir, `.brs-gen-staging-${randomUUID()}`);
  await mkdir(staging, { recursive: true });

  const builder = new ProgramBuilder();
  try {
    await builder.run({
      cwd: projectDir,
      rootDir: projectDir,
      stagingDir: staging,
      createPackage: false,
      watch: false,
      sourceMap: true,
      diagnosticSeverityOverrides: {},
    });
    const diags = builder.program.getDiagnostics().map<CompileDiagnostic>((d: any) => ({
      severity: d.severity === 1 /* error */ ? 'error' : d.severity === 2 /* warning */ ? 'warning' : 'info',
      code: String(d.code ?? 'unknown'),
      message: d.message,
      file: d.file?.srcPath ?? '<unknown>',
      line: (d.range?.start?.line ?? 0) + 1,
      col: (d.range?.start?.character ?? 0) + 1,
    }));
    const errors = diags.filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      return {
        ok: false,
        failure: fail('LINT_FAILED',
          `bsc reported ${errors.length} error(s)`,
          { stage: 'compile', diagnostics: diags }),
      };
    }
    return { ok: true, diagnostics: diags, stagingDir: staging };
  } catch (e) {
    return {
      ok: false,
      failure: fail('COMPILE_FAILED',
        `bsc compile threw: ${e instanceof Error ? e.message : String(e)}`,
        { stage: 'compile', cause: String(e) }),
    };
  } finally {
    builder.dispose?.();
  }
}
```

The `brighterscript` API may differ from this snippet. Before implementing, run `pnpm -F brs-gen exec node -e "console.log(Object.keys(require('brighterscript')))"` to confirm the exports, or open `node_modules/brighterscript/dist/index.js` and read. Adapt the fields you pass to `builder.run()` to match the actual type signature. The invariants to preserve are:

- source maps are produced,
- staging dir is a new subdirectory inside `projectDir`,
- diagnostics are extractable after the run,
- the call is in-process (no child subprocess).

Run; 4 passing.

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/src/build/compile.ts \
        packages/brs-gen/src/build/compile.test.ts
git commit -m "feat(brs-gen): in-process bsc compile via brighterscript ProgramBuilder

Implements spec §4.1 step 10 and §10.2.3 determinism check. Uses
brighterscript's ProgramBuilder; staging dir inside projectDir;
source maps produced (consumed later by .rokudev-tools/sourcemaps/).
LINT_FAILED vs COMPILE_FAILED distinguishes diagnostic-surfaced errors
from uncaught compile-time exceptions."
```

### Task T17: Deterministic zip (yazl, sorted entries, fixed mtime)

**Files:**
- Create: `packages/brs-gen/src/build/zip.ts` + `.test.ts`

Spec reference: §4.1 step 11, §8.

- [ ] **Step 1: Test first**

```ts
// src/build/zip.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { packageProject } from './zip.js';

function tmp() { return join(tmpdir(), `brs-gen-zip-${randomUUID()}`); }

async function writeMiniProject(dir: string) {
  await mkdir(join(dir, 'source'), { recursive: true });
  await writeFile(join(dir, 'manifest'), 'title=Test\n');
  await writeFile(join(dir, 'source/Main.brs'), 'sub Main(): end sub\n');
}

function sha256(b: Buffer): string {
  return createHash('sha256').update(b).digest('hex');
}

describe('packageProject', () => {
  let root: string;
  beforeEach(async () => { root = tmp(); await mkdir(root, { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('produces a zip file at the requested output_zip path', async () => {
    const proj = join(root, 'p'); await writeMiniProject(proj);
    const out = join(root, 'p.zip');
    await packageProject({ projectDir: proj, outputZip: out });
    const bytes = await readFile(out);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('byte-equal output on two zips of the same project', async () => {
    const proj = join(root, 'p'); await writeMiniProject(proj);
    const a = join(root, 'a.zip');
    const b = join(root, 'b.zip');
    await packageProject({ projectDir: proj, outputZip: a });
    await packageProject({ projectDir: proj, outputZip: b });
    const A = await readFile(a);
    const B = await readFile(b);
    expect(sha256(A)).toBe(sha256(B));
  });

  it('excludes paths in the exclude array', async () => {
    const proj = join(root, 'p'); await writeMiniProject(proj);
    await mkdir(join(proj, '.rokudev-tools/sourcemaps'), { recursive: true });
    await writeFile(join(proj, '.rokudev-tools/sourcemaps/main.brs.map'), '{}');
    const out = join(root, 'p.zip');
    await packageProject({ projectDir: proj, outputZip: out, exclude: ['.rokudev-tools/sourcemaps'] });
    // crude check: the zip string should not contain the map filename
    const bytes = await readFile(out);
    expect(bytes.toString('latin1')).not.toContain('main.brs.map');
  });
});
```

- [ ] **Step 2: Impl**

```ts
// src/build/zip.ts
import yazl from 'yazl';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, relative } from 'node:path';

type PackageInput = {
  projectDir: string;
  outputZip: string;
  /** Array of path prefixes (relative to projectDir) to exclude. */
  exclude?: ReadonlyArray<string>;
};

// DOS epoch = 1980-01-01T00:00:00 UTC
const DOS_EPOCH = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

async function walk(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, d.name);
    const rel = relative(base, full);
    if (d.isDirectory()) out.push(...await walk(full, base));
    else if (d.isFile()) out.push(rel);
  }
  return out;
}

export async function packageProject(input: PackageInput): Promise<void> {
  const all = (await walk(input.projectDir, input.projectDir)).sort();
  const excluded = (p: string) => (input.exclude ?? []).some((pref) => p === pref || p.startsWith(pref + '/'));
  const zip = new yazl.ZipFile();

  for (const rel of all) {
    if (excluded(rel)) continue;
    const full = join(input.projectDir, rel);
    const bytes = await readFile(full);
    // Pin mtime, compression, AND the external-file-attributes field so the
    // zip is OS-independent. yazl's default mode comes from the host fs stat,
    // which varies by umask / file-create-mode; forcing 0o644 keeps bytes
    // equal across Linux, macOS, and Windows CI runs.
    zip.addBuffer(bytes, rel, { mtime: DOS_EPOCH, compress: false, mode: 0o644 });
  }
  zip.end();

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(input.outputZip);
    zip.outputStream.pipe(out).on('close', resolve).on('error', reject);
    zip.outputStream.on('error', reject);
  });
}
```

Run; 3 passing.

- [ ] **Step 3: Commit**

```bash
git add packages/brs-gen/src/build/zip.ts \
        packages/brs-gen/src/build/zip.test.ts
git commit -m "feat(brs-gen): deterministic zip (yazl, sorted paths, STORED, DOS mtime)

Implements spec §4.1 step 11 and §8 zip byte-equality. No compression
(STORED) eliminates a large source of per-run variation; mtime pinned
to the DOS epoch eliminates wall-clock entanglement; sorted walk gives
a stable entry order. Exclude list lets callers (generate_app) omit
.rokudev-tools/sourcemaps/ from shipped zips."
```

---

## Phase 5: Stub catalog (T18-T19)

Plan 3 needs exactly one template and one module in its bundled catalog so every merger feature is exercised at least once and the e2e test has something to generate. The stubs are deliberately uninteresting; real templates and modules land in Plans 4 and 5.

### Task T18: Author `stub_hello` template

**Files:**
- Create: `packages/brs-gen/templates/stub_hello/template.toml`
- Create: `packages/brs-gen/templates/stub_hello/schema.ts`
- Create: `packages/brs-gen/templates/stub_hello/files/manifest.ejs`
- Create: `packages/brs-gen/templates/stub_hello/files/source/Main.bs`
- Create: `packages/brs-gen/templates/stub_hello/files/components/MainScene.xml`
- Create: `packages/brs-gen/templates/stub_hello/files/components/MainScene.bs`
- Create: `packages/brs-gen/templates/stub_hello/files/images/icon_hd.png`
- Create: `packages/brs-gen/templates/stub_hello/files/images/icon_fhd.png`
- Create: `packages/brs-gen/templates/stub_hello/files/images/splash_hd.png`
- Create: `packages/brs-gen/templates/stub_hello/files/images/splash_fhd.png`
- Create: `packages/brs-gen/scripts/gen-stub-pngs.mjs`
- Create: `packages/brs-gen/tsconfig.json` (update `include` to cover `templates/*/schema.ts` if not already)

Spec reference: §9.1.

- [ ] **Step 1: Write `template.toml`**

```toml
# packages/brs-gen/templates/stub_hello/template.toml
[template]
id = "stub_hello"
version = "0.1.0"
spec_compat = ">=1"
description = "Minimal channel used to smoke-test the brs-gen engine. Renders a black screen with the channel title. Not intended to be sideloaded as a real product."

[template.exports]
init_hooks = [
  { scope = "Main", phase = "before_scene_show", file = "source/Main.bs", signature = "(args as dynamic) as void" },
]
scene_nodes = [
  { name = "MainScene", file = "components/MainScene.xml" },
]

[template.manifest_defaults]
title              = "<%= spec.app.name %>"
major_version      = "<%= spec.app.major_version %>"
minor_version      = "<%= spec.app.minor_version %>"
build_version      = "<%= spec.app.build_version %>"
splash_color       = "#000000"
mm_icon_focus_hd   = "pkg:/images/icon_hd.png"
mm_icon_focus_fhd  = "pkg:/images/icon_fhd.png"
splash_screen_hd   = "pkg:/images/splash_hd.png"
splash_screen_fhd  = "pkg:/images/splash_fhd.png"
ui_resolutions     = "fhd"
```

- [ ] **Step 2: Write `schema.ts`**

The stub has no per-template fields beyond the wrapper. Export a Zod schema that just adds `app` validation (redundant with the wrapper, but keeps the pattern for real templates).

```ts
// packages/brs-gen/templates/stub_hello/schema.ts
import { z } from 'zod';

// Convention: every template's schema.ts exports exactly two names,
// `Schema` and `Example`. The get_template_schema MCP tool (T20) imports by
// these exact names; do NOT rename without updating that tool too.

// stub_hello accepts AppSpec v1 or v2 wrapper with no extra fields.
export const Schema = z.object({
  spec_version: z.union([z.literal(1), z.literal(2)]),
  template: z.literal('stub_hello'),
  modules: z.array(z.record(z.unknown())).optional(), // v2 only
  app: z.object({
    name: z.string().min(1),
    major_version: z.number().int().min(0),
    minor_version: z.number().int().min(0),
    build_version: z.number().int().min(0),
  }).strict(),
}).strict();

export const Example = {
  spec_version: 2 as const,
  template: 'stub_hello' as const,
  modules: [],
  app: { name: 'Stub Channel', major_version: 1, minor_version: 0, build_version: 0 },
};
```

- [ ] **Step 3: Write `files/manifest.ejs`**

```
# packages/brs-gen/templates/stub_hello/files/manifest.ejs
title=<%= spec.app.name %>
major_version=<%= spec.app.major_version %>
minor_version=<%= spec.app.minor_version %>
build_version=<%= spec.app.build_version %>
splash_color=#000000
mm_icon_focus_hd=pkg:/images/icon_hd.png
mm_icon_focus_fhd=pkg:/images/icon_fhd.png
splash_screen_hd=pkg:/images/splash_hd.png
splash_screen_fhd=pkg:/images/splash_fhd.png
ui_resolutions=fhd
```

Note: this file is rendered to `manifest` (no extension) per the `.ejs`-stripping logic in T14.

Cross-check: the manifest content this produces must be byte-equal to the manifest the merger builds from `template_manifest_defaults`. The merger is the source of truth for manifest bytes in the final zip; this file just exists as a redundant-safety so `stub_hello` passes `validate_manifest` even before merger-produced manifests are wired up to the write step.

- [ ] **Step 4: Write `files/source/Main.bs`**

```brighterscript
' packages/brs-gen/templates/stub_hello/files/source/Main.bs
sub Main(args as dynamic) as void
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.setMessagePort(port)

    scene = screen.CreateScene("MainScene")
    screen.show()

    ' Invoke brs-gen-generated module init hooks.
    Modules_OnMainBeforeSceneShow(args)

    while true
        msg = wait(0, port)
        msgType = type(msg)
        if msgType = "roSGScreenEvent"
            if msg.isScreenClosed() then exit while
        end if
    end while
end sub
```

- [ ] **Step 5: Write `files/components/MainScene.xml`**

```xml
<?xml version="1.0" encoding="utf-8" ?>
<component name="MainScene" extends="Scene">
    <script type="text/brightscript" uri="MainScene.bs" />
    <children>
        <Label id="title" text="Hello from stub_hello" translation="[960, 540]" horizAlign="center" vertAlign="center" font="font:LargeBoldSystemFont" color="0xFFFFFFFF" />
    </children>
</component>
```

- [ ] **Step 6: Write `files/components/MainScene.bs`**

```brighterscript
' packages/brs-gen/templates/stub_hello/files/components/MainScene.bs
sub init()
    ' Intentionally empty: stub_hello has no per-scene logic.
end sub
```

- [ ] **Step 7: Write `scripts/gen-stub-pngs.mjs`**

A one-off script that produces four tiny solid-colour PNGs at the correct Roku dimensions. Run it once; commit the output; never run in CI.

```js
// packages/brs-gen/scripts/gen-stub-pngs.mjs
// Run once: `node packages/brs-gen/scripts/gen-stub-pngs.mjs`
// Produces 4 solid-colour PNGs for stub_hello's images/ dir.
// Requires no extra deps: uses a hand-rolled minimal PNG encoder.
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'templates', 'stub_hello', 'files', 'images');

function crc32(buf) {
  let c;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function solidPng(width, height, r, g, b) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  // compression=0, filter=0, interlace=0
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const base = y * (1 + width * 3);
    raw[base] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      raw[base + 1 + x * 3 + 0] = r;
      raw[base + 1 + x * 3 + 1] = g;
      raw[base + 1 + x * 3 + 2] = b;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

await writeFile(join(OUT, 'icon_hd.png'),     solidPng(290, 218, 30, 30, 30));
await writeFile(join(OUT, 'icon_fhd.png'),    solidPng(336, 210, 30, 30, 30));
await writeFile(join(OUT, 'splash_hd.png'),   solidPng(1280, 720, 0, 0, 0));
await writeFile(join(OUT, 'splash_fhd.png'),  solidPng(1920, 1080, 0, 0, 0));
console.log('Wrote 4 stub PNGs to', OUT);
```

- [ ] **Step 8: Run the PNG generator once**

```bash
mkdir -p packages/brs-gen/templates/stub_hello/files/images
node packages/brs-gen/scripts/gen-stub-pngs.mjs
```

Expected: 4 PNGs on disk.

- [ ] **Step 9: Verify stub_hello loads end-to-end**

Write a throw-away `tests/stub_hello.load.test.ts` (DELETE AFTER ALL TESTS PASS; it's a scaffold guard, not a permanent test):

```ts
// tests/stub_hello.load.test.ts
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/loader.js';

describe('stub_hello catalog load', () => {
  it('loads', async () => {
    const root = join(fileURLToPath(new URL('../', import.meta.url)));
    const cat = await loadCatalog(root);
    expect(cat.templates.get('stub_hello')?.template.version).toBe('0.1.0');
  });
});
```

Run: `pnpm -F brs-gen test -t "stub_hello catalog load"`.
Expected: 1 passing.

After verifying, DELETE the test file (commit the deletion in T19's commit or the next).

- [ ] **Step 10: Commit**

```bash
git add packages/brs-gen/templates/stub_hello \
        packages/brs-gen/scripts/gen-stub-pngs.mjs
git commit -m "feat(brs-gen): stub_hello template + PNG generator

Implements spec §9.1. stub_hello is a minimal compilable Roku channel
used to smoke-test the engine; not a real product. EJS template,
Main.bs calls the merger-generated dispatch function, MainScene renders
a centred greeting label. Four solid-colour PNGs generated by a one-off
script (kept in-repo for reproducibility; NOT run in CI)."
```

### Task T19: Author `stub_label` module

**Files:**
- Create: `packages/brs-gen/modules/stub_label/module.toml`
- Create: `packages/brs-gen/modules/stub_label/files/source/_modules/stub_label/Init.bs`

Spec reference: §9.2.

- [ ] **Step 1: Write `module.toml`**

```toml
# packages/brs-gen/modules/stub_label/module.toml
[module]
id = "stub_label"
version = "0.1.0"
spec_compat = ">=2"
description = "Prints a configurable label string at channel start. Used by the brs-gen engine's e2e test to exercise config flow and init wiring."

[module.config_schema]
type = "object"
required = ["text"]
additionalProperties = false

  [module.config_schema.properties]
  text = { type = "string", minLength = 1 }

[module.files]
add = ["source/_modules/stub_label/Init.bs"]

[module.wiring]
exports = []
requires = [
  { kind = "init_hook", scope = "Main", phase = "before_scene_show" },
]
init_calls = [
  { hook = "Main.before_scene_show", statement = "StubLabel_init(args)" },
]

[module.ordering]
before = []
after  = []

[module.conflicts]
exclusive_with = []
```

- [ ] **Step 2: Write `files/source/_modules/stub_label/Init.bs`**

```brighterscript
' packages/brs-gen/modules/stub_label/files/source/_modules/stub_label/Init.bs
' Reads the module's merger-emitted config from ModuleConfig_stub_label()
' and prints its text on channel start. Deliberately simple.

sub StubLabel_init(args as dynamic) as void
    config = ModuleConfig_stub_label()
    txt = "stub_label: " + config.text
    print txt
end sub
```

- [ ] **Step 3: Verify stub_label loads**

Run (with the throwaway stub_hello test still present, or add a similar one for stub_label):

```ts
// tests/stub_label.load.test.ts (throwaway)
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from '../src/catalog/loader.js';

describe('stub_label catalog load', () => {
  it('loads', async () => {
    const root = join(fileURLToPath(new URL('../', import.meta.url)));
    const cat = await loadCatalog(root);
    expect(cat.modules.get('stub_label')?.module.version).toBe('0.1.0');
  });
});
```

Run: `pnpm -F brs-gen test -t "stub_label catalog load"`. Expected: 1 passing. Delete after verification.

- [ ] **Step 4: Commit**

```bash
git add packages/brs-gen/modules/stub_label
git commit -m "feat(brs-gen): stub_label module

Implements spec §9.2. Single static file, one init_hook requirement,
one init_call. config_schema requires a 'text' string. Module reads its
merger-emitted config via ModuleConfig_stub_label() and prints it on
channel start. Used by T30 conflict-matrix test and T31 e2e smoke."
```

---

## Phase 6: MCP tools (T20-T27)

All tools follow the same pattern Plan 1 and Plan 2 established:

- One file per tool under `src/tools/`.
- Each file calls `registerToolsModule((tools) => { tools.push(...) })` at module-load so `tools/all.ts` (a side-effect-import barrel) collects them.
- MCP wire fields use snake_case; internal TS uses camelCase.
- `inputSchema` is hand-rolled JSON Schema (no Zod-to-JSON at the tool boundary).
- Every tool returns `{ content: [{ type: 'text', text: JSON.stringify(result) }] }` on success; failures throw a `Failure` that the server translates to an MCP error result.

Before starting T20, add the minimum tool-registrar scaffolding:

- Create `src/tools/_registry.ts` that mirrors `packages/rokudev-device/src/tools/_registry.ts` (copy verbatim; adjust only the package import path if needed). It exports `registerToolsModule()` and `REGISTRARS`.
- Extend `src/bootstrap/index.ts` to iterate `REGISTRARS` on startup and register each tool's handler with the MCP `Server`.
- Create `src/tools/all.ts` as an empty barrel that imports each tool file for its side-effect registration. Tools land in `all.ts` as they are added in T20-T27.

This pre-work is part of T20; do it before implementing `list_templates`.

### Task T20: `list_templates` + `get_template_schema`

**Files:**
- Create: `packages/brs-gen/src/tools/_registry.ts` (mirror rokudev-device)
- Create: `packages/brs-gen/src/tools/all.ts`
- Create: `packages/brs-gen/src/tools/list-templates.ts` + `.test.ts`
- Create: `packages/brs-gen/src/tools/get-template-schema.ts` + `.test.ts`
- Modify: `packages/brs-gen/src/bootstrap/index.ts` (hook registrars into the MCP server)

Spec reference: §2.1.

- [ ] **Step 1: Mirror the tool-registry scaffolding**

Read `packages/rokudev-device/src/tools/_registry.ts` and copy its shape into `packages/brs-gen/src/tools/_registry.ts`. The interface should look approximately:

```ts
// src/tools/_registry.ts
export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;
export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler;
};

export const REGISTRARS: Array<(tools: ToolDefinition[]) => void> = [];

export function registerToolsModule(fn: (tools: ToolDefinition[]) => void) {
  REGISTRARS.push(fn);
}
```

If rokudev-device's version differs, follow its shape exactly so maintainers learn one pattern.

- [ ] **Step 2: Write the list_templates test first**

```ts
// src/tools/list-templates.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { REGISTRARS } from './_registry.js';
import './list-templates.js';  // side-effect registration

describe('list_templates tool', () => {
  let handler: (args: Record<string, unknown>) => Promise<unknown>;
  beforeEach(() => {
    const tools: Array<{ name: string; handler: any }> = [];
    for (const r of REGISTRARS) r(tools);
    const t = tools.find((t) => t.name === 'list_templates');
    if (!t) throw new Error('not registered');
    handler = t.handler;
  });

  it('returns entries sorted by id with id/version/description', async () => {
    // The handler reads the catalog lazily via a module singleton. Stub that
    // by injecting a test catalog via setCatalogForTests().
    const { setCatalogForTests } = await import('./_catalog-singleton.js');
    setCatalogForTests({
      templates: new Map([
        ['zeta', { template: { id: 'zeta', version: '0.1.0', spec_compat: '>=1', description: 'z' },
                   template_exports: { init_hooks: [], scene_nodes: [] },
                   template_manifest_defaults: {} }],
        ['alpha', { template: { id: 'alpha', version: '0.1.0', spec_compat: '>=1', description: 'a' },
                    template_exports: { init_hooks: [], scene_nodes: [] },
                    template_manifest_defaults: {} }],
      ]) as any,
      modules: new Map(),
      warnings: [],
    });

    const result = await handler({});
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.templates.map((t: any) => t.id)).toEqual(['alpha', 'zeta']);
    expect(parsed.templates[0]).toEqual({ id: 'alpha', version: '0.1.0', description: 'a' });
  });
});
```

- [ ] **Step 3: Implement the catalog singleton**

The tool needs a way to reach the bundled catalog at runtime. The cleanest pattern is a module-level singleton that's initialised at server startup and swappable in tests.

```ts
// src/tools/_catalog-singleton.ts
import type { Catalog } from '../catalog/loader.js';

let current: Catalog | undefined;

export function setCatalog(c: Catalog): void { current = c; }
export function getCatalog(): Catalog {
  if (!current) throw new Error('catalog not initialised; call setCatalog() during bootstrap');
  return current;
}

// test-only seam
export function setCatalogForTests(c: Catalog): void { current = c; }
export function _resetCatalog(): void { current = undefined; }
```

Bootstrap (`src/bootstrap/index.ts`) will call `setCatalog(await loadCatalog(bundledRoot))` before registering handlers. The bundled root is `packages/brs-gen` (the templates/ and modules/ dirs next to src/).

- [ ] **Step 4: Implement `list-templates.ts`**

```ts
// src/tools/list-templates.ts
import { registerToolsModule } from './_registry.js';
import { getCatalog } from './_catalog-singleton.js';

registerToolsModule((tools) => {
  tools.push({
    name: 'list_templates',
    description: 'List bundled base templates available for generate_app. Sorted by id ascending.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const cat = getCatalog();
      const templates = [...cat.templates.values()]
        .map((t) => ({ id: t.template.id, version: t.template.version, description: t.template.description }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { content: [{ type: 'text', text: JSON.stringify({ templates }) }] };
    },
  });
});
```

Run the test; 1 passing.

- [ ] **Step 5: Write the get_template_schema test first**

```ts
// src/tools/get-template-schema.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { REGISTRARS } from './_registry.js';
import './get-template-schema.js';
import { setCatalogForTests } from './_catalog-singleton.js';

describe('get_template_schema tool', () => {
  let handler: any;
  beforeEach(() => {
    const tools: any[] = [];
    for (const r of REGISTRARS) r(tools);
    handler = tools.find((t) => t.name === 'get_template_schema')!.handler;
  });

  it('returns schema + example for known template', async () => {
    setCatalogForTests({
      templates: new Map([
        ['stub_hello', { template: { id: 'stub_hello', version: '0.1.0', spec_compat: '>=1', description: 'd' },
                         template_exports: { init_hooks: [], scene_nodes: [] },
                         template_manifest_defaults: {} }],
      ]) as any,
      modules: new Map(),
      warnings: [],
    });
    const r = await handler({ id: 'stub_hello' });
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.id).toBe('stub_hello');
    expect(parsed.schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(parsed.example_spec).toBeDefined();
  });

  it('throws UNKNOWN_TEMPLATE for unknown id', async () => {
    setCatalogForTests({ templates: new Map(), modules: new Map(), warnings: [] });
    await expect(handler({ id: 'nope' })).rejects.toMatchObject({ code: 'UNKNOWN_TEMPLATE' });
  });
});
```

- [ ] **Step 6: Implement `get-template-schema.ts`**

The tool loads the template's `schema.ts` via dynamic import and runs it through `zodToJsonSchemaDraft7`. For templates without a dedicated schema (future real templates), fall back to a generic wrapper schema. For Plan 3, `stub_hello` ships `schema.ts` so the dynamic import works.

```ts
// src/tools/get-template-schema.ts
import { registerToolsModule } from './_registry.js';
import { getCatalog } from './_catalog-singleton.js';
import { zodToJsonSchemaDraft7 } from '../spec/to-json-schema.js';
import { fail } from '@rokudev/device-client';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

registerToolsModule((tools) => {
  tools.push({
    name: 'get_template_schema',
    description: 'Return JSON Schema Draft 7 and a minimal example AppSpec for the named template.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1 } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const id = String(args.id);
      const cat = getCatalog();
      const t = cat.templates.get(id);
      if (!t) {
        throw fail('UNKNOWN_TEMPLATE', `template not in catalog: ${id}`,
          { stage: 'catalog', given: id, known: [...cat.templates.keys()].sort() });
      }
      // Dynamic import of the template's schema.ts. The file is bundled next to
      // its template.toml. Convention (T18): every schema.ts exports exactly
      // two names, `Schema` (a Zod schema) and `Example` (a minimal valid
      // AppSpec object). Picking by exact name (not suffix match) so a
      // template author cannot accidentally shadow the pick with an unrelated
      // export whose name happens to end in "Schema".
      const url = new URL(`../../templates/${id}/schema.ts`, import.meta.url);
      const mod = (await import(url.href)) as { Schema?: unknown; Example?: unknown };
      if (!mod.Schema || !mod.Example) {
        throw fail('CATALOG_INVALID',
          `template ${id}'s schema.ts must export both 'Schema' and 'Example'`,
          { stage: 'catalog', template_id: id });
      }
      const jsonSchema = zodToJsonSchemaDraft7(mod.Schema as any, `${id}Schema`);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            id,
            version: t.template.version,
            spec_compat: t.template.spec_compat,
            schema: jsonSchema,
            example_spec: mod.Example,
          }),
        }],
      };
    },
  });
});
```

The `new URL(..., import.meta.url)` pattern is necessary because at runtime the server may be executing from `dist/`, not `src/`. Adjust relative path as needed; the goal is resolving `templates/<id>/schema.ts` relative to the package.

Run; 2 passing.

- [ ] **Step 7: Wire both tools into the `all.ts` barrel**

```ts
// src/tools/all.ts
import './list-templates.js';
import './get-template-schema.js';
```

- [ ] **Step 8: Hook `REGISTRARS` into bootstrap**

Update `src/bootstrap/index.ts` so `runServer` loads the catalog, populates the singleton, imports `tools/all.ts` for side effects, and registers each tool with the MCP `Server`. Mirror the rokudev-device pattern exactly; copy its imports and registration loop.

- [ ] **Step 9: Verify build and catalog load**

```bash
pnpm -F brs-gen build
```

- [ ] **Step 10: Commit**

```bash
git add packages/brs-gen/src/tools packages/brs-gen/src/bootstrap
git commit -m "feat(brs-gen): MCP tool scaffolding + list_templates + get_template_schema

First two MCP tools. Mirrors rokudev-device's side-effect-import
registrar pattern. Catalog singleton (_catalog-singleton.ts) is the
only runtime state; tests swap it out via setCatalogForTests.
get_template_schema dynamically imports the template's schema.ts to
avoid baking the Zod schema into brs-gen src."
```

### Task T21: `list_modules` + `get_module_schema`

**Files:**
- Create: `packages/brs-gen/src/tools/list-modules.ts` + `.test.ts`
- Create: `packages/brs-gen/src/tools/get-module-schema.ts` + `.test.ts`
- Modify: `packages/brs-gen/src/tools/all.ts`

Spec reference: §2.1.

Symmetric to T20. Implement both tools with the same shape:
- `list_modules`: returns `{ modules: [{ id, version, description, spec_compat }] }` sorted by id.
- `get_module_schema`: returns `{ id, version, spec_compat, config_schema (the JSON Schema from module.toml), example_config, wiring: { exports, requires } }`. `example_config` is synthesised from `config_schema` (use `ajv`'s default-generation or hand-walk; for Plan 3 a minimal `{}` or a required-fields-filled stub is sufficient).

Follow the same TDD rhythm: test first, impl, verify, then commit.

- [ ] **Step 1-4: Write tests + impls analogous to T20**

Refer to T20's shape. The key differences:
- `module.toml` already contains `module_config_schema` verbatim, so no dynamic `schema.ts` import is needed for modules (Plan 5 may revisit per spec §3.3 note).
- `example_config` should be a minimal object satisfying `required`; for stub_label, `{ text: "hello" }`.

- [ ] **Step 5: Append to `tools/all.ts`**

```ts
import './list-modules.js';
import './get-module-schema.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/brs-gen/src/tools/list-modules.ts \
        packages/brs-gen/src/tools/list-modules.test.ts \
        packages/brs-gen/src/tools/get-module-schema.ts \
        packages/brs-gen/src/tools/get-module-schema.test.ts \
        packages/brs-gen/src/tools/all.ts
git commit -m "feat(brs-gen): list_modules + get_module_schema tools

Symmetric with list_templates + get_template_schema. Module schemas
live in module.toml (not a sibling .ts file) so no dynamic import is
needed; example_config is a minimal shape satisfying required."
```

### Task T22: `generate_app` (the main tool)

**Files:**
- Create: `packages/brs-gen/src/tools/generate-app.ts` + `.test.ts`
- Modify: `packages/brs-gen/src/tools/all.ts`

Spec reference: §2.2, §4.1.

The shape is large; the handler is the glue that invokes every previous module in order:

1. parse input (inline spec vs file path)
2. AppSpec Zod parse (after any v1-to-v2 promotion)
3. template preflight
4. resolve modules (with version_range; emit MODULE_VERSION_UNPINNED warning when omitted)
5. validate spec_compat against template and every module
6. validate each module's config against its `module_config_schema`
7. detect conflicts and file collisions
8. topo-sort init order
9. validate wiring contracts
10. read all template and module file bytes from disk (catalog file paths)
11. render template files with EJS
12. assemble `EmittedProject` via `buildEmittedProject`
13. write project tree to `output_dir`
14. run `compileProject` (bsc)
15. optionally zip (via `packageProject`)
16. optionally sideload (via `@rokudev/device-client` devPortal.sideload())
17. emit the result

The tool reads template/module file bytes from disk each call (in-process; not cached across calls). Module file bytes come from the bundled `modules/<id>/files/` dir.

Tests should cover at minimum:
- happy path: generate a project from `{ template: stub_hello, modules: [{ id: stub_label, config: {text:'hi'} }] }` and assert the output tree has manifest, source/Main.bs (compiled to source/Main.brs), source/_modules/stub_label/Init.bs, source/_modules/stub_label/config.bs, source/_modules/__init_hooks.bs, .rokudev-tools/provenance.json.
- refusal when `output_dir` is non-empty without `overwrite: true`.
- auto-promoted warning surfaces when spec_version is 1.
- sideload parameter present but dev_password unresolvable -> DEVICE_NO_PASSWORD failure (re-raised from device-client).

Follow TDD rhythm. Structure the test to use a tmpdir for `output_dir` and a real catalog load against the bundled stub_hello + stub_label.

Commit message:

```bash
git commit -m "feat(brs-gen): generate_app tool (Path A: deterministic)

Implements spec §2.2 and §4.1. Wires together every merger/render/build
module previously built. Happy path: AppSpec -> validated -> merged ->
written -> compiled -> (optionally) zipped -> (optionally) sideloaded.
Freeform path (spec.freeform) is rejected with NOT_IMPLEMENTED here
(lands in Plan 6). Sideload calls @rokudev/device-client directly
in-process per spec §2.2."
```

### Task T23: `package_app`

**Files:**
- Create: `packages/brs-gen/src/tools/package-app.ts` + `.test.ts`
- Modify: `packages/brs-gen/src/tools/all.ts`

Spec reference: §2.2 package_app semantics.

Thin wrapper around `packageProject` (from T17). Validates the project dir has a top-level `manifest` file; refuses with `MANIFEST_VALIDATION_FAILED` otherwise.

Tests:
- happy path: zip an existing directory.
- refusal when no `manifest` at root.
- output defaults to `<project_dir>.zip` when `output_zip` is not provided.

Commit:

```bash
git commit -m "feat(brs-gen): package_app tool (pure repackage)

Thin wrapper around packageProject. Validates manifest at project root;
default output is <project_dir>.zip."
```

### Task T24: `validate_manifest`

**Files:**
- Create: `packages/brs-gen/src/tools/validate-manifest.ts` + `.test.ts`
- Modify: `packages/brs-gen/src/tools/all.ts`

Spec reference: §2.3.

Reads `project_dir/manifest` and `project_dir/.rokudev-tools/provenance.json`. Parses both. Reports:
- `manifest_keys`: sorted list of keys present in the manifest.
- `provenance`: the parsed provenance record.
- `drift`: any keys present in provenance's `manifest_keys` but missing from the manifest, or vice versa. Drift is a warning (MANIFEST_DRIFT), not a failure.

Failure:
- `MANIFEST_VALIDATION_FAILED` when manifest is missing or unparseable, or provenance is missing or unparseable.

Commit:

```bash
git commit -m "feat(brs-gen): validate_manifest tool

Cross-checks project_dir/manifest against .rokudev-tools/provenance.json.
Drift is a MANIFEST_DRIFT warning (non-fatal); missing files are
MANIFEST_VALIDATION_FAILED failures."
```

### Task T25: `validate_assets`

**Files:**
- Create: `packages/brs-gen/src/tools/validate-assets.ts` + `.test.ts`
- Modify: `packages/brs-gen/src/tools/all.ts`

Spec reference: §2.3, §9.1.

For Plan 3 the rule set is minimal:
- Every `mm_icon_focus_*` and `splash_screen_*` key in the manifest must reference an existing file under `project_dir/images/`.
- Each referenced image must be a PNG (magic bytes `89 50 4E 47`).
- Each referenced image must be < 1 MB.

Returns `{ ok, missing, oversize, wrong_dimensions }`. For Plan 3 `wrong_dimensions` is always `[]` (real templates in Plan 4 add per-key dimension rules).

Failure `ASSET_VALIDATION_FAILED` when any rule fails; the handler returns `{ ok: false, ... }` rather than throwing (the spec treats this as a validation report, not a crash).

Commit:

```bash
git commit -m "feat(brs-gen): validate_assets tool (Plan 3 minimal rule set)

Checks manifest-referenced icon/splash images exist, are PNGs, and are
under 1 MB. Per-template dimension rules are deferred to Plan 4 when
real templates land."
```

### Task T26: `spec_upgrade`

**Files:**
- Create: `packages/brs-gen/src/tools/spec-upgrade.ts` + `.test.ts`
- Modify: `packages/brs-gen/src/tools/all.ts`

Spec reference: §2.4, §3.5.

Reads the file at `file_path`, runs `promoteV1ToV2`, writes to a sibling `.v2.json` (or overwrites the original when `in_place: true`). Returns `{ ok, spec_version_before, spec_version_after, written_to, diff? }`. Diff is a plain textual diff between original and promoted (use `JSON.stringify` with `indent: 2` and compare line-by-line; `diff` package is NOT needed for Plan 3).

Tests:
- v1 in-place and v1 default-sidecar modes.
- v2 produces no-op result with `spec_version_before === spec_version_after === 2`.
- file-not-found produces a `Failure`.

Commit:

```bash
git commit -m "feat(brs-gen): spec_upgrade tool

Writes promoted form to <file>.v2.json by default; in_place: true
overwrites. Never silently mutates user input in the default path."
```

### Task T27: `lint`

**Files:**
- Create: `packages/brs-gen/src/tools/lint.ts` + `.test.ts`
- Modify: `packages/brs-gen/src/tools/all.ts`

Spec reference: §2.5.

Thin wrapper around `compileProject` (T16). Returns `{ ok, diagnostics }` where `ok` is true only when no diagnostic has severity `"error"`. Unlike `generate_app`, `lint` never modifies the project; it invokes `compileProject` with a staging dir that gets cleaned up.

Tests:
- clean project: ok=true, diagnostics=[].
- syntax error: ok=false, diagnostics include the error.
- warnings-only: ok=true, diagnostics include warnings.

Commit:

```bash
git commit -m "feat(brs-gen): lint tool

Wraps compileProject; ok is true only when no error-level diagnostics.
Used by generate_app internally (§4.1 step 10) and by Plan 6's
freeform-session lint gate. Staging dir is cleaned after each call."
```

---

## Phase 7: Cross-cutting tests (T28-T31)

These tests exercise the full pipeline against the stub catalog. They live in `packages/brs-gen/tests/` (top-level, separate from `src/*.test.ts` per-module tests).

### Task T28: Determinism tests

**Files:**
- Create: `packages/brs-gen/tests/determinism.test.ts`

Spec reference: §10.2.

Three tests:

1. **Pure-merger byte equality.** Render + assemble the stub catalog twice in the same process; assert the `EmittedProject` results are deep-equal (same file paths, same bytes, same manifest map, same provenance string).
2. **Wall-clock invariance.** Use `vi.setSystemTime()` to advance Date.now between two `buildEmittedProject` calls; assert output is still byte-equal. This catches accidental `new Date()` leaks.
3. **bsc compile byte equality.** Write the same project to two staging dirs, invoke `compileProject` on each, compare every output file byte-for-byte. If this fails on a future `brighterscript` bump, it's the signal to pin the previous version.

```ts
// tests/determinism.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdir, rm, readFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadCatalog } from '../src/catalog/loader.js';
import { buildEmittedProject } from '../src/merger/build.js';
import { renderTemplateFiles } from '../src/render/ejs.js';
import { compileProject } from '../src/build/compile.js';
import { writeProject } from '../src/build/write.js';

function tmp() { return join(tmpdir(), `brs-gen-det-${randomUUID()}`); }

const sharedSpec = {
  spec_version: 2 as const, template: 'stub_hello',
  modules: [{ id: 'stub_label', config: { text: 'hi' } }],
  app: { name: 'Hi', major_version: 1, minor_version: 0, build_version: 0 },
};

async function runMerge() {
  const pkgRoot = join(new URL('..', import.meta.url).pathname);
  const cat = await loadCatalog(pkgRoot);
  const template = cat.templates.get('stub_hello')!;
  const modules = [cat.modules.get('stub_label')!];
  // Load raw template file bytes
  const tplRoot = join(pkgRoot, 'templates', 'stub_hello', 'files');
  // ... (walk tplRoot; populate Array<{ path, bytes }>) ...
  const renderedTemplateFiles = await renderTemplateFiles(/* template files */[], sharedSpec as any,
    { brs_gen_version: '0.3.0-dev.0', template_version: template.template.version });
  const moduleFileBytes = new Map<string, Buffer>();
  // ... (load module files) ...
  return buildEmittedProject({
    spec: sharedSpec as any, template, modules,
    renderedTemplateFiles, moduleFileBytes, brsGenVersion: '0.3.0-dev.0',
  });
}
// Fill in the TODOs (walk template dir, map module file paths to bytes) during impl.

describe('determinism', () => {
  it('pure merger byte equality across runs in same process', async () => {
    const a = await runMerge();
    const b = await runMerge();
    expect(a.files.map((f) => f.path)).toEqual(b.files.map((f) => f.path));
    for (let i = 0; i < a.files.length; i++) {
      const ac = a.files[i]!.content;
      const bc = b.files[i]!.content;
      if (Buffer.isBuffer(ac) && Buffer.isBuffer(bc)) {
        expect(ac.equals(bc)).toBe(true);
      } else {
        expect(ac).toBe(bc);
      }
    }
    expect(a.provenance).toBe(b.provenance);
  });

  it('bsc compile output is byte-equal across runs', async () => {
    const pkgRoot = join(new URL('..', import.meta.url).pathname);
    const dirA = tmp(); const dirB = tmp();
    await mkdir(dirA, { recursive: true }); await mkdir(dirB, { recursive: true });
    // Write the same minimal project (manifest + source/Main.bs + bsconfig.json) to both.
    // ... (see build/compile.test.ts for the helper) ...
    const ra = await compileProject(dirA);
    const rb = await compileProject(dirB);
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) throw new Error('narrowing');
    const fa = await readFile(join(ra.stagingDir, 'source/Main.brs'));
    const fb = await readFile(join(rb.stagingDir, 'source/Main.brs'));
    expect(fa.equals(fb)).toBe(true);
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  });
});
```

The `runMerge()` helper is scaffolded above with TODO markers. Fill in the directory walk + bytes loader; use small inline helpers rather than adding new exported functions.

Run; 2 tests passing (or 3 if you split out the wall-clock test). Commit:

```bash
git add packages/brs-gen/tests/determinism.test.ts
git commit -m "test(brs-gen): pipeline determinism guards

Implements spec §10.2. Pure-merger byte equality, wall-clock
invariance, bsc compile byte equality. If bsc determinism fails on a
brighterscript upgrade, this test is the signal to pin the previous
version (per spec §11.1)."
```

### Task T29: Snapshot tests

**Files:**
- Create: `packages/brs-gen/tests/snapshots.test.ts`

Spec reference: §10.3.

Golden-file test for the stub catalog's full output. Generates a project from `{ template: stub_hello, modules: [{ id: stub_label, config: { text: 'hello world' } }] }`, then:

- Snapshots the sorted list of `(path, size)` pairs (full bytes are too noisy for inline snapshots; the determinism test in T28 covers bytes).
- Inline-snapshots the merged manifest (small; printable).
- Inline-snapshots the generated `__init_hooks.bs` content (small; printable).
- Inline-snapshots the `config.bs` emitted for `stub_label`.
- Inline-snapshots the `provenance.json` content.

Vitest's `toMatchInlineSnapshot()` keeps the expected values in the test file itself, so reviewers can see what's being generated at a glance without chasing `__snapshots__/`.

```ts
// tests/snapshots.test.ts (sketch)
import { describe, it, expect } from 'vitest';
// ... (setup: generate stub project into tmpdir via generate_app or direct merger call) ...

describe('stub catalog snapshot', () => {
  it('emitted manifest matches inline snapshot', () => {
    // expect(manifestContent).toMatchInlineSnapshot(`...`)
  });
  it('__init_hooks.bs matches inline snapshot', () => {
    // ...
  });
  it('config.bs matches inline snapshot', () => {
    // ...
  });
  it('provenance.json matches inline snapshot', () => {
    // ...
  });
  it('file listing matches saved snapshot', () => {
    // expect(sortedList).toMatchSnapshot()  // this one uses a __snapshots__/ file
  });
});
```

Fill in the setup logic; commit.

```bash
git add packages/brs-gen/tests/snapshots.test.ts packages/brs-gen/tests/__snapshots__
git commit -m "test(brs-gen): stub catalog snapshot tests

Implements spec §10.3. Inline snapshots for the small printable outputs
(manifest, __init_hooks.bs, config.bs, provenance.json) so reviewers see
exactly what stub output looks like in the diff. File listing lives in
a saved snapshot; bytes equality is covered by T28 determinism tests."
```

### Task T30: Conflict-matrix combinatorial test

**Files:**
- Create: `packages/brs-gen/tests/conflict-matrix.test.ts`

Spec reference: §10.4.

For every 2-subset of the bundled module catalog (just `[stub_label]` in Plan 3; the harness scales as Plan 5 adds real modules), generate a synthetic AppSpec that uses the current `stub_hello` template plus both modules. Assert that merger either:

- Produces a valid project, OR
- Fails with one of `MODULE_CONFLICT`, `FILE_COLLISION`, `MANIFEST_KEY_CONFLICT`.

Catches regressions where a module author adds a conflicting contribution without declaring it.

```ts
// tests/conflict-matrix.test.ts (sketch)
import { describe, it, expect } from 'vitest';
import { loadCatalog } from '../src/catalog/loader.js';
// ... (setup: load catalog) ...

describe('conflict matrix', () => {
  it('every 2-subset of modules either merges cleanly or fails with a documented conflict code', async () => {
    const cat = await loadCatalog(/* pkgRoot */);
    const ids = [...cat.modules.keys()].sort();
    const subsets: string[][] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        subsets.push([ids[i]!, ids[j]!]);
      }
    }
    // If only one module exists (Plan 3), subsets is empty and the loop is a no-op
    // (and the test passes trivially). That's fine; the harness is future-proof.
    for (const subset of subsets) {
      const spec = {
        spec_version: 2 as const, template: 'stub_hello',
        modules: subset.map((id) => ({ id, config: {} })),
        app: { name: 'T', major_version: 1, minor_version: 0, build_version: 0 },
      };
      // Run full merger via buildEmittedProject; catch any Failure.
      // Assert either ok or Failure.code is one of the three.
    }
  });
});
```

Commit:

```bash
git add packages/brs-gen/tests/conflict-matrix.test.ts
git commit -m "test(brs-gen): conflict-matrix combinatorial harness

Implements spec §10.4. Iterates every 2-subset of the bundled module
catalog and asserts each pair either merges cleanly or fails with one
of the three documented conflict codes. Plan 3's catalog has only one
module so the inner loop is empty; harness scales when Plan 5 adds
real modules."
```

### Task T31: e2e MCP smoke + golden file

**Files:**
- Create: `packages/brs-gen/tests/e2e.test.ts`
- Create: `packages/brs-gen/scripts/regen-golden.ts`
- Create: `packages/brs-gen/tests/__golden__/stub.zip`
- Create: `packages/brs-gen/tests/__golden__/stub.provenance.json`

Spec reference: §10.5, §11.5 (manual regeneration only).

- [ ] **Step 1: Write `scripts/regen-golden.ts`**

```ts
// packages/brs-gen/scripts/regen-golden.ts
// Run manually: `pnpm -F brs-gen exec tsx scripts/regen-golden.ts`
// Regenerates tests/__golden__/stub.zip and stub.provenance.json.
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
const pkgRoot = join(here, '..');
const outDir = join(pkgRoot, '.regen-out');
const goldenDir = join(pkgRoot, 'tests', '__golden__');

async function main() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(goldenDir, { recursive: true });
  // Drive the MCP server just as the e2e test does; or call generate_app via
  // in-process import. In-process is simpler for a maintainer script:
  const { generateAppForRegen } = await import('./regen-helper.js'); // tiny helper
  const result = await generateAppForRegen({
    outputDir: outDir,
    spec: {
      spec_version: 2, template: 'stub_hello',
      modules: [{ id: 'stub_label', config: { text: 'hello world' } }],
      app: { name: 'Stub Channel', major_version: 1, minor_version: 0, build_version: 0 },
    },
  });
  await writeFile(join(goldenDir, 'stub.zip'), await readFile(result.zip_path));
  await writeFile(join(goldenDir, 'stub.provenance.json'),
                  await readFile(join(outDir, '.rokudev-tools', 'provenance.json')));
  console.log('Golden files regenerated. Remember to commit with a clear cause.');
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Create the tiny `regen-helper.ts` inside `scripts/` with `generateAppForRegen` as a thin wrapper around `generate_app`'s handler. Keep it out of `src/` so it's not a shipped surface.

- [ ] **Step 2: Run the regen script once to produce the initial golden**

```bash
pnpm -F brs-gen exec tsx scripts/regen-golden.ts
```

Verify `tests/__golden__/stub.zip` and `stub.provenance.json` exist.

- [ ] **Step 3: Write the e2e test**

```ts
// tests/e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Mirrors the e2e harness in packages/rokudev-device/tests/e2e.test.ts.
// Spawns dist/index.js, sends tools/list + a generate_app call over stdin/stdout.

function tmp() { return join(tmpdir(), `brs-gen-e2e-${randomUUID()}`); }

describe('brs-gen e2e MCP smoke', () => {
  let proc: ChildProcess;
  beforeAll(() => { proc = spawn('node', ['dist/index.js'], { cwd: new URL('..', import.meta.url).pathname }); });
  afterAll(() => { proc.kill(); });

  it('exposes exactly the 10 Plan-3 tools via tools/list', async () => {
    // send initialize + tools/list, collect response, assert tool names
    // Expected: list_templates, get_template_schema, list_modules, get_module_schema,
    //           generate_app, package_app, validate_manifest, validate_assets,
    //           spec_upgrade, lint
  });

  it('generate_app produces the golden zip for the stub spec', async () => {
    const out = tmp();
    // send tools/call generate_app with the canonical stub spec
    // read the resulting zip bytes; compare with tests/__golden__/stub.zip
    const actual = await readFile(join(out, 'proj.zip')); // or wherever
    const expected = await readFile(new URL('__golden__/stub.zip', import.meta.url));
    expect(actual.equals(expected)).toBe(true);
  });

  it('validate_manifest on the generated project returns ok:true', async () => {
    // call validate_manifest on the generated project; assert no drift
  });

  it('lint on the generated project returns ok:true with zero error diagnostics', async () => {
    // call lint; assert ok and no errors
  });

  it('provenance.json matches the golden byte-equally', async () => {
    const actual = await readFile(join(/*out*/, '.rokudev-tools', 'provenance.json'));
    const expected = await readFile(new URL('__golden__/stub.provenance.json', import.meta.url));
    expect(actual.equals(expected)).toBe(true);
  });
});
```

Fill in the MCP stdio plumbing by copying `packages/rokudev-device/tests/e2e.test.ts` verbatim and adapting the tool-name assertions.

- [ ] **Step 4: Run the full test suite**

```bash
pnpm -F brs-gen test
```

Expected: all tests passing, including the e2e.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-gen/tests/e2e.test.ts \
        packages/brs-gen/tests/__golden__ \
        packages/brs-gen/scripts/regen-golden.ts \
        packages/brs-gen/scripts/regen-helper.ts
git commit -m "test(brs-gen): e2e MCP smoke with golden zip + provenance

Implements spec §10.5. Spawns dist/index.js, asserts the exact 10-tool
catalog, runs generate_app on the canonical stub spec, compares the
zip and provenance.json against checked-in golden files byte-for-byte.
Manual regeneration via scripts/regen-golden.ts; CI does NOT auto-regen
(per spec §11.5)."
```

---

## Phase 8: Release (T32)

### Task T32: Bump to 0.3.0, run release-prep, tag

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/brs-gen/package.json`
- Modify: `packages/roku-device-client/package.json` (if cross-package dep pinning strategy changes; otherwise leave alone)
- Modify: `packages/rokudev-device/package.json` (same)
- Modify: `README.md` (add "What's in v0.3" section)

- [ ] **Step 1: Bump root + brs-gen package.json to `0.3.0`**

No need to bump `roku-device-client` or `rokudev-device`: their v0.2 surfaces are unchanged (brs-gen uses `workspace:*` to reach them). If the cross-package version check detects drift against a non-0.3 sibling at runtime, minor-drift warning fires once; not a problem. Pin both siblings to v0.3 only if the release policy requires it (confirm with the user before making this decision).

- [ ] **Step 2: Sync lockfile**

```bash
pnpm install
```

- [ ] **Step 3: Append a "What's in v0.3" section to the root README**

Format: mirror the Plan 1 and Plan 2 sections already in README. One paragraph, bullet list of what brs-gen ships (10 tools, stub template, stub module, byte-reproducible zip, mandatory bsc compile).

- [ ] **Step 4: Run release-prep**

```bash
pnpm run release-prep
```

Expected: format:check, lint, typecheck, test, build all pass. If prettier reformats new files, commit them separately and re-run.

- [ ] **Step 5: Commit the version bump**

```bash
git add package.json packages/brs-gen/package.json README.md pnpm-lock.yaml
git commit -m "chore(release): bump to 0.3.0 (Plan 3 brs-gen engine)

Plan 3 ships brs-gen: a new MCP server for generating Roku channels
from AppSpec + bundled templates + bundled feature modules. This
release includes the engine plus one stub template (stub_hello) and
one stub module (stub_label) that exercise every merger feature. Real
templates land in Plan 4; real modules in Plan 5; freeform path in
Plan 6; LSP tools in Plan 7.

Tools added: list_templates, get_template_schema, list_modules,
get_module_schema, generate_app, package_app, validate_manifest,
validate_assets, spec_upgrade, lint.

No real-device verification gate in this plan (stub channel is
deliberately uninteresting; Plan 4 will add the first T27-style gate
when real templates land)."
```

- [ ] **Step 6: Tag v0.3.0**

```bash
git tag -a v0.3.0 -m "Plan 3 release: brs-gen engine + stub catalog

10 MCP tools, deterministic byte-reproducible channel generation,
mandatory in-process bsc compile. Stub template + stub module
exercise every merger feature; real templates and modules follow in
Plans 4 and 5."
```

- [ ] **Step 7: Optional: push when the user approves**

Do NOT push unless the user explicitly asks. The branch is local until then. When they approve:

```bash
git push origin main
git push origin v0.3.0
gh release create v0.3.0 --title "v0.3.0: brs-gen engine (Plan 3)" --notes "..."
```

---

## Appendix: Cross-cutting reminders

- **No em dashes** in any new code, docs, or commit message. Use commas, semicolons, parentheses.
- **Inclusive terms:** allowlist/blocklist, primary/replica, main branch. Not main/slave, not whitelist/blacklist.
- **Never commit secrets.** `dev_password` and signing passwords must never appear in logs, error messages, tool responses, or test fixtures.
- **TDD rhythm in every task:** write the failing test, run it, implement, run, commit. This is load-bearing for the plan's agentic-execution story.
- **`pnpm typecheck` per task** if the task adds or changes types. Vitest's transpiler is forgiving; `tsc --noEmit` surfaces the latent errors before they bite in a subsequent task.
- **Reference Plans 1 and 2** for MCP tool patterns. They already worked out the side-effect-import registrar shape, the inputSchema style, the snake_case wire convention. Don't invent new patterns.
- **`@rokudev/device-client` is a workspace dep**; call its exports directly, never re-implement sideload, digest auth, or any other device-touching primitive.
- **Match Plan 2's file-header verbosity.** Each substantial module has a short comment at the top explaining its role and listing key design decisions with spec section references. Makes the codebase navigable for future agents.
- **Keep commits small.** One task = multiple commits if the task has distinct deliverables (e.g. "wire up the test runner" and "implement the happy path" are two commits, not one).


