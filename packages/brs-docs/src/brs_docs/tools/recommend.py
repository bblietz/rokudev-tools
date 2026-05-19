"""brs_recommend MCP tool."""

from __future__ import annotations

import sqlite3
from typing import Any

from brs_docs.recommend.ranker import load_tags_toml, rank_candidates


def brs_recommend(
    conn: sqlite3.Connection,
    intent: str,
    kinds: list[str] | None = None,
    limit: int = 5,
) -> dict[str, Any]:
    limit = max(1, min(20, limit))
    cfg = load_tags_toml()
    results = rank_candidates(conn, intent=intent, kinds=kinds, limit=limit)
    return {
        "intent": intent,
        "results": results,
        "ranker_version": cfg["version"],
        "tags_toml_version": cfg["version"],
    }
