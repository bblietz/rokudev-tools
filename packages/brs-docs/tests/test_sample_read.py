"""Tests for brs_sample_read tool."""

from __future__ import annotations

import sqlite3

from brs_docs.errors import ErrorCode
from brs_docs.tools.sample_read import (
    DEFAULT_BYTE_LIMIT,
    MAX_BYTE_LIMIT,
    brs_sample_read,
)


def test_read_default_chunk(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(fixture_corpus, doc_id="sample:big.xml")
    assert result["byte_offset"] == 0
    assert result["bytes_read"] == DEFAULT_BYTE_LIMIT
    assert result["total_bytes"] == 100_000
    assert result["eof"] is False
    assert len(result["body"].encode("utf-8")) == DEFAULT_BYTE_LIMIT


def test_read_with_offset(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(
        fixture_corpus, doc_id="sample:big.xml",
        byte_offset=DEFAULT_BYTE_LIMIT,
        byte_limit=DEFAULT_BYTE_LIMIT,
    )
    assert result["byte_offset"] == DEFAULT_BYTE_LIMIT
    assert result["eof"] is False


def test_read_eof(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(
        fixture_corpus, doc_id="sample:big.xml",
        byte_offset=100_000, byte_limit=DEFAULT_BYTE_LIMIT,
    )
    assert result["body"] == ""
    assert result["eof"] is True


def test_read_clamps_byte_limit(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(
        fixture_corpus, doc_id="sample:big.xml",
        byte_offset=0, byte_limit=999_999,
    )
    assert result["byte_limit"] == MAX_BYTE_LIMIT
    assert result["clamped"] is True


def test_read_non_sample_kind_returns_error(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(fixture_corpus, doc_id="node:RowList")
    assert result["error"]["code"] == ErrorCode.NOT_SAMPLE_KIND.value


def test_read_unknown_id_returns_error(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(fixture_corpus, doc_id="sample:missing")
    assert result["error"]["code"] == ErrorCode.DOC_NOT_FOUND.value


def test_read_negative_offset_returns_error(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(
        fixture_corpus, doc_id="sample:big.xml", byte_offset=-1,
    )
    assert result["error"]["code"] == ErrorCode.INVALID_OFFSET.value
