"""Tests for brs_get tool."""

from __future__ import annotations

import sqlite3

from brs_docs.errors import ErrorCode
from brs_docs.tools.get import BODY_TRUNCATE_THRESHOLD_BYTES, brs_get


def test_get_small_doc_returns_body_inline(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_get(fixture_corpus, doc_id="component:roDateTime")
    assert result["id"] == "component:roDateTime"
    assert result["body_truncated"] is False
    assert result["body"] != ""
    assert result["tags"] == ["datetime", "time", "epoch"]


def test_get_large_sample_truncates_body(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_get(fixture_corpus, doc_id="sample:big.xml")
    assert result["body_truncated"] is True
    assert result["body"] == ""
    assert result["byte_count"] > BODY_TRUNCATE_THRESHOLD_BYTES
    assert "read_hint" in result


def test_get_missing_id_returns_error(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_get(fixture_corpus, doc_id="component:Nonexistent")
    assert result["error"]["code"] == ErrorCode.DOC_NOT_FOUND.value


def test_get_parses_structured_json(fixture_corpus: sqlite3.Connection) -> None:
    # Insert a doc with structured JSON
    conn = fixture_corpus
    conn.execute(
        "INSERT INTO docs (id, kind, title, summary, body, byte_count, "
        "tags, source, structured, fetched_at, content_hash) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("component:test", "component", "Test", "s", "b", 1,
         "", "dev_doc", '{"methods": ["foo"]}', 0, "h"),
    )
    conn.commit()
    result = brs_get(conn, doc_id="component:test")
    assert result["structured"] == {"methods": ["foo"]}
