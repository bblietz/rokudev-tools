"""Tests for models.py: Kind enum, CanonicalDoc validation."""

from __future__ import annotations

import pytest

from brs_docs.models import CanonicalDoc, Kind


def test_kind_enum_has_9_values() -> None:
    assert len(list(Kind)) == 9
    assert Kind.COMPONENT.value == "component"
    assert Kind.FEATURE_MODULE.value == "feature_module"
    assert Kind.TEMPLATE.value == "template"


def test_canonical_doc_id_prefix_must_match_kind() -> None:
    with pytest.raises(ValueError, match="must start with"):
        CanonicalDoc(
            id="node:RowList",
            kind=Kind.COMPONENT,  # mismatch
            title="x", summary="y", body="z", byte_count=1,
            source="dev_doc", fetched_at=0, content_hash="h",
        )


def test_canonical_doc_round_trip() -> None:
    doc = CanonicalDoc(
        id="node:RowList",
        kind=Kind.NODE,
        title="RowList",
        summary="A row list",
        body="full body",
        byte_count=9,
        tags="rowlist row scenegraph",
        source="dev_doc",
        fetched_at=1000,
        content_hash="abc",
    )
    data = doc.model_dump()
    assert data["id"] == "node:RowList"
    assert data["body_truncated"] is False
    assert data["tags"] == "rowlist row scenegraph"


def test_canonical_doc_defaults() -> None:
    doc = CanonicalDoc(
        id="guide:intro", kind=Kind.GUIDE,
        title="Intro", summary="s", body="b", byte_count=1,
        source="dev_doc", fetched_at=0, content_hash="h",
    )
    assert doc.body_truncated is False
    assert doc.tags == ""
    assert doc.url is None
    assert doc.structured is None
