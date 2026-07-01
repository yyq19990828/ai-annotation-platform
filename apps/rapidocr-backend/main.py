"""rapidocr-backend · RapidOCR ML backend（OCR 任务族首发）。

  GET  /health         就绪 + 引擎池快照
  GET  /setup          协议 v2.2 模型目录：det 原子 + rec 原子 + e2e composite（见 catalog）
  GET  /versions       版本
  POST /warmup         协议 §4.4 预热（按 model_id + variant 加载引擎）
  POST /predict        批量预测，按 context.model_id 路由 det/rec/e2e

端口 8005（compose profile gpu-rapidocr）；与 gsam2(8001)/sam3(8002)/yolo(8003)/onnxtools(8004) 解耦。
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

from aap_backend_runtime import versions_payload
from aap_protocol_v2 import (
    COMPAT_PROTOCOL_VERSIONS,
    PROTOCOL_VERSION,
    BatchPredictResponse,
    PredictionResult,
    WarmupResponse,
)
from fastapi import FastAPI, HTTPException

import catalog
from predictor import RapidOCRPredictor
from schemas import BatchPredictRequest

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("rapidocr-backend")

BACKEND_VERSION = "0.1.0"
MODEL_VERSION = "rapidocr-v3.9.0"

_predictor: RapidOCRPredictor | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _predictor
    _predictor = RapidOCRPredictor()
    logger.info(
        "rapidocr-backend ready (lazy): model_dir=%s device=%s",
        catalog.MODELS_DIR, os.environ.get("RAPIDOCR_DEVICE", "gpu"),
    )
    yield


app = FastAPI(title="rapidocr-backend", version=BACKEND_VERSION, lifespan=lifespan)


def _route(
    model_id: str, r, file_path: str, params: dict[str, Any] | None = None
) -> tuple[list[dict[str, Any]], int]:
    assert _predictor is not None
    if model_id == catalog.DET_MODEL_ID:
        return _predictor.det_one(r, file_path, params)
    if model_id == catalog.REC_MODEL_ID:
        return _predictor.rec_one(r, file_path, params)
    return _predictor.e2e_one(r, file_path, params)


def _extract_params(context: dict[str, Any]) -> dict[str, Any]:
    """取运行时阈值 params。协议 v2 结构化路径嵌在 context.params;老 flat 路径平铺在顶层。"""
    params = context.get("params")
    out: dict[str, Any] = dict(params) if isinstance(params, dict) else {}
    for k in ("text_score", "box_thresh", "unclip_ratio"):
        if k not in out and k in context:
            out[k] = context[k]
    return out


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "rapidocr-backend",
        "version": BACKEND_VERSION,
        "model_version": MODEL_VERSION,
        "ready": _predictor is not None,
        "pool": _predictor.pool_snapshot() if _predictor is not None else None,
    }


@app.get("/setup")
def setup() -> dict[str, Any]:
    return {
        "protocol_version": PROTOCOL_VERSION,
        "compat_protocol_versions": COMPAT_PROTOCOL_VERSIONS,
        "name": "rapidocr-backend",
        "version": BACKEND_VERSION,
        "model_version": MODEL_VERSION,
        "is_interactive": False,
        "supported_prompts": ["none"],
        "supported_geometric_outputs": ["polygon"],
        "infra": "onnx",
        "warmup_endpoint": True,
        "models": catalog.model_entries(),
    }


@app.get("/versions")
def versions() -> dict[str, Any]:
    return versions_payload(MODEL_VERSION, BACKEND_VERSION)


@app.post("/warmup", response_model=WarmupResponse)
def warmup(req: BatchPredictRequest) -> WarmupResponse:
    if _predictor is None:
        raise HTTPException(status_code=503, detail="backend not ready")
    model_id = req.context.get("model_id", catalog.E2E_MODEL_ID)
    variants = req.context.get("model_variants")
    t0 = time.time()
    try:
        r = catalog.resolve(model_id, variants)
        _predictor._get_engine(r)  # noqa: SLF001 — 预热即加载引擎进池
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return WarmupResponse(ok=True, model_load_ms=int((time.time() - t0) * 1000))


@app.post("/predict", response_model=BatchPredictResponse)
def predict(req: BatchPredictRequest) -> BatchPredictResponse:
    if _predictor is None:
        raise HTTPException(status_code=503, detail="backend not ready")
    model_id = req.context.get("model_id", catalog.E2E_MODEL_ID)
    variants = req.context.get("model_variants")
    params = _extract_params(req.context)
    try:
        r = catalog.resolve(model_id, variants)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    results: list[PredictionResult] = []
    for t in req.tasks:
        try:
            items, infer_ms = _route(model_id, r, t.file_path, params)
        except Exception as exc:  # noqa: BLE001
            logger.exception("predict failed for task %s", t.id)
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        score = max((it.get("score", 0.0) for it in items), default=0.0)
        results.append(
            PredictionResult(
                task=t.id,
                result=items,
                score=score,
                model_version=f"{MODEL_VERSION}/{model_id}",
                inference_time_ms=infer_ms,
            )
        )
    return BatchPredictResponse(results=results)
