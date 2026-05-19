"""Tests for db.py: connect + schema init."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from brs_docs.db import connect, init_schema


def test_init_schema_creates_docs_table(tmp_path: Path) -> None:
    db_path = tmp_path / "test.sqlite"
    conn = connect(db_path)
    init_schema(conn)

    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='docs'"
    )
    assert cursor.fetchone() is not None


def test_init_schema_creates_fts_table(tmp_path: Path) -> None:
    db_path = tmp_path / "test.sqlite"
    conn = connect(db_path)
    init_schema(conn)

    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='docs_fts'"
    )
    assert cursor.fetchone() is not None


def test_init_schema_is_idempotent(tmp_path: Path) -> None:
    db_path = tmp_path / "test.sqlite"
    conn = connect(db_path)
    init_schema(conn)
    init_schema(conn)  # second call must not raise


def test_docs_columns_match_spec(tmp_path: Path) -> None:
    db_path = tmp_path / "test.sqlite"
    conn = connect(db_path)
    init_schema(conn)

    cols = [row[1] for row in conn.execute("PRAGMA table_info(docs)")]
    expected = {
        "id", "kind", "title", "summary", "body", "body_truncated",
        "byte_count", "tags", "url", "source", "structured",
        "fetched_at", "content_hash",
    }
    assert set(cols) == expected


def test_fts_trigger_keeps_docs_fts_in_sync(tmp_path: Path) -> None:
    db_path = tmp_path / "test.sqlite"
    conn = connect(db_path)
    init_schema(conn)

    conn.execute(
        "INSERT INTO docs (id, kind, title, summary, body, byte_count, "
        "source, fetched_at, content_hash) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("node:RowList", "node", "RowList", "A row list",
         "Full body", 9, "dev_doc", 1000, "abc"),
    )
    conn.commit()

    fts_rows = conn.execute(
        "SELECT title FROM docs_fts WHERE docs_fts MATCH ?", ("RowList",)
    ).fetchall()
    assert len(fts_rows) == 1
