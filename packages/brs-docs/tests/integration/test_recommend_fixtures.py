"""Integration test: recommend ranker fixture-pinned regression suite."""

from __future__ import annotations

import shutil
import tomllib
from collections.abc import Iterator
from fnmatch import fnmatch
from pathlib import Path
from typing import Any

import pytest

pytestmark = pytest.mark.integration

PACKAGE_ROOT = Path(__file__).parent.parent.parent
MONOREPO_ROOT = PACKAGE_ROOT.parent.parent
FIXTURES_DIR = PACKAGE_ROOT / "tests" / "fixtures"
BUNDLED_LOCK = PACKAGE_ROOT / "corpus.lock"
INTENTS_TOML = PACKAGE_ROOT / "tests" / "test_recommend" / "intents.toml"


@pytest.fixture(scope="module")
def real_corpus(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Path]:
    from brs_docs.corpus.build import build_corpus
    base = tmp_path_factory.mktemp("recommend_corpus")
    out = base / "corpus.sqlite"
    build_corpus(
        lock_path=BUNDLED_LOCK,
        out_path=out,
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
        min_counts={},
    )
    shutil.copyfile(BUNDLED_LOCK, base / "corpus.lock")
    yield out


def _load_cases() -> list[dict[str, Any]]:
    text = INTENTS_TOML.read_text("utf-8")
    data = tomllib.loads(text)
    cases: list[dict[str, Any]] = data["cases"]
    return cases


@pytest.mark.parametrize("case", _load_cases(), ids=lambda c: c["intent"][:40])
def test_recommend_case(case: dict[str, Any], real_corpus: Path) -> None:
    if "xfail_reason" in case:
        pytest.xfail(case["xfail_reason"])

    from brs_docs.db import connect
    from brs_docs.tools.recommend import brs_recommend

    conn = connect(real_corpus)
    try:
        result = brs_recommend(conn, intent=case["intent"], limit=10)
    finally:
        conn.close()
    top_ids = [r["id"] for r in result["results"]]

    if "forbidden_top_ids" in case:
        for forbidden_pattern in case["forbidden_top_ids"]:
            for tid in top_ids:
                assert not fnmatch(tid, forbidden_pattern), (
                    f"intent {case['intent']!r}: forbidden id pattern "
                    f"{forbidden_pattern!r} matched {tid!r}"
                )
    if "expected_top_ids" in case:
        for expected in case["expected_top_ids"]:
            assert expected in top_ids, (
                f"intent {case['intent']!r}: expected {expected!r} in top-K, got {top_ids}"
            )
    if "expected_top_ids_in_order" in case:
        positions = {tid: i for i, tid in enumerate(top_ids)}
        for prev, nxt in zip(
            case["expected_top_ids_in_order"],
            case["expected_top_ids_in_order"][1:],
            strict=False,
        ):
            assert positions[prev] < positions[nxt], (
                f"intent {case['intent']!r}: {prev!r} must rank before {nxt!r} in {top_ids}"
            )
