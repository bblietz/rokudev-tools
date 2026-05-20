"""Tests for dev_doc scraper."""

from __future__ import annotations

from pathlib import Path

from brs_docs.corpus.sources.dev_doc import parse_dev_doc_tarball
from brs_docs.models import Kind


def test_parse_tarball_returns_canonical_docs(tmp_path: Path) -> None:
    fixture = Path(__file__).parent.parent / "fixtures" / "dev_doc_tiny.tar.gz"
    docs = list(parse_dev_doc_tarball(fixture))
    ids = {d.id for d in docs}
    assert "component:roDateTime" in ids
    assert "node:RowList" in ids
    assert "global_function:CreateObject" in ids


def test_parse_sets_kind_correctly(tmp_path: Path) -> None:
    fixture = Path(__file__).parent.parent / "fixtures" / "dev_doc_tiny.tar.gz"
    docs = {d.id: d for d in parse_dev_doc_tarball(fixture)}
    assert docs["component:roDateTime"].kind == Kind.COMPONENT
    assert docs["node:RowList"].kind == Kind.NODE
    assert docs["global_function:CreateObject"].kind == Kind.GLOBAL_FUNCTION


def test_parse_extracts_tags(tmp_path: Path) -> None:
    fixture = Path(__file__).parent.parent / "fixtures" / "dev_doc_tiny.tar.gz"
    docs = {d.id: d for d in parse_dev_doc_tarball(fixture)}
    assert "datetime" in docs["component:roDateTime"].tags
    assert "rowlist" in docs["node:RowList"].tags
