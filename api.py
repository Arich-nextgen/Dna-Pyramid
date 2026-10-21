#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SafeNet KZ / Pyramid DNA — read-only, explainable demo API.

All bundled dataset records are synthetic. API analyzes submitted *text*;
there is NO WhatsApp/Telegram scraping, live OCR, police integration, or storage
of user submissions. Use permissioned, de-identified materials only.
"""
from __future__ import annotations

from collections import Counter
from functools import lru_cache
import json
import os
from pathlib import Path
import secrets
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from pyramid_dna_engine import (
    DEFAULT_DATA,
    analyze,
    compare,
    load_records,
    matching_metrics,
    report_scores,
    validate_records,
)

Risk = Literal["low", "medium", "high"]
Split = Literal["train", "validation", "test"]
Disclaimer = (
    "Demo only: synthetic data and preliminary indicators, not proof of unlawful "
    "activity or that two projects share an organizer. Human verification required."
)

# Configurable filesystem path (never taken from external HTTP requests).
DATA_PATH = Path(os.environ.get("PYRAMID_DNA_DATA", str(DEFAULT_DATA)))
API_KEY = os.environ.get("PYRAMID_DNA_API_KEY", "")
# Only trusted local development origins by default. Do not use wildcard in production.
CORS_ORIGINS = [s.strip() for s in os.environ.get(
    "PYRAMID_DNA_CORS_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://localhost:8501,"
    "http://127.0.0.1:3000,http://127.0.0.1:5173,http://127.0.0.1:8501"
).split(",") if s.strip()]

# Fail early on invalid/missing data. Safe for only 720 static synthetic rows.
DATASET = load_records(DATA_PATH)
DATA_VALIDATION = validate_records(DATASET)
if not DATA_VALIDATION["valid"]:
    raise RuntimeError(f"Dataset invalid: {DATA_VALIDATION['issues'][:5]}")
RECORDS_BY_ID = {row["id"]: row for row in DATASET}
ARTIFACTS_PATH = Path(__file__).resolve().parent / 'artifacts'


@lru_cache(maxsize=2048)
def _analyze_record(record_id: str) -> dict:
    return analyze(RECORDS_BY_ID[record_id]["text"])


def require_key(x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None):
    """Authentication is optional for local demo; set env key before exposure."""
    if API_KEY and (not x_api_key or not secrets.compare_digest(x_api_key, API_KEY)):
        raise HTTPException(status_code=401, detail="Missing or invalid API key")


class AnalyzeRequest(BaseModel):
    text: str = Field(
        min_length=3, max_length=10000,
        description="Text or OCR transcription. No access to private chats.",
        examples=["Взнос 5 000 ₸, получи 10 000 ₸, пригласи 2 участников"],
    )

    @field_validator("text")
    @classmethod
    def non_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Text must not be blank")
        return value


class BatchRequest(BaseModel):
    texts: list[AnalyzeRequest] = Field(min_length=1, max_length=100)


class CompareRequest(BaseModel):
    left: AnalyzeRequest
    right: AnalyzeRequest


class SimilaritySearchRequest(AnalyzeRequest):
    split: Literal["all", "train", "validation", "test"] = "all"
    min_similarity: float = Field(default=0.70, ge=0, le=1)
    top_k: int = Field(default=10, ge=1, le=50)


app = FastAPI(
    title="Pyramid DNA API | SafeNet KZ",
    description=(
        "Rule-based financial-mechanism analysis for RU/KZ examples. "
        "SYNTHETIC TEST DATA ONLY; not a legal determination. "
        "No collection from social networks. Explicit case saving uses local SQLite."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "X-API-Key"],
)
router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_key)])


@app.get("/", tags=["System"])
def root():
    return {"name": "Pyramid DNA", "version": "1.0.0", "docs": "/docs", "api": "/api/v1", "disclaimer": Disclaimer}


@app.get("/healthz", tags=["System"])
def healthz():
    return {"status": "ok", "records_loaded": len(DATASET), "dataset_type": "fully_synthetic"}


@router.get("/health", tags=["System"])
def health():
    return healthz()


@router.post("/analyze", tags=["Analysis"])
def analyze_one(payload: AnalyzeRequest):
    return {"analysis": analyze(payload.text), "data_retained": False, "disclaimer": Disclaimer}


@router.post("/analyze/batch", tags=["Analysis"])
def analyze_batch(payload: BatchRequest):
    return {
        "count": len(payload.texts),
        "results": [{"index": i, "analysis": analyze(t.text)} for i, t in enumerate(payload.texts)],
        "data_retained": False,
        "disclaimer": Disclaimer,
    }


@router.post("/compare", tags=["Matching"])
def compare_two(payload: CompareRequest):
    left_result = analyze(payload.left.text)
    right_result = analyze(payload.right.text)
    return {
        "comparison": compare(left_result, right_result),
        "left_analysis": left_result,
        "right_analysis": right_result,
        "disclaimer": Disclaimer,
    }


def _neighbor_list(
    *, anchor_analysis: dict, candidates: list[dict], top_k: int,
    min_similarity: float, exclude_id: str | None = None,
) -> list[dict]:
    output = []
    for row in candidates:
        if row["id"] == exclude_id:
            continue
        match = compare(anchor_analysis, _analyze_record(row["id"]))
        if match["similarity"] < min_similarity or not match["shared_features"]:
            continue
        output.append({
            "id": row["id"], "language": row["language"],
            "split": row["split"], "source_type": row["source_type"],
            "risk_label_in_dataset": row["risk_label"],
            "text": row["text"], "similarity": match["similarity"],
            "is_similar": match["is_similar"],
            "shared_features": match["shared_features"],
            "caution": match["caution"],
        })
    output.sort(key=lambda r: (-r["similarity"], r["id"]))
    return output[:top_k]


@router.post("/search/similar", tags=["Matching"])
def search_similar(payload: SimilaritySearchRequest):
    anchor = analyze(payload.text)
    rows = DATASET if payload.split == "all" else [r for r in DATASET if r["split"] == payload.split]
    items = _neighbor_list(
        anchor_analysis=anchor, candidates=rows,
        top_k=payload.top_k, min_similarity=payload.min_similarity,
    )
    return {"query_analysis": anchor, "count": len(items), "neighbors": items, "disclaimer": Disclaimer}


@router.get("/records", tags=["Dataset"])
def list_records(
    page: Annotated[int, Query(ge=1, le=100000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
    split: Split | None = None,
    risk: Risk | None = None,
    language: str | None = Query(default=None, max_length=30),
    q: str | None = Query(default=None, max_length=100),
):
    items = DATASET
    if split:
        items = [r for r in items if r["split"] == split]
    if risk:
        items = [r for r in items if r["risk_label"] == risk]
    if language:
        items = [r for r in items if r["language"] == language]
    if q:
        items = [r for r in items if q.casefold() in r["text"].casefold()]
    total = len(items)
    offset = (page - 1) * page_size
    return {"total": total, "page": page, "page_size": page_size, "items": items[offset: offset + page_size],
            "provenance": "fully_synthetic"}


@router.get("/records/{record_id}", tags=["Dataset"])
def get_record(record_id: str):
    row = RECORDS_BY_ID.get(record_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Record not found")
    return {"record": row, "analysis": _analyze_record(record_id)}


@router.get("/records/{record_id}/neighbors", tags=["Matching"])
def record_neighbors(
    record_id: str,
    top_k: Annotated[int, Query(ge=1, le=50)] = 10,
    min_similarity: Annotated[float, Query(ge=0, le=1)] = 0.70,
    split: Literal["all", "train", "validation", "test"] = "all",
):
    if record_id not in RECORDS_BY_ID:
        raise HTTPException(status_code=404, detail="Record not found")
    rows = DATASET if split == "all" else [r for r in DATASET if r["split"] == split]
    neighbors = _neighbor_list(
        anchor_analysis=_analyze_record(record_id), candidates=rows,
        top_k=top_k, min_similarity=min_similarity, exclude_id=record_id,
    )
    return {"anchor_id": record_id, "count": len(neighbors), "neighbors": neighbors, "disclaimer": Disclaimer}


@router.get("/dataset/stats", tags=["Dataset"])
def dataset_stats():
    return {
        "total": len(DATASET),
        "scenarios": len({r["mechanism_id"] for r in DATASET}),
        "splits": dict(Counter(r["split"] for r in DATASET)),
        "risk_labels": dict(Counter(r["risk_label"] for r in DATASET)),
        "languages": dict(Counter(r["language"] for r in DATASET)),
        "modalities": dict(Counter(r["modality"] for r in DATASET)),
        "synthetic_only": True,
    }


@router.get("/dataset/validate", tags=["Dataset"])
def dataset_validate():
    return DATA_VALIDATION


def _read_artifact(name: str) -> dict:
    path = ARTIFACTS_PATH / name
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail='Результаты измерения ещё не сформированы.') from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail='Не удалось прочитать сохранённый результат измерения.') from exc


@router.get('/quality/benchmark', tags=['Quality'])
def benchmark_results():
    return _read_artifact('benchmark_results.json')


@router.get('/quality/public-challenge', tags=['Quality'])
def public_challenge_results():
    return _read_artifact('public_challenge_results.json')


@lru_cache(maxsize=3)
def _evaluation(split: Split):
    rows = [r for r in DATASET if r["split"] == split]
    return {
        "split": split,
        "risk_classification": report_scores(rows),
        "mechanism_similarity": matching_metrics(rows, seed=42),
        "disclaimer": "Only synthetic benchmark results; no established accuracy on real-world messages.",
    }


@router.get("/evaluate", tags=["Evaluation"])
def evaluate(split: Split = "test"):
    return _evaluation(split)


app.include_router(router)

from cases import case_router
app.include_router(case_router(require_key))
# Production frontend shares this origin and authentication boundary.
from fastapi.staticfiles import StaticFiles
FRONTEND_DIST = Path(__file__).with_name('frontend') / 'dist'
if FRONTEND_DIST.exists():
    app.mount('/app', StaticFiles(directory=FRONTEND_DIST, html=True), name='frontend')
