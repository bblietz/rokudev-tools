"""Tests for corpus build orchestrator."""

from __future__ import annotations

from pathlib import Path

import pytest

from brs_docs.corpus.build import BuildError, BuildResult, build_corpus

PACKAGE_ROOT = Path(__file__).parent.parent.parent
MONOREPO_ROOT = PACKAGE_ROOT.parent.parent
FIXTURES_DIR = PACKAGE_ROOT / "tests" / "fixtures"


def test_build_corpus_from_fixtures(tmp_path: Path) -> None:
    out = tmp_path / "corpus.sqlite"
    result = build_corpus(
        lock_path=PACKAGE_ROOT / "corpus.lock",
        out_path=out,
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
        min_counts={},
    )
    assert isinstance(result, BuildResult)
    assert result.total_docs > 0
    assert result.output_path == out
    assert out.exists()
    # Companion lock written alongside out_path.
    assert (out.with_suffix(".sqlite.lock")).exists() or (out.parent / "corpus.lock").exists()
    # The .new sibling must be cleaned up (renamed to out).
    assert not out.with_suffix(".sqlite.new").exists()


def test_build_includes_all_kinds(tmp_path: Path) -> None:
    out = tmp_path / "corpus.sqlite"
    result = build_corpus(
        lock_path=PACKAGE_ROOT / "corpus.lock",
        out_path=out,
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
        min_counts={},
    )
    expected_kinds = {
        "component",
        "node",
        "global_function",
        "sample",
        "feature_module",
        "template",
    }
    for kind in expected_kinds:
        assert kind in result.per_kind_counts, f"missing kind: {kind}"
        assert result.per_kind_counts[kind] > 0


def test_build_fails_when_min_counts_unmet(tmp_path: Path) -> None:
    out = tmp_path / "corpus.sqlite"
    with pytest.raises(BuildError):
        build_corpus(
            lock_path=PACKAGE_ROOT / "corpus.lock",
            out_path=out,
            monorepo_root=MONOREPO_ROOT,
            sources_fixture_dir=FIXTURES_DIR,
            min_counts={"component": 9999},
        )
    assert not out.exists()
    assert not out.with_suffix(".sqlite.new").exists()


def test_build_raises_not_implemented_without_fixture_dir(tmp_path: Path) -> None:
    """T16 only supports fixture mode; production mode is T28."""
    out = tmp_path / "corpus.sqlite"
    with pytest.raises(NotImplementedError):
        build_corpus(
            lock_path=PACKAGE_ROOT / "corpus.lock",
            out_path=out,
            monorepo_root=MONOREPO_ROOT,
            sources_fixture_dir=None,
        )


def test_build_atomic_install(tmp_path: Path) -> None:
    """If validation fails, the existing output file (if any) must be preserved."""
    out = tmp_path / "corpus.sqlite"
    build_corpus(
        lock_path=PACKAGE_ROOT / "corpus.lock",
        out_path=out,
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
        min_counts={},
    )
    original_mtime = out.stat().st_mtime_ns
    with pytest.raises(BuildError):
        build_corpus(
            lock_path=PACKAGE_ROOT / "corpus.lock",
            out_path=out,
            monorepo_root=MONOREPO_ROOT,
            sources_fixture_dir=FIXTURES_DIR,
            min_counts={"component": 9999},
        )
    assert out.exists()
    assert out.stat().st_mtime_ns == original_mtime
    assert not out.with_suffix(".sqlite.new").exists()
