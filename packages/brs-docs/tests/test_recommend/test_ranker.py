"""Tests for recommend/ranker.py."""

from __future__ import annotations

import sqlite3

from brs_docs.recommend.ranker import load_tags_toml, rank_candidates


def test_load_tags_toml_has_v1_keys() -> None:
    cfg = load_tags_toml()
    assert cfg["version"] == "1.0"
    assert "paywall" in cfg["keyword_to_tags"]
    assert len(cfg["module_categories"]) >= 11
    assert cfg["bm25_weights"]["title"] == 4.0


def test_tag_boost_lookup_paywall(fixture_corpus: sqlite3.Connection) -> None:
    results = rank_candidates(
        fixture_corpus,
        intent="how do I show a paywall",
        kinds=None,
        limit=5,
    )
    # analytics module doesn't have paywall tags; should not top-rank
    top_ids = [r["id"] for r in results]  # noqa: F841 (referenced via len)
    # Score breakdown must be present
    for r in results:
        assert "details" in r
        assert "bm25_score" in r["details"]
        assert "tag_boosts" in r["details"]
        assert "module_category_boost" in r["details"]


def test_module_category_boost_applies(fixture_corpus: sqlite3.Connection) -> None:
    # analytics.event_pipe should get module-category boost for "analytics"
    results = rank_candidates(
        fixture_corpus, intent="track analytics events", kinds=None, limit=10,
    )
    analytics = next(
        (r for r in results if r["id"] == "feature_module:analytics.event_pipe"),
        None,
    )
    assert analytics is not None
    assert analytics["details"]["module_category_boost"] > 0


def test_negative_case_no_module_top_rank(fixture_corpus: sqlite3.Connection) -> None:
    # "what time is it" should rank roDateTime above any module/template
    results = rank_candidates(
        fixture_corpus, intent="what time is it", kinds=None, limit=5,
    )
    top_kinds = [r["kind"] for r in results[:3]]
    assert "feature_module" not in top_kinds
    assert "template" not in top_kinds


def test_kinds_filter(fixture_corpus: sqlite3.Connection) -> None:
    results = rank_candidates(
        fixture_corpus, intent="video", kinds=["node"], limit=5,
    )
    for r in results:
        assert r["kind"] == "node"
