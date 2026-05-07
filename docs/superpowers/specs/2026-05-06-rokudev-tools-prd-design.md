# rokudev-tools: Unified Roku BrightScript Developer Toolkit

PRD / design document. Status: draft for review. Date: 2026-05-06.

This document captures the product requirements and high-level design for `rokudev-tools`, a unified developer toolkit that consolidates the existing prototype servers (`brs-mcp`, `brs-debug-mcp`, `brs-mcp-for-docs`) into a coherent product surface for AI-assisted Roku channel development.

It is a PRD, not an implementation plan. The implementation plan will be derived from this document in a separate session via the writing-plans skill.

## 1. Product framing

### 1.1 Working name

`rokudev-tools`. The product is a single shipping artifact set composed of three MCP servers, one shared TypeScript library, a Claude Code plugin, and a skills layer.

### 1.2 Audience

Roku-internal users (DevRel, sample-app authors) and external Roku channel developers, served by a single distribution. Internal-only features are gated behind opt-in configuration flags.

### 1.3 Goals

1. Make BrightScript channels easy to start and easy to ship. Same `AppSpec` produces the same bytes every time. From "I want a video subscription channel with ads and SSO" to a sideloaded, working channel on a Roku, measured in minutes rather than days.
2. Compose Roku platform features (Pay, Ads, Auth) without forking templates. Real channels are combinations; the toolkit must be additive, not multiplicative.
3. Give the AI assistant a complete loop: generate, sideload, log, debug with real breakpoints, introspect, screenshot, smoke-test, all through one tool surface, with consistent errors and device addressing.
4. Stay device-truthful. Generated code in the deterministic path is hand-authored and device-tested. Freeform LLM output is gated by `bsc` lint, smoke test, and screenshot diff before being declared done.

### 1.4 Non-goals

- Not a replacement for the Roku Channel Store submission tooling.
- Not a hosted CMS or feed builder.
- Not a runtime/SDK shipped to end users; this is developer tooling only.
- Not a competitor to BrighterScript (the LSP); the toolkit depends on it.

### 1.5 Success criteria for v1

- **Onboarding wall-clock.** An external Roku channel developer who has the Roku in dev mode and has installed the Claude Code plugin can go from "first MCP call" to "channel sideloaded, smoke test passes, screenshot returned" for the canonical demo (`video_grid_channel` + `monetization.roku_pay.subscription` + `ads.raf_ssai`) in under 30 minutes of human attention. Measured by a scripted eval that runs the canonical `roku-vibe --thorough` flow against a recorded transcript with a real Roku, not by self-report. The 30-minute bar excludes Roku-account creation, dev-mode setup, and Pay sandbox account provisioning, which are out of scope.
- **Migration coverage.** Every public tool in the three prototype MCPs maps to a unified equivalent or is intentionally deprecated with a documented replacement. Tracked by `docs/migration-from-prototypes.md`; CI lint asserts the table covers every prototype tool name.
- **Real breakpoints.** A user can set a breakpoint at a `.brs` file and line, sideload, hit it on a normal code path, inspect locals, step over, and continue, all through MCP tool calls. Source-map handling for BrighterScript `.bs` files is defined in §4.5.
- **Freeform quality bar.** The freeform LLM path produces channels that (a) pass `bsc` lint clean and (b) do not display an error overlay on smoke test in at least 80% of attempts on the eval set described in §8.4. The bar is measured against an eval set authored independently of the freeform-path implementation (see §8.4 for the conflict-of-interest mitigation).

## 2. Architecture

### 2.1 Component overview

Three MCP servers, one shared TypeScript library, one skills layer, one Claude Code plugin.

```
                       ┌──────────────────────────────┐
                       │   AI assistant (Claude Code, │
                       │   Cursor, Codex, ...)        │
                       └──────────────┬───────────────┘
                                      │ MCP / stdio
            ┌─────────────────────────┼─────────────────────────┐
            │                         │                         │
   ┌────────▼────────┐       ┌────────▼────────┐       ┌────────▼────────┐
   │    brs-gen      │       │   rokudev-device    │       │    brs-docs     │
   │    (TS/Node)    │       │    (TS/Node)    │       │    (Python)     │
   ├─────────────────┤       ├─────────────────┤       ├─────────────────┤
   │ templates       │       │ ECP             │       │ FTS5 search     │
   │ feature modules │       │ dev-portal      │       │ doc retrieval   │
   │ freeform path   │       │ telnet          │       │ sample retrieval│
   │ bsc lint loop   │       │ BDP (binary)    │       │                 │
   │ LSP-as-tool     │       │ dev-loop        │       │                 │
   │  (optional)     │       │ device registry │       │                 │
   └────────┬────────┘       └────────┬────────┘       └─────────────────┘
            │                         │
            └─────────────┬───────────┘
                          │
                ┌─────────▼──────────┐
                │ roku-device-client │   shared TS library
                │ (RFC 2617 Digest,  │   imported by brs-gen and
                │  ECP HTTP, BDP     │   rokudev-device; single source
                │  binary client,    │   of truth for every Roku
                │  telnet client,    │   network call.
                │  registry I/O,     │
                │  error taxonomy)   │
                └────────────────────┘

      shared at the filesystem layer:
      ~/.config/rokudev/devices.toml      device registry (0600)
      ~/.config/rokudev/config.toml       general config, internal-flag opt-ins
      ~/.cache/brs/docs/              docs corpus and index (refreshable)
```

### 2.2 Plane responsibilities

Hard boundaries; do not blur during implementation.

| Plane | Owns | Forbidden |
|---|---|---|
| `brs-gen` | All file generation: project trees, manifests, asset placement, module merge, freeform scaffolding. Calls `rokudev-device` only via the shared library for sideload-after-generate convenience flows. | No direct device I/O of its own. No corpus storage. |
| `rokudev-device` | Every Roku-touching call. The only place `undici`/HTTP/telnet/binary-protocol clients live. Owns the device registry and network detection. | No template knowledge. No docs corpus. |
| `brs-docs` | The corpus (BrightScript reference + samples), refresh from `rokudev/dev-doc`, FTS5 search, `brs_get`/`brs_list`. | No file generation. No device I/O. |
| `roku-device-client` | Pure library: HTTP Digest, ECP HTTP, BDP binary framing, telnet wrappers, registry parsing, the unified error taxonomy. No MCP wrapping. | No tools, no stdio. |
| Skills | Orchestration recipes: which MCP calls to make, in what order, for common workflows (deploy-and-smoke, triage, perf trace, deep-link test). | No new device I/O. Must call `rokudev-device`. |
| Claude Code plugin | One-shot install, MCP wiring, ships skills, runs `brs setup`. | No business logic. |

### 2.3 Architectural invariants

- `roku-device-client` is published to npm (not internal-only). External developers building other AI tools may depend on it. **Public export surface** is the typed clients (`EcpClient`, `DevPortalClient`, `BdpClient`, `TelnetClient`, `RegistryReader`, `RegistryWriter`), the `errors` module, and the `discovery` module. Lower-level primitives (`digestRequest`, `multipartStream`, BDP wire codecs) live under a `_internal/` namespace; they are excluded from the package's `exports` field and are not part of the SemVer surface. `RegistryWriter` is included in the public surface because both `brs-gen` and `rokudev-device` need write access to the registry; the file-locking protocol in §4.1 is implemented inside `RegistryWriter`.
- Network detection is implemented in `rokudev-device`, not in the shared library. Detection is an MCP-tool-level concern (warning users about cross-network access). The library only makes the call.
- Skills do not bypass `rokudev-device` to make Roku calls themselves. The rule is enforced socially and structurally; new skills that need a new transport require a new tool in `rokudev-device` first.
- **Determinism guarantee scope.** Same `AppSpec` plus same module versions plus same template version plus same `brs-gen` version produces byte-identical output (project tree, zip bytes via sorted entries and fixed mtime, and `provenance.json`). This guarantee applies **only to the deterministic path (Path A)**. Freeform-path output is explicitly nondeterministic by design; `provenance.json` for a freeform project records the bootstrap template version, a session id, and the bsc/smoke pass markers, but file contents are not reproducible.
- All Roku-touching code lives in one place. There is exactly one `sideload()` function (in `roku-device-client`), called by both `rokudev-device` and `brs-gen`.
- `dev_password`, signing passwords, and any secret material are never logged or echoed.

### 2.4 Configuration precedence

For every device tool, the values for `host` (or `device_ip`) and `dev_password` are resolved in this strict order; the first non-empty value wins:

1. **Per-call argument.** A `host`, `device_ip`, or `dev_password` passed in the tool arguments.
2. **Per-call `device:` argument.** When `device: <name>` is supplied, the registry entry's `host` and `dev_password` are used.
3. **Per-device env vars.** `ROKUDEV_HOST_<DEVICE_NAME>`, `ROKUDEV_DEV_PASSWORD_<DEVICE_NAME>`. Useful for CI matrices and for keeping secrets out of `devices.toml`. **Name normalization:** `<DEVICE_NAME>` is the device's registry name with `-` replaced by `_` and the result uppercased. So `corp-tv-43` → `ROKUDEV_HOST_CORP_TV_43`, `home-tv` → `ROKUDEV_HOST_HOME_TV`. Names containing characters other than `[A-Za-z0-9_-]` are rejected at registry-add time (`device_add` returns `INVALID_DEVICE_NAME`) so the env-var transform is unambiguous.
4. **Global env vars.** `ROKUDEV_DEFAULT_ROKU_HOST`, `ROKUDEV_ROKU_DEV_PASSWORD`. (These names are kept for compatibility with the existing prototype.)
5. **Active registry device.** The `[active]` device in `~/.config/rokudev/devices.toml`.

If no value is resolved by step 5, the tool returns `{ ok: false, code: "DEVICE_NOT_RESOLVED", details: { tried: [...] } }`. The `tried` array enumerates the steps consulted so the agent can debug.

The same precedence applies to `signing_password` for `pack_signed` and `rekey`, except step 5 is omitted (signing passwords are never stored in the registry; see §4.7).

### 2.5 Internal feature flags

Internal-only behavior is opt-in via `[features.internal]` in `~/.config/rokudev/config.toml`. Concrete v1 flags:

- `internal.use_corp_doc_mirror = true` enables `brs docs refresh` to use the configured corp mirror URL instead of GitHub.
- `internal.raf_test_endpoints = true` exposes the Roku-internal RAF test ad servers as selectable values in the `ads.raf_csai` and `ads.raf_ssai` module configs.
- `internal.allow_unsigned_sample_feeds = true` permits `video_grid_channel` and `news_channel` to consume internal sample feed URLs that lack public TLS chains.

A `pnpm check:no-internal` lint runs at publish time and fails the release if any internal-only code path is reachable without a `features.internal.*` guard.

## 3. Generation model

### 3.1 Three-layer model

```
   AppSpec (declarative, versioned, validated)
        │
        ▼
  ┌─────────────────────────────────────────────────────┐
  │  base template     +    feature modules (N≥0)       │
  │  (one per app)          (composable, additive)       │
  └─────────────────────────────────────────────────────┘
                          │
                          ▼
                  module merger
        (manifest, init order, scene wiring,
         shared file conflict detection)
                          │
                          ▼
              deterministic project tree
                          │
                          ▼
                  bsc lint pass (mandatory)
                          │
                          ▼
                  zip (deterministic) → optional sideload → optional smoke
```

### 3.2 Path A: deterministic (templates + modules)

The dominant path. The `AppSpec` declares a base template plus feature modules. Example:

```jsonc
{
  "spec_version": 2,
  "template": "video_grid_channel",
  "app": { "name": "Acme Plus", "major_version": 1, "minor_version": 0, "build_version": 0 },
  "branding": { "primary_color": "#E50914", "icon": "./icon_hd.png", "splash": "./splash_fhd.png" },
  "content": { "feed_url": "https://acme.tv/feed.json", "feed_format": "roku_direct_publisher_json" },
  "modules": [
    { "id": "monetization.roku_pay.subscription", "config": { "products": ["acme_monthly", "acme_annual"] } },
    { "id": "ads.raf_ssai", "config": { "ssai_origin": "https://acme-ssai.example.com", "vmap_url": "..." } },
    { "id": "auth.device_link_code", "config": { "verify_url": "https://acme.tv/link" } },
    { "id": "deep_link.global", "config": { "scheme": "acme" } }
  ]
}
```

A feature module is a structured contribution, not a text snippet. Each module ships a `module.toml` declaring its surface, plus its source files. The merger reads `module.toml` and uses it to validate, order, and merge.

#### 3.2.1 module.toml shape

```toml
[module]
id = "monetization.roku_pay.subscription"
version = "1.0.0"
spec_compat = ">=2"

[module.config_schema]
# JSON Schema (Draft 7) inlined or referenced via $ref to a sibling .schema.json.
# Validated together with the base AppSpec at parse time.

[module.files]
# Files contributed by this module. Path is relative to the project root.
# Every contributed file MUST live under one of:
#   components/<module-id>/...
#   source/_modules/<module-id>/...
# This is the file-namespace convention; the merger refuses files outside it.
add = [
  "components/monetization.roku_pay.subscription/RokuPay.brs",
  "components/monetization.roku_pay.subscription/RokuPay.xml",
]

[module.manifest]
# Manifest deltas. Each key has an explicit merge strategy declared in the
# manifest-key strategy registry shipped with brs-gen (see §3.2.4).
requires_billing = "1"      # strategy: set
bs_const = "ENABLE_PAY=1"   # strategy: append-csv

[module.wiring]
# What the module exposes to the rest of the project.
exports = [
  { kind = "init_fn", name = "Pay_init", file = "components/monetization.roku_pay.subscription/RokuPay.brs" },
  { kind = "scene_node", name = "RokuPay", file = "components/monetization.roku_pay.subscription/RokuPay.xml" },
]
# What the module needs from the base template.
requires = [
  { kind = "scene_node", name = "MainScene" },                        # template must export a scene named MainScene
  { kind = "init_hook", scope = "MainScene.init", phase = "before_content_load" },
]
# How the module wires into the template's init hooks.
init_calls = [
  # Module init_calls use (hook, phase) two-field form. The merger normalizes
  # to the template's slash-joined form ("MainScene.init/before_content_load")
  # when matching against template.toml's `init_hooks[].name`.
  { hook = "MainScene.init", phase = "before_content_load",
    statement = "Pay_init(m.top)" },
]

[module.ordering]
# Soft constraints for cross-module init ordering.
before = ["analytics.event_pipe"]   # if this module is present too, init me first
after  = ["auth.device_link_code"]  # if this module is present too, init me second

[module.conflicts]
# Hard conflicts. Symmetric: if A says it conflicts with B, the merger refuses
# any project that includes both, regardless of B's declaration.
# (Real example: the two ads modules conflict with each other; this is declared
# in their own module.toml files. Pay+Ads compose freely.)
exclusive_with = []
# Soft conflicts (warnings, not errors): omitted in v1.
```

#### 3.2.2 File-namespace convention

Every module-contributed file MUST live under either `components/<module-id>/` or `source/_modules/<module-id>/`. Two modules can never write to the same path; the merger validates this at parse time and returns `MODULE_FILE_COLLISION` if violated. Modules that need to inject code into a template-owned file do so via the **init-hook mechanism** (§3.2.5), not by editing the template file directly.

Templates declare a small set of named init hooks (e.g. `MainScene.init/before_content_load`, `MainScene.init/after_content_load`, `Main/before_scene_show`). The merger generates a single auto-file (`source/_modules/__init_hooks.brs`) containing concatenated `init_calls` from all loaded modules, ordered per §3.2.5. The template calls into this auto-file at each declared hook point. Templates never reference module ids directly; modules never reference each other directly.

#### 3.2.3 Conflict matrix policy

Conflicts are declared per-module in `module.toml`'s `conflicts.exclusive_with`. The matrix is **symmetric**: the merger treats `A.exclusive_with includes B` and `B.exclusive_with includes A` identically. If exactly one of the two declares the conflict, the merger still refuses with `MODULE_CONFLICT`; the asymmetry is a documentation defect to fix in the offending module, not a permissive case.

Two modules whose contributed files do not collide and which do not declare conflicts are assumed compatible. The combinatorial test described in §8.3 verifies this assumption across (template, module-pair) and (template, module-triple) combinations.

#### 3.2.4 Manifest-key merge strategies

Each known Roku manifest key has a declared merge strategy in `packages/brs-gen/src/modules/manifest-key-strategies.ts`:

| Key example | Strategy | Behavior |
|---|---|---|
| `title`, `splash_color`, `splash_min_time`, `requires_billing` | `set` | Module values must agree with base template; mismatch → `MANIFEST_KEY_CONFLICT`. |
| `bs_const`, `supports_input_launch` | `append-csv` | Module values are appended to the base value as comma-separated tokens; duplicates dropped. |
| `mm_icon_focus_*`, `splash_screen_*` | `set-if-unset` | Module sets the value only if base template did not. Conflict if two modules try to set the same unset key. |
| Unknown keys | `error` | The merger refuses unknown manifest keys to surface typos; new keys must be added to the strategy table with an explicit policy. |

Failure code: `MANIFEST_KEY_CONFLICT { key, base_value, module_values: [{module_id, value}] }`.

#### 3.2.5 Init order

Init order is computed by topological sort of the modules' `ordering.before` and `ordering.after` constraints. Constraints between absent modules are ignored. Cycles are a hard error: `INIT_ORDER_CYCLE { cycle: [module_ids] }`. Within a single hook+phase, the secondary tiebreaker is module-id lexical sort, so the order is deterministic regardless of `AppSpec` `modules[]` array order.

#### 3.2.6 Wiring contract validation

At merge time, the merger:

1. Resolves every module's `requires` against the base template's declared exports (in the template's `template.toml`, see §3.2.6.1).
2. Refuses with `WIRING_CONTRACT_VIOLATION { module, requirement, reason }` if any required export is missing or has a different signature.
3. Resolves every `init_call` against the base template's declared init hooks. A module that targets a hook the template does not export → `WIRING_CONTRACT_VIOLATION`.
4. Generates `source/_modules/__init_hooks.brs` deterministically (sorted hook keys, ordered call list per §3.2.5), with no timestamps or host info.
5. Validates each module's `spec_compat` range against the current AppSpec's `spec_version`. The `spec_compat` field is a [node-semver](https://github.com/npm/node-semver) range expression; the AppSpec's integer `spec_version` is **coerced to `<spec_version>.0.0`** before matching (so `spec_version: 2` satisfies `spec_compat = ">=2"` because `2.0.0 >=2.0.0`). The same coercion applies to `template.toml`'s `spec_compat`. Mismatch → `MODULE_SPEC_INCOMPAT { module, declared: spec_compat, actual: spec_version, actual_coerced: "<x>.0.0" }`.

#### 3.2.6.1 template.toml shape

Every base template ships a `template.toml` analogous to `module.toml`:

```toml
[template]
id = "video_grid_channel"
version = "1.4.2"
spec_compat = ">=2"

[template.exports]
# What the template provides for modules to wire into.
init_hooks = [
  { name = "MainScene.init/before_content_load", file = "components/MainScene.brs" },
  { name = "MainScene.init/after_content_load",  file = "components/MainScene.brs" },
  { name = "Main/before_scene_show",             file = "source/Main.brs" },
]
scene_nodes = [
  { name = "MainScene", file = "components/MainScene.xml" },
  { name = "PlayerScene", file = "components/PlayerScene.xml" },
]

[template.supported_modules]
# Optional curated allowlist. When present, the merger refuses modules not on
# the list (`MODULE_NOT_SUPPORTED_BY_TEMPLATE`). When absent, all wiring-compatible
# modules are accepted.
allowlist = []   # empty = "all wiring-compatible modules accepted"

[template.manifest]
# Base manifest values the template owns. Module manifest deltas merge against
# these per §3.2.4.
title = "Video Grid Channel"
splash_color = "#141414"
```

Templates declare what they provide; modules declare what they need. The merger is the only component that reads both sides.

#### 3.2.7 Provenance

The merger emits `.rokudev-tools/provenance.json`:

```json
{
  "spec_version": 2,
  "template": { "id": "video_grid_channel", "version": "1.4.2" },
  "modules": [
    { "id": "monetization.roku_pay.subscription", "version": "1.0.0",
      "files": ["components/monetization.roku_pay.subscription/RokuPay.brs", "..."] },
    { "id": "ads.raf_ssai", "version": "1.1.0", "files": ["..."] }
  ],
  "init_order": ["auth.device_link_code", "monetization.roku_pay.subscription", "analytics.event_pipe"],
  "brs_gen_version": "1.0.0"
}
```

`provenance.json` is itself deterministic (sorted keys, sorted arrays where order is not load-bearing, no clock or host info). The byte-identical guarantee in §2.3 includes this file. The init order is included to make `roku-module-add` and `roku-module-remove` reproducible.

### 3.3 Path B: freeform (LLM-driven, guarded)

For the long tail of "make me a thing nobody templated yet." The agent works inside an explicit freeform session that owns the lint cadence; lint discipline is enforced by the toolkit, not by prompt.

1. **Open session.** `brs-gen.freeform_session_open(project_dir)` returns a `session_id`. The session is bootstrapped from `blank_scenegraph` (manifest, splash, icon, deep-link plumbing, `MainScene.xml`) on first call.
2. Optionally opens an LSP-as-tool session for symbol-aware editing.
3. The agent writes BrightScript directly, querying `brs-docs` for component and interface lookups.
4. **Lint gate.** `rokudev-device.sideload`, `rokudev-device.dev_loop`, and `rokudev-device.dev_loop_with_smoke` refuse to proceed (`LINT_REQUIRED` error) when called against a project that has a `.rokudev-tools/freeform-session.json` whose latest mtime indicates source changes since the last successful `brs-gen.lint` run. The agent must call `brs-gen.lint` and resolve all errors before proceeding. The toolkit owns this gate; the agent cannot bypass it without an explicit `freeform_lint_override: true` flag (which is logged and surfaced in the result `details.warnings`).
5. Once lint-clean, runs `rokudev-device.dev_loop_with_smoke` to sideload, smoke, and screenshot.
6. The smoke step asserts the screenshot does not match the error-overlay fingerprint set (§4.3). **Smoke-pass at v1 means "no visible error overlay," not "renders the intended content."** A channel that boots into a black screen and renders nothing technically passes smoke. This is a deliberate v1 limit; positive-fingerprint or content-aware smoke is a v1.x feature. The §1.5 success-criterion language reflects this honestly.
7. **Close session.** `brs-gen.freeform_session_close(session_id)` finalizes `provenance.json` (records bootstrap version, session id, lint pass marker, smoke pass marker, no file contents).

This loop makes "freeform but disciplined" possible without trusting the agent's good behavior.

### 3.4 Why both paths

Pay, RAF, Auth, deep-link plumbing, and DRM are too dangerous to leave to per-attempt LLM generation; they live in audited modules. A 4-player local Snake clone is too long-tail to template; it lives in freeform. The guardrails (bsc clean, smoke pass, screenshot diff) define the floor for freeform output and are enforced by the toolkit, not by the prompt.

### 3.5 AppSpec versioning and compatibility

`spec_version: 2` introduces the `modules[]` array and the conflict matrix. The existing `spec_version: 1` shapes from `brs-mcp` are accepted by the generator.

**Per-template Zod schemas are upgraded.** The prototype's per-template schemas (`brs-mcp/src/spec/app_spec.ts`, `templates/*/spec.ts`) declare `spec_version: z.literal(1)` and have tests asserting v2 fails parsing. In `brs-gen`, every template's outermost spec wrapper relaxes this to `z.union([z.literal(1), z.literal(2)])`. The inner per-template fields are unchanged. The prototype's "v2 must fail" tests are inverted in `brs-gen` ("v2 must pass with empty modules[]"), and a new pair of tests asserts v1+modules and v2-without-modules behaviors.

**Promotion rule.** A v1 spec is promoted to v2 in-memory by setting `spec_version: 2` and inserting `modules: []` (empty). All other fields are passed through unchanged; no field renames, no type coercions, no default-value injection. A v1 spec that validated under `brs-mcp@1.x` validates under `brs-gen@1.x` after the promotion (with the relaxed wrapper). New v2-only behavior (modules, conflict matrix, provenance manifest) is opt-in and requires the user to explicitly write `modules[]`.

**Promotion is performed silently by the generator on load.** No user action required. The generator emits a single info-level diagnostic ("AppSpec v1 detected, promoted to v2 in-memory") that surfaces in the tool result's `details.warnings` field. The original on-disk spec is never modified by the generator; users who want to upgrade their on-disk spec run `brs spec upgrade <file>` from the CLI, which writes the promoted form back to disk.

### 3.6 Mandatory lint

`bsc` lint runs on both deterministic and freeform paths, before zip. A module's BrighterScript syntax bug is caught at the merge step, not at sideload time.

### 3.7 brs-gen tool surface (consolidated)

The full `brs-gen` MCP tool list, gathered here for migration-table convenience. Tools whose contract is defined elsewhere are linked.

| Category | Tool | Defined |
|---|---|---|
| Templates | `list_templates` | preserved from `brs-mcp` |
| Templates | `get_template_schema(id)` | preserved from `brs-mcp` |
| Modules | `list_modules` | new in v1 |
| Modules | `get_module_schema(id)` | new in v1 |
| Generation (Path A) | `generate_app(spec, output_dir, assets_root?, overwrite?, zip?, sideload?)` | preserved from `brs-mcp`; `spec` may be v1 or v2 (§3.5) |
| Generation (Path A) | `package_app(project_dir, output_zip?)` | preserved from `brs-mcp` |
| Generation (Path B) | `freeform_session_open(project_dir)` | §3.3 step 1 |
| Generation (Path B) | `freeform_session_close(session_id)` | §3.3 step 7 |
| Validation | `validate_manifest(project_dir)` | logic moved from `roku-manifest-validator` skill |
| Validation | `validate_assets(project_dir)` | new in v1 (used by `roku-asset-pipeline`) |
| Versioning | `spec_upgrade(file_path)` | promotes a v1 AppSpec on disk to v2 (§3.5) |
| Lint | `lint(project_dir)` | §5.5 |
| LSP | `lsp_open_workspace`, `lsp_close_workspace`, `lsp_diagnostics`, `lsp_hover`, `lsp_definition`, `lsp_references`, `lsp_document_symbols`, `lsp_workspace_symbols` | §5.4 |

Note: `freeform_lint_override` is a parameter of `rokudev-device.dev_loop` and `rokudev-device.dev_loop_with_smoke` (§4.3), not a `brs-gen` tool, because it gates the device call. `brs-gen` enforces the lint cadence by writing `.rokudev-tools/freeform-session.json` and consulting it before generation; the override is consumed by the device side.

## 4. Device plane

### 4.1 Device registry

Stored at `~/.config/rokudev/devices.toml` with mode `0600`. Single source of truth across the three MCPs. dev_password is stored in plaintext by design (no keychain dependency); strict file perms and a documented warning. `ROKUDEV_NO_PLAINTEXT=1` opts out (env-var-only mode for CI).

**Concurrency.** The registry is shared by `brs-gen`, `rokudev-device`, and the `brs` CLI; multiple processes may read/write concurrently. All writes go through `roku-device-client`'s `RegistryWriter`, which:

1. Acquires an advisory `flock` on `~/.config/rokudev/devices.toml.lock`.
2. Re-reads the registry under the lock.
3. Applies the change in-memory.
4. Writes to `~/.config/rokudev/devices.toml.tmp.<pid>` with mode 0600.
5. `rename(2)` over the original (atomic on POSIX; fallback to write-then-rename-with-backup on Windows).
6. Releases the lock.

If `flock` cannot be acquired within 5 seconds, the write returns `REGISTRY_BUSY` so the caller can retry or surface the contention.

**Active-device scope.** The `active = "name"` field is a per-host setting, not per-MCP-instance. Two developers sharing a machine should use OS-level user accounts; a single user account with two MCP clients open at once will see the same `active` device. A future v1.x feature may add per-process active overrides via env var.

**Discovery → password flow.** `device_discover` adds discovered devices to the registry without a `dev_password` (the field is left absent, not empty-string). When a tool call later targets such a device and password resolution per §2.4 fails, the response is `{ ok: false, code: "DEVICE_NO_PASSWORD", details: { device, prompt_hint } }`. The `device_set_password(device, dev_password)` tool sets the password on an existing registry entry. `device_add(...)` may also be called to upsert (it accepts an optional `dev_password`).

**Backup-vector note.** macOS Time Machine and Spotlight will index `~/.config/rokudev/` by default. The `brs setup` flow:

- Adds `~/.config/rokudev/` to Spotlight's exclusion list via `mdimport -d` (best-effort).
- Suggests adding the path to Time Machine exclusions (cannot do silently without sudo).
- Documents both as part of the plaintext-password warning emitted on first run.

```toml
# rokudev-tools device registry
# WARNING: dev_password stored in plaintext. Set ROKUDEV_NO_PLAINTEXT=1 to refuse.
# Override per-call with env var ROKUDEV_DEV_PASSWORD_<DEVICE_NAME> if needed.

active = "home-tv"

[devices.home-tv]
host = "192.168.1.42"
hostname = "ROKU-A1B2C3.local"
network_tag = "home"
serial = "X00012345678"
model = "Streambar Pro"
dev_password = "rokudev"
added_at = "2026-05-01T18:42:00Z"
last_seen = "2026-05-06T20:11:33Z"

[devices.corp-tv-43]
host = "10.92.14.43"
hostname = "DEVTV-43.corp.example.com"
network_tag = "corp"
serial = "X00099887766"
model = "Roku Ultra"
dev_password = "..."
added_at = "2026-04-22T14:30:00Z"

[devices.corp-stick-vpn]
host = "10.92.14.117"
hostname = ""
network_tag = "corp"
serial = "X00055443322"
model = "Streaming Stick 4K"
dev_password = "..."
added_at = "2026-04-22T14:31:00Z"

[networks.home]
# Fingerprint tuple per §4.2. Match requires gateway_mac plus at least one of
# gateway_subnet_v4 or dns_search_suffix. vpn_iface_present participates in
# the home_via_vpn classification rule.
gateway_mac = "ac:de:48:00:11:22"
gateway_subnet_v4 = "192.168.1.0/24"
dns_search_suffix = "lan"

[networks.corp]
gateway_mac = "00:1a:2b:33:44:55"
gateway_subnet_v4 = "10.92.0.0/16"
dns_search_suffix = "corp.example.com"
# corp is also reachable from home via VPN; corp -> home is not.
reachable_from = ["corp", "home_via_vpn"]
```

### 4.2 Network detection and warnings

At MCP startup and on the first device call per session, `rokudev-device` builds a network fingerprint from the current default-route environment and matches it against `[networks.*]` entries. The session is classified as `home`, `corp`, `home_via_vpn`, or `unknown`.

**Fingerprint composition.** Gateway MAC alone is fragile (HSRP/VRRP virtual MACs can collide across VLANs and across sites). The fingerprint is a tuple:

- `gateway_mac`: ARP-resolved MAC of the default-route gateway.
- `gateway_subnet_v4`: the /24 the host's primary IPv4 falls in (e.g. `10.92.14.0/24`).
- `dns_search_suffix`: the resolver's primary search-domain suffix when present (e.g. `corp.example.com`).
- `vpn_iface_present`: boolean, true if a `utun*` / `tun*` / `tap*` interface is up with a non-link-local address.

A `[networks.*]` entry matches if `gateway_mac` matches AND at least one of `gateway_subnet_v4` or `dns_search_suffix` matches. The `home_via_vpn` classification requires `vpn_iface_present == true` plus a match against the `corp` fingerprint. The richer fingerprint is robust to virtual-MAC collisions in practice; remaining false positives surface as actionable errors (because device calls fail with a real network error) and are escapable via `force: true` per §4.4.

When a tool addresses a device whose `network_tag` is not reachable from the current session, the tool returns:

```json
{ "ok": false, "stage": "device", "code": "NETWORK_UNREACHABLE",
  "message": "device 'home-tv' is on home; you appear to be on corp; corp cannot reach home",
  "details": { "device_network": "home", "current_network": "corp" } }
```

**Behavior on `unknown` network classification:** the policy is **permissive**. When the current session classifies as `unknown` (no `[networks.*]` fingerprint matched, e.g. hotel Wi-Fi, coffee shop, or first-run before any networks are configured), `rokudev-device` does not return `NETWORK_UNREACHABLE` for any device. The tool attempts the call and reports the actual network result. Rationale: a wrong restrictive default would block legitimate first-run use; a wrong permissive default produces a real network error a few seconds later, which is no worse than the current prototype behavior. Users who want strict behavior can populate `[networks.*]` entries to upgrade to detected mode.

Every device tool accepts a `force: true` override for cases where the heuristic is wrong even on a known network.

### 4.3 Tool surface

`rokudev-device` tools, consolidated from the prototypes:

| Category | Tools |
|---|---|
| Registry | `device_list`, `device_add`, `device_set_password`, `device_discover` (SSDP `roku:ecp` one-shot, see note), `device_set_active`, `device_remove`, `device_test` (ping + ECP `device-info`) |
| ECP read | `ecp_device_info`, `ecp_apps`, `ecp_active_app`, `ecp_media_player`, `ecp_r2d2_bitrate`, `ecp_icon` |
| ECP control | `ecp_keypress`, `ecp_keysequence`, `ecp_launch`, `ecp_input`, `ecp_to_home` |
| Dev portal | `sideload`, `unload`, `screenshot`, `genkey`, `rekey`, `pack_signed`, `diff_installed`, `query_registry`, `profiler_snapshot`, `crashlog_pull` |
| Telnet (logs) | `log_tail` (fixed-duration capture), `log_stream_open`, `log_stream_read`, `log_stream_close` |
| BDP (real debug) | `debug_attach`, `debug_detach`, `debug_session_state`, `debug_set_breakpoint`, `debug_clear_breakpoint`, `debug_list_breakpoints`, `debug_continue`, `debug_step`, `debug_step_over`, `debug_step_out`, `debug_pause`, `debug_stack_trace`, `debug_threads`, `debug_variables`, `debug_eval` |
| Composite | `dev_loop` (sideload + tail), `dev_loop_with_smoke` (sideload + smoke + screenshot, see contract below). Both accept `freeform_lint_override: true` to bypass the §3.3 lint gate (logged in `details.warnings`). |

**`dev_loop_with_smoke` contract.** After a successful sideload, the tool: (1) launches the dev channel via ECP, (2) waits for the channel to become the active app (poll `ecp_active_app` with a configurable timeout, default 10s), (3) sends a small navigation sequence (`Down`, `Right`, `Right`) via `ecp_keysequence`, (4) captures a screenshot via the dev portal, (5) asserts the screenshot does not match a known error-overlay fingerprint set (the "channel crashed" red screen, the "Sorry, an error occurred" dialog), and (6) tails logs for a configurable duration (default 5s). Returns `{ ok, sideload, launch_ms, screenshot, log_lines, smoke_pass: bool, smoke_failures?: string[] }`. **`log_lines` is capped at the last 200 lines or 64 KB (whichever is hit first) to bound token cost; the full log is available via `log_tail` if needed.** The error-overlay fingerprint set is shipped with `rokudev-device` and refreshes automatically with `rokudev-device` package upgrades; users can also force-refresh via `brs devices update-fingerprints` (which downloads the latest fingerprint pack from the same release artifact stream).

**Screenshot return shape (convention across all tools).** Every tool that returns a screenshot has a `return: "inline" | "ref"` parameter (default `inline`). In `inline` mode the result is `{ mime: "image/jpeg" | "image/png", base64: string, bytes: number }` (the existing `brs-mcp` shape, preserved). In `ref` mode the result is `{ mime, path: string, bytes: number }` where `path` is a file written to `~/.cache/brs/screenshots/<sha256>.<ext>` (mode 0600). `ref` mode exists because base64 PNGs from a Roku are typically 300-800 KB pre-encoding and consume meaningful tokens for the LLM caller; the agent can choose `ref` for diagnostic-only flows and `inline` when the model needs to see the image.

**Discovery transport.** `device_discover` uses SSDP `M-SEARCH * HTTP/1.1` with `ST: roku:ecp`. mDNS is not Roku-advertised by default and is not used by the discovery tool. Spec language elsewhere in this document that says "mDNS/SSDP" is shorthand for "SSDP roku:ecp"; the implementation uses SSDP only.

**`log_stream_*` back-pressure.** `log_stream_open` returns immediately. `log_stream_read` is the consumer. The server holds a per-session ring buffer of size 65,536 lines; when the producer (telnet) fills the buffer faster than the consumer reads, the oldest lines are dropped and the next `log_stream_read` returns `{ ok: true, lines: [...], details: { warnings: [{ code: "LOG_STREAM_OVERFLOW", dropped_lines: <count> }] } }`. The in-band warning shape is canonical (per §4.6's in-band warning convention). After 60 seconds of no `log_stream_read` calls, the session is auto-closed and any subsequent read returns the failure `LOG_STREAM_TIMED_OUT`. Sessions are also auto-closed when the MCP server shuts down.

Every tool accepts `device: string` (registry name) instead of `device_ip` plus `dev_password`. Per-call host/password remain supported as overrides. Env-var fallback remains supported (see §2.4 for full precedence).

### 4.4 Tool design notes

- `unload` is first-class. Calls `mysubmit=Delete` on `/plugin_install`.
- `log_tail` (one-shot) and `log_stream_*` (long-running session) are separate tools. Bundling them leads to leaked telnet connections.
- `force: true` (also mentioned in §4.2) is on every device tool, not just diagnostics. The network heuristic will be wrong in some environments; an explicit override is honest and discoverable.

### 4.5 BrightScript Debug Protocol (BDP) v1 scope

In v1: attach, detach, set/clear/list breakpoints, step, step over, step out, continue, pause, stack trace, threads, variables, eval. Out of v1: conditional breakpoints, watch expressions, hot-reload.

Implementation will study existing OSS BDP clients (notably the BrighterScript debug-adapter) for protocol framing, but will not depend on them at runtime.

#### 4.5.1 Ports and coexistence with telnet

| Port | Protocol | Used by |
|---|---|---|
| 8080 | telnet (read-only console) | `log_tail`, `log_stream_*` (read-only) |
| 8081 | BDP (binary, bidirectional) | `debug_attach` and all `debug_*` tools |
| 8085 | telnet (BrightScript debug console) | `log_tail`, `log_stream_*` (writable; the prototype `brs-debug-mcp` uses this exclusively) |
| 8086 | BDP (binary; some firmwares) | `debug_attach` fallback when 8081 returns connection refused. Performs the same version negotiation as 8081 (§4.5.2); the port number is just a transport choice that varies by RokuOS. |
| 8087 | telnet (profiler) | `profiler_snapshot` related streaming |

**Telnet 8085 and BDP 8081 are independent ports.** A `debug_attach` session and a `log_tail` session can run concurrently against the same Roku. However, **telnet 8085 itself is "one client at a time"** (verified against the existing prototype): a `log_tail` and a `log_stream_open` cannot both be active simultaneously, and a second `log_*` call returns `LOG_TAIL_BUSY`. BDP 8081 has its own one-client-at-a-time constraint; a second `debug_attach` returns `BDP_ATTACH_BUSY`.

#### 4.5.2 Version negotiation contract

On `debug_attach`, the client sends its supported BDP protocol version range (a `[min, max]` pair of integer protocol versions). The device response is parsed for the device's chosen protocol version. The successful `debug_attach` response includes a `bdp_version` field reflecting the negotiated version; downstream tools (`debug_set_breakpoint`, `debug_eval`, etc.) may switch behavior on this field. If the device's version is outside the client's supported range, attach returns `BDP_VERSION_UNSUPPORTED` with `details: { device_version, supported_range }`, and callers may fall back to telnet-based log tailing on 8085. The exact wire-level handshake bytes are an implementation detail captured in `roku-device-client`'s BDP module.

#### 4.5.3 Source-map handling for BrighterScript

BrightScript has no source maps natively, but **BrighterScript** (the LSP/compiler) compiles `.bs` to `.brs` and **emits source maps as `.brs.map` files alongside the compiled output** when configured to do so (`bsconfig.json` `sourceMap: true`). Roku's BDP reports breakpoints and stack frames in `.brs` line numbers (the compiled output). The user is editing `.bs`. Without source-map handling, every breakpoint would land on the wrong line.

**v1 contract:**

- `debug_set_breakpoint(file, line)` accepts either a `.brs` path or a `.bs` path. If `.bs`, the client looks for a sibling `<file>.brs.map` in the project's `out/` (or template-configured) directory and translates the line number to the compiled `.brs` location before sending to BDP. If no source map is present, the call returns `BDP_NO_SOURCE_MAP { file, hint: "set sourceMap: true in bsconfig.json and re-build" }`.
- `debug_stack_trace` and `debug_variables` reverse-translate compiled `.brs` line numbers back to `.bs` line numbers when a source map is present, surfacing both as `{ source_file, source_line, compiled_file, compiled_line }`. When no source map is present, only the compiled fields are populated.
- Pure-`.brs` projects (no `.bs` files) bypass source-map logic entirely.

This is the most painful gap in real-world Roku debugging today; v1 commits to handling it.

#### 4.5.4 Breakpoint persistence across re-sideload

A breakpoint is identified by `(file_path, line_number)` as the user set it (`.bs`-relative when source-mapped). When the user re-sideloads with edited code:

- All BDP breakpoints from the previous session are invalidated server-side at the moment the channel exits.
- On the next `debug_attach`, the client **does not auto-resurrect** breakpoints; instead, the response includes `details.invalidated_breakpoints: [{ file, line, reason: "channel_exited" | "line_no_longer_present" }]` listing every breakpoint from the previous session.
- The agent (typically via `roku-debug-session`) decides whether to re-set them. If the source map shifted, the agent can re-set by source position; the client computes the new compiled line.
- This keeps the protocol simple (no client-side stale-breakpoint state) and gives the agent explicit control over recovery.

#### 4.5.5 BDP_THREAD_LOST recovery contract

When a `debug_*` call (other than `debug_attach`) fails with `BDP_THREAD_LOST`, the contract is:

- The error response includes `details.session_state: "channel_exited" | "thread_terminated_other" | "connection_lost"`.
- **`channel_exited`**: the channel is no longer running. The agent should call `debug_detach` (cheap; tears down local session state) and decide whether to re-launch (e.g. `dev_loop`) and re-`debug_attach`.
- **`thread_terminated_other`**: the channel is still running but the specific thread the agent was debugging is gone (e.g. a worker task completed). The agent calls `debug_threads` to enumerate live threads and continues with one.
- **`connection_lost`**: the BDP socket dropped. The agent calls `debug_attach` again; if successful, breakpoints are re-listed via the §4.5.4 mechanism.

The `debug_session_state` tool exists for explicit introspection without triggering a destructive action.

### 4.6 Unified error taxonomy

Extends the existing `brs-mcp` table. Every failure response is `{ ok: false, stage, code, message, details? }`. `stage` is one of `validate`, `render`, `write`, `package`, `sideload`, `device`, `debug`, `merge`, `freeform`, `registry`, `lint`, `bootstrap`. The `merge`, `freeform`, `registry`, `lint`, and `bootstrap` stages are new. The `bootstrap` stage covers MCP-server-startup conditions (e.g. cross-package version checks).

New codes added (grouped by stage):

| Code | Stage | Meaning |
|---|---|---|
| `DEVICE_NOT_FOUND` | `device` | Registry has no entry for the supplied `device` name. |
| `DEVICE_NOT_RESOLVED` | `device` | Per §2.4 precedence chain produced no `host`/`dev_password`; `details.tried` enumerates steps. |
| `DEVICE_NO_PASSWORD` | `device` | Registry entry exists but has no `dev_password`; call `device_set_password`. |
| `NETWORK_UNREACHABLE` | `device` | Network heuristic says the device is not reachable from the current session. |
| `REGISTRY_BUSY` | `registry` | Could not acquire the advisory lock on `devices.toml` within 5s; retry. |
| `BDP_ATTACH_FAILED` | `debug` | Could not attach BDP (channel not in dev mode, port closed, version mismatch). |
| `BDP_ATTACH_BUSY` | `debug` | BDP port already has an active client. |
| `BDP_VERSION_UNSUPPORTED` | `debug` | RokuOS reports a BDP protocol version this client does not implement. |
| `BDP_BREAKPOINT_INVALID` | `debug` | File or line not present in the running channel. |
| `BDP_NO_SOURCE_MAP` | `debug` | `.bs` breakpoint requested but no `<file>.brs.map` exists; details include a hint. |
| `BDP_THREAD_LOST` | `debug` | Thread disappeared mid-operation; `details.session_state` carries recovery context per §4.5.5. |
| `LOG_TAIL_BUSY` | `device` | Telnet 8085 already in use by another client. |
| `LOG_STREAM_TIMED_OUT` | `device` | A `log_stream_*` session was idle longer than 60s and was auto-closed. |
| `ECP_PARAM_DISALLOWED` | `device` | Caller supplied a param key not on the per-tool allowlist for `ecp_input` / `ecp_launch` (§4.7.2). `details.key`. |
| `ECP_KEY_DISALLOWED` | `device` | Caller supplied a keypress not on the standard-key allowlist or a `Lit_<char>` literal whose char is excluded (§4.7.1). `details.key`. Distinct from `ECP_PARAM_DISALLOWED` to keep per-tool error handling clean. |
| `INVALID_DEVICE_NAME` | `registry` | A registry name contains characters outside `[A-Za-z0-9_-]`. Returned by `device_add` and `device_set_password` to keep env-var name normalization unambiguous (§2.4). |
| `CROSS_PACKAGE_VERSION_MISMATCH` | `bootstrap` | An MCP server detected a sibling package with a divergent **major** version on startup. Returned by every subsequent tool call until the user resolves the mismatch. `details: { package, installed_version, expected_version, expected_range }`. Minor-version drift is not a failure; it surfaces as an in-band warning of the same name on the first call instead. |
| `MODULE_FILE_COLLISION` | `merge` | Two modules contributed the same file path. `details.path`, `details.modules`. |
| `MODULE_CONFLICT` | `merge` | Two modules declared as mutually exclusive are both present. `details.modules`. |
| `MODULE_SPEC_INCOMPAT` | `merge` | A module's `spec_compat` range does not satisfy the AppSpec's `spec_version`. `details.module`, `details.declared`, `details.actual`. |
| `MODULE_NOT_SUPPORTED_BY_TEMPLATE` | `merge` | The template's `supported_modules.allowlist` is non-empty and does not include the requested module. `details.template`, `details.module`. |
| `MANIFEST_KEY_CONFLICT` | `merge` | Two modules contributed conflicting values for a `set` or `set-if-unset` manifest key. `details.key`, `details.base_value`, `details.module_values`. |
| `MANIFEST_KEY_UNKNOWN` | `merge` | A module manifest delta references a key with no declared strategy. `details.key`, `details.module`. |
| `INIT_ORDER_CYCLE` | `merge` | Module `before`/`after` constraints form a cycle. `details.cycle`. |
| `WIRING_CONTRACT_VIOLATION` | `merge` | A module requires an export the template does not provide, or targets an init hook the template does not declare. `details.module`, `details.requirement`, `details.reason`. |
| `LINT_REQUIRED` | `freeform` | A `dev_loop` was attempted on a freeform project with source changes since the last successful lint. Use `freeform_lint_override: true` to bypass (logged). |
| `MERGE_AMBIGUOUS` | `merge` | Reserved generic code for merger ambiguities not covered by a more specific code; should be rare. |

**In-band warning codes (returned on `ok: true` responses).** Distinct from failure codes; surfaced via `details.warnings: [{ code, message, ... }]` on a successful response. Schema enforced separately:

| Code | Returned by | Meaning |
|---|---|---|
| `LOG_STREAM_OVERFLOW` | `log_stream_read` | The previous read window dropped lines because the consumer fell behind the producer; `dropped_lines` carries the count. Read continues normally. |
| `APPSPEC_PROMOTED` | `generate_app`, `package_app` | A v1 AppSpec was promoted to v2 in-memory (§3.5). |
| `BDP_FALLBACK_TO_TELNET` | `roku-debug-session` (skill-level), surfaced via `details.warnings` on the skill's tool calls | BDP unavailable; skill is using telnet log-stream only. |
| `CROSS_PACKAGE_VERSION_MISMATCH` | every MCP server's first successful tool call after startup, when only minor-version drift is detected against a sibling package | A sibling package's minor version diverges from this server's expected range. Same `details` shape as the failure code; the call still succeeds. Major-version drift returns the failure code instead. |

### 4.7 Security posture

#### 4.7.1 ECP keypress allowlist

Standard ECP keys: `Home`, `Rev`, `Fwd`, `Play`, `Select`, `Left`, `Right`, `Down`, `Up`, `Back`, `InstantReplay`, `Info`, `Backspace`, `Search`, `Enter`, `VolumeDown`, `VolumeUp`, `VolumeMute`, `Power`, `PowerOff`, `ChannelUp`, `ChannelDown`, `InputTuner`, `InputHDMI1`, `InputHDMI2`, `InputHDMI3`, `InputHDMI4`, `InputAV1`, `FindRemote`.

`Lit_<char>` literal-key form: `<char>` must be a single printable ASCII codepoint (0x20-0x7E) **excluding** `/`, `?`, `#`, `%`, `&`, `+`, `\`, and the space character. All ASCII control codes (0x00-0x1F, 0x7F) are excluded. Non-ASCII codepoints (UTF-8 multibyte) are excluded.

The complete allowlist lives as a static, exported constant in `roku-device-client/src/ecp/keys.ts` and is auditable by reading one file. It is not user-configurable at runtime. Disallowed keys return `{ ok: false, code: "ECP_KEY_DISALLOWED", details: { key } }` (distinct from the param-key error in §4.7.2).

#### 4.7.2 ECP input/launch param allowlist

`ecp_input` and `ecp_launch` URL-encode caller-supplied param values. Param **keys** are validated against an allowlist defined as a static constant in `roku-device-client/src/ecp/params.ts`, scoped per-tool:

- `ecp_input` allowed keys: `accelerator`, `mediaType`, `contentId`, `contentLabel`, `playbackPosition`, `streamFormat`, plus a developer-extensible namespace `x_*` (any key matching `^x_[A-Za-z0-9_]+$` is allowed; this is the documented escape hatch for channel-specific deep-link params). Param values are URL-encoded; no further validation.
- `ecp_launch` allowed keys: `contentId`, `mediaType`, plus the `x_*` namespace.

Disallowed keys return `{ ok: false, code: "ECP_PARAM_DISALLOWED", details: { key } }`.

#### 4.7.3 Secret handling

- `dev_password`, signing passwords (for `pack_signed` and `rekey`), and any registry secret material are **never** logged or echoed. Tool result schemas explicitly omit them from echo fields. Structured logs redact via a constant-time replacer that scans for known secret-bearing field names.
- **Signing passwords are never stored in the registry.** `pack_signed` and `rekey` accept the signing password per-call only. An attempt to add a signing-password field to `devices.toml` is silently ignored on read and stripped on next write. Per-call resolution per §2.4 omits the registry step (step 5).
- Plaintext `dev_password` storage at 0600 is documented in §4.1, including the macOS Spotlight/Time Machine backup vector.

#### 4.7.4 Telnet exposure

Telnet 8080/8085/8087 are unauthenticated by Roku design; anyone on the LAN can connect. The toolkit does not change this. Implications:

- On shared/untrusted networks (hotel Wi-Fi, conferences), `log_stream_*` and `log_tail` may expose channel logs to other clients on the LAN. The `roku-network-doctor` skill warns when the current network classifies as `unknown` and a long-running stream is requested.
- BDP 8081 is also unauthenticated. A user running `debug_attach` on a hostile LAN exposes their channel's runtime state. Same warning surface.
- This is a Roku-platform constraint, not a `rokudev-tools` defect; documented but not mitigated.

## 5. Knowledge plane

### 5.1 brs-docs tools

| Tool | Purpose |
|---|---|
| `brs_search(query, kind?, limit)` | Full-text search across the corpus. |
| `brs_get(id)` | Fetch a single doc by id (e.g. `component:roDateTime`, `interface:ifSGNodeFocus`). |
| `brs_list(kind, prefix?)` | List entries of a kind (`component`, `interface`, `event`, `node`, `sample`, `feature_module`, `template`). |
| `brs_sample_read(id, byte_offset?, byte_limit?)` | Read the body of a `kind: sample` entry whose body was truncated by `brs_get` (file > 64 KB). Streams a slice; default `byte_limit` 64 KB. |
| `brs_recommend(intent)` | Takes a free-text intent ("how do I add a `RowList` with rotating focus on first item?") and returns a ranked set of `{ doc, sample, feature_module }` references. See §5.1.1 for the ranking algorithm. No external LLM call from inside `brs-docs`. |

#### 5.1.1 brs_recommend ranking

No vector store, no embedding model. The ranker is a transparent hybrid:

1. **Lexical retrieval.** The intent string is tokenized and queried against FTS5 with BM25 across the `title`, `summary`, `body`, and `tags` columns. The top 50 candidates per kind (`component`, `interface`, `node`, `sample`, `feature_module`, `template`) are gathered.
2. **Tag boost.** A small static keyword→tag table (e.g. "rotating focus" → tags `focus`, `RowList`; "subscription" → tags `pay`, `billing`) adds boost weights. The table lives in `brs-docs/src/brs_docs/recommend/tags.toml` and ships with the package.
3. **Module-precondition match.** When the intent mentions a feature category (`pay`, `subscription`, `ad`, `sso`), feature modules whose ids contain that category get a category-specific boost. The boost values live in the same `tags.toml` and are auditable.
4. **Final score.** `score = bm25 + Σ tag_boosts + module_category_boost`. Top K (default 5, max 20) are returned with each candidate's score and contributing factors in `details.scoring` so the caller can see why a result ranked where it did.

A fixture-based regression test (`brs-docs/tests/recommend/`) pins the top-K results for a curated set of representative intents so changes to the ranker are visible in code review.

### 5.2 Corpus contents at v1

| Source | Indexed as | Refresh |
|---|---|---|
| `rokudev/dev-doc` | `kind: component / interface / event / node / concept` | Pinned to a commit SHA at release; `brs docs refresh` upgrades. |
| `rokudev/samples`, `rokudev/scenegraph-master-sample` | `kind: sample` (with `path`, `language`, `summary`, `tags`, full file `body`) | Same release-pin model; `brs docs refresh` re-clones. |
| `rokudev-tools` feature modules | `kind: feature_module` (id, summary, AppSpec excerpt, prerequisites) | Generated from the module registry at build time. |
| `rokudev-tools` base templates | `kind: template` (id, summary, AppSpec excerpt, supported modules) | Same. |

**Sample retrieval shape.** `brs_get(id)` for `kind: sample` returns `{ id, kind: "sample", path, language, summary, tags, body }`. `body` is the full file text for files under 64 KB; for larger files, `body` is omitted and `body_truncated: true` plus a `byte_count` field is set, and the caller fetches via `brs_sample_read(id, byte_offset?, byte_limit?)`.

### 5.3 Refresh story

`brs docs refresh` (CLI in the plugin) re-pulls upstream sources at HEAD, rebuilds the SQLite FTS5 index in `~/.cache/brs/docs/`, and writes a `corpus.lock` recording the resolved SHAs. Refresh is explicit, never automatic. Internal users on the corp network may configure a mirror in `~/.config/rokudev/config.toml` (`internal.use_corp_doc_mirror = true` plus `corpus.mirror_url`).

**Pre-bundled corpus.** The `brs-docs` PyPI package ships with a pre-built SQLite FTS5 index for the corpus pinned at release time, located at `<package>/data/corpus.sqlite`. First-run `brs-docs` does not require network access; the pre-bundled corpus is copied (or symlinked) into `~/.cache/brs/docs/` on first use. `brs docs refresh` is the way to upgrade beyond the bundled snapshot.

**Refresh failure behavior.** Refresh is transactional. The new corpus is built into `~/.cache/brs/docs.new/` (atomic rename to `~/.cache/brs/docs/` on success). On any failure (network, parse error, FTS5 build failure), `~/.cache/brs/docs/` is left untouched and the existing corpus continues to serve queries. The CLI prints the failure stage and a recovery hint. Air-gapped environments can run with the pre-bundled corpus indefinitely.

### 5.4 LSP-as-tool inside brs-gen

Optional, project-scoped. The freeform path uses it when a workspace is open; otherwise it falls back to `brs-docs` lookups plus the bsc lint pass for symbol resolution.

| Tool | Purpose |
|---|---|
| `lsp_open_workspace(project_dir)` | Spawn a BrighterScript LSP, hand it the project, return a workspace handle. |
| `lsp_close_workspace(handle)` | Tear down. |
| `lsp_diagnostics(handle, file?)` | Current diagnostics for the workspace or a single file. |
| `lsp_hover(handle, file, line, char)` | Hover info at a position. |
| `lsp_definition(handle, file, line, char)` | Go-to-definition. |
| `lsp_references(handle, file, line, char)` | Find references. |
| `lsp_document_symbols(handle, file)` | Symbol outline. |
| `lsp_workspace_symbols(handle, query)` | Symbol search across the workspace. |

**Workspace lifecycle and orphan reaper.**

- Every workspace is owned by exactly one MCP session (the `brs-gen` server process). Handles are scoped to that process.
- Idle timeout: a workspace with no `lsp_*` call in 15 minutes is auto-closed and the LSP child process killed.
- Parent watchdog: each spawned BrighterScript LSP child monitors its parent PID via `process.on('disconnect')` and an explicit `setInterval` that checks `process.ppid !== 1`. On parent exit (crash or SIGKILL), the child terminates within 5 seconds.
- Reaper at startup: `brs-gen` scans `~/.cache/brs/lsp-pids/` on boot and `kill(0, pid)` -tests each entry; stale entries (process gone or pgid not matching) are cleaned up. Crash-leaked LSP processes are detected and killed by a periodic 60-second reaper sweep on the same directory.
- These mechanisms together ensure no orphan BrighterScript LSP processes accumulate across crashes.

**LSP version pin.** v1 pins to a specific BrighterScript LSP minor version range declared in `brs-gen/package.json`'s `peerDependencies` (e.g. `^0.69.0` if 0.69 is current at v1 release). The pin is documented in `docs/architecture.md`; upgrading the pin requires a regression run against the LSP-using skills (`roku-debug-session`, `roku-vibe`, freeform path). Templates' BrighterScript syntax features are restricted to those supported by the pinned version.

### 5.5 bsc lint

| Tool | Purpose |
|---|---|
| `lint(project_dir)` | Run `bsc --no-watch` over the project, return structured diagnostics. Mandatory in both deterministic and freeform paths. |

The existing `roku-bsc-lint` skill becomes a thin wrapper.

## 6. Skills layer

### 6.1 Composition rule

Skills must not introduce new **Roku-device-touching** transports. If a skill needs a Roku call that doesn't exist in `rokudev-device`, the answer is to add the tool to `rokudev-device` and update the skill, not to open a socket from inside the skill. Local non-Roku work (image processing in `roku-asset-pipeline`, manifest text linting in `roku-manifest-validator` before being moved into `brs-gen`, file scanning, etc.) is permitted; only HTTP/telnet/binary-protocol calls to a Roku device are restricted. This rule keeps the error taxonomy and addressing model coherent over time.

### 6.2 Existing skills updated in place

| Skill | Now calls | Notes |
|---|---|---|
| `roku-dev-loop` | `rokudev-device.dev_loop` | Args change to `device:` (registry name). |
| `roku-bsc-lint` | `brs-gen.lint` | Structured diagnostics format unified. |
| `roku-rooibos-test` | `brs-gen.lint` + `rokudev-device.dev_loop` + telnet capture | Test-runner flow stays the same; transport unified. |
| `roku-smoke-test` | `rokudev-device.dev_loop_with_smoke` + `rokudev-device.screenshot` | Thin orchestrator over the new composite tool. |
| `roku-deep-link-test` | `rokudev-device.ecp_launch` + `log_stream_*` + `screenshot` | Same flow, cleaner errors. |
| `roku-triage` | `rokudev-device.screenshot` + `log_tail` + `crashlog_pull` + `profiler_snapshot` + `debug_attach` | New: BDP attach to inspect at the moment of failure. |
| `roku-perf-trace` | `rokudev-device.log_stream_*` + `rokudev-device.profiler_snapshot` | Capture-and-summarize unchanged. |
| `roku-asset-pipeline` | local image work + `brs-gen.validate_assets` | Adds a validate step against template requirements. |
| `roku-ecp-recipes` | `rokudev-device.ecp_*` | Recipe content unchanged. |
| `roku-manifest-validator` | `brs-gen.validate_manifest` | Logic moves into the MCP; skill becomes orchestration. |

### 6.3 New skills at v1

| Skill | Purpose |
|---|---|
| `roku-vibe` | Flagship. Free-text product description in, draft AppSpec out, generate, sideload, smoke-test, report. End-to-end happy path. Opinionated by default (asks no more than 3 clarifying questions, picks defaults aggressively); `--thorough` flag for full elicitation. |
| `roku-debug-session` | Wraps `debug_attach` and the BDP toolset into a guided debugging conversation. Replaces manual telnet poking. |
| `roku-module-add` | Add a feature module to an existing project. Reads `.rokudev-tools/provenance.json`, validates compatibility against the conflict matrix, regenerates affected files, re-lints, optionally re-sideloads. |
| `roku-module-remove` | Inverse of `roku-module-add`. |
| `roku-eject` | Convert a rokudev-tools-managed project (with provenance) into a plain hand-edit-friendly project. One-way at v1; documented as such. |
| `roku-channel-store-precheck` | Local equivalents of Channel Store submission checks (manifest sanity, splash dimensions, signed-package round-trip, dev-portal warnings). Not a substitute for actual submission. |
| `roku-network-doctor` | Diagnose multi-network situation. Reports current network classification, lists registered devices and reachability, flags devices whose `last_seen` is stale. |

### 6.4 Headline skill: roku-vibe

`roku-vibe` is the v1 deliverable that makes the "vibe coding for Roku" tagline concrete. The opinionated default prioritizes the demonstration value of "watch a channel come together in real time." The `--thorough` flag exists for users who want full requirement elicitation (re-uses the brainstorming skill flow under the hood).

**Disambiguation defaults.** When the user prompt is ambiguous, `roku-vibe` (default mode) does not ask; it picks per a deterministic table:

| User prompt fragment | Default template | Default modules |
|---|---|---|
| "streaming app", "video app", "watch", "OTT" | `video_grid_channel` | `auth.device_link_code`, `analytics.event_pipe`, `deep_link.global` |
| "subscription", "paywall" | (current template) + `monetization.roku_pay.subscription` | (preserve existing) |
| "ads" | (current template) + `ads.raf_csai` | (preserve existing) |
| "music", "audio", "podcast" | `music_player` | `auth.device_link_code`, `analytics.event_pipe`, `deep_link.global` |
| "news" | `news_channel` | `analytics.event_pipe`, `deep_link.global` |
| "screensaver" | `screensaver` | (none) |
| "game" | `game_shell` | `analytics.event_pipe` |
| Anything else (no template hit) | `blank_scenegraph` (freeform path) | (none) |

The table lives in `skills/roku-vibe/defaults.toml`. `--thorough` always asks; `--default-template <id>` overrides the picked template; `--no-defaults` disables the table and asks instead.

**BDP fallback.** When `roku-debug-session` (called from `roku-vibe` for "let's debug this") encounters `BDP_ATTACH_FAILED` or `BDP_VERSION_UNSUPPORTED`, it degrades to a telnet-based session via `log_stream_*` and surfaces a single warning: "real breakpoints unavailable on this RokuOS; using log stream only."

## 7. Distribution and repo layout

### 7.1 Monorepo layout

Single repository at `/Users/bblietz/Work/ClaudeProjects/rokudev-tools/` (currently empty). Single fixed SemVer across all packages.

```
rokudev-tools/                                  ← monorepo root
├── package.json                            ← workspaces root
├── pnpm-workspace.yaml                     ← workspaces config
├── turbo.json                              ← cross-package build/test orchestration
├── .release/
│   └── version.json                        ← single SemVer for all packages
├── packages/
│   ├── roku-device-client/                 ← npm: @rokudev/device-client (TS lib)
│   │   └── src/{http,ecp,devportal,telnet,bdp,registry,errors}.ts
│   ├── rokudev-device/                         ← npm: rokudev-device (MCP, TS)
│   │   └── src/{tools,server.ts}
│   ├── brs-gen/                            ← npm: brs-gen (MCP, TS)
│   │   └── src/{templates,modules,merger,freeform,lint,lsp,server.ts}
│   └── brs-docs/                           ← PyPI: brs-docs (MCP, Python)
│       └── src/brs_docs/{corpus,fts,tools,server.py}
├── modules/                                ← feature module sources
│   ├── monetization.roku_pay.subscription/
│   ├── monetization.roku_pay.transactional/
│   ├── ads.raf_csai/
│   ├── ads.raf_ssai/
│   ├── auth.device_link_code/
│   ├── auth.oauth_device_grant/
│   ├── auth.roku_os_signin/
│   ├── analytics.event_pipe/
│   ├── deep_link.global/
│   └── accessibility.captions/
├── templates/                              ← base template sources
│   ├── screensaver/
│   ├── video_grid_channel/
│   ├── news_channel/
│   ├── game_shell/
│   ├── blank_scenegraph/
│   └── music_player/
├── plugin/                                 ← Claude Code plugin
│   ├── plugin.json
│   ├── mcp.json                            ← wires brs-gen, rokudev-device, brs-docs
│   └── postinstall                         ← runs `brs setup`
├── skills/                                 ← roku-* skills (kept here for lockstep release)
│   ├── roku-vibe/
│   ├── roku-debug-session/
│   ├── roku-module-add/
│   ├── roku-module-remove/
│   ├── roku-eject/
│   ├── roku-channel-store-precheck/
│   ├── roku-network-doctor/
│   └── ... (existing roku-* skills moved/symlinked here)
├── corpus/                                 ← brs-docs source pins
│   ├── pin.toml                            ← rokudev/dev-doc SHA, samples SHAs
│   └── build/                              ← generated SQLite (gitignored)
├── eval/                                   ← freeform-path eval set + smoke fixtures
├── docs/
│   ├── superpowers/specs/2026-05-06-roku-tools-prd-design.md
│   ├── architecture.md
│   ├── migration-from-prototypes.md
│   └── module-author-guide.md
├── scripts/
│   ├── release.sh                          ← single-version bump, publish all packages, plugin
│   ├── ci-bootstrap.sh                     ← `corepack enable` + pnpm activation; fallback for envs without pnpm
│   └── smoke.ts                            ← captures real-device fixtures (manual)
└── tools/
    └── brs-cli/                            ← `brs` CLI (subcommands enumerated below)
```

**`brs` CLI subcommands (v1):**

| Subcommand | Purpose |
|---|---|
| `brs setup` | One-shot install hook. Creates `~/.config/rokudev/` (0700), default `config.toml`, empty `devices.toml` (0600). Adds Spotlight exclusion best-effort. |
| `brs devices add <name> --host=<ip> [--password=<pw>]` | Add or upsert a device registry entry. |
| `brs devices set-password <name>` | Prompts for password (no echo); writes to registry under `flock`. |
| `brs devices list` | Prints `device_list` output as a table. |
| `brs devices discover` | Runs SSDP discovery; prints found devices and offers to add to registry. |
| `brs devices remove <name>` | Removes a registry entry. |
| `brs devices set-active <name>` | Sets `active`. |
| `brs docs refresh [--mirror=<url>]` | Re-pulls upstream sources, rebuilds FTS5 index transactionally. |
| `brs docs status` | Shows pinned SHAs, last refresh, corpus byte size. |
| `brs spec upgrade <file>` | Promotes a v1 AppSpec on disk to v2. Writes back atomically. |
| `brs devices update-fingerprints` | Force-refresh the error-overlay screenshot fingerprint pack used by `dev_loop_with_smoke` (§4.3). Normally these refresh automatically with `rokudev-device` package upgrades. |
| `brs version` | Prints package versions; includes the load-bearing `telemetry: none` line (§8.5). |

### 7.2 Toolchain

- TS workspaces with `pnpm` (deterministic resolutions, fast cold install).
- `Turborepo` for cross-package build/test orchestration (cached, parallel).
- `Vitest` for unit tests (already used in `brs-mcp`).
- Python uses `uv` for dependency management (already used in `brs-mcp-for-docs`).

### 7.3 Release process

1. Bump `.release/version.json`. All three published packages and the plugin take the same SemVer.
2. CI runs full quality gate: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && uv run pytest`.
3. Real-device smoke tests are a required CI check that asserts one of two outcomes: (a) **smoke ran and passed** (real Roku attached, smoke suite green), or (b) **smoke explicitly skipped** with a documented reason recorded in the release notes (e.g. `SKIPPED_NO_DEVICE_ATTACHED`, `SKIPPED_DEVICE_OFFLINE`). A silent skip never passes CI; the smoke step always emits one of the two outcomes.
4. **Publish ordering (not atomic).** True cross-registry atomicity is not possible (npm and PyPI are independent registries with no two-phase commit and asymmetric un-publish policies). The release runs in this order to minimize blast radius on partial failure:
   1. `uv publish` to PyPI first (`brs-docs`). Smaller blast radius; if it fails, no npm packages have been published.
   2. `npm publish` for `roku-device-client`, `rokudev-device`, `brs-gen` in dependency order. Each publish is a separate operation; if any fails after PyPI succeeded, that PyPI version remains and the npm versions that did publish remain. The release script:
      - Never re-publishes the same version on partial failure (npm rejects re-publish anyway).
      - Bumps to the next patch and re-runs from step 1, leaving the failed version visible but not advanced via dist-tag.
   3. The npm `latest` dist-tag and PyPI's "current" pointer are advanced **only after all packages succeed**. Users running `npm i brs-gen` always pull a coherent set.
5. The Claude Code plugin is published last, after all three MCP packages and the shared library are at the same version. The plugin declares exact `=X.Y.Z` pins.
6. **Rollback.** Because partial publishes cannot be unpublished cleanly, "rollback" means: keep the partial-publish versions on the registry as orphan versions, never advance dist-tags, and document the orphans in `CHANGELOG.md`. Subsequent releases use the next version.
7. **Cross-package version compatibility check at runtime.** Each MCP server reads the published version of its sibling packages (resolved via `node_modules` for TS packages and `pkg_resources` for Python) on startup. **Major-version divergence** (e.g. user installed `brs-docs@2.x` from PyPI directly while the plugin pins `brs-gen@1.x`/`rokudev-device@1.x`) returns the **failure** code `CROSS_PACKAGE_VERSION_MISMATCH` (stage `bootstrap`, see §4.6) on every subsequent tool call until the user resolves the mismatch. **Minor-version drift** is permitted; it surfaces as the **in-band warning** with the same code on the first call only. This protects users from the orphan-PyPI-version edge case in step 4.

**Note on the npm scope.** This PRD assumes `@roku` is available as an npm scope or is owned by Roku. If it is not, the package is published as `roku-device-client` (unscoped) instead. This is settled at repo init, not here; flagged as an open question in §8.4.

### 7.4 Migration from prototypes

`docs/migration-from-prototypes.md` provides a per-tool table mapping every prototype tool to its unified equivalent or to a documented deprecation. The three prototype repos receive a final release with a deprecation notice pointing to `rokudev-tools`. They are not deleted.

**Behavior changes the migration document must call out (non-exhaustive):**

- ECP keypress allowlist tightened: `&`, `+`, `\` added to `Lit_<char>` exclusion list; `Power`, `PowerOff` added to standard keys (§4.7.1). Existing scripts that sent these as `Lit_` literals will receive `ECP_KEY_DISALLOWED`. Lands at the v1.0.0 boundary; first release where the error code is observable. Per-channel `ecp_input` / `ecp_launch` param-key violations remain `ECP_PARAM_DISALLOWED` (§4.7.2).
- `roku_install` (prototype) → `sideload` (this PRD); accepts `device:` registry name in addition to per-call host/password.
- `roku_remove` (prototype) → `unload` (this PRD).
- `host` parameter normalized: per-call argument always wins; new precedence chain in §2.4.
- Telnet log capture: prototype `telnet_capture_session` → `log_tail` (one-shot) and `log_stream_*` (long-running). Behavior unchanged; tool names and shapes change.
- New requirement: `brs-gen` requires a project to lint clean before sideload in freeform mode (`LINT_REQUIRED`). Deterministic-path projects from `brs-mcp` are unaffected unless they fail lint, which surfaces a previously-hidden bug.

## 8. v1 release scope

### 8.1 Shipping in v1.0.0

- 3 MCP packages (`brs-gen`, `rokudev-device`, `brs-docs`) plus 1 shared library (`@rokudev/device-client`), single fixed version.
- 6 base templates: `screensaver`, `video_grid_channel`, `news_channel`, `game_shell`, `blank_scenegraph`, `music_player`.
- 10 feature modules: Roku Pay subscription, Roku Pay transactional, RAF CSAI, RAF SSAI, three auth flows (`auth.device_link_code`, `auth.oauth_device_grant`, `auth.roku_os_signin`), `analytics.event_pipe`, `deep_link.global`, `accessibility.captions`.
- BDP debugger client at v1 scope (attach + detach + breakpoints + step/over/out + continue + pause + stack + threads + variables + eval).
- Persistent device registry with SSDP `roku:ecp` discovery, network detection with warnings, plaintext password store at 0600 perms.
- Mandatory `bsc` lint pass on both deterministic and freeform paths.
- LSP-as-tool inside `brs-gen`, optional and project-scoped.
- All existing `roku-*` skills updated to call the unified surface (the 10 skills enumerated in Section 6.2: `roku-dev-loop`, `roku-bsc-lint`, `roku-rooibos-test`, `roku-smoke-test`, `roku-deep-link-test`, `roku-triage`, `roku-perf-trace`, `roku-asset-pipeline`, `roku-ecp-recipes`, `roku-manifest-validator`).
- 7 new skills: `roku-vibe`, `roku-debug-session`, `roku-module-add`, `roku-module-remove`, `roku-eject`, `roku-channel-store-precheck`, `roku-network-doctor`.
- `rokudev-tools` Claude Code plugin (one-shot install).
- Migration table and per-prototype deprecation releases.

### 8.2 Deferred to v1.x

| Category | Item | Reason |
|---|---|---|
| Templates | `podcast` | Will share components with `music_player`; promote together once `music_player` is hardened. |
| Templates | `live_linear_channel` | EPG data sources vary wildly per partner; no single template captures it cleanly. |
| Templates | `kids_safe_channel` | PIN-gated content category; smaller demand. |
| Modules | `drm.widevine`, `drm.playready` | External devs shipping DRM typically have vendor-supplied integration code. |
| Modules | `notifications.targeted` | Needs design across the ECP and dev-portal surfaces. |
| Modules | `analytics.adobe_video`, `analytics.conviva` | Vendor-specific; lower priority than `analytics.event_pipe`. |
| Debugger | Conditional breakpoints, watch expressions, hot-reload | BDP support varies by RokuOS version; large surface. |
| Skills | `roku-uneject` | Bidirectional re-import. v1 ejection is one-way to keep the merger simple. |
| Distribution | Persistent discovery daemon | The one-shot discovery covers the common case; daemon lifecycle adds complexity. |
| i18n | Locale-specific resource directories (`locale/en_US/`, etc.) | Templates ship `en_US` only at v1. Channel Store submission requires the directory layout, but localized strings are out of scope; users add locales themselves. v1.x will introduce a `locales` field on AppSpec and a `locale/<tag>/` per-template scaffold. |
| Smoke | Positive-fingerprint and content-aware smoke | v1 smoke detects error overlays only. v1.x will add per-template positive fingerprints (e.g. "RowList focused with content visible") and a baseline-diff mode for incremental projects. |

`music_player` was promoted from this list into v1 by user request.

### 8.3 Risks and mitigations

| Risk | Mitigation |
|---|---|
| BDP version drift across RokuOS releases breaks `debug_attach` on user devices. | Version-negotiate at attach; degrade gracefully to telnet log streaming with a clear message; CI smoke against multiple device models. |
| BrighterScript `.bs` source maps drift or are absent, leaving breakpoints on the wrong line. | `.bs` breakpoints require `<file>.brs.map`; missing map returns `BDP_NO_SOURCE_MAP` with a hint; `bsc` lint pass surfaces missing `sourceMap: true` configuration before sideload. |
| Freeform path produces channels that lint-clean but crash on device. | Lint gate enforced by `dev_loop` (per §3.3 step 4); smoke test mandatory in the freeform skill flow; eval set treated as a regression gate; eval set authored independently of the freeform implementation. |
| Module merger conflicts accumulate as the catalog grows. | Strict per-module file namespace (§3.2.2); explicit conflict matrix (§3.2.3); manifest-key strategies (§3.2.4); init-order topological sort with cycle detection (§3.2.5); wiring contract validation (§3.2.6); combinatorial merger test (see below). |
| **Combinatorial module compatibility regression.** With 10 v1 modules there are 45 pairs and ~120 size-3 subsets. Without test coverage, "modules don't conflict" is a hope. | CI generates every legal `(template, module-subset)` combination up to subset size 3 (template × subset cardinality is bounded; ~6 templates × ~120 subsets ≤ ~720 combinations) and asserts each merges, lints clean, and zips. Combinations declared incompatible via the conflict matrix are excluded. New modules must extend the matrix or adjust file namespaces, not the test. |
| Network detection false positives on multi-VLAN corp networks (HSRP/VRRP virtual MACs). | Fingerprint is a tuple (gateway MAC + /24 subnet + DNS suffix + VPN-iface presence) per §4.2. Remaining false positives are escapable via per-call `force: true`. |
| Plaintext dev_password leaks via accidental commit, clipboard, log paste, Spotlight indexing, or Time Machine backup. | 0600 perms enforced; `ROKUDEV_NO_PLAINTEXT=1` opt-in for env-only mode; `.gitignore` template includes `~/.config/rokudev/`; `brs setup` adds Spotlight exclusion best-effort and warns about Time Machine; passwords never logged. |
| Internal-only features (templates that depend on internal feeds, RAF test ad servers) leak into the public package. | All internal-only behavior gated behind `[features.internal]` config flags (§2.5); `pnpm check:no-internal` lint runs at publish time and fails the release if any internal-only path is reachable without a `features.internal.*` guard. |
| Three prototype repos remain in active use after v1, splitting the user base. | Final deprecation release with prominent README banner; migration table; plugin auto-detects and warns on old MCPs in user config. |
| Telnet 8085 / BDP 8081 are unauthenticated; channel logs and runtime state are exposed on shared LANs. | Roku-platform constraint, not a `rokudev-tools` defect. `roku-network-doctor` warns when `unknown` network classification is paired with a long-running stream or debug session. |
| Orphan BrighterScript LSP processes accumulate after `brs-gen` crashes. | Idle timeout, parent-PID watchdog, startup reaper, periodic 60s reaper sweep on `~/.cache/brs/lsp-pids/` (§5.4). |
| `pnpm` not available in external CI environments. | Document `corepack enable` activation path; provide a `scripts/ci-bootstrap.sh` that uses `corepack` or falls back to `npm i -g pnpm@<pin>`; npm-script-only invocations work via `pnpm exec` or via direct `node` for the published binaries. |

### 8.4 Open questions (to resolve during implementation)

The following items are intentionally left open for the implementation phase. They do not gate the design.

1. **BDP reference implementation review.** During implementation we will study the BrighterScript debug-adapter source for protocol framing. License compatibility check needed (most are MIT, expected to be fine).
2. **BrighterScript LSP version pin.** Pick a known-good version at v1 (per §5.4). Document upgrade cadence.
3. **Eval set construction.** The freeform-path quality bar (≥ 80% pass on long-tail prompts in §1.5) needs an actual eval set. Authoring is a v1 implementation task; the design defines the bar but not the contents.
   - **Conflict-of-interest mitigation:** the eval set must be authored by someone other than the freeform-path implementer, or peer-reviewed by a Roku DevRel engineer outside the project. The eval is checked into `eval/freeform/` and runs in CI.
4. **BDP version scheme.** The version negotiation in §4.5.2 assumes integer protocol versions. Validate against current RokuOS firmware before implementation; if Roku publishes a non-integer scheme (e.g. `1.2`), adjust the `[min, max]` range type. Capture the validation result in the implementation plan.
5. **npm scope ownership.** The PRD assumes `@roku` is available as an npm scope or owned by Roku. If neither, the shared library is published as `roku-device-client` (unscoped). Settle at repo init and update §7.1.

### 8.5 Stated guarantees (not "open" - committed)

The following items are decisions, not open questions. They are stated here so they appear in release notes, README, and `--version` output.

- **No telemetry in v1.** `brs-gen`, `rokudev-device`, `brs-docs`, the `brs` CLI, and the Claude Code plugin emit no telemetry. No hosted backend exists. No HTTP requests are made except to Roku devices the user has registered, GitHub for `brs docs refresh`, and the configured corp doc mirror when `internal.use_corp_doc_mirror` is set. The `brs --version` output reads "telemetry: none" as a load-bearing string; CI asserts the line is present.
- **Plaintext password storage** is documented in the README, in `brs setup` first-run output, and in `brs devices add`'s confirmation prompt. Users are explicitly informed of the choice at every storage point.
- **Public export surface of `roku-device-client`** (per §2.3) is part of the SemVer guarantee; `_internal/` is not.

## 9. Glossary

| Term | Meaning |
|---|---|
| AppSpec | The declarative input to `brs-gen`. Versioned (`spec_version`), validated by Zod schemas. The current shape is `spec_version: 2`; legacy `spec_version: 1` shapes from the prototype `brs-mcp` are accepted via in-memory promotion (§3.5). |
| Base template | A hand-authored, device-tested project skeleton for a particular kind of channel (`video_grid_channel`, etc.). |
| Feature module | A composable, additive contribution declared in the AppSpec (manifest deltas, files, wiring contract, config schema, conflict matrix). |
| Provenance manifest | `.rokudev-tools/provenance.json` recording which template, modules, and versions produced which files. Enables `roku-module-add` and `roku-module-remove`. |
| BDP | BrightScript Debug Protocol. Roku's binary debug protocol; primary port 8081 with 8086 as a fallback on some firmwares (see §4.5.1). Distinct from the telnet debug console on 8085. The v1 client supports a defined subset (§4.5). |
| ECP | External Control Protocol. Roku's HTTP control surface on port 8060. |
| Telnet (8085) | The BrightScript debug console (read/write text). Used by `log_tail` and `log_stream_*`. One client at a time. Distinct from BDP. |
| Network tag | A label on a registered device (`home`, `corp`) used by the network detection heuristic to warn on cross-network access. |
| Freeform path | Path B in section 3.3. LLM-driven generation guarded by mandatory `bsc` lint, smoke test, and screenshot diff. |
| Deterministic path | Path A in section 3.2. Templates plus modules; same input produces the same bytes. |

## 10. Decision log (this brainstorming session)

| Q | Decision | Section |
|---|---|---|
| Q1 audience | C: both internal and external, single distribution. | 1.2 |
| Q2 generator philosophy | C: templates + composable modules + guarded freeform path. | 3 |
| Q3 architecture | B: three MCPs + shared `roku-device-client`. | 2 |
| Q4 device addressing | C: persistent registry + one-shot discovery. Sub: network detection on, dev_password plaintext. | 4.1, 4.2 |
| Q5 debugger | C: full BDP client; v1 scope per 4.5. | 4.5 |
| Q6 v1 catalog | A: accept proposed cut, then add `music_player` per follow-up. | 8.1 |
| Q7 LSP integration | C: LSP-as-tool inside `brs-gen`, optional, project-scoped. | 5.4 |
| Q8 distribution | B: monorepo, keep skills updated in place, single fixed version, pnpm + Turborepo + uv. | 7 |
