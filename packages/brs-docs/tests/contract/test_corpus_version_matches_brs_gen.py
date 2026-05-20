"""Contract test: corpus.lock package_version matches brs-gen package.json."""

from __future__ import annotations

import json
from pathlib import Path

from brs_docs.corpus.lock import parse_corpus_lock

MONOREPO_ROOT = Path(__file__).parent.parent.parent.parent.parent
BRS_DOCS_LOCK = MONOREPO_ROOT / "packages" / "brs-docs" / "corpus.lock"
BRS_GEN_PACKAGE_JSON = MONOREPO_ROOT / "packages" / "brs-gen" / "package.json"


def test_modules_package_version_matches_brs_gen() -> None:
    lock = parse_corpus_lock(BRS_DOCS_LOCK)
    brs_gen_pkg = json.loads(BRS_GEN_PACKAGE_JSON.read_text("utf-8"))
    expected = brs_gen_pkg["version"]
    assert lock.sources.rokudev_tools_modules.package_version == expected, (
        f"corpus.lock rokudev_tools_modules.package_version "
        f"({lock.sources.rokudev_tools_modules.package_version}) does not match "
        f"brs-gen package.json version ({expected}). Bump corpus.lock when bumping brs-gen."
    )


def test_templates_package_version_matches_brs_gen() -> None:
    lock = parse_corpus_lock(BRS_DOCS_LOCK)
    brs_gen_pkg = json.loads(BRS_GEN_PACKAGE_JSON.read_text("utf-8"))
    expected = brs_gen_pkg["version"]
    assert lock.sources.rokudev_tools_templates.package_version == expected
