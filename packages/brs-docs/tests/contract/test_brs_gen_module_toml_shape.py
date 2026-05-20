"""Contract test: parse_feature_modules handles every field in real brs-gen modules."""

from __future__ import annotations

from pathlib import Path

from brs_docs.corpus.sources.feature_modules import parse_feature_modules

MONOREPO_ROOT = Path(__file__).parent.parent.parent.parent.parent
MODULES_DIR = MONOREPO_ROOT / "packages" / "brs-gen" / "modules"


def test_parses_real_modules_without_exception() -> None:
    docs = list(parse_feature_modules(MODULES_DIR))
    # At least the v1 shipped module(s) must be present
    ids = {d.id for d in docs}
    assert "feature_module:analytics.event_pipe" in ids


def test_real_module_structured_fields_populated() -> None:
    docs = {d.id: d for d in parse_feature_modules(MODULES_DIR)}
    analytics = docs.get("feature_module:analytics.event_pipe")
    assert analytics is not None
    assert analytics.title  # display_name from module.toml
    assert analytics.summary  # description from module.toml
    s = analytics.structured
    assert s is not None
    # Expected keys (the parser produces these even if empty)
    assert "public_api" in s
    assert "config_keys" in s
    assert "requires_modules" in s
    assert "conflicts_modules" in s
    assert "applies_to_templates" in s


def test_module_dir_skips_non_directories() -> None:
    # Ensures the parser doesn't break on stray files (README.md, .DS_Store) at modules/ level.
    docs = list(parse_feature_modules(MODULES_DIR))
    # No CanonicalDoc should have an empty title
    assert all(d.title for d in docs)
