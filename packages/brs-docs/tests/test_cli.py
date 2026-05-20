"""Tests for cli.py."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from brs_docs import __version__
from brs_docs.cli import main


def _seed_corpus(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Build a corpus in tmp_path and set ROKUDEV_CACHE_DIR to it."""
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
    return cache


def test_version_subcommand(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    rc = main(["version"])
    assert rc == 0
    out = capsys.readouterr().out
    assert __version__ in out
    # The corpus summary line must reflect the installed lock; "no corpus
    # installed" indicates build_corpus did not place corpus.lock alongside.
    assert "no corpus installed" not in out
    assert "dev_doc=" in out


def test_search_subcommand(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    rc = main(["search", "RowList"])
    assert rc == 0
    out = capsys.readouterr().out
    payload = json.loads(out)
    assert "results" in payload


def test_search_missing_arg_returns_2(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    with pytest.raises(SystemExit) as exc_info:
        main(["search"])
    assert exc_info.value.code == 2


def test_unknown_subcommand_returns_2(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    with pytest.raises(SystemExit) as exc_info:
        main(["unknown_subcmd"])
    assert exc_info.value.code == 2


def test_get_subcommand(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    rc = main(["get", "node:RowList"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["id"] == "node:RowList"


def test_list_subcommand(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    rc = main(["list", "node"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["kind"] == "node"


def test_recommend_subcommand(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _seed_corpus(tmp_path, monkeypatch)
    rc = main(["recommend", "rotating focus on a RowList"])
    assert rc == 0
    payload = json.loads(capsys.readouterr().out)
    assert "results" in payload
