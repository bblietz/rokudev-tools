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
            except (UnicodeDecodeError, OSError):
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
        tags=" ".join(sorted({"sample", language, source.replace("_", "-")})),
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
