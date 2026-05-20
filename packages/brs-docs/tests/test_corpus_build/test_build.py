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


@pytest.mark.integration
def test_build_corpus_fetches_real_tarballs(tmp_path: Path) -> None:
    """Network-required test: builds from real GitHub tarballs at pinned SHAs."""
    out = tmp_path / "real_corpus.sqlite"
    result = build_corpus(
        lock_path=PACKAGE_ROOT / "corpus.lock",
        out_path=out,
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=None,
        min_counts={},
    )
    assert result.total_docs >= 100, f"expected >= 100 docs, got {result.total_docs}"
    # Monorepo contributions are always present (brs-gen has 1 module + 6 templates).
    assert result.per_kind_counts.get("feature_module", 0) >= 1
    assert result.per_kind_counts.get("template", 0) >= 6
    assert out.exists()


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
