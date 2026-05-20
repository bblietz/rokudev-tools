"""First-run install of bundled corpus into the user cache dir."""

from __future__ import annotations

import shutil
from importlib.resources import files
from pathlib import Path


class CorpusNotInitialized(RuntimeError):  # noqa: N818 - sentinel name, not an *Error
    """Raised when neither cache nor bundled corpus is available."""


def _bundled_corpus_path() -> Path:
    """Locate corpus.sqlite via importlib.resources.

    Returns a path; the caller checks .exists() before using.
    """
    return Path(str(files("brs_docs").joinpath("data/corpus.sqlite")))


def _bundled_lock_path() -> Path:
    return Path(str(files("brs_docs").joinpath("data/corpus.lock")))


def ensure_cache_corpus(cache_dir: Path) -> Path:
    """Ensure cache_dir contains corpus.sqlite; copy from bundled if missing.

    Returns the path to the cache corpus. Raises CorpusNotInitialized if
    the cache is empty AND the bundled corpus is not present.
    """
    cache_corpus = cache_dir / "corpus.sqlite"
    if cache_corpus.exists():
        return cache_corpus

    bundled = _bundled_corpus_path()
    if not bundled.exists():
        raise CorpusNotInitialized(
            f"No cached corpus at {cache_corpus} and bundled corpus is missing at "
            f"{bundled}. Run `make build-corpus` (development) or reinstall the "
            f"brs-docs package."
        )

    cache_dir.mkdir(parents=True, exist_ok=True, mode=0o755)
    shutil.copyfile(bundled, cache_corpus)

    # Copy bundled lock if present (informational only; cache lock optional).
    bundled_lock = _bundled_lock_path()
    if bundled_lock.exists():
        shutil.copyfile(bundled_lock, cache_dir / "corpus.lock")

    return cache_corpus
