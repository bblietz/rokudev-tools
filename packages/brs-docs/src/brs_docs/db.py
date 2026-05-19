"""SQLite connect + FTS5 schema for the brs-docs corpus."""

from __future__ import annotations

import sqlite3
from pathlib import Path

DOCS_DDL = """
CREATE TABLE IF NOT EXISTS docs (
    id             TEXT PRIMARY KEY,
    kind           TEXT NOT NULL,
    title          TEXT NOT NULL,
    summary        TEXT NOT NULL,
    body           TEXT NOT NULL,
    body_truncated INTEGER NOT NULL DEFAULT 0,
    byte_count     INTEGER NOT NULL,
    tags           TEXT NOT NULL DEFAULT '',
    url            TEXT,
    source         TEXT NOT NULL,
    structured     TEXT,
    fetched_at     INTEGER NOT NULL,
    content_hash   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS docs_kind_idx ON docs(kind);
CREATE INDEX IF NOT EXISTS docs_source_idx ON docs(source);
"""

FTS_DDL = """
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
    title,
    summary,
    body,
    tags,
    kind UNINDEXED,
    id UNINDEXED,
    content='docs',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);
"""

FTS_TRIGGERS_DDL = """
CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
    INSERT INTO docs_fts(rowid, title, summary, body, tags, kind, id)
    VALUES (new.rowid, new.title, new.summary, new.body, new.tags, new.kind, new.id);
END;
CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
    INSERT INTO docs_fts(docs_fts, rowid, title, summary, body, tags, kind, id)
    VALUES ('delete', old.rowid, old.title, old.summary, old.body, old.tags, old.kind, old.id);
END;
CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs BEGIN
    INSERT INTO docs_fts(docs_fts, rowid, title, summary, body, tags, kind, id)
    VALUES ('delete', old.rowid, old.title, old.summary, old.body, old.tags, old.kind, old.id);
    INSERT INTO docs_fts(rowid, title, summary, body, tags, kind, id)
    VALUES (new.rowid, new.title, new.summary, new.body, new.tags, new.kind, new.id);
END;
"""


def connect(path: Path | str) -> sqlite3.Connection:
    """Open a SQLite connection with sensible defaults."""
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    """Create tables + FTS + triggers if not already present."""
    conn.executescript(DOCS_DDL)
    conn.executescript(FTS_DDL)
    conn.executescript(FTS_TRIGGERS_DDL)
    conn.commit()
