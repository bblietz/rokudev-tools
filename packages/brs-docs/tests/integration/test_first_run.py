"""Integration test: first-run install copies bundled corpus to cache."""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration


def test_first_run_copies_bundled(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    """When cache_dir is empty, ensure_cache_corpus copies bundled corpus.

    Requires `make build-corpus` to have run (or T28 to have shipped) so
    src/brs_docs/data/corpus.sqlite exists. If not, skip.
    """
    from brs_docs import corpus as _corpus
    pkg_dir = Path(_corpus.__file__).parent.parent
    bundled = pkg_dir / "data" / "corpus.sqlite"
    if not bundled.exists():
        pytest.skip("bundled corpus.sqlite not built; run `make build-corpus`")

    cache = tmp_path / "cache"
    monkeypatch.setenv("ROKUDEV_CACHE_DIR", str(cache))

    # Reload server module so CACHE_DIR captures the new env var (if any
    # module-level state caches it).
    from brs_docs import server
    importlib.reload(server)
    conn = server._open_conn()
    try:
        # corpus.sqlite should now be in cache
        assert (cache / "corpus.sqlite").exists()
    finally:
        conn.close()
