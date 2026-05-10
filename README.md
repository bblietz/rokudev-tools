# rokudev-tools

Unified Roku BrightScript developer toolkit. Three MCP servers, one shared library, one Claude Code plugin.

See `docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md` for the full design.

## Manual smoke against a real Roku

Set `ROKUDEV_DEFAULT_ROKU_HOST` and `ROKUDEV_ROKU_DEV_PASSWORD`, then run:

    pnpm build && node scripts/manual-smoke.mjs

## Manual BDP smoke against a real Roku

Set `ROKUDEV_DEFAULT_ROKU_HOST` and `ROKUDEV_ROKU_DEV_PASSWORD`, sideload a channel that's currently running in dev mode, then run:

    pnpm build && node scripts/manual-bdp-smoke.mjs

Exercises `debug_attach`, `debug_threads`, `debug_detach` against the active dev channel. Prints each tool result. Exits cleanly if BDP is reachable; surfaces `BDP_ATTACH_FAILED` if not.

## What's in v0.1 (Plan 1)

- `@rokudev/device-client` (TS library): RFC 2617 Digest auth, ECP HTTP, dev portal, telnet, SSDP discovery, registry, error taxonomy.
- `rokudev-device` (MCP, stdio): registry tools, ECP read/control, dev-portal sideload/unload/screenshot/genkey/rekey/sign/diff/registry/profiler/crashlog, telnet log_tail/log_stream, composite dev_loop, cross-package version check.

Not in this release: BDP debugger (Plan 2), generator + module merger (Plan 3), freeform/LSP (Plan 4), brs-docs (Plan 5), skills + plugin (Plan 6).

## What's in v0.2 (Plan 2)

- BDP debugger client in `@rokudev/device-client`: TCP framing, version negotiation, port fallback (8081 -> 8086), session lifecycle with state guard, BrighterScript `.brs.map` source-map handling, explicit dispose on resolvers.
- 15 new MCP tools in `rokudev-device`: `debug_attach`, `debug_detach`, `debug_session_state`, `debug_set_breakpoint`, `debug_clear_breakpoint`, `debug_list_breakpoints`, `debug_continue`, `debug_step`, `debug_step_over`, `debug_step_out`, `debug_pause`, `debug_stack_trace`, `debug_threads`, `debug_variables`, `debug_eval`.
- `debug_attach` surfaces `details.invalidated_breakpoints` for breakpoints carried over from a previous session that has since detached/exited (per spec §4.5.4).

Out of v0.2: conditional breakpoints, watch expressions, hot-reload (deferred per spec §4.5).

## What's in v0.3 (Plan 3)

- `brs-gen` MCP server (new): generates Roku channels from an `AppSpec` plus bundled templates and composable feature modules. Deterministic, byte-reproducible output; mandatory in-process `bsc` compile via `brighterscript`.
- 10 MCP tools: `list_templates`, `get_template_schema`, `list_modules`, `get_module_schema`, `generate_app`, `package_app`, `validate_manifest`, `validate_assets`, `spec_upgrade`, `lint`.
- 1 stub template: `stub_hello` (deliberately minimal; exercises the pipeline end-to-end).
- 1 stub module: `stub_label` (exercises every merger feature - file overlay, manifest patching, component patching, dependency injection).

Out of v0.3: real templates (Plan 4), real feature modules (Plan 5), freeform LLM path (Plan 6), LSP tools (Plan 7), `brs-docs` MCP (later plan), skills + plugin (later plan). No real-device verification gate in this plan - the stub channel is deliberately uninteresting; Plan 4 will add the first T27-style gate when real templates land.

## What's in v0.4 (Plan 4)

- First production-reference template: `video_grid_channel`. Hero + category rows + details + player. Consumes a Roku Direct Publisher JSON feed; plays via SceneGraph's `Video` node.
- `AppSpec` gains optional `branding.{icon, splash, primary_color}` and `content.{feed_url, feed_format}` fields.
- New `sharp`-based asset pipeline. User supplies one high-res PNG; brs-gen buckets it into Roku's HD/FHD/UHD sizes and injects the manifest keys.
- New `TemplateConfig()` BrightScript emitter at `source/_template/config.brs` exposes template-level AppSpec fields to runtime code.
- T27 real-device verification gate established (sideload, launch, navigate, playback). PASS evidence in spec Appendix A. Plans 4a-4e reuse the shared helpers in `scripts/_t27-lib.mjs`.

Out of v0.4: remaining v1 templates (`screensaver`, `news_channel`, `game_shell`, `blank_scenegraph`, `music_player`, each a follow-up plan); feature modules (Plan 5); freeform LLM path (Plan 6); LSP tools (Plan 7); `brs-docs` MCP (later plan).
