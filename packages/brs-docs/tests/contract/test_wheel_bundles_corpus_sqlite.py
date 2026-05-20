"""Contract test: the built wheel must bundle data/corpus.sqlite.

Without this, a `pip install brs-docs` from PyPI would land a wheel that
first_run.py cannot satisfy (CorpusNotInitialized on first invocation of
any tool that opens the corpus). The dev/source/editable install path
works because importlib.resources resolves against the live src tree;
the wheel is the codepath that has historically dropped the file.

Marked integration because it shells out to `uv build`.
"""

from __future__ import annotations

import subprocess
import zipfile
from pathlib import Path

import pytest

PACKAGE_ROOT = Path(__file__).parent.parent.parent


@pytest.mark.integration
def test_wheel_bundles_corpus_sqlite(tmp_path: Path) -> None:
    sqlite_src = PACKAGE_ROOT / "src" / "brs_docs" / "data" / "corpus.sqlite"
    if not sqlite_src.exists():
        pytest.skip(
            f"prereq missing: {sqlite_src} not built. Run `make build-corpus` "
            f"from the monorepo root before running this test."
        )

    subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(tmp_path)],
        cwd=str(PACKAGE_ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    wheels = list(tmp_path.glob("*.whl"))
    assert len(wheels) == 1, (
        f"expected 1 wheel, got {[w.name for w in wheels]}"
    )
    wheel = wheels[0]

    with zipfile.ZipFile(wheel) as zf:
        names = set(zf.namelist())

    assert "brs_docs/data/corpus.sqlite" in names, (
        "wheel does not contain brs_docs/data/corpus.sqlite; "
        "first-run install will fail with CorpusNotInitialized. "
        f"Top-level entries: {sorted(n for n in names if '/' not in n.rstrip('/'))[:10]}"
    )
    # Sanity: with the ~11 MB sqlite bundled (compresses well; ~3 MB in
    # the .whl), the wheel must be >1 MB. A wheel under 100 KB signals
    # the sqlite is missing.
    size_mb = wheel.stat().st_size / (1024 * 1024)
    assert size_mb > 1.0, (
        f"wheel is {size_mb:.2f} MB; expected >1 MB with bundled corpus.sqlite"
    )
