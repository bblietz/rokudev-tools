#!/usr/bin/env python3
"""CI lint: corpus.lock SHA bumps require brs_docs.__version__ bump."""

from __future__ import annotations

import subprocess
import sys


def _changed_files(base: str = "origin/main") -> list[str]:
    """Files changed in HEAD vs base."""
    try:
        out = subprocess.check_output(
            ["git", "diff", "--name-only", f"{base}...HEAD"],
            text=True,
        )
    except subprocess.CalledProcessError:
        # If origin/main missing (e.g. shallow), nothing to enforce.
        return []
    return [line.strip() for line in out.splitlines() if line.strip()]


def main() -> int:
    changed = set(_changed_files())
    lock_changed = "packages/brs-docs/corpus.lock" in changed
    init_changed = "packages/brs-docs/src/brs_docs/__init__.py" in changed
    if lock_changed and not init_changed:
        print(
            "error: packages/brs-docs/corpus.lock was modified but "
            "packages/brs-docs/src/brs_docs/__init__.py (__version__) was not. "
            "Bump __version__ in src/brs_docs/__init__.py whenever corpus.lock "
            "SHAs change.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
