"""Corpus build orchestrator.

Wires the four Phase 3 scrapers (dev_doc, samples x2, feature_modules,
templates) into a single SQLite + FTS5 corpus file with an atomic install
pattern.

v1 only implements FIXTURE mode (test path); production GitHub fetch is
deferred to T28.
"""

from __future__ import annotations

import json
import logging
import shutil
import sqlite3
from collections import defaultdict
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

    if sources_fixture_dir is None:
        raise NotImplementedError(
            "Production GitHub-fetch mode is not implemented in T16; "
            "pass sources_fixture_dir for the v1 fixture path. T28 wires "
            "the real fetch."
        )

    min_counts_resolved: dict[str, int] = dict(min_counts or {})
    errors: list[str] = []

    dev_doc_tarball = sources_fixture_dir / "dev_doc_tiny.tar.gz"
    samples_tarball = sources_fixture_dir / "samples_tiny.tar.gz"
    sg_master_tarball = sources_fixture_dir / "scenegraph_master_sample_tiny.tar.gz"

    docs: list[CanonicalDoc] = []
    if dev_doc_tarball.exists():
        docs.extend(parse_dev_doc_tarball(dev_doc_tarball))
    else:
        errors.append(f"dev_doc tarball missing: {dev_doc_tarball}")

    if samples_tarball.exists():
        docs.extend(parse_samples_tarball(samples_tarball, source="samples"))
    else:
        errors.append(f"samples tarball missing: {samples_tarball}")

    # scenegraph_master_sample: only included when a dedicated fixture exists.
    # The shared samples_tiny tarball would produce duplicate sample:<path> ids
    # (id is derived from path, not source), so we skip the second pass in v1.
    # T28 wires the real GitHub fetch and will have a distinct tarball.
    if sg_master_tarball.exists():
        docs.extend(parse_samples_tarball(sg_master_tarball, source="scenegraph_master_sample"))

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

    # Companion lock written alongside the output corpus.
    companion_lock = out_path.with_suffix(".sqlite.lock")
    shutil.copyfile(lock_path, companion_lock)

    return BuildResult(
        total_docs=sum(per_kind_counts.values()),
        per_kind_counts=dict(per_kind_counts),
        errors=errors,
        output_path=out_path,
        lock_path=companion_lock,
    )


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
