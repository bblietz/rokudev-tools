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
    def _check_id_prefix(self) -> CanonicalDoc:
        expected = f"{self.kind.value}:"
        if not self.id.startswith(expected):
            raise ValueError(f"id {self.id!r} must start with {expected!r}")
        return self
