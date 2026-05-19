"""brs_sample_read MCP tool."""

from __future__ import annotations

import sqlite3
from typing import Any

from brs_docs.errors import ErrorCode, error_response

DEFAULT_BYTE_LIMIT = 64 * 1024
MAX_BYTE_LIMIT = 256 * 1024


def brs_sample_read(
    conn: sqlite3.Connection,
    doc_id: str,
    byte_offset: int = 0,
    byte_limit: int = DEFAULT_BYTE_LIMIT,
) -> dict[str, Any]:
    if byte_offset < 0:
        return error_response(
            ErrorCode.INVALID_OFFSET,
            "byte_offset must be >= 0",
            {"byte_offset": byte_offset},
        )

    clamped = False
    if byte_limit > MAX_BYTE_LIMIT:
        byte_limit = MAX_BYTE_LIMIT
        clamped = True
    if byte_limit < 1:
        byte_limit = 1

    row = conn.execute(
        "SELECT kind, body, byte_count FROM docs WHERE id = ?", (doc_id,),
    ).fetchone()
    if row is None:
        return error_response(
            ErrorCode.DOC_NOT_FOUND, "doc not found", {"id": doc_id},
        )
    if row["kind"] != "sample":
        return error_response(
            ErrorCode.NOT_SAMPLE_KIND,
            "brs_sample_read only valid for kind=sample",
            {"id": doc_id, "kind": row["kind"]},
        )

    full_body = row["body"]
    body_bytes = full_body.encode("utf-8")
    total = len(body_bytes)

    if byte_offset >= total:
        return {
            "id": doc_id,
            "byte_offset": byte_offset,
            "byte_limit": byte_limit,
            "bytes_read": 0,
            "total_bytes": total,
            "eof": True,
            "body": "",
            **({"clamped": True} if clamped else {}),
        }

    chunk_bytes = body_bytes[byte_offset : byte_offset + byte_limit]
    # decode with errors=replace to be safe on chunk boundaries that split
    # a multi-byte UTF-8 sequence
    body_chunk = chunk_bytes.decode("utf-8", errors="replace")
    # eof=True only when caller is already past the end (zero bytes returned)
    eof = len(chunk_bytes) == 0

    response: dict[str, Any] = {
        "id": doc_id,
        "byte_offset": byte_offset,
        "byte_limit": byte_limit,
        "bytes_read": len(chunk_bytes),
        "total_bytes": total,
        "eof": eof,
        "body": body_chunk,
    }
    if clamped:
        response["clamped"] = True
    return response
