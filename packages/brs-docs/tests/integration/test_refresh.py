"""Integration test: refresh end-to-end with real build_corpus."""

from __future__ import annotations

import shutil
from pathlib import Path
from unittest.mock import patch

import pytest

from brs_docs.corpus.build import BuildError
from brs_docs.corpus.refresh import RefreshStatus, refresh_corpus

pytestmark = pytest.mark.integration

PACKAGE_ROOT = Path(__file__).parent.parent.parent
MONOREPO_ROOT = PACKAGE_ROOT.parent.parent
FIXTURES_DIR = PACKAGE_ROOT / "tests" / "fixtures"
BUNDLED_LOCK = PACKAGE_ROOT / "corpus.lock"


def _seed(cache: Path) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    from brs_docs.corpus.build import build_corpus
    build_corpus(
        lock_path=BUNDLED_LOCK,
        out_path=cache / "corpus.sqlite",
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
        min_counts={},
    )
    shutil.copyfile(BUNDLED_LOCK, cache / "corpus.lock")


def test_refresh_full_cycle(tmp_path: Path) -> None:
    cache = tmp_path / "cache"
    _seed(cache)

    # 1. No-op when locks match
    result = refresh_corpus(
        bundled_lock=BUNDLED_LOCK,
        cache_dir=cache,
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
    )
    assert result.status == RefreshStatus.UP_TO_DATE

    # 2. Mutate cache lock so SHAs differ; expect REFRESHED
    text = (cache / "corpus.lock").read_text("utf-8")
    text = text.replace("PLACEHOLDER_UPDATE_BEFORE_RELEASE", "DIFFERENT_SHA_TO_FORCE_REFRESH")
    (cache / "corpus.lock").write_text(text, encoding="utf-8")
    result = refresh_corpus(
        bundled_lock=BUNDLED_LOCK,
        cache_dir=cache,
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
    )
    assert result.status == RefreshStatus.REFRESHED
    assert (cache / "corpus.sqlite").exists()

    # 3. Mock build_corpus to raise, mutate lock, ensure original preserved.
    # After step 2, the cache lock was overwritten with the bundled lock
    # (which still contains PLACEHOLDER_UPDATE_BEFORE_RELEASE), so mutate
    # the placeholder again to force a SHA mismatch.
    sqlite_mtime = (cache / "corpus.sqlite").stat().st_mtime_ns
    text = (cache / "corpus.lock").read_text("utf-8")
    text = text.replace("PLACEHOLDER_UPDATE_BEFORE_RELEASE", "YET_ANOTHER_SHA")
    (cache / "corpus.lock").write_text(text, encoding="utf-8")
    with patch("brs_docs.corpus.refresh.build_corpus", side_effect=BuildError("simulated")):
        result = refresh_corpus(
            bundled_lock=BUNDLED_LOCK,
            cache_dir=cache,
            monorepo_root=MONOREPO_ROOT,
            sources_fixture_dir=FIXTURES_DIR,
        )
    assert result.status == RefreshStatus.FAILED
    assert (cache / "corpus.sqlite").exists()
    assert (cache / "corpus.sqlite").stat().st_mtime_ns == sqlite_mtime
