# brs-gen engine design (Plan 3)

**Status:** Draft for review
**Date:** 2026-05-08
**Author:** brainstorming session, 2026-05-08
**Scope:** Plan 3 = engine only. Stub template + stub module. No real templates, modules, freeform path, or LSP tools.
**Parent spec:** `docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md` (the rokudev-tools PRD)
**Implements:** PRD §3.1, §3.2, §3.4, §3.5, §3.6, §3.7 (subset of `brs-gen` tool surface)

## 0. Background and scope

### 0.1 Why an "engine only" plan

The PRD locks brs-gen as a TypeScript Node MCP server that generates Roku channels from a declarative `AppSpec`. The eventual surface is large: six base templates, six or more feature modules, two generation paths (deterministic Path A and freeform Path B), and an optional LSP integration. Each of those subsystems can be designed, built, and shipped on its own. Building them all in one plan would create an 80 to 120 task plan; Plan 1 and Plan 2 each ran 28 to 37 tasks and that proved manageable.

Plan 3 ships the engine and tool surface that everything else plugs into:

- AppSpec validation (Zod internally, JSON Schema externally).
- Catalog loading (`template.toml`, `module.toml`) with bundled-only discovery.
- The merger: conflict detection, init-order topo sort, wiring contract validation.
- Rendering (EJS for templates, static-plus-config for modules).
- Pre-zip `bsc` compile (in-process via the `brighterscript` npm package).
- Deterministic write and zip.
- Optional sideload via the existing `@rokudev/device-client/devPortal.sideload()`.

The catalog ships with exactly one stub template and one stub module so the merger has something to exercise. Real templates, real modules, freeform path, and LSP tools are deferred to later plans (Plans 4 through 7).

### 0.2 Decisions locked during brainstorming (2026-05-08)

These were chosen by the user from multi-choice questions and are inputs to this design, not open questions:

| Decision | Locked answer |
|---|---|
| Plan 3 scope | Engine only with stub template + stub module |
| Catalog discovery | Bundled-only (no env-var search paths, no registry fetch) |
| AppSpec data flow | Templates use EJS rendering. Modules ship static files plus a merger-emitted `config.bs` |
| `bsc` invocation | In-process via `brighterscript` npm dependency |
| Source language | Author in `.bs`, ship compiled `.brs` plus source maps |
| Hook wiring mechanism | Merger-generated dispatch functions in `source/_modules/__init_hooks.bs` |

### 0.3 What is out of scope

- Real base templates (`screensaver`, `video_grid_channel`, `news_channel`, `game_shell`, `blank_scenegraph`, `music_player`). All deferred to Plan 4.
- Real feature modules (`monetization.roku_pay.subscription`, `ads.raf_ssai`, `ads.raf_csai`, `auth.device_link_code`, `auth.roku_os_signin`, `analytics.event_pipe`, `deep_link.global`). Deferred to Plan 5.
- `freeform_session_open`, `freeform_session_close`, lint-gate file logic, smoke fingerprint integration. Deferred to Plan 6.
- `lsp_open_workspace`, `lsp_close_workspace`, `lsp_diagnostics`, `lsp_hover`, `lsp_definition`, `lsp_references`, `lsp_document_symbols`, `lsp_workspace_symbols`. Deferred to Plan 7.
- `roku_dev_loop` composite tool (lives in `rokudev-device`, not `brs-gen`).
- AppSpec `assets_root` validation logic beyond stub passthrough (real templates will define their own asset rules).

## 1. Architecture and package layout

### 1.1 Package location

`packages/brs-gen/` in the existing `rokudev-tools` monorepo. New workspace member alongside `roku-device-client` (the shared library) and `rokudev-device` (the device MCP).

Naming policy (per memory): npm package is `brs-gen` (no scope prefix); the bin / MCP server name is `brs-gen`. This is BRS-specific; a future RTS counterpart will be `rts-gen`. Device-touching code stays language-agnostic in `rokudev-device`.

### 1.2 Internal submodule structure

Seven submodules, each independently testable, with hard-walled responsibilities:

```
packages/brs-gen/
  src/
    bootstrap/              MCP server entry, version-check.
    spec/                   AppSpec Zod schema + v1->v2 promotion + JSON-Schema export.
    catalog/                template.toml & module.toml loaders, manifest-key strategies.
    merger/                 Pure: takes (spec, template, modules) -> EmittedProject.
    render/                 EJS rendering for templates, config.bs emission for modules.
    build/                  Filesystem write, bsc compile, deterministic zip.
    tools/                  Thin MCP tool registrars (one file per tool).
    util/                   Errors, deterministic helpers (sortByPath, normalizeText, etc.).
  templates/
    stub_hello/             Bundled stub template.
  modules/
    stub_label/             Bundled stub module.
  tests/                    Unit, snapshot, determinism, conflict-matrix, e2e MCP smoke.
```

Boundary rules:

- `spec/` knows nothing about templates or modules; it only validates the wrapper schema and dispatches per-template payload validation to `catalog/`.
- `catalog/` is read-only at runtime. All catalog files are loaded and validated at startup; the runtime exposes immutable handles. A malformed `module.toml` makes the server fail fast on startup, not silently mid-generation.
- `merger/` is pure: it takes deserialized inputs and returns an in-memory `EmittedProject` (a sorted list of `{path, content}` records plus a manifest map plus a provenance record). No filesystem I/O, no network, no logging at module scope.
- `render/` is also pure: receives a template and AppSpec, returns rendered file bytes.
- `build/` is the only submodule that touches the filesystem, runs `bsc`, or produces zip output. This is the one place determinism guarantees materialize.
- `tools/` is thin glue between MCP request and the pipeline.

### 1.3 Dependencies

- `@rokudev/device-client` (workspace `*`): for `devPortal.sideload()` only. brs-gen never opens an HTTP socket, telnet socket, or BDP socket directly.
- `brighterscript` (pinned, e.g. `^0.69.0`): for in-process `Program.validate()` and `Program.build()`.
- `zod` (pinned, e.g. `^3.23.8`): AppSpec internal schemas. Already used by brs-mcp and the rest of the monorepo.
- `zod-to-json-schema` (pinned, e.g. `^3.23.0`): conversion for the public `get_*_schema` MCP tools.
- `ajv` (pinned, e.g. `^8.16.0`): JSON Schema Draft 7 validation for module configs.
- `ejs` (pinned, e.g. `^3.1.10`): template rendering.
- `@iarna/toml` or `smol-toml` (pinned): TOML parsing for `template.toml` and `module.toml`.
- `yazl` (pinned): deterministic zip output.
- `semver` (pinned): version range comparisons.
- `@modelcontextprotocol/sdk` (already used by `rokudev-device`): MCP server boilerplate.

No runtime dep on `rokudev-device` (peer MCP). Cross-package version check at startup uses the same mechanism rokudev-device uses (`checkSiblings(import.meta.url)` against `@rokudev/device-client`).

### 1.4 Bootstrap

`bootstrap/` mirrors `rokudev-device`:

- `index.ts` exports `runServer()`, walked by the bin shim.
- Module-load side effects collect tool registrars (one per file in `tools/`).
- Version check: read `@rokudev/device-client/package.json` via `createRequire`. Major drift fails every tool call with `CROSS_PACKAGE_VERSION_MISMATCH`. Minor drift attaches a one-shot warning to the first response. Same semantics as `rokudev-device`.
- Catalog loading runs at startup. Any `template.toml` or `module.toml` parse error fails the bootstrap with a `CATALOG_INVALID` error visible in the MCP `initialize` response (server starts but every tool call fails until the catalog is fixed).

## 2. MCP tool surface

Plan 3 ships exactly the following ten tools. The list is closed; the e2e test asserts it.

### 2.1 Catalog readers

#### `list_templates`

Input: `{}`.
Output: `{ templates: Array<{ id: string; version: string; description: string }> }`.
Sorted by `id` ascending.

#### `get_template_schema`

Input: `{ id: string }`.
Output: `{ id: string; version: string; spec_compat: string; schema: JSONSchema7; example_spec: object }`.
The `schema` is a JSON Schema Draft 7 envelope describing a complete AppSpec for that template (including the wrapper fields `spec_version`, `template`, `modules`, plus per-template payload). `example_spec` is a minimal valid AppSpec the agent can use as a starting point.
Errors: `UNKNOWN_TEMPLATE` if `id` not in catalog.

#### `list_modules`

Input: `{}`.
Output: `{ modules: Array<{ id: string; version: string; description: string; spec_compat: string }> }`.
Sorted by `id` ascending.

#### `get_module_schema`

Input: `{ id: string }`.
Output: `{ id: string; version: string; spec_compat: string; config_schema: JSONSchema7; example_config: object; wiring: { exports: Array<...>; requires: Array<...> } }`.
Errors: `UNKNOWN_MODULE` if `id` not in catalog.

### 2.2 Generation

#### `generate_app`

Input:
```ts
{
  spec: AppSpec | string;          // accepts inline JSON or a file path
  output_dir: string;
  assets_root?: string;
  overwrite?: boolean;             // default false
  zip?: boolean | { output_zip?: string };  // default false
  sideload?: { device: string; dev_password?: string };  // default unset
}
```

Output:
```ts
{
  ok: true;
  project_dir: string;
  files_written: number;
  bytes_written: number;
  manifest_keys: string[];
  init_order: string[];
  zip_path?: string;
  zip_bytes?: number;
  sideload?: { status: "installed" | "identical" | "skipped"; http_code: number };
  details?: { warnings?: Warning[] };
}
```

Errors: any of the closed-set error codes in §6.

The `freeform` AppSpec field (if present) is rejected with `NOT_IMPLEMENTED` in Plan 3. Plan 6 will add freeform handling.

#### `package_app`

Input: `{ project_dir: string; output_zip?: string }`.
Output: `{ ok: true; zip_path: string; zip_bytes: number; entry_count: number }`.
Pure repackage: takes an existing project tree (typically one already produced by `generate_app`) and produces a deterministic zip. Validates that the project has a top-level `manifest` file before zipping; otherwise refuses with `MANIFEST_VALIDATION_FAILED`.

### 2.3 Validation

#### `validate_manifest`

Input: `{ project_dir: string }`.
Output: `{ ok: true; manifest_keys: string[]; provenance: ProvenanceRecord; drift?: ManifestDrift }`.
Reads the project's `manifest` file and `.rokudev-tools/provenance.json`, cross-checks the manifest against what provenance says it should be (which template, which modules, which manifest keys). Reports drift when the user has hand-edited the manifest after generation. Drift is a warning, not a failure.

#### `validate_assets`

Input: `{ project_dir: string; assets_root?: string }`.
Output: `{ ok: boolean; missing: string[]; oversize: Array<{path,limit}>; wrong_dimensions: Array<{path,expected,actual}> }`.
For Plan 3 with only the stub template, the rule set is minimal (manifest-referenced images must exist on disk, must be PNG, must be under 1MB). Real templates in Plan 4 will extend the rule set per template.

### 2.4 Versioning

#### `spec_upgrade`

Input: `{ file_path: string; in_place?: boolean }`.
Output: `{ ok: true; spec_version_before: 1 | 2; spec_version_after: 2; written_to: string; diff?: string }`.
Reads the AppSpec, applies the v1 to v2 promotion (insert `modules: []`, set `spec_version: 2`), writes the result. Default writes to a sibling file with `.v2.json` suffix; `in_place: true` overwrites. The original is never silently mutated.

### 2.5 Lint

#### `lint`

Input: `{ project_dir: string }`.
Output: `{ ok: boolean; diagnostics: Array<{ severity: "error"|"warning"; code: string; message: string; file: string; line: number; col: number }> }`.
Runs `bsc` `Program.validate()` over the project, returns diagnostics. `ok` is true only when no diagnostic has severity `"error"`. Used by both `generate_app` (internally, mandatory before zip) and Plan 6's freeform-session lint gate.

### 2.6 Deferred tools

Not in Plan 3 (return `NOT_IMPLEMENTED` if any user tries to call them as if they existed):

- `freeform_session_open`, `freeform_session_close` (Plan 6).
- `lsp_*` (Plan 7).

The MCP `tools/list` response in Plan 3 omits these entirely (the e2e test asserts the exact 10-tool catalog).

## 3. Data contracts

### 3.1 AppSpec

JSON file or in-memory object. Wrapper schema is fixed; per-template fields are validated by the named template.

```json
{
  "spec_version": 2,
  "template": "stub_hello",
  "modules": [
    {
      "id": "stub_label",
      "version_range": ">=0.1.0 <1.0.0",
      "config": { "text": "hello world" }
    }
  ],
  "app": {
    "name": "Stub Channel",
    "major_version": 1,
    "minor_version": 0,
    "build_version": 0
  }
}
```

Fields:

- `spec_version: 1 | 2`. v1 is silently promoted in-memory by inserting `modules: []`. The promotion attaches a `SPEC_AUTO_PROMOTED` warning to the response. The on-disk file is not mutated by `generate_app`; only `spec_upgrade` writes promoted form to disk.
- `template`: required string. Preflight-validated against the bundled catalog before Zod parses anything else, so `UNKNOWN_TEMPLATE` errors mention the bad name (rather than a generic union mismatch).
- `modules`: array of module references. v1 specs implicitly carry `[]`; v2 specs make it explicit. Each entry has `id`, optional `version_range` (defaults to the latest installed; defaulting attaches a `MODULE_VERSION_UNPINNED` warning), and a typed `config` object validated against the module's `config_schema`.
- `app`: standard channel metadata (`name`, `major_version`, `minor_version`, `build_version`). Required for all templates.
- Per-template fields (e.g. `branding` for `video_grid_channel`): defined by the template's bundled Zod schema, merged into the wrapper at parse time.

Validation is strict; extra fields are rejected.

### 3.2 template.toml

Bundled with each base template under `templates/<id>/template.toml`.

```toml
[template]
id = "stub_hello"
version = "0.1.0"
spec_compat = ">=1"                # accepts AppSpec v1 and v2
description = "Minimal channel for engine smoke testing"

[template.exports]
init_hooks = [
  { scope = "Main", phase = "before_scene_show",
    file = "source/Main.bs",
    signature = "(args as dynamic) as void" }
]
scene_nodes = [
  { name = "MainScene", file = "components/MainScene.xml" }
]

[template.manifest_defaults]
title              = "{{ spec.app.name }}"
splash_color       = "#000000"
mm_icon_focus_hd   = "pkg:/images/icon_hd.png"
mm_icon_focus_fhd  = "pkg:/images/icon_fhd.png"
ui_resolutions     = "fhd"
```

Fields:

- `template.id`, `template.version`, `template.spec_compat` (semver range), `template.description`.
- `template.exports.init_hooks`: closed set of `(scope, phase)` pairs the merger can generate dispatch functions for. Each hook lists the file it lives in and a signature describing what arguments the dispatch function takes.
- `template.exports.scene_nodes`: scene-graph nodes the template provides. Modules can require these.
- `template.manifest_defaults`: manifest keys the template provides. Values may be plain strings or single-pair EJS expressions evaluated against the AppSpec at generate time. Module manifest deltas merge into these per the strategy table.
- (Optional) `template.supported_modules.allowlist`: empty or omitted means "all wiring-compatible modules accepted". When non-empty, only listed module ids are accepted.

### 3.3 module.toml

Bundled with each feature module under `modules/<id>/module.toml`.

```toml
[module]
id = "stub_label"
version = "0.1.0"
spec_compat = ">=2"
description = "Prints a configurable label string at channel start."

[module.config_schema]              # JSON Schema Draft 7
type = "object"
required = ["text"]
properties = { text = { type = "string", minLength = 1 } }
additionalProperties = false

[module.files]
add = ["source/_modules/stub_label/Init.bs"]

# (optional) [module.manifest] block; stub_label has no manifest contributions

[module.wiring]
exports = []
requires = [
  { kind = "init_hook", scope = "Main", phase = "before_scene_show" }
]
init_calls = [
  { hook = "Main.before_scene_show",
    statement = "StubLabel_init(args)" }
]

[module.ordering]
before = []
after  = []

[module.conflicts]
exclusive_with = []
```

Fields:

- `module.id` (dotted reverse-DNS-style for namespace clarity), `module.version`, `module.spec_compat`, `module.description`.
- `module.config_schema`: JSON Schema Draft 7. The PRD mandates JSON Schema (not Zod) here so module authors can inspect and document it without reading TypeScript. `additionalProperties: false` is conventional but not required by the loader.
- `module.files.add`: static file paths relative to the module dir; copied verbatim into the project tree at the same relative paths.
- `module.manifest`: optional manifest deltas; each key must have an entry in the strategy table or it fails at merge time with `UNKNOWN_MANIFEST_KEY`.
- `module.wiring.exports`: optional things the module makes available to other modules (e.g. helper functions, scene-graph nodes). Empty for v1 modules; reserved for future cross-module composition.
- `module.wiring.requires`: hooks and scene nodes the module needs the template to provide. Validated at merge time.
- `module.wiring.init_calls`: literal BrightScript statements the merger inserts into the named hook's dispatch function. Statement-level validity is left to `bsc` (the merger does not parse statements).
- `module.ordering`: directed edges for topo sort. Cycles fail with `INIT_ORDER_CYCLE`.
- `module.conflicts.exclusive_with`: list of module ids this module cannot coexist with. Symmetric declarations are expected; one-sided declarations raise an `ASYMMETRIC_CONFLICT` warning during catalog load.

### 3.4 Provenance record (`.rokudev-tools/provenance.json`)

Emitted into every generated project. Deterministic.

```json
{
  "spec_version": 2,
  "template": { "id": "stub_hello", "version": "0.1.0" },
  "modules": [
    { "id": "stub_label", "version": "0.1.0",
      "files": ["source/_modules/stub_label/Init.bs",
                "source/_modules/stub_label/config.bs"] }
  ],
  "init_order": ["stub_label"],
  "manifest_keys": ["title", "splash_color", "mm_icon_focus_hd",
                    "mm_icon_focus_fhd", "ui_resolutions"],
  "brs_gen_version": "0.3.0"
}
```

Sorted keys at every nesting level. Sorted arrays. No clock or hostname fields. The file is included in the final zip so installed channels can be introspected.

## 4. Generation pipeline

End-to-end algorithm executed by `generate_app`. Steps 1 through 8 are pure (no I/O). Steps 9 through 12 are the only places brs-gen touches the filesystem, the network, or external processes.

```
1.  Parse + preflight                spec/preflight.ts
2.  Load template + modules          catalog/loader.ts
3.  Validate spec_compat             catalog/compat.ts
4.  Validate per-module config       catalog/validate-config.ts
5.  Conflict + exclusive-with check  merger/conflicts.ts
6.  Topo-sort init order             merger/init-order.ts
7.  Validate wiring contracts        merger/wiring.ts
8.  Build EmittedProject (in mem)    merger/build.ts + render/*
9.  Write project tree to disk       build/write.ts
10. bsc compile (in process)         build/compile.ts
11. Deterministic zip                build/zip.ts
12. Optional sideload                @rokudev/device-client devPortal.sideload()
```

### 4.1 Step-by-step

1. **Parse and preflight.** Read JSON, then preflight-check `template` against the bundled catalog. Wraps the Zod parse so `UNKNOWN_TEMPLATE` is reported with the offending name. v1 specs auto-promote; the result is logged in `details.warnings`.

2. **Load template and modules.** Catalog handles were validated at startup; this step looks up `templates.get(spec.template)` and `modules.get(m.id)` for each `m` in `spec.modules`. Missing module raises `UNKNOWN_MODULE`. Version range resolution: if `m.version_range` is provided, the loader picks the highest installed version satisfying the range; if no version satisfies, raise `MODULE_VERSION_UNAVAILABLE`. If `m.version_range` is omitted, the loader picks the latest installed version and attaches a `MODULE_VERSION_UNPINNED` warning.

3. **Validate spec_compat.** AppSpec `spec_version` is coerced to `<n>.0.0`. The semver range from the template's `spec_compat` and from each module's `spec_compat` must accept it. Failures raise `SPEC_VERSION_INCOMPATIBLE` with a `details.rejected_by` field listing which side rejected.

4. **Validate per-module config.** For each module reference in the spec, run `ajv` over its `config` block against the module's `config_schema`. Failures raise `MODULE_CONFIG_INVALID` with the JSON Pointer to the bad field.

5. **Conflict + exclusive-with check.** For every pair of modules, if either declares the other in `exclusive_with`, raise `MODULE_CONFLICT`. File-path collisions across modules (or template-and-module) raise `FILE_COLLISION`. Asymmetric `exclusive_with` (A says B, B does not say A) is tolerated as long as either side flags the pair; emit an `ASYMMETRIC_CONFLICT` warning.

6. **Topo-sort init order.** Edges from `before` and `after` constraints. Cycles raise `INIT_ORDER_CYCLE` with the cycle path. Tie-breaker is module-id lexical order, so the same module set always produces the same order.

7. **Validate wiring contracts.** Every `requires` entry across all modules must resolve to an `exports` entry on the template. `init_calls[i].hook` must reference a `(scope, phase)` listed in `template.exports.init_hooks`. Failures raise `WIRING_CONTRACT_VIOLATION`.

8. **Build EmittedProject.** Returns an in-memory record:

   ```ts
   type EmittedProject = {
     readonly files: ReadonlyArray<{ path: string; content: Buffer | string }>;
     readonly manifest: ReadonlyMap<string, string>;
     readonly provenance: ProvenanceRecord;
   };
   ```

   Sub-steps, all pure:

   1. **Render template files.** EJS render every `.bs`, `.brs`, `.xml` file in the template's `files/` dir using `{spec, helpers, meta}`. Binary files pass through unchanged. Text files are normalized to LF, UTF-8, no BOM. Helpers are imported from `templates/helpers.ts` and exposed under `helpers`. `meta` carries `brs_gen_version` and `template_version`; it never carries wall-clock or hostname.
   2. **Copy module files** verbatim. Each module's `files.add` paths are read from the bundled module dir and added to the emitted project at the same relative paths.
   3. **Emit per-module config.bs.** For each module, write `source/_modules/<id>/config.bs` containing one function `function ModuleConfig_<id>() as object` that returns the validated config as a deterministically-serialized AssociativeArray literal. Keys sorted; strings escaped; no comments.
   4. **Emit `__init_hooks.bs`.** One sub per template-declared `(scope, phase)`. Each sub's body is the literal sequence of `init_calls[i].statement` strings from sorted-by-init-order modules whose `init_calls[i].hook` matches the sub's `(scope, phase)`. Empty hooks emit empty subs (no special-casing).
   5. **Merge manifest.** Start from `template.manifest_defaults` (EJS-evaluated against the spec). Apply each module's `[module.manifest]` block per the per-key strategy table. Strategy violations raise `MANIFEST_KEY_CONFLICT`. Keys not in the strategy table raise `UNKNOWN_MANIFEST_KEY`.
   6. **Build provenance record.** `{spec_version, template, modules, init_order, manifest_keys, brs_gen_version}`. Sorted keys, sorted arrays, no clock or host.
   7. **Sort the file list by path.** Canonical order for write and zip.

9. **Write project tree to disk.** Atomic via tmpdir + `fs.rename`. Manifest is written from the merged map (sorted lines, `key=value\n`). Existing `output_dir` is rejected with `OUTPUT_DIR_NOT_EMPTY` unless `overwrite: true`; in `overwrite` mode, the tmpdir replaces `output_dir` in one rename. `assets_root` (if provided) is resolved per template asset rules and asset files are copied verbatim. Provenance is written to `.rokudev-tools/provenance.json`.

10. **bsc compile (in process).** Construct a `brighterscript` `Program` against the written project. Call `program.validate()`. If any diagnostic has severity `"error"`, abort with `LINT_FAILED` (diagnostics surfaced in `details`). Otherwise call `program.build()` to transpile `.bs` files to `.brs`. Diagnostics with severity `"warning"` flow through as `BSC_LINT_WARNING` warnings in the response. Source maps land under `.rokudev-tools/sourcemaps/<source-path>.brs.map`.

11. **Deterministic zip.** `yazl` with the `STORED` method (no compression), entries sorted by path, DOS mtime pinned to `1980-01-01T00:00:00Z`. The zip excludes `.rokudev-tools/sourcemaps/` (development-only artifact). The zip includes `.rokudev-tools/provenance.json` (installed-channel introspection). Output path defaults to `<output_dir>.zip`; `zip.output_zip` overrides.

12. **Optional sideload.** If `sideload` is supplied, call `@rokudev/device-client/devPortal.sideload()` directly (in-process). Per PRD §2.2, `brs-gen` imports the shared library; no MCP-to-MCP round trip. `dev_password` resolution follows the same precedence as `rokudev-device` (per-call > per-device env > registry > global env). The password never appears in the response.

### 4.2 What `package_app` does differently

`package_app` re-runs steps 11 only, on an existing project tree. It does not re-render, does not re-merge, does not re-compile. It validates the project has a top-level `manifest` file and refuses with `MANIFEST_VALIDATION_FAILED` otherwise. Used for "I generated it earlier; just give me the zip" workflows.

## 5. Wiring contract details

### 5.1 Hook scopes and phases

A hook is identified by a `(scope, phase)` pair. The template's `template.exports.init_hooks` lists every hook the template provides and the file each hook lives in. Examples:

- `(scope = "Main", phase = "before_scene_show")` for `source/Main.bs`.
- `(scope = "MainScene.init", phase = "before_content_load")` for `components/MainScene.bs`.

The phase is a free-form string scoped to the template; templates document their phases in `template.toml` and cannot invent new phases at runtime. The merger does not validate phase string syntax; it just compares strings.

### 5.2 Generated dispatch functions

For each `(scope, phase)` in `template.exports.init_hooks`, the merger generates one `sub` in `source/_modules/__init_hooks.bs`. Naming convention: `Modules_On<Scope><Phase>` with non-alphanumerics dropped and PascalCase applied. Example: `(Main, before_scene_show)` becomes `Modules_OnMainBeforeSceneShow`. The signature is taken from `template.exports.init_hooks[i].signature`.

Body is the literal sequence of `init_calls[i].statement` strings, one per line, in topo-sorted order. Each statement is followed by a `\n`. The merger does not insert error handling (the channel author is expected to use `try`/`catch` inside their module init if they need it).

### 5.3 Template invocation convention

The template's source files call the generated dispatch functions at the appropriate point. For `stub_hello`, `source/Main.bs` calls `Modules_OnMainBeforeSceneShow(args)` immediately before showing the main scene. The template author writes this call by hand; the merger does not edit template source.

If the template forgets to call a dispatch function, the modules silently do not run. We catch this at merge time by emitting a warning when a hook has registered modules but the merger cannot prove the call exists (this proof is best-effort: it greps the template source for the dispatch-function name; absence raises `HOOK_DISPATCH_NOT_INVOKED` warning, not error, so templates can opt out).

### 5.4 Conflict detection

Three classes of conflict:

1. **`exclusive_with`** (declared in `module.toml`). Symmetric: if either side declares the other, the merger refuses. One-sided declarations emit `ASYMMETRIC_CONFLICT` warning.
2. **`FILE_COLLISION`**. Two modules (or template + module) try to add the same path. Always an error.
3. **Manifest strategy violations** (see §7). E.g. two modules with `set` strategy on the same key with different values.

There is no automatic detection of semantic conflicts beyond these three. Modules that mutate global state in conflicting ways at runtime are the responsibility of module authors and reviewers.

### 5.5 Init order

Topological sort over `before` and `after` edges. Tie-breaker: module-id lexical order. The PRD's `analytics.event_pipe` example ordering ("after auth, before everything-else-that-needs-user-context") is encoded as `before = ["analytics.event_pipe"]` on `auth.device_link_code` and `after = ["auth.device_link_code"]` on `analytics.event_pipe` (or either side alone is sufficient).

Cycles raise `INIT_ORDER_CYCLE` with the cycle path in `details.cycle`.

## 6. Error model

Closed enum. Every error carries `code`, `stage`, `message`, optional `details` of structured fields, never raw strings parsed back into context.

| Code | Stage | When |
|---|---|---|
| `UNKNOWN_TEMPLATE` | `preflight` | `spec.template` not in catalog |
| `UNKNOWN_MODULE` | `catalog` | `modules[i].id` not in catalog |
| `APP_SPEC_INVALID` | `parse` | Zod validation failed |
| `SPEC_VERSION_INCOMPATIBLE` | `compat` | template/module rejects this `spec_version` |
| `MODULE_CONFIG_INVALID` | `config-validate` | per-module ajv validation failed |
| `MODULE_VERSION_UNAVAILABLE` | `catalog` | `version_range` matches no installed module |
| `MODULE_CONFLICT` | `conflicts` | `exclusive_with` violation |
| `FILE_COLLISION` | `conflicts` | two contributors add the same path |
| `INIT_ORDER_CYCLE` | `init-order` | cyclic before/after constraints |
| `WIRING_CONTRACT_VIOLATION` | `wiring` | required hook or scene-node not exported |
| `MANIFEST_KEY_CONFLICT` | `merge-manifest` | strategy violation |
| `UNKNOWN_MANIFEST_KEY` | `merge-manifest` | manifest key not in strategy table |
| `OUTPUT_DIR_NOT_EMPTY` | `write` | `output_dir` exists and `overwrite` not set |
| `LINT_FAILED` | `compile` | bsc reported error-level diagnostics |
| `COMPILE_FAILED` | `compile` | bsc transpile failed |
| `ASSET_VALIDATION_FAILED` | `validate-assets` | `validate_assets` found problems |
| `MANIFEST_VALIDATION_FAILED` | `validate-manifest` | `validate_manifest` found drift or missing manifest |
| `CATALOG_INVALID` | `bootstrap` | a `template.toml` or `module.toml` failed to load |
| `CROSS_PACKAGE_VERSION_MISMATCH` | `bootstrap` | major drift against `@rokudev/device-client` |
| `NOT_IMPLEMENTED` | `tool` | freeform / LSP tools attempted in Plan 3 |

Warnings (no `Failure`; surfaced in `result.details.warnings`):

- `ASYMMETRIC_CONFLICT`
- `MODULE_VERSION_UNPINNED`
- `BSC_LINT_WARNING`
- `SPEC_AUTO_PROMOTED`
- `HOOK_DISPATCH_NOT_INVOKED`
- `MANIFEST_DRIFT` (from `validate_manifest`)

## 7. Manifest-key strategy table

Hardcoded in `src/catalog/manifest-key-strategies.ts`. Closed for v1; new keys require a `brs-gen` patch release with a regression test (this is by design per PRD §3.2.4: an unrecognized manifest key is more often a typo than a new feature).

| Key(s) | Strategy | Behavior |
|---|---|---|
| `title`, `subtitle`, `splash_color`, `splash_min_time`, `ui_resolutions` | `set` | Single owner. Conflicting `set` from two contributors raises `MANIFEST_KEY_CONFLICT` |
| `major_version`, `minor_version`, `build_version` | `set` (template-only) | Modules cannot contribute these. AppSpec `app.*` populates them |
| `mm_icon_focus_hd`, `mm_icon_focus_fhd`, `splash_screen_hd`, `splash_screen_fhd`, `splash_screen_uhd`, `splash_screen_shd`, `mm_icon_side_hd`, `mm_icon_side_fhd` | `set-if-unset` | Template provides default; module can override; two modules cannot both override |
| `bs_const`, `supports_input_launch` | `append-csv` | Append-as-comma-separated, deduped, sorted |
| `requires_billing` | `set-if-unset` with logical-or convergence | `true` wins; conflicting `false` ignored |

Anything not in this table raises `UNKNOWN_MANIFEST_KEY`. Adding a new entry is a normal `brs-gen` patch.

## 8. Determinism guarantees

A fixed `(AppSpec, template version, module versions, brs-gen version)` produces:

- **Byte-equal project tree**: every file path and content is the same.
- **Byte-equal merged manifest**: keys sorted, no clock or host fields.
- **Byte-equal `provenance.json`**: keys and arrays sorted; no clock or host.
- **Byte-equal compiled `.brs` and `.brs.map`** output, assuming `brighterscript` is deterministic. We verify this with a "compile twice, diff bytes" test (§10.2). If the test fails on a future `brighterscript` upgrade, we file a bug upstream and pin the previous version until fixed.
- **Byte-equal zip**: `STORED` (no compression), entries sorted by path, DOS mtime pinned to `1980-01-01T00:00:00Z`.

The deterministic guarantee applies only to `generate_app` (Path A). Plan 6's freeform path is explicitly nondeterministic and does not provide this guarantee (per PRD §2.3).

`assets_root` files pass through verbatim. If the user provides different asset bytes, the project tree differs as expected. The guarantee is "same inputs produce same outputs," not "outputs are independent of inputs."

## 9. Stub catalog (Plan 3 deliverable)

The catalog ships exactly one stub template and one stub module. Together they exercise every merger feature exactly once and form the basis of the e2e test.

### 9.1 `stub_hello` template

Files in `templates/stub_hello/`:

```
template.toml
files/
  manifest.ejs                       title=<%= spec.app.name %>...
  source/
    Main.bs                          calls Modules_OnMainBeforeSceneShow(args)
  components/
    MainScene.xml
    MainScene.bs
  images/
    icon_hd.png                      placeholder PNG, 290x218
    icon_fhd.png                     placeholder PNG, 336x210
    splash_hd.png                    placeholder PNG, 1280x720
    splash_fhd.png                   placeholder PNG, 1920x1080
schema.ts                            Zod schema (just app.name, no per-template fields)
```

`template.toml` declares one init hook `(Main, before_scene_show)` and one scene node `MainScene`. `source/Main.bs` opens the main scene and calls `Modules_OnMainBeforeSceneShow(args)` before scene-show; `MainScene.bs` has an empty `init()`.

Compiles cleanly with `bsc`. Sideloads cleanly to a Roku in dev mode. Renders a black screen with the channel title (Plan 4 will add real visual content for real templates).

### 9.2 `stub_label` module

Files in `modules/stub_label/`:

```
module.toml
files/
  source/_modules/stub_label/
    Init.bs                          sub StubLabel_init(args) ... print ... end sub
```

`module.toml` requires `(Main, before_scene_show)`, contributes one file, takes one config field `text: string`. `Init.bs` reads `m.global.modules.stub_label.config.text` (which is set by `ModuleConfig_stub_label()`) and prints it to the BrightScript debug stream. Installs a registry of module configs onto `m.global` at startup.

`config.bs` is emitted by the merger from the AppSpec config; the user does not author it.

This minimally exercises:

- Template loading and EJS rendering.
- Module loading and config validation.
- Manifest merge (no conflicts: stub_label contributes no manifest keys).
- Wiring contract (init hook required, init hook exported).
- Init dispatch generation (one statement, one hook).
- `bsc` compile of mixed template-EJS-rendered and module-static `.bs` files.
- Provenance emission.
- Deterministic zip.

## 10. Testing strategy

Five layers, each with a different purpose. Total target: 200 to 300 tests.

### 10.1 Unit tests

For every module in `spec/`, `catalog/`, `merger/`, `render/`, `build/zip.ts`, `build/write.ts`, `build/compile.ts`. Standard vitest, `pool: 'forks'` per the project convention. Each error code in §6 has at least one test that produces it.

### 10.2 Determinism tests

Three tests, all in `tests/determinism.test.ts`:

1. **Pure-merger byte equality.** Render the stub catalog twice in the same process; assert the `EmittedProject` records are deep-equal.
2. **Wall-clock invariance.** Render once, fast-forward `Date.now`, render again; assert byte-equal output (catches any sneaky `Date.now()` leaks).
3. **bsc compile byte equality.** Run `bsc` `program.build()` twice over the same input; assert all output files are byte-equal. If this test fails on a `brighterscript` upgrade, we pin the previous version until upstream fixes it.

### 10.3 Snapshot tests

In `tests/snapshots.test.ts`. For the stub catalog, snapshot the full file tree (paths plus contents) and the merged manifest. Lets reviewers see "what does Plan 3 actually produce?" at a glance. Snapshot files are checked in under `tests/__snapshots__/`.

### 10.4 Conflict-matrix combinatorial test

In `tests/conflict-matrix.test.ts`. Generates every 2-subset of the bundled module catalog (just `[stub_label]` for Plan 3, but the harness scales as Plan 5 adds real modules). For each subset, attempts to merge using a synthetic AppSpec and asserts that either:

- The merge produces a valid project, or
- The merge fails with one of the documented conflict codes (`MODULE_CONFLICT`, `FILE_COLLISION`, `MANIFEST_KEY_CONFLICT`).

Catches asymmetric `exclusive_with` declarations and surprise file collisions before they ship.

### 10.5 e2e MCP smoke

In `tests/e2e.test.ts`. Spawns the brs-gen MCP server (`dist/index.js`), calls `tools/list` (asserts the exact 10-tool catalog), then calls `generate_app` with a stub spec into a tmp dir. Asserts:

- The zip exists and is byte-equal to a golden bytes file checked into `tests/__golden__/stub.zip`.
- `validate_manifest` on the resulting project returns `ok: true`.
- `lint` on the resulting project returns `ok: true` with zero diagnostics.
- The resulting `.rokudev-tools/provenance.json` matches a checked-in golden record.

Mirrors the rokudev-device e2e harness from Plans 1 and 2.

### 10.6 No real-device verification gate

Plan 3 does not run a T27-style real-device gate. The stub channel is functional but uninteresting; the first plan that ships a real template (Plan 4) adds real-device verification analogous to Plan 2's T27.

## 11. Open questions and risks

### 11.1 `brighterscript` determinism

Required for the §8 byte-equality guarantee on compiled output. If a future `brighterscript` release introduces nondeterministic output (e.g. parallel-compile reordering), the test in §10.2.3 catches it and we pin to the previous version. This risk is real but mitigated by the test plus the fact that `brighterscript` is widely used and expected to be deterministic.

### 11.2 Template-side hook invocation correctness

The merger generates dispatch functions but does not strictly verify the template calls them. The `HOOK_DISPATCH_NOT_INVOKED` warning is best-effort (greps source for the function name). A template author can silently break module init by deleting the dispatch call. Mitigation: snapshot tests catch regressions in stub_hello; future plans should add a test per real template that verifies dispatch calls survive edits.

### 11.3 Manifest-key strategy table extensibility

The closed table is a deliberate UX trade-off (typo guard versus extension friction). External developers cannot add new manifest keys without a `brs-gen` patch. If the catalog ever grows to externally-developed modules (deferred per §0.3), this becomes a coordination point. Plan 5 may revisit.

### 11.4 EJS escaping defaults

Template rendering disables EJS's HTML auto-escape because BrightScript hex literals (`&hRRGGBBFF`) would be corrupted (matches brs-mcp). Templates must use `helpers.xmlEscape()` explicitly when emitting XML attribute values. We enforce by convention plus test, not by sandboxing the EJS engine.

### 11.5 `assets_root` semantics

For Plan 3 with only the stub template, `assets_root` is effectively a passthrough: any files referenced by the stub template's `manifest_defaults` (the four PNGs) are bundled with the template. Real templates in Plan 4 will define richer asset rules. The Plan 3 design accepts this minimal handling and defers the abstraction to Plan 4 to avoid premature factoring.

### 11.6 `version_range` resolution at parse time

A spec without `version_range` resolves to "latest installed" at generate time. This means the same on-disk spec can produce different output if the bundled catalog changes (a `brs-gen` upgrade). The `MODULE_VERSION_UNPINNED` warning surfaces this. For full reproducibility users must pin every module's `version_range`. We do not auto-pin; that would silently mutate user input.

## 12. References

- PRD: `docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md`, especially §3.1, §3.2, §3.4, §3.5, §3.6, §3.7.
- Plan 1: `docs/superpowers/plans/2026-05-06-plan-1-roku-device-client-and-rokudev-device.md` (sets monorepo conventions, tool-registration patterns, version-check, error-code style).
- Plan 2: `docs/superpowers/plans/2026-05-07-plan-2-bdp-debugger.md` (consumes brs-gen's `.brs.map` output via the BDP debugger).
- BDP wire format: `docs/refs/bdp-wire-format.md` (source-map handling reference).
- brs-mcp prototype: `/Users/bblietz/Work/ClaudeProjects/brs-mcp/` (existing generator that brs-gen evolves from).
- rokudev-tools deferred items: `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/roku-tools-prd-deferred.md`.
