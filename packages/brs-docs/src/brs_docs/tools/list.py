"""brs_list MCP tool."""

from __future__ import annotations

import sqlite3
from typing import Any

from brs_docs.errors import ErrorCode, error_response
from brs_docs.models import Kind

_VALID_KINDS = {k.value for k in Kind}
LIST_CAP = 500


def brs_list(
    conn: sqlite3.Connection,
    kind: str,
    prefix: str | None = None,
) -> dict[str, Any]:
    if kind not in _VALID_KINDS:
        return error_response(
            ErrorCode.INVALID_KIND,
            f"kind must be one of {sorted(_VALID_KINDS)}",
            {"kind": kind},
        )

    sql = "SELECT id, title FROM docs WHERE kind = ?"
    params: list[Any] = [kind]
    if prefix:
        escaped = (
            prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        sql += " AND title LIKE ? ESCAPE '\\' COLLATE NOCASE"
        params.append(escaped + "%")
    sql += f" ORDER BY title COLLATE NOCASE LIMIT {LIST_CAP}"

    rows = [dict(r) for r in conn.execute(sql, params)]
    return {
        "kind": kind,
        "prefix": prefix,
        "results": rows,
        "total": len(rows),
    }
