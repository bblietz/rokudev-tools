"""Tests for templates scraper."""

from __future__ import annotations

from pathlib import Path

from brs_docs.corpus.sources.templates import parse_templates


def test_parse_reads_template_toml(tmp_path: Path) -> None:
    templates_dir = tmp_path / "templates"
    t_dir = templates_dir / "video_grid_channel"
    t_dir.mkdir(parents=True)
    (t_dir / "template.toml").write_text("""
[template]
id = "video_grid_channel"
display_name = "Video Grid Channel"
description = "Streaming video grid template."
tags = ["video", "grid", "streaming", "ott"]
supported_modules = ["analytics.event_pipe", "auth.device_link_code"]
scenes = ["MainScene", "DetailsScene", "PlayerScene"]
content_kinds = ["video"]
""", encoding="utf-8")
    (t_dir / "README.md").write_text("# Video Grid\n\nHero unit + rows of posters.\n", encoding="utf-8")

    docs = list(parse_templates(templates_dir))
    assert len(docs) == 1
    d = docs[0]
    assert d.id == "template:video_grid_channel"
    assert d.title == "Video Grid Channel"
    assert d.summary == "Streaming video grid template."
    assert "video" in d.tags
    assert "Hero unit" in d.body
    assert d.structured["supported_modules"] == ["analytics.event_pipe", "auth.device_link_code"]
    assert d.structured["scenes"] == ["MainScene", "DetailsScene", "PlayerScene"]
    assert d.structured["content_kinds"] == ["video"]


def test_parse_synthesizes_body_when_no_readme(tmp_path: Path) -> None:
    templates_dir = tmp_path / "templates"
    t_dir = templates_dir / "x"
    t_dir.mkdir(parents=True)
    (t_dir / "template.toml").write_text("""
[template]
id = "x"
display_name = "X"
description = "Test."
tags = []
""", encoding="utf-8")

    docs = list(parse_templates(templates_dir))
    d = docs[0]
    assert d.body  # synthesized
    assert "X" in d.body
