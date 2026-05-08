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
