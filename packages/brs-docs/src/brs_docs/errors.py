"""Structured error codes + response builder."""

from __future__ import annotations

from enum import StrEnum
from typing import Any


class ErrorCode(StrEnum):
    DOC_NOT_FOUND = "DOC_NOT_FOUND"
    NOT_SAMPLE_KIND = "NOT_SAMPLE_KIND"
    INVALID_KIND = "INVALID_KIND"
    INVALID_QUERY = "INVALID_QUERY"
    INVALID_OFFSET = "INVALID_OFFSET"
    CORPUS_NOT_INITIALIZED = "CORPUS_NOT_INITIALIZED"
    CORPUS_LOCK_MISSING = "CORPUS_LOCK_MISSING"


def error_response(
    code: ErrorCode,
    message: str,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "error": {
            "code": code.value,
            "message": message,
            "details": details or {},
        }
    }


class ToolError(Exception):
    def __init__(
        self,
        code: ErrorCode,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def to_response(self) -> dict[str, Any]:
        return error_response(self.code, self.message, self.details)
