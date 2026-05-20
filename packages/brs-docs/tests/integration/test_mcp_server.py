"""Integration test: spawn brs-docs serve as subprocess, do MCP JSON-RPC handshake."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import pytest

pytestmark = pytest.mark.integration

PACKAGE_ROOT = Path(__file__).parent.parent.parent
MONOREPO_ROOT = PACKAGE_ROOT.parent.parent
FIXTURES_DIR = PACKAGE_ROOT / "tests" / "fixtures"
BUNDLED_LOCK = PACKAGE_ROOT / "corpus.lock"


def _build_corpus_in(cache: Path) -> None:
    from brs_docs.corpus.build import build_corpus
    cache.mkdir(parents=True, exist_ok=True)
    build_corpus(
        lock_path=BUNDLED_LOCK,
        out_path=cache / "corpus.sqlite",
        monorepo_root=MONOREPO_ROOT,
        sources_fixture_dir=FIXTURES_DIR,
        min_counts={},
    )


def _send(proc: subprocess.Popen[bytes], msg: dict[str, Any]) -> None:
    line = (json.dumps(msg) + "\n").encode("utf-8")
    assert proc.stdin is not None
    proc.stdin.write(line)
    proc.stdin.flush()


def _read_response(proc: subprocess.Popen[bytes], timeout: float = 5.0) -> dict[str, Any]:
    """Read one JSON-RPC response line from stdout."""
    assert proc.stdout is not None
    deadline = time.time() + timeout
    buf = b""
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            time.sleep(0.05)
            continue
        buf = line
        try:
            return json.loads(buf.decode("utf-8"))  # type: ignore[no-any-return]
        except json.JSONDecodeError:
            continue  # might be partial; loop
    raise TimeoutError(f"no response within {timeout}s; buf={buf!r}")


def test_mcp_server_handshake_and_search(tmp_path: Path) -> None:
    """Spawn brs-docs serve, do initialize + tools/list + tools/call."""
    cache = tmp_path / "cache"
    _build_corpus_in(cache)

    env = {**os.environ, "ROKUDEV_CACHE_DIR": str(cache)}
    proc = subprocess.Popen(
        [sys.executable, "-m", "brs_docs.cli", "serve"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        cwd=str(PACKAGE_ROOT),
    )
    try:
        # MCP initialize handshake
        _send(proc, {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "brs-docs-integration-test", "version": "0"},
            },
        })
        init_resp = _read_response(proc, timeout=10.0)
        assert init_resp.get("id") == 1
        assert "result" in init_resp

        # Send "initialized" notification (no response expected)
        _send(proc, {
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {},
        })

        # tools/list
        _send(proc, {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {},
        })
        tools_resp = _read_response(proc, timeout=5.0)
        assert tools_resp.get("id") == 2
        tool_names = {t["name"] for t in tools_resp["result"]["tools"]}
        expected_names = {
            "brs_search", "brs_get", "brs_list", "brs_sample_read", "brs_recommend",
        }
        assert tool_names == expected_names

        # tools/call brs_search
        _send(proc, {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "brs_search", "arguments": {"query": "RowList", "limit": 5}},
        })
        call_resp = _read_response(proc, timeout=5.0)
        assert call_resp.get("id") == 3
        content = call_resp["result"]["content"]
        assert content[0]["type"] == "text"
        payload = json.loads(content[0]["text"])
        assert "results" in payload
    finally:
        assert proc.stdin is not None
        proc.stdin.close()
        try:
            proc.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            proc.terminate()
            proc.wait(timeout=2.0)
