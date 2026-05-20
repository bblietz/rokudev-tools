"""Tests for corpus.lock parser + validator."""

from __future__ import annotations

from pathlib import Path

import pytest

from brs_docs.corpus.lock import (
    CorpusLock,
    LockValidationError,
    parse_corpus_lock,
    validate_lock,
)

PACKAGE_LOCK = Path(__file__).parent.parent.parent / "corpus.lock"


def test_parse_real_lock_succeeds() -> None:
    lock = parse_corpus_lock(PACKAGE_LOCK)
    assert isinstance(lock, CorpusLock)
    assert lock.brs_docs_version == "0.7.0"
    assert lock.sources.dev_doc.url == "https://github.com/rokudev/dev-doc"
    assert lock.sources.rokudev_tools_modules.module_count == 1
    assert lock.sources.rokudev_tools_templates.template_count == 6


def test_parse_missing_required_section(tmp_path: Path) -> None:
    bad = tmp_path / "bad.lock"
    bad.write_text('brs_docs_version = "0.7.0"\n', encoding="utf-8")
    # Missing all [sources.*] sections
    with pytest.raises((LockValidationError, ValueError)):
        parse_corpus_lock(bad)


def test_validate_rejects_bad_version() -> None:
    # Construct a CorpusLock object then mutate its version (or build raw and validate)
    bad = parse_corpus_lock(PACKAGE_LOCK).model_copy(update={"brs_docs_version": "not-a-version"})
    with pytest.raises(LockValidationError):
        validate_lock(bad)


def test_validate_accepts_real_lock() -> None:
    validate_lock(parse_corpus_lock(PACKAGE_LOCK))
