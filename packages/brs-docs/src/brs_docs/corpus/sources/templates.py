"""Parse rokudev-tools templates from packages/brs-gen/templates/."""

from __future__ import annotations

import hashlib
import json
import time
import tomllib
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from brs_docs.models import CanonicalDoc, Kind


def parse_templates(templates_dir: Path) -> Iterator[CanonicalDoc]:
    if not templates_dir.exists():
        return
    for t_dir in sorted(templates_dir.iterdir()):
        if not t_dir.is_dir():
            continue
        toml_path = t_dir / "template.toml"
        if not toml_path.exists():
            continue
        toml_data = tomllib.loads(toml_path.read_text("utf-8"))
        tpl = toml_data.get("template", {})
        tid = tpl.get("id")
        if not tid:
            continue
        title = tpl.get("display_name") or tid
        summary = tpl.get("description") or ""
        tag_list = tpl.get("tags") or []
        tags = " ".join(str(t) for t in tag_list)

        readme = t_dir / "README.md"
        if readme.exists():
            body = readme.read_text("utf-8")
        else:
            body = _synthesize_body(title, summary, toml_data)

        body_bytes = body.encode("utf-8")
        structured = {
            "supported_modules": tpl.get("supported_modules") or [],
            "scenes": tpl.get("scenes") or [],
            "content_kinds": tpl.get("content_kinds") or [],
        }
        yield CanonicalDoc(
            id=f"template:{tid}",
            kind=Kind.TEMPLATE,
            title=title,
            summary=summary,
            body=body,
            body_truncated=False,
            byte_count=len(body_bytes),
            tags=tags,
            url=None,
            source="rokudev-tools-templates",
            structured=structured,
            fetched_at=int(time.time()),
            content_hash=hashlib.sha256(body_bytes).hexdigest(),
        )


def _synthesize_body(title: str, summary: str, toml_data: dict[str, Any]) -> str:
    lines = [f"# {title}", "", summary, "", "## Template manifest", "", "```toml"]
    lines.append(json.dumps(toml_data, indent=2))
    lines.append("```")
    return "\n".join(lines)
