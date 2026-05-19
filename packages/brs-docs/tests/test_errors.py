"""Tests for errors.py: error codes + structured error responses."""

from __future__ import annotations

from brs_docs.errors import ErrorCode, ToolError, error_response


def test_all_v1_codes_present() -> None:
    expected = {
        "DOC_NOT_FOUND", "NOT_SAMPLE_KIND", "INVALID_KIND",
        "INVALID_QUERY", "INVALID_OFFSET",
        "CORPUS_NOT_INITIALIZED", "CORPUS_LOCK_MISSING",
    }
    assert {c.value for c in ErrorCode} == expected


def test_error_response_shape() -> None:
    err = error_response(ErrorCode.DOC_NOT_FOUND, "no such id", {"id": "x"})
    assert err == {
        "error": {
            "code": "DOC_NOT_FOUND",
            "message": "no such id",
            "details": {"id": "x"},
        }
    }


def test_tool_error_round_trip() -> None:
    exc = ToolError(ErrorCode.INVALID_KIND, "bad kind", {"kind": "foo"})
    assert exc.to_response() == {
        "error": {
            "code": "INVALID_KIND",
            "message": "bad kind",
            "details": {"kind": "foo"},
        }
    }
