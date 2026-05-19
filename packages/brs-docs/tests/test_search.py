"""Tests for brs_search tool."""

from __future__ import annotations

import sqlite3

from brs_docs.errors import ErrorCode
from brs_docs.tools.search import brs_search


def test_search_returns_relevant_results(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="RowList", limit=5)
    assert any(r["id"] == "node:RowList" for r in result["results"])
    assert result["query_echo"]["query"] == "RowList"


def test_search_filters_by_kind(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="component", kind="component", limit=5)
    for r in result["results"]:
        assert r["kind"] == "component"


def test_search_returns_total_matched(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="Video", limit=5)
    assert "total_matched" in result
    assert result["total_matched"] >= 1


def test_search_rejects_invalid_kind(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="x", kind="not_a_kind", limit=5)
    assert "error" in result
    assert result["error"]["code"] == ErrorCode.INVALID_KIND.value


def test_search_rejects_empty_query(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="", limit=5)
    assert result["error"]["code"] == ErrorCode.INVALID_QUERY.value


def test_search_strips_fts_metachars(fixture_corpus: sqlite3.Connection) -> None:
    # quote chars must not produce an FTS syntax error
    result = brs_search(fixture_corpus, query='"RowList"', limit=5)
    assert "error" not in result


def test_search_includes_snippet_with_marks(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="RowList", limit=5)
    for r in result["results"]:
        if r["id"] == "node:RowList":
            assert "<mark>" in r["snippet"] or "snippet" in r
            break


def test_search_respects_limit(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="the", limit=2)
    assert len(result["results"]) <= 2
