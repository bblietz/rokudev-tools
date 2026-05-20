"""Tests for feature_modules scraper."""

from __future__ import annotations

from pathlib import Path

from brs_docs.corpus.sources.feature_modules import parse_feature_modules


def test_parse_reads_module_toml(tmp_path: Path) -> None:
    modules_dir = tmp_path / "modules"
    mod_dir = modules_dir / "analytics.event_pipe"
    mod_dir.mkdir(parents=True)
    (mod_dir / "module.toml").write_text("""
[module]
id = "analytics.event_pipe"
display_name = "Analytics Event Pipe"
description = "Tracks events to multiple sinks."
tags = ["analytics", "tracking"]

[module_wiring]
init_calls = []
""", encoding="utf-8")
    (mod_dir / "README.md").write_text("# Analytics\n\nFull body.\n", encoding="utf-8")

    docs = list(parse_feature_modules(modules_dir))
    assert len(docs) == 1
    d = docs[0]
    assert d.id == "feature_module:analytics.event_pipe"
    assert d.title == "Analytics Event Pipe"
    assert d.summary == "Tracks events to multiple sinks."
    assert "analytics" in d.tags
    assert "Full body" in d.body


def test_parse_synthesizes_body_when_no_readme(tmp_path: Path) -> None:
    modules_dir = tmp_path / "modules"
    mod_dir = modules_dir / "x.y"
    mod_dir.mkdir(parents=True)
    (mod_dir / "module.toml").write_text("""
[module]
id = "x.y"
display_name = "XY"
description = "Test."
tags = []
""", encoding="utf-8")

    docs = list(parse_feature_modules(modules_dir))
    d = docs[0]
    assert d.body  # synthesized
    assert "XY" in d.body
