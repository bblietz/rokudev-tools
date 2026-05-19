"""brs_search MCP tool."""

from __future__ import annotations

import re
import sqlite3
from typing import Any

from brs_docs.errors import ErrorCode, error_response
from brs_docs.models import Kind

_VALID_KINDS = {k.value for k in Kind}
_FTS_QUOTE_RE = re.compile(r'"')


def _to_fts_query(user_query: str) -> str:
    cleaned = _FTS_QUOTE_RE.sub("", user_query)
    tokens = [t for t in cleaned.split() if t]
    if not tokens:
        raise ValueError("query must contain at least one token")
    return " ".join(f'"{t}"' for t in tokens)


def brs_search(
    conn: sqlite3.Connection,
    query: str,
    kind: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    if kind is not None and kind not in _VALID_KINDS:
        return error_response(
            ErrorCode.INVALID_KIND,
            f"kind must be one of {sorted(_VALID_KINDS)} or null",
            {"kind": kind},
        )
    if not query or not query.strip():
        return error_response(ErrorCode.INVALID_QUERY, "query must be non-empty")
    limit = max(1, min(50, limit))

    try:
        fts_query = _to_fts_query(query)
    except ValueError as exc:
        return error_response(ErrorCode.INVALID_QUERY, str(exc))

    sql = (
        "SELECT d.id, d.title, d.kind, d.summary, "
        "snippet(docs_fts, 2, '<mark>', '</mark>', '...', 16) AS snippet, "
        "bm25(docs_fts) AS score "
        "FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid "
        "WHERE docs_fts MATCH ? "
    )
    params: list[Any] = [fts_query]
    if kind:
        sql += "AND d.kind = ? "
        params.append(kind)
    sql += "ORDER BY score LIMIT ?"
    params.append(limit)

    rows = [dict(r) for r in conn.execute(sql, params)]

    count_sql = (
        "SELECT COUNT(*) AS c FROM docs_fts JOIN docs d "
        "ON d.rowid = docs_fts.rowid WHERE docs_fts MATCH ?"
    )
    count_params: list[Any] = [fts_query]
    if kind:
        count_sql += " AND d.kind = ?"
        count_params.append(kind)
    total = conn.execute(count_sql, count_params).fetchone()[0]

    return {
        "results": rows,
        "total_matched": total,
        "query_echo": {"query": query, "kind": kind, "limit": limit},
    }
