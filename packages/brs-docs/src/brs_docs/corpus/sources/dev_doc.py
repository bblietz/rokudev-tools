"""Parse rokudev/dev-doc tarball into CanonicalDoc instances."""

from __future__ import annotations

import hashlib
import re
import tarfile
import time
from collections.abc import Iterator
from pathlib import Path

import yaml

from brs_docs.models import CanonicalDoc, Kind

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n(.*)", re.DOTALL)


def parse_dev_doc_tarball(path: Path) -> Iterator[CanonicalDoc]:
    with tarfile.open(path, "r:gz") as tar:
        for member in tar:
            if not member.isfile() or not member.name.endswith(".md"):
                continue
            f = tar.extractfile(member)
            if f is None:
                continue
            raw = f.read().decode("utf-8", errors="replace")
            doc = _parse_md(raw)
            if doc is not None:
                yield doc


def _parse_md(raw: str) -> CanonicalDoc | None:
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
