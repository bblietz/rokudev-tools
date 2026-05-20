"""MCP stdio server for brs-docs."""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from brs_docs import __version__
from brs_docs.corpus.first_run import ensure_cache_corpus
from brs_docs.db import connect
from brs_docs.tools.get import brs_get
from brs_docs.tools.list import brs_list
from brs_docs.tools.recommend import brs_recommend
from brs_docs.tools.sample_read import brs_sample_read
from brs_docs.tools.search import brs_search


def _cache_dir() -> Path:
    return Path(os.environ.get(
        "ROKUDEV_CACHE_DIR", str(Path.home() / ".cache" / "rokudev" / "docs"),
    ))


def _open_conn() -> sqlite3.Connection:
    return connect(ensure_cache_corpus(_cache_dir()))


_TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "brs_search": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Free-text search query"},
            "kind": {"type": ["string", "null"], "description": "Optional kind filter"},
            "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 10},
        },
        "required": ["query"],
    },
    "brs_get": {
        "type": "object",
        "properties": {"doc_id": {"type": "string"}},
        "required": ["doc_id"],
    },
    "brs_list": {
        "type": "object",
        "properties": {
            "kind": {"type": "string"},
            "prefix": {"type": ["string", "null"]},
        },
        "required": ["kind"],
    },
    "brs_sample_read": {
        "type": "object",
        "properties": {
            "doc_id": {"type": "string"},
            "byte_offset": {"type": "integer", "minimum": 0, "default": 0},
            "byte_limit": {
                "type": "integer", "minimum": 1, "maximum": 262144, "default": 65536,
            },
        },
        "required": ["doc_id"],
    },
    "brs_recommend": {
        "type": "object",
        "properties": {
            "intent": {"type": "string"},
            "kinds": {"type": ["array", "null"], "items": {"type": "string"}},
            "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
        },
        "required": ["intent"],
    },
}


_TOOL_DESCRIPTIONS = {
    "brs_search": "Full-text search across BrightScript docs corpus.",
    "brs_get": "Fetch a single doc by id (e.g. 'node:RowList').",
    "brs_list": "List docs of a kind (optionally filtered by title prefix).",
    "brs_sample_read": "Stream a large sample body in chunks (for samples > 64KB).",
    "brs_recommend": "Rank docs/modules/templates by free-text intent.",
}


def _dispatch(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Run a single tool call against a fresh connection."""
    conn = _open_conn()
    try:
        if name == "brs_search":
            return brs_search(conn, **arguments)
        if name == "brs_get":
            return brs_get(conn, **arguments)
        if name == "brs_list":
            return brs_list(conn, **arguments)
        if name == "brs_sample_read":
            return brs_sample_read(conn, **arguments)
        if name == "brs_recommend":
            return brs_recommend(conn, **arguments)
        return {"error": {"code": "UNKNOWN_TOOL", "message": name, "details": {}}}
    finally:
        conn.close()


def build_app() -> Server:
    app: Server = Server("brs-docs")

    # mcp SDK decorators are not fully typed; suppress strict-mode warnings.
    @app.list_tools()  # type: ignore[no-untyped-call,untyped-decorator]
    async def list_tools() -> list[Tool]:
        return [
            Tool(
                name=name,
                description=_TOOL_DESCRIPTIONS[name],
                inputSchema=schema,
            )
            for name, schema in _TOOL_SCHEMAS.items()
        ]

    @app.call_tool()  # type: ignore[untyped-decorator]
    async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
        result = _dispatch(name, arguments)
        return [TextContent(type="text", text=json.dumps(result))]

    return app


async def _run() -> None:
    async with stdio_server() as (read, write):
        app = build_app()
        await app.run(read, write, app.create_initialization_options())


def main() -> int:
    print(f"[brs-docs] MCP stdio server v{__version__}", file=sys.stderr)
    asyncio.run(_run())
    return 0
