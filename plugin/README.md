# rokudev-tools Claude Code plugin

v0.1.0 of the rokudev-tools Claude Code plugin. Single artifact that wires three MCP servers and six workflow skills into a Claude Code session.

## What you get

### MCP servers (3)

| Server | Purpose | Tools |
|---|---|---|
| `rokudev-device` | Talk to a Roku in developer mode: sideload, ECP, profiler, BDP debugger, log capture | `dev_loop`, `sideload`, `screenshot`, `ecp_*`, `log_*`, `debug_*`, `profiler_snapshot`, `crashlog_pull`, ... |
| `brs-gen` | Generate / package BrightScript channels from AppSpec, validate manifests + assets, BrighterScript lint | `generate_app`, `package_app`, `lint`, `validate_manifest`, `validate_assets`, `list_templates`, `list_modules`, `get_template_schema`, `get_module_schema`, `spec_upgrade` |
| `brs-docs` | Search BrightScript reference + sample corpus | `brs_search`, `brs_get`, `brs_list`, `brs_sample_read`, `brs_recommend` |

### Skills (6, v0.1 scope = daily core loop)

| Skill | Triggers when... |
|---|---|
| `roku-dev-loop` | The user wants to rebuild, redeploy, or ship the channel to their Roku |
| `roku-smoke-test` | Post-deploy sanity check (launch + navigate + screenshot + scan log) |
| `roku-triage` | Channel crashed, hung, stuck on splash, or shows an error overlay |
| `roku-ecp-recipes` | Send keypresses, type, navigate, or deep-link the channel |
| `roku-manifest-validator` | Validate the `manifest` file (required keys, asset paths, dimensions) |
| `roku-bsc-lint` | Run BrighterScript compile-check before sideload |

The remaining 8 skills (assets, branding, slides, web, copy, deep-link-test, perf-trace, rooibos-test) ship in v0.2+.

## Install (local dev)

**v0.1 is a local-dev plugin pinned to the path `/Users/bblietz/Work/ClaudeProjects/rokudev-tools/packages/`.** Claude Code's marketplace install copies the plugin tree to `~/.claude/plugins/cache/`, which severs any `${CLAUDE_PLUGIN_ROOT}/../packages/` relative path. Until the packages publish to npm + PyPI (next iteration), the plugin needs an absolute path. If you fork this for your own use, edit `plugin/.mcp.json` to match your workspace location.

Build the workspace once before installing:

```bash
cd <path-to-rokudev-tools-repo>
pnpm install
pnpm -r build
```

Then install the plugin into Claude Code:

```bash
claude plugin install ./plugin
```

Restart your Claude Code session. Verify with `claude mcp list` that `rokudev-device`, `brs-gen`, and `brs-docs` are listed.

`brs-docs` is invoked via `uv --project <pkg> run brs-docs serve`, so `uv` must be on `PATH`.

## Install (published, future)

Once the packages are published to npm + PyPI, swap to:

```jsonc
{
  "mcpServers": {
    "rokudev-device": { "type": "stdio", "command": "npx", "args": ["-y", "rokudev-device@^0.2"] },
    "brs-gen":        { "type": "stdio", "command": "npx", "args": ["-y", "brs-gen@^0.6"] },
    "brs-docs":       { "type": "stdio", "command": "uvx", "args": ["brs-docs", "serve"] }
  }
}
```

## Acceptance tests

```bash
bash plugin/tests/test-install.sh
bash plugin/tests/test-skill-load.sh
```

See `plugin/tests/MANUAL-SMOKE.md` for the end-to-end stub_hello sideload check that proves the skill -> tool resolution path.

## License

MIT (matches the parent repo).
