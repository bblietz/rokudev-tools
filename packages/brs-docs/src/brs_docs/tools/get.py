"""brs_get MCP tool."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from brs_docs.errors import ErrorCode, error_response

BODY_TRUNCATE_THRESHOLD_BYTES = 64 * 1024  # 64 KB


def brs_get(conn: sqlite3.Connection, doc_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT id, kind, title, summary, body, body_truncated, byte_count, "
        "tags, url, source, structured, fetched_at "
        "FROM docs WHERE id = ?",
        (doc_id,),
    ).fetchone()
    if row is None:
        return error_response(ErrorCode.DOC_NOT_FOUND, "doc not found", {"id": doc_id})

    data = dict(row)

    # Parse structured JSON
    raw_structured = data.pop("structured")
    data["structured"] = json.loads(raw_structured) if raw_structured else None

    # Split tags string into list
    tags_str = data.pop("tags") or ""
    data["tags"] = [t for t in tags_str.split() if t]

    # Apply body-truncation if byte_count > threshold (the body column may
    # already hold the full body in storage; we just omit it in the response).
    if data["byte_count"] > BODY_TRUNCATE_THRESHOLD_BYTES:
        data["body"] = ""
        data["body_truncated"] = True
        data["read_hint"] = (
            f"Body > {BODY_TRUNCATE_THRESHOLD_BYTES} bytes. "
            f"Use brs_sample_read with this id to fetch chunks."
        )
    else:
        data["body_truncated"] = bool(data["body_truncated"])

    return data
