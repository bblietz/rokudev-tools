"""Transactional refresh of the brs-docs cache corpus."""

from __future__ import annotations

import shutil
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel

from brs_docs.corpus.build import BuildError, build_corpus
from brs_docs.corpus.lock import parse_corpus_lock


class RefreshStatus(StrEnum):
    UP_TO_DATE = "up_to_date"
    REFRESHED = "refreshed"
    FAILED = "failed"


class RefreshResult(BaseModel):
    status: RefreshStatus
    message: str
    installed_version: str | None = None
    new_version: str | None = None
    error: str | None = None


def _locks_match(installed_lock: Path, bundled_lock: Path) -> bool:
    """Compare source SHAs + package versions across two corpus.lock files."""
    if not installed_lock.exists():
        return False
    try:
        installed = parse_corpus_lock(installed_lock)
        bundled = parse_corpus_lock(bundled_lock)
    except Exception:
        return False

    return (
        installed.brs_docs_version == bundled.brs_docs_version
        and installed.sources.dev_doc.sha == bundled.sources.dev_doc.sha
        and installed.sources.samples.sha == bundled.sources.samples.sha
        and installed.sources.scenegraph_master_sample.sha
        == bundled.sources.scenegraph_master_sample.sha
        and installed.sources.rokudev_tools_modules.package_version
        == bundled.sources.rokudev_tools_modules.package_version
        and installed.sources.rokudev_tools_templates.package_version
        == bundled.sources.rokudev_tools_templates.package_version
    )


def refresh_corpus(
    *,
    bundled_lock: Path,
    cache_dir: Path,
    monorepo_root: Path,
    sources_fixture_dir: Path | None = None,
) -> RefreshResult:
    """Transactional refresh of cache_dir/corpus.sqlite + corpus.lock."""
    bundled = parse_corpus_lock(bundled_lock)
    installed_lock_path = cache_dir / "corpus.lock"

    if _locks_match(installed_lock_path, bundled_lock):
        return RefreshResult(
            status=RefreshStatus.UP_TO_DATE,
            message=f"Corpus already at version {bundled.brs_docs_version}",
            installed_version=bundled.brs_docs_version,
            new_version=bundled.brs_docs_version,
        )

    # Build to staging dir, then atomic rename.
    staging = cache_dir.parent / (cache_dir.name + ".new")
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True, exist_ok=True)

    installed_version: str | None = None
    if installed_lock_path.exists():
        try:
            installed_version = parse_corpus_lock(installed_lock_path).brs_docs_version
        except Exception:
            installed_version = None

    try:
        build_corpus(
            lock_path=bundled_lock,
            out_path=staging / "corpus.sqlite",
            monorepo_root=monorepo_root,
            sources_fixture_dir=sources_fixture_dir,
            min_counts={},
        )
        # Copy bundled lock alongside.
        shutil.copyfile(bundled_lock, staging / "corpus.lock")
    except (BuildError, NotImplementedError, OSError, RuntimeError) as exc:
        # Clean up staging and preserve existing cache_dir.
        if staging.exists():
            shutil.rmtree(staging, ignore_errors=True)
        return RefreshResult(
            status=RefreshStatus.FAILED,
            message="Refresh failed; original corpus preserved.",
            installed_version=installed_version,
            error=str(exc),
        )

    # Atomic install: rename staging -> cache_dir.
    # rename onto an existing directory fails on POSIX, so remove first.
    if cache_dir.exists():
        shutil.rmtree(cache_dir)
    staging.rename(cache_dir)

    return RefreshResult(
        status=RefreshStatus.REFRESHED,
        message=f"Refreshed corpus to version {bundled.brs_docs_version}",
        installed_version=installed_version,
        new_version=bundled.brs_docs_version,
    )
