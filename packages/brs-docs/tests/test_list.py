"""Tests for brs_list tool."""

from __future__ import annotations

import sqlite3

from brs_docs.errors import ErrorCode
from brs_docs.tools.list import brs_list


def test_list_all_of_kind(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_list(fixture_corpus, kind="component")
    titles = [r["title"] for r in result["results"]]
    assert "roDateTime" in titles
    assert "roUrlTransfer" in titles


def test_list_with_prefix(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_list(fixture_corpus, kind="component", prefix="roDate")
    assert all(r["title"].lower().startswith("rodate") for r in result["results"])


def test_list_rejects_invalid_kind(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_list(fixture_corpus, kind="not_a_kind")
    assert result["error"]["code"] == ErrorCode.INVALID_KIND.value


def test_list_escapes_like_metachars(fixture_corpus: sqlite3.Connection) -> None:
    # An underscore in prefix should match literally, not as LIKE wildcard
    result = brs_list(fixture_corpus, kind="component", prefix="ro_")
    # No component starts with literal "ro_"
    assert result["results"] == []


def test_list_caps_at_500(fixture_corpus: sqlite3.Connection) -> None:
    # Seed > 500 docs of one kind
    conn = fixture_corpus
    for i in range(600):
        conn.execute(
            "INSERT INTO docs (id, kind, title, summary, body, byte_count, "
            "tags, source, fetched_at, content_hash) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (f"guide:bulk-{i}", "guide", f"BulkGuide{i}", "", "", 0, "",
             "dev_doc", 0, "h"),
        )
    conn.commit()
    result = brs_list(conn, kind="guide")
    assert len(result["results"]) == 500
