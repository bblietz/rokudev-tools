"""Parse rokudev-tools feature modules from packages/brs-gen/modules/."""

from __future__ import annotations

import hashlib
import json
import time
import tomllib
from collections.abc import Iterator
from pathlib import Path
from typing import Any

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


def _synthesize_body(title: str, summary: str, toml_data: dict[str, Any]) -> str:
    lines = [f"# {title}", "", summary, "", "## Module manifest", "", "```toml"]
    lines.append(json.dumps(toml_data, indent=2))
    lines.append("```")
    return "\n".join(lines)


def _get_public_api(toml_data: dict[str, Any]) -> list[str]:
    api = toml_data.get("public_api") or {}
    return list(api.get("functions") or [])
