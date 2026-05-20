"""Tests for first_run install of bundled corpus."""

from __future__ import annotations

from pathlib import Path

import pytest

from brs_docs.corpus.first_run import CorpusNotInitialized, ensure_cache_corpus
from brs_docs.db import connect, init_schema


def _make_bundled(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Place a minimal corpus.sqlite where importlib.resources expects it."""
    pkg_data = tmp_path / "pkg_data"
    pkg_data.mkdir()
    fake_corpus = pkg_data / "corpus.sqlite"
    conn = connect(fake_corpus)
    init_schema(conn)
    conn.close()
    # Patch the locator to return our fake bundled path.
    import brs_docs.corpus.first_run as fr
    monkeypatch.setattr(fr, "_bundled_corpus_path", lambda: fake_corpus)
    return fake_corpus


def test_copies_bundled_when_cache_empty(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    _make_bundled(monkeypatch, tmp_path)
    cache = tmp_path / "cache"
    result = ensure_cache_corpus(cache)
    assert result == cache / "corpus.sqlite"
    assert result.exists()


def test_noop_when_cache_exists(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    _make_bundled(monkeypatch, tmp_path)
    cache = tmp_path / "cache"
    # First call: copies
    ensure_cache_corpus(cache)
    # Touch a marker file to detect a second copy
    marker = cache / "corpus.sqlite"
    original_mtime = marker.stat().st_mtime_ns
    # Second call: no-op (must not recopy)
    ensure_cache_corpus(cache)
    assert marker.stat().st_mtime_ns == original_mtime


def test_raises_when_bundled_missing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    import brs_docs.corpus.first_run as fr

    def _missing() -> Path:
        return tmp_path / "does_not_exist.sqlite"
    monkeypatch.setattr(fr, "_bundled_corpus_path", _missing)
    with pytest.raises(CorpusNotInitialized):
        ensure_cache_corpus(tmp_path / "cache")
