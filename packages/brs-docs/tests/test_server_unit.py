"""Unit tests for server.py: dispatch + tool registration."""

from __future__ import annotations

from pathlib import Path

import pytest

from brs_docs.server import _TOOL_SCHEMAS, _dispatch


def _seed_corpus(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from brs_docs.corpus.build import build_corpus
    cache = tmp_path / "cache"
    cache.mkdir()
    pkg_root = Path(__file__).parent.parent
    build_corpus(
        lock_path=pkg_root / "corpus.lock",
        out_path=cache / "corpus.sqlite",
        monorepo_root=pkg_root.parent.parent,
        sources_fixture_dir=pkg_root / "tests" / "fixtures",
        min_counts={},
    )
    monkeypatch.setenv("ROKUDEV_CACHE_DIR", str(cache))


def test_all_five_tools_have_schemas() -> None:
    assert set(_TOOL_SCHEMAS.keys()) == {
        "brs_search", "brs_get", "brs_list", "brs_sample_read", "brs_recommend",
    }


def test_dispatch_search(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    result = _dispatch("brs_search", {"query": "RowList", "limit": 5})
    assert "results" in result


def test_dispatch_get(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    result = _dispatch("brs_get", {"doc_id": "node:RowList"})
    assert result["id"] == "node:RowList"


def test_dispatch_list(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    result = _dispatch("brs_list", {"kind": "node"})
    assert result["kind"] == "node"


def test_dispatch_sample_read(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    # The fixture corpus contains samples; find one by listing.
    result = _dispatch("brs_list", {"kind": "sample"})
    if result["results"]:
        first_sample_id = result["results"][0]["id"]
        read_result = _dispatch("brs_sample_read", {"doc_id": first_sample_id})
        assert "body" in read_result


def test_dispatch_recommend(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    result = _dispatch("brs_recommend", {"intent": "video"})
    assert "results" in result


def test_dispatch_unknown_tool(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    result = _dispatch("nonexistent_tool", {})
    assert result["error"]["code"] == "UNKNOWN_TOOL"
