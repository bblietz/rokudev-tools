"""Corpus build orchestrator.

Wires the four Phase 3 scrapers (dev_doc, samples x2, feature_modules,
templates) into a single SQLite + FTS5 corpus file with an atomic install
pattern.

Two modes:

- FIXTURE mode: pass ``sources_fixture_dir`` pointing at the test fixtures.
- PRODUCTION mode: pass ``sources_fixture_dir=None``; tarballs are fetched
  from GitHub at the SHAs pinned in ``corpus.lock``.
"""

from __future__ import annotations

import json
import logging
import shutil
import sqlite3
import tempfile
import urllib.request
from collections import defaultdict
from contextlib import ExitStack
from pathlib import Path

from pydantic import BaseModel

from brs_docs.corpus.lock import parse_corpus_lock, validate_lock
from brs_docs.corpus.sources.dev_doc import parse_dev_doc_tarball
from brs_docs.corpus.sources.feature_modules import parse_feature_modules
from brs_docs.corpus.sources.samples import parse_samples_tarball
from brs_docs.corpus.sources.templates import parse_templates
from brs_docs.db import connect, init_schema
from brs_docs.models import CanonicalDoc

logger = logging.getLogger(__name__)

_MAX_BODY_BYTES = 2 * 1024 * 1024
_CANARY_QUERIES = ("RowList", "ifString")
_INSERT_SQL = (
    "INSERT INTO docs ("
    "id, kind, title, summary, body, body_truncated, byte_count, "
    "tags, url, source, structured, fetched_at, content_hash"
    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)


class BuildResult(BaseModel):
    total_docs: int
    per_kind_counts: dict[str, int]
    errors: list[str]
    output_path: Path
    lock_path: Path


class BuildError(RuntimeError):
    """Raised when build fails validation; original corpus preserved."""


def build_corpus(
    lock_path: Path,
    out_path: Path,
    monorepo_root: Path,
    *,
    sources_fixture_dir: Path | None = None,
    min_counts: dict[str, int] | None = None,
) -> BuildResult:
    """Build a brs-docs corpus from the four Phase 3 scrapers.

    Atomic install: writes to ``<out>.sqlite.new``, validates, then renames
    over ``out_path``. On any failure, removes the staging file and leaves
    any existing ``out_path`` untouched.
    """
    lock = parse_corpus_lock(lock_path)
    validate_lock(lock)

    min_counts_resolved: dict[str, int] = dict(min_counts or {})
    errors: list[str] = []

    with ExitStack() as stack:
        if sources_fixture_dir is None:
            # Production mode: download tarballs at pinned SHAs into a temp dir.
            tmp = Path(stack.enter_context(tempfile.TemporaryDirectory()))
            dev_doc_tarball = _download_github_tarball(
                "rokudev/dev-doc", lock.sources.dev_doc.sha, tmp / "dev_doc.tar.gz",
            )
            samples_tarball = _download_github_tarball(
                "rokudev/samples", lock.sources.samples.sha, tmp / "samples.tar.gz",
            )
            sg_master_tarball: Path | None = _download_github_tarball(
                "rokudev/scenegraph-master-sample",
                lock.sources.scenegraph_master_sample.sha,
                tmp / "scenegraph.tar.gz",
            )
        else:
            dev_doc_tarball = sources_fixture_dir / "dev_doc_tiny.tar.gz"
            samples_tarball = sources_fixture_dir / "samples_tiny.tar.gz"
            sg_master_candidate = sources_fixture_dir / "scenegraph_master_sample_tiny.tar.gz"
            # scenegraph_master_sample: only included when a dedicated fixture
            # exists. The shared samples_tiny tarball would produce duplicate
            # sample:<path> ids (id is derived from path, not source).
            sg_master_tarball = sg_master_candidate if sg_master_candidate.exists() else None

        docs: list[CanonicalDoc] = []
        if dev_doc_tarball.exists():
            docs.extend(parse_dev_doc_tarball(dev_doc_tarball))
        else:
            errors.append(f"dev_doc tarball missing: {dev_doc_tarball}")

        if samples_tarball.exists():
            docs.extend(parse_samples_tarball(samples_tarball, source="samples"))
        else:
            errors.append(f"samples tarball missing: {samples_tarball}")

        if sg_master_tarball is not None and sg_master_tarball.exists():
            docs.extend(
                parse_samples_tarball(sg_master_tarball, source="scenegraph_master_sample")
            )

        docs.extend(parse_feature_modules(monorepo_root / "packages/brs-gen/modules"))
        docs.extend(parse_templates(monorepo_root / "packages/brs-gen/templates"))

    staging = out_path.with_suffix(".sqlite.new")
    if staging.exists():
        staging.unlink()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    per_kind_counts: dict[str, int] = defaultdict(int)
    try:
        conn = connect(staging)
        try:
            init_schema(conn)
            conn.execute("BEGIN TRANSACTION")
            for doc in docs:
                try:
                    conn.execute(_INSERT_SQL, _doc_row(doc))
                except sqlite3.IntegrityError as exc:
                    raise BuildError(f"duplicate id {doc.id!r}: {exc}") from exc
                per_kind_counts[doc.kind.value] += 1
            conn.commit()

            _validate_corpus(conn, per_kind_counts, min_counts_resolved)
        finally:
            conn.close()

        # Atomic install.
        staging.replace(out_path)
    except BaseException:
        if staging.exists():
            staging.unlink()
        raise

    # Companion lock written alongside the output corpus as `corpus.lock`
    # (the exact filename `first_run.py` and `cli.py` look for).
    companion_lock = out_path.parent / "corpus.lock"
    shutil.copyfile(lock_path, companion_lock)

    return BuildResult(
        total_docs=sum(per_kind_counts.values()),
        per_kind_counts=dict(per_kind_counts),
        errors=errors,
        output_path=out_path,
        lock_path=companion_lock,
    )


def _download_github_tarball(repo: str, sha: str, out_path: Path) -> Path:
    """Download https://github.com/{repo}/archive/{sha}.tar.gz to out_path.

    v1 limitation: no retries, no progress bar, no auth (public repos only).
    """
    url = f"https://github.com/{repo}/archive/{sha}.tar.gz"
    req = urllib.request.Request(url, headers={"User-Agent": "brs-docs-corpus-builder"})
    with urllib.request.urlopen(req) as resp, open(out_path, "wb") as f:
        shutil.copyfileobj(resp, f)
    return out_path


def _doc_row(doc: CanonicalDoc) -> tuple[object, ...]:
    structured_json = json.dumps(doc.structured) if doc.structured is not None else None
    return (
        doc.id,
        doc.kind.value,
        doc.title,
        doc.summary,
        doc.body,
        1 if doc.body_truncated else 0,
        doc.byte_count,
        doc.tags,
        doc.url,
        doc.source,
        structured_json,
        doc.fetched_at,
        doc.content_hash,
    )


def _validate_corpus(
    conn: sqlite3.Connection,
    per_kind_counts: dict[str, int],
    min_counts: dict[str, int],
) -> None:
    for kind, minimum in min_counts.items():
        actual = per_kind_counts.get(kind, 0)
        if actual < minimum:
            raise BuildError(
                f"min_counts violation: kind={kind!r} requires >= {minimum}, got {actual}"
            )

    row = conn.execute(
        "SELECT COUNT(*) FROM docs WHERE byte_count > ?", (_MAX_BODY_BYTES,)
    ).fetchone()
    oversized = row[0] if row else 0
    if oversized:
        raise BuildError(f"{oversized} docs exceed 2MB body limit")

    total = sum(per_kind_counts.values())
    if total == 0:
        return
    for query in _CANARY_QUERIES:
        hit = conn.execute(
            "SELECT COUNT(*) FROM docs_fts WHERE docs_fts MATCH ?", (query,)
        ).fetchone()
        if hit and hit[0] == 0:
            logger.warning("FTS canary query %r returned 0 hits", query)


def _main(argv: list[str] | None = None) -> int:
    """CLI entrypoint for ``python -m brs_docs.corpus.build``."""
    import argparse
    import sys

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
        help=(
            "Fixture directory containing dev_doc_tiny.tar.gz and samples_tiny.tar.gz. "
            "Omit for production GitHub-fetch mode."
        ),
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
    except BuildError as exc:
        print(f"build failed: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result.model_dump(mode="json"), indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
