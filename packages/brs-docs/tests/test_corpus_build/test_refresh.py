"""Tests for refresh_corpus."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from brs_docs.corpus import refresh as refresh_module
from brs_docs.corpus.build import BuildError, build_corpus
from brs_docs.corpus.refresh import RefreshResult, RefreshStatus, refresh_corpus

PACKAGE_ROOT = Path(__file__).parent.parent.parent
MONOREPO_ROOT = PACKAGE_ROOT.parent.parent
FIXTURES_DIR = PACKAGE_ROOT / "tests" / "fixtures"
BUNDLED_LOCK = PACKAGE_ROOT / "corpus.lock"


def _seed_cache_with_installed_corpus(cache_dir: Path) -> None:
    """Use build_corpus to seed a complete cache_dir matching the bundled lock."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    build_corpus(
        lock_path=BUNDLED_LOCK,
        out_path=cache_dir / "corpus.sqlite",
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
        min_counts={},
    )
    # Companion .lock is written by build_corpus as <out>.sqlite.lock; for
    # refresh logic, we also expect corpus.lock in the cache_dir directly.
    # Match what first_run.py does: copy the source lock to cache_dir/corpus.lock.
    shutil.copyfile(BUNDLED_LOCK, cache_dir / "corpus.lock")


def test_refresh_up_to_date_noop(tmp_path: Path) -> None:
    cache = tmp_path / "cache"
    _seed_cache_with_installed_corpus(cache)
    sqlite_mtime_before = (cache / "corpus.sqlite").stat().st_mtime_ns

    result = refresh_corpus(
        bundled_lock=BUNDLED_LOCK,
        cache_dir=cache,
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
    )
    assert isinstance(result, RefreshResult)
    assert result.status == RefreshStatus.UP_TO_DATE
    # sqlite not touched
    assert (cache / "corpus.sqlite").stat().st_mtime_ns == sqlite_mtime_before


def test_refresh_when_locks_differ(tmp_path: Path) -> None:
    cache = tmp_path / "cache"
    _seed_cache_with_installed_corpus(cache)
    # Mutate cache lock to a different SHA so refresh detects the diff.
    cache_lock = cache / "corpus.lock"
    text = cache_lock.read_text("utf-8")
    text = text.replace("PLACEHOLDER_UPDATE_BEFORE_RELEASE", "DIFFERENT_SHA_FOR_TEST")
    cache_lock.write_text(text, encoding="utf-8")

    result = refresh_corpus(
        bundled_lock=BUNDLED_LOCK,
        cache_dir=cache,
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
    )
    assert result.status == RefreshStatus.REFRESHED
    # Both files exist after refresh
    assert (cache / "corpus.sqlite").exists()
    assert (cache / "corpus.lock").exists()
    # The .new staging dir is gone
    assert not (cache.parent / (cache.name + ".new")).exists()


def test_refresh_when_no_installed_lock(tmp_path: Path) -> None:
    """If cache has no lock, treat as needing refresh."""
    cache = tmp_path / "cache"
    cache.mkdir()
    # No corpus.lock and no corpus.sqlite

    result = refresh_corpus(
        bundled_lock=BUNDLED_LOCK,
        cache_dir=cache,
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
    )
    assert result.status == RefreshStatus.REFRESHED
    assert (cache / "corpus.sqlite").exists()


def test_refresh_failure_preserves_original(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If the new build raises, original cache is unchanged."""
    cache = tmp_path / "cache"
    _seed_cache_with_installed_corpus(cache)
    sqlite_mtime_before = (cache / "corpus.sqlite").stat().st_mtime_ns
    # Mutate cache lock so refresh tries to rebuild.
    cache_lock = cache / "corpus.lock"
    text = cache_lock.read_text("utf-8")
    text = text.replace("PLACEHOLDER_UPDATE_BEFORE_RELEASE", "DIFFERENT_SHA_FOR_TEST")
    cache_lock.write_text(text, encoding="utf-8")

    # Force build_corpus to fail. build_corpus tolerates missing fixtures /
    # monorepo dirs (skips silently), so we monkey-patch it to raise.
    def _boom(*_args: object, **_kwargs: object) -> None:
        raise BuildError("forced failure for test")

    monkeypatch.setattr(refresh_module, "build_corpus", _boom)

    result = refresh_corpus(
        bundled_lock=BUNDLED_LOCK,
        cache_dir=cache,
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
    )
    assert result.status == RefreshStatus.FAILED
    assert result.error is not None and "forced failure" in result.error
    # Original preserved
    assert (cache / "corpus.sqlite").exists()
    assert (cache / "corpus.sqlite").stat().st_mtime_ns == sqlite_mtime_before
    # No .new sibling left
    assert not (cache.parent / (cache.name + ".new")).exists()
