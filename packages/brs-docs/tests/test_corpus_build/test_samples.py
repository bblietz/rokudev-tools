"""Tests for samples scraper."""

from __future__ import annotations

from pathlib import Path

from brs_docs.corpus.sources.samples import parse_samples_tarball
from brs_docs.models import Kind


def test_parse_emits_one_doc_per_file(tmp_path: Path) -> None:
    fixture = Path(__file__).parent.parent / "fixtures" / "samples_tiny.tar.gz"
    docs = list(parse_samples_tarball(fixture, source="samples"))
    paths = sorted(d.id for d in docs)
    assert "sample:HelloWorld/source/main.brs" in paths
    assert "sample:HelloWorld/components/MainScene.xml" in paths


def test_parse_sets_language_in_structured(tmp_path: Path) -> None:
    fixture = Path(__file__).parent.parent / "fixtures" / "samples_tiny.tar.gz"
    docs = {d.id: d for d in parse_samples_tarball(fixture, source="samples")}
    main = docs["sample:HelloWorld/source/main.brs"]
    assert main.structured["language"] == "brs"
    assert main.kind == Kind.SAMPLE


def test_parse_full_body_preserved(tmp_path: Path) -> None:
    fixture = Path(__file__).parent.parent / "fixtures" / "samples_tiny.tar.gz"
    docs = {d.id: d for d in parse_samples_tarball(fixture, source="samples")}
    assert 'print "hello"' in docs["sample:HelloWorld/source/main.brs"].body
