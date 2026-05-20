# Manual smoke test: stub_hello end-to-end

The automated tests (`test-install.sh`, `test-skill-load.sh`) validate the
plugin manifest, MCP server registration, and skill metadata without
actually loading the plugin into a live Claude Code session. This doc
covers the half they can't: install the plugin, restart the session, and
prove that a skill can resolve the new MCP tool names against a real
Roku device.

## Prerequisites

- Built workspace packages:
  ```bash
  cd <path-to-rokudev-tools-repo>
  pnpm install
  pnpm -r build
  ```
- `brs-docs` runnable via `uv` (`packages/brs-docs` has its own `pyproject.toml`).
- A Roku in developer mode on the LAN with dev password `1234` (or set `BRS_ROKU_DEV_PASSWORD`).
- Note the Roku IP -- examples below use `10.3.21.233`. Substitute yours.

## 1. Install the plugin

From the repo root:

```bash
claude plugin marketplace add ./plugin
claude plugin install rokudev-tools@rokudev-tools
```

Expected: "installed" in the output. Restart Claude Code so the MCP
servers come up in the next session.

## 2. Confirm MCP server registration

In a fresh session:

```bash
claude mcp list
```

Expect to see (the exact format varies by CLI version, but all three
names must be present):

- `rokudev-device`
- `brs-gen`
- `brs-docs`

If any are missing, check Claude Code's log directory for the failed
stdio handshake (typically `~/.cache/claude/logs/`). The most common
cause is a missed `pnpm -r build` -- the `dist/index.js` files must
exist before the plugin tries to spawn them.

## 3. Generate stub_hello

Ask Claude Code in the session:

> Use brs-gen to scaffold a `stub_hello` template at `/tmp/stub-smoke` and tell me what it generated.

Expect: a call to `mcp__brs-gen__generate_app` (or `list_templates`
first to confirm `stub_hello` is in the catalog), then a project tree
at `/tmp/stub-smoke/` with `manifest`, `source/main.brs`, and the bare
SceneGraph scaffolding.

## 4. Run roku-dev-loop against the device

Ask:

> Use the roku-dev-loop skill to sideload /tmp/stub-smoke to my Roku at 10.3.21.233.

Expect Claude to:
1. Resolve the `roku-dev-loop` skill from the plugin.
2. Invoke `mcp__rokudev-device__dev_loop` with `kind="project"`, the
   project dir, the device IP, dev password, and `tail_seconds=10`.
3. Then ECP-smoke with `ecp_keypress(key="Home")`, `ecp_launch(app_id="dev")`,
   and `screenshot`.

**Pass criteria:**
- The Roku boots stub_hello (the screen shows the template's hello
  splash / scene).
- Claude's summary names the new tool prefixes
  (`mcp__rokudev-device__*`, `mcp__brs-gen__*`), NOT the legacy ones
  (`mcp__brs-mcp__*`, `mcp__brs-docs-mcp__*`, `mcp__brs-debug__*`).
- Crash-marker scan reports "none".

**Fail criteria (any):**
- Claude tries to call a legacy `mcp__brs-mcp__*` tool. The skill
  rewrite missed one, file a bug.
- The sideload returns a non-200 from `/plugin_install` -> recheck
  dev password.
- `dev_loop` is "tool not found" -> `pnpm -r build` likely skipped.

## 5. Tear down

```bash
# Optional: remove the dev channel from the Roku.
# Ask Claude: "Use mcp__rokudev-device__unload to remove the dev channel."

# Optional: uninstall the plugin.
claude plugin uninstall rokudev-tools
claude plugin marketplace remove rokudev-tools
```

## Notes

- This smoke is intentionally end-to-end. It exercises both the manifest
  /install path AND the skill -> tool resolution path that the
  automated tests cannot reach.
- If the smoke passes once, future iteration on the plugin can lean on
  the automated tests until a skill is added or a tool name changes.
