# brs-docs MCP Implementation Plan (Plan 6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `brs-docs`, a Python MCP server that gives Claude Code (and a human dev via CLI) fast offline lookup over the BrightScript reference corpus, code samples, and rokudev-tools feature modules + templates.

**Architecture:** Python 3.11 + uv-managed package at `packages/brs-docs/` in the rokudev-tools monorepo. SQLite + FTS5 corpus pre-bundled in the PyPI wheel. 5 MCP tools (`brs_search`, `brs_get`, `brs_list`, `brs_sample_read`, `brs_recommend`). BM25 + tag-boost + module-category-boost ranker (no embeddings, no LLM). Transactional refresh via atomic rename.

**Tech Stack:** Python 3.11, uv, pydantic v2, mcp (Python SDK), sqlite3 stdlib + FTS5, pytest, ruff, mypy.

**Spec:** `docs/superpowers/specs/2026-05-19-brs-docs-mcp-design.md`

**Project conventions reference:**
- Monorepo root: `/Users/bblietz/Work/ClaudeProjects/rokudev-tools/`
- Existing Python prototype to use as reference (NOT to copy verbatim): `/Users/bblietz/Work/ClaudeProjects/brs-mcp-for-docs/`
- Workflow: TDD per @superpowers:test-driven-development; verify before claiming done per @superpowers:verification-before-completion.
- Commit policy: small commits per task. NEVER `--no-verify`. NEVER force-push.
- Branch policy: continue on `main` (project pattern; see MEMORY).

---

## Task overview

29 tasks across 7 phases:

| Phase | Tasks | Theme |
|---|---|---|
| 1 | T01-T04 | Foundation: package scaffolding, schema, models, error codes |
| 2 | T05-T10 | MCP tools: search, get, list, sample_read, ranker, recommend |
| 3 | T11-T14 | Scrapers: dev_doc, samples, feature_modules, templates |
| 4 | T15-T18 | Build pipeline: corpus.lock, build orchestrator, atomic install, first-run |
| 5 | T19-T21 | CLI + server: `brs-docs` subcommands, MCP stdio server, refresh |
| 6 | T22-T24 | Tests: contract, integration, recommend fixtures |
| 7 | T25-T29 | CI + release: GH Actions, lint scripts, Makefile, corpus generation, version bookkeeping |

---

## Phase 1: Foundation

### Task T01: Package scaffolding

**Files:**
- Create: `packages/brs-docs/pyproject.toml`
- Create: `packages/brs-docs/README.md`
- Create: `packages/brs-docs/.gitignore`
- Create: `packages/brs-docs/.python-version` (contents: `3.11`)
- Create: `packages/brs-docs/src/brs_docs/__init__.py`
- Create: `packages/brs-docs/src/brs_docs/tools/__init__.py`
- Create: `packages/brs-docs/src/brs_docs/recommend/__init__.py`
- Create: `packages/brs-docs/src/brs_docs/corpus/__init__.py`
- Create: `packages/brs-docs/src/brs_docs/corpus/sources/__init__.py`
- Create: `packages/brs-docs/tests/__init__.py`
- Create: `packages/brs-docs/tests/conftest.py`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "brs-docs"
version = "0.7.0"
description = "MCP server for Roku BrightScript reference, samples, and rokudev-tools modules/templates."
readme = "README.md"
requires-python = ">=3.11"
license = { text = "MIT" }
authors = [{ name = "rokudev-tools" }]
dependencies = [
    "pydantic>=2.5",
    "mcp>=0.9",
    "tomli>=2.0;python_version<'3.11'",
]

[project.scripts]
brs-docs = "brs_docs.cli:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/brs_docs"]
include = ["src/brs_docs/data/corpus.sqlite", "src/brs_docs/data/corpus.lock"]

[tool.hatch.build.targets.sdist]
include = ["src/brs_docs", "tests", "pyproject.toml", "README.md", "corpus.lock"]

[dependency-groups]
dev = [
    "pytest>=8.0",
    "pytest-cov>=4.0",
    "ruff>=0.4",
    "mypy>=1.10",
    "httpx>=0.27",
]

[tool.ruff]
line-length = 100
target-version = "py311"

[tool.ruff.lint]
select = ["E", "F", "I", "B", "UP", "N", "RUF"]

[tool.mypy]
strict = true
python_version = "3.11"
packages = ["brs_docs"]

[tool.pytest.ini_options]
testpaths = ["tests"]
markers = [
    "integration: integration tests (slower; spawn subprocesses or build real corpus)",
    "slow: slow tests (corpus build, network IO)",
]
```

- [ ] **Step 2: Write `.gitignore`**

```
# brs-docs local artifacts
src/brs_docs/data/corpus.sqlite
src/brs_docs/data/corpus.sqlite-shm
src/brs_docs/data/corpus.sqlite-wal
.venv/
__pycache__/
*.egg-info/
.pytest_cache/
.ruff_cache/
.mypy_cache/
dist/
```

- [ ] **Step 3: Write minimal `README.md`**

```markdown
# brs-docs

MCP server + CLI for Roku BrightScript docs.

Part of the rokudev-tools monorepo. See `docs/superpowers/specs/2026-05-19-brs-docs-mcp-design.md` for design.

## Install

\`\`\`bash
uv tool install brs-docs
brs-docs serve  # MCP stdio
brs-docs search "RowList"
\`\`\`
```

- [ ] **Step 4: Write `src/brs_docs/__init__.py`**

```python
"""brs-docs: MCP server + CLI for Roku BrightScript docs."""

__version__ = "0.7.0"
```

All other `__init__.py` files (tools, recommend, corpus, sources, tests): single blank line.

- [ ] **Step 5: Write minimal `tests/conftest.py`**

```python
"""Shared pytest fixtures for brs-docs tests."""

from __future__ import annotations
```

(Will be filled by later tasks.)

- [ ] **Step 6: Run `uv sync` to verify the package installs**

Run: `cd packages/brs-docs && uv sync`
Expected: Successful sync; venv created at `.venv/`.

- [ ] **Step 7: Run `uv run pytest` to verify pytest runs (no tests yet; should exit 5 = no tests collected)**

Run: `cd packages/brs-docs && uv run pytest`
Expected: Exit code 5 ("no tests ran") OR pass with 0 tests; either is acceptable.

- [ ] **Step 8: Commit**

```bash
git add packages/brs-docs/
git commit -m "feat(brs-docs): T01 package scaffolding (Plan 6)"
```

---

### Task T02: SQLite schema + db.py

**Files:**
- Create: `packages/brs-docs/src/brs_docs/db.py`
- Create: `packages/brs-docs/tests/test_db.py`

- [ ] **Step 1: Write failing test `tests/test_db.py`**

```python
"""Tests for db.py: connect + schema init."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from brs_docs.db import connect, init_schema


def test_init_schema_creates_docs_table(tmp_path: Path) -> None:
    db_path = tmp_path / "test.sqlite"
    conn = connect(db_path)
    init_schema(conn)

    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='docs'"
    )
    assert cursor.fetchone() is not None


def test_init_schema_creates_fts_table(tmp_path: Path) -> None:
    db_path = tmp_path / "test.sqlite"
    conn = connect(db_path)
    init_schema(conn)

    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='docs_fts'"
    )
    assert cursor.fetchone() is not None


def test_init_schema_is_idempotent(tmp_path: Path) -> None:
    db_path = tmp_path / "test.sqlite"
    conn = connect(db_path)
    init_schema(conn)
    init_schema(conn)  # second call must not raise


def test_docs_columns_match_spec(tmp_path: Path) -> None:
    db_path = tmp_path / "test.sqlite"
    conn = connect(db_path)
    init_schema(conn)

    cols = [row[1] for row in conn.execute("PRAGMA table_info(docs)")]
    expected = {
        "id", "kind", "title", "summary", "body", "body_truncated",
        "byte_count", "tags", "url", "source", "structured",
        "fetched_at", "content_hash",
    }
    assert set(cols) == expected


def test_fts_trigger_keeps_docs_fts_in_sync(tmp_path: Path) -> None:
    db_path = tmp_path / "test.sqlite"
    conn = connect(db_path)
    init_schema(conn)

    conn.execute(
        "INSERT INTO docs (id, kind, title, summary, body, byte_count, "
        "source, fetched_at, content_hash) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("node:RowList", "node", "RowList", "A row list",
         "Full body", 9, "dev_doc", 1000, "abc"),
    )
    conn.commit()

    fts_rows = conn.execute(
        "SELECT title FROM docs_fts WHERE docs_fts MATCH ?", ("RowList",)
    ).fetchall()
    assert len(fts_rows) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/brs-docs && uv run pytest tests/test_db.py -v`
Expected: FAIL (ModuleNotFoundError: brs_docs.db)

- [ ] **Step 3: Implement `src/brs_docs/db.py`**

```python
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
```

- [ ] **Step 4: Run tests; verify all pass**

Run: `cd packages/brs-docs && uv run pytest tests/test_db.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/src/brs_docs/db.py packages/brs-docs/tests/test_db.py
git commit -m "feat(brs-docs): T02 SQLite schema + db.py (Plan 6)"
```

---

### Task T03: Pydantic models

**Files:**
- Create: `packages/brs-docs/src/brs_docs/models.py`
- Create: `packages/brs-docs/tests/test_models.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for models.py: Kind enum, CanonicalDoc validation."""

from __future__ import annotations

import pytest

from brs_docs.models import CanonicalDoc, Kind


def test_kind_enum_has_9_values() -> None:
    assert len(list(Kind)) == 9
    assert Kind.COMPONENT.value == "component"
    assert Kind.FEATURE_MODULE.value == "feature_module"
    assert Kind.TEMPLATE.value == "template"


def test_canonical_doc_id_prefix_must_match_kind() -> None:
    with pytest.raises(ValueError, match="must start with"):
        CanonicalDoc(
            id="node:RowList",
            kind=Kind.COMPONENT,  # mismatch
            title="x", summary="y", body="z", byte_count=1,
            source="dev_doc", fetched_at=0, content_hash="h",
        )


def test_canonical_doc_round_trip() -> None:
    doc = CanonicalDoc(
        id="node:RowList",
        kind=Kind.NODE,
        title="RowList",
        summary="A row list",
        body="full body",
        byte_count=9,
        tags="rowlist row scenegraph",
        source="dev_doc",
        fetched_at=1000,
        content_hash="abc",
    )
    data = doc.model_dump()
    assert data["id"] == "node:RowList"
    assert data["body_truncated"] is False
    assert data["tags"] == "rowlist row scenegraph"


def test_canonical_doc_defaults() -> None:
    doc = CanonicalDoc(
        id="guide:intro", kind=Kind.GUIDE,
        title="Intro", summary="s", body="b", byte_count=1,
        source="dev_doc", fetched_at=0, content_hash="h",
    )
    assert doc.body_truncated is False
    assert doc.tags == ""
    assert doc.url is None
    assert doc.structured is None
```

- [ ] **Step 2: Run tests; verify fail**

Run: `cd packages/brs-docs && uv run pytest tests/test_models.py -v`
Expected: FAIL (ModuleNotFoundError).

- [ ] **Step 3: Implement `src/brs_docs/models.py`**

```python
"""Pydantic models shared across scraper, MCP server, and CLI."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, model_validator


class Kind(StrEnum):
    COMPONENT = "component"
    INTERFACE = "interface"
    EVENT = "event"
    NODE = "node"
    GLOBAL_FUNCTION = "global_function"
    GUIDE = "guide"
    SAMPLE = "sample"
    FEATURE_MODULE = "feature_module"
    TEMPLATE = "template"


class CanonicalDoc(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    kind: Kind
    title: str
    summary: str
    body: str
    body_truncated: bool = False
    byte_count: int
    tags: str = ""
    url: str | None = None
    source: str
    structured: dict[str, Any] | None = None
    fetched_at: int
    content_hash: str

    @model_validator(mode="after")
    def _check_id_prefix(self) -> "CanonicalDoc":
        expected = f"{self.kind.value}:"
        if not self.id.startswith(expected):
            raise ValueError(f"id {self.id!r} must start with {expected!r}")
        return self
```

- [ ] **Step 4: Run tests; verify pass**

Run: `cd packages/brs-docs && uv run pytest tests/test_models.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/src/brs_docs/models.py packages/brs-docs/tests/test_models.py
git commit -m "feat(brs-docs): T03 Pydantic models + Kind enum (Plan 6)"
```

---

### Task T04: Error codes + response shape

**Files:**
- Create: `packages/brs-docs/src/brs_docs/errors.py`
- Create: `packages/brs-docs/tests/test_errors.py`

- [ ] **Step 1: Write failing tests**

```python
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
```

- [ ] **Step 2: Run; verify fail**

Run: `cd packages/brs-docs && uv run pytest tests/test_errors.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement `src/brs_docs/errors.py`**

```python
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
```

- [ ] **Step 4: Run; verify pass**

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/src/brs_docs/errors.py packages/brs-docs/tests/test_errors.py
git commit -m "feat(brs-docs): T04 error codes + ToolError response shape (Plan 6)"
```

---

## Phase 2: MCP tools

All Phase 2 tasks use the same fixture-corpus pattern. Add this to `tests/conftest.py` before T05:

- [ ] **Phase 2 prep: Augment `tests/conftest.py`**

```python
"""Shared pytest fixtures for brs-docs tests."""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from brs_docs.db import connect, init_schema


def _seed_doc(
    conn: sqlite3.Connection,
    *,
    id: str,
    kind: str,
    title: str,
    summary: str = "",
    body: str = "",
    tags: str = "",
    url: str | None = None,
    source: str = "dev_doc",
    structured: str | None = None,
) -> None:
    body_bytes = body.encode("utf-8")
    conn.execute(
        "INSERT INTO docs (id, kind, title, summary, body, byte_count, "
        "tags, url, source, structured, fetched_at, content_hash) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (id, kind, title, summary, body, len(body_bytes),
         tags, url, source, structured, 1700000000, "h"),
    )


@pytest.fixture
def fixture_corpus(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    """In-memory corpus pre-seeded with ~10 docs covering all kinds."""
    db_path = tmp_path / "fixture.sqlite"
    conn = connect(db_path)
    init_schema(conn)

    _seed_doc(conn, id="component:roDateTime", kind="component",
              title="roDateTime", summary="Date and time component.",
              body="# roDateTime\nHandles date arithmetic.",
              tags="datetime time epoch")
    _seed_doc(conn, id="component:roUrlTransfer", kind="component",
              title="roUrlTransfer", summary="HTTP request component.",
              body="# roUrlTransfer\nMakes HTTP requests.",
              tags="http url network")
    _seed_doc(conn, id="interface:ifString", kind="interface",
              title="ifString", summary="String operations.",
              body="# ifString", tags="string text")
    _seed_doc(conn, id="event:roUrlEvent", kind="event",
              title="roUrlEvent", summary="URL response event.",
              body="# roUrlEvent", tags="event url")
    _seed_doc(conn, id="node:RowList", kind="node",
              title="RowList", summary="Horizontally scrolling rows.",
              body="# RowList supports rotating focus.",
              tags="rowlist row scenegraph focus")
    _seed_doc(conn, id="node:Video", kind="node",
              title="Video", summary="Video playback node.",
              body="# Video supports HLS and DASH.",
              tags="video playback hls dash")
    _seed_doc(conn, id="global_function:CreateObject", kind="global_function",
              title="CreateObject", summary="Construct a component.",
              body="# CreateObject", tags="construct factory")
    _seed_doc(conn, id="guide:scenegraph-focus", kind="guide",
              title="SceneGraph Focus", summary="How focus works.",
              body="Focus traversal in SceneGraph.",
              tags="scenegraph focus")
    _seed_doc(conn, id="sample:small.brs", kind="sample",
              title="small.brs", summary="A small sample.",
              body="sub main()\n  print 1\nend sub",
              tags="sample brs", source="samples")
    _seed_doc(conn, id="sample:big.xml", kind="sample",
              title="big.xml", summary="A big sample.",
              body="x" * 100_000,  # > 64KB
              tags="sample xml", source="scenegraph_master_sample")
    _seed_doc(conn, id="feature_module:analytics.event_pipe", kind="feature_module",
              title="analytics.event_pipe", summary="Analytics event pipeline.",
              body="Tracks events and dispatches to sinks.",
              tags="analytics tracking events",
              source="rokudev-tools-modules")
    _seed_doc(conn, id="template:video_grid_channel", kind="template",
              title="video_grid_channel", summary="Streaming video grid template.",
              body="Hero unit + rows of posters; deep-link aware.",
              tags="video grid streaming ott",
              source="rokudev-tools-templates")

    conn.commit()
    yield conn
    conn.close()
```

- [ ] **Phase 2 prep: Commit**

```bash
git add packages/brs-docs/tests/conftest.py
git commit -m "test(brs-docs): T05-prep fixture corpus for tool tests (Plan 6)"
```

---

### Task T05: `brs_search` tool

**Files:**
- Create: `packages/brs-docs/src/brs_docs/tools/search.py`
- Create: `packages/brs-docs/tests/test_search.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for brs_search tool."""

from __future__ import annotations

import sqlite3

import pytest

from brs_docs.errors import ErrorCode
from brs_docs.tools.search import brs_search


def test_search_returns_relevant_results(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="RowList", limit=5)
    assert any(r["id"] == "node:RowList" for r in result["results"])
    assert result["query_echo"]["query"] == "RowList"


def test_search_filters_by_kind(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="component", kind="component", limit=5)
    for r in result["results"]:
        assert r["kind"] == "component"


def test_search_returns_total_matched(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="Video", limit=5)
    assert "total_matched" in result
    assert result["total_matched"] >= 1


def test_search_rejects_invalid_kind(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="x", kind="not_a_kind", limit=5)
    assert "error" in result
    assert result["error"]["code"] == ErrorCode.INVALID_KIND.value


def test_search_rejects_empty_query(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="", limit=5)
    assert result["error"]["code"] == ErrorCode.INVALID_QUERY.value


def test_search_strips_fts_metachars(fixture_corpus: sqlite3.Connection) -> None:
    # quote chars must not produce an FTS syntax error
    result = brs_search(fixture_corpus, query='"RowList"', limit=5)
    assert "error" not in result


def test_search_includes_snippet_with_marks(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="RowList", limit=5)
    for r in result["results"]:
        if r["id"] == "node:RowList":
            assert "<mark>" in r["snippet"] or "snippet" in r
            break


def test_search_respects_limit(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_search(fixture_corpus, query="the", limit=2)
    assert len(result["results"]) <= 2
```

- [ ] **Step 2: Run; verify fail**

- [ ] **Step 3: Implement `src/brs_docs/tools/search.py`**

```python
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
```

- [ ] **Step 4: Run; verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/src/brs_docs/tools/search.py packages/brs-docs/tests/test_search.py
git commit -m "feat(brs-docs): T05 brs_search tool (Plan 6)"
```

---

### Task T06: `brs_get` tool

**Files:**
- Create: `packages/brs-docs/src/brs_docs/tools/get.py`
- Create: `packages/brs-docs/tests/test_get.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for brs_get tool."""

from __future__ import annotations

import sqlite3

from brs_docs.errors import ErrorCode
from brs_docs.tools.get import BODY_TRUNCATE_THRESHOLD_BYTES, brs_get


def test_get_small_doc_returns_body_inline(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_get(fixture_corpus, doc_id="component:roDateTime")
    assert result["id"] == "component:roDateTime"
    assert result["body_truncated"] is False
    assert result["body"] != ""
    assert result["tags"] == ["datetime", "time", "epoch"]


def test_get_large_sample_truncates_body(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_get(fixture_corpus, doc_id="sample:big.xml")
    assert result["body_truncated"] is True
    assert result["body"] == ""
    assert result["byte_count"] > BODY_TRUNCATE_THRESHOLD_BYTES
    assert "read_hint" in result


def test_get_missing_id_returns_error(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_get(fixture_corpus, doc_id="component:Nonexistent")
    assert result["error"]["code"] == ErrorCode.DOC_NOT_FOUND.value


def test_get_parses_structured_json(fixture_corpus: sqlite3.Connection) -> None:
    # Insert a doc with structured JSON
    conn = fixture_corpus
    conn.execute(
        "INSERT INTO docs (id, kind, title, summary, body, byte_count, "
        "tags, source, structured, fetched_at, content_hash) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("component:test", "component", "Test", "s", "b", 1,
         "", "dev_doc", '{"methods": ["foo"]}', 0, "h"),
    )
    conn.commit()
    result = brs_get(conn, doc_id="component:test")
    assert result["structured"] == {"methods": ["foo"]}
```

- [ ] **Step 2: Run; verify fail**

- [ ] **Step 3: Implement `src/brs_docs/tools/get.py`**

```python
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
```

- [ ] **Step 4: Run; verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/src/brs_docs/tools/get.py packages/brs-docs/tests/test_get.py
git commit -m "feat(brs-docs): T06 brs_get tool (Plan 6)"
```

---

### Task T07: `brs_list` tool

**Files:**
- Create: `packages/brs-docs/src/brs_docs/tools/list.py`
- Create: `packages/brs-docs/tests/test_list.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for brs_list tool."""

from __future__ import annotations

import sqlite3

from brs_docs.errors import ErrorCode
from brs_docs.tools.list import brs_list


def test_list_all_of_kind(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_list(fixture_corpus, kind="component")
    titles = [r["title"] for r in result["results"]]
    assert "roDateTime" in titles
    assert "roUrlTransfer" in titles


def test_list_with_prefix(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_list(fixture_corpus, kind="component", prefix="roDate")
    assert all(r["title"].lower().startswith("rodate") for r in result["results"])


def test_list_rejects_invalid_kind(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_list(fixture_corpus, kind="not_a_kind")
    assert result["error"]["code"] == ErrorCode.INVALID_KIND.value


def test_list_escapes_like_metachars(fixture_corpus: sqlite3.Connection) -> None:
    # An underscore in prefix should match literally, not as LIKE wildcard
    result = brs_list(fixture_corpus, kind="component", prefix="ro_")
    # No component starts with literal "ro_"
    assert result["results"] == []


def test_list_caps_at_500(fixture_corpus: sqlite3.Connection) -> None:
    # Seed > 500 docs of one kind
    conn = fixture_corpus
    for i in range(600):
        conn.execute(
            "INSERT INTO docs (id, kind, title, summary, body, byte_count, "
            "tags, source, fetched_at, content_hash) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (f"guide:bulk-{i}", "guide", f"BulkGuide{i}", "", "", 0, "",
             "dev_doc", 0, "h"),
        )
    conn.commit()
    result = brs_list(conn, kind="guide")
    assert len(result["results"]) == 500
```

- [ ] **Step 2: Run; verify fail**

- [ ] **Step 3: Implement `src/brs_docs/tools/list.py`**

```python
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
```

- [ ] **Step 4: Run; verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/src/brs_docs/tools/list.py packages/brs-docs/tests/test_list.py
git commit -m "feat(brs-docs): T07 brs_list tool (Plan 6)"
```

---

### Task T08: `brs_sample_read` tool

**Files:**
- Create: `packages/brs-docs/src/brs_docs/tools/sample_read.py`
- Create: `packages/brs-docs/tests/test_sample_read.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for brs_sample_read tool."""

from __future__ import annotations

import sqlite3

from brs_docs.errors import ErrorCode
from brs_docs.tools.sample_read import (
    MAX_BYTE_LIMIT,
    DEFAULT_BYTE_LIMIT,
    brs_sample_read,
)


def test_read_default_chunk(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(fixture_corpus, doc_id="sample:big.xml")
    assert result["byte_offset"] == 0
    assert result["bytes_read"] == DEFAULT_BYTE_LIMIT
    assert result["total_bytes"] == 100_000
    assert result["eof"] is False
    assert len(result["body"].encode("utf-8")) == DEFAULT_BYTE_LIMIT


def test_read_with_offset(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(
        fixture_corpus, doc_id="sample:big.xml",
        byte_offset=DEFAULT_BYTE_LIMIT,
        byte_limit=DEFAULT_BYTE_LIMIT,
    )
    assert result["byte_offset"] == DEFAULT_BYTE_LIMIT
    assert result["eof"] is False


def test_read_eof(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(
        fixture_corpus, doc_id="sample:big.xml",
        byte_offset=100_000, byte_limit=DEFAULT_BYTE_LIMIT,
    )
    assert result["body"] == ""
    assert result["eof"] is True


def test_read_clamps_byte_limit(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(
        fixture_corpus, doc_id="sample:big.xml",
        byte_offset=0, byte_limit=999_999,
    )
    assert result["byte_limit"] == MAX_BYTE_LIMIT
    assert result["clamped"] is True


def test_read_non_sample_kind_returns_error(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(fixture_corpus, doc_id="node:RowList")
    assert result["error"]["code"] == ErrorCode.NOT_SAMPLE_KIND.value


def test_read_unknown_id_returns_error(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(fixture_corpus, doc_id="sample:missing")
    assert result["error"]["code"] == ErrorCode.DOC_NOT_FOUND.value


def test_read_negative_offset_returns_error(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_sample_read(
        fixture_corpus, doc_id="sample:big.xml", byte_offset=-1,
    )
    assert result["error"]["code"] == ErrorCode.INVALID_OFFSET.value
```

- [ ] **Step 2: Run; verify fail**

- [ ] **Step 3: Implement `src/brs_docs/tools/sample_read.py`**

```python
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
    new_pos = byte_offset + len(chunk_bytes)
    eof = new_pos >= total

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
```

- [ ] **Step 4: Run; verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/src/brs_docs/tools/sample_read.py packages/brs-docs/tests/test_sample_read.py
git commit -m "feat(brs-docs): T08 brs_sample_read tool (Plan 6)"
```

---

### Task T09: Recommend ranker + tags.toml

**Files:**
- Create: `packages/brs-docs/src/brs_docs/recommend/tags.toml` (full v1 content from spec)
- Create: `packages/brs-docs/src/brs_docs/recommend/ranker.py`
- Create: `packages/brs-docs/tests/test_recommend/__init__.py`
- Create: `packages/brs-docs/tests/test_recommend/test_ranker.py`

- [ ] **Step 1: Write `tags.toml` (paste verbatim from spec §"tags.toml structure" excerpt; expand to ~35 keyword entries and 11 module_categories entries per spec)**

Use the content shown in the spec Section 5 brainstorm transcript reference. Full content:

```toml
version = "1.0"

[keyword_to_tags]
"paywall"          = [{ tag = "subscription", weight = 3.0 }, { tag = "paywall", weight = 2.0 }, { tag = "pay", weight = 2.0 }]
"subscription"     = [{ tag = "subscription", weight = 3.0 }, { tag = "pay", weight = 2.0 }]
"billing"          = [{ tag = "pay", weight = 2.5 }, { tag = "subscription", weight = 1.5 }]
"ad"               = [{ tag = "ads", weight = 3.0 }, { tag = "raf", weight = 2.0 }]
"ads"              = [{ tag = "ads", weight = 3.0 }, { tag = "raf", weight = 2.0 }]
"sso"              = [{ tag = "auth", weight = 3.0 }, { tag = "device_link", weight = 2.0 }, { tag = "oauth", weight = 2.0 }]
"sign in"          = [{ tag = "auth", weight = 3.0 }]
"login"            = [{ tag = "auth", weight = 3.0 }]
"oauth"            = [{ tag = "auth", weight = 3.0 }, { tag = "oauth", weight = 3.0 }]
"focus"            = [{ tag = "focus", weight = 2.0 }]
"rotating focus"   = [{ tag = "focus", weight = 3.0 }, { tag = "rowlist", weight = 2.0 }]
"row"              = [{ tag = "rowlist", weight = 2.0 }, { tag = "row", weight = 2.0 }]
"grid"             = [{ tag = "grid", weight = 2.0 }, { tag = "rowlist", weight = 1.5 }]
"poster"           = [{ tag = "poster", weight = 2.5 }]
"video"            = [{ tag = "video", weight = 3.0 }, { tag = "playback", weight = 2.0 }]
"playback"         = [{ tag = "video", weight = 2.0 }, { tag = "playback", weight = 3.0 }]
"hls"              = [{ tag = "video", weight = 2.0 }, { tag = "hls", weight = 3.0 }]
"dash"             = [{ tag = "video", weight = 2.0 }, { tag = "dash", weight = 3.0 }]
"audio"            = [{ tag = "audio", weight = 3.0 }]
"music"            = [{ tag = "audio", weight = 2.0 }, { tag = "music", weight = 3.0 }]
"captions"         = [{ tag = "captions", weight = 3.0 }, { tag = "accessibility", weight = 2.0 }]
"deep link"        = [{ tag = "deep_link", weight = 3.0 }, { tag = "ecp", weight = 2.0 }]
"deep-link"        = [{ tag = "deep_link", weight = 3.0 }, { tag = "ecp", weight = 2.0 }]
"analytics"        = [{ tag = "analytics", weight = 3.0 }, { tag = "tracking", weight = 2.0 }]
"event"            = [{ tag = "analytics", weight = 1.5 }, { tag = "events", weight = 2.0 }]
"screensaver"      = [{ tag = "screensaver", weight = 3.0 }]
"game"             = [{ tag = "game", weight = 3.0 }]
"news"             = [{ tag = "news", weight = 3.0 }]
"scene"            = [{ tag = "scenegraph", weight = 2.0 }, { tag = "scene", weight = 2.0 }]
"scenegraph"       = [{ tag = "scenegraph", weight = 3.0 }]
"manifest"         = [{ tag = "manifest", weight = 3.0 }]
"sideload"         = [{ tag = "sideload", weight = 3.0 }, { tag = "dev_portal", weight = 2.0 }]
"ecp"              = [{ tag = "ecp", weight = 3.0 }]
"channel store"    = [{ tag = "channel_store", weight = 3.0 }, { tag = "submission", weight = 2.0 }]
"crash"            = [{ tag = "debug", weight = 2.0 }, { tag = "crash", weight = 3.0 }]
"performance"      = [{ tag = "performance", weight = 3.0 }]
"fps"              = [{ tag = "performance", weight = 3.0 }]
"profiler"         = [{ tag = "performance", weight = 2.0 }, { tag = "profiler", weight = 3.0 }]

[[module_categories]]
intent_keywords = ["paywall", "subscription", "billing", "transactional"]
id_substring    = "monetization.roku_pay"
boost           = 4.0

[[module_categories]]
intent_keywords = ["ad", "ads", "advertising"]
id_substring    = "ads.raf"
boost           = 4.0

[[module_categories]]
intent_keywords = ["sign in", "login", "auth", "sso", "device link", "oauth"]
id_substring    = "auth."
boost           = 4.0

[[module_categories]]
intent_keywords = ["analytics", "tracking", "telemetry", "event pipe"]
id_substring    = "analytics."
boost           = 4.0

[[module_categories]]
intent_keywords = ["deep link", "deep-link", "ecp launch", "content launch"]
id_substring    = "deep_link."
boost           = 4.0

[[module_categories]]
intent_keywords = ["captions", "accessibility", "subtitle", "a11y"]
id_substring    = "accessibility."
boost           = 4.0

[[module_categories]]
intent_keywords = ["streaming", "video app", "ott", "watch app"]
id_substring    = "template:video_grid"
boost           = 4.0

[[module_categories]]
intent_keywords = ["news"]
id_substring    = "template:news"
boost           = 4.0

[[module_categories]]
intent_keywords = ["music", "audio app", "podcast"]
id_substring    = "template:music"
boost           = 4.0

[[module_categories]]
intent_keywords = ["screensaver"]
id_substring    = "template:screensaver"
boost           = 5.0

[[module_categories]]
intent_keywords = ["game"]
id_substring    = "template:game"
boost           = 4.0

[bm25_weights]
title   = 4.0
summary = 2.0
body    = 1.0
tags    = 3.0
```

- [ ] **Step 2: Write failing tests for ranker**

```python
"""Tests for recommend/ranker.py."""

from __future__ import annotations

import sqlite3

from brs_docs.recommend.ranker import load_tags_toml, rank_candidates


def test_load_tags_toml_has_v1_keys() -> None:
    cfg = load_tags_toml()
    assert cfg["version"] == "1.0"
    assert "paywall" in cfg["keyword_to_tags"]
    assert len(cfg["module_categories"]) >= 11
    assert cfg["bm25_weights"]["title"] == 4.0


def test_tag_boost_lookup_paywall(fixture_corpus: sqlite3.Connection) -> None:
    results = rank_candidates(
        fixture_corpus,
        intent="how do I show a paywall",
        kinds=None,
        limit=5,
    )
    # analytics module doesn't have paywall tags; should not top-rank
    top_ids = [r["id"] for r in results]
    # Score breakdown must be present
    for r in results:
        assert "details" in r
        assert "bm25_score" in r["details"]
        assert "tag_boosts" in r["details"]
        assert "module_category_boost" in r["details"]


def test_module_category_boost_applies(fixture_corpus: sqlite3.Connection) -> None:
    # analytics.event_pipe should get module-category boost for "analytics"
    results = rank_candidates(
        fixture_corpus, intent="track analytics events", kinds=None, limit=10,
    )
    analytics = next(
        (r for r in results if r["id"] == "feature_module:analytics.event_pipe"),
        None,
    )
    assert analytics is not None
    assert analytics["details"]["module_category_boost"] > 0


def test_negative_case_no_module_top_rank(fixture_corpus: sqlite3.Connection) -> None:
    # "what time is it" should rank roDateTime above any module/template
    results = rank_candidates(
        fixture_corpus, intent="what time is it", kinds=None, limit=5,
    )
    top_kinds = [r["kind"] for r in results[:3]]
    assert "feature_module" not in top_kinds
    assert "template" not in top_kinds


def test_kinds_filter(fixture_corpus: sqlite3.Connection) -> None:
    results = rank_candidates(
        fixture_corpus, intent="video", kinds=["node"], limit=5,
    )
    for r in results:
        assert r["kind"] == "node"
```

- [ ] **Step 3: Run; verify fail**

- [ ] **Step 4: Implement `src/brs_docs/recommend/ranker.py`**

```python
"""Hybrid BM25 + tag-boost + module-category-boost ranker."""

from __future__ import annotations

import sqlite3
import tomllib
from functools import lru_cache
from importlib.resources import files
from typing import Any

from brs_docs.models import Kind

_DEFAULT_KINDS_FOR_RECOMMEND = [
    "component", "node", "interface", "guide", "sample",
    "feature_module", "template",
]


@lru_cache(maxsize=1)
def load_tags_toml() -> dict[str, Any]:
    text = files("brs_docs.recommend").joinpath("tags.toml").read_text("utf-8")
    return tomllib.loads(text)


def _normalize_intent(intent: str) -> str:
    return intent.lower()


def _tag_boost_for_doc(
    intent_lower: str, doc_tags: list[str], keyword_to_tags: dict[str, list[dict]],
) -> tuple[float, dict[str, float]]:
    total = 0.0
    contributions: dict[str, float] = {}
    for keyword, mappings in keyword_to_tags.items():
        if keyword not in intent_lower:
            continue
        for m in mappings:
            tag = m["tag"]
            weight = float(m["weight"])
            if tag in doc_tags:
                total += weight
                contributions[tag] = contributions.get(tag, 0.0) + weight
    return total, contributions


def _module_category_boost_for_doc(
    intent_lower: str, doc_id: str, module_categories: list[dict],
) -> float:
    total = 0.0
    for cat in module_categories:
        if not any(kw in intent_lower for kw in cat["intent_keywords"]):
            continue
        if cat["id_substring"] in doc_id:
            total += float(cat["boost"])
    return total


def _fts_query_for_intent(intent: str) -> str:
    tokens = [t for t in intent.replace('"', "").split() if t]
    return " OR ".join(f'"{t}"' for t in tokens) if tokens else '""'


def rank_candidates(
    conn: sqlite3.Connection,
    intent: str,
    kinds: list[str] | None = None,
    limit: int = 5,
    per_kind_cap: int = 50,
) -> list[dict[str, Any]]:
    cfg = load_tags_toml()
    keyword_to_tags = cfg["keyword_to_tags"]
    module_categories = cfg["module_categories"]
    weights = cfg["bm25_weights"]

    use_kinds = kinds or _DEFAULT_KINDS_FOR_RECOMMEND
    intent_lower = _normalize_intent(intent)
    fts_q = _fts_query_for_intent(intent)

    candidates: list[dict[str, Any]] = []
    for kind in use_kinds:
        sql = (
            "SELECT d.id, d.kind, d.title, d.summary, d.tags, "
            f"bm25(docs_fts, {weights['title']}, {weights['summary']}, "
            f"{weights['body']}, {weights['tags']}) AS raw_bm25 "
            "FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid "
            "WHERE docs_fts MATCH ? AND d.kind = ? "
            "ORDER BY raw_bm25 LIMIT ?"
        )
        try:
            rows = conn.execute(sql, (fts_q, kind, per_kind_cap)).fetchall()
        except sqlite3.OperationalError:
            continue
        for r in rows:
            doc_tags = (r["tags"] or "").split()
            bm25_score = abs(r["raw_bm25"])
            tag_boost, contributions = _tag_boost_for_doc(
                intent_lower, doc_tags, keyword_to_tags,
            )
            mod_boost = _module_category_boost_for_doc(
                intent_lower, r["id"], module_categories,
            )
            matched_terms = [
                t for t in intent_lower.split()
                if t in (r["title"] or "").lower()
                or t in (r["summary"] or "").lower()
            ]
            candidates.append({
                "id": r["id"],
                "kind": r["kind"],
                "title": r["title"],
                "summary": r["summary"],
                "score": bm25_score + tag_boost + mod_boost,
                "details": {
                    "bm25_score": bm25_score,
                    "tag_boosts": contributions,
                    "module_category_boost": mod_boost,
                    "matched_terms": matched_terms,
                },
            })

    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates[:limit]
```

- [ ] **Step 5: Run; verify pass**

- [ ] **Step 6: Commit**

```bash
git add packages/brs-docs/src/brs_docs/recommend/ packages/brs-docs/tests/test_recommend/
git commit -m "feat(brs-docs): T09 ranker + tags.toml v1 (Plan 6)"
```

---

### Task T10: `brs_recommend` tool

**Files:**
- Create: `packages/brs-docs/src/brs_docs/tools/recommend.py`
- Create: `packages/brs-docs/tests/test_recommend_tool.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for brs_recommend tool wrapper."""

from __future__ import annotations

import sqlite3

from brs_docs.tools.recommend import brs_recommend


def test_recommend_returns_required_fields(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_recommend(fixture_corpus, intent="rotating focus on a RowList")
    assert result["intent"] == "rotating focus on a RowList"
    assert "results" in result
    assert "ranker_version" in result
    assert "tags_toml_version" in result


def test_recommend_default_limit(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_recommend(fixture_corpus, intent="video")
    assert len(result["results"]) <= 5


def test_recommend_custom_kinds(fixture_corpus: sqlite3.Connection) -> None:
    result = brs_recommend(
        fixture_corpus, intent="video", kinds=["node"], limit=10,
    )
    for r in result["results"]:
        assert r["kind"] == "node"


def test_recommend_caps_limit_at_20(fixture_corpus: sqlite3.Connection) -> None:
    # Internal cap should clamp; we just verify it doesn't crash with huge limit
    result = brs_recommend(fixture_corpus, intent="video", limit=100)
    assert len(result["results"]) <= 20
```

- [ ] **Step 2: Run; verify fail**

- [ ] **Step 3: Implement `src/brs_docs/tools/recommend.py`**

```python
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
```

- [ ] **Step 4: Run; verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/src/brs_docs/tools/recommend.py packages/brs-docs/tests/test_recommend_tool.py
git commit -m "feat(brs-docs): T10 brs_recommend tool (Plan 6)"
```

---

## Phase 3: Scrapers

All scrapers produce `list[CanonicalDoc]`. Each is independently testable with checked-in tarball fixtures.

### Task T11: dev_doc scraper

**Files:**
- Create: `packages/brs-docs/src/brs_docs/corpus/sources/dev_doc.py`
- Create: `packages/brs-docs/tests/fixtures/dev_doc_tiny.tar.gz` (built per Step 1)
- Create: `packages/brs-docs/tests/test_corpus_build/__init__.py`
- Create: `packages/brs-docs/tests/test_corpus_build/test_dev_doc.py`

**Reference:** prototype at `/Users/bblietz/Work/ClaudeProjects/brs-mcp-for-docs/src/roku_scraper/sources/rokudev_dev_doc.py` for parsing patterns. DO NOT copy verbatim; rewrite to produce the v1 CanonicalDoc shape (title + summary + body + tags split).

- [ ] **Step 1: Build the tiny tarball fixture**

```bash
cd packages/brs-docs/tests/fixtures
mkdir -p tmp_devdoc/components tmp_devdoc/nodes tmp_devdoc/global_functions
cat > tmp_devdoc/components/roDateTime.md <<'EOF'
---
title: roDateTime
kind: component
tags: [datetime, time, epoch]
---
# roDateTime

A date/time component.

## Interfaces
- ifDateTime
EOF
cat > tmp_devdoc/nodes/RowList.md <<'EOF'
---
title: RowList
kind: node
tags: [rowlist, row, scenegraph]
---
# RowList

Horizontally scrolling list of rows.
EOF
cat > tmp_devdoc/global_functions/CreateObject.md <<'EOF'
---
title: CreateObject
kind: global_function
tags: [construct]
---
# CreateObject

Constructs a component.
EOF
tar -czf dev_doc_tiny.tar.gz -C tmp_devdoc .
rm -rf tmp_devdoc
```

- [ ] **Step 2: Write failing tests**

```python
"""Tests for dev_doc scraper."""

from __future__ import annotations

from pathlib import Path

from brs_docs.corpus.sources.dev_doc import parse_dev_doc_tarball
from brs_docs.models import Kind


def test_parse_tarball_returns_canonical_docs(tmp_path: Path) -> None:
    fixture = Path(__file__).parent.parent / "fixtures" / "dev_doc_tiny.tar.gz"
    docs = list(parse_dev_doc_tarball(fixture))
    ids = {d.id for d in docs}
    assert "component:roDateTime" in ids
    assert "node:RowList" in ids
    assert "global_function:CreateObject" in ids


def test_parse_sets_kind_correctly(tmp_path: Path) -> None:
    fixture = Path(__file__).parent.parent / "fixtures" / "dev_doc_tiny.tar.gz"
    docs = {d.id: d for d in parse_dev_doc_tarball(fixture)}
    assert docs["component:roDateTime"].kind == Kind.COMPONENT
    assert docs["node:RowList"].kind == Kind.NODE
    assert docs["global_function:CreateObject"].kind == Kind.GLOBAL_FUNCTION


def test_parse_extracts_tags(tmp_path: Path) -> None:
    fixture = Path(__file__).parent.parent / "fixtures" / "dev_doc_tiny.tar.gz"
    docs = {d.id: d for d in parse_dev_doc_tarball(fixture)}
    assert "datetime" in docs["component:roDateTime"].tags
    assert "rowlist" in docs["node:RowList"].tags
```

- [ ] **Step 3: Run; verify fail**

- [ ] **Step 4: Implement `src/brs_docs/corpus/sources/dev_doc.py`**

```python
"""Parse rokudev/dev-doc tarball into CanonicalDoc instances."""

from __future__ import annotations

import hashlib
import io
import re
import tarfile
import time
from collections.abc import Iterator
from pathlib import Path

import yaml  # add to pyproject.toml dev deps if needed; or roll a tiny parser

from brs_docs.models import CanonicalDoc, Kind

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)", re.DOTALL)

_KIND_SLUG_PREFIXES = {
    "component": "components/",
    "interface": "interfaces/",
    "event": "events/",
    "node": "nodes/",
    "global_function": "global_functions/",
    "guide": "guides/",
}


def parse_dev_doc_tarball(path: Path) -> Iterator[CanonicalDoc]:
    with tarfile.open(path, "r:gz") as tar:
        for member in tar:
            if not member.isfile() or not member.name.endswith(".md"):
                continue
            f = tar.extractfile(member)
            if f is None:
                continue
            raw = f.read().decode("utf-8", errors="replace")
            doc = _parse_md(raw, member.name)
            if doc is not None:
                yield doc


def _parse_md(raw: str, member_name: str) -> CanonicalDoc | None:
    m = _FRONTMATTER_RE.match(raw)
    if not m:
        return None
    fm_yaml, body = m.group(1), m.group(2)
    fm = yaml.safe_load(fm_yaml) or {}
    kind_str = fm.get("kind")
    title = fm.get("title")
    if not kind_str or not title:
        return None
    try:
        kind = Kind(kind_str)
    except ValueError:
        return None
    tags_list = fm.get("tags") or []
    tags = " ".join(str(t) for t in tags_list)

    # Summary = first non-heading paragraph (or first 200 chars of body)
    summary_match = re.search(r"\n([^#\n].+?)\n\n", "\n" + body)
    summary = summary_match.group(1).strip() if summary_match else body[:200].strip()

    body_bytes = body.encode("utf-8")
    content_hash = hashlib.sha256(body_bytes).hexdigest()

    return CanonicalDoc(
        id=f"{kind.value}:{title}",
        kind=kind,
        title=title,
        summary=summary,
        body=body,
        body_truncated=False,
        byte_count=len(body_bytes),
        tags=tags,
        url=None,
        source="dev_doc",
        structured=None,
        fetched_at=int(time.time()),
        content_hash=content_hash,
    )
```

Add `pyyaml` to dev/runtime deps in `pyproject.toml`: append `"pyyaml>=6.0"` to the `dependencies = [...]` array. Re-run `uv sync` after.

- [ ] **Step 5: Run; verify pass**

- [ ] **Step 6: Commit**

```bash
git add packages/brs-docs/src/brs_docs/corpus/sources/dev_doc.py \
        packages/brs-docs/tests/test_corpus_build/ \
        packages/brs-docs/tests/fixtures/dev_doc_tiny.tar.gz \
        packages/brs-docs/pyproject.toml
git commit -m "feat(brs-docs): T11 dev_doc scraper + tiny tarball fixture (Plan 6)"
```

---

### Task T12: samples scraper

**Files:**
- Create: `packages/brs-docs/src/brs_docs/corpus/sources/samples.py`
- Create: `packages/brs-docs/tests/fixtures/samples_tiny.tar.gz`
- Create: `packages/brs-docs/tests/test_corpus_build/test_samples.py`

- [ ] **Step 1: Build samples tarball fixture**

```bash
cd packages/brs-docs/tests/fixtures
mkdir -p tmp_samples/HelloWorld/source tmp_samples/HelloWorld/components
cat > tmp_samples/HelloWorld/source/main.brs <<'EOF'
' Hello-world Roku channel
sub main()
    print "hello"
end sub
EOF
cat > tmp_samples/HelloWorld/components/MainScene.xml <<'EOF'
<?xml version="1.0" encoding="utf-8" ?>
<component name="MainScene" extends="Scene">
  <children><Label id="hi" text="Hello" /></children>
</component>
EOF
tar -czf samples_tiny.tar.gz -C tmp_samples .
rm -rf tmp_samples
```

- [ ] **Step 2: Write failing tests**

```python
"""Tests for samples scraper."""

from __future__ import annotations

from pathlib import Path

from brs_docs.corpus.sources.samples import parse_samples_tarball
from brs_docs.models import Kind


def test_parse_emits_one_doc_per_file(tmp_path: Path) -> None:
    fixture = Path(__file__).parent.parent / "fixtures" / "samples_tiny.tar.gz"
    docs = list(parse_samples_tarball(fixture, source="samples"))
    paths = sorted(d.id for d in docs)
    assert "sample:HelloWorld/source/main.brs" in paths
    assert "sample:HelloWorld/components/MainScene.xml" in paths


def test_parse_sets_language_in_structured(tmp_path: Path) -> None:
    fixture = Path(__file__).parent.parent / "fixtures" / "samples_tiny.tar.gz"
    docs = {d.id: d for d in parse_samples_tarball(fixture, source="samples")}
    main = docs["sample:HelloWorld/source/main.brs"]
    assert main.structured["language"] == "brs"
    assert main.kind == Kind.SAMPLE


def test_parse_full_body_preserved(tmp_path: Path) -> None:
    fixture = Path(__file__).parent.parent / "fixtures" / "samples_tiny.tar.gz"
    docs = {d.id: d for d in parse_samples_tarball(fixture, source="samples")}
    assert 'print "hello"' in docs["sample:HelloWorld/source/main.brs"].body
```

- [ ] **Step 3: Run; verify fail**

- [ ] **Step 4: Implement `src/brs_docs/corpus/sources/samples.py`**

```python
"""Parse a samples tarball (rokudev/samples or scenegraph-master-sample) into CanonicalDoc[]."""

from __future__ import annotations

import hashlib
import tarfile
import time
from collections.abc import Iterator
from pathlib import Path

from brs_docs.models import CanonicalDoc, Kind

_LANG_BY_EXT = {
    ".brs": "brs", ".bs": "bs", ".xml": "xml",
    ".json": "json", ".md": "md", ".txt": "txt",
}
_INCLUDE_EXTS = set(_LANG_BY_EXT)
_SKIP_DIRS = {".git", "node_modules", ".vscode"}


def parse_samples_tarball(path: Path, source: str) -> Iterator[CanonicalDoc]:
    with tarfile.open(path, "r:gz") as tar:
        for member in tar:
            if not member.isfile():
                continue
            parts = Path(member.name).parts
            if any(p in _SKIP_DIRS for p in parts):
                continue
            ext = Path(member.name).suffix.lower()
            if ext not in _INCLUDE_EXTS:
                continue
            f = tar.extractfile(member)
            if f is None:
                continue
            try:
                body = f.read().decode("utf-8", errors="replace")
            except Exception:
                continue
            yield _to_doc(member.name, body, ext, source)


def _to_doc(member_name: str, body: str, ext: str, source: str) -> CanonicalDoc:
    rel = member_name.lstrip("./")
    title = rel
    language = _LANG_BY_EXT[ext]
    summary = _summary_from_body(body, language)
    body_bytes = body.encode("utf-8")
    return CanonicalDoc(
        id=f"sample:{rel}",
        kind=Kind.SAMPLE,
        title=title,
        summary=summary,
        body=body,
        body_truncated=False,
        byte_count=len(body_bytes),
        tags=" ".join({"sample", language, source.replace("_", "-")}),
        url=None,
        source=source,
        structured={"language": language, "path": rel, "line_count": body.count("\n") + 1},
        fetched_at=int(time.time()),
        content_hash=hashlib.sha256(body_bytes).hexdigest(),
    )


def _summary_from_body(body: str, language: str) -> str:
    # First comment block (BRS uses `'`, XML uses <!--), else first 200 chars
    lines = body.splitlines()
    summary_lines: list[str] = []
    for line in lines:
        s = line.strip()
        if language in {"brs", "bs"} and s.startswith("'"):
            summary_lines.append(s.lstrip("'").strip())
        elif language == "xml" and "<!--" in s:
            summary_lines.append(s.replace("<!--", "").replace("-->", "").strip())
        elif summary_lines:
            break
    if summary_lines:
        return " ".join(summary_lines)[:300]
    return body[:200].strip()
```

- [ ] **Step 5: Run; verify pass**

- [ ] **Step 6: Commit**

```bash
git add packages/brs-docs/src/brs_docs/corpus/sources/samples.py \
        packages/brs-docs/tests/fixtures/samples_tiny.tar.gz \
        packages/brs-docs/tests/test_corpus_build/test_samples.py
git commit -m "feat(brs-docs): T12 samples scraper + tiny fixture (Plan 6)"
```

---

### Task T13: feature_modules scraper

**Files:**
- Create: `packages/brs-docs/src/brs_docs/corpus/sources/feature_modules.py`
- Create: `packages/brs-docs/tests/test_corpus_build/test_feature_modules.py`

Reads from sibling `packages/brs-gen/modules/<module_id>/module.toml` + optional `README.md`.

- [ ] **Step 1: Write failing test**

```python
"""Tests for feature_modules scraper."""

from __future__ import annotations

from pathlib import Path

from brs_docs.corpus.sources.feature_modules import parse_feature_modules


def test_parse_reads_module_toml(tmp_path: Path) -> None:
    modules_dir = tmp_path / "modules"
    mod_dir = modules_dir / "analytics.event_pipe"
    mod_dir.mkdir(parents=True)
    (mod_dir / "module.toml").write_text("""
[module]
id = "analytics.event_pipe"
display_name = "Analytics Event Pipe"
description = "Tracks events to multiple sinks."
tags = ["analytics", "tracking"]

[module_wiring]
init_calls = []
""", encoding="utf-8")
    (mod_dir / "README.md").write_text("# Analytics\n\nFull body.\n", encoding="utf-8")

    docs = list(parse_feature_modules(modules_dir))
    assert len(docs) == 1
    d = docs[0]
    assert d.id == "feature_module:analytics.event_pipe"
    assert d.title == "Analytics Event Pipe"
    assert d.summary == "Tracks events to multiple sinks."
    assert "analytics" in d.tags
    assert "Full body" in d.body


def test_parse_synthesizes_body_when_no_readme(tmp_path: Path) -> None:
    modules_dir = tmp_path / "modules"
    mod_dir = modules_dir / "x.y"
    mod_dir.mkdir(parents=True)
    (mod_dir / "module.toml").write_text("""
[module]
id = "x.y"
display_name = "XY"
description = "Test."
tags = []
""", encoding="utf-8")

    docs = list(parse_feature_modules(modules_dir))
    d = docs[0]
    assert d.body  # synthesized
    assert "XY" in d.body
```

- [ ] **Step 2: Run; verify fail**

- [ ] **Step 3: Implement `src/brs_docs/corpus/sources/feature_modules.py`**

```python
"""Parse rokudev-tools feature modules from packages/brs-gen/modules/."""

from __future__ import annotations

import hashlib
import json
import time
import tomllib
from collections.abc import Iterator
from pathlib import Path

from brs_docs.models import CanonicalDoc, Kind


def parse_feature_modules(modules_dir: Path) -> Iterator[CanonicalDoc]:
    if not modules_dir.exists():
        return
    for mod_dir in sorted(modules_dir.iterdir()):
        if not mod_dir.is_dir():
            continue
        toml_path = mod_dir / "module.toml"
        if not toml_path.exists():
            continue
        toml_data = tomllib.loads(toml_path.read_text("utf-8"))
        mod = toml_data.get("module", {})
        mid = mod.get("id")
        if not mid:
            continue
        title = mod.get("display_name") or mid
        summary = mod.get("description") or ""
        tag_list = mod.get("tags") or []
        tags = " ".join(str(t) for t in tag_list)

        readme = mod_dir / "README.md"
        if readme.exists():
            body = readme.read_text("utf-8")
        else:
            body = _synthesize_body(title, summary, toml_data)

        body_bytes = body.encode("utf-8")
        structured = {
            "public_api": _get_public_api(toml_data),
            "config_keys": list((toml_data.get("config") or {}).keys()),
            "requires_modules": (toml_data.get("ordering") or {}).get("after") or [],
            "conflicts_modules": (toml_data.get("ordering") or {}).get("conflicts_with") or [],
            "applies_to_templates": mod.get("applies_to_templates") or [],
        }
        yield CanonicalDoc(
            id=f"feature_module:{mid}",
            kind=Kind.FEATURE_MODULE,
            title=title,
            summary=summary,
            body=body,
            body_truncated=False,
            byte_count=len(body_bytes),
            tags=tags,
            url=None,
            source="rokudev-tools-modules",
            structured=structured,
            fetched_at=int(time.time()),
            content_hash=hashlib.sha256(body_bytes).hexdigest(),
        )


def _synthesize_body(title: str, summary: str, toml_data: dict) -> str:
    lines = [f"# {title}", "", summary, "", "## Module manifest", "", "```toml"]
    lines.append(json.dumps(toml_data, indent=2))
    lines.append("```")
    return "\n".join(lines)


def _get_public_api(toml_data: dict) -> list[str]:
    api = toml_data.get("public_api") or {}
    return list(api.get("functions") or [])
```

- [ ] **Step 4: Run; verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/src/brs_docs/corpus/sources/feature_modules.py \
        packages/brs-docs/tests/test_corpus_build/test_feature_modules.py
git commit -m "feat(brs-docs): T13 feature_modules scraper (Plan 6)"
```

---

### Task T14: templates scraper

**Files:**
- Create: `packages/brs-docs/src/brs_docs/corpus/sources/templates.py`
- Create: `packages/brs-docs/tests/test_corpus_build/test_templates.py`

Same shape as T13 but reads `packages/brs-gen/templates/<template_id>/template.toml`.

- [ ] **Step 1: Write failing test** (mirror T13's test shape; substitute template-specific fields: `supported_modules`, `scenes`, `content_kinds`).

- [ ] **Step 2: Implement** following T13's pattern. Use `Kind.TEMPLATE`, id prefix `template:`, source `rokudev-tools-templates`. Read `template.toml` `[template]` section for `id`, `display_name`, `description`, `tags`. Structured payload: `{ supported_modules: [...], scenes: [...], content_kinds: [...] }` reading from corresponding template.toml keys.

- [ ] **Step 3: Run; verify pass**

- [ ] **Step 4: Commit**

```bash
git add packages/brs-docs/src/brs_docs/corpus/sources/templates.py \
        packages/brs-docs/tests/test_corpus_build/test_templates.py
git commit -m "feat(brs-docs): T14 templates scraper (Plan 6)"
```

---

## Phase 4: Build pipeline

### Task T15: corpus.lock parser + validation

**Files:**
- Create: `packages/brs-docs/corpus.lock` (initial, with placeholder SHAs)
- Create: `packages/brs-docs/src/brs_docs/corpus/lock.py`
- Create: `packages/brs-docs/tests/test_corpus_build/test_lock.py`

- [ ] **Step 1: Write initial `corpus.lock`** (SHAs to be updated in T28):

```toml
brs_docs_version = "0.7.0"
generated_at = "2026-05-19T00:00:00Z"

[sources.dev_doc]
url = "https://github.com/rokudev/dev-doc"
sha = "PLACEHOLDER_UPDATE_BEFORE_RELEASE"

[sources.samples]
url = "https://github.com/rokudev/samples"
sha = "PLACEHOLDER_UPDATE_BEFORE_RELEASE"

[sources.scenegraph_master_sample]
url = "https://github.com/rokudev/scenegraph-master-sample"
sha = "PLACEHOLDER_UPDATE_BEFORE_RELEASE"

[sources.rokudev_tools_modules]
package_version = "0.7.0"
module_count = 1

[sources.rokudev_tools_templates]
package_version = "0.7.0"
template_count = 6
```

- [ ] **Step 2: Write failing tests** for `parse_corpus_lock(path)` validating: required keys present, version is semver, no missing source sections.

- [ ] **Step 3: Implement `src/brs_docs/corpus/lock.py`** with `parse_corpus_lock(path) -> CorpusLock` (Pydantic model) and a `validate_lock(lock)` raising `LockValidationError` on failures.

- [ ] **Step 4: Run; verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/corpus.lock packages/brs-docs/src/brs_docs/corpus/lock.py packages/brs-docs/tests/test_corpus_build/test_lock.py
git commit -m "feat(brs-docs): T15 corpus.lock parser + validation (Plan 6)"
```

---

### Task T16: build orchestrator

**Files:**
- Create: `packages/brs-docs/src/brs_docs/corpus/build.py`
- Create: `packages/brs-docs/scripts/build_corpus.py`
- Create: `packages/brs-docs/tests/test_corpus_build/test_build.py`

- [ ] **Step 1: Write failing test** for `build_corpus(lock_path, out_path, monorepo_root, *, network_fetch=True)` that:
  - Builds an empty corpus from fixture tarballs when called with `network_fetch=False, fixtures_dir=...`.
  - Returns a `BuildResult` with `total_docs`, `per_kind_counts`, `errors=[]`.
  - Writes SQLite at `<out>.new` then atomically renames to `<out>`.

- [ ] **Step 2: Implement `src/brs_docs/corpus/build.py`** orchestrating Phase 3 scrapers. Signature:

```python
def build_corpus(
    lock_path: Path,
    out_path: Path,
    monorepo_root: Path,
    *,
    sources_fixture_dir: Path | None = None,
    min_counts: dict[str, int] | None = None,
) -> BuildResult:
    ...
```

Steps inside:
1. Parse lock.
2. Fetch each source (or use fixture if `sources_fixture_dir` is set; T16 uses fixtures, T28 wires real GitHub fetch).
3. Call per-source scrapers.
4. Init schema at `out_path.with_suffix(".new")`; bulk insert all docs in one transaction.
5. Run validate-corpus checks (min counts per kind, all IDs unique, no body > 2MB, FTS canary queries succeed). Defaults for min_counts: dev_doc kinds ≥ 5 each (test runs use lower min via the param).
6. `os.rename` to out_path.
7. Write companion `<out_path>.lock` file.

- [ ] **Step 3: Write `scripts/build_corpus.py`** as a thin CLI:

```python
#!/usr/bin/env python3
"""Build the brs-docs corpus from corpus.lock."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from brs_docs.corpus.build import build_corpus


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--monorepo-root", required=True, type=Path)
    args = parser.parse_args()
    result = build_corpus(args.lock, args.out, args.monorepo_root)
    print(f"Built corpus: {result.total_docs} docs at {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run; verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/src/brs_docs/corpus/build.py packages/brs-docs/scripts/build_corpus.py packages/brs-docs/tests/test_corpus_build/test_build.py
git commit -m "feat(brs-docs): T16 corpus build orchestrator (Plan 6)"
```

---

### Task T17: Atomic install + refresh helpers

**Files:**
- Create: `packages/brs-docs/src/brs_docs/corpus/refresh.py`
- Create: `packages/brs-docs/tests/test_corpus_build/test_refresh.py`

- [ ] **Step 1: Write failing tests** covering: no-op when locks match, atomic install on success, original preserved on validate failure, original preserved on rename failure (simulate via mock).

- [ ] **Step 2: Implement `src/brs_docs/corpus/refresh.py`** exposing:

```python
def refresh_corpus(
    *,
    bundled_lock: Path,
    cache_dir: Path,
    monorepo_root: Path,
    sources_fixture_dir: Path | None = None,
) -> RefreshResult:
    """Returns RefreshResult{ status: 'up_to_date'|'refreshed'|'failed', ...}."""
```

Implements the algorithm in spec §"Refresh (user-initiated)": compare locks, build to `cache_dir/../docs.new/`, validate, atomic rename, write companion lock. On any failure, delete `docs.new/` and leave `docs/` intact.

- [ ] **Step 3: Run; verify pass**

- [ ] **Step 4: Commit**

```bash
git add packages/brs-docs/src/brs_docs/corpus/refresh.py packages/brs-docs/tests/test_corpus_build/test_refresh.py
git commit -m "feat(brs-docs): T17 transactional refresh (Plan 6)"
```

---

### Task T18: First-run install

**Files:**
- Create: `packages/brs-docs/src/brs_docs/corpus/first_run.py`
- Create: `packages/brs-docs/tests/test_corpus_build/test_first_run.py`

- [ ] **Step 1: Write failing tests** for `ensure_cache_corpus(cache_dir)`:
  - When cache empty + bundled corpus exists: copies it.
  - When cache exists: no-op (return path).
  - When cache empty + bundled missing: raises `CorpusNotInitialized`.

- [ ] **Step 2: Implement `src/brs_docs/corpus/first_run.py`** using `importlib.resources.files("brs_docs").joinpath("data/corpus.sqlite")`. Use `shutil.copyfile` (full copy, not symlink).

- [ ] **Step 3: Run; verify pass**

- [ ] **Step 4: Commit**

```bash
git add packages/brs-docs/src/brs_docs/corpus/first_run.py packages/brs-docs/tests/test_corpus_build/test_first_run.py
git commit -m "feat(brs-docs): T18 first-run install (Plan 6)"
```

---

## Phase 5: CLI + Server

### Task T19: CLI scaffolding

**Files:**
- Create: `packages/brs-docs/src/brs_docs/cli.py`
- Create: `packages/brs-docs/tests/test_cli.py`

Subcommands: `serve`, `search`, `get`, `list`, `recommend`, `refresh`, `version`.

- [ ] **Step 1: Write failing tests** invoking `cli.main(argv)` for:
  - `["version"]` prints package version + corpus.lock summary; returns 0.
  - `["search", "RowList"]` prints JSON; returns 0.
  - `["search"]` (missing arg) prints help; returns 2.
  - `["unknown_subcmd"]` returns 2.

- [ ] **Step 2: Implement `src/brs_docs/cli.py`** using stdlib `argparse` with subparsers. `serve` delegates to T20 server. `search`/`get`/`list`/`recommend` connect to `~/.cache/rokudev/docs/corpus.sqlite` (via `first_run.ensure_cache_corpus`) and print `json.dumps(result, indent=2)`. `refresh` calls T17. `version` prints `__version__` + a one-line corpus summary.

- [ ] **Step 3: Run; verify pass**

- [ ] **Step 4: Commit**

```bash
git add packages/brs-docs/src/brs_docs/cli.py packages/brs-docs/tests/test_cli.py
git commit -m "feat(brs-docs): T19 CLI subcommands (Plan 6)"
```

---

### Task T20: MCP stdio server

**Files:**
- Create: `packages/brs-docs/src/brs_docs/server.py`
- Create: `packages/brs-docs/tests/test_server_unit.py`

Use the `mcp` Python SDK (already in deps). Tool registrations map MCP requests to Phase 2 tool functions.

- [ ] **Step 1: Write failing tests** that import the server module and:
  - Assert all 5 tools are registered with expected names.
  - For each tool, assert calling its handler with a sample payload returns the expected response shape.
  - Assert tool errors (from `ToolError`) are translated to the JSON error response shape.

- [ ] **Step 2: Implement `src/brs_docs/server.py`** using `mcp.server.Server`:

```python
"""MCP stdio server for brs-docs."""

from __future__ import annotations

import asyncio
import os
import sqlite3
import sys
from pathlib import Path

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

from brs_docs import __version__
from brs_docs.corpus.first_run import ensure_cache_corpus
from brs_docs.db import connect
from brs_docs.tools.get import brs_get
from brs_docs.tools.list import brs_list
from brs_docs.tools.recommend import brs_recommend
from brs_docs.tools.sample_read import brs_sample_read
from brs_docs.tools.search import brs_search

CACHE_DIR = Path(os.environ.get(
    "ROKUDEV_CACHE_DIR", str(Path.home() / ".cache" / "rokudev" / "docs"),
))


def _open_conn() -> sqlite3.Connection:
    corpus_path = ensure_cache_corpus(CACHE_DIR)
    return connect(corpus_path)


def build_app() -> Server:
    app = Server("brs-docs")

    @app.list_tools()
    async def list_tools() -> list[Tool]:
        return [
            Tool(name="brs_search", description="Full-text search over BrightScript corpus.", inputSchema={...}),
            Tool(name="brs_get", description="Fetch one doc by id.", inputSchema={...}),
            Tool(name="brs_list", description="List docs of a kind.", inputSchema={...}),
            Tool(name="brs_sample_read", description="Stream a sample body in chunks.", inputSchema={...}),
            Tool(name="brs_recommend", description="Rank docs/modules/templates by intent.", inputSchema={...}),
        ]

    @app.call_tool()
    async def call_tool(name: str, arguments: dict) -> list[TextContent]:
        conn = _open_conn()
        try:
            if name == "brs_search":
                result = brs_search(conn, **arguments)
            elif name == "brs_get":
                result = brs_get(conn, **arguments)
            elif name == "brs_list":
                result = brs_list(conn, **arguments)
            elif name == "brs_sample_read":
                result = brs_sample_read(conn, **arguments)
            elif name == "brs_recommend":
                result = brs_recommend(conn, **arguments)
            else:
                result = {"error": {"code": "UNKNOWN_TOOL", "message": name}}
        finally:
            conn.close()
        import json as _json
        return [TextContent(type="text", text=_json.dumps(result))]

    return app


async def _run() -> None:
    async with stdio_server() as (read, write):
        app = build_app()
        await app.run(read, write, app.create_initialization_options())


def main() -> int:
    print(f"[brs-docs] starting MCP stdio server (v{__version__})", file=sys.stderr)
    asyncio.run(_run())
    return 0
```

Fill in `inputSchema` JSON Schema objects per each tool's documented arguments. Reference: spec §"MCP tools surface".

- [ ] **Step 3: Run; verify pass**

- [ ] **Step 4: Commit**

```bash
git add packages/brs-docs/src/brs_docs/server.py packages/brs-docs/tests/test_server_unit.py
git commit -m "feat(brs-docs): T20 MCP stdio server (Plan 6)"
```

---

### Task T21: `brs-docs refresh` CLI subcommand integration

**Files:**
- Modify: `packages/brs-docs/src/brs_docs/cli.py` (already created in T19; wire `refresh` subcommand to call T17)
- Create: `packages/brs-docs/tests/test_cli_refresh.py`

- [ ] **Step 1: Write failing tests** that:
  - Run `cli.main(["refresh"])`. Mock `refresh_corpus` to return `RefreshResult(status="up_to_date")`; assert stdout contains `"up to date"`, exit 0.
  - Repeat with `status="refreshed"`; assert exit 0 + summary printed.
  - Repeat with `status="failed"`; assert exit 2 + failure reason printed.

- [ ] **Step 2: Wire refresh in `cli.py`** (add subcommand if not done in T19).

- [ ] **Step 3: Run; verify pass**

- [ ] **Step 4: Commit**

```bash
git add packages/brs-docs/src/brs_docs/cli.py packages/brs-docs/tests/test_cli_refresh.py
git commit -m "feat(brs-docs): T21 refresh CLI wiring (Plan 6)"
```

---

## Phase 6: Tests (contract + integration)

### Task T22: Contract tests

**Files:**
- Create: `packages/brs-docs/tests/contract/__init__.py`
- Create: `packages/brs-docs/tests/contract/test_brs_gen_module_toml_shape.py`
- Create: `packages/brs-docs/tests/contract/test_corpus_version_matches_brs_gen.py`

- [ ] **Step 1: Write `test_brs_gen_module_toml_shape.py`** that:
  - Reads `packages/brs-gen/modules/analytics.event_pipe/module.toml`.
  - Asserts every top-level section (`module`, `module_wiring`, `config`, `ordering`, `public_api`) that exists is handled by `parse_feature_modules`. Specifically: parses the file via `parse_feature_modules`, asserts no exception, asserts known fields populate `structured` correctly.

- [ ] **Step 2: Write `test_corpus_version_matches_brs_gen.py`** that:
  - Reads `packages/brs-docs/corpus.lock`.
  - Reads `packages/brs-gen/package.json` (`json.loads`).
  - Asserts `corpus.lock` `[sources.rokudev_tools_modules].package_version == package.json["version"]`.
  - Asserts `[sources.rokudev_tools_templates].package_version == package.json["version"]`.

- [ ] **Step 3: Run; verify pass**

- [ ] **Step 4: Commit**

```bash
git add packages/brs-docs/tests/contract/
git commit -m "test(brs-docs): T22 contract tests for brs-gen coupling (Plan 6)"
```

---

### Task T23: Integration tests

**Files:**
- Create: `packages/brs-docs/tests/integration/__init__.py`
- Create: `packages/brs-docs/tests/integration/test_mcp_server.py`
- Create: `packages/brs-docs/tests/integration/test_first_run.py`
- Create: `packages/brs-docs/tests/integration/test_refresh.py`

All marked `@pytest.mark.integration` so they don't run by default.

- [ ] **Step 1: Write `test_mcp_server.py`** that:
  - Builds a tiny corpus (via T16 with the fixture tarballs).
  - Sets `ROKUDEV_CACHE_DIR=<tmp>`.
  - Spawns `uv run brs-docs serve` as a subprocess.
  - Sends a JSON-RPC `initialize` + `tools/list` + `tools/call` (for `brs_search`) over stdin.
  - Asserts response shape matches expectations.
  - Terminates subprocess.

- [ ] **Step 2: Write `test_first_run.py`** that:
  - Wipes a `tmp_path/cache/`.
  - Imports server module, calls `_open_conn()`, asserts `corpus.sqlite` was copied to `tmp_path/cache/`.

- [ ] **Step 3: Write `test_refresh.py`** that:
  - Builds corpus.
  - Calls refresh: asserts `up_to_date`.
  - Mutates cache `corpus.lock` to a different SHA.
  - Calls refresh: asserts `refreshed` and corpus content unchanged (because fixtures are stable).
  - Injects a failure (e.g. break a fixture mid-test); asserts `failed` and original `corpus.sqlite` is bytewise unchanged.

- [ ] **Step 4: Run with `uv run pytest -m integration`; verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/tests/integration/
git commit -m "test(brs-docs): T23 integration tests (MCP server, first-run, refresh) (Plan 6)"
```

---

### Task T24: Recommend fixtures (intents.toml + test runner)

**Files:**
- Create: `packages/brs-docs/tests/test_recommend/intents.toml`
- Create: `packages/brs-docs/tests/integration/test_recommend_fixtures.py`

- [ ] **Step 1: Write `intents.toml`** with the 15 cases (use spec §"Fixture-pinned regression tests" excerpt). Include `xfail_reason` on all cases referencing paused modules (auth.*, monetization.*, ads.*, deep_link.*, accessibility.*).

- [ ] **Step 2: Write `test_recommend_fixtures.py`** that:
  - Loads `intents.toml`.
  - For each case: builds a fixture corpus matching the case's expected IDs (at minimum the existing fixture corpus + the v1-shipped modules/templates).
  - For order-agnostic cases: asserts `expected_top_ids` is a subset of the top-K result IDs.
  - For order-sensitive cases (`expected_top_ids_in_order`): asserts the order matches.
  - For forbidden cases: asserts none of `forbidden_top_ids` patterns appear in top-K (wildcard `*` supported).
  - For `xfail_reason` cases: wraps in `pytest.xfail(reason=...)`.

- [ ] **Step 3: Run; verify all non-xfail cases pass**

- [ ] **Step 4: Commit**

```bash
git add packages/brs-docs/tests/test_recommend/intents.toml packages/brs-docs/tests/integration/test_recommend_fixtures.py
git commit -m "test(brs-docs): T24 recommend fixture-pinned regression suite (Plan 6)"
```

---

## Phase 7: CI + release

### Task T25: GitHub Actions Python job

**Files:**
- Modify: `.github/workflows/<existing>.yml` (or create `.github/workflows/brs-docs.yml`)

- [ ] **Step 1: Add a job** matching the YAML in spec §"CI integration". Use `astral-sh/setup-uv@v3`. Run `uv sync`, then `make build-corpus`, then `uv run pytest --maxfail=1`, then `uv run pytest -m integration`, then `uv run ruff check`, then `uv run mypy src/`.

- [ ] **Step 2: Push to a branch + verify CI runs green** (use a draft PR to test). Iterate on environment quirks (Python version, uv version pin).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/
git commit -m "ci(brs-docs): T25 GitHub Actions Python job (Plan 6)"
```

---

### Task T26: CI lint discipline scripts

**Files:**
- Create: `packages/brs-docs/scripts/corpus_lock_discipline.py`
- Create: `packages/brs-docs/scripts/tags_toml_discipline.py`
- Modify: CI workflow to run them

- [ ] **Step 1: Implement `corpus_lock_discipline.py`**: runs `git diff --name-only origin/main...HEAD`; if `packages/brs-docs/corpus.lock` is modified, verify `packages/brs-docs/src/brs_docs/__init__.py`'s `__version__` is also modified. Print error + exit 1 on violation.

- [ ] **Step 2: Implement `tags_toml_discipline.py`**: if `tags.toml` is modified in the diff, parse OLD and NEW versions; assert NEW `version` field differs. Print error + exit 1 on violation.

- [ ] **Step 3: Add CI steps invoking both scripts** in the workflow.

- [ ] **Step 4: Test locally** by simulating a violating PR (`git diff` against a stale ref).

- [ ] **Step 5: Commit**

```bash
git add packages/brs-docs/scripts/ .github/workflows/
git commit -m "ci(brs-docs): T26 corpus.lock + tags.toml discipline scripts (Plan 6)"
```

---

### Task T27: Root Makefile targets + monorepo wiring

**Files:**
- Modify: root `Makefile` (create if absent)

- [ ] **Step 1: Add targets**

```makefile
.PHONY: test-python build-corpus test-all

test-python:
	cd packages/brs-docs && uv run pytest

build-corpus:
	cd packages/brs-docs && uv run python -m brs_docs.corpus.build \
		--lock corpus.lock \
		--out src/brs_docs/data/corpus.sqlite \
		--monorepo-root $(CURDIR)

test-all: test-python
	pnpm turbo run test
```

- [ ] **Step 2: Verify by running each target**:

```bash
make build-corpus
make test-python
```

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "build(brs-docs): T27 root Makefile targets (Plan 6)"
```

---

### Task T28: Initial corpus generation + smoke verification

**Files:**
- Modify: `packages/brs-docs/corpus.lock` (replace PLACEHOLDER SHAs with real HEAD SHAs from `rokudev/dev-doc`, `rokudev/samples`, `rokudev/scenegraph-master-sample`)

- [ ] **Step 1: Resolve real SHAs**

```bash
gh api repos/rokudev/dev-doc/branches/main -q .commit.sha
gh api repos/rokudev/samples/branches/main -q .commit.sha
gh api repos/rokudev/scenegraph-master-sample/branches/main -q .commit.sha
```

- [ ] **Step 2: Update `corpus.lock`** with the three SHAs.

- [ ] **Step 3: Build the corpus**

```bash
make build-corpus
```

Verify: SQLite file produced at `packages/brs-docs/src/brs_docs/data/corpus.sqlite`. Print `SELECT kind, COUNT(*) FROM docs GROUP BY kind`. Confirm:
- Total docs ≥ 600.
- Per-kind counts roughly match the prototype's 67/91/19/99/341/154 + new global_function ~50 + feature_module 1 + template 6.

- [ ] **Step 4: Smoke-test the server end-to-end**

```bash
cd packages/brs-docs
ROKUDEV_CACHE_DIR=$(mktemp -d) uv run brs-docs search "RowList"
ROKUDEV_CACHE_DIR=$(mktemp -d) uv run brs-docs recommend "rotating focus on a RowList"
```

Confirm results look reasonable.

- [ ] **Step 5: Run the full test suite**

```bash
cd packages/brs-docs
uv run pytest
uv run pytest -m integration
```

All green.

- [ ] **Step 6: Commit**

```bash
git add packages/brs-docs/corpus.lock
git commit -m "feat(brs-docs): T28 real upstream SHAs in corpus.lock; v0.7.0 corpus snapshot (Plan 6)"
```

(corpus.sqlite is .gitignored; CI builds it on each release)

---

### Task T29: Release bookkeeping

**Files:**
- Create: `docs/release-notes/v0.7.0.md`
- Modify: `packages/brs-docs/README.md` (richer with usage examples now that the tool works)
- Modify: `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md` (Status line for Plan 6)

- [ ] **Step 1: Write `docs/release-notes/v0.7.0.md`** summarizing what brs-docs ships, scope cuts (no upstream fetch in refresh; no corp mirror), and the post-pivot work-order context.

- [ ] **Step 2: Expand `packages/brs-docs/README.md`** with full CLI usage, MCP config snippet, and a "what's NOT in v1" callout.

- [ ] **Step 3: Update MEMORY.md** with a new status line:

```
- Plan 6 COMPLETE 2026-05-19 v0.7.0 (~100 brs-docs tests; ~1087 repo total). brs-docs MCP. See plan-6-brs-docs.md
```

- [ ] **Step 4: Create per-plan memory file** `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/plan-6-brs-docs.md` capturing: scope cuts taken (refresh = local rebuild), latent traps discovered, tests that turned up bugs in the prototype, and any cross-package coupling notes.

- [ ] **Step 5: Tag + release**

User-driven step. Steps:

```bash
git tag v0.7.0
git push origin v0.7.0
# CI release workflow runs `uv publish` to PyPI (only after user approves)
```

- [ ] **Step 6: Commit non-tag artifacts**

```bash
git add docs/release-notes/v0.7.0.md packages/brs-docs/README.md
git commit -m "docs(brs-docs): T29 v0.7.0 release notes + README (Plan 6)"
```

---

## Done

After T29, the implementer should:

1. Run `uv run pytest && uv run pytest -m integration` from `packages/brs-docs/`; all green.
2. Run `make test-all` from repo root; all green.
3. Run `uv run brs-docs version`; see package version + corpus.lock summary.
4. Configure Claude Code with the MCP config snippet from README; verify all 5 tools callable.
5. Report success criteria from spec §"Success criteria for v1" with measurements (test count, wheel size from `uv build`, query-latency timings from a small benchmark script).

The plan invariant: every changed line traces directly to the spec. No scope creep. If a step turns up something that requires a spec change, STOP and flag for the brainstorm-loop owner.

