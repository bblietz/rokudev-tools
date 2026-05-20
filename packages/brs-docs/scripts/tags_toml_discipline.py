#!/usr/bin/env python3
"""CI lint: tags.toml rule changes require tags.toml `version` bump."""

from __future__ import annotations

import subprocess
import sys
import tomllib


TAGS_TOML_PATH = "packages/brs-docs/src/brs_docs/recommend/tags.toml"


def _changed_files(base: str = "origin/main") -> list[str]:
    try:
        out = subprocess.check_output(
            ["git", "diff", "--name-only", f"{base}...HEAD"],
            text=True,
        )
    except subprocess.CalledProcessError:
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]


def _show_at_ref(ref: str, path: str) -> str | None:
    try:
        return subprocess.check_output(
            ["git", "show", f"{ref}:{path}"], text=True,
        )
    except subprocess.CalledProcessError:
        return None


def main() -> int:
    changed = set(_changed_files())
    if TAGS_TOML_PATH not in changed:
        return 0

    old_text = _show_at_ref("origin/main", TAGS_TOML_PATH)
    if old_text is None:
        # tags.toml is new in this branch; nothing to compare.
        return 0
    try:
        new_text = open(TAGS_TOML_PATH, encoding="utf-8").read()
    except OSError as exc:
        print(f"error: cannot read {TAGS_TOML_PATH}: {exc}", file=sys.stderr)
        return 1

    old_data = tomllib.loads(old_text)
    new_data = tomllib.loads(new_text)
    old_version = old_data.get("version")
    new_version = new_data.get("version")

    # Compare rules sections (everything except version).
    old_rules = {k: v for k, v in old_data.items() if k != "version"}
    new_rules = {k: v for k, v in new_data.items() if k != "version"}

    if old_rules != new_rules and old_version == new_version:
        print(
            f"error: {TAGS_TOML_PATH} rules changed but `version` field "
            f"({old_version}) was not bumped. Bump version when changing "
            "keyword_to_tags / module_categories / bm25_weights.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
