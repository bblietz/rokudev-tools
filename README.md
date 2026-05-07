# rokudev-tools

Unified Roku BrightScript developer toolkit. Three MCP servers, one shared library, one Claude Code plugin.

See `docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md` for the full design.

## Manual smoke against a real Roku

Set `ROKUDEV_DEFAULT_ROKU_HOST` and `ROKUDEV_ROKU_DEV_PASSWORD`, then run:

    pnpm build && node scripts/manual-smoke.mjs

## What's in v0.1 (Plan 1)

- `@rokudev/device-client` (TS library): RFC 2617 Digest auth, ECP HTTP, dev portal, telnet, SSDP discovery, registry, error taxonomy.
- `rokudev-device` (MCP, stdio): registry tools, ECP read/control, dev-portal sideload/unload/screenshot/genkey/rekey/sign/diff/registry/profiler/crashlog, telnet log_tail/log_stream, composite dev_loop, cross-package version check.

Not in this release: BDP debugger (Plan 2), generator + module merger (Plan 3), freeform/LSP (Plan 4), brs-docs (Plan 5), skills + plugin (Plan 6).
