"""Hybrid BM25 + tag-boost + module-category-boost ranker."""

from __future__ import annotations

import sqlite3
import tomllib
from functools import lru_cache
from importlib.resources import files
from typing import Any

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
    intent_lower: str, doc_tags: list[str], keyword_to_tags: dict[str, list[dict[str, Any]]],
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
    intent_lower: str, doc_id: str, module_categories: list[dict[str, Any]],
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
