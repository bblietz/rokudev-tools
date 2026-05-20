"""brs-docs CLI (argparse-based)."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

from brs_docs import __version__
from brs_docs.corpus.first_run import CorpusNotInitialized, ensure_cache_corpus
from brs_docs.corpus.lock import parse_corpus_lock
from brs_docs.db import connect


def _default_cache_dir() -> Path:
    return Path(os.environ.get(
        "ROKUDEV_CACHE_DIR",
        str(Path.home() / ".cache" / "rokudev" / "docs"),
    ))


def _open_conn() -> sqlite3.Connection:
    cache = _default_cache_dir()
    corpus_path = ensure_cache_corpus(cache)
    return connect(corpus_path)


def _cmd_version(_args: argparse.Namespace) -> int:
    cache = _default_cache_dir()
    lock_path = cache / "corpus.lock"
    summary = "no corpus installed"
    if lock_path.exists():
        try:
            lock = parse_corpus_lock(lock_path)
            summary = (
                f"corpus {lock.brs_docs_version} "
                f"(dev_doc={lock.sources.dev_doc.sha[:8]})"
            )
        except Exception as exc:
            summary = f"corpus.lock unreadable: {exc}"
    print(f"brs-docs {__version__}")
    print(summary)
    print("telemetry: none")
    return 0


def _cmd_serve(_args: argparse.Namespace) -> int:
    # Deferred import so the rest of the CLI works even if `mcp` isn't usable,
    # and so T19 can land before T20 ships brs_docs.server.
    from brs_docs.server import main as server_main  # type: ignore[import-untyped]
    return int(server_main())


def _cmd_search(args: argparse.Namespace) -> int:
    from brs_docs.tools.search import brs_search
    conn = _open_conn()
    try:
        result = brs_search(conn, query=args.query, kind=args.kind, limit=args.limit)
    finally:
        conn.close()
    print(json.dumps(result, indent=2))
    return 0


def _cmd_get(args: argparse.Namespace) -> int:
    from brs_docs.tools.get import brs_get
    conn = _open_conn()
    try:
        result = brs_get(conn, doc_id=args.id)
    finally:
        conn.close()
    print(json.dumps(result, indent=2))
    return 0


def _cmd_list(args: argparse.Namespace) -> int:
    from brs_docs.tools.list import brs_list
    conn = _open_conn()
    try:
        result = brs_list(conn, kind=args.kind, prefix=args.prefix)
    finally:
        conn.close()
    print(json.dumps(result, indent=2))
    return 0


def _cmd_recommend(args: argparse.Namespace) -> int:
    from brs_docs.tools.recommend import brs_recommend
    conn = _open_conn()
    try:
        result = brs_recommend(
            conn, intent=args.intent, kinds=args.kinds, limit=args.limit,
        )
    finally:
        conn.close()
    print(json.dumps(result, indent=2))
    return 0


def _cmd_refresh(_args: argparse.Namespace) -> int:
    # T21 fills this in; T19 just stubs.
    print("refresh not yet wired (T21)", file=sys.stderr)
    return 2


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="brs-docs", description="Roku BrightScript docs MCP + CLI.")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("version", help="Show brs-docs + corpus version").set_defaults(func=_cmd_version)
    sub.add_parser("serve", help="Run the MCP stdio server").set_defaults(func=_cmd_serve)

    s = sub.add_parser("search", help="Full-text search")
    s.add_argument("query")
    s.add_argument("--kind", default=None)
    s.add_argument("--limit", type=int, default=10)
    s.set_defaults(func=_cmd_search)

    g = sub.add_parser("get", help="Fetch one doc by id")
    g.add_argument("id")
    g.set_defaults(func=_cmd_get)

    li = sub.add_parser("list", help="List docs of a kind")
    li.add_argument("kind")
    li.add_argument("--prefix", default=None)
    li.set_defaults(func=_cmd_list)

    r = sub.add_parser("recommend", help="Rank docs/modules/templates by intent")
    r.add_argument("intent")
    r.add_argument("--kinds", nargs="*", default=None)
    r.add_argument("--limit", type=int, default=5)
    r.set_defaults(func=_cmd_recommend)

    sub.add_parser(
        "refresh", help="Refresh the local corpus from bundled snapshot",
    ).set_defaults(func=_cmd_refresh)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except CorpusNotInitialized as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
