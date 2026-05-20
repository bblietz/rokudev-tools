"""Thin CLI wrapper around brs_docs.corpus.build.build_corpus.

Usage:
    uv run python scripts/build_corpus.py \
        --lock corpus.lock \
        --out src/brs_docs/data/corpus.sqlite \
        --monorepo-root ../../ \
        [--sources-fixture-dir tests/fixtures]

v1 only supports fixture mode. Pass --sources-fixture-dir. Production
GitHub-fetch mode is deferred to T28; running without --sources-fixture-dir
will raise NotImplementedError.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from brs_docs.corpus.build import BuildError, build_corpus


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build a brs-docs corpus.sqlite")
    parser.add_argument("--lock", type=Path, required=True, help="Path to corpus.lock")
    parser.add_argument("--out", type=Path, required=True, help="Output corpus.sqlite path")
    parser.add_argument(
        "--monorepo-root",
        type=Path,
        required=True,
        help="rokudev-tools monorepo root (for brs-gen modules/templates).",
    )
    parser.add_argument(
        "--sources-fixture-dir",
        type=Path,
        default=None,
        help="Fixture directory containing dev_doc_tiny.tar.gz and samples_tiny.tar.gz.",
    )
    parser.add_argument(
        "--min-count",
        action="append",
        default=[],
        metavar="KIND=N",
        help="Minimum count per kind (e.g. --min-count component=5). Repeatable.",
    )
    args = parser.parse_args(argv)

    min_counts: dict[str, int] = {}
    for entry in args.min_count:
        if "=" not in entry:
            parser.error(f"--min-count expects KIND=N, got {entry!r}")
        key, _, value = entry.partition("=")
        try:
            min_counts[key.strip()] = int(value)
        except ValueError:
            parser.error(f"--min-count value must be int, got {value!r}")

    try:
        result = build_corpus(
            lock_path=args.lock,
            out_path=args.out,
            monorepo_root=args.monorepo_root,
            sources_fixture_dir=args.sources_fixture_dir,
            min_counts=min_counts,
        )
    except (BuildError, NotImplementedError) as exc:
        print(f"build failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result.model_dump(mode="json"), indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
