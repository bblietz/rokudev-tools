"""Tests for `brs-docs refresh` subcommand."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from brs_docs.cli import main
from brs_docs.corpus.refresh import RefreshResult, RefreshStatus


def test_refresh_up_to_date(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ROKUDEV_CACHE_DIR", str(tmp_path / "cache"))
    fake = RefreshResult(
        status=RefreshStatus.UP_TO_DATE,
        message="Corpus already at version 0.7.0",
        new_version="0.7.0",
    )
    with patch("brs_docs.cli.refresh_corpus", return_value=fake):
        rc = main(["refresh"])
    assert rc == 0
    out = capsys.readouterr().out.lower()
    assert "0.7.0" in out or "up to date" in out or "already" in out


def test_refresh_refreshed(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ROKUDEV_CACHE_DIR", str(tmp_path / "cache"))
    fake = RefreshResult(
        status=RefreshStatus.REFRESHED,
        message="Refreshed corpus to version 0.7.1",
        installed_version="0.7.0",
        new_version="0.7.1",
    )
    with patch("brs_docs.cli.refresh_corpus", return_value=fake):
        rc = main(["refresh"])
    assert rc == 0


def test_refresh_failed(
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("ROKUDEV_CACHE_DIR", str(tmp_path / "cache"))
    fake = RefreshResult(
        status=RefreshStatus.FAILED,
        message="Refresh failed; original corpus preserved.",
        error="something went wrong",
    )
    with patch("brs_docs.cli.refresh_corpus", return_value=fake):
        rc = main(["refresh"])
    assert rc == 2
    err = capsys.readouterr().err
    assert "something went wrong" in err
