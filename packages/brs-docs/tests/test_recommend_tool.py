"""Tests for brs_recommend tool wrapper."""

from __future__ import annotations

import sqlite3

from brs_docs.tools.recommend import brs_recommend


def test_recommend_returns_required_fields(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_recommend(fixture_corpus, intent="rotating focus on a RowList")
    assert result["intent"] == "rotating focus on a RowList"
    assert "results" in result
    assert "ranker_version" in result
    assert "tags_toml_version" in result


def test_recommend_default_limit(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_recommend(fixture_corpus, intent="video")
    assert len(result["results"]) <= 5


def test_recommend_custom_kinds(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_recommend(
        fixture_corpus, intent="video", kinds=["node"], limit=10,
    )
    for r in result["results"]:
        assert r["kind"] == "node"


def test_recommend_caps_limit_at_20(fixture_corpus: sqlite3.Connection) -> None:
    # Internal cap should clamp; we just verify it doesn't crash with huge limit
    result = brs_recommend(fixture_corpus, intent="video", limit=100)
    assert len(result["results"]) <= 20
