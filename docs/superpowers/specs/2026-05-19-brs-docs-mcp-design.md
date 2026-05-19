# brs-docs MCP design

**Date:** 2026-05-19
**Status:** Approved (brainstorming session 2026-05-19); ready for implementation planning.
**Scope:** Plan 6, block 1 in the post-pivot dev-tools work order. First deliverable of the developer-tools track (project pivot 2026-05-19: focus on tools for Claude Code + a human dev on a real Roku device).

## Goal

Ship `brs-docs`, a Python MCP server that gives Claude Code (and a human dev via CLI) fast, offline, anti-hallucination lookup over the BrightScript reference corpus, code samples, and rokudev-tools feature modules + templates. Replaces the prototype at `/Users/bblietz/Work/ClaudeProjects/brs-mcp-for-docs/`.

## Non-goals

- LSP-as-tool integration (block 2 in the work order).
- `brs` umbrella CLI (block 6).
- Claude Code plugin packaging (block 5).
- Telemetry of any kind (PRD §8.5 invariant).
- Corp-network mirror flag (deferred to v1.x).
- Multi-language corpus (English only at v1).
- ML-driven recommend ranker tuning (manual weight tuning at v1).

## Background

The prototype `brs-mcp-for-docs` ships:

- SQLite + FTS5 corpus of 771 docs (67 components, 91 interfaces, 19 events, 99 nodes, 341 guides, 154 samples).
- 3 docs tools: `brs_search`, `brs_get`, `brs_list`.
- A GitHub-tarball scraper for `rokudev/dev-doc` + `rokudev/samples`.
- ECP + dev-portal device tools (these belong in `rokudev-device`; dropped from brs-docs scope).

PRD §5 extends this with:

- 2 new tools: `brs_sample_read` (for >64KB samples) and `brs_recommend` (BM25 + tag boost + module-category boost, no embeddings, no LLM).
- 2 new kinds: `feature_module` and `template` (sourced from `packages/brs-gen/{modules,templates}/` at corpus build time).
- Pre-bundled corpus in the PyPI wheel.
- Transactional refresh (atomic rename; never corrupts existing corpus on failure).

The user directive (2026-05-19) is to rebuild from scratch using the prototype as reference, fixing prototype decisions like the single `content_md` column.

## Architecture

### Package layout

```
packages/brs-docs/
├── pyproject.toml                       # uv-managed; console-script `brs-docs`
├── README.md
├── corpus.lock                          # source SHAs (committed); see below
├── src/brs_docs/
│   ├── __init__.py
│   ├── server.py                        # MCP stdio server (entry point)
│   ├── cli.py                           # `brs-docs` console-script
│   ├── db.py                            # SQLite connect + schema
│   ├── models.py                        # Pydantic models
│   ├── tools/
│   │   ├── search.py
│   │   ├── get.py
│   │   ├── list.py
│   │   ├── sample_read.py
│   │   └── recommend.py
│   ├── recommend/
│   │   ├── ranker.py                    # BM25 + tag boost + module category
│   │   └── tags.toml                    # keyword -> tag table
│   ├── corpus/
│   │   ├── build.py                     # CLI-callable corpus builder
│   │   ├── sources/
│   │   │   ├── dev_doc.py
│   │   │   ├── samples.py
│   │   │   ├── feature_modules.py
│   │   │   └── templates.py
│   │   └── refresh.py                   # transactional refresh
│   └── data/
│       └── corpus.sqlite                # generated in CI; NOT committed
├── tests/
│   ├── conftest.py
│   ├── test_search.py
│   ├── test_get.py
│   ├── test_list.py
│   ├── test_sample_read.py
│   ├── test_recommend/
│   │   ├── intents.toml                 # ~15 canonical intents
│   │   └── golden/
│   ├── test_refresh.py
│   ├── fixtures/                        # small tarball fixtures for scraper tests
│   ├── integration/
│   │   ├── test_recommend_fixtures.py
│   │   ├── test_mcp_server.py
│   │   ├── test_first_run.py
│   │   └── test_refresh.py
│   └── contract/
│       ├── test_brs_gen_module_toml_shape.py
│       └── test_corpus_version_matches_brs_gen.py
└── scripts/
    └── build_corpus.py                  # CI entry
```

### Three runtime modes

1. **MCP stdio server** (default; started by Claude Code via plugin config or `mcp.json`): `brs-docs serve`.
2. **CLI for refresh + ad-hoc queries** (human-facing): `brs-docs refresh`, `brs-docs search`, `brs-docs get`, `brs-docs list`, `brs-docs recommend`, `brs-docs version`.
3. **Corpus build** (release-time, in CI): `python -m brs_docs.corpus.build --lock corpus.lock --out src/brs_docs/data/corpus.sqlite`.

### Monorepo integration

- `pyproject.toml` declares `brs-docs = "brs_docs.cli:main"`.
- Python venv managed by `uv` (matches prototype).
- Tests run via `uv run pytest`.
- Turborepo (TS) does not orchestrate Python; root-level `Makefile` adds `make test-python` and `make build-corpus` targets.
- CI gets a parallel Python job (see Testing section).
- Cross-package version coupling deferred to block 10 (`cross-package-version-compat-check`); brs-docs ships at the same version as the TS packages, coordinated manually at v1.

### Cache + config paths

| Path | Purpose |
|---|---|
| `~/.cache/rokudev/docs/corpus.sqlite` | Writable working corpus (copy of bundled or refreshed). |
| `~/.cache/rokudev/docs/corpus.lock` | Resolved source SHAs of the working corpus. |
| `~/.config/rokudev/config.toml` | Reserved for `internal.use_corp_doc_mirror` and `corpus.mirror_url` (deferred to v1.x). |

### Pre-bundled corpus shipping

- Generated in CI at release time from pinned source SHAs in `packages/brs-docs/corpus.lock`.
- Included in wheel via `pyproject.toml` `[tool.hatch.build.targets.wheel] include = ["src/brs_docs/data/corpus.sqlite"]`.
- NOT committed to git. Devs running locally either `make build-corpus` or download a release artifact.
- On first MCP server startup, `data/corpus.sqlite` is copied from `importlib.resources` to `~/.cache/rokudev/docs/corpus.sqlite` (full copy, not symlink, because pip installs may be read-only).
- Wheel size budget: target ~18 MB, cap 30 MB.

## Data model

### Kind enum (v1)

| Kind | Source | Count (prototype + projections) |
|---|---|---|
| `component` | dev-doc | 67 |
| `interface` | dev-doc | 91 |
| `event` | dev-doc | 19 |
| `node` | dev-doc | 99 |
| `global_function` | dev-doc | (new; ~50) |
| `guide` | dev-doc | 341 |
| `sample` | samples + scenegraph-master-sample | 154 |
| `feature_module` | rokudev-tools modules | 1 today (analytics.event_pipe) |
| `template` | rokudev-tools templates | 6 today |

### SQLite schema

```sql
CREATE TABLE docs (
    id             TEXT PRIMARY KEY,        -- "{kind}:{slug}"
    kind           TEXT NOT NULL,
    title          TEXT NOT NULL,
    summary        TEXT NOT NULL,           -- 1-3 sentences; powers search snippets
    body           TEXT NOT NULL,           -- full markdown or full sample source
    body_truncated INTEGER NOT NULL DEFAULT 0,  -- 1 if body omitted from brs_get
    byte_count     INTEGER NOT NULL,        -- byte length of full body
    tags           TEXT NOT NULL DEFAULT '',  -- space-separated; FTS-indexed
    url            TEXT,                    -- canonical upstream URL; nullable
    source         TEXT NOT NULL,           -- which scraper produced this row
    structured     TEXT,                    -- optional JSON; kind-specific fields
    fetched_at     INTEGER NOT NULL,        -- unix epoch seconds
    content_hash   TEXT NOT NULL            -- sha256 of body; for refresh diffing
);
CREATE INDEX docs_kind_idx ON docs(kind);
CREATE INDEX docs_source_idx ON docs(source);

CREATE VIRTUAL TABLE docs_fts USING fts5(
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
-- triggers keep docs_fts in sync with docs (insert/update/delete)
```

**Notable improvements over the prototype:**

- Split `content_md` into `title` + `summary` + `body` so search snippets pull from `summary` (compact, agent-friendly).
- `tags` column powers the `brs_recommend` tag-boost story.
- `body_truncated` + `byte_count` enable the `brs_sample_read` story.
- `content_hash` enables transactional refresh diffing (detect "no change" early).
- `unicode61 remove_diacritics 2` tokenizer handles BrightScript identifier characters cleanly.
- BM25 column weights tunable via `bm25(docs_fts, title_w, summary_w, body_w, tags_w)`; defaults 4.0, 2.0, 1.0, 3.0.

### Sample storage strategy (>64KB)

- All sample bodies stored inline in `docs.body` regardless of size (SQLite handles >64KB fine).
- `brs_get(id)` for a sample > 64KB returns `body=""`, `body_truncated=1`, `byte_count=N`.
- `brs_sample_read(id, byte_offset?, byte_limit?)` reads the FULL body from SQLite, slices Python-side, returns the chunk.
- Default `byte_limit` 64KB; max 256KB (larger clamped + `clamped: true` flag).
- Rationale: one SQLite file enables atomic refresh + single deployment artifact.

### `feature_module` and `template` source shape

`feature_module`:

- `id` = `feature_module:<module_id>` (e.g. `feature_module:analytics.event_pipe`)
- `title` = module display name
- `summary` = `module.toml` description
- `body` = `README.md` if present; else synthesized doc from module.toml (config keys, hooks, AppSpec excerpt)
- `tags` = `module.toml` tags field
- `structured` = JSON: `{ public_api, config_keys, requires_modules, conflicts_modules, applies_to_templates }`
- `source` = `rokudev-tools-modules`
- `url` = NULL

`template`:

- `id` = `template:<template_id>` (e.g. `template:video_grid_channel`)
- `title` = template display name
- `summary` = `template.toml` description
- `body` = `README.md` if present
- `tags` = `template.toml` tags
- `structured` = JSON: `{ supported_modules, scenes, content_kinds }`
- `source` = `rokudev-tools-templates`

### corpus.lock shape

```toml
brs_docs_version = "0.7.0"
generated_at = "2026-05-19T00:00:00Z"

[sources.dev_doc]
url = "https://github.com/rokudev/dev-doc"
sha = "abc123..."
fetched_at = "2026-05-19T00:00:00Z"

[sources.samples]
url = "https://github.com/rokudev/samples"
sha = "def456..."
fetched_at = "2026-05-19T00:00:00Z"

[sources.scenegraph_master_sample]
url = "https://github.com/rokudev/scenegraph-master-sample"
sha = "789abc..."
fetched_at = "2026-05-19T00:00:00Z"

[sources.rokudev_tools_modules]
package_version = "0.6.1"
module_count = 1

[sources.rokudev_tools_templates]
package_version = "0.6.1"
template_count = 6
```

## MCP tools surface

### `brs_search(query, kind?, limit=10)`

**Request:** `{ "query": "RowList rotating focus", "kind": "node", "limit": 5 }`

- `query`: free-form text; tokenized + each token wrapped as FTS5 phrase (prevents injection).
- `kind`: optional; one of 9 kinds (rejects unknown values with `INVALID_KIND`).
- `limit`: 1-50, default 10.

**Response:**

```json
{
  "results": [
    {
      "id": "node:RowList",
      "kind": "node",
      "title": "RowList",
      "summary": "Horizontally-scrolling list of rows...",
      "snippet": "...the <mark>RowList</mark> node supports <mark>rotating focus</mark>...",
      "score": -8.34
    }
  ],
  "total_matched": 12,
  "query_echo": { "query": "RowList rotating focus", "kind": "node", "limit": 5 }
}
```

- `snippet` from FTS5 `snippet()` over `body` with `<mark>` highlighting.
- `score` is raw BM25 (FTS5 returns negative; surfaced as-is for transparency).
- `total_matched` is `COUNT(*)` for the same query (helps caller decide if `limit` was too small).

### `brs_get(id)`

**Request:** `{ "id": "component:roDateTime" }`

**Response (small doc):**

```json
{
  "id": "component:roDateTime",
  "kind": "component",
  "title": "roDateTime",
  "summary": "Represents a date and time...",
  "body": "# roDateTime\n\n...",
  "body_truncated": false,
  "byte_count": 4231,
  "tags": ["datetime", "time", "epoch"],
  "url": "https://developer.roku.com/...",
  "source": "dev_doc",
  "structured": { "interfaces": ["ifDateTime"], "methods": [...] },
  "fetched_at": 1747612800
}
```

**Response (sample > 64KB):**

```json
{
  "id": "sample:scenegraph-master-sample/SimpleScene.xml",
  "kind": "sample",
  "title": "SimpleScene.xml",
  "summary": "Minimal SceneGraph scene wiring a Label and RowList.",
  "body": "",
  "body_truncated": true,
  "byte_count": 89421,
  "tags": ["scenegraph", "scene", "rowlist"],
  "url": null,
  "source": "scenegraph_master_sample",
  "structured": { "path": "components/SimpleScene.xml", "language": "xml", "line_count": 1834 },
  "fetched_at": 1747612800,
  "read_hint": "Body > 64KB. Use brs_sample_read with this id to fetch chunks."
}
```

**Error:** `{ "error": { "code": "DOC_NOT_FOUND", "id": "..." } }`.

### `brs_list(kind, prefix?)`

**Request:** `{ "kind": "node", "prefix": "Row" }`

**Response:**

```json
{
  "kind": "node",
  "prefix": "Row",
  "results": [
    { "id": "node:RowList", "title": "RowList" },
    { "id": "node:RowListItem", "title": "RowListItem" }
  ],
  "total": 2
}
```

- `prefix` matches `title` case-insensitively (LIKE with escaped `_` and `%`).
- No pagination at v1; SQL `LIMIT 500` ceiling guards against unbounded responses.

### `brs_sample_read(id, byte_offset=0, byte_limit=65536)`

**Request:** `{ "id": "sample:...", "byte_offset": 0, "byte_limit": 32768 }`

**Response:**

```json
{
  "id": "sample:...",
  "byte_offset": 0,
  "byte_limit": 32768,
  "bytes_read": 32768,
  "total_bytes": 89421,
  "eof": false,
  "body": "<?xml version=\"1.0\"..."
}
```

- `byte_limit` capped at 262144 (256KB); larger requests clamped with `clamped: true`.
- `byte_offset >= total_bytes` returns `body=""`, `eof=true`.
- Only valid for `kind=sample`; returns `NOT_SAMPLE_KIND` otherwise.

### `brs_recommend(intent, kinds?, limit=5)`

**Request:**

```json
{
  "intent": "how do I add a paywall to my channel",
  "kinds": ["feature_module", "guide", "sample"],
  "limit": 5
}
```

- `intent`: free-form text; required.
- `kinds`: optional allowlist; default `["component", "node", "interface", "guide", "sample", "feature_module", "template"]` (omits `event`, `global_function` which are rarely "I need to do X" answers).
- `limit`: 1-20, default 5.

**Response:**

```json
{
  "intent": "how do I add a paywall to my channel",
  "results": [
    {
      "id": "feature_module:monetization.roku_pay.subscription",
      "kind": "feature_module",
      "title": "Roku Pay - Subscription",
      "summary": "Subscription monetization via Roku Billing API.",
      "score": 21.31,
      "details": {
        "bm25_score": 12.31,
        "tag_boosts": { "subscription": 3.0, "paywall": 2.0 },
        "module_category_boost": 4.0,
        "matched_terms": ["paywall", "channel"]
      }
    }
  ],
  "ranker_version": "1.0",
  "tags_toml_version": "2026-05-19"
}
```

- `details` is always present (auditable; verbose but high-value for Claude Code).
- `ranker_version` tracks `tags.toml` version field.

### Common error shape

```json
{ "error": { "code": "CODE_NAME", "message": "human-readable", "details": { ... } } }
```

**v1 codes:** `DOC_NOT_FOUND`, `NOT_SAMPLE_KIND`, `INVALID_KIND`, `INVALID_QUERY`, `INVALID_OFFSET`, `CORPUS_NOT_INITIALIZED`, `CORPUS_LOCK_MISSING`.

## Corpus build pipeline

### Build entry point

`python -m brs_docs.corpus.build --lock corpus.lock --out <path>`

### Steps

1. **Validate lock file.** Parse `corpus.lock`; assert all required sections present; version is semver-valid.
2. **Fetch sources in parallel.**
   - `dev_doc`, `samples`, `scenegraph_master_sample`: `https://github.com/rokudev/{name}/archive/{sha}.tar.gz`.
   - `rokudev_tools_modules` + `rokudev_tools_templates`: read from sibling `packages/brs-gen/{modules,templates}/`.
3. **Parse + normalize.** Per-source parser converts upstream format to `CanonicalDoc` instances.
4. **Build SQLite.** Create new file at `<out>.new`; init schema; bulk INSERT in single transaction; rebuild FTS5 index.
5. **Validate corpus.**
   - At least N docs per kind (`--min-counts` flag with defaults).
   - All IDs unique.
   - No body > 2MB.
   - FTS5 returns >0 results for canary queries: `"RowList"`, `"ifString"`, `"Subscribe"`.
6. **Atomic install.** `os.rename(<out>.new, <out>)`.
7. **Write companion lock copy** at `<out>.lock`.

### Refresh (user-initiated)

**Command:** `brs-docs refresh`

**Behavior at v1 (LOCAL REBUILD, not GitHub fetch):**

```
brs-docs refresh
  Read current ~/.cache/rokudev/docs/corpus.lock (the "installed" lock)
  Read the BUNDLED lock from the package (the "available" lock)
  If installed.sha == available.sha for all sources: print "up to date" and exit 0
  Otherwise:
    Build new corpus into ~/.cache/rokudev/docs.new/corpus.sqlite using bundled sources
    Run all validate-corpus checks
    On success: atomic rename ~/.cache/rokudev/docs.new/ to ~/.cache/rokudev/docs/
    On failure:
      Leave ~/.cache/rokudev/docs/ untouched
      Delete ~/.cache/rokudev/docs.new/
      Print failure stage + recovery hint
      Exit 2 (distinct from "up to date" exit 0 and "lock missing" exit 1)
  Report: "Refreshed to brs-docs corpus 0.7.1 (dev-doc abc123, ...)"
```

**Scope cut from PRD §5.3:** v1 refresh is a LOCAL rebuild from the bundled snapshot, not a GitHub fetch. True upstream fetch (`brs-docs refresh --upstream`) is deferred to v1.1 because:

- Adds network + auth complexity.
- The bundled snapshot is the supported case for "what corpus is Claude Code using".
- The corp-mirror flag (also deferred) is the proper pairing.

### First-run install

When MCP server starts and `~/.cache/rokudev/docs/corpus.sqlite` is absent:

1. Locate bundled corpus via `importlib.resources`.
2. `os.makedirs("~/.cache/rokudev/docs/", exist_ok=True, mode=0o755)`.
3. Copy bundled corpus (full file copy, not symlink).
4. Copy bundled lock.
5. Log one-line `[brs-docs] First-run: installed corpus 0.7.0 (3231 docs, 17.4 MB)` to stderr.
6. Proceed to serve.

If bundled corpus is also missing: return `CORPUS_NOT_INITIALIZED` from every tool call with recovery hint pointing at `make build-corpus`. Server still starts; doesn't crash.

### Local-dev workflow

```bash
cd packages/brs-docs
uv sync
make build-corpus                # generates data/corpus.sqlite; ~30s
uv run pytest
uv run brs-docs serve
```

## Recommend ranker

### tags.toml structure

Three sections: `[keyword_to_tags]`, `[[module_categories]]`, `[bm25_weights]`. See Section 5 of the brainstorm transcript for the full v1 content; an excerpt:

```toml
version = "1.0"

[keyword_to_tags]
"paywall"          = [{ tag = "subscription", weight = 3.0 }, { tag = "paywall", weight = 2.0 }]
"rotating focus"   = [{ tag = "focus", weight = 3.0 }, { tag = "rowlist", weight = 2.0 }]
"video"            = [{ tag = "video", weight = 3.0 }, { tag = "playback", weight = 2.0 }]
# ... ~35 keyword entries total at v1

[[module_categories]]
intent_keywords = ["paywall", "subscription", "billing", "transactional"]
id_substring    = "monetization.roku_pay"
boost           = 4.0

[[module_categories]]
intent_keywords = ["sign in", "login", "auth", "sso", "device link", "oauth"]
id_substring    = "auth."
boost           = 4.0

# ... ~11 module_categories entries total at v1

[bm25_weights]
title   = 4.0
summary = 2.0
body    = 1.0
tags    = 3.0
```

### Scoring formula

```
For each doc in top-50-per-kind FTS5 candidates:
  bm25 = abs(bm25_raw)
  tag_boost_sum = sum over (intent_keyword, tag) matches where doc has the tag
  module_category_boost = sum over (intent_keyword, id_substring) where doc.id contains id_substring
  score = bm25 + tag_boost_sum + module_category_boost
Sort by score DESC; take top `limit`.
```

### Tokenization rules

- Keyword match: case-insensitive substring on the intent string. Multi-word keywords like `"rotating focus"` match `"how do I get rotating focus"`.
- Diacritics stripped before matching.
- Known v1 false-positive: `"row"` matches `"borrow"`. BM25 dominates; acceptable for v1.

### Fixture-pinned regression tests

`tests/test_recommend/intents.toml` ships with ~15 canonical cases at v1, mixing:

- Module-matching intents (paywall, OAuth, analytics, etc.).
- Template-matching intents (streaming app, music app, screensaver, game, etc.).
- Negative cases (`"what time is it"` should NOT recommend a feature_module).
- Order-sensitive cases (`expected_top_ids_in_order` vs. order-agnostic `expected_top_ids`).
- Wildcard blocklist (`forbidden_top_ids = ["feature_module:*"]`).

Cases referencing not-yet-shipped modules are marked `xfail` until the module ships.

### Ranker observability

- `tags.toml` `version` field bumps on rule changes.
- `brs_recommend` response includes `ranker_version` (tracking `tags.toml` version) so callers detect upgrades.
- Per-doc `details` (BM25 + tag boosts + module-category boost + matched terms) always returned.

## Testing strategy

### Three test tiers

**Unit (~80 tests, fast, no I/O):**

- `test_search.py`, `test_get.py`, `test_list.py`, `test_sample_read.py`: in-memory SQLite seeded with ~30 fixture docs.
- `test_recommend/test_ranker.py`: in-memory SQLite + v1 `tags.toml`.
- `test_models.py`: Pydantic round-trips, kind enum guards, ID prefix validation.
- `test_corpus_build/`: per-source parser tests with checked-in tarball fixtures (~20KB total).

**Integration (~15 tests, against real corpus):**

- `test_recommend_fixtures.py`: runs `intents.toml` cases against a freshly-built real corpus. Load-bearing.
- `test_mcp_server.py`: spawns MCP server as subprocess; JSON-RPC round-trips.
- `test_first_run.py`: invokes server with clean `~/.cache/rokudev/docs/`; asserts bundled corpus copied; `brs_search` succeeds.
- `test_refresh.py`: builds corpus; runs `brs-docs refresh`; asserts no-op; mutates lock; runs refresh; asserts atomic install; injects failure; asserts original preserved.

**Contract (~5 tests):**

- `test_brs_gen_module_toml_shape.py`: asserts brs-docs `corpus/sources/feature_modules.py` handles every field in the brs-gen module-toml schema.
- `test_corpus_version_matches_brs_gen.py`: asserts `corpus.lock` `rokudev_tools_modules.package_version` matches `packages/brs-gen/package.json` version at build time.

### Test invocation

```bash
# From packages/brs-docs/
uv run pytest                              # unit only (fast)
uv run pytest -m integration               # integration only
uv run pytest -m "not slow"                # default

# From repo root
make test-python                            # delegates
make test                                    # runs TS (turbo) + Python in parallel
```

## CI integration

GitHub Actions Python job:

```yaml
jobs:
  brs-docs-python:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup-python: '3.11'
      - install-uv
      - run: cd packages/brs-docs && uv sync
      - run: cd packages/brs-docs && make build-corpus
      - run: cd packages/brs-docs && uv run pytest --maxfail=1
      - run: cd packages/brs-docs && uv run pytest -m integration
      - run: cd packages/brs-docs && uv run ruff check
      - run: cd packages/brs-docs && uv run mypy src/
```

**Linters:** `ruff` (formatter + linter) + `mypy --strict`.

**New CI lint rules:**

- `corpus-lock-discipline.sh`: PR cannot bump any SHA in `corpus.lock` without also bumping `brs_docs.__version__`. Version bump without SHA bump is allowed.
- `tags-toml-discipline.sh`: PR cannot change `tags.toml` rules without bumping its `version` field. Pure version bumps require a PR comment justifying.

## Release flow

**v0.7.0 = first brs-docs release.** Repo currently at v0.6.1 post-Plan 5.1.

Release steps:

1. Bump `packages/brs-docs/pyproject.toml` version to 0.7.0.
2. Bump `corpus.lock` SHAs if upstream sources have moved (else carry forward).
3. Tag `v0.7.0`.
4. CI release workflow: runs all tests; `make build-corpus`; `uv build`; `uv publish` to PyPI.
5. PyPI package contains source + `src/brs_docs/data/corpus.sqlite` + `src/brs_docs/data/corpus.lock`.

**Cross-package version coupling:** ship brs-docs 0.7.0 alongside TS packages at 0.7.0 manually at v1. Block 10 makes this automatic.

## Distribution + install instructions

**MCP user (Claude Code):**

```json
{
  "mcpServers": {
    "brs-docs": {
      "command": "uvx",
      "args": ["brs-docs", "serve"]
    }
  }
}
```

**CLI user (human dev):**

```bash
uv tool install brs-docs
brs-docs search "RowList"
brs-docs recommend "how do I show a paywall"
brs-docs refresh
brs-docs version                              # package version + corpus.lock summary
```

## Success criteria for v1

A v1 brs-docs is successful when ALL of these are true:

1. All 5 MCP tools return responses matching the schemas above.
2. Pre-bundled corpus contains at least 600 docs across all 9 kinds (current prototype has 771; expect ~750 with feature_module + template added).
3. Wheel size < 30 MB (target: ~18 MB).
4. First-run startup latency < 500 ms on fresh `~/.cache/rokudev/docs/`.
5. `brs_search` query latency < 50 ms p99 on the bundled corpus.
6. `brs_recommend` query latency < 200 ms p99.
7. All ~15 fixture-pinned recommend cases pass (with `xfail` for cases referencing not-yet-shipped modules).
8. `brs-docs refresh` is transactional: never leaves a corrupt corpus on failure.
9. Claude Code can call all 5 tools via MCP stdio without protocol errors (validated by `test_mcp_server.py`).
10. `brs-docs version` reports both package version and corpus SHAs.

## What v1 does NOT ship (deferred polish)

- True upstream-fetch refresh (`brs-docs refresh --upstream`).
- Corp-network mirror flag.
- `brs` umbrella CLI integration.
- LSP-as-tool composition.
- Word-boundary tokenization for keyword lookups.
- Auto-tuned ranker weights.
- Telemetry of any kind (PRD §8.5 invariant).
- Multi-language corpus.
- Hot reload on `tags.toml` changes.

## Risks + open questions

1. **Wheel size.** 18 MB SQLite-in-wheel is borderline; if it bloats to >30 MB at any point we revisit shipping strategy (CDN fetch on first run vs. bundled).
2. **Monorepo coupling.** Corpus build reads `packages/brs-gen/{modules,templates}/` directly. brs-docs cannot easily build outside the monorepo. Acceptable for v1 (we own the release pipeline); a future "release brs-docs independently" workflow would need a brs-gen Python shim.
3. **Tag boost false positives.** Substring matching means `"row"` matches `"borrow"`. v1 accepts; v1.1 can move to word-boundary regex.
4. **`brs_recommend` `details` chattiness.** Always returning per-doc scoring details is verbose. Acceptable trade for Claude Code auditability; revisit if it shows up in latency budget.
5. **BM25 column weights.** Defaults (4.0/2.0/1.0/3.0) are first-pass guesses. Expect 1-2 PRs of tuning against fixture cases during implementation.

## Pointers

- PRD reference: `docs/superpowers/specs/2026-05-06-rokudev-tools-prd-design.md` §5.
- Prototype reference: `/Users/bblietz/Work/ClaudeProjects/brs-mcp-for-docs/`.
- Brainstorm transcript: this session 2026-05-19.
- Work-order context: `~/.claude/projects/-Users-bblietz-Work-ClaudeProjects-rokudev-tools/memory/MEMORY.md` (post-pivot work order, block 1).
