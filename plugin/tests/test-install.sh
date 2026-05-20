#!/usr/bin/env bash
# Plugin install smoke test.
#
# Runs `claude plugin validate` against the plugin manifest + marketplace
# manifest. Does NOT actually install the plugin (install requires a fresh
# Claude Code session restart and persistent state changes; that path is
# covered by MANUAL-SMOKE.md).
#
# Exits 0 on success, non-zero on any failure.

set -euo pipefail

# Resolve plugin root regardless of invocation cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Plugin root: $PLUGIN_ROOT"
echo ""

# 1. Validate the plugin + marketplace manifests via claude CLI.
echo "[1/4] claude plugin validate ..."
if ! command -v claude >/dev/null 2>&1; then
  echo "  FAIL: 'claude' CLI not on PATH" >&2
  exit 1
fi
claude plugin validate "$PLUGIN_ROOT"

# 2. Confirm all 3 MCP server entries exist in .mcp.json.
echo ""
echo "[2/4] .mcp.json server keys ..."
MCP_JSON="$PLUGIN_ROOT/.mcp.json"
for svr in rokudev-device brs-gen brs-docs; do
  if ! grep -q "\"$svr\"" "$MCP_JSON"; then
    echo "  FAIL: $svr not in .mcp.json" >&2
    exit 1
  fi
  echo "  ok: $svr"
done

# 3. Confirm all 6 skills resolve on disk.
echo ""
echo "[3/4] skill SKILL.md files ..."
for s in roku-dev-loop roku-smoke-test roku-triage roku-ecp-recipes roku-manifest-validator roku-bsc-lint; do
  if [ ! -f "$PLUGIN_ROOT/skills/$s/SKILL.md" ]; then
    echo "  FAIL: skills/$s/SKILL.md missing" >&2
    exit 1
  fi
  echo "  ok: $s"
done

# 4. Confirm 0 legacy MCP-prefix refs remain in any migrated skill.
echo ""
echo "[4/4] legacy MCP-ref sweep ..."
LEGACY_HITS="$(grep -REo 'mcp__(brs-mcp|brs-docs-mcp|brs-debug)__[a-z_]+' "$PLUGIN_ROOT/skills/" || true)"
if [ -n "$LEGACY_HITS" ]; then
  echo "  FAIL: legacy MCP refs found in plugin/skills/:" >&2
  echo "$LEGACY_HITS" >&2
  exit 1
fi
echo "  ok: 0 legacy refs"

echo ""
echo "All install-test checks passed."
