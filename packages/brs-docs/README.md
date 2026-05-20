# brs-docs

MCP server + CLI for Roku BrightScript docs, code samples, and
rokudev-tools feature modules + templates.

Part of the rokudev-tools monorepo. See
`docs/superpowers/specs/2026-05-19-brs-docs-mcp-design.md` for the
design and `docs/superpowers/plans/2026-05-19-plan-6-brs-docs-mcp.md`
for the implementation plan.

## Install

```bash
uv tool install brs-docs
```

Or run directly without install:

```bash
uvx brs-docs search "RowList"
```

## CLI

```bash
brs-docs version                            # version + corpus summary
brs-docs search "RowList" --kind node       # FTS5 search
brs-docs get node:RowList                   # fetch one doc by id
brs-docs list node --prefix Row             # list docs of a kind
brs-docs recommend "rotating focus"         # rank by intent
brs-docs refresh                            # rebuild corpus from bundled snapshot
brs-docs serve                              # run MCP stdio server
```

`brs_sample_read` is exposed as an MCP tool only; it is not on the CLI
surface in v1.

## MCP integration (Claude Code)

Add to your Claude Code MCP config:

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

Five tools become available: `brs_search`, `brs_get`, `brs_list`,
`brs_sample_read`, `brs_recommend`.

## What's NOT in v1

- **Upstream-fetch refresh.** `brs-docs refresh` rebuilds from the
  bundled snapshot; the production GitHub-fetch path is implemented
  in `build_corpus` but not yet exposed via the refresh CLI.
- **Corp-network mirror.**
- **LSP-as-tool composition** (block 2 of the dev-tools work order).
- **`brs` umbrella CLI** (block 6).
- **Telemetry of any kind**, load-bearing per PRD section 8.5.

## Development

```bash
cd packages/brs-docs
uv sync
make build-corpus  # generates src/brs_docs/data/corpus.sqlite (~60s; network)
uv run pytest -v
uv run pytest -m integration -v
```
