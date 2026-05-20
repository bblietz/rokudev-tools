#!/usr/bin/env bash
# Skill-load smoke test.
#
# Verifies that every SKILL.md in plugin/skills/ has a valid YAML
# frontmatter block, a `name:` matching its directory, and a non-empty
# `description:` (Claude Code uses both to surface the skill).
#
# Does NOT spin up a Claude Code session to enumerate skills (that path
# adds 30-60s per invocation and depends on live LLM round-trips). The
# install + restart half of that loop is covered by MANUAL-SMOKE.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$PLUGIN_ROOT/skills"

EXPECTED=( roku-dev-loop roku-smoke-test roku-triage roku-ecp-recipes roku-manifest-validator roku-bsc-lint )

for s in "${EXPECTED[@]}"; do
  SKILL_FILE="$SKILLS_DIR/$s/SKILL.md"

  if [ ! -f "$SKILL_FILE" ]; then
    echo "FAIL: $SKILL_FILE missing" >&2
    exit 1
  fi

  # Frontmatter must start the file.
  HEAD_LINE="$(head -n 1 "$SKILL_FILE")"
  if [ "$HEAD_LINE" != "---" ]; then
    echo "FAIL: $s: SKILL.md does not begin with '---' (got: $HEAD_LINE)" >&2
    exit 1
  fi

  # name: must match directory name (exact match on a single line).
  NAME_LINE="$(grep -E '^name:[[:space:]]*' "$SKILL_FILE" | head -n 1 || true)"
  if [ -z "$NAME_LINE" ]; then
    echo "FAIL: $s: SKILL.md missing 'name:' field" >&2
    exit 1
  fi
  NAME_VAL="$(echo "$NAME_LINE" | sed -E 's/^name:[[:space:]]*//' | tr -d ' ')"
  if [ "$NAME_VAL" != "$s" ]; then
    echo "FAIL: $s: name field '$NAME_VAL' does not match dir name '$s'" >&2
    exit 1
  fi

  # description: must be present (folded multiline `|` is fine).
  if ! grep -qE '^description:' "$SKILL_FILE"; then
    echo "FAIL: $s: SKILL.md missing 'description:' field" >&2
    exit 1
  fi

  echo "ok: $s"
done

echo ""
echo "All skill-load checks passed (6 skills)."
