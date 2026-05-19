"""Shared pytest fixtures for brs-docs tests."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from brs_docs.db import connect, init_schema


def _seed_doc(
    conn: sqlite3.Connection,
    *,
    id: str,
    kind: str,
    title: str,
    summary: str = "",
    body: str = "",
    tags: str = "",
    url: str | None = None,
    source: str = "dev_doc",
    structured: str | None = None,
) -> None:
    body_bytes = body.encode("utf-8")
    conn.execute(
        "INSERT INTO docs (id, kind, title, summary, body, byte_count, "
        "tags, url, source, structured, fetched_at, content_hash) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (id, kind, title, summary, body, len(body_bytes),
         tags, url, source, structured, 1700000000, "h"),
    )


@pytest.fixture
def fixture_corpus(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    """In-memory corpus pre-seeded with ~10 docs covering all kinds."""
    db_path = tmp_path / "fixture.sqlite"
    conn = connect(db_path)
    init_schema(conn)

    _seed_doc(conn, id="component:roDateTime", kind="component",
              title="roDateTime", summary="Date and time component.",
              body="# roDateTime\nHandles date arithmetic.",
              tags="datetime time epoch")
    _seed_doc(conn, id="component:roUrlTransfer", kind="component",
              title="roUrlTransfer", summary="HTTP request component.",
              body="# roUrlTransfer\nMakes HTTP requests.",
              tags="http url network")
    _seed_doc(conn, id="interface:ifString", kind="interface",
              title="ifString", summary="String operations.",
              body="# ifString", tags="string text")
    _seed_doc(conn, id="event:roUrlEvent", kind="event",
              title="roUrlEvent", summary="URL response event.",
              body="# roUrlEvent", tags="event url")
    _seed_doc(conn, id="node:RowList", kind="node",
              title="RowList", summary="Horizontally scrolling rows.",
              body="# RowList supports rotating focus.",
              tags="rowlist row scenegraph focus")
    _seed_doc(conn, id="node:Video", kind="node",
              title="Video", summary="Video playback node.",
              body="# Video supports HLS and DASH.",
              tags="video playback hls dash")
    _seed_doc(conn, id="global_function:CreateObject", kind="global_function",
              title="CreateObject", summary="Construct a component.",
              body="# CreateObject", tags="construct factory")
    _seed_doc(conn, id="guide:scenegraph-focus", kind="guide",
              title="SceneGraph Focus", summary="How focus works.",
              body="Focus traversal in SceneGraph.",
              tags="scenegraph focus")
    _seed_doc(conn, id="sample:small.brs", kind="sample",
              title="small.brs", summary="A small sample.",
              body="sub main()\n  print 1\nend sub",
              tags="sample brs", source="samples")
    _seed_doc(conn, id="sample:big.xml", kind="sample",
              title="big.xml", summary="A big sample.",
              body="x" * 100_000,  # > 64KB
              tags="sample xml", source="scenegraph_master_sample")
    _seed_doc(conn, id="feature_module:analytics.event_pipe", kind="feature_module",
              title="analytics.event_pipe", summary="Analytics event pipeline.",
              body="Tracks events and dispatches to sinks.",
              tags="analytics tracking events",
              source="rokudev-tools-modules")
    _seed_doc(conn, id="template:video_grid_channel", kind="template",
              title="video_grid_channel", summary="Streaming video grid template.",
              body="Hero unit + rows of posters; deep-link aware.",
              tags="video grid streaming ott",
              source="rokudev-tools-templates")

    conn.commit()
    yield conn
    conn.close()
