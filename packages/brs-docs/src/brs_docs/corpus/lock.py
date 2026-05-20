"""Parse + validate brs-docs corpus.lock files."""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

from pydantic import BaseModel, ConfigDict


class LockValidationError(ValueError):
    pass


class GitSource(BaseModel):
    model_config = ConfigDict(frozen=True)
    url: str
    sha: str
    fetched_at: str | None = None


class MonorepoSource(BaseModel):
    model_config = ConfigDict(frozen=True)
    package_version: str
    module_count: int | None = None
    template_count: int | None = None


class LockSources(BaseModel):
    model_config = ConfigDict(frozen=True)
    dev_doc: GitSource
    samples: GitSource
    scenegraph_master_sample: GitSource
    rokudev_tools_modules: MonorepoSource
    rokudev_tools_templates: MonorepoSource


class CorpusLock(BaseModel):
    model_config = ConfigDict(frozen=True)
    brs_docs_version: str
    generated_at: str
    sources: LockSources


_SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")


def parse_corpus_lock(path: Path) -> CorpusLock:
    text = path.read_text("utf-8")
    data = tomllib.loads(text)
    try:
        return CorpusLock.model_validate(data)
    except Exception as exc:
        raise LockValidationError(f"failed to parse {path}: {exc}") from exc


def validate_lock(lock: CorpusLock) -> None:
    if not _SEMVER_RE.match(lock.brs_docs_version):
        raise LockValidationError(
            f"brs_docs_version {lock.brs_docs_version!r} is not semver"
        )
